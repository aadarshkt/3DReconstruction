"""
Celery task definitions.

Tasks
─────
run_pipeline(job_id)  — the main end-to-end reconstruction task.
                        Called after all uploads are complete.

Progress is reported in two ways:
1. Job.status / Job.progress_pct updated in PostgreSQL (polled by GET /jobs/{id}).
2. Redis pub/sub message published so the FastAPI WebSocket endpoint
   can push real-time updates to connected clients.
"""
import json
import traceback
from datetime import datetime

import redis
import structlog
from celery import Celery
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from app.config import settings, get_results_dir, get_images_dir
from app.models import Job, JobStatus, Tier, Claim, ClaimStatus
from app.pipeline.observability import RunDiagnostics


log = structlog.get_logger()

# ── Celery app ─────────────────────────────────────────────────────────────────
celery_app = Celery(
    "floorplan",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    worker_prefetch_multiplier=1,   # process one task at a time per worker
    task_acks_late=True,            # ack only after task is done (safe retry)
)

# Re-export for import by app.api.uploads
run_pipeline = None  # defined below after celery_app is configured

# ── Redis pub/sub for WebSocket push ──────────────────────────────────────────
_redis_client: redis.Redis | None = None


def get_redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(settings.REDIS_URL)
    return _redis_client


def _publish_progress(job_id: str, stage: str, pct: int, **extra):
    """Publish a progress event to Redis so FastAPI WS can pick it up."""
    payload = json.dumps({"stage": stage, "pct": pct, **extra})
    get_redis().publish(f"job:{job_id}:progress", payload)


# ── Sync DB session (psycopg2) for Celery tasks ───────────────────────────────
def _make_sync_session() -> Session:
    engine = create_engine(settings.DATABASE_SYNC_URL, pool_pre_ping=True)
    SessionLocal = sessionmaker(bind=engine)
    return SessionLocal()


def _update_job(db: Session, job_id: str, **kwargs):
    """Update job fields and commit."""
    job = db.query(Job).filter(Job.id == job_id).first()
    if job:
        for k, v in kwargs.items():
            setattr(job, k, v)
        db.commit()
        db.refresh(job)
    return job


# ── Main pipeline task ─────────────────────────────────────────────────────────
@celery_app.task(bind=True, name="run_pipeline", max_retries=1)
def run_pipeline(self, job_id: str):
    """
    Celery wrapper around the end-to-end floor plan reconstruction pipeline.
    """
    return _run_pipeline_core(job_id)


