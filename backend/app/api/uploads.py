"""
File upload endpoints.

Endpoints
─────────
POST /jobs/{job_id}/upload          → upload one or many files at once
POST /jobs/{job_id}/upload/chunk    → upload a single chunk (large files)
POST /jobs/{job_id}/start           → trigger pipeline processing
"""
import base64
import hashlib
import shutil
from pathlib import Path
from typing import List, Optional

from datetime import datetime, timezone
import aiofiles
import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger()
router = APIRouter()

from app.config import settings, get_images_dir, get_job_dir
from app.models.job import Job, JobStatus, Tier
from app.models.claim import Claim, ClaimStatus
from app.core.security import get_optional_user, AuthenticatedUser
from app.main import get_db
from app.tasks.celery_tasks import run_pipeline

# ── Schemas ────────────────────────────────────────────────────────────────────
class ChunkUploadRequest(BaseModel):
    filename: str
    chunk_index: int
    total_chunks: int
    data_base64: str   # raw bytes encoded as base64


class StartJobResponse(BaseModel):
    job_id: str
    celery_task_id: str
    message: str


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".webp", ".bmp", ".tiff"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".m4v"}
LIDAR_EXTS = {".usdz", ".ply", ".json", ".las", ".laz", ".e57"}


def _classify_filename(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext in IMAGE_EXTS:
        return "image"
    if ext in VIDEO_EXTS:
        return "video"
    if ext in LIDAR_EXTS:
        return "lidar"
    return "other"


async def _save_single_file(job_id: str, upload: UploadFile) -> tuple[str, str]:
    """Save upload to appropriate directory based on file extension and return (dest_path, modality)."""
    safe_name = _safe_filename(upload.filename or "file")
    modality = _classify_filename(safe_name)

    if modality in ("image", "video"):
        dest_dir = get_images_dir(job_id)
    else:
        dest_dir = get_job_dir(job_id)

    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / safe_name
    async with aiofiles.open(dest, "wb") as f:
        while chunk := await upload.read(1024 * 1024):  # 1 MB buffer
            await f.write(chunk)

    # For videos, also copy to job_dir if required by tier_router / tier_a_b
    if modality == "video":
        video_in_job_dir = get_job_dir(job_id) / safe_name
        if not video_in_job_dir.exists():
            try:
                shutil.copyfile(dest, video_in_job_dir)
            except Exception:
                pass

    log.info("file_saved", job_id=job_id, path=str(dest), modality=modality)
    return str(dest), modality


# ── Upload: all-at-once (multi-modal support) ──────────────────────────────────
@router.post("/{job_id}/upload", status_code=200)
async def upload_files(
    job_id: str,
    files: List[UploadFile] = File(..., description="One or more files to upload (photos, video, and/or LiDAR)"),
    tier: Optional[str] = Form(None, description="Optional tier override (photos|video|lidar|hybrid)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload files for a job in a single multipart request.
    Supports multi-modal files simultaneously:
    - Photos (.jpg, .png, .heic)
    - Video (.mp4, .mov)
    - LiDAR (.usdz, .ply, .json)

    If both visual media and LiDAR files are uploaded, the job is auto-promoted to 'hybrid'.
    """
    job = await _get_or_404(job_id, db)
    _assert_uploadable(job)

    saved: list[str] = []
    modalities_seen: set[str] = set()

    for upload in files:
        dest_str, mod = await _save_single_file(job_id, upload)
        saved.append(dest_str)
        modalities_seen.add(mod)

    # Determine / auto-promote tier
    has_visual = bool(modalities_seen.intersection({"image", "video"}))
    has_lidar = "lidar" in modalities_seen

    if tier and tier in [t.value for t in Tier]:
        job.tier = Tier(tier)
    elif has_visual and has_lidar:
        job.tier = Tier.hybrid
    elif has_lidar and not has_visual:
        job.tier = Tier.lidar
    elif "video" in modalities_seen and "image" not in modalities_seen:
        job.tier = Tier.video
    elif "image" in modalities_seen:
        job.tier = Tier.photos

    job.status = JobStatus.uploading
    await db.commit()
    await db.refresh(job)

    return {
        "job_id": job_id,
        "tier": job.tier.value,
        "saved_files": saved,
        "count": len(saved),
        "modalities": list(modalities_seen),
    }


# ── Unified: Create Job + Upload Files in 1 call ──────────────────────────────
@router.post("/create-and-upload", status_code=201)
async def create_and_upload(
    files: List[UploadFile] = File(..., description="One or more capture files"),
    scale_reference_m: Optional[str] = Form(None, description="Optional scale reference length in metres"),
    auto_start: bool = Form(False, description="Whether to enqueue reconstruction immediately"),
    claim_id: Optional[str] = Form(None, description="Optional active claim/execution ID to link"),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[AuthenticatedUser] = Depends(get_optional_user),
):
    """
    Unified multi-modal endpoint:
    1. Creates a new Job (linked to user_id)
    2. Ingests all uploaded files (photos, video, LiDAR)
    3. Auto-determines Tier (photos, video, lidar, or hybrid)
    4. Auto-creates or links to an Execution/Claim record
    5. Optionally starts pipeline immediately
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    parsed_scale_ref: Optional[float] = None
    if scale_reference_m is not None and str(scale_reference_m).strip():
        try:
            val = float(str(scale_reference_m).strip())
            if 0.01 <= val <= 100.0:
                parsed_scale_ref = val
        except (ValueError, TypeError):
            parsed_scale_ref = None

    user_id = current_user.id if current_user else None

    # Create placeholder job
    job = Job(tier=Tier.photos, scale_reference_m=parsed_scale_ref, user_id=user_id)
    db.add(job)
    await db.commit()
    await db.refresh(job)

    saved: list[str] = []
    modalities_seen: set[str] = set()

    for upload in files:
        dest_str, mod = await _save_single_file(job.id, upload)
        saved.append(dest_str)
        modalities_seen.add(mod)

    # Auto-resolve tier
    has_visual = bool(modalities_seen.intersection({"image", "video"}))
    has_lidar = "lidar" in modalities_seen

    if has_visual and has_lidar:
        job.tier = Tier.hybrid
    elif has_lidar:
        job.tier = Tier.lidar
    elif "video" in modalities_seen:
        job.tier = Tier.video
    else:
        job.tier = Tier.photos

    job.status = JobStatus.uploading
    await db.commit()
    await db.refresh(job)

    # Link or auto-create Claim / Execution
    claim = None
    if claim_id:
        claim = await db.get(Claim, claim_id)
        if claim:
            claim.job_id = job.id
            if not claim.user_id and user_id:
                claim.user_id = user_id

    if not claim:
        modality_title = job.tier.value.capitalize()
        now_str = datetime.now(timezone.utc).strftime("%b %d, %Y")
        claim = Claim(
            job_id=job.id,
            user_id=user_id,
            title=f"{modality_title} Spatial Capture · {now_str}",
            status=ClaimStatus.created,
            property_type="residential",
            cause_of_loss="water",
        )
        db.add(claim)

    await db.commit()
    await db.refresh(claim)

    celery_task_id = None
    if auto_start:
        task = run_pipeline.delay(job.id)
        job.celery_task_id = task.id
        job.status = JobStatus.queued
        await db.commit()
        await db.refresh(job)
        celery_task_id = task.id

    return {
        "job_id": job.id,
        "claim_id": claim.id,
        "execution_id": claim.id,
        "title": claim.title,
        "tier": job.tier.value,
        "status": job.status.value,
        "saved_files": saved,
        "count": len(saved),
        "modalities": list(modalities_seen),
        "celery_task_id": celery_task_id,
    }


# ── Upload: chunked (large videos / dense photo sets) ─────────────────────────
@router.post("/{job_id}/upload/chunk", status_code=200)
async def upload_chunk(
    job_id: str,
    body: ChunkUploadRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a single 5 MB chunk of a large file.

    The client splits the file into chunks and calls this endpoint once per
    chunk.  After all chunks arrive, the backend assembles the file.

    chunk_index is 0-based.  The backend assembles the complete file once
    chunk_index == total_chunks - 1.
    """
    job = await _get_or_404(job_id, db)
    _assert_uploadable(job)

    tmp_dir = get_job_dir(job_id) / "tmp_chunks" / _safe_filename(body.filename)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    chunk_path = tmp_dir / f"{body.chunk_index:06d}.bin"
    data = base64.b64decode(body.data_base64)
    async with aiofiles.open(chunk_path, "wb") as f:
        await f.write(data)

    log.info("chunk_received", job_id=job_id, filename=body.filename,
             chunk=body.chunk_index, total=body.total_chunks)

    # If this is the last chunk, assemble the file
    if body.chunk_index == body.total_chunks - 1:
        await _assemble_chunks(job_id, body.filename, tmp_dir, body.total_chunks)
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return {"job_id": job_id, "assembled": True, "filename": body.filename}

    return {"job_id": job_id, "assembled": False,
            "chunk_index": body.chunk_index, "total_chunks": body.total_chunks}


async def _assemble_chunks(job_id: str, filename: str, tmp_dir: Path, total: int):
    """Concatenate numbered .bin chunks into the final file."""
    dest_dir = get_images_dir(job_id)
    dest = dest_dir / _safe_filename(filename)
    async with aiofiles.open(dest, "wb") as out:
        for i in range(total):
            chunk_path = tmp_dir / f"{i:06d}.bin"
            async with aiofiles.open(chunk_path, "rb") as chunk:
                await out.write(await chunk.read())
    log.info("file_assembled", job_id=job_id, dest=str(dest))


# ── Start: enqueue Celery task ─────────────────────────────────────────────────
class StartJobRequest(BaseModel):
    scale_reference_m: Optional[float] = None


@router.post("/{job_id}/start", response_model=StartJobResponse)
async def start_job(
    job_id: str,
    body: Optional[StartJobRequest] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Enqueue the pipeline processing task.

    Must be called after all uploads are complete.
    Returns the Celery task ID for optional task-level tracking.
    """
    job = await _get_or_404(job_id, db)

    if job.status not in (JobStatus.uploading, JobStatus.created):
        raise HTTPException(
            status_code=409,
            detail=f"Job is in state {job.status!r} — can only start from 'uploading' or 'created'.",
        )

    if body and body.scale_reference_m is not None and body.scale_reference_m > 0:
        job.scale_reference_m = body.scale_reference_m

    # Enqueue Celery task
    task = run_pipeline.delay(job_id)
    job.celery_task_id = task.id
    job.status = JobStatus.queued
    await db.commit()

    log.info("job_queued", job_id=job_id, celery_task_id=task.id, scale_reference_m=job.scale_reference_m)
    return StartJobResponse(
        job_id=job_id,
        celery_task_id=task.id,
        message="Pipeline enqueued. Connect to /jobs/{job_id}/ws for real-time progress.",
    )


# ── Helpers ────────────────────────────────────────────────────────────────────
async def _get_or_404(job_id: str, db: AsyncSession) -> Job:
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id!r} not found.")
    return job


def _assert_uploadable(job: Job):
    if job.status in (JobStatus.complete, JobStatus.failed):
        raise HTTPException(
            status_code=409,
            detail=f"Job {job.id!r} is {job.status!r} — uploads no longer accepted.",
        )


def _safe_filename(name: str) -> str:
    """Strip path traversal attempts from an uploaded filename."""
    return Path(name).name
