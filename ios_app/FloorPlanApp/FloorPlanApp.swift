import SwiftUI

@main
struct FloorPlanApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Root ContentView (Tab-based navigation)
// ─────────────────────────────────────────────────────────────────────────────

struct ContentView: View {
    @StateObject private var jobManager = JobManager()
    
    var body: some View {
        TabView {
            NewJobView(jobManager: jobManager)
                .tabItem { Label("New Scan", systemImage: "camera.viewfinder") }
            
            JobHistoryView(jobManager: jobManager)
                .tabItem { Label("History", systemImage: "clock") }
            
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gear") }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - New Job View (tier selection + capture + upload)
// ─────────────────────────────────────────────────────────────────────────────

struct NewJobView: View {
    @ObservedObject var jobManager: JobManager
    @State private var selectedTier: Tier = .lidar
    @State private var fileURLs: [URL] = []
    @State private var scaleRef: Double? = nil
    @State private var isUploading = false
    @State private var currentJobId: String?
    @State private var showProgress = false
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // ── Tier picker ───────────────────────────────────────────
                    Picker("Capture Tier", selection: $selectedTier) {
                        Label("LiDAR",   systemImage: "lidar.camera").tag(Tier.lidar)
                        Label("Photos",  systemImage: "camera.fill").tag(Tier.photos)
                        Label("Video",   systemImage: "video.fill").tag(Tier.video)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal)
                    
                    // ── Capture UI for selected tier ──────────────────────────
                    Group {
                        switch selectedTier {
                        case .lidar:
                            LiDARCaptureView(selectedFileURLs: $fileURLs)
                        case .photos:
                            PhotoCaptureView(selectedFileURLs: $fileURLs,
                                             scaleReferenceMetre: $scaleRef)
                        case .video:
                            VideoCaptureView(selectedFileURLs: $fileURLs,
                                             scaleReferenceMetre: $scaleRef)
                        }
                    }
                    
                    // ── Upload button ─────────────────────────────────────────
                    Button(action: startReconstruction) {
                        if isUploading {
                            ProgressView().tint(.white)
                        } else {
                            Label("Upload & Reconstruct", systemImage: "arrow.up.circle.fill")
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(
                        LinearGradient(colors: [Color(hex: "6366f1"), Color(hex: "8b5cf6")],
                                       startPoint: .leading, endPoint: .trailing)
                    )
                    .foregroundStyle(.white)
                    .clipShape(Capsule())
                    .padding(.horizontal)
                    .disabled(fileURLs.isEmpty || isUploading)
                }
            }
            .navigationTitle("New Scan")
            .navigationDestination(isPresented: $showProgress) {
                if let jobId = currentJobId {
                    JobProgressView(jobId: jobId, tier: selectedTier)
                }
            }
        }
    }
    
    func startReconstruction() {
        isUploading = true
        Task {
            do {
                let job = try await APIClient.shared.createJob(
                    tier: selectedTier,
                    scaleReferenceMetre: selectedTier == .lidar ? nil : scaleRef
                )
                let jobId = job.job_id
                try await APIClient.shared.uploadFiles(fileURLs, jobId: jobId)
                _ = try await APIClient.shared.startJob(jobId: jobId)
                
                jobManager.add(jobId: jobId, tier: selectedTier)
                currentJobId = jobId
                showProgress = true
            } catch {
                print("Reconstruction start error: \(error)")
            }
            isUploading = false
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Job History View
// ─────────────────────────────────────────────────────────────────────────────

struct JobHistoryView: View {
    @ObservedObject var jobManager: JobManager
    
    var body: some View {
        NavigationStack {
            List(jobManager.jobs) { entry in
                NavigationLink(destination: ResultsView(jobId: entry.jobId)) {
                    HStack {
                        Image(systemName: entry.tierIcon)
                            .foregroundStyle(.accentColor)
                        VStack(alignment: .leading) {
                            Text(entry.jobId.prefix(8) + "…")
                                .font(.subheadline.monospaced())
                            Text(entry.tier.rawValue.capitalized)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(entry.date, style: .relative)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("History")
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Settings View
// ─────────────────────────────────────────────────────────────────────────────

struct SettingsView: View {
    @StateObject private var api = APIClient.shared
    @State private var serverInput: String = ""
    
    var body: some View {
        NavigationStack {
            Form {
                Section("Backend Server") {
                    TextField("http://192.168.x.x:8000", text: $serverInput)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    
                    Button("Apply") {
                        api.baseURL = serverInput
                    }
                    
                    Text("Set this to your Mac's LAN IP address when testing on device. Find it with: `ipconfig getifaddr en0`")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                
                Section("About") {
                    LabeledContent("Version", value: "0.1.0")
                    LabeledContent("Pipeline", value: "COLMAP + Open3D + RoomPlan")
                }
            }
            .navigationTitle("Settings")
            .onAppear { serverInput = api.baseURL }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Job Manager (in-memory history)
// ─────────────────────────────────────────────────────────────────────────────

struct JobEntry: Identifiable {
    let id = UUID()
    let jobId: String
    let tier: Tier
    let date = Date()
    
    var tierIcon: String {
        switch tier {
        case .photos: return "camera.fill"
        case .video:  return "video.fill"
        case .lidar:  return "lidar.camera"
        }
    }
}

class JobManager: ObservableObject {
    @Published var jobs: [JobEntry] = []
    
    func add(jobId: String, tier: Tier) {
        jobs.insert(JobEntry(jobId: jobId, tier: tier), at: 0)
    }
}
