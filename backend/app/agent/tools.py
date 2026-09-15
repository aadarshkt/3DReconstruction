"""
Agent tools — small synchronous helpers that drive the existing reconstruction
pipeline. These mirror the HTTP upload/start flow but call backend internals
directly so the agent does not need to self-call the API.

Uses a synchronous SQLAlchemy session (psycopg2), matching the Celery worker
pattern in `app/tasks/celery_tasks.py`.
"""
import shutil
from pathlib import Path

import structlog
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from app.config import settings, get_claim_inputs_dir, get_images_dir, get_job_dir
from app.models.job import Job, Tier

log = structlog.get_logger()

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".heic"}
VIDEO_EXTS = {".mp4", ".mov"}
LIDAR_EXTS = {".json", ".usdz", ".ply", ".obj"}

_engine = create_engine(settings.DATABASE_SYNC_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=_engine)


def _session() -> Session:
    return SessionLocal()


def get_claim_input_files(claim_id: str) -> list[Path]:
    """List uploaded capture files for a claim."""
    inputs_dir = get_claim_inputs_dir(claim_id)
    if not inputs_dir.exists():
        return []
    return sorted(p for p in inputs_dir.iterdir() if p.is_file())


# ── Tier detection ─────────────────────────────────────────────────────────────
def determine_tier(files: list[Path]) -> Tier:
    """
    Infer the reconstruction tier from the claim's uploaded file extensions.

    Mirrors the hybrid dispatch in `app/pipeline/tier_router.py`.
    """
    suffixes = {f.suffix.lower() for f in files}
    has_lidar = bool(suffixes & LIDAR_EXTS)
    has_video = bool(suffixes & VIDEO_EXTS)
    has_photos = bool(suffixes & IMAGE_EXTS)

    if has_lidar and (has_video or has_photos):
        return Tier.hybrid
    if has_lidar:
        return Tier.lidar
    if has_video:
        return Tier.video
    if has_photos:
        return Tier.photos

    raise ValueError(
        "No supported capture files found. Expected photos (.jpg/.png), "
        "video (.mp4/.mov), or LiDAR (.json/.usdz/.ply/.obj)."
    )


# ── Job lifecycle ──────────────────────────────────────────────────────────────
def create_reconstruction_job(tier: Tier, scale_reference_m: float | None = None) -> str:
    """Create a `Job` record and return its id."""
    db = _session()
    try:
        job = Job(tier=tier, scale_reference_m=scale_reference_m)
        db.add(job)
        db.commit()
        db.refresh(job)
        return job.id
    finally:
        db.close()


def move_claim_files_to_job(claim_id: str, job_id: str) -> list[Path]:
    """
    Copy claim uploads into the job's expected input directories.

    - Photos / video → `get_images_dir(job_id)`
    - LiDAR (JSON/USDZ/PLY/OBJ) → `get_job_dir(job_id)`
    """
    inputs_dir = get_claim_inputs_dir(claim_id)
    files = sorted(inputs_dir.iterdir()) if inputs_dir.exists() else []
    if not files:
        raise ValueError(f"Claim {claim_id!r} has no uploaded files.")

    dests: list[Path] = []
    for src in files:
        if not src.is_file():
            continue
        suffix = src.suffix.lower()
        dest_dir = get_job_dir(job_id) if suffix in LIDAR_EXTS else get_images_dir(job_id)
        dest = dest_dir / src.name
        shutil.copy2(src, dest)
        dests.append(dest)

    log.info("claim_files_moved", claim_id=claim_id, job_id=job_id, count=len(dests))
    return dests


def get_job_record(job_id: str) -> Job | None:
    db = _session()
    try:
        return db.query(Job).filter(Job.id == job_id).first()
    finally:
        db.close()


# ── Imagery for LLM assessment ────────────────────────────────────────────────
def collect_imagery(job_id: str, limit: int = 8) -> list[str]:
    """
    Return image file paths (uploaded photos or ffmpeg-extracted frames) that
    the LLM can visually assess. LiDAR-only jobs return an empty list.
    """
    images_dir = get_images_dir(job_id)
    if not images_dir.exists():
        return []

    paths: list[str] = []
    for ext in IMAGE_EXTS:
        paths.extend(str(p) for p in sorted(images_dir.glob(f"*{ext}")))
    return paths[:limit]
