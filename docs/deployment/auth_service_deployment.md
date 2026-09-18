# Authentication Microservice Deployment Guide

```
                         ┌─────────────────────────────────────────┐
                         │           Next.js Frontend              │
                         │           (Port 3000)                   │
                         └───────┬──────────────┬──────────┬───────┘
                                 │              │          │
            /jobs/*, /claims/*   │              │          │ /api/v1/tour/*
            (3D / Insurance)     │              │          │ (Demo & Walkthrough)
                                 ▼              │          ▼
            ┌───────────────────────────┐       │   ┌──────────────────────────┐
            │   Main Backend Service    │       │   │  Guided Tour Service     │
            │   (FastAPI - Port 8000)   │       │   │  (FastAPI - Port 8001)   │
            ├───────────────────────────┤       │   ├──────────────────────────┤
            │ • Stateless JWT Validate  │       │   │ • Zero DB Dependencies   │
            │ • COLMAP / Open3D / GPU   │       │   │ • Standalone Artifacts   │
            │ • Celery Worker Pipeline  │       │   │ • Sub-10ms Response Time │
            └───────────────────────────┘       │   └──────────────────────────┘
                                                │
                                 /api/v1/auth/* │
                                 (Identity/OIDC)▼
                                    ┌──────────────────────────┐
                                    │    Auth Microservice     │
                                    │  (FastAPI - Port 8002)   │
                                    ├──────────────────────────┤
                                    │ • Google OAuth 2.0 / OIDC│
                                    │ • RBAC Role Management   │
                                    │ • JWT Issuance & Verify  │
                                    │ • PostgreSQL Users Table │
                                    └──────────────────────────┘
```

---

## 1. Overview & Architectural Role

The `auth_service` is an independent, dedicated FastAPI microservice responsible for:
- **Google OAuth 2.0 / OIDC Authentication**: Generates consent URLs and exchanges authorization codes with Google token endpoints.
- **Session & Identity Management**: Issues signed HMAC SHA-256 JWT access tokens and manages secure, HTTP-only cookies.
- **Role-Based Access Control (RBAC)**: Persists and enforces user roles (`admin` vs `user`) in PostgreSQL.
- **Inter-Service Verification**: Provides a lightweight `/verify` endpoint for ingress gateways or microservices to introspect tokens.
- **Isolated Footprint**: Minimal Docker image size under 120MB, sub-millisecond response times, and zero dependency on heavy C++ spatial libraries (COLMAP, OpenCV, Open3D).

---

## 2. Directory Structure

```
auth_service/
├── Dockerfile                  # Standalone lightweight container definition
├── requirements.txt            # Minimal Python dependencies (FastAPI, PyJWT, SQLAlchemy, asyncpg)
├── config.py                   # Environment configuration (OAuth secrets, JWT secret, DB URL)
├── models.py                   # SQLAlchemy User model & UserRole enum
├── database.py                 # Async database session engine & pool
├── security.py                 # Token creation, decoding, and RBAC dependencies
├── router.py                   # Route definitions (/google/url, /google/callback, /dev-login, /me, /logout, /verify)
├── main.py                     # Standalone FastAPI entrypoint (Port 8002)
└── tests/
    └── test_auth_service.py    # Unit & integration test suite
```

---

## 3. Local Development (Standalone)

You can run the auth microservice standalone on port `8002`:

```bash
# 1. Navigate to auth_service directory
cd auth_service

# 2. Start standalone Uvicorn server on port 8002
uvicorn main:app --host 0.0.0.0 --port 8002 --reload
```

### Health Check:
```bash
curl http://localhost:8002/api/v1/auth/health
# {"status":"ok","service":"claimspace-auth-microservice","version":"1.0.0"}
```

### Developer 1-Click Login:
```bash
curl -X POST http://localhost:8002/api/v1/auth/dev-login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@claimspace.com", "name": "Lead Admin", "role": "admin"}'
```

### Token Verification:
```bash
curl http://localhost:8002/api/v1/auth/me \
  -H "Authorization: Bearer <TOKEN>"
```

---

## 4. Docker Container Deployment

### Build and Run Standalone Container
```bash
# 1. Build Docker image
docker build -t claimspace-auth-service:latest ./auth_service

# 2. Run container exposing port 8002
docker run -d \
  --name auth-service \
  --restart unless-stopped \
  -p 8002:8002 \
  -e DATABASE_URL="postgresql+asyncpg://floorplan:floorplan_secret@host.docker.internal:5432/floorplan" \
  -e JWT_SECRET_KEY="super_secret_jwt_key_claimspace_change_in_production_2026" \
  claimspace-auth-service:latest

# 3. Check logs
docker logs auth-service
```

---

## 5. Next.js Routing Integration

In `frontend/next.config.ts`, requests starting with `/api/v1/auth/` are routed to the auth microservice:

```ts
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || "http://localhost:8002";

// next.config.ts rewrites:
{
  source: "/api/v1/auth/:path*",
  destination: `${AUTH_SERVICE_URL}/api/v1/auth/:path*`,
}
```

This ensures frontend client code in `AuthContext.tsx` requires zero path modifications.

---

## 6. AWS Production Deployment (ALB + ECS Fargate)

In AWS production:
- Deploy `auth_service` as a dedicated ECS Fargate task with **0.25 vCPU / 512MB RAM**.
- Configure the Application Load Balancer (ALB) with listener priority rules:
  1. **Priority 10**: `PathPattern = /api/v1/auth*` ➔ `auth-service-target-group` (Port 8002)
  2. **Priority 20**: `PathPattern = /api/v1/tour*` ➔ `tour-service-target-group` (Port 8001)
  3. **Priority 30**: `PathPattern = /api/*`, `/jobs/*`, `/claims/*` ➔ `backend-target-group` (Port 8000)
  4. **Priority 100**: Default `*` ➔ `frontend-target-group` (Port 3000)
