"""
FastAPI endpoints for Saved Executions and Full Session Lifecycle.
Unifies 3D Spatial Reconstruction (Job), Policy RAG (Claim), and
Itemized Cost Estimation into a single persistent Execution entity.
"""
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional
import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_claim_dir, get_job_dir, get_results_dir, settings
from app.core.database import get_db
from app.core.security import AuthenticatedUser, get_optional_user
from app.models.claim import Claim, ClaimStatus
from app.models.job import Job, JobStatus
from app.pipeline.report_generator import generate_execution_pdf

log = structlog.get_logger()
router = APIRouter()


# ── Schemas ────────────────────────────────────────────────────────────────────
class ExecutionSummaryResponse(BaseModel):
    id: str
    title: str
    status: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    job_id: Optional[str] = None
    tier: Optional[str] = None
    room_area_m2: Optional[float] = None
    wall_count: Optional[int] = None
    cause_of_loss: Optional[str] = None
    property_type: Optional[str] = None
    has_policy_pdf: bool = False
    policy_pdf_filename: Optional[str] = None
    is_covered: Optional[bool] = None
    total_estimated_cost: Optional[float] = None
    has_report_pdf: bool = False
    report_url: Optional[str] = None


class ExecutionUpdateRequest(BaseModel):
    title: Optional[str] = Field(None, description="Custom name for the execution run")
    damage_description: Optional[str] = None
    cause_of_loss: Optional[str] = None
    property_type: Optional[str] = None
    date_of_loss: Optional[str] = None
    policy_number: Optional[str] = None
    insurer_name: Optional[str] = None


class ExecutionCreateRequest(BaseModel):
    title: Optional[str] = Field(None, description="Optional title (auto-generated if omitted)")
    job_id: Optional[str] = Field(None, description="Optional associated 3D job ID")
    property_type: str = "residential"
    cause_of_loss: str = "water"
    damage_description: str = ""


class ExecutionDetailResponse(BaseModel):
    id: str
    title: str
    status: str
    user_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    job_id: Optional[str] = None
    job: Optional[dict[str, Any]] = None
    claim: dict[str, Any]
    policy_analysis: Optional[dict[str, Any]] = None
    cost_estimate: Optional[dict[str, Any]] = None
    total_estimated_cost: Optional[float] = None
    report_url: Optional[str] = None
    policy_pdf_url: Optional[str] = None


# ── Helpers ────────────────────────────────────────────────────────────────────
def _derive_title(claim: Claim, job: Optional[Job]) -> str:
    if claim.title and claim.title.strip():
        return claim.title.strip()
    peril = (claim.cause_of_loss or "Water").capitalize()
    prop = (claim.property_type or "Residential").capitalize()
    area_str = f" · {job.room_area_m2:.1f} m²" if job and job.room_area_m2 else ""
    return f"{prop} {peril} Damage{area_str}"


def _build_job_dict(job: Optional[Job]) -> Optional[dict[str, Any]]:
    if not job:
        return None
    payload = job.result_payload or {}
    files_urls = {
        k: f"/jobs/{job.id}/files/{Path(v).name}"
        for k, v in payload.get("files", {}).items()
        if v
    }
    # Ensure point_cloud_ply link if file is present
    if "point_cloud_ply" not in files_urls:
        results_dir = get_results_dir(job.id)
        if (results_dir / "scan_metric.ply").exists():
            files_urls["point_cloud_ply"] = f"/jobs/{job.id}/files/scan_metric.ply"
        elif (results_dir / "point_cloud.ply").exists():
            files_urls["point_cloud_ply"] = f"/jobs/{job.id}/files/point_cloud.ply"

    tier_str = job.tier.value if hasattr(job.tier, "value") else str(job.tier)
    status_str = job.status.value if hasattr(job.status, "value") else str(job.status)

    return {
        "id": job.id,
        "tier": tier_str,
        "status": status_str,
        "progress_pct": job.progress_pct,
        "is_demo": bool(job.is_demo),
        "scale_reference_m": job.scale_reference_m,
        "room_area_m2": job.room_area_m2 if job.room_area_m2 is not None else payload.get("room_area_m2"),
        "wall_count": job.wall_count if job.wall_count is not None else payload.get("wall_count"),
        "walls": payload.get("walls", []),
        "error_estimate": payload.get("error_estimate"),
        "scale_confidence": payload.get("scale_confidence"),
        "damage_area_m2": payload.get("damage_area_m2"),
        "files": files_urls,
    }


