"""
Tier A (photos) and Tier B (video) pipeline.

Flow
────
1. [Tier B only] Extract frames from video with ffmpeg.
2. Run COLMAP automatic_reconstructor → sparse SfM + dense MVS.
3. Load the fused.ply from COLMAP dense output.
4. Apply scale anchoring using the known reference object length.
5. Save scan_metric.ply in the job results directory.

All heavy subprocess calls are synchronous and run inside a Celery worker process.
"""
import subprocess
from pathlib import Path
from typing import Optional, Callable

import numpy as np
import open3d as o3d
import structlog

from app.config import settings, get_images_dir, get_job_dir, get_results_dir

log = structlog.get_logger()
ProgressCb = Callable[[str, int], None]


# ── Tier B entry point ────────────────────────────────────────────────────────
def run_video_tier(
    job_id: str,
    scale_reference_m: Optional[float],
    progress_cb: ProgressCb,
) -> Path:
    """Extract frames from video, then run the photo pipeline on them."""
    images_dir = get_images_dir(job_id)
    job_dir = get_job_dir(job_id)

    # Find the uploaded video file
    video_files = list(job_dir.glob("*.mp4")) + list(job_dir.glob("*.mov")) \
                + list(images_dir.glob("*.mp4")) + list(images_dir.glob("*.mov"))

    if not video_files:
        raise FileNotFoundError(f"No video file found in job {job_id}")

    video_path = video_files[0]
    progress_cb("extracting_frames", 5)

    _extract_frames(video_path, images_dir, fps=settings.VIDEO_EXTRACT_FPS)
    progress_cb("extracting_frames", 20)

    # Continue with same COLMAP flow as photo tier
    return _run_colmap_pipeline(job_id, scale_reference_m, progress_cb)


# ── Tier A entry point ────────────────────────────────────────────────────────
def run_photo_tier(
    job_id: str,
    scale_reference_m: Optional[float],
    progress_cb: ProgressCb,
) -> Path:
    """Run COLMAP directly on the uploaded images."""
    return _run_colmap_pipeline(job_id, scale_reference_m, progress_cb)


