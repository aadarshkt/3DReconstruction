"""
Standalone Guided Tour Microservice Application.
Can be executed directly via: uvicorn tour_service.main:app --port 8001
"""
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
try:
    from tour_service.router import router as tour_router
except ImportError:
    from router import router as tour_router

app = FastAPI(
    title="ClaimSpace - Guided Tour Microservice",
    description="Independent microservice powering high-performance, deterministic guided tour demos.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tour_router, prefix="/api/v1/tour", tags=["Guided Tour"])
app.include_router(tour_router, prefix="/tour", tags=["Guided Tour"])


@app.get("/")
async def root():
    return {
        "service": "guided-tour-microservice",
        "status": "online",
        "endpoints": [
            "/api/v1/tour/health",
            "/api/v1/tour/sample-claim",
            "/api/v1/tour/chat",
            "/api/v1/tour/artifacts/floor_plan.svg",
            "/api/v1/tour/artifacts/point_cloud.ply",
        ],
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
