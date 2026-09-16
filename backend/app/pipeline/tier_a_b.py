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
    diag=None,
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

    frame_count = _extract_frames(video_path, images_dir, fps=settings.VIDEO_EXTRACT_FPS)
    progress_cb("extracting_frames", 20)

    if diag is not None:
        diag.set_metric("video_path", str(video_path))
        diag.set_metric("video_extract_fps", settings.VIDEO_EXTRACT_FPS)
        diag.set_metric("frames_extracted", frame_count)

    # Continue with same COLMAP flow as photo tier
    return _run_colmap_pipeline(job_id, scale_reference_m, progress_cb, diag)


# ── Tier A entry point ────────────────────────────────────────────────────────
def run_photo_tier(
    job_id: str,
    scale_reference_m: Optional[float],
    progress_cb: ProgressCb,
    diag=None,
) -> Path:
    """Run COLMAP directly on the uploaded images."""
    return _run_colmap_pipeline(job_id, scale_reference_m, progress_cb, diag)


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
def _get_colmap_major_version() -> int:
    try:
        res = subprocess.run([settings.COLMAP_BIN, "version"], capture_output=True, text=True)
        out = (res.stdout or "") + (res.stderr or "")
        import re
        m = re.search(r"COLMAP\s+(\d+)\.", out)
        if m:
            return int(m.group(1))
    except Exception:
        pass
    return 3


def _is_cuda_available() -> bool:
    import platform
    if platform.system() == "Darwin":
        # macOS lacks NVIDIA CUDA support; COLMAP runs in CPU mode
        return False
    try:
        res = subprocess.run([settings.COLMAP_BIN, "version"], capture_output=True, text=True)
        out = (res.stdout or "") + (res.stderr or "")
        if "without GPU support" in out:
            return False
        res = subprocess.run([settings.COLMAP_BIN, "patch_match_stereo", "--help"], capture_output=True, text=True)
        return res.returncode == 0
    except Exception:
        return False


def _find_sparse_model_dir(sparse_root: Path) -> Optional[Path]:
    if (sparse_root / "cameras.bin").exists() or (sparse_root / "cameras.txt").exists():
        return sparse_root
    if (sparse_root / "0").is_dir():
        if (sparse_root / "0" / "cameras.bin").exists() or (sparse_root / "0" / "cameras.txt").exists():
            return sparse_root / "0"
    for sub in sparse_root.glob("*"):
        if sub.is_dir() and ((sub / "cameras.bin").exists() or (sub / "cameras.txt").exists()):
            return sub
    return None


