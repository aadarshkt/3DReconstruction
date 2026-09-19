"""
FastAPI endpoints for Insurance Claims and Policy RAG.
"""
from pathlib import Path
from typing import Any, Optional
import aiofiles
import structlog
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.claim_chat import ClaimChatRouter
from app.agents.cost_engine import CostEngine
from app.agents.policy_rag import PolicyRAGEngine
from app.config import get_claim_dir, settings
from app.demo import seed_demo_pipeline, SAMPLE_POLICY_PATH
from app.main import get_db
from app.models.claim import Claim, ClaimStatus
from app.models.job import Job, JobStatus
import shutil

log = structlog.get_logger()
router = APIRouter()

rag_engine = PolicyRAGEngine()
cost_engine = CostEngine(llm_client=rag_engine.llm_client)
chat_router = ClaimChatRouter(
    llm_client=rag_engine.llm_client,
    rag_engine=rag_engine,
    cost_engine=cost_engine,
)



# ── Pydantic Request / Response Schemas ─────────────────────────────────────────
class ClaimCreateRequest(BaseModel):
    job_id: Optional[str] = Field(None, description="Optional associated 3D reconstruction job UUID")
    property_type: str = Field("residential", description="residential | commercial | industrial")
    damage_description: str = Field(..., description="Detailed description of the damage")
    cause_of_loss: str = Field("water", description="water | fire | wind | hail | other")
    date_of_loss: Optional[str] = Field(None, description="YYYY-MM-DD or date string")
    policy_number: Optional[str] = Field(None, description="Policy ID number")
    insurer_name: Optional[str] = Field(None, description="Insurance provider name")


class CostEstimateRequest(BaseModel):
    overhead_and_profit_pct: float = Field(10.0, description="Contractor Overhead & Profit percentage")
    deductible_override: Optional[float] = Field(None, description="Override deductible amount")
    coverage_limit_override: Optional[float] = Field(None, description="Override coverage limit amount")
    damage_area_override: Optional[float] = Field(None, description="User-selected damage area in m² from 2D floor plan")



class ClaimQueryRequest(BaseModel):
    question: str = Field(..., description="Natural language question about coverage or policy terms")


class ClaimResponse(BaseModel):
    id: str
    job_id: Optional[str] = None
    status: str
    property_type: str
    damage_description: str
    cause_of_loss: str
    date_of_loss: Optional[str] = None
    policy_number: Optional[str] = None
    insurer_name: Optional[str] = None
    has_policy_pdf: bool = False
    policy_analysis: Optional[dict[str, Any]] = None
    cost_estimate: Optional[dict[str, Any]] = None
    total_estimated_cost: Optional[float] = None
    created_at: Optional[Any] = None
    updated_at: Optional[Any] = None



