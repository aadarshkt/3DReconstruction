# 3D Reconstruction System — Architecture & Request Lifecycle

## System Architecture

```mermaid
graph TB
    subgraph CLIENT["📱 Client Layer"]
        direction TB
        IOS["iOS App (Swift/SwiftUI)"]
        WEB["Web Dashboard (HTML + Three.js)"]

        subgraph IOS_MODULES["iOS Modules"]
            CAM["📷 PhotoCaptureView\nAVFoundation"]
            VID["🎬 VideoCaptureView\nAVFoundation"]
            LIDAR["📡 LiDARCaptureView\nRoomPlan API"]
            UPLOAD["⬆️ UploadManager\nChunked Multipart (5 MB)"]
            APICLIENT["🔌 APIClient.swift\nREST + WebSocket"]
            FPV["🗺️ FloorPlanViewer\nSVG / WKWebView"]
            S3DV["🌐 Scene3DViewer\nSceneKit PLY"]
            ARV["🕶️ AR Tab\nRealityKit Overlay"]
        end

        subgraph WEB_MODULES["Web Modules"]
            THREEJS["Three.js PLY Viewer\n3D orbit/zoom"]
            SVGVIEW["SVG Floor Plan\nClick-to-measure"]
            ERRTABLE["Error Table\nValidation CSV"]
        end
    end

    subgraph NETWORK["🌐 Network Layer"]
        HTTPS["HTTPS / REST\nMultipart Upload"]
        WS["WebSocket\nwss:// Progress Stream"]
        NGINX["nginx\nTLS Termination\nReverse Proxy"]
    end

    subgraph BACKEND["🖥️ FastAPI Backend (Python 3.11)"]
        direction TB

        subgraph API["REST API Routes"]
            R1["POST /jobs/create"]
            R2["POST /jobs/{id}/upload"]
            R3["POST /jobs/{id}/start"]
            R4["GET  /jobs/{id}/status"]
            R5["GET  /jobs/{id}/results"]
            R6["WS   /jobs/{id}/ws"]
        end

        subgraph QUEUE["⚙️ Task Queue"]
            REDIS["Redis\nMessage Broker"]
            CELERY["Celery Worker\nAsync Task Executor"]
        end

        subgraph PIPELINE["🔄 Processing Pipeline"]
            ROUTER["Tier Router\ntier_router.py"]

            subgraph TIER_AB["Tier A/B — COLMAP Path"]
                FFMPEG["ffmpeg\nFrame Extraction (3fps)"]
                COLMAP["COLMAP\nSfM + Dense MVS\nauto_reconstructor"]
                SCALE["Scale Anchor\nref_len / recon_len"]
            end

            subgraph TIER_C["Tier C — LiDAR Path"]
                USDZ["USDZ / JSON Parser\nRoomPlan CapturedRoom"]
                MESH2PLY["Mesh → Point Cloud\nSurface Sampling"]
            end

            subgraph COMMON["Common Backend — Open3D"]
                RANSAC["RANSAC Plane Extraction\nFloor → Ceiling → Walls[]"]
                PROJ["Project Wall Inliers\nz = 1.2–1.5 m slice"]
                LINEFIT["2D Line Fitting\nLeast-Squares / RANSAC"]
                SNAP["90° Angle Snapping\nDominant axis clustering"]
                OPENING["Opening Detection\nDensity gap analysis"]
                CLOSURE["Room Polygon Closure"]
            end

            subgraph EXPORTER["📦 Exporter"]
                DXF["floor_plan.dxf\nezdxf — dimensioned CAD"]
                SVG["floor_plan.svg\nsvgwrite — preview"]
                PLY["scan_metric.ply\nOpen3D — 3D cloud"]
                JSON_OUT["results.json\nwalls + area + confidence"]
                CSV["validation.csv\nerror harness report"]
            end
        end

        subgraph STORAGE["💾 Storage"]
            FS["Local Filesystem\ndata/{job_id}/"]
            DB["SQLite (dev)\nPostgreSQL (prod)"]
            S3["S3-Compatible\n(prod)"]
        end
    end

    IOS --> UPLOAD --> APICLIENT
    CAM --> UPLOAD
    VID --> UPLOAD
    LIDAR --> UPLOAD

    APICLIENT -- HTTPS --> NGINX
    WEB -- HTTPS --> NGINX
    APICLIENT -- WebSocket --> NGINX

    NGINX --> API
    NGINX --> R6

    R1 --> DB
    R2 --> FS
    R3 --> REDIS
    R4 --> DB
    R5 --> FS

    REDIS --> CELERY
    CELERY --> ROUTER

    ROUTER --> TIER_AB
    ROUTER --> TIER_C

    FFMPEG --> COLMAP
    COLMAP --> SCALE
    USDZ --> MESH2PLY

    SCALE --> RANSAC
    MESH2PLY --> RANSAC

    RANSAC --> PROJ --> LINEFIT --> SNAP --> OPENING --> CLOSURE

    CLOSURE --> DXF
    CLOSURE --> SVG
    CLOSURE --> PLY
    CLOSURE --> JSON_OUT
    CLOSURE --> CSV

    DXF --> FS
    SVG --> FS
    PLY --> FS
    JSON_OUT --> FS
    CSV --> FS

    CELERY -- WS push --> R6

    R5 --> FPV
    R5 --> S3DV
    R5 --> ARV

    R5 --> THREEJS
    R5 --> SVGVIEW
    R5 --> ERRTABLE

    style CLIENT fill:#1a1a2e,stroke:#7c3aed,color:#e2e8f0
    style NETWORK fill:#0f172a,stroke:#0ea5e9,color:#e2e8f0
    style BACKEND fill:#0d1b2a,stroke:#10b981,color:#e2e8f0
    style PIPELINE fill:#0a1628,stroke:#f59e0b,color:#e2e8f0
    style COMMON fill:#0f1f35,stroke:#f59e0b,color:#e2e8f0
    style TIER_AB fill:#0f1f35,stroke:#60a5fa,color:#e2e8f0
    style TIER_C fill:#0f1f35,stroke:#34d399,color:#e2e8f0
    style EXPORTER fill:#0f1f35,stroke:#fb7185,color:#e2e8f0
    style STORAGE fill:#0f1f35,stroke:#a78bfa,color:#e2e8f0
    style QUEUE fill:#0f1f35,stroke:#f97316,color:#e2e8f0
    style API fill:#0f1f35,stroke:#38bdf8,color:#e2e8f0
    style IOS_MODULES fill:#1e1040,stroke:#7c3aed,color:#e2e8f0
    style WEB_MODULES fill:#1e1040,stroke:#7c3aed,color:#e2e8f0
```

