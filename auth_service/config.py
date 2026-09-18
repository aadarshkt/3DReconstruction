"""
Configuration settings for the ClaimSpace Auth Microservice.
Loaded from environment variables or .env file.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class AuthSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../backend/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    SERVICE_NAME: str = "ClaimSpace Auth Microservice"
    SERVICE_VERSION: str = "1.0.0"
    SERVICE_PORT: int = 8002

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://floorplan:floorplan_secret@localhost:5432/floorplan"

    # JWT Authentication
    JWT_SECRET_KEY: str = "super_secret_jwt_key_claimspace_change_in_production_2026"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_MINUTES: int = 60 * 24 * 7  # 7 days

    # Google OAuth 2.0
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    INITIAL_ADMIN_EMAIL: str = "admin@claimspace.com"
    FRONTEND_URL: str = "http://localhost:3000"
    ALLOW_DEV_LOGIN: bool = True

    # CORS
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "*",
    ]


settings = AuthSettings()
