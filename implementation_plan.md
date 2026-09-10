# Implementation Plan: Phone-Capture-to-Dimensioned-Floor-Plan Pipeline

## Overview

A full-stack system that transforms phone-captured photos, video, or LiDAR scans into metric-accurate 2D floor plans and 3D digital twins. The system consists of:
- A **Python processing backend** (FastAPI) that runs the COLMAP + Open3D pipeline
- A **REST/WebSocket API** for mobile communication
- A **Swift iOS app** (RoomPlan + capture UI + result viewer)
- A **React web dashboard** for viewing results on desktop

---

## Open Questions

> [!IMPORTANT]
> **Q1**: Do you want the backend to run **locally on a Mac/Linux server** (demo/research mode) or deployed to a **cloud server** (AWS/GCP/Render)?
> - Local: zero hosting cost, requires the Mac to be on and reachable; best for walk-in test demos
> - Cloud: scalable, always-on, needed for real production use

> [!IMPORTANT]
> **Q2**: For the iOS app, should it support **Tier A (photos), Tier B (video), and Tier C (LiDAR/RoomPlan)** all three, or start with **LiDAR only** (fastest path to a working demo)?

> [!IMPORTANT]
> **Q3**: For result visualization, do you want:
> - Option A: **In-app viewer** (AR overlay, SceneKit 3D viewer)
> - Option B: **Web link sent to phone** (opens a browser-based 3D viewer)
> - Option C: **Both**

> [!NOTE]
> **Q4**: Is there a preference for the database — SQLite (simple, file-based, fine for demos) vs PostgreSQL (production-grade)?

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  iOS App (Swift)                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────────┐   │
│  │  Camera  │  │  Video   │  │  RoomPlan / ARKit LiDAR      │   │
│  │  Photos  │  │  Capture │  │  (native metric export)      │   │
│  └────┬─────┘  └────┬─────┘  └──────────────┬───────────────┘   │
│       └─────────────┴─────────────────────── │                   │
│                     │ multipart upload / WS  │                   │
└─────────────────────┼────────────────────────┼───────────────────┘
                      │ HTTPS / WebSocket       │
┌─────────────────────▼────────────────────────▼───────────────────┐
│  FastAPI Backend (Python)                                         │
│                                                                   │
│  POST /jobs/create          → create job, return job_id           │
│  POST /jobs/{id}/upload     → receive files (chunked)             │
│  POST /jobs/{id}/start      → enqueue pipeline                    │
│  GET  /jobs/{id}/status     → poll or WS push for progress        │
│  GET  /jobs/{id}/results    → download DXF / PLY / SVG / JSON     │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  Celery Worker (async task queue)                        │     │
│  │                                                          │     │
│  │  Tier Router                                             │     │
│  │  ├── Tier A/B: COLMAP pipeline → scale → .ply            │     │
│  │  └── Tier C: USDZ/mesh → convert → .ply                 │     │
│  │                                                          │     │
│  │  Common Backend (Open3D)                                 │     │
│  │  ├── RANSAC plane extraction (floor/ceiling/walls)       │     │
│  │  ├── Wall vectorization + 90° snapping                   │     │
│  │  ├── Opening detection (doors/windows)                   │     │
│  │  └── Export: DXF + SVG + PLY + JSON                      │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                   │
│  Storage: local filesystem (dev) / S3-compatible (prod)           │
│  DB: SQLite (dev) / PostgreSQL (prod)                             │
└───────────────────────────────────────────────────────────────────┘
                      │
          ┌───────────┴────────────┐
          │                        │