def _run_pipeline_core(job_id: str):
    """
    End-to-end floor plan reconstruction pipeline.

    1. Determine tier (photos / video / lidar).
    2. Run tier-specific processing → scan_metric.ply.
    3. Run common backend (RANSAC planes → wall segments → openings).
    4. Export DXF / SVG / JSON / CSV.
    5. Update job record with results.
    """
    db = _make_sync_session()
    log = structlog.get_logger().bind(job_id=job_id)
    diag = None

    def progress(stage: str, pct: int, **extra):
        """Update DB + publish Redis message in one call."""
        _update_job(db, job_id, status=JobStatus(stage) if _is_valid_status(stage) else None,
                    progress_pct=pct)
        _publish_progress(job_id, stage, pct, **extra)
        if diag is not None:
            diag.observe_stage(stage, pct)
        log.info("progress", stage=stage, pct=pct)

    try:
        # ── Load job ──────────────────────────────────────────────────────────
        job = _update_job(db, job_id, status=JobStatus.queued, progress_pct=5)
        if job is None:
            raise ValueError(f"Job {job_id} not found in database.")

        tier = job.tier
        scale_ref = job.scale_reference_m
        diag = RunDiagnostics(tier, scale_ref)

        # ── Tier processing → metric PLY ──────────────────────────────────────
        from app.pipeline.tier_router import route as route_tier
        metric_ply = route_tier(job_id, tier, scale_ref, progress, diag)

        # ── Common backend ────────────────────────────────────────────────────
        progress("plane_extraction", 60)
        from app.pipeline.common_backend import extract_structural_elements, compute_room_area
        walls = extract_structural_elements(metric_ply, progress, diag)

        # ── Export ────────────────────────────────────────────────────────────
        progress("exporting", 90)
        results_dir = get_results_dir(job_id)

        if tier == Tier.lidar:
            scale_confidence = "native_metric"
            scale_factor = 1.0
            scale_method = "native_metric"
        elif scale_ref is not None:
            scale_confidence = "scaled_via_reference"
            scale_factor = scale_ref
            scale_method = "reference_object_placeholder"
            diag.add_warning(
                "Scale anchoring uses a placeholder reconstructed reference length "
                "(1.0 units); photo/video clouds are scaled by the raw "
                "scale_reference_m and may not be metric."
            )
        else:
            scale_confidence = "unscaled"
            scale_factor = 1.0
            scale_method = "unscaled"

        diag.set_metric("scale_factor", scale_factor)
        diag.set_metric("scale_method", scale_method)
        diag.set_metric(
            "input_image_count",
            sum(
                1 for p in get_images_dir(job_id).iterdir()
                if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".heic"}
            ),
        )

        from app.pipeline.exporter import export_all
        payload, files = export_all(
            job_id=job_id,
            walls=walls,
            scale_confidence=scale_confidence,
            results_dir=results_dir,
        )

        # Attach files to payload
        payload["files"] = files
        payload["scale_factor"] = scale_factor
        payload["scale_method"] = scale_method

        # ── Finalise job ──────────────────────────────────────────────────────
        area = compute_room_area(walls)
        diag.set_metric("room_area_m2", area)
        diag.set_metric("wall_count", len(walls))
        payload["diagnostics"] = diag.to_dict()

        _update_job(
            db, job_id,
            status=JobStatus.complete,
            progress_pct=100,
            room_area_m2=area,
            wall_count=len(walls),
            result_payload=payload,
        )

        _publish_progress(job_id, "complete", 100,
                          result_url=f"/jobs/{job_id}/results")
        log.info("pipeline_complete", walls=len(walls), area_m2=area)
        return {"job_id": job_id, "status": "complete"}

    except Exception as exc:
        tb = traceback.format_exc()
        log.error("pipeline_failed", error=str(exc), traceback=tb)
        _update_job(db, job_id,
                    status=JobStatus.failed,
                    error_message=str(exc)[:2000])
        _publish_progress(job_id, "failed", 0, error=str(exc))
        raise

    finally:
        db.close()


def _is_valid_status(stage: str) -> bool:
    return stage in {s.value for s in JobStatus}


def _update_claim(db: Session, claim_id: str, **kwargs):
    """Update claim fields and commit."""
    claim = db.query(Claim).filter(Claim.id == claim_id).first()
    if claim:
        for k, v in kwargs.items():
            setattr(claim, k, v)
        db.commit()
        db.refresh(claim)
    return claim


def _publish_claim_progress(claim_id: str, stage: str, pct: int, **extra):
    """Publish claim progress on Redis pub/sub."""
    payload = {
        "claim_id": claim_id,
        "stage": stage,
        "pct": pct,
        "timestamp": datetime.utcnow().isoformat(),
        **extra,
    }
    try:
        get_redis().publish(f"claim:{claim_id}:progress", json.dumps(payload))
    except Exception as exc:
        log.warning("redis_claim_publish_failed", error=str(exc))


