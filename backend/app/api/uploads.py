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

import aiofiles
import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings, get_images_dir, get_job_dir
from app.models.job import Job, JobStatus, Tier
from app.main import get_db
from app.tasks.celery_tasks import run_pipeline

log = structlog.get_logger()
router = APIRouter()

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


# ── Upload: all-at-once (photos / small video / USDZ) ─────────────────────────
@router.post("/{job_id}/upload", status_code=200)
async def upload_files(
    job_id: str,
    files: List[UploadFile] = File(..., description="One or more files to upload"),
    tier: Optional[str] = Form(None, description="Override tier (photos|video|lidar)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload files for a job in a single multipart request.

    - **Tier A (photos)**: send all JPEGs as multiple `files` parts.
    - **Tier B (video)**:  send a single MP4 as one `files` part.
    - **Tier C (LiDAR)**:  send the `.usdz` or RoomPlan JSON as one `files` part.
    """
    job = await _get_or_404(job_id, db)
    _assert_uploadable(job)

    dest_dir = get_images_dir(job_id) if job.tier in (Tier.photos, Tier.video) else get_job_dir(job_id)
    saved: list[str] = []

    for upload in files:
        safe_name = _safe_filename(upload.filename or "file")
        dest = dest_dir / safe_name
        async with aiofiles.open(dest, "wb") as f:
            while chunk := await upload.read(1024 * 1024):  # 1 MB read buffer
                await f.write(chunk)
        saved.append(str(dest))
        log.info("file_saved", job_id=job_id, path=str(dest))

    job.status = JobStatus.uploading
    await db.commit()

    return {"job_id": job_id, "saved_files": saved, "count": len(saved)}


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
@router.post("/{job_id}/start", response_model=StartJobResponse)
async def start_job(job_id: str, db: AsyncSession = Depends(get_db)):
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

    # Enqueue Celery task
    task = run_pipeline.delay(job_id)
    job.celery_task_id = task.id
    job.status = JobStatus.queued
    await db.commit()

    log.info("job_queued", job_id=job_id, celery_task_id=task.id)
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
