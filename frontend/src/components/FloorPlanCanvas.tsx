"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { Stage, Layer, Rect, Line, Text, Group, Transformer, Arc } from "react-konva";
import type Konva from "konva";

export interface DamageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FloorPlanCanvasProps {
  damageBox: DamageBox;
  onChange: (box: DamageBox) => void;
  onInteractingChange?: (interacting: boolean) => void;
  areaM2?: number;
  tier?: string;
}

const VIRTUAL_WIDTH = 680;
const VIRTUAL_HEIGHT = 580;

const ROOM_MIN_X = 100;
const ROOM_MAX_X = 540;
const ROOM_MIN_Y = 100;
const ROOM_MAX_Y = 460;
const ROOM_WIDTH_PX = ROOM_MAX_X - ROOM_MIN_X; // 440 px
const ROOM_HEIGHT_PX = ROOM_MAX_Y - ROOM_MIN_Y; // 360 px
const ROOM_WIDTH_M = 5.4;
const ROOM_HEIGHT_M = 4.5;

export default function FloorPlanCanvas({
  damageBox,
  onChange,
  onInteractingChange,
  areaM2 = 24.5,
  tier = "Native LiDAR (Apple RoomPlan)",
}: FloorPlanCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageDimensions, setStageDimensions] = useState({
    width: VIRTUAL_WIDTH,
    height: VIRTUAL_HEIGHT,
    scale: 1,
  });

  const shapeRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);

  // Synchronize Konva transformer with shape
  useEffect(() => {
    if (trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, []);

  // Update node position if damageBox prop changes from presets/outside
  useEffect(() => {
    if (shapeRef.current) {
      const node = shapeRef.current;
      node.x(damageBox.x);
      node.y(damageBox.y);
      node.width(damageBox.width);
      node.height(damageBox.height);
      node.scaleX(1);
      node.scaleY(1);
      node.getLayer()?.batchDraw();
    }
  }, [damageBox]);

  // Responsive scaling to fit parent container width
  useEffect(() => {
    const updateDimensions = () => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.offsetWidth || VIRTUAL_WIDTH;
      const targetScale = Math.min(1, Math.max(0.4, containerWidth / VIRTUAL_WIDTH));
      setStageDimensions({
        width: VIRTUAL_WIDTH * targetScale,
        height: VIRTUAL_HEIGHT * targetScale,
        scale: targetScale,
      });
    };

    updateDimensions();
    const ro = new ResizeObserver(updateDimensions);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Clamping for transformer resizing
  const boundBoxFunc = useCallback(
    (oldBox: { x: number; y: number; width: number; height: number }, newBox: { x: number; y: number; width: number; height: number }) => {
      const MIN_SIZE = 40;
      let { x, y, width, height } = newBox;

      if (width < MIN_SIZE) width = MIN_SIZE;
      if (height < MIN_SIZE) height = MIN_SIZE;

      if (x < ROOM_MIN_X) {
        width = width - (ROOM_MIN_X - x);
        x = ROOM_MIN_X;
      }
      if (y < ROOM_MIN_Y) {
        height = height - (ROOM_MIN_Y - y);
        y = ROOM_MIN_Y;
      }
      if (x + width > ROOM_MAX_X) {
        width = ROOM_MAX_X - x;
      }
      if (y + height > ROOM_MAX_Y) {
        height = ROOM_MAX_Y - y;
      }

      return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.max(MIN_SIZE, Math.round(width)),
        height: Math.max(MIN_SIZE, Math.round(height)),
        rotation: 0,
      };
    },
    []
  );

  // Clamping for dragging the damage box
  const dragBoundFunc = useCallback((pos: { x: number; y: number }) => {
    const scale = stageDimensions.scale;
    // Virtual coordinates
    const virtX = pos.x / scale;
    const virtY = pos.y / scale;

    const currentW = shapeRef.current ? shapeRef.current.width() : damageBox.width;
    const currentH = shapeRef.current ? shapeRef.current.height() : damageBox.height;

    const clampedVirtX = Math.max(ROOM_MIN_X, Math.min(ROOM_MAX_X - currentW, virtX));
    const clampedVirtY = Math.max(ROOM_MIN_Y, Math.min(ROOM_MAX_Y - currentH, virtY));

    return {
      x: clampedVirtX * scale,
      y: clampedVirtY * scale,
    };
  }, [stageDimensions.scale, damageBox.width, damageBox.height]);

  const handleTransform = () => {
    const node = shapeRef.current;
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const liveW = Math.max(40, Math.round(node.width() * scaleX));
    const liveH = Math.max(40, Math.round(node.height() * scaleY));
    const liveX = Math.round(node.x());
    const liveY = Math.round(node.y());
    onChange({ x: liveX, y: liveY, width: liveW, height: liveH });
  };

  const handleTransformEnd = () => {
    const node = shapeRef.current;
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const newWidth = Math.max(40, Math.round(node.width() * scaleX));
    const newHeight = Math.max(40, Math.round(node.height() * scaleY));
    const newX = Math.round(node.x());
    const newY = Math.round(node.y());

    node.scaleX(1);
    node.scaleY(1);
    node.x(newX);
    node.y(newY);
    node.width(newWidth);
    node.height(newHeight);

    onChange({ x: newX, y: newY, width: newWidth, height: newHeight });
    onInteractingChange?.(false);
  };

  const handleDragMove = () => {
    const node = shapeRef.current;
    if (!node) return;
    onChange({
      x: Math.round(node.x()),
      y: Math.round(node.y()),
      width: Math.round(node.width()),
      height: Math.round(node.height()),
    });
  };

  const handleDragEnd = () => {
    handleDragMove();
    onInteractingChange?.(false);
  };

  // Dimensions for badge
  const dimWidthM = Number(((damageBox.width / ROOM_WIDTH_PX) * ROOM_WIDTH_M).toFixed(2));
  const dimHeightM = Number(((damageBox.height / ROOM_HEIGHT_PX) * ROOM_HEIGHT_M).toFixed(2));
  const liveDamageAreaM2 = Number((dimWidthM * dimHeightM).toFixed(1));
  const roomCoveragePct = Math.min(100, Math.round((liveDamageAreaM2 / areaM2) * 100));

  // Blueprint grid lines
  const gridLines: React.ReactNode[] = [];
  for (let x = 0; x <= VIRTUAL_WIDTH; x += 40) {
    gridLines.push(
      <Line key={`gx-${x}`} points={[x, 0, x, VIRTUAL_HEIGHT]} stroke="#2a2723" strokeWidth={1} />
    );
  }
  for (let y = 0; y <= VIRTUAL_HEIGHT; y += 40) {
    gridLines.push(
      <Line key={`gy-${y}`} points={[0, y, VIRTUAL_WIDTH, y]} stroke="#2a2723" strokeWidth={1} />
    );
  }

  return (
    <div ref={containerRef} className="w-full flex justify-center items-center select-none overflow-hidden">
      <Stage
        width={stageDimensions.width}
        height={stageDimensions.height}
        scaleX={stageDimensions.scale}
        scaleY={stageDimensions.scale}
      >
        <Layer>
          {/* Blueprint background grid */}
          <Rect x={0} y={0} width={VIRTUAL_WIDTH} height={VIRTUAL_HEIGHT} fill="#181716" />
          {gridLines}

          {/* Room Interior Fill */}
          <Rect
            x={ROOM_MIN_X}
            y={ROOM_MIN_Y}
            width={ROOM_WIDTH_PX}
            height={ROOM_HEIGHT_PX}
            fill="#22201d"
            opacity={0.8}
          />

          {/* Wall 1: Top (5.40m) */}
          <Line points={[100, 100, 540, 100]} stroke="#f8fafc" strokeWidth={8} lineCap="round" />
          <Rect x={260} y={76} width={120} height={22} cornerRadius={4} fill="#181716" stroke="#c96442" strokeWidth={1} />
          <Text x={260} y={81} width={120} text="WALL 1: 5.40 m" fill="#e28362" fontSize={11} fontStyle="bold" align="center" />

          {/* Wall 2: Right (4.50m) with Doorway */}
          <Line points={[540, 100, 540, 230]} stroke="#f8fafc" strokeWidth={8} lineCap="round" />
          <Line points={[540, 330, 540, 460]} stroke="#f8fafc" strokeWidth={8} lineCap="round" />
          <Arc x={540} y={230} innerRadius={88} outerRadius={90} angle={90} rotation={90} stroke="#eab308" strokeWidth={2} dash={[4, 3]} />
          <Line points={[540, 230, 450, 230]} stroke="#eab308" strokeWidth={3} />
          <Text x={470} y={218} text="Doorway" fill="#facc15" fontSize={11} fontStyle="600" />
          <Text x={555} y={275} text="4.50 m" fill="#e28362" fontSize={11} fontStyle="bold" />

          {/* Wall 3: Bottom (5.40m) with Window */}
          <Line points={[100, 460, 260, 460]} stroke="#f8fafc" strokeWidth={8} lineCap="round" />
          <Line points={[380, 460, 540, 460]} stroke="#f8fafc" strokeWidth={8} lineCap="round" />
          <Line points={[260, 460, 380, 460]} stroke="#38bdf8" strokeWidth={5} />
          <Text x={260} y={476} width={120} text="Window (1.20 m)" fill="#38bdf8" fontSize={11} fontStyle="600" align="center" />
          <Rect x={260} y={495} width={120} height={22} cornerRadius={4} fill="#181716" stroke="#c96442" strokeWidth={1} />
          <Text x={260} y={500} width={120} text="WALL 3: 5.40 m" fill="#e28362" fontSize={11} fontStyle="bold" align="center" />

          {/* Wall 4: Left (4.50m) */}
          <Line points={[100, 100, 100, 460]} stroke="#f8fafc" strokeWidth={8} lineCap="round" />
          <Text x={75} y={285} text="WALL 4: 4.50 m" fill="#e28362" fontSize={11} fontStyle="bold" rotation={-90} />

          {/* Room Info Badge */}
          <Rect x={115} y={115} width={200} height={52} cornerRadius={6} fill="#181716" opacity={0.95} stroke="#38342f" strokeWidth={1} />
          <Text x={125} y={125} text="Kitchen & Living Room" fill="#f8fafc" fontSize={12} fontStyle="bold" />
          <Text x={125} y={143} text={`Total Area: ${areaM2} m² (${tier.includes("LiDAR") ? "Native LiDAR" : "Metric Scan"})`} fill="#a6a097" fontSize={11} />

          {/* INTERACTIVE WATER DAMAGE ZONE (Konva Rect) */}
          <Rect
            ref={shapeRef}
            x={damageBox.x}
            y={damageBox.y}
            width={damageBox.width}
            height={damageBox.height}
            fill="#c96442"
            opacity={0.25}
            stroke="#c96442"
            strokeWidth={2}
            dash={[6, 4]}
            cornerRadius={8}
            draggable
            dragBoundFunc={dragBoundFunc}
            onDragStart={() => onInteractingChange?.(true)}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onTransformStart={() => onInteractingChange?.(true)}
            onTransform={handleTransform}
            onTransformEnd={handleTransformEnd}
          />

          {/* Central Measurement Badge inside the damage zone */}
          <Group
            x={damageBox.x + damageBox.width / 2 - 110}
            y={damageBox.y + damageBox.height / 2 - 22}
            listening={false}
          >
            <Rect
              width={220}
              height={44}
              cornerRadius={6}
              fill="#181716"
              opacity={0.92}
              stroke="#c96442"
              strokeWidth={1}
            />
            <Text
              x={0}
              y={7}
              width={220}
              text={`💧 Damage: ${liveDamageAreaM2} m² (${roomCoveragePct}%)`}
              fill="#e28362"
              fontSize={12}
              fontStyle="bold"
              align="center"
            />
            <Text
              x={0}
              y={24}
              width={220}
              text={`${dimWidthM}m W × ${dimHeightM}m L · Drag handles`}
              fill="#a6a097"
              fontSize={10}
              align="center"
            />
          </Group>

          {/* KONVA TRANSFORMER: Zero-flicker Hardware Accelerated Handles */}
          <Transformer
            ref={trRef}
            rotateEnabled={false}
            enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
            boundBoxFunc={boundBoxFunc}
            anchorFill="#c96442"
            anchorStroke="#ffffff"
            anchorStrokeWidth={2}
            anchorSize={14}
            anchorCornerRadius={7}
            borderStroke="#c96442"
            borderStrokeWidth={1.5}
            borderDash={[4, 4]}
          />
        </Layer>
      </Stage>
    </div>
  );
}