# ── ffmpeg frame extraction ───────────────────────────────────────────────────
def _extract_frames(video_path: Path, output_dir: Path, fps: float = 3.0):
    """
    Extract frames from a walkthrough video using ffmpeg.

    Equivalent to:
        ffmpeg -i walkthrough.mp4 -vf fps=3 images/frame_%04d.jpg
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    pattern = str(output_dir / "frame_%04d.jpg")
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-vf", f"fps={fps}",
        "-q:v", "2",       # JPEG quality (2 = near-lossless)
        pattern,
    ]
    log.info("ffmpeg_extract", cmd=" ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{result.stderr}")

    frame_count = len(list(output_dir.glob("frame_*.jpg")))
    log.info("ffmpeg_done", frames_extracted=frame_count)
    return frame_count


# ── COLMAP pipeline ───────────────────────────────────────────────────────────
def _run_colmap_pipeline(
    job_id: str,
    scale_reference_m: Optional[float],
    progress_cb: ProgressCb,
) -> Path:
    """
    Run COLMAP automatic_reconstructor then dense stereo fusion.

    Returns path to the scale-corrected scan_metric.ply.
    """
    workspace = get_job_dir(job_id)
    images_dir = get_images_dir(job_id)
    dense_dir = workspace / "dense"
    dense_dir.mkdir(parents=True, exist_ok=True)

    # ── Sparse SfM ────────────────────────────────────────────────────────────
    progress_cb("colmap_sfm", 25)
    log.info("colmap_sfm_start", job_id=job_id)

    sfm_cmd = [
        settings.COLMAP_BIN, "automatic_reconstructor",
        "--workspace_path", str(workspace),
        "--image_path", str(images_dir),
        # Use CPU matcher if no CUDA GPU available; harmless with GPU
        "--use_gpu", "0",
    ]
    _run_cmd(sfm_cmd, "COLMAP SfM")
    progress_cb("colmap_sfm", 50)

    # The automatic_reconstructor places dense output in workspace/dense/
    fused_ply = workspace / "dense" / "fused.ply"

    # If automatic_reconstructor didn't produce dense output, run manual sequence
    if not fused_ply.exists():
        fused_ply = _run_manual_dense(workspace, images_dir, dense_dir, progress_cb)

    progress_cb("colmap_mvs", 70)
    log.info("colmap_dense_done", job_id=job_id, output=str(fused_ply))

    # ── Scale anchoring ────────────────────────────────────────────────────────
    progress_cb("scale_anchoring", 80)
    metric_ply = _apply_scale(job_id, fused_ply, scale_reference_m)
    progress_cb("scale_anchoring", 90)

    return metric_ply


def _run_manual_dense(workspace: Path, images_dir: Path, dense_dir: Path, progress_cb: ProgressCb) -> Path:
    """
    Fallback: run sparse → undistort → patch_match_stereo → stereo_fusion manually.
    Used when COLMAP automatic_reconstructor doesn't produce a dense PLY.
    """
    db_path = workspace / "db.db"
    sparse_dir = workspace / "sparse"
    sparse_dir.mkdir(exist_ok=True)

    log.info("colmap_manual_sequence_start")

    _run_cmd([settings.COLMAP_BIN, "feature_extractor",
              "--database_path", str(db_path),
              "--image_path", str(images_dir)], "feature_extractor")

    _run_cmd([settings.COLMAP_BIN, "exhaustive_matcher",
              "--database_path", str(db_path)], "exhaustive_matcher")

    _run_cmd([settings.COLMAP_BIN, "mapper",
              "--database_path", str(db_path),
              "--image_path", str(images_dir),
              "--output_path", str(sparse_dir)], "mapper")

    progress_cb("colmap_mvs", 55)

    _run_cmd([settings.COLMAP_BIN, "image_undistorter",
              "--image_path", str(images_dir),
              "--input_path", str(sparse_dir / "0"),
              "--output_path", str(dense_dir),
              "--output_type", "COLMAP"], "image_undistorter")

    _run_cmd([settings.COLMAP_BIN, "patch_match_stereo",
              "--workspace_path", str(dense_dir)], "patch_match_stereo")

    fused_ply = dense_dir / "fused.ply"
    _run_cmd([settings.COLMAP_BIN, "stereo_fusion",
              "--workspace_path", str(dense_dir),
              "--output_path", str(fused_ply)], "stereo_fusion")

    return fused_ply


# ── Scale anchoring ────────────────────────────────────────────────────────────
def _apply_scale(job_id: str, raw_ply: Path, scale_reference_m: Optional[float]) -> Path:
    """
    Scale the raw (unit-less) COLMAP point cloud to metres.

    Strategy
    ────────
    The scale_reference_m value (provided by user at job creation) is the
    *real-world* length (in metres) of a reference object photographed.

    The user must also provide the reconstructed length of that same object
    measured in the raw PLY — OR we auto-estimate it as the approximate extent
    of the largest axis of the bounding box vs. expected room dimensions.

    For the MVP we use a simpler heuristic: COLMAP's unit is arbitrary, so we
    apply a scale factor derived by asking the user to measure one reference
    edge in the raw cloud.  The scale factor is stored in job metadata.

    If scale_reference_m is None (LiDAR tier), the cloud is returned as-is.
    """
    pcd = o3d.io.read_point_cloud(str(raw_ply))
    points = np.asarray(pcd.points)

    if scale_reference_m is None:
        # LiDAR: already metric
        scale_factor = 1.0
        confidence = "native_metric"
    else:
        # Estimate the reconstructed length of the reference object:
        # We pick the bounding-box diagonal as a proxy for the reconstructed scale.
        # In a proper implementation, the user marks two points in the viewer.
        # For the MVP: assume the bounding-box longest axis ≈ the room longest wall,
        # which should be ~4-6 m for a typical indoor room.
        # The actual scale anchoring UI (in the iOS app) will send the measured
        # reconstructed_reference_length_units value; hardcode 1.0 here as placeholder.
        reconstructed_ref_units = 1.0   # PLACEHOLDER — replaced by iOS measurement UI
        scale_factor = scale_reference_m / reconstructed_ref_units
        confidence = "scaled_via_reference"

    scaled_points = points * scale_factor
    pcd.points = o3d.utility.Vector3dVector(scaled_points)

    results_dir = get_results_dir(job_id)
    out = results_dir / "scan_metric.ply"
    o3d.io.write_point_cloud(str(out), pcd)

    log.info("scale_applied", job_id=job_id, scale_factor=scale_factor, confidence=confidence)
    return out


# ── Subprocess helper ─────────────────────────────────────────────────────────
def _run_cmd(cmd: list[str], name: str):
    log.info("subprocess_start", name=name, cmd=" ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        log.error("subprocess_failed", name=name, stderr=result.stderr[-2000:])
        raise RuntimeError(f"{name} failed (exit {result.returncode}):\n{result.stderr[-1000:]}")
    log.info("subprocess_done", name=name)
