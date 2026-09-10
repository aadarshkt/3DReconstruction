# Android Implementation Placeholder

> **Status**: Placeholder — iOS implementation is the primary path.
> Android support is architecturally planned and ready to integrate.

## Why Android Is Not Implemented Yet

The core blocker is **Tier C (LiDAR)**:
- Apple's **RoomPlan API** provides turn-key room scanning with metric
  wall/door/window geometry — no manual processing required.
- Google's **ARCore Depth API** (used on compatible Android phones) provides
  raw depth maps but does **not** have a semantic room understanding layer
  equivalent to RoomPlan.  Custom plane-fitting and room segmentation code
  would be needed on Android to replicate Tier C.

**Tier A (photos) and Tier B (video) work identically** — the backend handles
all processing.  An Android app for these two tiers can be implemented today
with minimal effort.

---

## Planned Android Architecture

### Technology Stack

| Layer | Library |
|---|---|
| Camera (Tier A) | CameraX + Photo Library |
| Video (Tier B) | CameraX video capture |
| Depth / LiDAR (Tier C) | ARCore Depth API + custom RANSAC |
| HTTP client | Retrofit 2 + OkHttp |
| WebSocket | OkHttp WebSocket |
| 3D Viewer | Filament (Google's physically-based renderer) |
| SVG Viewer | AndroidSVG |
| DXF Export | Share intent → third-party CAD app |

---

## Tier A + B Android Implementation Sketch

```kotlin
// app/src/main/java/com/floorplan/api/APIClient.kt

class APIClient(private val baseUrl: String) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(300, TimeUnit.SECONDS)   // long timeout for big uploads
        .build()

    private val retrofit = Retrofit.Builder()
        .baseUrl(baseUrl)
        .client(client)
        .addConverterFactory(GsonConverterFactory.create())
        .build()

    private val api = retrofit.create(FloorPlanAPI::class.java)

    // Create job
    suspend fun createJob(tier: String, scaleRefM: Double?): JobResponse {
        return api.createJob(CreateJobRequest(tier, scaleRefM))
    }

    // Upload files (multipart)
    suspend fun uploadFiles(jobId: String, files: List<File>) {
        val parts = files.map { file ->
            val requestBody = file.asRequestBody("image/jpeg".toMediaType())
            MultipartBody.Part.createFormData("files", file.name, requestBody)
        }
        api.uploadFiles(jobId, parts)
    }

    // Start pipeline
    suspend fun startJob(jobId: String): StartJobResponse = api.startJob(jobId)

    // WebSocket progress
    fun streamProgress(jobId: String, listener: WebSocketListener): WebSocket {
        val wsUrl = baseUrl.replace("http", "ws") + "/jobs/$jobId/ws"
        val request = Request.Builder().url(wsUrl).build()
        return client.newWebSocket(request, listener)
    }
}
```

```kotlin
// Retrofit interface
interface FloorPlanAPI {
    @POST("jobs/create")
    suspend fun createJob(@Body body: CreateJobRequest): JobResponse

    @Multipart
    @POST("jobs/{jobId}/upload")
    suspend fun uploadFiles(
        @Path("jobId") jobId: String,
        @Part files: List<MultipartBody.Part>
    ): UploadResponse

    @POST("jobs/{jobId}/start")
    suspend fun startJob(@Path("jobId") jobId: String): StartJobResponse

    @GET("jobs/{jobId}/results")
    suspend fun getResults(@Path("jobId") jobId: String): ResultPayload
}
```

---

## Tier C (LiDAR) on Android — ARCore Depth API

```kotlin
// PLACEHOLDER: Full implementation requires:
// 1. ARCore session with Depth API enabled
// 2. Per-frame depth image acquisition
// 3. Unproject depth pixels to 3D using camera intrinsics
// 4. Accumulate point cloud across frames
// 5. Export as PLY and upload to backend (same Tier A/B backend pipeline applies)

// The backend's common_backend.py will handle the rest.

// Reference: https://developers.google.com/ar/develop/depth

class ARCoreDepthCapture(context: Context) {
    private var session: Session? = null

    fun startSession() {
        // TODO: check ARCore availability
        // TODO: configure session with ArConfig.DepthMode.AUTOMATIC
        // TODO: accumulate depth frames into a point cloud
        // TODO: export PLY and upload
    }

    fun stopAndExport(): File {
        // TODO: write accumulated points to a .ply file
        // Return path for upload
        TODO("Android LiDAR / ARCore depth export not yet implemented")
    }
}
```

---

## File Structure (when implemented)

```
android_app/
├── app/
│   ├── src/main/java/com/floorplan/
│   │   ├── api/
│   │   │   ├── APIClient.kt
│   │   │   └── FloorPlanAPI.kt
│   │   ├── capture/
│   │   │   ├── PhotoCaptureFragment.kt     # Tier A
│   │   │   ├── VideoCaptureFragment.kt     # Tier B
│   │   │   └── ARCoreDepthCapture.kt       # Tier C (TODO)
│   │   ├── viewer/
│   │   │   ├── FloorPlanSVGViewer.kt       # AndroidSVG
│   │   │   └── PointCloud3DViewer.kt       # Filament
│   │   └── ui/
│   │       ├── JobProgressFragment.kt      # WebSocket progress
│   │       └── ResultsFragment.kt
│   └── src/main/res/
│       └── layout/...
├── build.gradle
└── README.md
```

---

## Connecting to the Same Backend

The Android app connects to **the exact same FastAPI backend** as iOS:

```
# Same endpoints, same protocol
POST http://192.168.1.10:8000/jobs/create
POST http://192.168.1.10:8000/jobs/{id}/upload
POST http://192.168.1.10:8000/jobs/{id}/start
 WS  ws://192.168.1.10:8000/jobs/{id}/ws
GET  http://192.168.1.10:8000/jobs/{id}/results
```

No backend changes are needed to support Android.

---

## Priority Recommendation

For a walk-in demo:
1. ✅ **iOS LiDAR** (RoomPlan — implemented)
2. ✅ **iOS Photos + Video** (implemented)
3. 🔲 **Android Photos + Video** — ~1 day to implement (uses same backend)
4. 🔲 **Android LiDAR (ARCore)** — ~1 week (custom depth accumulation)
