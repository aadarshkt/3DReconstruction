import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.security import create_access_token, decode_access_token
from app.models.user import UserRole


@pytest.mark.asyncio
async def test_jwt_token_generation_and_decoding():
    token = create_access_token(
        user_id="usr-12345",
        email="test@example.com",
        role=UserRole.USER,
    )
    assert isinstance(token, str)
    payload = decode_access_token(token)
    assert payload["sub"] == "usr-12345"
    assert payload["email"] == "test@example.com"
    assert payload["role"] == "user"


@pytest.mark.asyncio
async def test_stateless_rbac_user_forbidden_from_admin_endpoint():
    user_token = create_access_token(
        user_id="usr-regular",
        email="regular_user@example.com",
        role=UserRole.USER,
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        seed_forbidden = await client.post(
            "/api/v1/claims/seed-demo",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert seed_forbidden.status_code == 403
        assert "Forbidden" in seed_forbidden.json()["detail"]


@pytest.mark.asyncio
async def test_stateless_rbac_unauthenticated_rejected():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        seed_unauth = await client.post(
            "/api/v1/claims/seed-demo",
        )
        assert seed_unauth.status_code == 401
