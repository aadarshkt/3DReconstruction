"""
Application configuration loaded from environment variables or a .env file.
All secrets are kept out of source code.
"""
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ── Server ────────────────────────────────────────────────────────────────
    APP_NAME: str = "FloorPlan Pipeline API"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    # ── Database (PostgreSQL) ─────────────────────────────────────────────────
    # Async URL used by FastAPI / SQLAlchemy async engine
    DATABASE_URL: str = "postgresql+asyncpg://floorplan:floorplan_secret@localhost:5432/floorplan"
    # Sync URL used by Celery tasks (psycopg2)
    DATABASE_SYNC_URL: str = "postgresql+psycopg2://floorplan:floorplan_secret@localhost:5432/floorplan"

    # ── Redis / Celery ────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/1"

    # ── File storage ──────────────────────────────────────────────────────────
    DATA_DIR: Path = Path("data")          # root for all job data
    MAX_UPLOAD_SIZE_MB: int = 2048         # 2 GB cap per job upload

    # ── COLMAP ────────────────────────────────────────────────────────────────
    COLMAP_BIN: str = "colmap"             # path to COLMAP binary
    COLMAP_NUM_THREADS: int = 2           # limit CPU threads to prevent memory exhaustion / OOM
    COLMAP_QUALITY: str = "medium"        # quality preset: low, medium, high, extreme

    # ── Pipeline defaults ─────────────────────────────────────────────────────
    VIDEO_EXTRACT_FPS: float = 3.0        # frames/sec to extract from video
    RANSAC_DISTANCE_THRESH: float = 0.02  # metres, for plane fitting
    MIN_WALL_POINTS: int = 300            # discard planes with fewer inliers
    WALL_SLICE_Z_MIN: float = 1.0         # fallback absolute slice band (m above floor)
    WALL_SLICE_Z_MAX: float = 1.5
    WALL_SLICE_REL_MIN: float = 0.25      # relative slice band: 25% of wall height above floor
    WALL_SLICE_REL_MAX: float = 0.75      # relative slice band: 75% of wall height above floor

    # ── Dashboard ─────────────────────────────────────────────────────────────
    DASHBOARD_BASE_URL: str = "http://localhost:8000"

    # ── CORS ─────────────────────────────────────────────────────────────────
    # Add mobile app origins and local dashboard here
    CORS_ORIGINS: list[str] = ["*"]       # tighten in production

    # ── Authentication & Google OAuth ─────────────────────────────────────────
    JWT_SECRET_KEY: str = "super_secret_jwt_key_claimspace_change_in_production_2026"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_MINUTES: int = 60 * 24 * 7  # 7 days
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    INITIAL_ADMIN_EMAIL: str = "admin@claimspace.com"
    FRONTEND_URL: str = "http://localhost:3000"
    ALLOW_DEV_LOGIN: bool = True  # Set to False or disable in production

    # ── LLM / Agent Orchestration ─────────────────────────────────────────────
    LLM_BASE_URL: str = "https://openrouter.ai/api/v1"
    LLM_API_KEY: str = ""
    LLM_MODEL: str = "openrouter/free"
    LLM_TIMEOUT_S: int = 120
    LLM_MAX_TOKENS: int = 4096

    # ── RAG / Embeddings ──────────────────────────────────────────────────────
    EMBEDDING_BASE_URL: str = "https://api.openai.com/v1"
    EMBEDDING_API_KEY: str = ""
    EMBEDDING_MODEL: str = "text-embedding-3-small"
    CHROMA_PERSIST_DIR: Path = Path("data/chromadb")
    RAG_CHUNK_SIZE: int = 800
    RAG_CHUNK_OVERLAP: int = 100
    RAG_TOP_K: int = 6


settings = Settings()



def get_job_dir(job_id: str) -> Path:
    """Return the data directory for a specific job, creating it if needed."""
    p = settings.DATA_DIR / job_id
    p.mkdir(parents=True, exist_ok=True)
    return p


def get_images_dir(job_id: str) -> Path:
    p = get_job_dir(job_id) / "images"
    p.mkdir(parents=True, exist_ok=True)
    return p


def get_results_dir(job_id: str) -> Path:
    p = get_job_dir(job_id) / "results"
    p.mkdir(parents=True, exist_ok=True)
    return p


def get_job_report_dir(job_id: str) -> Path:
    """Return the report directory for a specific job, creating it if needed."""
    p = get_job_dir(job_id) / "reports"
    p.mkdir(parents=True, exist_ok=True)
    return p


def get_claim_dir(claim_id: str) -> Path:
    """Return the data directory for a specific claim, creating it if needed."""
    p = settings.DATA_DIR / "claims" / claim_id
    p.mkdir(parents=True, exist_ok=True)
    return p

