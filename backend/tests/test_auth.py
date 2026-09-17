import pytest
import pytest_asyncio
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
async def test_unauthenticated_request_rejected():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/v1/auth/me")
        assert res.status_code == 401


@pytest.mark.asyncio
async def test_rbac_user_vs_admin():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Dev login as standard user
        user_res = await client.post(
            "/api/v1/auth/dev-login",
            json={"email": "regular_user@example.com", "name": "Regular User", "role": "user"},
        )
        assert user_res.status_code == 200
        user_token = user_res.json()["access_token"]
        assert user_res.json()["user"]["role"] == "user"

        # 2. Check /me as user
        me_res = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert me_res.status_code == 200
        assert me_res.json()["email"] == "regular_user@example.com"
        assert me_res.json()["role"] == "user"

        # 3. User attempts admin-only seed endpoint -> 403 Forbidden
        seed_forbidden = await client.post(
            "/api/v1/claims/seed-demo",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert seed_forbidden.status_code == 403
        assert "Forbidden" in seed_forbidden.json()["detail"]

        # 4. Dev login as Admin
        admin_res = await client.post(
            "/api/v1/auth/dev-login",
            json={"email": "super_admin@example.com", "name": "Super Admin", "role": "admin"},
        )
        assert admin_res.status_code == 200
        admin_token = admin_res.json()["access_token"]
        assert admin_res.json()["user"]["role"] == "admin"

        # 5. Admin /me check
        admin_me = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert admin_me.status_code == 200
        assert admin_me.json()["role"] == "admin"