---

## Single Request Lifecycle — Photo Tier (Tier A) End-to-End

```mermaid
sequenceDiagram
    autonumber

    actor User
    participant iOS as iOS App<br/>(APIClient.swift)
    participant nginx as nginx<br/>(TLS Proxy)
    participant API as FastAPI<br/>(jobs.py / uploads.py)
    participant DB as SQLite / PostgreSQL
    participant FS as Filesystem<br/>data/{job_id}/
    participant Redis as Redis Broker
    participant Celery as Celery Worker
    participant COLMAP as COLMAP<br/>(subprocess)
    participant Open3D as Common Backend<br/>(Open3D)
    participant Exporter as Exporter<br/>(ezdxf / svgwrite)
    participant WS as WebSocket<br/>/jobs/{id}/ws

    Note over User,iOS: ── PHASE 1: Job Creation ──

    User->>iOS: Tap "Scan" → select photos + A4 reference
    iOS->>nginx: POST /jobs/create { tier: "photos" }
    nginx->>API: forward
    API->>DB: INSERT job(status=created, tier=photos)
    DB-->>API: job_id = "abc123"
    API-->>iOS: { job_id: "abc123", upload_url: "/jobs/abc123/upload" }

    Note over User,iOS: ── PHASE 2: File Upload (chunked 5 MB) ──

    iOS->>nginx: POST /jobs/abc123/upload/chunk (chunk 0/12)
    nginx->>API: forward
    API->>FS: write chunk → data/abc123/images/img001_part0
    loop Remaining chunks
        iOS->>API: POST chunk N/12
        API->>FS: append chunk
    end
    API->>FS: assemble → data/abc123/images/img001.jpg … img040.jpg
    API->>DB: UPDATE job(status=uploaded, scale_ref=0.297m)
    API-->>iOS: 200 OK "upload complete"

    Note over User,iOS: ── PHASE 3: Start & Progress Streaming ──

    iOS->>nginx: POST /jobs/abc123/start
    API->>Redis: enqueue task(job_id=abc123)
    API->>DB: UPDATE job(status=queued)
    API-->>iOS: 202 Accepted

    iOS->>WS: WS connect /jobs/abc123/ws
    WS-->>iOS: { stage: "queued", pct: 5 }

    Note over Celery,COLMAP: ── PHASE 4: Tier A/B Pipeline ──

    Redis->>Celery: dequeue task abc123
    Celery->>WS: push { stage: "extracting_frames", pct: 10 }
    Celery->>COLMAP: subprocess: colmap automatic_reconstructor<br/>--workspace_path data/abc123<br/>--image_path data/abc123/images/
    Celery->>WS: push { stage: "colmap_sfm", pct: 35 }
    COLMAP-->>Celery: sparse/ model done
    Celery->>WS: push { stage: "colmap_mvs", pct: 60 }
    COLMAP-->>Celery: dense/fused.ply written

    Note over Celery,Open3D: Scale Anchoring
    Celery->>Celery: measure ref object in unscaled PLY<br/>scale = 0.297 / reconstructed_len
    Celery->>FS: write scan_metric.ply (scaled)
    Celery->>DB: UPDATE job(scale_confidence="scaled_via_reference")

    Note over Celery,Open3D: ── PHASE 5: Common Backend ──

    Celery->>Open3D: load scan_metric.ply
    Celery->>WS: push { stage: "plane_extraction", pct: 75 }
    Open3D->>Open3D: RANSAC → extract floor plane
    Open3D->>Open3D: RANSAC → extract ceiling plane
    loop Each dominant wall plane
        Open3D->>Open3D: RANSAC → extract wall_i plane
        Open3D->>Open3D: project inliers to z=1.3m slice
        Open3D->>Open3D: 2D line fit → (x1,y1,x2,y2)
        Open3D->>Open3D: 90° angle snap
        Open3D->>Open3D: gap density scan → detect door/window
    end
    Open3D->>Open3D: close room polygon

    Celery->>WS: push { stage: "vectorizing", pct: 85 }

    Note over Celery,Exporter: ── PHASE 6: Export ──

    Celery->>Exporter: wall_segments + metadata
    Celery->>WS: push { stage: "exporting", pct: 95 }
    Exporter->>FS: write floor_plan.dxf
    Exporter->>FS: write floor_plan.svg
    Exporter->>FS: write results.json
    Exporter->>FS: write validation.csv

    Celery->>DB: UPDATE job(status=complete)
    Celery->>WS: push { stage: "complete", pct: 100, result_url: "/jobs/abc123/results" }

    Note over User,iOS: ── PHASE 7: Result Delivery ──

    WS-->>iOS: { stage: "complete", pct: 100 }
    iOS->>nginx: GET /jobs/abc123/results
    API->>DB: SELECT job WHERE id=abc123
    API->>FS: resolve file paths
    API-->>iOS: results JSON (walls[], area_m2, files{})

    iOS->>iOS: render FloorPlanViewer (SVG)
    iOS->>iOS: load Scene3DViewer (PLY → SceneKit)
    iOS->>iOS: enable AR Tab (RealityKit)
    User->>iOS: tap wall → see length annotation
    User->>iOS: tap Export → share floor_plan.dxf
```

