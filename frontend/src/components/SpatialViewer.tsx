"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import PointcloudViewer from "./PointcloudViewer";
import type { DamageBox } from "./FloorPlanCanvas";

const FloorPlanCanvas = dynamic(() => import("./FloorPlanCanvas"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[430px] sm:h-[490px] rounded-xl flex flex-col items-center justify-center bg-[#181716] text-[var(--text-muted)] text-xs font-mono">
      <div className="w-8 h-8 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin mb-3" />
      <span>Loading 2D floor plan engine...</span>
    </div>
  ),
});

interface WallSegment {
  id: number;
  length_m: number;
  has_opening?: boolean;
}

interface SpatialViewerProps {
  jobId?: string | null;
  areaM2?: number;
  wallsCount?: number;
  errorEst?: string;
  tier?: string;
  plyUrl?: string;
  svgRaw?: string;
  hasData?: boolean;
  isDemo?: boolean;
  initialDamageAreaM2?: number;
  onDamageAreaChange?: (areaM2: number) => void;
  isProcessing?: boolean;
  progressPct?: number;
  progressStage?: string;
}

export default function SpatialViewer({
  jobId = null,
  areaM2 = 24.5,
  wallsCount = 4,
  errorEst = "±2.5 cm",
  tier = "Native LiDAR (Apple RoomPlan)",
  plyUrl,
  svgRaw,
  hasData = false,
  isDemo = false,
  initialDamageAreaM2 = 18.2,
  onDamageAreaChange,
  isProcessing = false,
  progressPct = 0,
  progressStage = "",
}: SpatialViewerProps) {
  const [activeTab, setActiveTab] = useState<"pointcloud" | "floorplan">("floorplan");

  // Room geometry constants: X: [100, 540] (440px -> 5.40m), Y: [100, 460] (360px -> 4.50m)
  const ROOM_MIN_X = 100;
  const ROOM_MAX_X = 540;
  const ROOM_MIN_Y = 100;
  const ROOM_MAX_Y = 460;
  const ROOM_WIDTH_PX = ROOM_MAX_X - ROOM_MIN_X; // 440 px
  const ROOM_HEIGHT_PX = ROOM_MAX_Y - ROOM_MIN_Y; // 360 px
  const ROOM_WIDTH_M = 5.40;
  const ROOM_HEIGHT_M = 4.50;
  const TOTAL_ROOM_AREA_M2 = areaM2 || 24.5;

  // Damage box state in canvas coordinate units
  const [damageBox, setDamageBox] = useState<DamageBox>(() => {
    const targetArea = initialDamageAreaM2 || 18.2;
    const ratio = Math.min(1.0, Math.max(0.1, targetArea / TOTAL_ROOM_AREA_M2));
    const scale = Math.sqrt(ratio);
    const w = Math.min(ROOM_WIDTH_PX, Math.round(ROOM_WIDTH_PX * scale * 0.95));
    const h = Math.min(ROOM_HEIGHT_PX, Math.round(ROOM_HEIGHT_PX * scale * 0.95));
    return {
      x: ROOM_MIN_X + Math.round((ROOM_WIDTH_PX - w) / 2),
      y: ROOM_MIN_Y + Math.round((ROOM_HEIGHT_PX - h) / 2),
      width: w,
      height: h,
    };
  });

  const [isInteracting, setIsInteracting] = useState(false);

  // Derived real-world measurements from current box pixels
  const dimWidthM = Number(((damageBox.width / ROOM_WIDTH_PX) * ROOM_WIDTH_M).toFixed(2));
  const dimHeightM = Number(((damageBox.height / ROOM_HEIGHT_PX) * ROOM_HEIGHT_M).toFixed(2));
  const liveDamageAreaM2 = Number((dimWidthM * dimHeightM).toFixed(1));
  const roomCoveragePct = Math.min(100, Math.round((liveDamageAreaM2 / TOTAL_ROOM_AREA_M2) * 100));

  // Notify parent of damage area changes
  useEffect(() => {
    if (onDamageAreaChange) {
      onDamageAreaChange(liveDamageAreaM2);
    }
  }, [liveDamageAreaM2, onDamageAreaChange]);

  // Quick preset applicator
  const applyPresetArea = (targetM2: number) => {
    const clampedM2 = Math.min(TOTAL_ROOM_AREA_M2, Math.max(2.0, targetM2));
    const ratio = clampedM2 / TOTAL_ROOM_AREA_M2;
    const scale = Math.sqrt(ratio);
    const newW = Math.min(ROOM_WIDTH_PX, Math.max(60, Math.round(ROOM_WIDTH_PX * scale)));
    const newH = Math.min(ROOM_HEIGHT_PX, Math.max(60, Math.round(ROOM_HEIGHT_PX * scale)));
    const newX = ROOM_MIN_X + Math.round((ROOM_WIDTH_PX - newW) / 2);
    const newY = ROOM_MIN_Y + Math.round((ROOM_HEIGHT_PX - newH) / 2);
    setDamageBox({ x: newX, y: newY, width: newW, height: newH });
  };

  const adjustAreaBy = (deltaM2: number) => {
    applyPresetArea(liveDamageAreaM2 + deltaM2);
  };

  return (
    <div
      className="rounded-2xl border overflow-hidden space-y-4"
      style={{
        backgroundColor: "var(--bg-card)",
        borderColor: "var(--border-default)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {/* Top Bar with Tabs and Meta */}
      <div
        className="px-3 sm:px-5 py-3 border-b flex flex-wrap items-center justify-between gap-2.5 sm:gap-3"
        style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-surface)" }}
      >
        <div className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
          <button
            onClick={() => setActiveTab("pointcloud")}
            className={`btn-squish flex-1 sm:flex-initial px-2.5 sm:px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all text-center ${
              activeTab === "pointcloud"
                ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm border"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
            style={{
              borderColor: activeTab === "pointcloud" ? "var(--border-default)" : "transparent",
            }}
          >
            <span>3D Point Cloud Model</span>
          </button>
          <button
            onClick={() => setActiveTab("floorplan")}
            className={`btn-squish flex-1 sm:flex-initial px-2.5 sm:px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all text-center ${
              activeTab === "floorplan"
                ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm border"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
            style={{
              borderColor: activeTab === "floorplan" ? "var(--border-default)" : "transparent",
            }}
          >
            <span>2D Dimensioned Floor Plan</span>
          </button>
        </div>

        {/* Live Status Badge */}
        <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] font-mono">
          <span
            className="px-2 py-0.5 rounded border text-[10px] sm:text-xs font-medium"
            style={{
              borderColor: isInteracting ? "var(--accent)" : "var(--border-default)",
              color: isInteracting ? "var(--accent)" : "var(--text-primary)",
              backgroundColor: "var(--bg-surface)",
            }}
          >
            {isInteracting ? "⚡ resizing damage zone" : `damage: ${liveDamageAreaM2} m² (${roomCoveragePct}%)`}
          </span>
          <span className="hidden md:inline text-[var(--text-muted)]">Scale:</span>
          <span
            className="px-1.5 sm:px-2 py-0.5 rounded border text-[var(--accent)] font-semibold"
            style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
          >
            1m = 81.5px
          </span>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="px-3 sm:px-5">
        {!hasData ? (
          activeTab === "pointcloud" ? (
            <PointcloudViewer plyUrl={plyUrl} hasScan={false} />
          ) : isProcessing ? (
            <div className="relative w-full h-[380px] sm:h-[440px] rounded-xl border flex flex-col items-center justify-center p-6 text-center bg-[#181716] border-[var(--accent)]/40 overflow-hidden">
              {/* Radial background animation */}
              <div
                className="absolute inset-0 opacity-20 pointer-events-none"
                style={{
                  backgroundImage: "radial-gradient(var(--accent) 1px, transparent 1px)",
                  backgroundSize: "24px 24px",
                }}
              />
              <div className="relative z-10 flex flex-col items-center max-w-sm space-y-3.5">
                <div className="relative flex items-center justify-center w-14 h-14 rounded-2xl bg-[var(--accent-subtle)] border border-[var(--accent)]/40 text-[var(--accent)]">
                  <span className="absolute inset-0 rounded-2xl border border-[var(--accent)] animate-ping opacity-25" />
                  <svg className="w-7 h-7 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[var(--text-primary)] font-serif">
                    Reconstructing 3D Spatial Geometry
                  </p>
                  <p className="text-xs text-[var(--text-muted)] font-mono">
                    Status: {progressStage || "processing"} · {progressPct}%
                  </p>
                </div>
                <div className="w-56 bg-[var(--bg-card)] rounded-full h-2 overflow-hidden border border-[var(--border-subtle)]">
                  <div
                    className="h-full bg-[var(--accent)] transition-all duration-300"
                    style={{ width: `${Math.max(8, progressPct)}%` }}
                  />
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Synthesizing camera poses, point clouds, and calculating room floor plan...
                </p>
              </div>
            </div>
          ) : (
            <div className="relative w-full h-[380px] sm:h-[440px] rounded-xl border flex flex-col items-center justify-center p-6 text-center bg-[#181716] border-[var(--border-subtle)]">
              <svg className="w-16 h-16 text-[var(--border-strong)] mb-3" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="8" y="8" width="32" height="32" rx="4" strokeDasharray="4 3" />
                <path d="M8 20h32M20 8v32" strokeDasharray="2 2" strokeOpacity="0.5" />
              </svg>
              <p className="text-sm font-medium text-[var(--text-primary)] font-serif">
                No 2D floor plan loaded
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1 max-w-sm">
                Upload room photos, video, or iPhone LiDAR to generate 2D drawings and wall lengths, or load sample room scan.
              </p>
            </div>
          )
        ) : activeTab === "pointcloud" ? (
          <PointcloudViewer plyUrl={plyUrl} hasScan={true} />
        ) : (
          <div className="relative w-full h-[430px] sm:h-[490px] rounded-xl border flex flex-col items-center justify-center p-2 sm:p-4 overflow-hidden bg-[#181716] select-none">
            <FloorPlanCanvas
              damageBox={damageBox}
              onChange={setDamageBox}
              onInteractingChange={setIsInteracting}
              areaM2={TOTAL_ROOM_AREA_M2}
              tier={tier}
            />

            {/* Instruction Overlay Pill */}
            <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur-md px-3 py-1 rounded-lg text-[11px] font-mono text-[#a6a097] border border-white/10 flex items-center gap-2 pointer-events-none">
              <span className="h-2 w-2 rounded-full bg-[#c96442] animate-pulse" />
              <span>Drag box to move · Drag corners to resize damage area</span>
            </div>

            {isDemo && (
              <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-md px-2.5 py-0.5 rounded text-[10px] font-mono text-[#a6a097] border border-white/10 pointer-events-none">
                sample preview
              </div>
            )}
          </div>
        )}
      </div>

      {/* INTERACTIVE CONTROLS STRIP: Presets & Direct Fine-Tuning */}
      {hasData && activeTab === "floorplan" && (
        <div
          className="mx-3 sm:mx-5 p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2.5 text-xs"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono uppercase text-[var(--text-muted)] font-semibold">
              Damage Presets:
            </span>
            <button
              type="button"
              onClick={() => applyPresetArea(5.0)}
              className="px-2.5 py-1 rounded border text-[11px] font-medium transition-all hover:bg-[var(--bg-card)]"
              style={{
                borderColor: Math.abs(liveDamageAreaM2 - 5.0) < 1.0 ? "var(--accent)" : "var(--border-default)",
                color: Math.abs(liveDamageAreaM2 - 5.0) < 1.0 ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              Small (5 m²)
            </button>
            <button
              type="button"
              onClick={() => applyPresetArea(12.2)}
              className="px-2.5 py-1 rounded border text-[11px] font-medium transition-all hover:bg-[var(--bg-card)]"
              style={{
                borderColor: Math.abs(liveDamageAreaM2 - 12.2) < 1.0 ? "var(--accent)" : "var(--border-default)",
                color: Math.abs(liveDamageAreaM2 - 12.2) < 1.0 ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              Half Room (12.2 m²)
            </button>
            <button
              type="button"
              onClick={() => applyPresetArea(18.2)}
              className="px-2.5 py-1 rounded border text-[11px] font-medium transition-all hover:bg-[var(--bg-card)]"
              style={{
                borderColor: Math.abs(liveDamageAreaM2 - 18.2) < 1.0 ? "var(--accent)" : "var(--border-default)",
                color: Math.abs(liveDamageAreaM2 - 18.2) < 1.0 ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              Default (18.2 m²)
            </button>
            <button
              type="button"
              onClick={() => applyPresetArea(TOTAL_ROOM_AREA_M2)}
              className="px-2.5 py-1 rounded border text-[11px] font-medium transition-all hover:bg-[var(--bg-card)]"
              style={{
                borderColor: Math.abs(liveDamageAreaM2 - TOTAL_ROOM_AREA_M2) < 1.0 ? "var(--accent)" : "var(--border-default)",
                color: Math.abs(liveDamageAreaM2 - TOTAL_ROOM_AREA_M2) < 1.0 ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              Full Room ({TOTAL_ROOM_AREA_M2} m²)
            </button>
          </div>

          {/* Stepper controls */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => adjustAreaBy(-1.0)}
              className="px-2 py-0.5 rounded border text-xs font-mono font-bold hover:bg-[var(--bg-card)] text-[var(--text-secondary)]"
              style={{ borderColor: "var(--border-default)" }}
              title="Decrease damage area by 1.0 m²"
            >
              -1 m²
            </button>
            <div className="px-3 py-0.5 rounded border text-xs font-mono font-semibold bg-[var(--bg-card)] text-[var(--accent)]" style={{ borderColor: "var(--border-default)" }}>
              {liveDamageAreaM2} m²
            </div>
            <button
              type="button"
              onClick={() => adjustAreaBy(1.0)}
              className="px-2 py-0.5 rounded border text-xs font-mono font-bold hover:bg-[var(--bg-card)] text-[var(--text-secondary)]"
              style={{ borderColor: "var(--border-default)" }}
              title="Increase damage area by 1.0 m²"
            >
              +1 m²
            </button>
          </div>
        </div>
      )}

      {/* Metric Summaries Strip */}
      <div className="px-3 sm:px-5 pb-4 sm:pb-5 pt-1 grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <div className="p-2.5 sm:p-3 rounded-xl border" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
          <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">Floor Area</div>
          <div className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] mt-0.5 font-serif truncate">
            {hasData ? `${areaM2} m² (${(areaM2 * 10.764).toFixed(1)} sq ft)` : "--"}
          </div>
        </div>

        <div className="p-2.5 sm:p-3 rounded-xl border" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
          <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">Selected Damage Area</div>
          <div className="text-xs sm:text-sm font-semibold text-[var(--accent)] mt-0.5 font-serif truncate">
            {hasData ? `${liveDamageAreaM2} m² (${roomCoveragePct}% coverage)` : "--"}
          </div>
        </div>

        <div className="p-2.5 sm:p-3 rounded-xl border" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
          <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">Wall Segments</div>
          <div className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] mt-0.5 font-serif truncate">
            {hasData ? `${wallsCount} Verified Segments` : "--"}
          </div>
        </div>

        <div className="p-2.5 sm:p-3 rounded-xl border" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
          <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">Dimensional Error</div>
          <div className="text-xs sm:text-sm font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 font-serif truncate">
            {hasData ? errorEst : "--"}
          </div>
        </div>
      </div>
    </div>
  );
}
