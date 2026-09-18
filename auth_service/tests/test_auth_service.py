import pytest
from httpx import AsyncClient, ASGITransport

try:
    from auth_service.main import app
    from auth_service.security import create_access_token, decode_access_token
    from auth_service.models import UserRole
except ImportError:
    from main import app
    from security import create_access_token, decode_access_token
    from models import UserRole


@pytest.mark.asyncio
async def test_auth_service_health():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/v1/auth/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["service"] == "claimspace-auth-microservice"


@pytest.mark.asyncio
async def test_jwt_token_generation_and_decoding():
    token = create_access_token(
        user_id="usr-test-999",
        email="developer@claimspace.com",
        role=UserRole.ADMIN,
    )
    assert isinstance(token, str)
    payload = decode_access_token(token)
    assert payload["sub"] == "usr-test-999"
    assert payload["email"] == "developer@claimspace.com"
    assert payload["role"] == "admin"


@pytest.mark.asyncio
async def test_unauthenticated_request_rejected():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/v1/auth/me")
        assert res.status_code == 401


@pytest.mark.asyncio
async def test_dev_login_flow():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Dev login as user
        user_res = await client.post(
            "/api/v1/auth/dev-login",
            json={"email": "alice@claimspace.com", "name": "Alice User", "role": "user"},
        )
        assert user_res.status_code == 200
        user_data = user_res.json()
        user_token = user_data["access_token"]
        assert user_data["user"]["role"] == "user"

        # Check /me with Bearer token
        me_res = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert me_res.status_code == 200
        assert me_res.json()["email"] == "alice@claimspace.com"

        # Check /verify endpoint
        verify_res = await client.get(
            "/api/v1/auth/verify",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert verify_res.status_code == 200
        assert verify_res.json()["valid"] is True
        assert verify_res.json()["role"] == "user"

        # Logout
        logout_res = await client.post("/api/v1/auth/logout")
        assert logout_res.status_code == 200