@celery_app.task(bind=True, name="ingest_policy_pdf_task", max_retries=1)
def ingest_policy_pdf_task(self, claim_id: str, pdf_path: str):
    """
    Celery background task to extract, chunk, embed, and index a policy PDF into ChromaDB.
    """
    from app.agents.policy_rag import PolicyRAGEngine
    db = get_sync_db()
    try:
        _update_claim(db, claim_id, status=ClaimStatus.policy_uploading)
        _publish_claim_progress(claim_id, "policy_uploading", 20)

        rag = PolicyRAGEngine()
        stats = rag.ingest_policy(claim_id, pdf_path)

        _update_claim(
            db, claim_id,
            status=ClaimStatus.policy_indexed,
            has_policy_pdf=True,
            policy_pdf_path=pdf_path,
        )
        _publish_claim_progress(claim_id, "policy_indexed", 100, stats=stats)
        return {"claim_id": claim_id, "status": "policy_indexed", "stats": stats}
    except Exception as exc:
        log.error("ingest_policy_pdf_task_failed", claim_id=claim_id, error=str(exc))
        _update_claim(db, claim_id, status=ClaimStatus.failed, error_message=str(exc)[:2000])
        _publish_claim_progress(claim_id, "failed", 0, error=str(exc))
        raise
    finally:
        db.close()


@celery_app.task(bind=True, name="run_claim_analysis_task", max_retries=1)
def run_claim_analysis_task(self, claim_id: str, overhead_and_profit_pct: float = 10.0):
    """
    Celery background task to run policy coverage analysis followed by deterministic cost estimation.
    """
    from app.agents.policy_rag import PolicyRAGEngine
    from app.agents.cost_engine import CostEngine
    db = get_sync_db()
    try:
        claim = db.query(Claim).filter(Claim.id == claim_id).first()
        if not claim:
            raise ValueError(f"Claim {claim_id} not found")

        # 1. Policy Analysis
        _update_claim(db, claim_id, status=ClaimStatus.analyzing_policy)
        _publish_claim_progress(claim_id, "analyzing_policy", 30)

        reconstruction_metrics = None
        if claim.job_id:
            job = db.query(Job).filter(Job.id == claim.job_id).first()
            if job and job.result_payload:
                reconstruction_metrics = {
                    "room_area_m2": job.room_area_m2,
                    "wall_count": job.wall_count,
                    "walls": job.result_payload.get("walls", []),
                    "damage_area_m2": job.result_payload.get("damage_area_m2"),
                }

        claim_data = {
            "cause_of_loss": claim.cause_of_loss,
            "damage_description": claim.damage_description,
            "property_type": claim.property_type,
        }

        policy_analysis_dict = None
        if claim.has_policy_pdf:
            rag = PolicyRAGEngine()
            analysis = rag.analyze_coverage(
                claim_id=claim_id,
                claim_data=claim_data,
                reconstruction_metrics=reconstruction_metrics,
            )
            policy_analysis_dict = analysis.to_dict()
            _update_claim(db, claim_id, policy_analysis=policy_analysis_dict)

        # 2. Cost Estimation
        _update_claim(db, claim_id, status=ClaimStatus.estimating_costs)
        _publish_claim_progress(claim_id, "estimating_costs", 70)

        cost_eng = CostEngine()
        estimate = cost_eng.estimate_claim(
            claim_id=claim_id,
            claim_data=claim_data,
            reconstruction_metrics=reconstruction_metrics,
            policy_analysis=policy_analysis_dict,
            overhead_and_profit_pct=overhead_and_profit_pct,
        )

        estimate_dict = estimate.to_dict()
        _update_claim(
            db, claim_id,
            cost_estimate=estimate_dict,
            total_estimated_cost=estimate.net_claim_payout,
            status=ClaimStatus.complete,
        )
        _publish_claim_progress(
            claim_id, "complete", 100,
            total_cost=estimate.net_claim_payout,
            gross_cost=estimate.gross_estimate_usd,
        )
        return {"claim_id": claim_id, "status": "complete", "cost_estimate": estimate_dict}
    except Exception as exc:
        log.error("run_claim_analysis_task_failed", claim_id=claim_id, error=str(exc))
        _update_claim(db, claim_id, status=ClaimStatus.failed, error_message=str(exc)[:2000])
        _publish_claim_progress(claim_id, "failed", 0, error=str(exc))
        raise
    finally:
        db.close()

