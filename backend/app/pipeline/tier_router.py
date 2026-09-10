"""
Tier router: dispatches a job to the correct capture-tier pipeline,
then hands the resulting metric PLY to the common backend.

Cross-tier fusion (photos + LiDAR for same job) is handled here via ICP.
"""
from pathlib import Path
from typing import Optional

import structlog

from app.config import settings, get_job_dir, get_images_dir
from app.models.job import Tier

log = structlog.get_logger()


def route(
    job_id: str,
    tier: Tier,
    scale_reference_m: Optional[float],
    progress_cb,        # callable(stage: str, pct: int)
) -> Path:
    """
    Run the appropriate tier pipeline and return the path to `scan_metric.ply`.

    Parameters
    ----------
    job_id           : unique job identifier
    tier             : Tier.photos | Tier.video | Tier.lidar
    scale_reference_m: real-world length (m) of the reference object;
                       required for photos/video, ignored for lidar
    progress_cb      : callable(stage, pct) — emits progress updates

    Returns
    -------
    Path to `scan_metric.ply` (metric, gravity-aligned, Z-up)
    """
    if tier == Tier.photos:
        from app.pipeline.tier_a_b import run_photo_tier
        return run_photo_tier(job_id, scale_reference_m, progress_cb)

    elif tier == Tier.video:
        from app.pipeline.tier_a_b import run_video_tier
        return run_video_tier(job_id, scale_reference_m, progress_cb)

    elif tier == Tier.lidar:
        from app.pipeline.tier_c import run_lidar_tier
        return run_lidar_tier(job_id, progress_cb)

    elif tier == Tier.hybrid:
        from app.pipeline.tier_c import run_lidar_tier
        from app.pipeline.tier_a_b import run_video_tier, run_photo_tier
        
        # 1. Target: Metric LiDAR cloud
        lidar_metric_ply = run_lidar_tier(job_id, progress_cb)
        
        # 2. Source: Unscaled COLMAP cloud (detect if video or photos exist)
        job_dir = get_job_dir(job_id)
        images_dir = get_images_dir(job_id)
        video_files = list(job_dir.glob("*.mp4")) + list(job_dir.glob("*.mov")) \
                    + list(images_dir.glob("*.mp4")) + list(images_dir.glob("*.mov"))
        
        if video_files:
            photo_ply = run_video_tier(job_id, None, progress_cb)
        else:
            photo_ply = run_photo_tier(job_id, None, progress_cb)
            
        # 3. Fuse!
        return fuse_tiers(photo_ply, lidar_metric_ply, progress_cb)

    else:
        raise ValueError(f"Unknown tier: {tier!r}")


def fuse_tiers(
    photo_ply: Path,
    lidar_ply: Path,
    progress_cb,
) -> Path:
    """
    Cross-tier fusion: align an unscaled photo/video PLY to a metric LiDAR PLY
    using ICP, derive scale, and return a fused, denser metric PLY.

    This is called when a job contains both photos/video AND a LiDAR scan.
    The ICP-derived scale replaces the manual scale_reference_m, reducing
    user measurement error.

    Parameters
    ----------
    photo_ply  : path to unscaled photo/video point cloud
    lidar_ply  : path to metric LiDAR point cloud
    progress_cb: callable(stage, pct)

    Returns
    -------
    Path to fused `scan_metric.ply`
    """
    import open3d as o3d
    import numpy as np

    progress_cb("icp_fusion", 50)

    source = o3d.io.read_point_cloud(str(photo_ply))
    target = o3d.io.read_point_cloud(str(lidar_ply))

    # Coarse alignment: Pre-scale source to roughly match target before FPFH extraction
    src_bbox = source.get_axis_aligned_bounding_box()
    tgt_bbox = target.get_axis_aligned_bounding_box()
    initial_scale = tgt_bbox.get_extent().max() / src_bbox.get_extent().max()
    source.scale(initial_scale, center=src_bbox.get_center())

    voxel_size = 0.05  # 5 cm voxel for fast global match
    source_down = source.voxel_down_sample(voxel_size)
    target_down = target.voxel_down_sample(voxel_size)

    source_down.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(radius=voxel_size * 2, max_nn=30))
    target_down.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(radius=voxel_size * 2, max_nn=30))

    src_fpfh = o3d.pipelines.registration.compute_fpfh_feature(
        source_down, o3d.geometry.KDTreeSearchParamHybrid(radius=voxel_size * 5, max_nn=100)
    )
    tgt_fpfh = o3d.pipelines.registration.compute_fpfh_feature(
        target_down, o3d.geometry.KDTreeSearchParamHybrid(radius=voxel_size * 5, max_nn=100)
    )

    ransac_result = o3d.pipelines.registration.registration_ransac_based_on_feature_matching(
        source_down, target_down, src_fpfh, tgt_fpfh,
        mutual_filter=True,
        max_correspondence_distance=voxel_size * 2,
    )

    # Fine ICP alignment (allowing scale drift to fix arbitrary COLMAP scale)
    icp_result = o3d.pipelines.registration.registration_icp(
        source, target,
        max_correspondence_distance=0.05,
        init=ransac_result.transformation,
        estimation_method=o3d.pipelines.registration.TransformationEstimationPointToPoint(with_scaling=True),
    )

    T = icp_result.transformation   # 4×4 homogeneous transform

    # Scale factor ≈ geometric mean of diagonal scaling components
    scale = float(np.cbrt(abs(np.linalg.det(T[:3, :3]))))
    log.info("icp_fusion", scale_factor=scale, fitness=icp_result.fitness)

    # Apply transform to source cloud and merge with target
    source.transform(T)
    fused = source + target
    fused = fused.voxel_down_sample(0.01)   # 1 cm deduplicate

    out = photo_ply.parent / "scan_metric_fused.ply"
    o3d.io.write_point_cloud(str(out), fused)
    progress_cb("icp_fusion", 100)
    return out
