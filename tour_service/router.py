"""
FastAPI Router for Guided Tour endpoints.
Can be mounted inside main backend or served by standalone tour microservice.
"""
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from tour_service.service import (
    ARTIFACTS_DIR,
    get_tour_sample_claim,
    handle_tour_chat,
)

router = APIRouter()


class TourChatRequest(BaseModel):
    message: str = Field(..., description="User query about tour claim, policy, or costs")


@router.get("/health", tags=["Guided Tour"])
async def tour_health():
    """Health check endpoint for standalone tour microservice."""
    return {"status": "ok", "service": "guided-tour-microservice", "version": "1.0.0"}


@router.get("/sample-claim", tags=["Guided Tour"])
@router.get("/sample-data", tags=["Guided Tour"])
async def get_sample_claim():
    """
    Returns complete pre-computed tour dataset:
    - 3D spatial geometry & dimensions
    - ISO HO-3 policy analysis & legal clauses
    - Deterministic itemized repair cost schedule
    """
    return get_tour_sample_claim()


@router.get("/artifacts/{filename}", tags=["Guided Tour"])
async def get_tour_artifact(filename: str):
    """
    Streams standalone artifacts (SVG floor plan, PLY 3D point cloud, etc.).
    """
    safe_name = Path(filename).name
    file_path = ARTIFACTS_DIR / safe_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Tour artifact {safe_name} not found")
    
    media_type = "application/octet-stream"
    if safe_name.endswith(".svg"):
        media_type = "image/svg+xml"
    elif safe_name.endswith(".json"):
        media_type = "application/json"
    elif safe_name.endswith(".ply"):
        media_type = "text/plain"

    return FileResponse(file_path, media_type=media_type)


@router.post("/chat", tags=["Guided Tour"])
async def tour_chat(req: TourChatRequest):
    """
    Instant, reliable conversational AI responses for the guided tour.
    """
    return handle_tour_chat(req.message)
