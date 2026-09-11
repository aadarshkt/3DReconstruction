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

from app.config import settings, get_results_dir
from app.models.job import Job, JobStatus, Tier

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
    End-to-end floor plan reconstruction pipeline.

    1. Determine tier (photos / video / lidar).
    2. Run tier-specific processing → scan_metric.ply.
    3. Run common backend (RANSAC planes → wall segments → openings).
    4. Export DXF / SVG / JSON / CSV.
    5. Update job record with results.
    """
    db = _make_sync_session()
    log = structlog.get_logger().bind(job_id=job_id, celery_task=self.request.id)

    def progress(stage: str, pct: int, **extra):
        """Update DB + publish Redis message in one call."""
        _update_job(db, job_id, status=JobStatus(stage) if _is_valid_status(stage) else None,
                    progress_pct=pct)
        _publish_progress(job_id, stage, pct, **extra)
        log.info("progress", stage=stage, pct=pct)

    try:
        # ── Load job ──────────────────────────────────────────────────────────
        job = _update_job(db, job_id, status=JobStatus.queued, progress_pct=5)
        if job is None:
            raise ValueError(f"Job {job_id} not found in database.")

        tier = job.tier
        scale_ref = job.scale_reference_m

        # ── Tier processing → metric PLY ──────────────────────────────────────
        from app.pipeline.tier_router import route as route_tier
        metric_ply = route_tier(job_id, tier, scale_ref, progress)

        # ── Common backend ────────────────────────────────────────────────────
        progress("plane_extraction", 60)
        from app.pipeline.common_backend import extract_structural_elements, compute_room_area
        walls = extract_structural_elements(metric_ply, progress)

        # ── Export ────────────────────────────────────────────────────────────
        progress("exporting", 90)
        results_dir = get_results_dir(job_id)

        if tier == Tier.lidar:
            scale_confidence = "native_metric"
        elif scale_ref is not None:
            scale_confidence = "scaled_via_reference"
        else:
            scale_confidence = "unscaled"

        from app.pipeline.exporter import export_all
        payload, files = export_all(
            job_id=job_id,
            walls=walls,
            scale_confidence=scale_confidence,
            results_dir=results_dir,
        )

        # Attach files to payload
        payload["files"] = files

        # ── Finalise job ──────────────────────────────────────────────────────
        area = compute_room_area(walls)
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
