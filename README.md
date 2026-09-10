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

## 🚀 Quick Start (Docker Backend)

The entire backend (PostgreSQL, Redis, FastAPI, and Celery Worker with **COLMAP, FFmpeg, and Open3D** pre-installed) runs seamlessly in Docker. You do **not** need to manually install COLMAP or PostgreSQL on your Mac.

Use the `./run.sh` control panel script to manage the lifecycle and test the pipeline:

### 1. Start the Backend

Start all four backend containers (`db`, `redis`, `api`, `worker`):

```bash
# Option A: Run in background (recommended)
./run.sh start -d

# Option B: Run in foreground (streams logs directly; Ctrl+C stops gracefully)
./run.sh start
```

### 2. Manage the Backend Containers

```bash
# View live logs of all services (or specify: worker, api, db, redis)
./run.sh logs
./run.sh logs worker

# Check status and health of containers
./run.sh status

# Restart backend containers
./run.sh restart

# Stop all backend containers
./run.sh stop
```

Once started:
- **API Docs (Swagger)**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/health
- **Web Dashboard**: Open `web_dashboard/index.html` directly in your browser.

---

## 🧪 Testing the Pipeline (End-to-End)

Once your backend is running, you can open a **new terminal window** and use the test commands to simulate exactly what the iOS app does. 

### Tier A: Photos
Submit 25-40 overlapping `.jpg` photos. You must provide a **scale reference** (in meters) representing the length of a known object in the scene. You can supply either an entire folder of images or individual files:
```bash
# Option 1: Pass an image folder (Recommended)
./run.sh test photos 0.297 ./my_room_photos/

# Option 2: Pass individual image files
./run.sh test photos 0.297 img1.jpg img2.jpg img3.jpg
```

### Tier B: Video
Submit a single `.mp4` or `.mov` walkthrough video. Requires a **scale reference** in meters.
```bash
./run.sh test video 1.0 my_room_scan.mp4
```

### Tier C: LiDAR (RoomPlan)
Submit an Apple RoomPlan `.json` or `.usdz` export. Because LiDAR is natively scaled in meters, **no scale argument is required**.
```bash
./run.sh test lidar my_room.json
```

### Hybrid Fusion (Video + LiDAR)
Submit both COLMAP data (Video/Photos) and LiDAR data. The backend will intelligently run both pipelines and fuse them using Iterative Closest Point (ICP), taking the perfect scale from LiDAR and the photorealism from the video.
```bash
./run.sh test hybrid my_room.json my_video.mp4
```

---

## 📊 Viewing the Results

When a test script finishes successfully, open `web_dashboard/index.html` in your browser. Enter the **Job ID** provided at the end of the test script output to view the 3D Point Cloud and the 2D SVG floor plan.

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
