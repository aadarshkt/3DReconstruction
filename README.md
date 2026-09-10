# Phone-Capture-to-Floor-Plan Pipeline

A full-stack system for reconstructing metric-accurate 2D floor plans and 3D digital twins from phone-captured photos, video, or LiDAR scans.

---

## Architecture

```
iPhone (SwiftUI App)
    │  HTTPS + WebSocket
    ▼
FastAPI Backend (Python)
    ├── Celery Worker → COLMAP → Open3D → ezdxf
    ├── PostgreSQL (job state + results)
    └── Redis (task queue + WS progress bridge)
         │
         ▼ result files (DXF, SVG, PLY, CSV)
Web Dashboard (Three.js + vanilla HTML)
```

---

## Quick Start (Local, macOS)

```bash
# 1. Clone and bootstrap
chmod +x setup_local.sh && ./setup_local.sh

# 2. Start FastAPI server
cd backend && source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 3. Start Celery worker (new terminal)
cd backend && source .venv/bin/activate
celery -A app.tasks.celery_tasks worker --loglevel=info

# 4. Open web dashboard
open web_dashboard/index.html

# 5. API docs / Swagger UI
open http://localhost:8000/docs
```

---

## Project Structure

```
3DReconstruction/
├── setup_local.sh                    # One-shot local bootstrap
│
├── backend/                          # Python FastAPI backend
│   ├── app/
│   │   ├── main.py                   # FastAPI entry point
│   │   ├── config.py                 # Settings (env vars)
│   │   ├── models/job.py             # PostgreSQL ORM model
│   │   ├── api/
│   │   │   ├── jobs.py               # Job CRUD + WebSocket
│   │   │   ├── uploads.py            # File upload + start
│   │   │   └── results.py            # Result delivery
│   │   ├── pipeline/
│   │   │   ├── tier_router.py        # Tier dispatch + ICP fusion
│   │   │   ├── tier_a_b.py           # COLMAP + ffmpeg (photos/video)
│   │   │   ├── tier_c.py             # RoomPlan JSON + USDZ (LiDAR)
│   │   │   ├── common_backend.py     # RANSAC planes → wall segments
│   │   │   └── exporter.py           # DXF + SVG + JSON + CSV
│   │   └── tasks/celery_tasks.py     # Async Celery task
│   ├── alembic/                      # DB migrations
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── .env.example
│
├── ios_app/FloorPlanApp/             # Swift iOS app
│   ├── API/APIClient.swift           # REST + WebSocket client
│   ├── Capture/CaptureViews.swift    # Tier A/B/C capture UIs
│   └── Viewer/ViewerViews.swift      # SVG / SceneKit / AR viewers
│
├── android_app/
│   └── ANDROID_PLACEHOLDER.md       # ARCore/Retrofit sketch
│
├── web_dashboard/                    # Browser result viewer
│   ├── index.html
│   ├── style.css
│   └── viewer.js                     # Three.js PLY + SVG viewer
│
└── floor_plan_pipeline_implementation.md  # Original requirements
```

---

## Input Tiers

| Tier | Input | Scale | Notes |
|---|---|---|---|
| A — Photos | 25–40 overlapping JPEGs | Manual reference object | COLMAP SfM + MVS |
| B — Video | Walkthrough MP4/MOV | Manual reference object | ffmpeg → COLMAP |
| C — LiDAR | RoomPlan JSON + USDZ | Native metric | iPhone 12 Pro+ |

---

## API Overview

| Endpoint | Method | Description |
|---|---|---|
| `/jobs/create` | POST | Create job, return job_id |
| `/jobs/{id}/upload` | POST | Upload files (multipart) |
| `/jobs/{id}/upload/chunk` | POST | Upload single chunk (large files) |
| `/jobs/{id}/start` | POST | Enqueue pipeline |
| `/jobs/{id}` | GET | Poll job status |
| `/jobs/{id}/ws` | WS | Real-time progress stream |
| `/jobs/{id}/results` | GET | Structured result JSON |
| `/jobs/{id}/files/{name}` | GET | Download DXF/SVG/PLY/CSV |
| `/health` | GET | Health check |

---

## Connecting iPhone to Local Backend

```
# Find your Mac's LAN IP:
ipconfig getifaddr en0

# Set in iOS app Settings or code:
APIClient.shared.baseURL = "http://192.168.x.x:8000"

# Make sure Mac firewall allows port 8000
```

---

## Expected Accuracy

| Tier | Typical Error |
|---|---|
| LiDAR (RoomPlan) | ~1–3 cm |
| Video (COLMAP) | ~3–7 cm |
| Photos (COLMAP) | ~2–5 cm |
