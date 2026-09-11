"""
Job CRUD endpoints + WebSocket progress stream.

Endpoints
─────────
POST   /jobs/create          → create a new job, return job_id
GET    /jobs/{job_id}         → get job status + metadata
DELETE /jobs/{job_id}         → cancel / delete a job
WS     /jobs/{job_id}/ws      → real-time progress stream (WebSocket)
"""
import asyncio
import json
from typing import Optional

import redis.asyncio as aioredis
import structlog
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.job import Job, JobStatus, Tier
from app.main import get_db

log = structlog.get_logger()
router = APIRouter()

# ── WebSocket connection manager ───────────────────────────────────────────────
class ConnectionManager:
    """Tracks active WebSocket connections keyed by job_id."""

    def __init__(self):
        self._connections: dict[str, list[WebSocket]] = {}

    async def connect(self, job_id: str, ws: WebSocket):
        await ws.accept()
        self._connections.setdefault(job_id, []).append(ws)

    def disconnect(self, job_id: str, ws: WebSocket):
        conns = self._connections.get(job_id, [])
        if ws in conns:
            conns.remove(ws)

    async def broadcast(self, job_id: str, payload: dict):
        """Push a JSON payload to all listeners watching this job."""
        for ws in list(self._connections.get(job_id, [])):
            try:
                await ws.send_json(payload)
            except Exception:
                pass  # stale connection


manager = ConnectionManager()


async def push_progress(job_id: str, stage: str, pct: int, extra: dict | None = None):
    """
    Helper called by Celery tasks (via Redis pub/sub bridge) and by the API
    to broadcast a progress event to connected WebSocket clients.
    """
    payload = {"stage": stage, "pct": pct}
    if extra:
        payload.update(extra)
    await manager.broadcast(job_id, payload)


# ── Schemas ────────────────────────────────────────────────────────────────────
class CreateJobRequest(BaseModel):
    tier: Tier
    scale_reference_m: Optional[float] = Field(
        None,
        description=(
            "Real-world length in metres of a reference object (or dimension) visible in the "
            "capture. Optional for Tier A (photos) and Tier B (video). "
            "If omitted, reconstruction proceeds in unscaled SfM units. "
            "Omit for Tier C (LiDAR — natively metric)."
        ),
        gt=0,
    )


class JobStatusResponse(BaseModel):
    job_id: str
    tier: Tier
    status: JobStatus
    progress_pct: int
    scale_reference_m: Optional[float]
    room_area_m2: Optional[float]
    wall_count: Optional[int]
    error_message: Optional[str]
    result_payload: Optional[dict]


# ── Routes ─────────────────────────────────────────────────────────────────────
@router.post("/create", response_model=JobStatusResponse, status_code=201)
async def create_job(body: CreateJobRequest, db: AsyncSession = Depends(get_db)):
    """
    Create a new reconstruction job.

    The client should then upload files via POST /jobs/{job_id}/upload,
    then trigger processing with POST /jobs/{job_id}/start.
    """
    job = Job(tier=body.tier, scale_reference_m=body.scale_reference_m)
    db.add(job)
    await db.commit()
    await db.refresh(job)

    log.info("job_created", job_id=job.id, tier=job.tier)
    return _to_response(job)


@router.get("/{job_id}", response_model=JobStatusResponse)
async def get_job(job_id: str, db: AsyncSession = Depends(get_db)):
    job = await _get_or_404(job_id, db)
    return _to_response(job)


@router.delete("/{job_id}", status_code=204)
async def delete_job(job_id: str, db: AsyncSession = Depends(get_db)):
    job = await _get_or_404(job_id, db)
    await db.delete(job)
    await db.commit()


@router.websocket("/{job_id}/ws")
async def websocket_progress(job_id: str, ws: WebSocket, db: AsyncSession = Depends(get_db)):
    """
    WebSocket endpoint for real-time pipeline progress updates.

    The server pushes JSON messages of the form:
        {"stage": "colmap_sfm", "pct": 35}
        {"stage": "complete",   "pct": 100, "result_url": "/jobs/{id}/results"}
        {"stage": "failed",     "pct": 0,   "error": "..."}
    """
    job = await _get_or_404(job_id, db)
    await manager.connect(job_id, ws)

    redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(f"job:{job_id}:progress")

    try:
        # Immediately send current state so client isn't left blank
        stage_str = job.status.value if hasattr(job.status, "value") else str(job.status)
        await ws.send_json({"stage": stage_str, "pct": job.progress_pct})

        # If already complete or failed, send final status and close
        if job.status == JobStatus.complete:
            await ws.send_json({
                "stage": "complete",
                "pct": 100,
                "result_url": f"/jobs/{job_id}/results",
            })
            return
        elif job.status == JobStatus.failed:
            await ws.send_json({
                "stage": "failed",
                "pct": job.progress_pct,
                "error": job.error_message or "Pipeline execution failed",
            })
            return

        async def redis_listener():
            try:
                async for message in pubsub.listen():
                    if message.get("type") == "message":
                        raw_data = message.get("data")
                        try:
                            data = json.loads(raw_data) if isinstance(raw_data, str) else raw_data
                        except Exception:
                            data = {"raw": raw_data}
                        await ws.send_json(data)
                        if isinstance(data, dict) and data.get("stage") in ("complete", "failed"):
                            break
            except asyncio.CancelledError:
                pass

        async def heartbeat_sender():
            try:
                while True:
                    await asyncio.sleep(30)
                    await ws.send_json({"heartbeat": True})
            except asyncio.CancelledError:
                pass

        redis_task = asyncio.create_task(redis_listener())
        heartbeat_task = asyncio.create_task(heartbeat_sender())

        # Keep connection alive; process client pings or wait for completion
        try:
            while not redis_task.done():
                try:
                    await asyncio.wait_for(ws.receive_text(), timeout=1.0)
                except asyncio.TimeoutError:
                    pass
        finally:
            redis_task.cancel()
            heartbeat_task.cancel()
            await asyncio.gather(redis_task, heartbeat_task, return_exceptions=True)

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.warning("websocket_error", job_id=job_id, error=str(exc))
    finally:
        try:
            await pubsub.unsubscribe(f"job:{job_id}:progress")
            await pubsub.close()
            await redis_client.close()
        except Exception:
            pass
        manager.disconnect(job_id, ws)


# ── Helpers ────────────────────────────────────────────────────────────────────
async def _get_or_404(job_id: str, db: AsyncSession) -> Job:
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id!r} not found.")
    return job


def _to_response(job: Job) -> JobStatusResponse:
    return JobStatusResponse(
        job_id=job.id,
        tier=job.tier,
        status=job.status,
        progress_pct=job.progress_pct,
        scale_reference_m=job.scale_reference_m,
        room_area_m2=job.room_area_m2,
        wall_count=job.wall_count,
        error_message=job.error_message,
        result_payload=job.result_payload,
    )