def _run_colmap_pipeline(
    job_id: str,
    scale_reference_m: Optional[float],
    progress_cb: ProgressCb,
    diag=None,
    single_camera: bool = True,
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
    log.info("colmap_sfm_start", job_id=job_id, single_camera=single_camera)

    has_cuda = _is_cuda_available()

    if diag is not None:
        diag.set_metric("colmap_cuda_available", has_cuda)
        diag.set_metric("colmap_single_camera", single_camera)
        diag.set_metric(
            "input_image_count",
            sum(1 for p in images_dir.iterdir() if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".heic"}),
        )

    sfm_cmd = [
        settings.COLMAP_BIN, "automatic_reconstructor",
        "--workspace_path", str(workspace),
        "--image_path", str(images_dir),
        "--quality", settings.COLMAP_QUALITY,
        "--num_threads", str(settings.COLMAP_NUM_THREADS),
        "--single_camera", "1" if single_camera else "0",
        "--use_gpu", "1" if has_cuda else "0",
        "--sparse", "1",
        "--dense", "1" if has_cuda else "0",
    ]
    _run_cmd(sfm_cmd, "COLMAP SfM")
    progress_cb("colmap_sfm", 50)

    # The automatic_reconstructor places dense output in workspace/dense/
    fused_ply = workspace / "dense" / "fused.ply"

    if diag is not None and fused_ply.exists():
        diag.set_metric("colmap_dense_source", "automatic_dense")

    # If automatic_reconstructor didn't produce dense output (e.g. CPU mode), convert sparse model to PLY
    if not fused_ply.exists():
        sparse_dir = workspace / "sparse"
        sparse_model = _find_sparse_model_dir(sparse_dir)
        if sparse_model is not None:
            dense_dir.mkdir(parents=True, exist_ok=True)
            log.info("converting_sparse_model_to_ply", model_dir=str(sparse_model))
            if diag is not None:
                diag.set_metric("colmap_dense_source", "sparse_model_converted")
                diag.add_warning("COLMAP produced no dense cloud; sparse model was converted to PLY instead.")
            _run_cmd([
                settings.COLMAP_BIN, "model_converter",
                "--input_path", str(sparse_model),
                "--output_path", str(fused_ply),
                "--output_type", "PLY",
            ], "COLMAP Model Converter")

    # If still not found and CUDA is available, run manual sequence
    if not fused_ply.exists():
        if diag is not None:
            diag.set_metric("colmap_dense_source", "manual_dense_sequence")
            diag.add_warning("COLMAP automatic reconstruction produced no PLY; manual dense sequence was used.")
        fused_ply = _run_manual_dense(workspace, images_dir, dense_dir, progress_cb)

    if not fused_ply.exists():
        raise RuntimeError(
            "COLMAP failed to reconstruct a sparse or dense 3D model from the uploaded images. "
            "Please ensure sufficient camera movement, overlap, and proper lighting."
        )

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

    has_cuda = _is_cuda_available()

    colmap_v = _get_colmap_major_version()
    feat_thread_flag = "--FeatureExtraction.num_threads" if colmap_v >= 4 else "--SiftExtraction.num_threads"
    feat_gpu_flag = "--FeatureExtraction.use_gpu" if colmap_v >= 4 else "--SiftExtraction.use_gpu"
    match_thread_flag = "--FeatureMatching.num_threads" if colmap_v >= 4 else "--SiftMatching.num_threads"
    match_gpu_flag = "--FeatureMatching.use_gpu" if colmap_v >= 4 else "--SiftMatching.use_gpu"

    _run_cmd([settings.COLMAP_BIN, "feature_extractor",
              "--database_path", str(db_path),
              "--image_path", str(images_dir),
              "--ImageReader.single_camera", "1",
              feat_thread_flag, str(settings.COLMAP_NUM_THREADS),
              feat_gpu_flag, "1" if has_cuda else "0"], "feature_extractor")

    _run_cmd([settings.COLMAP_BIN, "exhaustive_matcher",
              "--database_path", str(db_path),
              match_thread_flag, str(settings.COLMAP_NUM_THREADS),
              match_gpu_flag, "1" if has_cuda else "0"], "exhaustive_matcher")

    _run_cmd([settings.COLMAP_BIN, "mapper",
              "--database_path", str(db_path),
              "--image_path", str(images_dir),
              "--output_path", str(sparse_dir),
              "--Mapper.num_threads", str(settings.COLMAP_NUM_THREADS)], "mapper")

    progress_cb("colmap_mvs", 55)

    fused_ply = dense_dir / "fused.ply"
    if not has_cuda:
        sparse_model = _find_sparse_model_dir(sparse_dir)
        if sparse_model:
            _run_cmd([
                settings.COLMAP_BIN, "model_converter",
                "--input_path", str(sparse_model),
                "--output_path", str(fused_ply),
                "--output_type", "PLY",
            ], "model_converter")
            return fused_ply

    _run_cmd([settings.COLMAP_BIN, "image_undistorter",
              "--image_path", str(images_dir),
              "--input_path", str(sparse_dir / "0"),
              "--output_path", str(dense_dir),
              "--output_type", "COLMAP"], "image_undistorter")

    _run_cmd([settings.COLMAP_BIN, "patch_match_stereo",
              "--workspace_path", str(dense_dir)], "patch_match_stereo")

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
        # Unscaled / relative SfM units
        scale_factor = 1.0
        confidence = "unscaled"
    else:
        # User supplied a reference measurement
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