┌─────────▼──────────┐  ┌─────────▼──────────┐
│  iOS Result Viewer │  │  Web Dashboard      │
│  - SceneKit 3D     │  │  - Three.js 3D PLY  │
│  - Floor plan SVG  │  │  - SVG floor plan   │
│  - Measurements    │  │  - Download DXF     │
│  - AR overlay      │  │  - Error table CSV  │
└────────────────────┘  └─────────────────────┘
```

---

## Proposed Changes

### Component 1 — Project Structure

```
3DReconstruction/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry point
│   │   ├── api/
│   │   │   ├── jobs.py          # Job CRUD endpoints
│   │   │   ├── uploads.py       # File upload handling
│   │   │   └── results.py       # Result delivery
│   │   ├── pipeline/
│   │   │   ├── tier_router.py   # Dispatch A/B/C
│   │   │   ├── tier_a_b.py      # COLMAP pipeline
│   │   │   ├── tier_c.py        # LiDAR/USDZ converter
│   │   │   ├── common_backend.py # Open3D + wall extraction
│   │   │   ├── vectorizer.py    # Wall segments → 2D lines
│   │   │   ├── exporter.py      # DXF / SVG / JSON export
│   │   │   └── validator.py     # Error measurement harness
│   │   ├── models/
│   │   │   └── job.py           # SQLAlchemy Job model
│   │   ├── tasks/
│   │   │   └── celery_tasks.py  # Async task definitions
│   │   └── config.py
│   ├── requirements.txt
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── ios_app/
│   ├── FloorPlanApp/
│   │   ├── Capture/
│   │   │   ├── PhotoCaptureView.swift
│   │   │   ├── VideoCaptureView.swift
│   │   │   └── LiDARCaptureView.swift   # RoomPlan
│   │   ├── Upload/
│   │   │   └── UploadManager.swift      # Chunked multipart
│   │   ├── Viewer/
│   │   │   ├── FloorPlanViewer.swift    # SVG + DXF render
│   │   │   └── Scene3DViewer.swift      # SceneKit PLY viewer
│   │   └── API/
│   │       └── APIClient.swift          # REST + WebSocket
│
└── web_dashboard/
    ├── index.html
    ├── viewer.js                # Three.js PLY + SVG viewer
    └── style.css
```

---

### Component 2 — Backend: Input Handling

#### How inputs are received

**Tier A — Photos:**
1. App creates a job: `POST /jobs/create` → returns `{job_id, upload_url}`
2. App uploads images as **chunked multipart** form-data (each image as a separate part, or zipped):
   ```
   POST /jobs/{job_id}/upload
   Content-Type: multipart/form-data
   
   files[]: img001.jpg
   files[]: img002.jpg
   ...
   scale_reference_m: 0.297   # A4 short side in metres (optional)
   tier: "photos"
   ```
3. Backend streams each file to disk: `data/{job_id}/images/`
4. App triggers processing: `POST /jobs/{job_id}/start`

**Tier B — Video:**
```
POST /jobs/{job_id}/upload
Content-Type: multipart/form-data

video: walkthrough.mp4
fps_extract: 3
scale_reference_m: 0.297
tier: "video"
```
Backend runs `ffmpeg` to extract frames into `data/{job_id}/images/`, then feeds COLMAP the same way as Tier A.

**Tier C — LiDAR:**
```
POST /jobs/{job_id}/upload
Content-Type: multipart/form-data

roomplan_export: room.usdz   # or room.json (RoomPlan CapturedRoom)
tier: "lidar"
```
No scale reference needed. The USDZ/JSON already contains metric coordinates.

#### How inputs are merged (multi-tier fusion)

When both photos AND a LiDAR scan are uploaded for the same room, `tier_router.py` runs cross-tier fusion:
1. Reconstruct Tier A/B → unscaled PLY
2. Parse Tier C USDZ → metric PLY
3. Run **ICP (Iterative Closest Point)** via Open3D to align the unscaled cloud to the LiDAR cloud:
   ```python
   reg = o3d.pipelines.registration.registration_icp(
       source=photo_pcd, target=lidar_pcd,
       max_correspondence_distance=0.05,
       estimation_method=o3d.pipelines.registration.TransformationEstimationPointToPoint()
   )
   scale_factor = derive_scale_from_transformation(reg.transformation)
   ```
4. The derived scale replaces the manual reference, and both clouds are merged into one denser point cloud before the common backend runs.

---

### Component 3 — Backend: Processing Pipeline (Celery Worker)

```
Job enqueued
    │
    ▼
Tier Router
    ├── Tier A/B → COLMAP auto_reconstructor → dense/fused.ply
    │              → scale anchor → scan_metric.ply
    └── Tier C  → parse USDZ/JSON → sample surface → scan_metric.ply
    │
    ▼
Common Backend (Open3D)
    ├── RANSAC plane extraction (floor, ceiling, walls[])
    ├── Project wall inliers to z=1.3m horizontal slice
    ├── Fit 2D lines → wall_segments[(x1,y1,x2,y2)]
    ├── 90° angle snapping
    ├── Opening detection (gaps in density profile)
    └── Room polygon closure
    │
    ▼
