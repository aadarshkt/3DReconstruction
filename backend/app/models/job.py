"""
SQLAlchemy ORM models.  Uses PostgreSQL via asyncpg for FastAPI endpoints
and psycopg2 for synchronous Celery task access.
"""
import uuid
import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Column, String, Float, Integer, DateTime, Enum as SAEnum, Text, JSON
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.sql import func


# ── Base ──────────────────────────────────────────────────────────────────────
class Base(DeclarativeBase):
    pass


# ── Enumerations ──────────────────────────────────────────────────────────────
class Tier(str, enum.Enum):
    """Which input tier was submitted for this job."""
    photos = "photos"    # Tier A  – overlapping still images
    video  = "video"     # Tier B  – walkthrough video
    lidar  = "lidar"     # Tier C  – ARKit / RoomPlan LiDAR export
    hybrid = "hybrid"    # Cross-modality fusion (e.g. video + LiDAR)


class JobStatus(str, enum.Enum):
    created          = "created"
    uploading        = "uploading"
    queued           = "queued"
    extracting_frames = "extracting_frames"  # Tier B only
    colmap_sfm       = "colmap_sfm"
    colmap_mvs       = "colmap_mvs"
    scale_anchoring  = "scale_anchoring"
    lidar_converting = "lidar_converting"    # Tier C only
    plane_extraction = "plane_extraction"
    vectorizing      = "vectorizing"
    exporting        = "exporting"
    complete         = "complete"
    failed           = "failed"


# ── Job model ─────────────────────────────────────────────────────────────────
class Job(Base):
    __tablename__ = "jobs"

    id: str = Column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    # Input metadata
    tier: Tier = Column(SAEnum(Tier), nullable=False)
    scale_reference_m: Optional[float] = Column(Float, nullable=True)
    """
    For Tier A / B: the real-world length (metres) of the reference object
    visible in the capture (e.g. 0.297 for A4 short edge).
    Null for Tier C (LiDAR is natively metric).
    """

    # Processing state
    status: JobStatus = Column(SAEnum(JobStatus), nullable=False, default=JobStatus.created)
    progress_pct: int = Column(Integer, nullable=False, default=0)
    error_message: Optional[str] = Column(Text, nullable=True)

    # Celery task id (to allow revocation)
    celery_task_id: Optional[str] = Column(String(128), nullable=True)

    # Timestamps
    created_at: datetime = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: datetime = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Results (populated when status == complete)
    room_area_m2: Optional[float] = Column(Float, nullable=True)
    wall_count:   Optional[int]   = Column(Integer, nullable=True)

    # Full structured result payload stored as JSONB
    result_payload: Optional[dict] = Column(JSON, nullable=True)
    """
    Stores:
    {
      "walls": [{"id": 1, "length_m": 4.12, "start": [0,0], "end": [4.12,0],
                 "has_opening": true, "opening_type": "door"}, ...],
      "error_estimate": {"method": "...", "expected_wall_error_cm": 3.5},
      "scale_confidence": "scaled_via_reference" | "native_metric",
      "files": {
        "floor_plan_dxf": "results/floor_plan.dxf",
        "floor_plan_svg": "results/floor_plan.svg",
        "point_cloud_ply": "results/scan_metric.ply",
        "validation_csv":  "results/validation.csv"
      }
    }
    """

    def __repr__(self) -> str:
        return f"<Job id={self.id} tier={self.tier} status={self.status}>"
