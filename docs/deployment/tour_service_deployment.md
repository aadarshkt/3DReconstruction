# Guided Tour Microservice Deployment Guide

```
                         ┌─────────────────────────────────────────┐
                         │           Next.js Frontend              │
                         │           (Port 3000)                   │
                         └───────┬──────────────┬──────────┬───────┘
                                 │              │          │
            /jobs/*, /claims/*   │              │          │ /api/v1/tour/*
            (Real User Workload) │              │          │ (Demo & Walkthrough)
                                 ▼              │          ▼
            ┌───────────────────────────┐       │   ┌──────────────────────────┐
            │   Main Backend Service    │       │   │  Guided Tour Service     │
            │   (FastAPI - Port 8000)   │       │   │  (FastAPI - Port 8001)   │
            ├───────────────────────────┤       │   ├──────────────────────────┤
            │ • Stateless JWT Validate  │       │   │ • Zero DB Dependencies   │
            │ • Celery / Redis Workers  │       │   │ • Standalone Artifacts   │
            │ • COLMAP / Open3D / GPU   │       │   │ • Sub-10ms Response Time │
            │ • External LLM API Keys   │       │   │ • Self-Contained Engine  │
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

## 1. Overview & Advantages

The `tour_service` is an independent, lightweight FastAPI microservice designed to serve demo walkthrough datasets, interactive 3D spatial artifacts, ISO HO-3 policy analysis, itemized repair cost schedules, and conversational guidance.

- **Zero Database Dependencies**: All demo datasets and point clouds are self-contained in `artifacts/`.
- **Zero GPU / Heavy Compute Requirements**: Does not require COLMAP, CUDA, Open3D, or Celery.
- **Sub-10ms Latency**: Deterministic, instant responses ensure live demos never lag or fail.
- **Independent Blast Radius**: Can be deployed, scaled, or restarted without affecting the production database or user claims pipeline.

---

## 2. Directory Structure

```
tour_service/
├── Dockerfile                     # Standalone container build definition
├── requirements.txt               # Minimal Python dependencies (FastAPI, Uvicorn)
├── main.py                        # Standalone FastAPI entrypoint
├── router.py                      # Route definitions (/sample-claim, /chat, /artifacts)
├── service.py                     # Business logic and artifact loader
├── tour_service_deployment.md     # This deployment guide
└── artifacts/                     # Self-contained demo assets
    ├── floor_plan.svg             # 24.5 m² dimensioned floor plan with damage zone
    ├── point_cloud.ply            # 3D metric point cloud (1,168 vertices)
    ├── sample_ho3_policy.pdf      # Complete 22-page ISO HO-3 insurance contract
    ├── sample_policy.json         # ISO HO-3 legal analysis (Peril 12)
    ├── sample_cost_estimate.json  # Itemized repair schedule ($4,101.47 net payout)
    └── tour_metadata.json         # Metric bounds and error tolerances
```

---

## 3. Local Development (Standalone)

You can run the microservice standalone on its own port (e.g. `8001`) without running the main backend or database:

```bash
# 1. Navigate to tour_service directory
cd tour_service

# 2. Install dependencies (or activate existing virtualenv)
pip install -r requirements.txt

# 3. Start standalone Uvicorn server on port 8001
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

Verify service status:
```bash
curl http://localhost:8001/api/v1/tour/health
# {"status":"ok","service":"guided-tour-microservice","version":"1.0.0"}

curl http://localhost:8001/api/v1/tour/sample-claim | jq .status
# "success"
```

---

## 4. Docker Container Deployment

The microservice includes a minimal `Dockerfile` based on `python:3.11-slim` resulting in an image size under 130MB.

### Build and Run Locally
```bash
# 1. Build Docker image
docker build -t claimspace-tour-service:latest ./tour_service

# 2. Run container exposing port 8001
docker run -d \
  --name tour-service \
  --restart unless-stopped \
  -p 8001:8001 \
  claimspace-tour-service:latest

# 3. Check logs and health
docker logs tour-service
curl http://localhost:8001/api/v1/tour/health
```

---

## 5. Cloud Production Deployments

### A. AWS ECS (Elastic Container Service) / Fargate

1. **Tag & Push to Amazon ECR**:
   ```bash
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com
   docker tag claimspace-tour-service:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/tour-service:latest
   docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/tour-service:latest
   ```
2. **Task Definition Specifications**:
   - **CPU**: 256 (.25 vCPU)
   - **Memory**: 512 MB
   - **Container Port**: 8001
   - **Health Check Path**: `/api/v1/tour/health`
3. Attach to an Application Load Balancer (ALB) or route via CloudFront path `/api/v1/tour/*`.

---

### B. Google Cloud Run (Serverless Container)

Because the microservice is stateless, Cloud Run offers near-zero cost when idle and instantaneous autoscaling:

```bash
# Deploy directly from source
gcloud run deploy tour-service \
  --source ./tour_service \
  --platform managed \
  --region us-central1 \
  --port 8001 \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1
```

Once deployed, Google Cloud Run returns a service URL, e.g. `https://tour-service-xyz.a.run.app`.

---

### C. DigitalOcean App Platform / Render / Fly.io

1. Connect your Git repository.
2. Set **Root Directory**: `tour_service`
3. Set **DockerfilePath**: `Dockerfile`
4. Set **Port**: `8001`
5. Set **Health Check Path**: `/api/v1/tour/health`

---

## 6. Connecting the Frontend (Next.js)

The frontend uses standard environment variables in `frontend/next.config.ts` to route tour requests to the dedicated microservice:

### In `frontend/.env.local` (or Production Environment Variables):

```bash
# Main backend for production users, real uploads, Celery, and database:
BACKEND_URL=https://api.claimspace.com

# Dedicated Guided Tour microservice URL:
TOUR_SERVICE_URL=https://tour-api.claimspace.com
```

Next.js automatically proxies all `/api/v1/tour/*` calls directly to `TOUR_SERVICE_URL`:

```ts
// frontend/next.config.ts
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const TOUR_SERVICE_URL = process.env.TOUR_SERVICE_URL || BACKEND_URL;

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/v1/tour/:path*",
        destination: `${TOUR_SERVICE_URL}/api/v1/tour/:path*`,
      },
      {
        source: "/api/v1/:path*",
        destination: `${BACKEND_URL}/api/v1/:path*`,
      },
    ];
  },
};
```

---

## 7. Verification & Smoke Testing Checklist

Run these commands against your deployed instance:

```bash
TARGET_URL="http://localhost:8001" # or your production URL

# 1. Health check
curl -f -s "${TARGET_URL}/api/v1/tour/health" | jq .

# 2. Sample claim payload check
curl -f -s "${TARGET_URL}/api/v1/tour/sample-claim" | jq '.status, .reconstruction.room_area_m2'
# Expected: "success", 24.5

# 3. SVG artifact streaming check
curl -I -s "${TARGET_URL}/api/v1/tour/artifacts/floor_plan.svg" | grep "image/svg+xml"

# 4. PLY 3D point cloud streaming check
curl -s "${TARGET_URL}/api/v1/tour/artifacts/point_cloud.ply" | head -n 3
# Expected: "ply", "format ascii 1.0", "element vertex 1168"

# 5. Insurance Policy PDF contract streaming check
curl -i -s "${TARGET_URL}/api/v1/tour/artifacts/sample_ho3_policy.pdf" | grep -i "content-type: application/pdf"
# Expected: "content-type: application/pdf"

# 6. Tour Chat Assistant check
curl -s -X POST "${TARGET_URL}/api/v1/tour/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "Is water damage covered?"}' | jq .intent
# Expected: "policy_rag"
```