Exporter
    ├── floor_plan.dxf    (ezdxf — dimensioned CAD file)
    ├── floor_plan.svg    (svgwrite — preview image)
    ├── scan_metric.ply   (Open3D — downloadable 3D cloud)
    └── results.json      (wall segments, room area, error estimate, confidence)
    │
    ▼
Job status → "complete" (pushed via WebSocket)
```

#### Progress reporting via WebSocket

```
Client connects: WS /jobs/{job_id}/ws

Server pushes:
{"stage": "uploading",        "pct": 10}
{"stage": "extracting_frames","pct": 20}
{"stage": "colmap_sfm",       "pct": 35}
{"stage": "colmap_mvs",       "pct": 60}
{"stage": "plane_extraction", "pct": 75}
{"stage": "vectorizing",      "pct": 85}
{"stage": "exporting",        "pct": 95}
{"stage": "complete",         "pct": 100, "result_url": "/jobs/{id}/results"}
```

---

### Component 4 — Results: What is Delivered and How It's Shown

#### API response

```
GET /jobs/{job_id}/results
→ {
    "job_id": "abc123",
    "status": "complete",
    "tier": "photos",
    "scale_confidence": "scaled_via_reference",
    "room_area_m2": 18.4,
    "wall_count": 6,
    "walls": [
      {"id": 1, "length_m": 4.12, "start": [0,0], "end": [4.12,0], "has_opening": true, "opening_type": "door"},
      {"id": 2, "length_m": 3.85, ...},
      ...
    ],
    "error_estimate": {
      "method": "scale_propagation",
      "expected_wall_error_cm": 3.5
    },
    "files": {
      "floor_plan_dxf": "/jobs/abc123/files/floor_plan.dxf",
      "floor_plan_svg": "/jobs/abc123/files/floor_plan.svg",
      "point_cloud_ply": "/jobs/abc123/files/scan_metric.ply",
      "validation_csv":  "/jobs/abc123/files/validation.csv"
    }
  }
```

#### iOS App Result Viewer

1. **Floor Plan Tab**: Render `floor_plan.svg` in a `WKWebView` or `SVGKit`. Tap any wall to see its measured length.
2. **3D Viewer Tab**: Load `scan_metric.ply` into a `SCNScene` (SceneKit) with orbit/pan/zoom gestures.
3. **AR Tab**: Place the reconstructed room as an AR overlay using `RealityKit` + the floor plan JSON.
4. **Export Tab**: Share `floor_plan.dxf` via iOS share sheet (opens in AutoCAD, Shapr3D, etc.).

#### Web Dashboard Result Viewer

- **Three.js PLY Viewer**: Loads `scan_metric.ply` for interactive 3D orbit/zoom in browser.
- **SVG Floor Plan**: Inline SVG with click-to-measure wall annotations.
- **Error Table**: Validation CSV rendered as a color-coded HTML table.
- **Download buttons**: DXF, SVG, PLY, CSV.

---

### Component 5 — Mobile ↔ Backend Connection

#### Connection modes

| Scenario | Connection | Notes |
|---|---|---|
| Walk-in demo / local | LAN (Wi-Fi), backend on Mac | Backend binds to `0.0.0.0:8000`; phone connects via Mac's LAN IP |
| Development | USB tunnel (`iproxy`) or ngrok | Easiest for dev on same Mac |
| Production | HTTPS on cloud server | TLS termination via nginx reverse proxy |

#### iOS API Client (`APIClient.swift`)

```swift
class APIClient {
    let base = "http://192.168.1.10:8000"  // configurable via settings

