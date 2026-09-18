import uuid
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlencode

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

try:
    from auth_service.config import settings
    from auth_service.database import get_db
    from auth_service.models import User, UserRole
    from auth_service.security import create_access_token, decode_access_token, get_current_user
except ImportError:
    from config import settings
    from database import get_db
    from models import User, UserRole
    from security import create_access_token, decode_access_token, get_current_user

router = APIRouter(tags=["Authentication"])
log = structlog.get_logger()

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


class GoogleAuthRequest(BaseModel):
    code: str
    redirect_uri: str


class DevLoginRequest(BaseModel):
    email: EmailStr
    name: Optional[str] = "Demo User"
    role: Optional[UserRole] = UserRole.USER


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "claimspace-auth-microservice",
        "version": settings.SERVICE_VERSION,
    }


@router.get("/google/url")
async def get_google_auth_url(redirect_uri: Optional[str] = None):
    """
    Returns the Google OAuth consent screen URL.
    """
    effective_redirect_uri = (
        redirect_uri or f"{settings.FRONTEND_URL}/auth/callback"
    )

    if not settings.GOOGLE_CLIENT_ID:
        return {
            "configured": False,
            "message": "Google Client ID is not configured. Use developer login or configure GOOGLE_CLIENT_ID in .env",
            "url": None,
        }

    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": effective_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "consent",
    }
    url = f"{GOOGLE_AUTH_URL}?{urlencode(params)}"
    return {"configured": True, "url": url}


@router.post("/google/callback", response_model=AuthResponse)
async def google_auth_callback(
    body: GoogleAuthRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Exchanges Google authorization code for access token, fetches user profile,
    registers or logs in user, and returns signed JWT.
    """
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth credentials are not configured on server",
        )

    # 1. Exchange authorization code for tokens
    async with httpx.AsyncClient(timeout=10.0) as client:
        token_res = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": body.code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": body.redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_res.status_code != 200:
            log.error("google_token_exchange_failed", response=token_res.text)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to exchange authorization code with Google",
            )

        token_data = token_res.json()
        google_access_token = token_data.get("access_token")

        # 2. Fetch user information
        userinfo_res = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {google_access_token}"},
        )
        if userinfo_res.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to fetch user profile from Google",
            )
        user_info = userinfo_res.json()

    email = user_info.get("email")
    google_sub = user_info.get("sub")
    name = user_info.get("name")
    picture = user_info.get("picture")

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google account has no associated email",
        )

    # 3. Lookup or create User in PostgreSQL
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if user:
        user.last_login_at = now
        if name:
            user.full_name = name
        if picture:
            user.avatar_url = picture
        if google_sub:
            user.oauth_sub = google_sub
    else:
        role = (
            UserRole.ADMIN
            if settings.INITIAL_ADMIN_EMAIL
            and email.lower() == settings.INITIAL_ADMIN_EMAIL.lower()
            else UserRole.USER
        )
        user = User(
            id=str(uuid.uuid4()),
            email=email,
            full_name=name,
            role=role,
            avatar_url=picture,
            oauth_provider="google",
            oauth_sub=google_sub,
            created_at=now,
            last_login_at=now,
        )
        db.add(user)

    await db.commit()
    await db.refresh(user)

    # 4. Generate stateless JWT
    jwt_token = create_access_token(
        user_id=user.id,
        email=user.email,
        role=user.role,
    )

    # Set HTTP-only auth cookie
    response.set_cookie(
        key="auth_token",
        value=jwt_token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=60 * 60 * 24 * 7,
    )

    return AuthResponse(
        access_token=jwt_token,
        token_type="bearer",
        user=user.to_dict(),
    )


@router.post("/dev-login", response_model=AuthResponse)
async def dev_login(
    body: DevLoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Developer login endpoint for local testing without requiring immediate Google Cloud setup.
    Disabled automatically in production when ALLOW_DEV_LOGIN is False.
    """
    if not settings.ALLOW_DEV_LOGIN:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Developer login endpoint is disabled in production",
        )

    email = body.email.lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if user:
        user.last_login_at = now
        if body.role:
            user.role = body.role
        if body.name:
            user.full_name = body.name
    else:
        role = (
            body.role
            or (
                UserRole.ADMIN
                if settings.INITIAL_ADMIN_EMAIL
                and email == settings.INITIAL_ADMIN_EMAIL.lower()
                else UserRole.USER
            )
        )
        user = User(
            id=str(uuid.uuid4()),
            email=email,
            full_name=body.name or "Developer User",
            role=role,
            oauth_provider="google",
            created_at=now,
            last_login_at=now,
        )
        db.add(user)

    await db.commit()
    await db.refresh(user)

    jwt_token = create_access_token(
        user_id=user.id,
        email=user.email,
        role=user.role,
    )

    response.set_cookie(
        key="auth_token",
        value=jwt_token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=60 * 60 * 24 * 7,
    )

    return AuthResponse(
        access_token=jwt_token,
        token_type="bearer",
        user=user.to_dict(),
    )


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    """
    Returns authenticated user information and current role.
    """
    return current_user.to_dict()


@router.post("/logout")
async def logout(response: Response):
    """
    Clears the auth_token cookie.
    """
    response.delete_cookie(key="auth_token")
    return {"status": "success", "message": "Successfully logged out"}


@router.get("/verify")
async def verify_token(request: Request, current_user: User = Depends(get_current_user)):
    """
    Inter-service token verification and introspection endpoint.
    Allows other services or API gateways to validate tokens against auth_service.
    """
    return {
        "valid": True,
        "user_id": current_user.id,
        "email": current_user.email,
        "role": current_user.role.value if isinstance(current_user.role, UserRole) else str(current_user.role),
        "is_active": current_user.is_active,
    }
