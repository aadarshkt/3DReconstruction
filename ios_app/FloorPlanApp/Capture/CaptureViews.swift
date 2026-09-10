import SwiftUI
import PhotosUI
import AVFoundation

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Photo Capture View (Tier A)
// ─────────────────────────────────────────────────────────────────────────────

/// Full-featured photo capture view for Tier A.
///
/// User picks 25–40 overlapping photos from the photo library or captures them
/// directly with the camera.  A reference object length is entered to enable
/// metric scale anchoring.
struct PhotoCaptureView: View {
    @StateObject private var viewModel = PhotoCaptureViewModel()
    @Binding var selectedFileURLs: [URL]
    @Binding var scaleReferenceMetre: Double?
    
    @State private var showPhotoPicker = false
    @State private var showReferenceHelp = false
    @State private var referenceInput: String = ""
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    
                    // ── Guidance header ───────────────────────────────────────
                    GuidanceCard(
                        icon: "camera.fill",
                        title: "Photo Capture Tips",
                        points: [
                            "Take 25–40 overlapping photos (60–70% overlap)",
                            "Vary height: waist-level, standing, slightly elevated",
                            "Include a reference object (A4 sheet, door) in 2+ frames",
                            "Avoid motion blur and featureless white walls",
                        ]
                    )
                    
                    // ── Selected photos grid ──────────────────────────────────
                    if !viewModel.selectedImages.isEmpty {
                        PhotoGridView(images: viewModel.selectedImages)
                    }
                    