    func createJob(tier: Tier) async throws -> String { ... }     // returns job_id
    func uploadFiles(_ urls: [URL], jobId: String) async throws { ... }  // chunked multipart
    func startJob(_ jobId: String) async throws { ... }
    func streamProgress(_ jobId: String) -> AsyncStream<ProgressEvent> { ... }  // WebSocket
    func fetchResults(_ jobId: String) async throws -> JobResult { ... }
    func downloadFile(_ url: String) async throws -> Data { ... }
}
```

#### Upload flow (chunked for large files)

Large videos or dense photo sets are uploaded in **5 MB chunks**:
```
POST /jobs/{id}/upload/chunk
{
  "chunk_index": 0,
  "total_chunks": 12,
  "filename": "walkthrough.mp4",
  "data": <base64 or raw bytes>
}
```
Backend assembles chunks and begins processing only after the final chunk arrives.

---

### Component 6 — [NEW] `backend/app/main.py`
FastAPI application entry point with CORS, routers, and lifespan.

### Component 7 — [NEW] `backend/app/pipeline/common_backend.py`
Open3D RANSAC plane extraction, wall vectorization, opening detection.

### Component 8 — [NEW] `backend/app/pipeline/tier_a_b.py`
COLMAP subprocess wrapper + ffmpeg frame extraction + scale anchoring.

### Component 9 — [NEW] `backend/app/pipeline/tier_c.py`
USDZ/JSON parser for RoomPlan exports, mesh-to-point-cloud conversion.

### Component 10 — [NEW] `backend/app/pipeline/exporter.py`
DXF (ezdxf), SVG (svgwrite), JSON, and CSV validation report generation.

### Component 11 — [NEW] `ios_app/FloorPlanApp/`
Swift iOS application with capture, upload, progress WebSocket, and result viewers.

### Component 12 — [NEW] `web_dashboard/`
Single-page HTML/JS dashboard with Three.js 3D viewer and SVG floor plan viewer.

### Component 13 — [NEW] `backend/docker-compose.yml`
Orchestrates FastAPI + Celery worker + Redis (broker) + SQLite volume.

---

## Implementation Phases

### Phase 1 — Backend Foundation (Days 1-2)
- [ ] FastAPI skeleton with job CRUD, file upload, SQLite
- [ ] Celery + Redis for async task queue
- [ ] Tier A/B: COLMAP subprocess wrapper + scale anchoring
- [ ] Common backend: RANSAC planes → wall segments → DXF/SVG export
- [ ] `/results` endpoint returning JSON + file downloads
- [ ] WebSocket progress streaming

### Phase 2 — iOS App (Days 3-4)
- [ ] Photo/Video capture UI (AVFoundation)
- [ ] LiDAR capture (RoomPlan API)
- [ ] Chunked upload manager (`URLSession`)
- [ ] WebSocket progress listener
- [ ] SVG floor plan viewer (WKWebView)
- [ ] PLY 3D viewer (SceneKit)
- [ ] Export share sheet

### Phase 3 — Web Dashboard (Day 5)
- [ ] Three.js PLY loader + orbital controls
- [ ] SVG inline floor plan with wall annotations
- [ ] Error/validation table
- [ ] Download buttons

### Phase 4 — Integration & Validation (Day 6)
- [ ] End-to-end test: photo capture → upload → COLMAP → floor plan → view on phone
- [ ] Validation harness: tape measure vs pipeline output CSV
- [ ] Error table generation
- [ ] Tier C (LiDAR) end-to-end test

### Phase 5 — Polish & Production (Day 7+)
- [ ] Docker-compose deployment
- [ ] TLS + nginx reverse proxy for cloud deployment
- [ ] Multi-tier fusion (ICP scale derivation)
- [ ] Human-in-the-loop wall correction UI

---

## Verification Plan

### Automated Tests
```bash
# Backend unit tests
cd backend && pytest tests/ -v

# API integration test (with a sample PLY)
python tests/test_pipeline.py --input tests/fixtures/sample_room.ply

# End-to-end smoke test
curl -X POST http://localhost:8000/jobs/create -d '{"tier":"photos"}'
```

### Manual Verification
1. Capture a known room (e.g., 4m × 5m office) with iPhone camera
2. Upload via iOS app → observe WebSocket progress updates
3. View result floor plan on device — verify wall count and topology
4. Download DXF → open in a CAD viewer
5. Compare pipeline wall lengths vs tape measurements → verify < 5 cm error
6. Verify LiDAR tier produces < 3 cm error

---

## Tech Stack Summary

| Layer | Technology |
|---|---|
| Backend API | Python 3.11 + FastAPI |
| Task Queue | Celery + Redis |
| 3D Processing | Open3D, COLMAP, ffmpeg |
| CAD Export | ezdxf, svgwrite |
| Database | SQLite (dev) → PostgreSQL (prod) |
| Storage | Local filesystem (dev) → S3 (prod) |
| iOS App | Swift 5.9, SwiftUI, RoomPlan, ARKit, SceneKit |
| Web Dashboard | Vanilla HTML/CSS/JS + Three.js |
| Deployment | Docker Compose + nginx |
| Mobile → Server | REST (HTTPS) + WebSocket (wss://) |
