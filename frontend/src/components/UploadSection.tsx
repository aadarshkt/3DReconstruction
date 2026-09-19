"use client";

import React, { useState, useEffect, useRef } from "react";
import SpatialViewer from "./SpatialViewer";

interface WallSegment {
  id: number;
  length_m: number;
  has_opening?: boolean;
}

interface ScanData {
  areaM2: number;
  wallsCount: number;
  errorEst: string;
  tier: string;
  walls: WallSegment[];
  svgContent?: string;
  plyUrl?: string;
  damageAreaM2?: number;
}

interface UploadSectionProps {
  jobId: string | null;
  onJobLoaded: (jobData: any, isDemo?: boolean) => void;
  isLoading: boolean;
  setIsLoading: (val: boolean) => void;
  statusMessage: string;
  setStatusMessage: (msg: string) => void;
  isProcessing?: boolean;
  setIsProcessing?: (val: boolean) => void;
  isDemo?: boolean;
  jobData?: any | null;
  onNavigateTab?: (tab: "footage" | "policy" | "costs" | "assistant") => void;
  allowSample?: boolean;
}

export default function UploadSection({
  jobId,
  onJobLoaded,
  isLoading,
  setIsLoading,
  statusMessage,
  setStatusMessage,
  isProcessing = false,
  setIsProcessing,
  isDemo = false,
  jobData = null,
  onNavigateTab,
  allowSample = false,
}: UploadSectionProps) {
  const [activeMediaTab, setActiveMediaTab] = useState<"photos" | "video" | "lidar">("photos");
  const [dragOver, setDragOver] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressStage, setProgressStage] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  // Scale Reference Option A state
  const [scaleRefPreset, setScaleRefPreset] = useState<"door" | "ceiling" | "paper" | "custom" | "none">("door");
  const [scaleValue, setScaleValue] = useState<string>("2.03");
  const [scaleUnit, setScaleUnit] = useState<"m" | "ft">("m");
  const [showCaptureTips, setShowCaptureTips] = useState<boolean>(false);

  const handlePresetSelect = (preset: "door" | "ceiling" | "paper" | "custom" | "none") => {
    setScaleRefPreset(preset);
    if (preset === "door") {
      setScaleValue(scaleUnit === "m" ? "2.03" : "6.66");
    } else if (preset === "ceiling") {
      setScaleValue(scaleUnit === "m" ? "2.40" : "7.87");
    } else if (preset === "paper") {
      setScaleValue(scaleUnit === "m" ? "0.297" : "0.97");
    } else if (preset === "none") {
      setScaleValue("");
    }
  };

  const handleUnitToggle = (unit: "m" | "ft") => {
    if (unit === scaleUnit) return;
    setScaleUnit(unit);
    const num = parseFloat(scaleValue);
    if (!isNaN(num) && num > 0) {
      if (unit === "ft") {
        setScaleValue((num / 0.3048).toFixed(2));
      } else {
        setScaleValue((num * 0.3048).toFixed(2));
      }
    }
  };

  const effectiveScaleM: string | null = (() => {
    if (activeMediaTab === "lidar" || scaleRefPreset === "none") return null;
    const num = parseFloat(scaleValue);
    if (isNaN(num) || num <= 0) return null;
    const inMeters = scaleUnit === "ft" ? num * 0.3048 : num;
    return inMeters.toFixed(3);
  })();

  // Initial scanData is null unless jobData is already provided or demo is active
  const [scanData, setScanData] = useState<ScanData | null>(() => {
    if (jobData && (jobData.areaM2 || jobData.room_area_m2)) {
      return {
        areaM2: jobData.areaM2 || jobData.room_area_m2,
        wallsCount: jobData.wallsCount || jobData.wall_count || (jobData.walls?.length ?? 0),
        errorEst: jobData.errorEst || "±2.5 cm",
        tier: jobData.tier || "Native LiDAR (Apple RoomPlan)",
        walls: jobData.walls || [],
        svgContent: jobData.svgContent,
        plyUrl: jobData.plyUrl,
        damageAreaM2: jobData.damageAreaM2,
      };
    }
    return null;
  });

  // Sync scanData if jobData changes from parent
  useEffect(() => {
    if (jobData && (jobData.areaM2 || jobData.room_area_m2)) {
      setScanData({
        areaM2: jobData.areaM2 || jobData.room_area_m2,
        wallsCount: jobData.wallsCount || jobData.wall_count || (jobData.walls?.length ?? 0),
        errorEst: jobData.errorEst || "±2.5 cm",
        tier: jobData.tier || "Native LiDAR (Apple RoomPlan)",
        walls: jobData.walls || [],
        svgContent: jobData.svgContent,
        plyUrl: jobData.plyUrl,
        damageAreaM2: jobData.damageAreaM2,
      });
    } else if (!jobData && !isDemo) {
      setScanData(null);
    }
  }, [jobData, isDemo]);

  // Clean up WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const handleSeedDemo = async () => {
    setIsLoading(true);
    setStatusMessage("Loading sample 3D scan and room geometry...");
    try {
      const res = await fetch("/claims/seed-demo", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      let svgText: string | undefined = undefined;
      try {
        const svgRes = await fetch(`/jobs/${data.job_id}/files/floor_plan.svg`);
        if (svgRes.ok) svgText = await svgRes.text();
      } catch (_) {}

      const newScan: ScanData = {
        areaM2: 24.5,
        wallsCount: 4,
        errorEst: "±2.5 cm",
        tier: "Native LiDAR (Apple RoomPlan)",
        walls: [
          { id: 1, length_m: 5.4, has_opening: false },
          { id: 2, length_m: 4.5, has_opening: true },
          { id: 3, length_m: 5.4, has_opening: true },
          { id: 4, length_m: 4.5, has_opening: false },
        ],
        svgContent: svgText || data.svg || undefined,
        plyUrl: data.job_id ? `/jobs/${data.job_id}/files/point_cloud.ply` : undefined,
        damageAreaM2: 18.2,
      };
      setScanData(newScan);
      onJobLoaded({ ...data, ...newScan }, true);
      setStatusMessage("Sample 3D scan and floor plan loaded.");
    } catch (e: any) {
      // Fallback
      const fallbackScan: ScanData = {
        areaM2: 24.5,
        wallsCount: 4,
        errorEst: "±2.5 cm",
        tier: "Native LiDAR (Apple RoomPlan)",
        walls: [
          { id: 1, length_m: 5.4, has_opening: false },
          { id: 2, length_m: 4.5, has_opening: true },
          { id: 3, length_m: 5.4, has_opening: true },
          { id: 4, length_m: 4.5, has_opening: false },
        ],
        plyUrl: "/static/a441e175-fa81-54b1-872f-532658f8b0fa/results/point_cloud.ply",
        damageAreaM2: 18.2,
      };
      setScanData(fallbackScan);
      onJobLoaded({ job_id: "demo-job", ...fallbackScan }, true);
      setStatusMessage("Sample 3D scan loaded.");
    } finally {
      setIsLoading(false);
    }
  };

  const connectProgressWebSocket = (activeJobId: string) => {
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const ws = new WebSocket(`${protocol}//${host}/jobs/${activeJobId}/ws`);
      wsRef.current = ws;

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.pct != null) setProgressPct(msg.pct);
          if (msg.stage) setProgressStage(msg.stage);

          if (msg.stage === "complete" || msg.pct === 100) {
            ws.close();
            await fetchJobResults(activeJobId);
          } else if (msg.stage === "failed") {
            ws.close();
            setIsProcessing?.(false);
            setIsLoading(false);
            setStatusMessage(`Reconstruction error: ${msg.error || "Processing failed"}`);
          }
        } catch (_) {}
      };

      ws.onerror = () => {
        pollJobStatus(activeJobId);
      };
    } catch (_) {
      pollJobStatus(activeJobId);
    }
  };

  const pollJobStatus = (activeJobId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/jobs/${activeJobId}`);
        if (!res.ok) return;
        const job = await res.json();
        setProgressPct(job.progress_pct || 0);
        setProgressStage(job.status || "");

        if (job.status === "complete") {
          clearInterval(interval);
          await fetchJobResults(activeJobId);
        } else if (job.status === "failed") {
          clearInterval(interval);
          setIsProcessing?.(false);
          setIsLoading(false);
          setStatusMessage("Reconstruction encountered an issue.");
        }
      } catch (_) {}
    }, 3000);
  };

  const fetchJobResults = async (activeJobId: string) => {
    try {
      const res = await fetch(`/jobs/${activeJobId}/results`);
      if (res.ok) {
        const result = await res.json();
        let svgText: string | undefined = undefined;
        try {
          const svgRes = await fetch(`/jobs/${activeJobId}/files/floor_plan.svg`);
          if (svgRes.ok) svgText = await svgRes.text();
        } catch (_) {}

        const parsedScan: ScanData = {
          areaM2: result.room_area_m2 || 0,
          wallsCount: result.wall_count || (result.walls?.length ?? 0),
          errorEst: result.error_estimate?.expected_wall_error_cm
            ? `±${result.error_estimate.expected_wall_error_cm} cm`
            : "±2.0 cm",
          tier: result.tier === "hybrid" ? "Hybrid (Photos/Video + LiDAR)" : result.tier,
          walls: result.walls || [],
          svgContent: svgText,
          plyUrl: result.files?.point_cloud_ply || `/jobs/${activeJobId}/files/point_cloud.ply`,
          damageAreaM2: result.damage_area_m2,
        };
        setScanData(parsedScan);
        onJobLoaded({ job_id: activeJobId, ...result, ...parsedScan }, false);
        setStatusMessage("3D spatial reconstruction completed successfully.");
      }
    } catch (_) {
      setStatusMessage("Reconstruction completed.");
    } finally {
      setIsProcessing?.(false);
      setIsLoading(false);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsLoading(true);
    setIsProcessing?.(true);
    setProgressPct(5);
    setProgressStage("uploading");
    setStatusMessage(`Uploading ${files.length} file(s)...`);

    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i]);
      }
      formData.append("auto_start", "true");
      if (effectiveScaleM) {
        formData.append("scale_reference_m", effectiveScaleM);
      }

      const res = await fetch("/jobs/create-and-upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || `Upload request failed (${res.status})`);
      }
      const job = await res.json();

      setStatusMessage(`Media uploaded (${job.tier} modality${effectiveScaleM ? ` · scale ~${effectiveScaleM}m` : ""}). Running 3D reconstruction...`);
      onJobLoaded(job, false);
      connectProgressWebSocket(job.job_id);
    } catch (err: any) {
      // Fallback to separate create + upload
      try {
        const createRes = await fetch("/jobs/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            tier: activeMediaTab,
            ...(effectiveScaleM ? { scale_reference_m: parseFloat(effectiveScaleM) } : {}),
          }),
        });
        if (!createRes.ok) {
          const createErr = await createRes.text();
          throw new Error(createErr || `Job creation failed (${createRes.status})`);
        }
        const job = await createRes.json();

        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
          formData.append("files", files[i]);
        }
        const uploadRes = await fetch(`/jobs/${job.job_id}/upload`, { method: "POST", body: formData });
        if (!uploadRes.ok) {
          const uploadErr = await uploadRes.text();
          throw new Error(uploadErr || `File upload failed (${uploadRes.status})`);
        }
        await fetch(`/jobs/${job.job_id}/start`, { method: "POST" });

        setStatusMessage("Processing 3D spatial reconstruction...");
        onJobLoaded(job, false);
        connectProgressWebSocket(job.job_id);
      } catch (fallbackErr: any) {
        setStatusMessage(`Upload note: ${fallbackErr.message}. You can also explore with sample data.`);
        setIsProcessing?.(false);
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 border-b pb-4" style={{ borderColor: "var(--border-subtle)" }}>
        <div>
          <h2 className="font-serif text-xl sm:text-2xl font-medium tracking-tight text-[var(--text-primary)]">
            Property Footage & Spatial Reconstruction
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Capture room photos, video footage, or iPhone LiDAR to generate verified 2D architectural drawings and 3D models.
          </p>
        </div>

        {allowSample && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={handleSeedDemo}
              disabled={isLoading || isProcessing}
              className="btn-squish w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium text-[var(--text-primary)] shadow-sm hover:border-[var(--border-strong)] transition-all"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-default)",
              }}
            >
              Load Sample 3D Scan
            </button>
          </div>
        )}
      </div>

      {/* Progress & Next Step Guidance Prompt */}
      {(isLoading || isProcessing) && (
        <div className="p-4 rounded-xl border space-y-3" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)] flex-wrap">
                <span className="h-2 w-2 rounded-full bg-[var(--accent)] animate-pulse" />
                <span>Processing 3D spatial reconstruction</span>
                <span className="font-mono text-[11px] text-[var(--text-muted)]">
                  ({progressStage || "processing"} · {progressPct}%)
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                While geometry and measurements are being extracted, you can proceed to upload your insurance policy document.
              </p>
            </div>

            {onNavigateTab && (
              <button
                onClick={() => onNavigateTab("policy")}
                className="btn-squish w-full sm:w-auto shrink-0 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-all text-center"
              >
                Proceed to Policy Documents →
              </button>
            )}
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-[var(--bg-card)] rounded-full h-1.5 overflow-hidden border" style={{ borderColor: "var(--border-subtle)" }}>
            <div
              className="h-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${Math.max(5, progressPct)}%` }}
            />
          </div>
        </div>
      )}

      {/* Upload Dropzone Section */}
      <div id="tour-footage-upload" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <span className="font-serif text-base sm:text-lg font-semibold text-[var(--text-primary)]">
            Upload Property Footage
          </span>
          {/* Media Type Selector */}
          <div className="flex items-center gap-1 p-1 rounded-lg border overflow-x-auto" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
            {[
              { key: "photos", label: "Photos" },
              { key: "video", label: "Video" },
              { key: "lidar", label: "LiDAR" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveMediaTab(tab.key as any)}
                className={`btn-squish flex-1 sm:flex-initial px-3 py-1.5 text-xs font-medium rounded-md transition-colors text-center ${
                  activeMediaTab === tab.key
                    ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm font-semibold"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scale Reference & Guidance Card (Option A) */}
        {activeMediaTab !== "lidar" ? (
          <div
            className="p-4 sm:p-5 rounded-2xl border space-y-3.5 transition-all shadow-xs"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderColor: "var(--border-default)",
            }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-subtle)] text-[var(--accent)] font-mono text-sm font-semibold">
                  📐
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs sm:text-sm font-semibold text-[var(--text-primary)]">
                      Metric Scale Reference
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                      Recommended
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    Photos alone lack real-world scale. Selecting a known reference anchors real-world metres for accurate floor plans and 3D walls.
                  </p>
                </div>
              </div>

              {/* Active Status Badge */}
              <div className="shrink-0">
                {effectiveScaleM ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono font-medium border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Scale Anchor: {effectiveScaleM} m
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono text-[var(--text-muted)] border border-[var(--border-subtle)]">
                    Relative / Unscaled
                  </span>
                )}
              </div>
            </div>

            {/* Presets */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-secondary)] font-semibold">
                Reference Preset
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                {[
                  { key: "door", label: "Door Height", sub: "2.03m / 6.7ft", icon: "🚪" },
                  { key: "ceiling", label: "Ceiling Height", sub: "2.40m / 7.9ft", icon: "🏠" },
                  { key: "paper", label: "Paper on Floor", sub: "0.30m / A4", icon: "📄" },
                  { key: "custom", label: "Custom Length", sub: "Manual length", icon: "📏" },
                  { key: "none", label: "Unscaled", sub: "Relative units", icon: "⚪" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handlePresetSelect(item.key as any)}
                    className={`btn-squish flex flex-col items-start p-2 rounded-xl border text-left transition-all ${
                      scaleRefPreset === item.key
                        ? "border-[var(--accent)] bg-[var(--accent-subtle)] shadow-xs"
                        : "border-[var(--border-subtle)] bg-[var(--bg-card)] hover:border-[var(--border-default)]"
                    }`}
                  >
                    <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1">
                      <span>{item.icon}</span> {item.label}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
                      {item.sub}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Fine-tune Value Input & Guidance Text (if not unscaled) */}
            {scaleRefPreset !== "none" && (
              <div className="p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--bg-card)]" style={{ borderColor: "var(--border-subtle)" }}>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-[var(--text-secondary)] font-medium shrink-0">
                    Target Reference Length:
                  </label>
                  <div className="flex items-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1 shadow-inner focus-within:border-[var(--accent)]">
                    <input
                      type="number"
                      step="0.01"
                      min="0.05"
                      max="50"
                      value={scaleValue}
                      onChange={(e) => setScaleValue(e.target.value)}
                      className="w-20 bg-transparent text-xs font-mono font-semibold text-[var(--text-primary)] focus:outline-hidden"
                      placeholder="e.g. 2.03"
                    />
                  </div>
                  {/* Unit toggle */}
                  <div className="flex items-center rounded-lg border border-[var(--border-subtle)] p-0.5 bg-[var(--bg-surface)]">
                    <button
                      type="button"
                      onClick={() => handleUnitToggle("m")}
                      className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded-md transition-all ${
                        scaleUnit === "m"
                          ? "bg-[var(--accent)] text-white shadow-xs"
                          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      m
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUnitToggle("ft")}
                      className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded-md transition-all ${
                        scaleUnit === "ft"
                          ? "bg-[var(--accent)] text-white shadow-xs"
                          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      ft
                    </button>
                  </div>
                </div>

                {/* Specific Tip */}
                <span className="text-[11px] text-[var(--text-muted)] italic">
                  {scaleRefPreset === "door" && "🚪 Include full door height in at least 3 overlapping photos."}
                  {scaleRefPreset === "ceiling" && "🏠 Ensure vertical wall-to-ceiling corners appear in 3+ photos."}
                  {scaleRefPreset === "paper" && "📄 Place standard Letter / A4 paper flat in view on the floor."}
                  {scaleRefPreset === "custom" && "📏 Measured distance between two visible landmarks in photos."}
                </span>
              </div>
            )}

            {/* Collapsible Capture Guidance */}
            <div>
              <button
                type="button"
                onClick={() => setShowCaptureTips(!showCaptureTips)}
                className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[var(--accent)] hover:underline focus:outline-hidden"
              >
                <span>{showCaptureTips ? "▼ Hide photo capture recommendations" : "▶ Show photogrammetry capture recommendations"}</span>
              </button>

              {showCaptureTips && (
                <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="p-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] space-y-1">
                    <span className="font-semibold text-[var(--text-primary)] flex items-center gap-1">
                      🔄 60–80% Overlap
                    </span>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Take a photo every 1–2 steps around the room. Each feature should appear in at least 3 photos.
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] space-y-1">
                    <span className="font-semibold text-[var(--text-primary)] flex items-center gap-1">
                      💡 Even Illumination
                    </span>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Turn all lights on. Avoid heavy shadows or moving objects during capture.
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] space-y-1">
                    <span className="font-semibold text-[var(--text-primary)] flex items-center gap-1">
                      📐 Chest-Level Steady
                    </span>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Keep camera at steady chest height; avoid switching zoom lenses or extreme fisheye.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-xl border border-blue-500/20 bg-blue-500/5 flex items-center gap-2.5 text-xs text-blue-700 dark:text-blue-300">
            <span className="text-base">✨</span>
            <div>
              <span className="font-semibold">Native LiDAR Metric Scale:</span> LiDAR scans (.usdz, .ply) from iPhone Pro contain hardware-calibrated metric coordinates automatically.
            </div>
          </div>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={`relative flex flex-col items-center justify-center p-6 sm:p-8 rounded-2xl border-2 border-dashed transition-all ${
            dragOver
              ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
              : "border-[var(--border-default)] hover:border-[var(--border-strong)] bg-[var(--bg-card)]"
          }`}
        >
          <input
            type="file"
            id="mediaUploadInput"
            multiple
            accept=".jpg,.jpeg,.png,.heic,.webp,.mp4,.mov,.avi,.mkv,.usdz,.ply,.json"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />

          <div className="flex flex-col items-center text-center space-y-2">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl border text-xs font-serif font-semibold"
              style={{
                borderColor: "var(--border-default)",
                backgroundColor: "var(--bg-surface)",
                color: "var(--accent)",
              }}
            >
              {activeMediaTab === "photos" ? "JPG" : activeMediaTab === "video" ? "MP4" : "3D"}
            </div>

            <p className="text-xs sm:text-sm font-medium text-[var(--text-primary)]">
              <label
                htmlFor="mediaUploadInput"
                className="cursor-pointer font-semibold text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
              >
                Tap to take photo / upload files
              </label>
              <span className="hidden sm:inline"> or drop your {activeMediaTab === "photos" ? "photos" : activeMediaTab === "video" ? "video file" : "LiDAR file"} here</span>
            </p>
            <p className="text-[11px] text-[var(--text-muted)] max-w-sm sm:max-w-none">
              Supports photos (JPG/PNG/HEIC), continuous video (MP4/MOV), and LiDAR (USDZ/PLY/JSON).
              {effectiveScaleM && (
                <span className="block mt-1 text-[var(--accent)] font-medium">
                  Active metric anchor: {effectiveScaleM} m ({scaleRefPreset === "door" ? "Standard Door" : scaleRefPreset === "ceiling" ? "Ceiling Height" : scaleRefPreset === "paper" ? "A4 Paper" : "Custom"})
                </span>
              )}
            </p>
          </div>

          {statusMessage && (
            <div className="mt-3 text-xs font-mono text-[var(--accent)] text-center">
              {statusMessage}
            </div>
          )}
        </div>
      </div>

      {/* SPATIAL VIEWER: Renders clean empty state when no scanData is active */}
      <div id="tour-spatial-viewer" className="space-y-2 pt-6 border-t" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--accent)] font-semibold">
            Interactive Visual Output
          </span>
          <span className="text-[11px] font-mono text-[var(--text-muted)]">
            {scanData ? `active dataset: ${isDemo ? "sample preview" : scanData.tier}` : "no active scan"}
          </span>
        </div>

        <SpatialViewer
          jobId={jobId}
          areaM2={scanData?.areaM2 || 0}
          wallsCount={scanData?.wallsCount || 0}
          errorEst={scanData?.errorEst || "±2.5 cm"}
          tier={scanData?.tier || "no active scan"}
          plyUrl={scanData?.plyUrl}
          svgRaw={scanData?.svgContent}
          hasData={scanData !== null}
          isDemo={isDemo}
        />
      </div>
    </div>
  );
}
