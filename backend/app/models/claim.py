"""
SQLAlchemy ORM models for Insurance Claims.
"""
import uuid
import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Column, String, Float, DateTime, Enum as SAEnum, Text, JSON, ForeignKey, Boolean
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.models.job import Base


class ClaimStatus(str, enum.Enum):
    created           = "created"
    policy_uploading  = "policy_uploading"
    policy_indexed    = "policy_indexed"      # RAG ingestion complete
    analyzing_policy  = "analyzing_policy"
    estimating_costs  = "estimating_costs"
    complete          = "complete"
    failed            = "failed"


class Claim(Base):
    __tablename__ = "claims"

    id: str = Column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    job_id: Optional[str] = Column(
        UUID(as_uuid=False),
        ForeignKey("jobs.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: ClaimStatus = Column(
        SAEnum(ClaimStatus),
        nullable=False,
        default=ClaimStatus.created,
    )

    # Property & damage info
    property_type: str = Column(String(64), nullable=False, default="residential")
    damage_description: str = Column(Text, nullable=False, default="")
    date_of_loss: Optional[str] = Column(String(64), nullable=True)
    cause_of_loss: str = Column(String(64), nullable=False, default="water")

    # Policy info
    policy_number: Optional[str] = Column(String(128), nullable=True)
    insurer_name: Optional[str] = Column(String(128), nullable=True)
    has_policy_pdf: bool = Column(Boolean, nullable=False, default=False)
    policy_pdf_path: Optional[str] = Column(String(512), nullable=True)

    # Results (populated by agents / RAG)
    policy_analysis: Optional[dict] = Column(JSON, nullable=True)
    cost_estimate: Optional[dict] = Column(JSON, nullable=True)
    total_estimated_cost: Optional[float] = Column(Float, nullable=True)
    report_path: Optional[str] = Column(String(512), nullable=True)

    # Error message if any stage failed
    error_message: Optional[str] = Column(Text, nullable=True)

    # Timestamps
    created_at: datetime = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: datetime = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __init__(self, **kwargs):
        if "id" not in kwargs or not kwargs["id"]:
            kwargs["id"] = str(uuid.uuid4())
        if "has_policy_pdf" not in kwargs:
            kwargs["has_policy_pdf"] = False
        super().__init__(**kwargs)