---

## Component Inventory

| # | Component | Technology | Role |
|---|-----------|-----------|------|
| 1 | **PhotoCaptureView** | Swift / AVFoundation | Capture overlapping photos |
| 2 | **VideoCaptureView** | Swift / AVFoundation | Record walkthrough video |
| 3 | **LiDARCaptureView** | Swift / RoomPlan API | Native metric scan on LiDAR devices |
| 4 | **UploadManager** | URLSession / Multipart | Chunked 5 MB upload with retry |
| 5 | **APIClient** | Swift async/await + URLSessionWebSocketTask | REST calls + WebSocket progress stream |
| 6 | **nginx** | nginx | TLS termination, reverse proxy |
| 7 | **FastAPI** | Python 3.11 / uvicorn | REST API, job orchestration |
| 8 | **SQLite / PostgreSQL** | SQLAlchemy ORM | Job state, metadata |
| 9 | **Redis** | Redis | Celery message broker |
| 10 | **Celery Worker** | Celery | Async pipeline execution |
| 11 | **Tier Router** | `tier_router.py` | Dispatch to A/B or C path |
| 12 | **ffmpeg** | CLI subprocess | Frame extraction from video |
| 13 | **COLMAP** | CLI subprocess | SfM sparse + MVS dense reconstruction |
| 14 | **Scale Anchor** | NumPy | Derive metric scale from reference object |
| 15 | **USDZ/JSON Parser** | `tier_c.py` | Decode RoomPlan export to point cloud |
| 16 | **RANSAC Extractor** | Open3D | Segment floor, ceiling, wall planes |
| 17 | **Wall Vectorizer** | `vectorizer.py` | Project inliers → 2D line segments |
| 18 | **90° Snapper** | NumPy | Orthogonality correction heuristic |
| 19 | **Opening Detector** | `common_backend.py` | Gap density → door / window labels |
| 20 | **Exporter** | ezdxf, svgwrite | DXF + SVG + JSON + CSV output |
| 21 | **WebSocket Push** | FastAPI WebSocket | Real-time pipeline progress (0–100%) |
| 22 | **FloorPlanViewer** | WKWebView / SVGKit | SVG floor plan with tap-to-measure |
| 23 | **Scene3DViewer** | SceneKit | PLY point cloud 3D orbit/zoom |
| 24 | **AR Overlay** | RealityKit | Place floor plan in physical space |
| 25 | **Web Dashboard** | Three.js + Vanilla JS | Browser-based 3D + SVG viewer |

