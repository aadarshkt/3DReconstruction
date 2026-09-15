"""
Insurance claim endpoints.

Endpoints
─────────
POST   /claims/create           → create a claim, return claim_id
POST   /claims/{id}/upload      → upload capture files for the claim
POST   /claims/{id}/start       → enqueue the claim agent (reconstruction + assessment)
GET    /claims/{id}             → claim status + metadata
GET    /claims/{id}/report      → generated claim report (Markdown + assessment)
DELETE /claims/{id}             → cancel / delete a claim
"""
import json
from pathlib import Path
from typing import List, Optional

import aiofiles
import structlog
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_claim_inputs_dir, get_images_dir, get_job_report_dir
from app.models.claim import Claim, ClaimStatus
from app.main import get_db

log = structlog.get_logger()
router = APIRouter()

# ── Schemas ────────────────────────────────────────────────────────────────────
class CreateClaimRequest(BaseModel):
    policyholder_name: str
    policy_number: str
    property_address: str
    incident_type: str
    incident_description: Optional[str] = None
    scale_reference_m: Optional[float] = Field(
        None,
        gt=0,
        description=(
            "Real-world reference length in metres for photo/video reconstruction. "
            "Optional; omit for LiDAR-only claims."
        ),
    )


class ClaimResponse(BaseModel):
    claim_id: str
    status: ClaimStatus
    progress_pct: int
    policyholder_name: str
    policy_number: str
    property_address: str
    incident_type: str
    incident_description: Optional[str]
    scale_reference_m: Optional[float]
    job_id: Optional[str]
    image_count: Optional[int]
    damage_assessment: Optional[dict]
    report_path: Optional[str]
    error_message: Optional[str]


class StartClaimResponse(BaseModel):
    claim_id: str
    celery_task_id: str
    message: str


class ClaimReportResponse(BaseModel):
    claim_id: str
    status: ClaimStatus
    report_markdown: str
    damage_assessment: Optional[dict]


class ClaimObservabilityResponse(BaseModel):
    claim_id: str
    job_id: Optional[str]
    status: ClaimStatus
    observability_markdown: str


# ── Routes ─────────────────────────────────────────────────────────────────────
@router.post("/create", response_model=ClaimResponse, status_code=201)
async def create_claim(body: CreateClaimRequest, db: AsyncSession = Depends(get_db)):
    """
    Create a new insurance claim.

    The client then uploads capture files via POST /claims/{claim_id}/upload,
    then triggers the agent with POST /claims/{claim_id}/start.
    """
    claim = Claim(
        policyholder_name=body.policyholder_name,
        policy_number=body.policy_number,
        property_address=body.property_address,
        incident_type=body.incident_type,
        incident_description=body.incident_description,
        scale_reference_m=body.scale_reference_m,
    )
    db.add(claim)
    await db.commit()
    await db.refresh(claim)

    log.info("claim_created", claim_id=claim.id)
    return _to_response(claim)


