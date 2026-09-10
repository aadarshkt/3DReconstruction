import SwiftUI
import SceneKit
import WebKit

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Floor Plan Viewer (SVG via WKWebView)
// ─────────────────────────────────────────────────────────────────────────────

/// Renders the floor_plan.svg returned by the backend inside a WKWebView.
///
/// - Tap a wall to see its length in a callout.
/// - Pinch to zoom, drag to pan (native WebView behaviour).
struct FloorPlanViewer: View {
    let svgURL: URL
    @State private var selectedWall: WallResult?
    @Environment(\.dismiss) var dismiss
    
    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                SVGWebView(url: svgURL)
                    .ignoresSafeArea()
                
                // Measurement callout
                if let wall = selectedWall {
                    WallCallout(wall: wall)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .navigationTitle("Floor Plan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: svgURL) {
                        Image(systemName: "square.and.arrow.up")
                    }
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

struct SVGWebView: UIViewRepresentable {
    let url: URL
    
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let wv = WKWebView(frame: .zero, configuration: config)
        wv.scrollView.minimumZoomScale = 0.5
        wv.scrollView.maximumZoomScale = 4.0
        wv.backgroundColor = UIColor.systemBackground
        return wv
    }
    
    func updateUIView(_ wv: WKWebView, context: Context) {
        wv.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }
}

struct WallCallout: View {
    let wall: WallResult
    
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Wall \(wall.id)")
                    .font(.headline)
                Text(String(format: "%.2f m", wall.length_m))
                    .font(.title2.bold())
                    .foregroundStyle(.accentColor)
                if wall.has_opening, let type = wall.opening_type {
                    Label(type.capitalized, systemImage: type == "door" ? "door.left.hand.open" : "window.casement")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
        .padding()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - 3D Scene Viewer (PLY via SceneKit)
// ─────────────────────────────────────────────────────────────────────────────

/// Loads and displays the `scan_metric.ply` point cloud in a SceneKit scene.
///
/// - Orbit / pan / zoom via built-in SceneView camera control.
/// - Point cloud rendered as small sphere sprites for clarity.
struct Scene3DViewer: UIViewRepresentable {
    let plyURL: URL
    
    func makeUIView(context: Context) -> SCNView {
        let scnView = SCNView()
        scnView.autoenablesDefaultLighting = true
        scnView.allowsCameraControl = true
        scnView.backgroundColor = .black
        scnView.antialiasingMode = .multisampling4X
        
        // Load point cloud on background thread
        Task.detached(priority: .userInitiated) {
            let scene = await Self.buildScene(plyURL: plyURL)
            await MainActor.run {
                scnView.scene = scene
                scnView.defaultCameraController.interactionMode = .orbitTurntable
            }
        }
        
        return scnView
    }
    
    func updateUIView(_ scnView: SCNView, context: Context) {}
    
    static func buildScene(plyURL: URL) async -> SCNScene {
        let scene = SCNScene()
        
        // Read PLY header to get vertex count
        guard let points = parsePLYPoints(plyURL) else { return scene }
        
        // Create a point cloud geometry using SCNGeometry
        var positions: [SCNVector3] = []
        var colors: [SCNVector3] = []
        
        for point in points.prefix(500_000) {   // cap for performance
            positions.append(SCNVector3(point.x, point.y, point.z))
            let (r, g, b) = point.color ?? (200, 220, 255)
            colors.append(SCNVector3(Float(r) / 255, Float(g) / 255, Float(b) / 255))
        }
        
        let posSource = SCNGeometrySource(vertices: positions)
        let colSource = SCNGeometrySource(
            data: Data(bytes: colors, count: colors.count * MemoryLayout<SCNVector3>.stride),
            semantic: .color,
            vectorCount: colors.count,
            usesFloatComponents: true,
            componentsPerVector: 3,
            bytesPerComponent: MemoryLayout<Float>.size,
            dataOffset: 0,
            dataStride: MemoryLayout<SCNVector3>.stride
        )
        
        let indices = Array(0..<positions.count).map { UInt32($0) }
        let element = SCNGeometryElement(
            indices: indices, primitiveType: .point
        )
        element.pointSize = 2
        element.minimumPointScreenSpaceRadius = 1
        element.maximumPointScreenSpaceRadius = 5
        
        let geometry = SCNGeometry(sources: [posSource, colSource], elements: [element])
        geometry.firstMaterial?.lightingModel = .constant
        
        let node = SCNNode(geometry: geometry)
        scene.rootNode.addChildNode(node)
        
        // Add a camera pointing at the centroid
        let cameraNode = SCNNode()
        cameraNode.camera = SCNCamera()
        let centroid = positions.reduce(SCNVector3(0,0,0)) {
            SCNVector3($0.x + $1.x, $0.y + $1.y, $0.z + $1.z)
        }
        cameraNode.position = SCNVector3(
            centroid.x / Float(positions.count),
            centroid.y / Float(positions.count) + 2,
            centroid.z / Float(positions.count) + 5
        )
        scene.rootNode.addChildNode(cameraNode)
        
        return scene
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - PLY parser (minimal ASCII + binary little-endian support)
// ─────────────────────────────────────────────────────────────────────────────

struct PLYPoint {
    let x, y, z: Float
    let color: (UInt8, UInt8, UInt8)?
}

func parsePLYPoints(_ url: URL) -> [PLYPoint]? {
    guard let content = try? String(contentsOf: url, encoding: .utf8) else { return nil }
    var lines = content.components(separatedBy: "\n")
    
    // Parse header
    var vertexCount = 0
    var headerLines = 0
    var hasColor = false
    
    for (i, line) in lines.enumerated() {
        if line.hasPrefix("element vertex") {
            vertexCount = Int(line.components(separatedBy: " ").last ?? "0") ?? 0
        }
        if line.hasPrefix("property uchar red") { hasColor = true }
        if line == "end_header" { headerLines = i + 1; break }
    }
    
    guard vertexCount > 0 else { return nil }
    
    var points: [PLYPoint] = []
    for i in headerLines ..< min(headerLines + vertexCount, lines.count) {
        let parts = lines[i].trimmingCharacters(in: .whitespaces)
            .components(separatedBy: .whitespaces)
        guard parts.count >= 3,
              let x = Float(parts[0]),
              let y = Float(parts[1]),
              let z = Float(parts[2]) else { continue }
        
        var color: (UInt8, UInt8, UInt8)? = nil
        if hasColor && parts.count >= 6 {
            color = (UInt8(parts[3]) ?? 200, UInt8(parts[4]) ?? 220, UInt8(parts[5]) ?? 255)
        }
        points.append(PLYPoint(x: x, y: y, z: z, color: color))
    }
    
    return points
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Job Progress View
// ─────────────────────────────────────────────────────────────────────────────

/// Full-screen progress view that opens a WebSocket connection and shows
/// real-time pipeline stage updates.
struct JobProgressView: View {
    let jobId: String
    let tier: Tier
    @StateObject private var viewModel: JobProgressViewModel
    @Environment(\.dismiss) var dismiss
    
    init(jobId: String, tier: Tier) {
        self.jobId = jobId
        self.tier = tier
        _viewModel = StateObject(wrappedValue: JobProgressViewModel(jobId: jobId))
    }
    
    var body: some View {
        ZStack {
            // Animated background gradient
            LinearGradient(
                colors: [Color(hex: "0f0c29"), Color(hex: "302b63"), Color(hex: "24243e")],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            
            VStack(spacing: 32) {
                Spacer()
                
                // Animated scanning icon
                ZStack {
                    Circle()
                        .stroke(Color.white.opacity(0.1), lineWidth: 2)
                        .frame(width: 120, height: 120)
                    Circle()
                        .trim(from: 0, to: viewModel.progressFraction)
                        .stroke(
                            AngularGradient(colors: [.purple, .blue, .cyan], center: .center),
                            style: StrokeStyle(lineWidth: 4, lineCap: .round)
                        )
                        .frame(width: 120, height: 120)
                        .rotationEffect(.degrees(-90))
                        .animation(.easeInOut(duration: 0.5), value: viewModel.progressFraction)
                    
                    Image(systemName: tierIcon)
                        .font(.system(size: 40))
                        .foregroundStyle(.white)
                }
                
                // Stage label
                VStack(spacing: 8) {
                    Text(viewModel.currentStageLabel)
                        .font(.title3.bold())
                        .foregroundStyle(.white)
                        .animation(.default, value: viewModel.currentStageLabel)
                    
                    Text("\(viewModel.progressPct)%")
                        .font(.system(size: 48, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.9))
                }
                
                // Stage log
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(viewModel.stageLog, id: \.self) { entry in
                            HStack(spacing: 8) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                                    .font(.caption)
                                Text(entry)
                                    .font(.caption)
                                    .foregroundStyle(.white.opacity(0.8))
                            }
                        }
                    }
                    .padding(.horizontal)
                }
                .frame(height: 100)
                
                Spacer()
                
                // Action buttons
                if viewModel.isComplete {
                    NavigationLink(destination: ResultsView(jobId: jobId)) {
                        Label("View Results", systemImage: "eye.fill")
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(.white)
                            .foregroundStyle(.black)
                            .clipShape(Capsule())
                    }
                    .padding(.horizontal, 32)
                } else if viewModel.isFailed {
                    Text(viewModel.errorMessage ?? "Unknown error")
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding()
                    Button("Dismiss") { dismiss() }
                        .buttonStyle(.bordered)
                }
            }
            .padding()
        }
        .navigationBarBackButtonHidden(!viewModel.isComplete && !viewModel.isFailed)
        .task { await viewModel.startListening() }
    }
    
    var tierIcon: String {
        switch tier {
        case .photos: return "camera.fill"
        case .video:  return "video.fill"
        case .lidar:  return "lidar.camera"
        }
    }
}

@MainActor
class JobProgressViewModel: ObservableObject {
    let jobId: String
    @Published var progressPct: Int = 0
    @Published var currentStageLabel: String = "Starting…"
    @Published var stageLog: [String] = []
    @Published var isComplete = false
    @Published var isFailed = false
    @Published var errorMessage: String?
    
    var progressFraction: Double { Double(progressPct) / 100.0 }
    
    init(jobId: String) { self.jobId = jobId }
    
    func startListening() async {
        for await event in APIClient.shared.streamProgress(jobId: jobId) {
            progressPct = event.pct
            currentStageLabel = JobStatus(rawValue: event.stage)?.displayName ?? event.stage
            if !stageLog.contains(currentStageLabel) {
                stageLog.append(currentStageLabel)
            }
            if event.stage == "complete" { isComplete = true; break }
            if event.stage == "failed"   {
                isFailed = true
                errorMessage = event.error
                break
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Results View
// ─────────────────────────────────────────────────────────────────────────────

struct ResultsView: View {
    let jobId: String
    @StateObject private var viewModel: ResultsViewModel
    @State private var showFloorPlan = false
    @State private var show3DViewer = false
    @State private var localSVGURL: URL?
    @State private var localPLYURL: URL?
    @State private var localDXFURL: URL?
    
    init(jobId: String) {
        self.jobId = jobId
        _viewModel = StateObject(wrappedValue: ResultsViewModel(jobId: jobId))
    }
    
    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                
                // ── Room summary card ─────────────────────────────────────────
                if let result = viewModel.result {
                    SummaryCard(result: result)
                    
                    // ── Wall list ─────────────────────────────────────────────
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Walls")
                            .font(.headline)
                            .padding([.horizontal, .top])
                        
                        ForEach(result.walls) { wall in
                            WallRow(wall: wall)
                            Divider().padding(.leading)
                        }
                    }
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                    
                    // ── Error estimate ────────────────────────────────────────
                    if let err = result.error_estimate {
                        ErrorEstimateCard(estimate: err, confidence: result.scale_confidence ?? "")
                    }
                    
                    // ── File downloads ────────────────────────────────────────
                    VStack(spacing: 12) {
                        if let files = result.files {
                            if let svgPath = files.floor_plan_svg {
                                DownloadButton(
                                    label: "View Floor Plan",
                                    icon: "map.fill",
                                    color: .blue
                                ) {
                                    Task {
                                        localSVGURL = try? await APIClient.shared.downloadFile(path: svgPath)
                                        showFloorPlan = localSVGURL != nil
                                    }
                                }
                            }
                            if let plyPath = files.point_cloud_ply {
                                DownloadButton(label: "View 3D Point Cloud", icon: "cube.fill", color: .purple) {
                                    Task {
                                        localPLYURL = try? await APIClient.shared.downloadFile(path: plyPath)
                                        show3DViewer = localPLYURL != nil
                                    }
                                }
                            }
                            if let dxfPath = files.floor_plan_dxf {
                                DownloadButton(label: "Export DXF (CAD)", icon: "doc.badge.arrow.up", color: .orange) {
                                    Task { localDXFURL = try? await APIClient.shared.downloadFile(path: dxfPath) }
                                }
                            }
                        }
                    }
                }
                
                if viewModel.isLoading {
                    ProgressView("Loading results…")
                }
                
                if let error = viewModel.errorMessage {
                    Text(error).foregroundStyle(.red)
                }
            }
            .padding()
        }
        .navigationTitle("Results")
        .task { await viewModel.loadResults() }
        .sheet(isPresented: $showFloorPlan) {
            if let url = localSVGURL { FloorPlanViewer(svgURL: url) }
        }
        .sheet(isPresented: $show3DViewer) {
            if let url = localPLYURL {
                NavigationStack {
                    Scene3DViewer(plyURL: url)
                        .ignoresSafeArea()
                        .navigationTitle("3D Point Cloud")
                        .navigationBarTitleDisplayMode(.inline)
                }
            }
        }
        .sheet(item: $localDXFURL) { url in
            ShareSheet(url: url)
        }
    }
}

@MainActor
class ResultsViewModel: ObservableObject {
    let jobId: String
    @Published var result: ResultPayload?
    @Published var isLoading = true
    @Published var errorMessage: String?
    
    init(jobId: String) { self.jobId = jobId }
    
    func loadResults() async {
        do {
            result = try await APIClient.shared.getResults(jobId: jobId)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Results sub-components
// ─────────────────────────────────────────────────────────────────────────────

struct SummaryCard: View {
    let result: ResultPayload
    
    var body: some View {
        HStack {
            StatCell(value: String(format: "%.1f m²", result.room_area_m2 ?? 0),
                     label: "Floor Area")
            Divider().frame(height: 40)
            StatCell(value: "\(result.wall_count ?? 0)", label: "Walls")
            Divider().frame(height: 40)
            StatCell(value: result.scale_confidence == "native_metric" ? "LiDAR" : "Scaled",
                     label: "Metric Source")
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
    }
}

struct StatCell: View {
    let value: String; let label: String
    var body: some View {
        VStack {
            Text(value).font(.title3.bold())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

struct WallRow: View {
    let wall: WallResult
    
    var body: some View {
        HStack {
            Label("Wall \(wall.id)", systemImage: "square.dashed")
            Spacer()
            Text(String(format: "%.2f m", wall.length_m))
                .font(.subheadline.bold())
                .foregroundStyle(.accentColor)
            if wall.has_opening, let t = wall.opening_type {
                Image(systemName: t == "door" ? "door.left.hand.open" : "window.casement")
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }
}

struct ErrorEstimateCard: View {
    let estimate: ErrorEstimate
    let confidence: String
    
    var body: some View {
        HStack {
            Image(systemName: "chart.bar.fill")
                .foregroundStyle(.orange)
            VStack(alignment: .leading) {
                Text("Expected Error")
                    .font(.caption).foregroundStyle(.secondary)
                Text(String(format: "≈ %.1f cm", estimate.expected_wall_error_cm))
                    .font(.subheadline.bold())
            }
            Spacer()
            Text(confidence == "native_metric" ? "LiDAR ✓" : "Scale ref")
                .font(.caption)
                .padding(6)
                .background(confidence == "native_metric" ? Color.green.opacity(0.2) : Color.orange.opacity(0.2))
                .clipShape(Capsule())
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
    }
}

struct DownloadButton: View {
    let label: String; let icon: String; let color: Color
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            Label(label, systemImage: icon)
                .frame(maxWidth: .infinity)
                .padding()
                .background(color.opacity(0.15))
                .foregroundStyle(color)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(color.opacity(0.3), lineWidth: 1))
                .cornerRadius(12)
        }
    }
}

// ShareSheet for DXF export
struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

// MARK: - URL Identifiable for sheet
extension URL: Identifiable {
    public var id: String { absoluteString }
}

// MARK: - Color hex init
extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: .alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        self.init(
            red:   Double((int >> 16) & 0xFF) / 255,
            green: Double((int >> 8)  & 0xFF) / 255,
            blue:  Double(int         & 0xFF) / 255
        )
    }
}
