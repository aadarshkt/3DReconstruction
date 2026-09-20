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
    user_id: Optional[str] = Column(
        String(128),
        index=True,
        nullable=True,
    )
    title: Optional[str] = Column(
        String(256),
        nullable=True,
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
    policy_pdf_filename: Optional[str] = Column(String(256), nullable=True)

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

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "title": self.title,
            "job_id": self.job_id,
            "status": self.status.value if hasattr(self.status, "value") else str(self.status),
            "property_type": self.property_type,
            "damage_description": self.damage_description,
            "cause_of_loss": self.cause_of_loss,
            "date_of_loss": self.date_of_loss,
            "policy_number": self.policy_number,
            "insurer_name": self.insurer_name,
            "has_policy_pdf": self.has_policy_pdf,
            "policy_pdf_filename": self.policy_pdf_filename,
            "policy_analysis": self.policy_analysis,
            "cost_estimate": self.cost_estimate,
            "total_estimated_cost": self.total_estimated_cost,
            "report_path": self.report_path,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

