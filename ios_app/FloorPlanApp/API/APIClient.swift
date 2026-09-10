import Foundation
import Combine

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Models
// ─────────────────────────────────────────────────────────────────────────────

enum Tier: String, Codable {
    case photos = "photos"
    case video  = "video"
    case lidar  = "lidar"
}

enum JobStatus: String, Codable {
    case created, uploading, queued
    case extractingFrames = "extracting_frames"
    case colmapSfm = "colmap_sfm"
    case colmapMvs = "colmap_mvs"
    case scaleAnchoring = "scale_anchoring"
    case lidarConverting = "lidar_converting"
    case planeExtraction = "plane_extraction"
    case vectorizing, exporting, complete, failed
    
    var displayName: String {
        switch self {
        case .created:          return "Created"
        case .uploading:        return "Uploading files…"
        case .queued:           return "Queued for processing"
        case .extractingFrames: return "Extracting video frames…"
        case .colmapSfm:        return "Running SfM reconstruction…"
        case .colmapMvs:        return "Running dense MVS…"
        case .scaleAnchoring:   return "Applying scale reference…"
        case .lidarConverting:  return "Converting LiDAR data…"
        case .planeExtraction:  return "Extracting planes (RANSAC)…"
        case .vectorizing:      return "Vectorizing walls…"
        case .exporting:        return "Exporting floor plan…"
        case .complete:         return "Complete ✓"
        case .failed:           return "Failed ✗"
        }
    }
}

struct CreateJobRequest: Encodable {
    let tier: Tier
    let scale_reference_m: Double?
}

struct JobResponse: Decodable {
    let job_id: String
    let tier: Tier
    let status: JobStatus
    let progress_pct: Int
    let scale_reference_m: Double?
    let room_area_m2: Double?
    let wall_count: Int?
    let error_message: String?
    let result_payload: ResultPayload?
}

struct ResultPayload: Decodable {
    let walls: [WallResult]
    let room_area_m2: Double?
    let wall_count: Int?
    let scale_confidence: String?
    let error_estimate: ErrorEstimate?
    let files: ResultFiles?
}

struct WallResult: Decodable, Identifiable {
    let id: Int
    let length_m: Double
    let start: [Double]
    let end: [Double]
    let has_opening: Bool
    let opening_type: String?
}

struct ErrorEstimate: Decodable {
    let method: String
    let expected_wall_error_cm: Double
}

struct ResultFiles: Decodable {
    let floor_plan_dxf: String?
    let floor_plan_svg: String?
    let point_cloud_ply: String?
    let validation_csv: String?
}

struct ProgressEvent: Decodable {
    let stage: String
    let pct: Int
    let result_url: String?
    let error: String?
    let heartbeat: Bool?
}

struct StartJobResponse: Decodable {
    let job_id: String
    let celery_task_id: String
    let message: String
}

struct ChunkUploadRequest: Encodable {
    let filename: String
    let chunk_index: Int
    let total_chunks: Int
    let data_base64: String
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - API Client
// ─────────────────────────────────────────────────────────────────────────────

/// Central REST + WebSocket client for all backend communication.
///
/// Configuration
/// ─────────────
/// Set `APIClient.shared.baseURL` to your Mac's LAN IP when testing on device.
/// Example: `http://192.168.1.10:8000`
///
/// For demo on same Mac: `http://localhost:8000`
class APIClient: NSObject, ObservableObject {
    
    static let shared = APIClient()
    
    // ── Configuration ─────────────────────────────────────────────────────────
    @Published var baseURL: String = UserDefaults.standard.string(forKey: "serverURL") ?? "http://localhost:8000" {
        didSet { UserDefaults.standard.set(baseURL, forKey: "serverURL") }
    }
    
    private let chunkSize = 5 * 1024 * 1024   // 5 MB per chunk
    private var decoder = JSONDecoder()
    private var encoder = JSONEncoder()
    private var webSocketTask: URLSessionWebSocketTask?
    
    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Job lifecycle
    // ─────────────────────────────────────────────────────────────────────────
    
