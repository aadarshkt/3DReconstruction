"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
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
  initialDamageAreaM2?: number;
  onDamageAreaChange?: (areaM2: number) => void;
}

interface DamageBox {
  x: number;
  y: number;
  width: number;
  height: number;
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
}: SpatialViewerProps) {
  const [activeTab, setActiveTab] = useState<"pointcloud" | "floorplan">("floorplan");

  // [PLACEHOLDER / HARDCODED GEOMETRY DEFAULTS]
  // Default room canvas: X: [100, 540] (440px -> 5.40m), Y: [100, 460] (360px -> 4.50m)
  // Scale factors: 0.0122727 m/px (X), 0.0125 m/px (Y)
  const ROOM_MIN_X = 100;
  const ROOM_MAX_X = 540;
  const ROOM_MIN_Y = 100;
  const ROOM_MAX_Y = 460;
  const ROOM_WIDTH_PX = ROOM_MAX_X - ROOM_MIN_X; // 440 px
  const ROOM_HEIGHT_PX = ROOM_MAX_Y - ROOM_MIN_Y; // 360 px
  const ROOM_WIDTH_M = 5.40;
  const ROOM_HEIGHT_M = 4.50;
  const TOTAL_ROOM_AREA_M2 = areaM2 || 24.5;

  // Damage box state in SVG coordinate units
  const [damageBox, setDamageBox] = useState<DamageBox>(() => {
    // Calibrate initial box to target area (default 18.2 m²)
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
  const [dragMode, setDragMode] = useState<"none" | "move" | "nw" | "ne" | "sw" | "se">("none");
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    initialBox: DamageBox;
  }>({
    startX: 0,
    startY: 0,
    initialBox: damageBox,
  });

  const svgRef = useRef<SVGSVGElement | null>(null);

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

  // Convert screen coordinates to SVG viewBox units
  const getSVGCoordinates = useCallback((e: MouseEvent | TouchEvent): { x: number; y: number } => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    if ("touches" in e && e.touches.length > 0) {
      pt.x = e.touches[0].clientX;
      pt.y = e.touches[0].clientY;
    } else if ("clientX" in e) {
      pt.x = (e as MouseEvent).clientX;
      pt.y = (e as MouseEvent).clientY;
    }
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const transformed = pt.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  }, []);

  const handlePointerDown = (
    mode: "move" | "nw" | "ne" | "sw" | "se",
    e: React.MouseEvent | React.TouchEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const nativeEvent = e.nativeEvent;
    const coords = getSVGCoordinates(nativeEvent as any);
    dragStartRef.current = {
      startX: coords.x,
      startY: coords.y,
      initialBox: { ...damageBox },
    };
    setDragMode(mode);
    setIsInteracting(true);
  };

  // Global mousemove and mouseup listeners during drag
  useEffect(() => {
    if (dragMode === "none") return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      const coords = getSVGCoordinates(e);
      const dx = coords.x - dragStartRef.current.startX;
      const dy = coords.y - dragStartRef.current.startY;
      const init = dragStartRef.current.initialBox;

      setDamageBox(() => {
        let newX = init.x;
        let newY = init.y;
        let newW = init.width;
        let newH = init.height;

        const MIN_SIZE = 40; // ~0.5m minimum bounding size

        if (dragMode === "move") {
          newX = Math.max(ROOM_MIN_X, Math.min(ROOM_MAX_X - init.width, init.x + dx));
          newY = Math.max(ROOM_MIN_Y, Math.min(ROOM_MAX_Y - init.height, init.y + dy));
        } else if (dragMode === "se") {
          newW = Math.max(MIN_SIZE, Math.min(ROOM_MAX_X - init.x, init.width + dx));
          newH = Math.max(MIN_SIZE, Math.min(ROOM_MAX_Y - init.y, init.height + dy));
        } else if (dragMode === "sw") {
          const clampedX = Math.max(ROOM_MIN_X, Math.min(init.x + init.width - MIN_SIZE, init.x + dx));
          newW = init.width + (init.x - clampedX);
          newX = clampedX;
          newH = Math.max(MIN_SIZE, Math.min(ROOM_MAX_Y - init.y, init.height + dy));
        } else if (dragMode === "ne") {
          newW = Math.max(MIN_SIZE, Math.min(ROOM_MAX_X - init.x, init.width + dx));
          const clampedY = Math.max(ROOM_MIN_Y, Math.min(init.y + init.height - MIN_SIZE, init.y + dy));
          newH = init.height + (init.y - clampedY);
          newY = clampedY;
        } else if (dragMode === "nw") {
          const clampedX = Math.max(ROOM_MIN_X, Math.min(init.x + init.width - MIN_SIZE, init.x + dx));
          const clampedY = Math.max(ROOM_MIN_Y, Math.min(init.y + init.height - MIN_SIZE, init.y + dy));
          newW = init.width + (init.x - clampedX);
          newH = init.height + (init.y - clampedY);
          newX = clampedX;
          newY = clampedY;
        }

        return { x: Math.round(newX), y: Math.round(newY), width: Math.round(newW), height: Math.round(newH) };
      });
    };

    const handlePointerUp = () => {
      setDragMode("none");
      setIsInteracting(false);
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);
    window.addEventListener("touchmove", handlePointerMove);
    window.addEventListener("touchend", handlePointerUp);

    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
      window.removeEventListener("touchmove", handlePointerMove);
      window.removeEventListener("touchend", handlePointerUp);
    };
  }, [dragMode, getSVGCoordinates]);

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
            {/* Interactive SVG Floor Plan */}
            <svg
              ref={svgRef}
              viewBox="0 0 680 580"
              className="w-full h-full max-w-xl cursor-crosshair"
              style={{ touchAction: "none" }}
            >
              <defs>
                <pattern id="gridPattern" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#2a2723" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#gridPattern)" />

              {/* Room Interior Fill */}
              <polygon points="100,100 540,100 540,460 100,460" fill="#22201d" fillOpacity="0.8" />

              {/* INTERACTIVE WATER DAMAGE ZONE */}
              <g>
                {/* Semi-transparent filled area */}
                <rect
                  x={damageBox.x}
                  y={damageBox.y}
                  width={damageBox.width}
                  height={damageBox.height}
                  rx="10"
                  fill="#c96442"
                  fillOpacity={isInteracting ? 0.32 : 0.22}
                  stroke="#c96442"
                  strokeWidth={isInteracting ? 2.5 : 2}
                  strokeDasharray="6,4"
                  className="cursor-move transition-colors"
                  onMouseDown={(e) => handlePointerDown("move", e)}
                  onTouchStart={(e) => handlePointerDown("move", e)}
                />

                {/* Central Dynamic Text Badge */}
                <g pointerEvents="none">
                  <rect
                    x={damageBox.x + damageBox.width / 2 - 120}
                    y={damageBox.y + damageBox.height / 2 - 24}
                    width={240}
                    height={48}
                    rx="6"
                    fill="#181716"
                    fillOpacity="0.88"
                    stroke="#c96442"
                    strokeWidth="1"
                  />
                  <text
                    x={damageBox.x + damageBox.width / 2}
                    y={damageBox.y + damageBox.height / 2 - 6}
                    fill="#e28362"
                    fontFamily="system-ui, sans-serif"
                    fontSize="13"
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    💧 Damage: {liveDamageAreaM2} m² ({roomCoveragePct}%)
                  </text>
                  <text
                    x={damageBox.x + damageBox.width / 2}
                    y={damageBox.y + damageBox.height / 2 + 13}
                    fill="#a6a097"
                    fontFamily="system-ui, sans-serif"
                    fontSize="10"
                    textAnchor="middle"
                  >
                    {dimWidthM}m W × {dimHeightM}m L · Drag handles to resize
                  </text>
                </g>

                {/* 4 CORNER RESIZE HANDLES */}
                {/* Top-Left Handle */}
                <circle
                  cx={damageBox.x}
                  cy={damageBox.y}
                  r="8"
                  fill="#c96442"
                  stroke="#ffffff"
                  strokeWidth="2"
                  className="cursor-nwse-resize hover:scale-125 transition-transform"
                  onMouseDown={(e) => handlePointerDown("nw", e)}
                  onTouchStart={(e) => handlePointerDown("nw", e)}
                />

                {/* Top-Right Handle */}
                <circle
                  cx={damageBox.x + damageBox.width}
                  cy={damageBox.y}
                  r="8"
                  fill="#c96442"
                  stroke="#ffffff"
                  strokeWidth="2"
                  className="cursor-nesw-resize hover:scale-125 transition-transform"
                  onMouseDown={(e) => handlePointerDown("ne", e)}
                  onTouchStart={(e) => handlePointerDown("ne", e)}
                />

                {/* Bottom-Left Handle */}
                <circle
                  cx={damageBox.x}
                  cy={damageBox.y + damageBox.height}
                  r="8"
                  fill="#c96442"
                  stroke="#ffffff"
                  strokeWidth="2"
                  className="cursor-nesw-resize hover:scale-125 transition-transform"
                  onMouseDown={(e) => handlePointerDown("sw", e)}
                  onTouchStart={(e) => handlePointerDown("sw", e)}
                />

                {/* Bottom-Right Handle */}
                <circle
                  cx={damageBox.x + damageBox.width}
                  cy={damageBox.y + damageBox.height}
                  r="8"
                  fill="#c96442"
                  stroke="#ffffff"
                  strokeWidth="2"
                  className="cursor-nwse-resize hover:scale-125 transition-transform"
                  onMouseDown={(e) => handlePointerDown("se", e)}
                  onTouchStart={(e) => handlePointerDown("se", e)}
                />
              </g>

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
                Total Area: {TOTAL_ROOM_AREA_M2} m² ({tier.includes("LiDAR") ? "Native LiDAR" : "Metric Scan"})
              </text>
            </svg>

            {/* Instruction Overlay Pill */}
            <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur-md px-3 py-1 rounded-lg text-[11px] font-mono text-[#a6a097] border border-white/10 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#c96442] animate-pulse" />
              <span>Drag box to move · Drag corners to resize damage area</span>
            </div>

            {isDemo && (
              <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-md px-2.5 py-0.5 rounded text-[10px] font-mono text-[#a6a097] border border-white/10">
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