@router.post("/{claim_id}/upload", status_code=200)
async def upload_claim_files(
    claim_id: str,
    files: List[UploadFile] = File(..., description="Capture files (photos / video / LiDAR)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload capture files for a claim. Photos/video/LiDAR are all accepted;
    the agent determines the reconstruction tier from the file extensions.
    """
    claim = await _get_or_404(claim_id, db)

    if claim.status in (ClaimStatus.failed, ClaimStatus.submitted):
        raise HTTPException(status_code=409, detail=f"Claim {claim_id!r} no longer accepts uploads.")

    inputs_dir = get_claim_inputs_dir(claim_id)
    saved: list[str] = []

    for upload in files:
        safe_name = _safe_filename(upload.filename or "file")
        dest = inputs_dir / safe_name
        async with aiofiles.open(dest, "wb") as f:
            while chunk := await upload.read(1024 * 1024):
                await f.write(chunk)
        saved.append(str(dest))

    claim.status = ClaimStatus.collecting
    await db.commit()

    log.info("claim_files_saved", claim_id=claim_id, count=len(saved))
    return {"claim_id": claim_id, "saved_files": saved, "count": len(saved)}


@router.post("/{claim_id}/start", response_model=StartClaimResponse)
async def start_claim(claim_id: str, db: AsyncSession = Depends(get_db)):
    """
    Enqueue the claim agent (reconstruction → damage assessment → report).
    """
    claim = await _get_or_404(claim_id, db)

    if claim.status != ClaimStatus.collecting:
        raise HTTPException(
            status_code=409,
            detail=f"Claim is in state {claim.status!r} — upload files before starting.",
        )

    # Lazy import to avoid a hard dependency at module load time
    from app.tasks.celery_tasks import process_claim

    task = process_claim.delay(claim_id)
    claim.status = ClaimStatus.collecting
    await db.commit()

    log.info("claim_queued", claim_id=claim_id, celery_task_id=task.id)
    return StartClaimResponse(
        claim_id=claim_id,
        celery_task_id=task.id,
        message="Claim agent enqueued. Poll GET /claims/{claim_id} for progress.",
    )


@router.get("/{claim_id}", response_model=ClaimResponse)
async def get_claim(claim_id: str, db: AsyncSession = Depends(get_db)):
    claim = await _get_or_404(claim_id, db)
    return _to_response(claim)


@router.get("/{claim_id}/report", response_model=ClaimReportResponse)
async def get_claim_report(claim_id: str, db: AsyncSession = Depends(get_db)):
    claim = await _get_or_404(claim_id, db)

    if not claim.job_id:
        raise HTTPException(status_code=425, detail="Claim report is not available yet.")

    report_dir = get_job_report_dir(claim.job_id)
    report_path = report_dir / "claim_report.md"
    assessment_path = report_dir / "damage_assessment.json"

    if not report_path.exists():
        raise HTTPException(status_code=425, detail="Claim report is not available yet.")

    markdown = report_path.read_text()
    assessment = None
    if assessment_path.exists():
        try:
            assessment = json.loads(assessment_path.read_text())
        except json.JSONDecodeError:
            assessment = None

    return ClaimReportResponse(
        claim_id=claim_id,
        status=claim.status,
        report_markdown=markdown,
        damage_assessment=assessment or claim.damage_assessment,
    )


@router.get("/{claim_id}/observability", response_model=ClaimObservabilityResponse)
async def get_claim_observability(claim_id: str, db: AsyncSession = Depends(get_db)):
    claim = await _get_or_404(claim_id, db)

    if not claim.job_id:
        raise HTTPException(status_code=425, detail="Observability report is not available yet.")

    obs_path = get_job_report_dir(claim.job_id) / "observability_report.md"
    if not obs_path.exists():
        raise HTTPException(status_code=425, detail="Observability report is not available yet.")

    return ClaimObservabilityResponse(
        claim_id=claim_id,
        job_id=claim.job_id,
        status=claim.status,
        observability_markdown=obs_path.read_text(),
    )


@router.delete("/{claim_id}", status_code=204)
async def delete_claim(claim_id: str, db: AsyncSession = Depends(get_db)):
    claim = await _get_or_404(claim_id, db)
    await db.delete(claim)
    await db.commit()


# ── Helpers ────────────────────────────────────────────────────────────────────
async def _get_or_404(claim_id: str, db: AsyncSession) -> Claim:
    result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = result.scalar_one_or_none()
    if claim is None:
        raise HTTPException(status_code=404, detail=f"Claim {claim_id!r} not found.")
    return claim


def _to_response(claim: Claim) -> ClaimResponse:
    if claim.job_id:
        image_count = _count_images(get_images_dir(claim.job_id))
    else:
        image_count = _count_images(get_claim_inputs_dir(claim.id))

    return ClaimResponse(
        claim_id=claim.id,
        status=claim.status,
        progress_pct=claim.progress_pct,
        policyholder_name=claim.policyholder_name,
        policy_number=claim.policy_number,
        property_address=claim.property_address,
        incident_type=claim.incident_type,
        incident_description=claim.incident_description,
        scale_reference_m=claim.scale_reference_m,
        job_id=claim.job_id,
        image_count=image_count,
        damage_assessment=claim.damage_assessment,
        report_path=claim.report_path,
        error_message=claim.error_message,
    )


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".heic"}


def _count_images(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(
        1 for p in path.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    )


def _safe_filename(name: str) -> str:
    return Path(name).name