---

## Data Flow Summary

```mermaid
flowchart LR
    A["📷 Photos / 🎬 Video / 📡 LiDAR"]
    B["Metric Point Cloud\nscan_metric.ply"]
    C["Structural Elements\nfloor · ceiling · walls[]"]
    D["2D Wall Segments\n(x1,y1)→(x2,y2) + openings"]
    E["Outputs\nDXF · SVG · PLY · JSON · CSV"]

    A -->|"Tier A/B: COLMAP + scale\nTier C: USDZ parse"| B
    B -->|"RANSAC plane extraction"| C
    C -->|"Project + line-fit + snap"| D
    D -->|"ezdxf / svgwrite"| E

    style A fill:#7c3aed,color:#fff,stroke:#7c3aed
    style B fill:#0ea5e9,color:#fff,stroke:#0ea5e9
    style C fill:#10b981,color:#fff,stroke:#10b981
    style D fill:#f59e0b,color:#fff,stroke:#f59e0b
    style E fill:#fb7185,color:#fff,stroke:#fb7185
```

---

## Accuracy & Confidence Matrix

| Tier | Input | Scale Source | Expected Wall Error | Confidence Flag |
|------|-------|-------------|--------------------|----|
| **A — Photos** | 25–40 JPEG | Reference object (A4/door) | ≤ 5 cm | `scaled_via_reference` |
| **B — Video** | frames @ 3 fps | Reference object | ≤ 7 cm | `scaled_via_reference` |
| **C — LiDAR** | USDZ / RoomPlan JSON | Native metric | ≤ 3 cm | `native_metric` |
| **A+C Fusion** | Photos + USDZ | ICP alignment | ≤ 3 cm | `fusion_icp` |
