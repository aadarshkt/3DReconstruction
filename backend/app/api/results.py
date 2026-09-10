"""
Results delivery endpoints.

Endpoints
─────────
GET /jobs/{job_id}/results          → structured JSON result summary
GET /jobs/{job_id}/files/{filename} → download a specific output file
"""
from pathlib import Path

import structlog
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_results_dir, get_job_dir
from app.models.job import Job, JobStatus
from app.main import get_db

log = structlog.get_logger()
router = APIRouter()


# ── Schemas ────────────────────────────────────────────────────────────────────
class ResultFilesSchema(BaseModel):
    floor_plan_dxf: str | None = None
    floor_plan_svg: str | None = None
    point_cloud_ply: str | None = None
    validation_csv: str | None = None


class WallSchema(BaseModel):
    id: int
    length_m: float
    start: list[float]
    end: list[float]
    has_opening: bool
    opening_type: str | None   # "door" | "window" | None


class ErrorEstimateSchema(BaseModel):
    method: str
    expected_wall_error_cm: float


class JobResultResponse(BaseModel):
    job_id: str
    status: JobStatus
    tier: str
    scale_confidence: str | None
    room_area_m2: float | None
    wall_count: int | None
    walls: list[WallSchema]
    error_estimate: ErrorEstimateSchema | None
    files: ResultFilesSchema


# ── Routes ─────────────────────────────────────────────────────────────────────
@router.get("/{job_id}/results", response_model=JobResultResponse)
async def get_results(job_id: str, db: AsyncSession = Depends(get_db)):
    """
    Return the full structured result for a completed job.

    File URLs in the `files` block can be fetched via GET /jobs/{id}/files/{filename}.
    """
    job = await _get_or_404(job_id, db)

    if job.status != JobStatus.complete:
        raise HTTPException(
            status_code=425,
            detail=f"Job is not yet complete (status={job.status!r}). Poll /jobs/{job_id} or connect to WS.",
        )

    payload = job.result_payload or {}
    walls_raw = payload.get("walls", [])
    error_raw = payload.get("error_estimate")
    files_raw = payload.get("files", {})

    # Convert relative paths to download URLs
    files_urls = {
        k: f"/jobs/{job_id}/files/{Path(v).name}"
        for k, v in files_raw.items()
        if v
    }

    return JobResultResponse(
        job_id=job_id,
        status=job.status,
        tier=str(job.tier),
        scale_confidence=payload.get("scale_confidence"),
        room_area_m2=job.room_area_m2,
        wall_count=job.wall_count,
        walls=[WallSchema(**w) for w in walls_raw],
        error_estimate=ErrorEstimateSchema(**error_raw) if error_raw else None,
        files=ResultFilesSchema(**files_urls),
    )


@router.get("/{job_id}/files/{filename}")
async def download_file(job_id: str, filename: str, db: AsyncSession = Depends(get_db)):
    """
    Stream a specific output file (DXF / SVG / PLY / CSV).

    Content-Disposition is set so the file is downloaded with the correct name.
    """
    await _get_or_404(job_id, db)

    # Restrict to the job's results directory only (prevent traversal)
    results_dir = get_results_dir(job_id)
    target = (results_dir / filename).resolve()

    if not str(target).startswith(str(results_dir.resolve())):
        raise HTTPException(status_code=400, detail="Invalid filename.")

    if not target.exists():
        raise HTTPException(status_code=404, detail=f"File {filename!r} not found for job {job_id!r}.")

    media_type_map = {
        ".dxf": "application/dxf",
        ".svg": "image/svg+xml",
        ".ply": "application/octet-stream",
        ".csv": "text/csv",
        ".json": "application/json",
    }
    media_type = media_type_map.get(target.suffix, "application/octet-stream")

    return FileResponse(
        path=str(target),
        media_type=media_type,
        filename=filename,
        content_disposition_type="inline" if target.suffix in (".svg", ".json", ".csv") else "attachment",
    )


# ── Helper ─────────────────────────────────────────────────────────────────────
async def _get_or_404(job_id: str, db: AsyncSession) -> Job:
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id!r} not found.")
    return job
