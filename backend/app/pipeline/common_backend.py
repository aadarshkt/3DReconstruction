"""
Common backend: point cloud → structural elements.

Steps
─────
1. RANSAC plane extraction (floor, ceiling, walls).
2. Project wall inliers to horizontal slice (z = 1.0–1.5 m).
3. Fit 2D lines to each wall's slice points.
4. Detect door / window openings as density gaps along each wall.
5. Return structured WallSegment objects ready for export.

This stage is tier-agnostic — it receives a metric .ply and produces geometry.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import open3d as o3d
import structlog
from scipy.stats import linregress

from app.config import settings

log = structlog.get_logger()
ProgressCb = Callable[[str, int], None]


# ── Data classes ──────────────────────────────────────────────────────────────
@dataclass
class Opening:
    """A door or window detected as a gap in a wall."""
    opening_type: str           # "door" | "window"
    position_along_wall: float  # distance from wall start (metres)
    width_m: float


@dataclass
class WallSegment:
    id: int
    start: tuple[float, float]      # 2D (x, y) in metres
    end: tuple[float, float]
    length_m: float
    normal: tuple[float, float]     # wall face direction (unit vector)
    openings: list[Opening] = field(default_factory=list)

    @property
    def has_opening(self) -> bool:
        return len(self.openings) > 0

    @property
    def opening_type(self) -> Optional[str]:
        if not self.openings:
            return None
        types = {o.opening_type for o in self.openings}
        return "door" if "door" in types else "window"


# ── Main entry point ──────────────────────────────────────────────────────────
def extract_structural_elements(
    ply_path: Path,
    progress_cb: ProgressCb,
) -> list[WallSegment]:
    """
    Load a metric PLY and extract wall segments with opening detection.

    Parameters
    ----------
    ply_path    : path to scan_metric.ply (Z-up, metric)
    progress_cb : callable(stage, pct)

    Returns
    -------
    List of WallSegment objects.
    """
    progress_cb("plane_extraction", 60)

    pcd = o3d.io.read_point_cloud(str(ply_path))
    log.info("pcd_loaded", n_points=len(pcd.points))

    # ── 1. Remove statistical outliers ───────────────────────────────────────
    pcd, _ = pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)

    points = np.asarray(pcd.points)

    # ── 2. Estimate gravity axis (usually Z; verify from point cloud extent) ──
    # We assume Z-up convention (ARKit exports in Y-up; iOS app must convert).

    # ── 3. RANSAC plane extraction loop ──────────────────────────────────────
    working_cloud = pcd
    extracted_planes: list[tuple[np.ndarray, o3d.geometry.PointCloud]] = []

    # Extract floor (largest horizontal plane first)
    floor_model, floor_cloud, working_cloud = _extract_plane(working_cloud, dist_thresh=0.02)
    ceiling_model, ceiling_cloud, working_cloud = _extract_plane(working_cloud, dist_thresh=0.02)

    log.info("floor_ceiling_extracted",
             floor_pts=len(floor_cloud.points),
             ceiling_pts=len(ceiling_cloud.points),
             remainder_pts=len(working_cloud.points))

    # Extract walls (iterative)
    raw_walls: list[tuple[np.ndarray, o3d.geometry.PointCloud]] = []
    max_wall_iterations = 20

    for _ in range(max_wall_iterations):
        if len(working_cloud.points) < settings.MIN_WALL_POINTS:
            break
        model, wall_cloud, working_cloud = _extract_plane(
            working_cloud, dist_thresh=settings.RANSAC_DISTANCE_THRESH
        )
        if len(wall_cloud.points) < settings.MIN_WALL_POINTS:
            break
        # Filter: walls are vertical (normal nearly horizontal)
        normal = np.array(model[:3])
        if abs(normal[2]) < 0.85:  # Z-component < 0.85 → not floor/ceiling
            raw_walls.append((model, wall_cloud))
        log.debug("wall_plane_extracted", n_pts=len(wall_cloud.points),
                  normal=normal.tolist())

    progress_cb("vectorizing", 75)

    # ── 4. Vectorize walls → 2D line segments ─────────────────────────────────
    wall_segments = _vectorize_walls(raw_walls)

    # ── 5. Snap to dominant orthogonal axes ──────────────────────────────────
    wall_segments = _snap_orthogonal(wall_segments)

    # ── 6. Detect openings ────────────────────────────────────────────────────
    floor_z = _estimate_floor_z(np.asarray(floor_cloud.points))
    for seg in wall_segments:
        # Find the plane cloud for this segment
        plane_pts = _get_wall_cloud_for_segment(seg, raw_walls)
        if plane_pts is not None:
            seg.openings = _detect_openings(seg, plane_pts, floor_z)

    log.info("extraction_complete", wall_count=len(wall_segments))
    progress_cb("vectorizing", 88)
    return wall_segments


# ── RANSAC plane extraction ───────────────────────────────────────────────────
def _extract_plane(
    cloud: o3d.geometry.PointCloud,
    dist_thresh: float = 0.02,
) -> tuple[np.ndarray, o3d.geometry.PointCloud, o3d.geometry.PointCloud]:
    """
    Segment the dominant plane from `cloud` using RANSAC.

    Returns (plane_model, inlier_cloud, outlier_cloud).
    plane_model is [a, b, c, d] for ax+by+cz+d=0.
    """
    model, inliers = cloud.segment_plane(
        distance_threshold=dist_thresh,
        ransac_n=3,
        num_iterations=1000,
    )
    inlier_cloud  = cloud.select_by_index(inliers)
    outlier_cloud = cloud.select_by_index(inliers, invert=True)
    return np.array(model), inlier_cloud, outlier_cloud


# ── Wall vectorization ────────────────────────────────────────────────────────
def _vectorize_walls(
    raw_walls: list[tuple[np.ndarray, o3d.geometry.PointCloud]],
) -> list[WallSegment]:
    """
    For each RANSAC wall plane, project its inliers onto the horizontal slice
    (z = WALL_SLICE_Z_MIN … WALL_SLICE_Z_MAX) and fit a 2D line.
    """
    segments: list[WallSegment] = []

    for idx, (model, cloud) in enumerate(raw_walls):
        pts = np.asarray(cloud.points)

        # Horizontal slice (eye-level band)
        mask = (pts[:, 2] >= settings.WALL_SLICE_Z_MIN) & \
               (pts[:, 2] <= settings.WALL_SLICE_Z_MAX)
        slice_pts = pts[mask]

        if len(slice_pts) < 10:
            log.warning("wall_slice_too_sparse", idx=idx, n=len(slice_pts))
            continue

        x, y = slice_pts[:, 0], slice_pts[:, 1]

        # Decide whether to regress y~x or x~y based on spread
        if np.std(x) >= np.std(y):
            slope, intercept, *_ = linregress(x, y)
            # Endpoints: min/max x of slice
            x0, x1 = x.min(), x.max()
            y0, y1 = slope * x0 + intercept, slope * x1 + intercept
        else:
            slope, intercept, *_ = linregress(y, x)
            y0, y1 = y.min(), y.max()
            x0, x1 = slope * y0 + intercept, slope * y1 + intercept

        length = math.dist((x0, y0), (x1, y1))
        if length < 0.3:   # ignore tiny slivers < 30 cm
            continue

        # Wall face normal (in 2D): perpendicular to the wall direction
        dx, dy = x1 - x0, y1 - y0
        norm_len = math.hypot(dx, dy)
        nx, ny = -dy / norm_len, dx / norm_len

        segments.append(WallSegment(
            id=idx + 1,
            start=(round(x0, 3), round(y0, 3)),
            end=(round(x1, 3), round(y1, 3)),
            length_m=round(length, 3),
            normal=(round(nx, 3), round(ny, 3)),
        ))

    return segments


# ── 90° snapping ──────────────────────────────────────────────────────────────
def _snap_orthogonal(segments: list[WallSegment]) -> list[WallSegment]:
    """
    Snap all wall angles to the two dominant orthogonal axes of the room.

    Algorithm:
    1. Compute the angle of each wall segment.
    2. Cluster into 2 bins separated by ~90°.
    3. Round each wall to the nearest bin centroid.
    """
    if not segments:
        return segments

    angles = np.array([
        math.atan2(seg.end[1] - seg.start[1], seg.end[0] - seg.start[0])
        for seg in segments
    ])
    # Map all angles to [0, π) — walls have no intrinsic direction
    angles = angles % math.pi

    # Weighted mean of dominant angle (most common → primary axis)
    primary = float(np.median(angles))
    secondary = (primary + math.pi / 2) % math.pi

    snapped = []
    for seg, angle in zip(segments, angles):
        d_primary   = abs(_angle_diff(angle, primary))
        d_secondary = abs(_angle_diff(angle, secondary))
        target = primary if d_primary <= d_secondary else secondary

        cx, cy = (seg.start[0] + seg.end[0]) / 2, (seg.start[1] + seg.end[1]) / 2
        half = seg.length_m / 2
        x0 = cx - math.cos(target) * half
        y0 = cy - math.sin(target) * half
        x1 = cx + math.cos(target) * half
        y1 = cy + math.sin(target) * half

        dx, dy = x1 - x0, y1 - y0
        nl = math.hypot(dx, dy) or 1
        snapped.append(WallSegment(
            id=seg.id,
            start=(round(x0, 3), round(y0, 3)),
            end=(round(x1, 3), round(y1, 3)),
            length_m=round(seg.length_m, 3),
            normal=(round(-dy / nl, 3), round(dx / nl, 3)),
            openings=seg.openings,
        ))

    return snapped


def _angle_diff(a: float, b: float) -> float:
    d = (a - b + math.pi) % math.pi - math.pi / 2
    return d


# ── Opening detection ─────────────────────────────────────────────────────────
def _detect_openings(
    seg: WallSegment,
    wall_pts: np.ndarray,
    floor_z: float,
    gap_threshold_m: float = 0.2,
    min_opening_width_m: float = 0.5,
    door_height_threshold_m: float = 1.8,
) -> list[Opening]:
    """
    Detect doors and windows as density gaps in the wall point cloud.

    Strategy
    ────────
    1. Project wall points onto the wall's 1D axis (distance along wall).
    2. Build a 1D occupancy histogram (5 cm bins).
    3. Gaps (consecutive empty bins) wider than `gap_threshold_m` are openings.
    4. Classify by vertical extent: a gap reaching near the floor → door,
       a gap at mid-height → window.
    """
    x0, y0 = seg.start
    x1, y1 = seg.end
    wall_vec = np.array([x1 - x0, y1 - y0])
    wall_len = np.linalg.norm(wall_vec)
    if wall_len < 1e-6:
        return []

    wall_unit = wall_vec / wall_len

    # Project XY onto wall axis
    offsets = (wall_pts[:, :2] - np.array([x0, y0])) @ wall_unit
    valid = (offsets >= 0) & (offsets <= wall_len)
    offsets = offsets[valid]
    heights = wall_pts[valid, 2]

    if len(offsets) < 10:
        return []

    # 5 cm bins along wall length
    bin_size = 0.05
    n_bins = max(1, int(wall_len / bin_size))
    histogram, bin_edges = np.histogram(offsets, bins=n_bins, range=(0, wall_len))

    openings: list[Opening] = []
    in_gap = False
    gap_start = 0.0

    for i, count in enumerate(histogram):
        pos = bin_edges[i]
        if count == 0:
            if not in_gap:
                in_gap = True
                gap_start = pos
        else:
            if in_gap:
                gap_end = pos
                gap_width = gap_end - gap_start
                if gap_width >= min_opening_width_m:
                    gap_center = (gap_start + gap_end) / 2
                    # Classify: check if gap extends to near-floor
                    gap_mask = (offsets >= gap_start) & (offsets <= gap_end)
                    if gap_mask.sum() == 0:
                        # True gap (no points) → check surrounding context
                        min_h = floor_z
                    else:
                        min_h = heights[gap_mask].min()

                    if min_h <= floor_z + 0.3:  # starts near floor → door
                        kind = "door"
                    else:
                        kind = "window"

                    openings.append(Opening(
                        opening_type=kind,
                        position_along_wall=round(gap_center, 3),
                        width_m=round(gap_width, 3),
                    ))
                in_gap = False

    return openings


# ── Helpers ───────────────────────────────────────────────────────────────────
def _estimate_floor_z(floor_pts: np.ndarray) -> float:
    """Estimate floor Z as the 5th percentile of the floor inlier Z values."""
    if len(floor_pts) == 0:
        return 0.0
    return float(np.percentile(floor_pts[:, 2], 5))


def _get_wall_cloud_for_segment(
    seg: WallSegment,
    raw_walls: list[tuple[np.ndarray, o3d.geometry.PointCloud]],
) -> Optional[np.ndarray]:
    """Return the point array for the wall plane whose index matches seg.id."""
    idx = seg.id - 1
    if 0 <= idx < len(raw_walls):
        return np.asarray(raw_walls[idx][1].points)
    return None


def compute_room_area(walls: list[WallSegment]) -> float:
    """
    Estimate room floor area (m²) using the shoelace formula on wall endpoints.

    Assumes walls form a closed polygon (or near-closed for L-shaped rooms).
    """
    if len(walls) < 3:
        return 0.0

    polygon = [seg.start for seg in walls] + [walls[-1].end]
    n = len(polygon)
    area = 0.0
    for i in range(n):
        x0, y0 = polygon[i]
        x1, y1 = polygon[(i + 1) % n]
        area += x0 * y1 - x1 * y0
    return round(abs(area) / 2.0, 2)
