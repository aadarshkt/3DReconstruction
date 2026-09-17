"use client";

import React, { useState } from "react";
import PointcloudViewer from "./PointcloudViewer";

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
}

export default function SpatialViewer({
  jobId = null,
  areaM2 = 0,
  wallsCount = 0,
  errorEst = "±2.5 cm",
  tier = "Native LiDAR (Apple RoomPlan)",
  plyUrl,
  svgRaw,
  hasData = false,
  isDemo = false,
}: SpatialViewerProps) {
  const [activeTab, setActiveTab] = useState<"pointcloud" | "floorplan">("pointcloud");

  const defaultWalls: WallSegment[] = [
    { id: 1, length_m: 5.4, has_opening: false },
    { id: 2, length_m: 4.5, has_opening: true },
    { id: 3, length_m: 5.4, has_opening: true },
    { id: 4, length_m: 4.5, has_opening: false },
  ];

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
            <span className="hidden xs:inline sm:inline">3D Point Cloud Model</span>
            <span className="xs:hidden sm:hidden">3D Point Cloud</span>
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
            <span className="hidden xs:inline sm:inline">2D Dimensioned Floor Plan</span>
            <span className="xs:hidden sm:hidden">2D Floor Plan</span>
          </button>
        </div>

        {/* Status / format tags */}
        <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] font-mono">
          {hasData && (
            <span
              className="px-2 py-0.5 rounded border text-[10px] sm:text-xs"
              style={{
                borderColor: isDemo ? "var(--border-default)" : "var(--accent-subtle)",
                color: isDemo ? "var(--text-muted)" : "var(--accent)",
                backgroundColor: "var(--bg-surface)",
              }}
            >
              {isDemo ? "sample preview" : "live scan"}
            </span>
          )}
          <span className="hidden md:inline text-[var(--text-muted)]">Reconstruction:</span>
          <span className="px-1.5 sm:px-2 py-0.5 rounded border text-[var(--accent)] font-semibold" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
            SVG
          </span>
          <span className="px-1.5 sm:px-2 py-0.5 rounded border text-[var(--accent)] font-semibold" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
            PLY
          </span>
          <span className="px-1.5 sm:px-2 py-0.5 rounded border text-[var(--accent)] font-semibold" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
            DXF
          </span>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="px-3 sm:px-5">
        {!hasData ? (
          activeTab === "pointcloud" ? (
            <PointcloudViewer plyUrl={plyUrl} hasScan={false} />
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
          <div className="relative w-full h-[400px] sm:h-[460px] rounded-xl border flex items-center justify-center p-4 overflow-hidden bg-[#181716]">
            {svgRaw ? (
              <div
                className="w-full h-full flex items-center justify-center"
                dangerouslySetInnerHTML={{ __html: svgRaw }}
              />
            ) : (
              <svg viewBox="0 0 680 580" className="w-full h-full max-w-xl">
                <defs>
                  <pattern id="gridPattern" width="40" height="40" patternUnits="userSpaceOnUse">
                    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#2a2723" strokeWidth="1" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#gridPattern)" />

                {/* Room Interior Fill */}
                <polygon points="100,100 540,100 540,460 100,460" fill="#22201d" fillOpacity="0.8" />

                {/* Saturated Water Damage Zone */}
                <rect
                  x="140"
                  y="140"
                  width="360"
                  height="280"
                  rx="12"
                  fill="#c96442"
                  fillOpacity="0.16"
                  stroke="#c96442"
                  strokeWidth="1.75"
                  strokeDasharray="6,4"
                />
                <text x="320" y="260" fill="#e28362" fontFamily="sans-serif" fontSize="14" fontWeight="700" textAnchor="middle">
                  Saturated Water Damage Area (18.2 m²)
                </text>
                <text x="320" y="282" fill="#a6a097" fontFamily="sans-serif" fontSize="11" textAnchor="middle">
                  Drywall, subfloor &amp; baseboards soaked from kitchen pipe burst
                </text>

                {/* Wall 1: Top (5.40 m) */}
                <line x1="100" y1="100" x2="540" y2="100" stroke="#f8fafc" strokeWidth="8" strokeLinecap="round" />
                <rect x="260" y="76" width="120" height="22" rx="4" fill="#181716" stroke="#c96442" strokeWidth="1" />
                <text x="320" y="91" fill="#e28362" fontFamily="sans-serif" fontSize="11" fontWeight="700" textAnchor="middle">
                  WALL 1: 5.40 m
                </text>

                {/* Wall 2: Right (4.50 m) with Doorway */}
                <line x1="540" y1="100" x2="540" y2="230" stroke="#f8fafc" strokeWidth="8" strokeLinecap="round" />
                <line x1="540" y1="330" x2="540" y2="460" stroke="#f8fafc" strokeWidth="8" strokeLinecap="round" />
                <path d="M 540 230 A 90 90 0 0 1 450 320" fill="none" stroke="#eab308" strokeWidth="2" strokeDasharray="4,3" />
                <line x1="540" y1="230" x2="450" y2="230" stroke="#eab308" strokeWidth="3" />
                <text x="490" y="222" fill="#facc15" fontFamily="sans-serif" fontSize="11" fontWeight="600">
                  Doorway
                </text>
                <text x="565" y="280" fill="#e28362" fontFamily="sans-serif" fontSize="11" fontWeight="700">
                  4.50 m
                </text>

                {/* Wall 3: Bottom (5.40 m) with Window */}
                <line x1="540" y1="460" x2="380" y2="460" stroke="#f8fafc" strokeWidth="8" strokeLinecap="round" />
                <line x1="260" y1="460" x2="100" y2="460" stroke="#f8fafc" strokeWidth="8" strokeLinecap="round" />
                <line x1="260" y1="460" x2="380" y2="460" stroke="#38bdf8" strokeWidth="5" />
                <text x="320" y="482" fill="#38bdf8" fontFamily="sans-serif" fontSize="11" fontWeight="600" textAnchor="middle">
                  Window (1.20 m)
                </text>
                <rect x="260" y="495" width="120" height="22" rx="4" fill="#181716" stroke="#c96442" strokeWidth="1" />
                <text x="320" y="510" fill="#e28362" fontFamily="sans-serif" fontSize="11" fontWeight="700" textAnchor="middle">
                  WALL 3: 5.40 m
                </text>

                {/* Wall 4: Left (4.50 m) */}
                <line x1="100" y1="460" x2="100" y2="100" stroke="#f8fafc" strokeWidth="8" strokeLinecap="round" />
                <text x="75" y="280" fill="#e28362" fontFamily="sans-serif" fontSize="11" fontWeight="700" textAnchor="middle" transform="rotate(-90 75 280)">
                  WALL 4: 4.50 m
                </text>

                {/* Room Info Badge */}
                <rect x="115" y="115" width="200" height="52" rx="6" fill="#181716" fillOpacity="0.95" stroke="#38342f" strokeWidth="1" />
                <text x="125" y="136" fill="#f8fafc" fontFamily="sans-serif" fontSize="12" fontWeight="700">
                  Kitchen &amp; Living Room
                </text>
                <text x="125" y="154" fill="#a6a097" fontFamily="sans-serif" fontSize="11">
                  Total Area: 24.5 m² (Native LiDAR)
                </text>
              </svg>
            )}

            <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded text-[11px] font-mono text-[#a6a097] border border-white/10">
              Hover walls for linear lengths · 2D SVG Projection
            </div>
            {isDemo && (
              <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-md px-2.5 py-0.5 rounded text-[10px] font-mono text-[#a6a097] border border-white/10">
                sample preview
              </div>
            )}
          </div>
        )}
      </div>

      {/* Metric Summaries Strip */}
      <div className="px-3 sm:px-5 pb-4 sm:pb-5 pt-1 grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <div className="p-2.5 sm:p-3 rounded-xl border" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
          <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">Floor Area</div>
          <div className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] mt-0.5 font-serif truncate">
            {hasData ? `${areaM2} m² (${(areaM2 * 10.764).toFixed(1)} sq ft)` : "--"}
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

        <div className="p-2.5 sm:p-3 rounded-xl border" style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
          <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">Source</div>
          <div className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] mt-0.5 truncate font-serif">
            {hasData ? (isDemo ? "sample (roomplan)" : tier) : "no active scan"}
          </div>
        </div>
      </div>
    </div>
  );
}