# ── Endpoints ──────────────────────────────────────────────────────────────────
@router.get("", response_model=List[ExecutionSummaryResponse])
async def list_executions(
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[AuthenticatedUser] = Depends(get_optional_user),
):
    """
    List past executions for the current user, ordered with latest first.
    If authenticated, returns executions matching user_id.
    If guest/dev without user_id, returns recent claims with and without user_id.
    """
    stmt = select(Claim).order_by(Claim.updated_at.desc()).limit(limit)
    if current_user and current_user.id:
        # Show records for this specific user or guest records
        stmt = select(Claim).where(
            (Claim.user_id == current_user.id) | (Claim.user_id.is_(None))
        ).order_by(Claim.updated_at.desc()).limit(limit)

    res = await db.execute(stmt)
    claims = res.scalars().all()

    summaries: List[ExecutionSummaryResponse] = []
    for c in claims:
        job = None
        if c.job_id:
            job = await db.get(Job, c.job_id)

        has_pdf = False
        if c.report_path and Path(c.report_path).exists():
            has_pdf = True
        else:
            claim_dir = get_claim_dir(c.id)
            if (claim_dir / "report.pdf").exists():
                has_pdf = True

        tier_str = None
        if job:
            tier_str = job.tier.value if hasattr(job.tier, "value") else str(job.tier)

        is_cov = None
        if c.policy_analysis and isinstance(c.policy_analysis, dict):
            is_cov = c.policy_analysis.get("is_covered")

        title = _derive_title(c, job)

        summaries.append(
            ExecutionSummaryResponse(
                id=c.id,
                title=title,
                status=c.status.value if hasattr(c.status, "value") else str(c.status),
                created_at=c.created_at.isoformat() if c.created_at else None,
                updated_at=c.updated_at.isoformat() if c.updated_at else None,
                job_id=c.job_id,
                tier=tier_str,
                room_area_m2=job.room_area_m2 if job else None,
                wall_count=job.wall_count if job else None,
                cause_of_loss=c.cause_of_loss,
                property_type=c.property_type,
                has_policy_pdf=bool(c.has_policy_pdf),
                policy_pdf_filename=c.policy_pdf_filename,
                is_covered=is_cov,
                total_estimated_cost=c.total_estimated_cost,
                has_report_pdf=has_pdf,
                report_url=f"/api/v1/executions/{c.id}/pdf",
            )
        )

    return summaries