                    // ── Select photos button ──────────────────────────────────
                    Button(action: { showPhotoPicker = true }) {
                        Label(
                            viewModel.selectedImages.isEmpty
                                ? "Select Photos from Library"
                                : "Change Photos (\(viewModel.selectedImages.count) selected)",
                            systemImage: "photo.on.rectangle.angled"
                        )
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.accentColor.opacity(0.15))
                        .cornerRadius(12)
                    }
                    .photosPicker(isPresented: $showPhotoPicker,
                                  selection: $viewModel.pickerItems,
                                  maxSelectionCount: 80,
                                  matching: .images)
                    .onChange(of: viewModel.pickerItems) { _ in
                        Task { await viewModel.loadSelectedPhotos() }
                    }
                    
                    // ── Reference object length ───────────────────────────────
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Label("Reference Object Length (metres)", systemImage: "ruler")
                                .font(.subheadline.bold())
                            Spacer()
                            Button(action: { showReferenceHelp = true }) {
                                Image(systemName: "questionmark.circle")
                            }
                        }
                        
                        HStack {
                            TextField("e.g. 0.297 for A4 short side", text: $referenceInput)
                                .keyboardType(.decimalPad)
                                .textFieldStyle(.roundedBorder)
                            Text("m")
                                .foregroundStyle(.secondary)
                        }
                        
                        Text("Enter the real-world length of the reference object visible in your photos.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    .onChange(of: referenceInput) { val in
                        scaleReferenceMetre = Double(val.replacingOccurrences(of: ",", with: "."))
                    }
                }
                .padding()
            }
            .navigationTitle("Tier A — Photos")
            .onChange(of: viewModel.exportedURLs) { urls in
                selectedFileURLs = urls
            }
        }
        .sheet(isPresented: $showReferenceHelp) {
            ReferenceObjectHelpView()
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Photo Capture ViewModel
// ─────────────────────────────────────────────────────────────────────────────

@MainActor
class PhotoCaptureViewModel: ObservableObject {
    @Published var pickerItems: [PhotosPickerItem] = []
    @Published var selectedImages: [UIImage] = []
    @Published var exportedURLs: [URL] = []
    
    func loadSelectedPhotos() async {
        var images: [UIImage] = []
        var urls: [URL] = []
        
        for item in pickerItems {
            if let data = try? await item.loadTransferable(type: Data.self),
               let image = UIImage(data: data) {
                images.append(image)
                // Write to temp file
                let url = FileManager.default.temporaryDirectory
                    .appendingPathComponent(UUID().uuidString)
                    .appendingPathExtension("jpg")
                try? data.write(to: url)
                urls.append(url)
            }
        }
        
        selectedImages = images
        exportedURLs = urls
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Video Capture View (Tier B)
// ─────────────────────────────────────────────────────────────────────────────

/// Video capture view for Tier B.
///
/// User records a slow walkthrough video or picks one from the photo library.
/// The backend will extract frames at 2–4 fps and run COLMAP on them.
struct VideoCaptureView: View {
    @Binding var selectedFileURLs: [URL]
    @Binding var scaleReferenceMetre: Double?
    
    @State private var showVideoPicker = false
    @State private var selectedVideoURL: URL?
    @State private var referenceInput: String = ""
    @State private var extractFPS: Double = 3.0
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    
                    GuidanceCard(
                        icon: "video.fill",
                        title: "Video Capture Tips",
                        points: [
                            "Walk slowly — aim for 0.3–0.5 m/s",
                            "Hold the phone steady; avoid shaky panning",
                            "Cover all walls; include reference object in the first 10 s",
                            "Keep the lens clean for sharp feature matching",
                        ]
                    )
                    
                    // ── Video status ──────────────────────────────────────────
                    if let url = selectedVideoURL {
                        VideoPreviewRow(url: url)
                    }
                    
                    Button(action: { showVideoPicker = true }) {
                        Label(
                            selectedVideoURL == nil ? "Select Walkthrough Video" : "Change Video",
                            systemImage: "film"
                        )
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.accentColor.opacity(0.15))
                        .cornerRadius(12)
                    }
                    
                    // ── Frame extraction FPS slider ───────────────────────────
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Frame Extraction Rate: \(Int(extractFPS)) fps", systemImage: "timelapse")
                            .font(.subheadline.bold())
                        Slider(value: $extractFPS, in: 1...5, step: 1)
                        Text("Higher fps = more frames = slower processing. 2–3 fps is ideal for walkthroughs.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    
                    // ── Reference length ──────────────────────────────────────
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Reference Object Length (metres)", systemImage: "ruler")
                            .font(.subheadline.bold())
                        HStack {
                            TextField("e.g. 0.297", text: $referenceInput)
                                .keyboardType(.decimalPad)
                                .textFieldStyle(.roundedBorder)
                            Text("m")
                        }
                    }
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    .onChange(of: referenceInput) { val in
                        scaleReferenceMetre = Double(val.replacingOccurrences(of: ",", with: "."))
                    }
                }
                .padding()
            }
            .navigationTitle("Tier B — Video")
            .sheet(isPresented: $showVideoPicker) {
                VideoPicker(selectedURL: $selectedVideoURL)
            }
            .onChange(of: selectedVideoURL) { url in
                selectedFileURLs = url.map { [$0] } ?? []
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - LiDAR Capture View (Tier C)
// ─────────────────────────────────────────────────────────────────────────────

/// LiDAR capture view using Apple RoomPlan API.
///
/// Requires iPhone 12 Pro+ or iPad Pro with LiDAR sensor.
/// Exports the CapturedRoom as a USDZ and JSON file.
/// Falls back gracefully on unsupported devices.
struct LiDARCaptureView: View {
    @Binding var selectedFileURLs: [URL]
    @StateObject private var viewModel = LiDARCaptureViewModel()
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                
                if viewModel.isLiDARAvailable {
                    // ── Scan UI ───────────────────────────────────────────────
                    RoomPlanScanView(viewModel: viewModel)
                    
                    if let exportURL = viewModel.exportedJSONURL {
                        Label("Room captured and ready to upload", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                    
                    VStack(spacing: 12) {
                        if !viewModel.isScanning {
                            Button(action: { viewModel.startScan() }) {
                                Label("Start Room Scan", systemImage: "lidar.camera")
                                    .frame(maxWidth: .infinity)
                                    .padding()
                                    .background(Color.accentColor)
                                    .foregroundStyle(.white)
                                    .cornerRadius(14)
                            }
                        } else {
                            Button(action: { viewModel.stopScan() }) {
                                Label("Stop & Export", systemImage: "stop.circle.fill")
                                    .frame(maxWidth: .infinity)
                                    .padding()
                                    .background(Color.red)
                                    .foregroundStyle(.white)
                                    .cornerRadius(14)
                            }
                        }
                    }
                    .padding(.horizontal)
                    
                } else {
                    // ── Unsupported device fallback ───────────────────────────
                    ContentUnavailableView(
                        "LiDAR Not Available",
                        systemImage: "lidar.camera.slash",
                        description: Text("This device doesn't have a LiDAR sensor.\n\nUse an iPhone 12 Pro+ or iPad Pro.")
                    )
                }
            }
            .navigationTitle("Tier C — LiDAR")
            .onChange(of: viewModel.exportedFiles) { files in
                selectedFileURLs = files
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - LiDAR Capture ViewModel  (RoomPlan API)
// ─────────────────────────────────────────────────────────────────────────────

import RoomPlan

@MainActor
class LiDARCaptureViewModel: NSObject, ObservableObject, RoomCaptureSessionDelegate {
    @Published var isScanning = false
    @Published var isLiDARAvailable = false
    @Published var exportedJSONURL: URL?
    @Published var exportedFiles: [URL] = []
    @Published var scanInstructionText = "Move slowly to scan the room"
    
    var captureSession: RoomCaptureSession?
    var capturedRoom: CapturedRoom?
    
    override init() {
        super.init()
        isLiDARAvailable = RoomCaptureSession.isSupported
    }
    
    func startScan() {
        captureSession = RoomCaptureSession()
        captureSession?.delegate = self
        
        let config = RoomCaptureSession.Configuration()
        captureSession?.run(configuration: config)
        isScanning = true
    }
    
    func stopScan() {
        captureSession?.stop()
        isScanning = false
    }
    
    // ── RoomCaptureSessionDelegate ─────────────────────────────────────────────
    
    nonisolated func captureSession(
        _ session: RoomCaptureSession,
        didUpdate room: CapturedRoom
    ) {
        DispatchQueue.main.async {
            self.capturedRoom = room
        }
    }
    
    nonisolated func captureSession(
        _ session: RoomCaptureSession,
        didEndWith data: CapturedRoomData,
        error: Error?
    ) {
        if let error {
            print("RoomPlan error: \(error)")
            return
        }
        
        Task {
            await exportRoom(data: data)
        }
    }
    
    nonisolated func captureSession(
        _ session: RoomCaptureSession,
        didProvide instruction: RoomCaptureSession.Instruction
    ) {
        DispatchQueue.main.async {
            self.scanInstructionText = instruction.description
        }
    }
    
    // ── Export ─────────────────────────────────────────────────────────────────
    
    private func exportRoom(data: CapturedRoomData) async {
        let processor = RoomBuilder(options: [])
        do {
            let room = try await processor.capturedRoom(from: data)
            let tmpDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
            
            // Export USDZ
            let usdzURL = tmpDir.appendingPathComponent("room.usdz")
            try room.export(to: usdzURL)
            
            // Export JSON (walls, doors, windows with dimensions)
            let jsonURL = tmpDir.appendingPathComponent("room.json")
            let encoder = JSONEncoder()
            encoder.outputFormatting = .prettyPrinted
            let jsonData = try encoder.encode(RoomPlanExport(room: room))
            try jsonData.write(to: jsonURL)
            
            await MainActor.run {
                self.exportedJSONURL = jsonURL
                self.exportedFiles = [usdzURL, jsonURL]
            }
        } catch {
            print("Export error: \(error)")
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - RoomPlan JSON export model
// ─────────────────────────────────────────────────────────────────────────────

struct RoomPlanExport: Encodable {
    let walls: [RoomElement]
    let doors: [RoomElement]
    let windows: [RoomElement]
    let openings: [RoomElement]
    
    init(room: CapturedRoom) {
        self.walls    = room.walls.map    { RoomElement(surface: $0) }
        self.doors    = room.doors.map    { RoomElement(object: $0) }
        self.windows  = room.windows.map  { RoomElement(object: $0) }
        self.openings = room.openings.map { RoomElement(object: $0) }
    }
}

struct RoomElement: Encodable {
    let dimensions: [String: Double]
    let transform: [[Double]]
    
    init(surface: CapturedRoom.Surface) {
        self.dimensions = ["width": Double(surface.dimensions.x),
                           "height": Double(surface.dimensions.y)]
        let t = surface.transform
        self.transform = [
            [Double(t.columns.0.x), Double(t.columns.0.y), Double(t.columns.0.z), Double(t.columns.0.w)],
            [Double(t.columns.1.x), Double(t.columns.1.y), Double(t.columns.1.z), Double(t.columns.1.w)],
            [Double(t.columns.2.x), Double(t.columns.2.y), Double(t.columns.2.z), Double(t.columns.2.w)],
            [Double(t.columns.3.x), Double(t.columns.3.y), Double(t.columns.3.z), Double(t.columns.3.w)],
        ]
    }
    
    init(object: CapturedRoom.Object) {
        self.dimensions = ["width": Double(object.dimensions.x),
                           "height": Double(object.dimensions.y),
                           "depth": Double(object.dimensions.z)]
        let t = object.transform
        self.transform = [
            [Double(t.columns.0.x), Double(t.columns.0.y), Double(t.columns.0.z), Double(t.columns.0.w)],
            [Double(t.columns.1.x), Double(t.columns.1.y), Double(t.columns.1.z), Double(t.columns.1.w)],
            [Double(t.columns.2.x), Double(t.columns.2.y), Double(t.columns.2.z), Double(t.columns.2.w)],
            [Double(t.columns.3.x), Double(t.columns.3.y), Double(t.columns.3.z), Double(t.columns.3.w)],
        ]
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Shared UI components
// ─────────────────────────────────────────────────────────────────────────────

struct GuidanceCard: View {
    let icon: String
    let title: String
    let points: [String]
    
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: icon)
                .font(.headline)
            ForEach(points, id: \.self) { point in
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.caption)
                        .padding(.top, 2)
                    Text(point)
                        .font(.subheadline)
                }
            }
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
    }
}

struct PhotoGridView: View {
    let images: [UIImage]
    let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 4)
    
    var body: some View {
        LazyVGrid(columns: columns, spacing: 4) {
            ForEach(images.prefix(20).indices, id: \.self) { i in
                Image(uiImage: images[i])
                    .resizable()
                    .aspectRatio(1, contentMode: .fill)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            if images.count > 20 {
                ZStack {
                    Color.black.opacity(0.6)
                    Text("+\(images.count - 20)")
                        .foregroundStyle(.white)
                        .font(.headline)
                }
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
    }
}

struct VideoPreviewRow: View {
    let url: URL
    
    var body: some View {
        HStack {
            Image(systemName: "film")
                .font(.title2)
                .foregroundStyle(.accentColor)
            VStack(alignment: .leading) {
                Text(url.lastPathComponent)
                    .font(.subheadline.bold())
                Text(fileSizeString(for: url))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
    
    func fileSizeString(for url: URL) -> String {
        let bytes = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}

struct ReferenceObjectHelpView: View {
    @Environment(\.dismiss) var dismiss
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("The pipeline needs at least one reference object of known real-world size visible in 2+ photos.")
                    Text("**Good choices:**")
                    Text("• A4 sheet: 0.297 m (short edge) or 0.210 m (long edge)\n• Letter paper: 0.279 m (long) or 0.216 m (short)\n• Standard door height: 2.032 m or 2.100 m\n• Credit card: 0.0856 m × 0.054 m")
                    Text("Place the reference object flat against a wall in a well-lit, visible location and include it in at least 2 overlapping frames from different angles.")
                        .foregroundStyle(.secondary)
                }
                .padding()
            }
            .navigationTitle("Reference Object")
            .toolbar { ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
            }}
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - VideoPicker (UIKit bridge)
// ─────────────────────────────────────────────────────────────────────────────

import UIKit

struct VideoPicker: UIViewControllerRepresentable {
    @Binding var selectedURL: URL?
    
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.mediaTypes = ["public.movie"]
        picker.delegate = context.coordinator
        return picker
    }
    
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    
    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: VideoPicker
        init(_ parent: VideoPicker) { self.parent = parent }
        
        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            parent.selectedURL = info[.mediaURL] as? URL
            picker.dismiss(animated: true)
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - RoomPlanScanView (ARView bridge)
// ─────────────────────────────────────────────────────────────────────────────

import ARKit

/// Renders the live RoomPlan scanning overlay.
struct RoomPlanScanView: UIViewRepresentable {
    @ObservedObject var viewModel: LiDARCaptureViewModel
    
    func makeUIView(context: Context) -> some UIView {
        // RoomCaptureView is provided by the RoomPlan framework
        if let session = viewModel.captureSession {
            return RoomCaptureView(session: session)
        }
        return UIView()
    }
    
    func updateUIView(_ uiView: UIViewType, context: Context) {}
}

extension RoomCaptureSession.Instruction {
    var description: String {
        switch self {
        case .moveCloseToWall:       return "Move closer to a wall"
        case .moveAwayFromWall:      return "Move away from the wall"
        case .slowDown:              return "Slow down"
        case .turnOnLight:           return "Turn on more light"
        case .normal:                return "Scanning…"
        case .lowTexture:            return "Move to an area with more texture"
        @unknown default:            return "Follow instructions on screen"
        }
    }
}
