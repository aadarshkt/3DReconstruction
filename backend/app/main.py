"""
FastAPI application entry point.

Startup sequence
────────────────
1. Create async SQLAlchemy engine + session factory.
2. Run Alembic migrations (tables created if missing).
3. Mount all API routers.
4. Serve static result files under /static/{job_id}/...
"""
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.models import Base, Job, Claim, User
from app.core.database import engine, AsyncSessionLocal, get_db

from app.api import jobs as jobs_router
from app.api import uploads as uploads_router
from app.api import results as results_router
from app.api import claims as claims_router
from app.api import auth as auth_router

log = structlog.get_logger()

# ── Lifespan ───────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("startup", msg="Creating database tables if needed…")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Ensure data directory exists
    settings.DATA_DIR.mkdir(parents=True, exist_ok=True)

    log.info("startup", msg="FloorPlan API is ready ✓")
    yield
    log.info("shutdown", msg="Closing database engine…")
    await engine.dispose()


from fastapi import Request
from fastapi.responses import RedirectResponse

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "Backend API for the Phone-Capture-to-Floor-Plan pipeline. "
        "Accepts photo / video / LiDAR inputs, runs COLMAP + Open3D processing, "
        "and returns dimensioned 2D floor plans and 3D point clouds."
    ),
    lifespan=lifespan,
)

# ── CORS ───────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API routers ────────────────────────────────────────────────────────────────
app.include_router(auth_router.router,    prefix="/api/v1")
app.include_router(auth_router.router,    prefix="")
app.include_router(jobs_router.router,    prefix="/jobs",    tags=["Jobs"])
app.include_router(uploads_router.router, prefix="/jobs",    tags=["Uploads"])
app.include_router(results_router.router, prefix="/jobs",    tags=["Results"])
app.include_router(claims_router.router,  prefix="/api/v1/claims", tags=["Claims"])
app.include_router(claims_router.router,  prefix="/claims",        tags=["Claims"])

# ── Guided Tour Microservice Router (can be run standalone or unified) ──────
try:
    import sys
    _root_dir = str(Path(__file__).resolve().parent.parent.parent)
    if _root_dir not in sys.path:
        sys.path.insert(0, _root_dir)
    from tour_service.router import router as tour_router
    app.include_router(tour_router, prefix="/api/v1/tour", tags=["Guided Tour"])
    app.include_router(tour_router, prefix="/tour",        tags=["Guided Tour"])
except Exception as e:
    log.warning("tour_router_mount_failed", error=str(e))


# ── Dashboard & Static files ──────────────────────────────────────────────────
dashboard_dir = Path("/app/web_dashboard")
if not dashboard_dir.exists():
    dashboard_dir = Path(__file__).resolve().parent.parent.parent / "web_dashboard"

if dashboard_dir.exists():
    app.mount("/dashboard", StaticFiles(directory=str(dashboard_dir), html=True), name="dashboard")

    @app.get("/", include_in_schema=False)
    async def root_redirect(request: Request):
        query = f"?{request.url.query}" if request.url.query else ""
        return RedirectResponse(url=f"/dashboard/{query}")

settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(settings.DATA_DIR)), name="static")


# ── Health check ───────────────────────────────────────────────────────────────
@app.get("/health", tags=["Meta"])
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}