@router.post("", response_model=ExecutionDetailResponse, status_code=201)
async def create_execution(
    body: Optional[ExecutionCreateRequest] = None,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[AuthenticatedUser] = Depends(get_optional_user),
):
    """
    Explicitly initialize a new execution run for the active user session.
    """
    req = body or ExecutionCreateRequest()
    user_id = current_user.id if current_user else None

    # Check job if provided
    job = None
    if req.job_id:
        job = await db.get(Job, req.job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {req.job_id} not found")

    claim = Claim(
        user_id=user_id,
        job_id=req.job_id,
        title=req.title or f"{req.property_type.capitalize()} {req.cause_of_loss.capitalize()} Damage Assessment",
        property_type=req.property_type,
        cause_of_loss=req.cause_of_loss,
        damage_description=req.damage_description,
        status=ClaimStatus.created,
    )
    db.add(claim)
    await db.commit()
    await db.refresh(claim)

    log.info("execution_created", execution_id=claim.id, user_id=user_id, job_id=req.job_id)

    return ExecutionDetailResponse(
        id=claim.id,
        title=claim.title,
        status=claim.status.value,
        user_id=claim.user_id,
        created_at=claim.created_at.isoformat() if claim.created_at else None,
        updated_at=claim.updated_at.isoformat() if claim.updated_at else None,
        job_id=claim.job_id,
        job=_build_job_dict(job),
        claim=claim.to_dict(),
        policy_analysis=claim.policy_analysis,
        cost_estimate=claim.cost_estimate,
        total_estimated_cost=claim.total_estimated_cost,
        report_url=f"/api/v1/executions/{claim.id}/pdf",
        policy_pdf_url=f"/claims/{claim.id}/policy/file" if claim.has_policy_pdf else None,
    )


@router.get("/{execution_id}", response_model=ExecutionDetailResponse)
async def get_execution(
    execution_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Fetch the complete, bundled execution record:
    Reconstruction metrics, 2D/3D assets, policy analysis, and cost estimate.
    """
    claim = await db.get(Claim, execution_id)
    if not claim:
        raise HTTPException(status_code=404, detail=f"Execution {execution_id!r} not found.")

    job = None
    if claim.job_id:
        job = await db.get(Job, claim.job_id)

    title = _derive_title(claim, job)

    return ExecutionDetailResponse(
        id=claim.id,
        title=title,
        status=claim.status.value if hasattr(claim.status, "value") else str(claim.status),
        user_id=claim.user_id,
        created_at=claim.created_at.isoformat() if claim.created_at else None,
        updated_at=claim.updated_at.isoformat() if claim.updated_at else None,
        job_id=claim.job_id,
        job=_build_job_dict(job),
        claim=claim.to_dict(),
        policy_analysis=claim.policy_analysis,
        cost_estimate=claim.cost_estimate,
        total_estimated_cost=claim.total_estimated_cost,
        report_url=f"/api/v1/executions/{claim.id}/pdf",
        policy_pdf_url=f"/claims/{claim.id}/policy/file" if claim.has_policy_pdf else None,
    )


@router.patch("/{execution_id}", response_model=ExecutionDetailResponse)
async def update_execution(
    execution_id: str,
    body: ExecutionUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Update execution metadata (e.g. rename the run title or modify damage info).
    """
    claim = await db.get(Claim, execution_id)
    if not claim:
        raise HTTPException(status_code=404, detail=f"Execution {execution_id!r} not found.")

    if body.title is not None:
        claim.title = body.title.strip()
    if body.damage_description is not None:
        claim.damage_description = body.damage_description
    if body.cause_of_loss is not None:
        claim.cause_of_loss = body.cause_of_loss
    if body.property_type is not None:
        claim.property_type = body.property_type
    if body.date_of_loss is not None:
        claim.date_of_loss = body.date_of_loss
    if body.policy_number is not None:
        claim.policy_number = body.policy_number
    if body.insurer_name is not None:
        claim.insurer_name = body.insurer_name

    await db.commit()
    await db.refresh(claim)

    job = None
    if claim.job_id:
        job = await db.get(Job, claim.job_id)

    title = _derive_title(claim, job)

    return ExecutionDetailResponse(
        id=claim.id,
        title=title,
        status=claim.status.value if hasattr(claim.status, "value") else str(claim.status),
        user_id=claim.user_id,
        created_at=claim.created_at.isoformat() if claim.created_at else None,
        updated_at=claim.updated_at.isoformat() if claim.updated_at else None,
        job_id=claim.job_id,
        job=_build_job_dict(job),
        claim=claim.to_dict(),
        policy_analysis=claim.policy_analysis,
        cost_estimate=claim.cost_estimate,
        total_estimated_cost=claim.total_estimated_cost,
        report_url=f"/api/v1/executions/{claim.id}/pdf",
        policy_pdf_url=f"/claims/{claim.id}/policy/file" if claim.has_policy_pdf else None,
    )


@router.delete("/{execution_id}", status_code=204)
async def delete_execution(
    execution_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete an execution and cleanly remove its claim record.
    """
    claim = await db.get(Claim, execution_id)
    if not claim:
        raise HTTPException(status_code=404, detail=f"Execution {execution_id!r} not found.")

    # Remove claim record
    await db.delete(claim)
    await db.commit()
    log.info("execution_deleted", execution_id=execution_id)


@router.get("/{execution_id}/pdf")
async def download_execution_pdf(
    execution_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Generate or download the executive PDF assessment report.
    Returns downloadable PDF file stream.
    """
    claim = await db.get(Claim, execution_id)
    if not claim:
        raise HTTPException(status_code=404, detail=f"Execution {execution_id!r} not found.")

    job = None
    if claim.job_id:
        job = await db.get(Job, claim.job_id)

    claim_dir = get_claim_dir(claim.id)
    pdf_path = claim_dir / "report.pdf"

    # Generate if not exists or if requested fresh
    if not pdf_path.exists():
        generate_execution_pdf(claim, job, pdf_path)
        claim.report_path = str(pdf_path)
        await db.commit()

    safe_title = (claim.title or f"ClaimSpace-Report-{claim.id[:8]}").replace(" ", "_").replace("/", "-")
    download_filename = f"{safe_title}.pdf"

    return FileResponse(
        path=str(pdf_path),
        media_type="application/pdf",
        filename=download_filename,
        content_disposition_type="attachment",
    )


@router.get("/{execution_id}/policy-file")
async def download_execution_policy_file(
    execution_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Download the original uploaded insurance policy PDF.
    """
    claim = await db.get(Claim, execution_id)
    if not claim:
        raise HTTPException(status_code=404, detail=f"Execution {execution_id!r} not found.")

    if not claim.policy_pdf_path or not Path(claim.policy_pdf_path).exists():
        # Fallback check standard path
        claim_dir = get_claim_dir(claim.id)
        if (claim_dir / "policy.pdf").exists():
            claim.policy_pdf_path = str(claim_dir / "policy.pdf")
            await db.commit()
        else:
            raise HTTPException(status_code=404, detail="No policy PDF document uploaded for this execution.")

    filename = claim.policy_pdf_filename or "insurance_policy.pdf"
    return FileResponse(
        path=str(claim.policy_pdf_path),
        media_type="application/pdf",
        filename=filename,
        content_disposition_type="inline",
    )