# ── Endpoints ──────────────────────────────────────────────────────────────────
@router.post("", response_model=ClaimResponse, status_code=201)
async def create_claim(
    payload: ClaimCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create a new insurance claim record."""
    if payload.job_id:
        # Verify job exists if provided
        job = await db.get(Job, payload.job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {payload.job_id} not found")

    claim = Claim(
        job_id=payload.job_id,
        property_type=payload.property_type,
        damage_description=payload.damage_description,
        cause_of_loss=payload.cause_of_loss,
        date_of_loss=payload.date_of_loss,
        policy_number=payload.policy_number,
        insurer_name=payload.insurer_name,
        status=ClaimStatus.created,
    )
    db.add(claim)
    await db.commit()
    await db.refresh(claim)
    log.info("claim_created", claim_id=claim.id)
    return claim


from app.core.security import require_admin, require_user, get_current_user, AuthenticatedUser

@router.post("/seed-demo")
async def seed_demo_endpoint(
    db: AsyncSession = Depends(get_db),
    admin_user: AuthenticatedUser = Depends(require_admin),
):
    """
    1-Click Seed Endpoint for closed-loop testing.
    Creates a completed 3D reconstruction job (native LiDAR, 24.5 m², 4 walls, SVG + PLY)
    and links a demo water damage claim with ISO HO-3 policy indexed in vector store.
    """
    try:
        result = await seed_demo_pipeline(db, rag_engine)
        return {
            "status": "success",
            "message": "Demo job and insurance claim seeded successfully with HO-3 policy.",
            **{k: v for k, v in result.items() if k != "status"},
        }
    except Exception as e:
        log.error("seed_demo_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to seed demo data: {str(e)}")



@router.get("", response_model=list[ClaimResponse])
async def list_claims(
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """List recent claims ordered by creation time."""
    stmt = select(Claim).order_by(Claim.created_at.desc()).limit(limit)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.get("/{claim_id}", response_model=ClaimResponse)
async def get_claim(
    claim_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Fetch details and status of an insurance claim."""
    claim = await db.get(Claim, claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail=f"Claim {claim_id} not found")
    return claim


@router.post("/{claim_id}/policy/upload")
async def upload_policy(
    claim_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload and index a policy PDF into the ChromaDB vector store.
    Extracts text page-by-page, performs section-aware chunking, and indexes embeddings.
    """
    claim = await db.get(Claim, claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail=f"Claim {claim_id} not found")

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported for policy documents")

    claim_dir = get_claim_dir(claim_id)
    pdf_path = claim_dir / "policy.pdf"

    # Save PDF to disk
    claim.status = ClaimStatus.policy_uploading
    await db.commit()

    try:
        async with aiofiles.open(pdf_path, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                await f.write(chunk)

        # Ingest into vector store
        ingest_stats = rag_engine.ingest_policy(claim_id, pdf_path)

        claim.has_policy_pdf = True
        claim.policy_pdf_path = str(pdf_path)
        claim.status = ClaimStatus.policy_indexed
        await db.commit()
        await db.refresh(claim)

        return {
            "status": "success",
            "message": "Policy document successfully ingested and indexed.",
            "ingest_stats": ingest_stats,
            "claim": claim,
        }

    except Exception as e:
        log.error("policy_upload_error", claim_id=claim_id, error=str(e))
        claim.status = ClaimStatus.failed
        claim.error_message = f"Policy indexing failed: {str(e)}"
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Failed to process policy: {str(e)}")


@router.post("/{claim_id}/policy/load-sample")
async def load_sample_policy(
    claim_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    1-Click Policy Loader: Attaches and indexes the standard ISO HO-3 Homeowners policy fixture.
    Allows testing vector RAG without needing to locate a PDF file on the local machine.
    """
    claim = await db.get(Claim, claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail=f"Claim {claim_id} not found")

    if not SAMPLE_POLICY_PATH.exists():
        raise HTTPException(status_code=404, detail="Sample policy fixture not found on server.")

    claim_dir = get_claim_dir(claim_id)
    dest_pdf = claim_dir / "policy.pdf"

    shutil.copyfile(SAMPLE_POLICY_PATH, dest_pdf)

    try:
        ingest_stats = rag_engine.ingest_policy(claim_id, dest_pdf)
        claim.has_policy_pdf = True
        claim.policy_pdf_path = str(dest_pdf)
        claim.status = ClaimStatus.policy_indexed
        await db.commit()
        await db.refresh(claim)

        return {
            "status": "success",
            "message": "Sample ISO HO-3 policy loaded and indexed in vector store.",
            "ingest_stats": ingest_stats,
            "claim": claim,
        }
    except Exception as e:
        log.error("load_sample_policy_error", claim_id=claim_id, error=str(e))
        claim.status = ClaimStatus.failed
        claim.error_message = f"Sample policy indexing failed: {str(e)}"
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Failed to index sample policy: {str(e)}")



@router.post("/{claim_id}/policy/analyze")
async def analyze_claim_policy(
    claim_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Run RAG-augmented legal policy analysis on the claim.
    Correlates cause of loss, damage description, and 3D reconstruction measurements
    with the policy's coverages, perils, and exclusion clauses.
    """
    claim = await db.get(Claim, claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail=f"Claim {claim_id} not found")

    if not claim.has_policy_pdf:
        raise HTTPException(
            status_code=400,
            detail="No policy PDF has been uploaded for this claim yet. Please upload a policy first.",
        )

    # Fetch 3D reconstruction metrics if linked
    reconstruction_metrics = None
    if claim.job_id:
        job = await db.get(Job, claim.job_id)
        if job and job.result_payload:
            reconstruction_metrics = {
                "room_area_m2": job.room_area_m2,
                "wall_count": job.wall_count,
                "damage_area_m2": job.result_payload.get("damage_area_m2"),
            }

    claim.status = ClaimStatus.analyzing_policy
    await db.commit()

    try:
        claim_data = {
            "cause_of_loss": claim.cause_of_loss,
            "damage_description": claim.damage_description,
            "property_type": claim.property_type,
        }
        analysis = rag_engine.analyze_coverage(
            claim_id=claim_id,
            claim_data=claim_data,
            reconstruction_metrics=reconstruction_metrics,
        )

        claim.policy_analysis = analysis.to_dict()
        claim.status = ClaimStatus.policy_indexed
        await db.commit()
        await db.refresh(claim)

        return {
            "status": "success",
            "claim_id": claim_id,
            "analysis": claim.policy_analysis,
        }
    except Exception as e:
        log.error("policy_analyze_error", claim_id=claim_id, error=str(e))
        claim.status = ClaimStatus.failed
        claim.error_message = f"Policy analysis failed: {str(e)}"
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@router.post("/{claim_id}/policy/query")
async def query_claim_policy(
    claim_id: str,
    payload: ClaimQueryRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Natural Language Query endpoint for policy questions.
    Retrieves the most relevant policy clauses from ChromaDB and generates an answer citing sections and pages.
    """
    claim = await db.get(Claim, claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail=f"Claim {claim_id} not found")

    if not claim.has_policy_pdf:
        raise HTTPException(
            status_code=400,
            detail="No policy PDF has been uploaded for this claim yet. Please upload a policy first.",
        )

    try:
        claim_data = {
            "cause_of_loss": claim.cause_of_loss,
            "damage_description": claim.damage_description,
        }
        res = rag_engine.query_policy(
            claim_id=claim_id,
            question=payload.question,
            claim_data=claim_data,
        )
        return res
    except Exception as e:
        log.error("policy_query_error", claim_id=claim_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


@router.post("/{claim_id}/estimate")
async def estimate_claim_costs(
    claim_id: str,
    payload: Optional[CostEstimateRequest] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Generate itemized repair cost estimation for a claim.
    Combines 3D reconstruction measurements (room area, wall dimensions, damage surface)
    with the rate table and applies deductible/limits from policy analysis.
    """
    claim = await db.get(Claim, claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail=f"Claim {claim_id} not found")

    # Fetch 3D reconstruction metrics if linked
    reconstruction_metrics = None
    if claim.job_id:
        job = await db.get(Job, claim.job_id)
        if job:
            if job.status not in (JobStatus.complete, JobStatus.failed):
                return {
                    "status": "processing",
                    "message": "3D spatial reconstruction is still processing. Geometry, perimeter, and surface areas are being measured. Please check back shortly for your itemized cost estimate.",
                    "job_status": job.status.value,
                    "job_progress": job.progress_pct,
                }
            if job.result_payload:
                reconstruction_metrics = {
                    "room_area_m2": job.room_area_m2,
                    "wall_count": job.wall_count,
                    "walls": job.result_payload.get("walls", []),
                    "damage_area_m2": job.result_payload.get("damage_area_m2"),
                }

    claim.status = ClaimStatus.estimating_costs
    await db.commit()

    req = payload or CostEstimateRequest()
    try:
        claim_data = {
            "cause_of_loss": claim.cause_of_loss,
            "damage_description": claim.damage_description,
            "property_type": claim.property_type,
        }

        # Apply damage area override if user adjusted on 2D floor plan
        if req.damage_area_override is not None:
            if reconstruction_metrics is None:
                reconstruction_metrics = {"room_area_m2": 24.5, "wall_count": 4}
            else:
                reconstruction_metrics = dict(reconstruction_metrics)
            reconstruction_metrics["damage_area_m2"] = req.damage_area_override

        # Use overrides if provided, otherwise default to policy analysis
        policy_analysis = claim.policy_analysis or {}
        if req.deductible_override is not None:
            policy_analysis = dict(policy_analysis)
            policy_analysis["deductible"] = req.deductible_override
        if req.coverage_limit_override is not None:
            policy_analysis = dict(policy_analysis)
            policy_analysis["coverage_limit"] = req.coverage_limit_override

        estimate = cost_engine.estimate_claim(
            claim_id=claim_id,
            claim_data=claim_data,
            reconstruction_metrics=reconstruction_metrics,
            policy_analysis=policy_analysis,
            overhead_and_profit_pct=req.overhead_and_profit_pct,
        )

        claim.cost_estimate = estimate.to_dict()
        claim.total_estimated_cost = estimate.net_claim_payout
        claim.status = ClaimStatus.complete
        await db.commit()
        await db.refresh(claim)

        return {
            "status": "success",
            "claim_id": claim_id,
            "cost_estimate": claim.cost_estimate,
            "total_estimated_cost": claim.total_estimated_cost,
        }
    except Exception as e:
        log.error("cost_estimation_error", claim_id=claim_id, error=str(e))
        claim.status = ClaimStatus.failed
        claim.error_message = f"Cost estimation failed: {str(e)}"
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Cost estimation failed: {str(e)}")


class ClaimChatMessage(BaseModel):
    message: str = Field(..., description="User message or question about the claim, policy, costs, or 3D scan")


@router.post("/{claim_id}/chat")
async def chat_with_claim_assistant(
    claim_id: str,
    payload: ClaimChatMessage,
    db: AsyncSession = Depends(get_db),
):
    """
    Interactive conversational assistant for the insurance claim.
    Routes queries intelligently between:
    - Policy RAG (coverage terms, perils, exclusions, deductible)
    - Cost Engine (repairs, pricing, line items, payout)
    - 3D Geometry (exact room area, walls, dimensions from scan)
    - General Guidance (claims process, adjuster advice)
    """
    claim = await db.get(Claim, claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail=f"Claim {claim_id} not found")

    reconstruction_metrics = None
    if claim.job_id:
        job = await db.get(Job, claim.job_id)
        if job and job.result_payload:
            reconstruction_metrics = {
                "room_area_m2": job.room_area_m2,
                "wall_count": job.wall_count,
                "walls": job.result_payload.get("walls", []),
                "damage_area_m2": job.result_payload.get("damage_area_m2"),
            }

    claim_data = {
        "id": claim.id,
        "status": claim.status.value,
        "cause_of_loss": claim.cause_of_loss,
        "damage_description": claim.damage_description,
        "property_type": claim.property_type,
        "has_policy_pdf": claim.has_policy_pdf,
    }

    try:
        response = chat_router.handle_chat(
            claim_id=claim_id,
            message=payload.message,
            claim_data=claim_data,
            reconstruction_metrics=reconstruction_metrics,
            cost_estimate=claim.cost_estimate,
        )
        return response
    except Exception as e:
        log.error("claim_chat_error", claim_id=claim_id, error=str(e))
        raise HTTPException(status_code=500, detail=f"Chat processing failed: {str(e)}")