    /// Create a new reconstruction job on the server.
    func createJob(tier: Tier, scaleReferenceMetre: Double?) async throws -> JobResponse {
        let url = URL(string: "\(baseURL)/jobs/create")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body = CreateJobRequest(tier: tier, scale_reference_m: scaleReferenceMetre)
        request.httpBody = try encoder.encode(body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        try _assertHTTP(response, data: data)
        return try decoder.decode(JobResponse.self, from: data)
    }
    
    /// Upload one or more files for a job using multipart/form-data.
    func uploadFiles(_ fileURLs: [URL], jobId: String) async throws {
        let url = URL(string: "\(baseURL)/jobs/\(jobId)/upload")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        
        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        
        var body = Data()
        for fileURL in fileURLs {
            let fileData = try Data(contentsOf: fileURL)
            let filename = fileURL.lastPathComponent
            let mime = _mimeType(for: fileURL)
            
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"files\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
            body.append("Content-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
            body.append(fileData)
            body.append("\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        
        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        try _assertHTTP(response, data: data)
    }
    
    /// Upload a large file (>5 MB) in chunks.
    func uploadFileChunked(
        _ fileURL: URL,
        jobId: String,
        progressHandler: @escaping (Double) -> Void
    ) async throws {
        let fileData = try Data(contentsOf: fileURL)
        let filename = fileURL.lastPathComponent
        let totalBytes = fileData.count
        let totalChunks = Int(ceil(Double(totalBytes) / Double(chunkSize)))
        
        for chunkIndex in 0 ..< totalChunks {
            let start = chunkIndex * chunkSize
            let end = min(start + chunkSize, totalBytes)
            let chunk = fileData[start ..< end]
            let b64 = chunk.base64EncodedString()
            
            let body = ChunkUploadRequest(
                filename: filename,
                chunk_index: chunkIndex,
                total_chunks: totalChunks,
                data_base64: b64
            )
            
            let url = URL(string: "\(baseURL)/jobs/\(jobId)/upload/chunk")!
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(body)
            
            let (data, response) = try await URLSession.shared.data(for: request)
            try _assertHTTP(response, data: data)
            
            progressHandler(Double(chunkIndex + 1) / Double(totalChunks))
        }
    }
    
    /// Trigger pipeline processing after uploads are complete.
    func startJob(jobId: String) async throws -> StartJobResponse {
        let url = URL(string: "\(baseURL)/jobs/\(jobId)/start")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        
        let (data, response) = try await URLSession.shared.data(for: request)
        try _assertHTTP(response, data: data)
        return try decoder.decode(StartJobResponse.self, from: data)
    }
    
    /// Poll job status once.
    func getJob(jobId: String) async throws -> JobResponse {
        let url = URL(string: "\(baseURL)/jobs/\(jobId)")!
        let (data, response) = try await URLSession.shared.data(from: url)
        try _assertHTTP(response, data: data)
        return try decoder.decode(JobResponse.self, from: data)
    }
    
    /// Fetch full result payload when job is complete.
    func getResults(jobId: String) async throws -> ResultPayload {
        let url = URL(string: "\(baseURL)/jobs/\(jobId)/results")!
        let (data, response) = try await URLSession.shared.data(from: url)
        try _assertHTTP(response, data: data)
        return try decoder.decode(ResultPayload.self, from: data)
    }
    
    /// Download a result file (DXF / SVG / PLY / CSV) to a temporary local URL.
    func downloadFile(path: String) async throws -> URL {
        let url = URL(string: "\(baseURL)\(path)")!
        let (localURL, response) = try await URLSession.shared.download(from: url)
        try _assertHTTP(response, data: nil)
        
        // Move to a stable temp location with correct extension
        let ext = URL(string: path)?.pathExtension ?? "dat"
        let dest = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension(ext)
        try FileManager.default.moveItem(at: localURL, to: dest)
        return dest
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // MARK: WebSocket progress stream
    // ─────────────────────────────────────────────────────────────────────────
    
    /// Open a WebSocket connection and yield ProgressEvents as an AsyncStream.
    ///
    /// Usage:
    /// ```swift
    /// for await event in apiClient.streamProgress(jobId: id) {
    ///     progressPct = event.pct
    ///     if event.stage == "complete" { break }
    /// }
    /// ```
    func streamProgress(jobId: String) -> AsyncStream<ProgressEvent> {
        AsyncStream { continuation in
            Task {
                let wsURL = URL(string: "\(baseURL)/jobs/\(jobId)/ws")!
                    .replacingScheme(with: "ws")
                
                let session = URLSession(configuration: .default)
                let wsTask = session.webSocketTask(with: wsURL)
                self.webSocketTask = wsTask
                wsTask.resume()
                
                func receive() {
                    wsTask.receive { result in
                        switch result {
                        case .success(let msg):
                            if case .string(let text) = msg,
                               let data = text.data(using: .utf8),
                               let event = try? JSONDecoder().decode(ProgressEvent.self, from: data) {
                                continuation.yield(event)
                                if event.stage == "complete" || event.stage == "failed" {
                                    continuation.finish()
                                    return
                                }
                            }
                            receive()   // keep listening
                            
                        case .failure:
                            continuation.finish()
                        }
                    }
                }
                receive()
            }
        }
    }
    
    func disconnectWebSocket() {
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // MARK: Helpers
    // ─────────────────────────────────────────────────────────────────────────
    
    private func _assertHTTP(_ response: URLResponse, data: Data?) throws {
        guard let http = response as? HTTPURLResponse else { return }
        if !(200...299).contains(http.statusCode) {
            let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? "no body"
            throw APIError.httpError(statusCode: http.statusCode, body: body)
        }
    }
    
    private func _mimeType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "jpg", "jpeg": return "image/jpeg"
        case "png":         return "image/png"
        case "mp4":         return "video/mp4"
        case "mov":         return "video/quicktime"
        case "usdz":        return "model/vnd.usdz+zip"
        case "json":        return "application/json"
        default:            return "application/octet-stream"
        }
    }
}

enum APIError: LocalizedError {
    case httpError(statusCode: Int, body: String)
    
    var errorDescription: String? {
        switch self {
        case .httpError(let code, let body): return "HTTP \(code): \(body)"
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - URL helpers
// ─────────────────────────────────────────────────────────────────────────────

extension URL {
    func replacingScheme(with newScheme: String) -> URL {
        var comps = URLComponents(url: self, resolvingAgainstBaseURL: false)!
        comps.scheme = newScheme
        return comps.url ?? self
    }
}
