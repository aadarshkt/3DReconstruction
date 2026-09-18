"""
Standalone Authentication & Identity Microservice Application.
Can be executed directly via:
    uvicorn auth_service.main:app --port 8002 --reload
"""
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import structlog

try:
    from auth_service.config import settings
    from auth_service.database import init_db
    from auth_service.router import router as auth_router
except ImportError:
    from config import settings
    from database import init_db
    from router import router as auth_router

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("auth_service_starting", port=settings.SERVICE_PORT)
    try:
        await init_db()
        log.info("auth_db_initialized")
    except Exception as e:
        log.warning("auth_db_init_warning", error=str(e))
    yield
    log.info("auth_service_stopped")


app = FastAPI(
    title=settings.SERVICE_NAME,
    description="Independent microservice powering Google OAuth 2.0, session management, and RBAC.",
    version=settings.SERVICE_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/v1/auth")
app.include_router(auth_router, prefix="/auth")


@app.get("/")
async def root():
    return {
        "service": "claimspace-auth-microservice",
        "status": "online",
        "port": settings.SERVICE_PORT,
        "endpoints": [
            "/api/v1/auth/health",
            "/api/v1/auth/google/url",
            "/api/v1/auth/google/callback",
            "/api/v1/auth/dev-login",
            "/api/v1/auth/me",
            "/api/v1/auth/logout",
            "/api/v1/auth/verify",
        ],
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=settings.SERVICE_PORT)
