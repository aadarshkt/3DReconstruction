"""
Export stage: converts WallSegment objects into deliverable files.

Outputs
───────
- floor_plan.dxf   : dimensioned CAD file (AutoCAD-compatible, via ezdxf)
- floor_plan.svg   : raster-free vector preview (via svgwrite)
- results.json     : full structured result payload
- validation.csv   : tape-measure comparison table (if reference data provided)
"""
import csv
import json
import math
from pathlib import Path
from typing import Optional

import ezdxf
import svgwrite
import structlog

from app.pipeline.common_backend import WallSegment

log = structlog.get_logger()

# ── SVG layout constants ──────────────────────────────────────────────────────
SVG_SCALE = 100          # pixels per metre
SVG_MARGIN = 60          # pixels padding around drawing
SVG_WALL_COLOR = "#1a1a2e"
SVG_DIM_COLOR  = "#e94560"
SVG_DOOR_COLOR = "#f5a623"
SVG_WIN_COLOR  = "#4ab8f5"
SVG_FONT       = "Inter, Helvetica Neue, sans-serif"


def export_all(
    job_id: str,
    walls: list[WallSegment],
    scale_confidence: str,
    results_dir: Path,
    tape_measurements: Optional[dict] = None,
) -> dict:
    """
    Generate all output files and return the `files` payload block.

    Parameters
    ----------
    job_id            : job identifier (for logging)
    walls             : list of WallSegment from common_backend
    scale_confidence  : "native_metric" | "scaled_via_reference"
    results_dir       : directory to write outputs into
    tape_measurements : optional dict {wall_id: real_length_m} for validation

    Returns
    -------
    dict of {key: relative_path_string} for each output file
    """
    results_dir.mkdir(parents=True, exist_ok=True)

    dxf_path = results_dir / "floor_plan.dxf"
    svg_path = results_dir / "floor_plan.svg"
    json_path = results_dir / "results.json"
    csv_path  = results_dir / "validation.csv"

    _export_dxf(walls, dxf_path)
    _export_svg(walls, svg_path)
    payload = _export_json(walls, scale_confidence, json_path)
    _export_validation_csv(walls, tape_measurements or {}, csv_path)

    files = {
        "floor_plan_dxf": str(dxf_path.relative_to(results_dir.parent.parent)),
        "floor_plan_svg": str(svg_path.relative_to(results_dir.parent.parent)),
        "point_cloud_ply": str((results_dir / "scan_metric.ply").relative_to(results_dir.parent.parent)),
        "validation_csv":  str(csv_path.relative_to(results_dir.parent.parent)),
    }

    log.info("export_complete", job_id=job_id, files=list(files.keys()))
    return payload, files


# ── DXF export ────────────────────────────────────────────────────────────────
def _export_dxf(walls: list[WallSegment], out: Path):
    """
    Build a dimensioned DXF floor plan using ezdxf.

    Each wall is drawn as a thick LWPOLYLINE, and an ALIGNED_DIM entity is
    added offset 0.3 m from the wall so lengths are readable in any CAD tool.
    """
    doc = ezdxf.new(dxfversion="R2010")
    msp = doc.modelspace()

    # Layers
    doc.layers.add("WALLS",      color=7, lineweight=50)   # white, 0.5 mm
    doc.layers.add("DIMENSIONS", color=1)                  # red
    doc.layers.add("OPENINGS",   color=3)                  # green

    for seg in walls:
        x0, y0 = seg.start
        x1, y1 = seg.end

        # Wall line
        msp.add_line(
            (x0, y0), (x1, y1),
            dxfattribs={"layer": "WALLS", "lineweight": 50}
        )

        # Aligned dimension (offset perpendicular to wall by 0.3 m)
        nx, ny = seg.normal
        try:
            dim = msp.add_aligned_dim(
                p1=(x0, y0),
                p2=(x1, y1),
                distance=0.3,
                dxfattribs={"layer": "DIMENSIONS"},
            )
            dim.render()
        except Exception as e:
            log.warning("dxf_dim_failed", wall_id=seg.id, error=str(e))

        # Openings
        for opening in seg.openings:
            t = opening.position_along_wall / seg.length_m
            ox = x0 + t * (x1 - x0)
            oy = y0 + t * (y1 - y0)
            color = 1 if opening.opening_type == "door" else 4
            circle = msp.add_circle(
                center=(ox, oy), radius=0.05,
                dxfattribs={"layer": "OPENINGS", "color": color}
            )
            msp.add_text(
                opening.opening_type,
                dxfattribs={"layer": "OPENINGS", "height": 0.1,
                            "insert": (ox + 0.05, oy + 0.05)}
            )

    doc.saveas(str(out))
    log.info("dxf_saved", path=str(out))


# ── SVG export ────────────────────────────────────────────────────────────────
def _export_svg(walls: list[WallSegment], out: Path):
    """
    Generate a clean, styled SVG floor plan preview.

    The SVG is self-contained (no external dependencies) so it can be embedded
    directly in a WKWebView or opened in a browser.
    """
    if not walls:
        log.warning("svg_export_no_walls")
        dwg = svgwrite.Drawing(str(out), size=("600px", "400px"))
        dwg.add(dwg.rect(insert=(0, 0), size=("100%", "100%"), fill="#0f1117", rx=8, ry=8))
        dwg.add(dwg.text("Floor Plan Preview", insert=(300, 160),
                         font_size="20px", font_family=SVG_FONT,
                         font_weight="bold", fill="#e2e8f0", text_anchor="middle"))
        dwg.add(dwg.text("No wall segments detected in reconstruction", insert=(300, 200),
                         font_size="14px", font_family=SVG_FONT,
                         fill="#94a3b8", text_anchor="middle"))
        dwg.add(dwg.text("Check the 3D Point Cloud tab to view reconstructed points", insert=(300, 230),
                         font_size="12px", font_family=SVG_FONT,
                         fill="#6366f1", text_anchor="middle"))
        dwg.save()
        log.info("svg_saved_placeholder", path=str(out))
        return

    # Compute bounding box
    all_x = [seg.start[0] for seg in walls] + [seg.end[0] for seg in walls]
    all_y = [seg.start[1] for seg in walls] + [seg.end[1] for seg in walls]
    min_x, max_x = min(all_x), max(all_x)
    min_y, max_y = min(all_y), max(all_y)

    w_px = int((max_x - min_x) * SVG_SCALE + 2 * SVG_MARGIN)
    h_px = int((max_y - min_y) * SVG_SCALE + 2 * SVG_MARGIN)

    def to_px(x, y):
        """Convert metric coords to SVG pixel coords (Y flipped)."""
        px = (x - min_x) * SVG_SCALE + SVG_MARGIN
        py = (max_y - y) * SVG_SCALE + SVG_MARGIN
        return px, py

    dwg = svgwrite.Drawing(str(out), size=(f"{w_px}px", f"{h_px}px"))
    dwg.add(dwg.rect(insert=(0, 0), size=("100%", "100%"), fill="#f8f9fa"))

    # Title
    dwg.add(dwg.text("Floor Plan", insert=(SVG_MARGIN, 20),
                     font_size="14px", font_family=SVG_FONT,
                     font_weight="bold", fill=SVG_WALL_COLOR))

    for seg in walls:
        sx, sy = to_px(*seg.start)
        ex, ey = to_px(*seg.end)

        # Wall line (thick)
        dwg.add(dwg.line(start=(sx, sy), end=(ex, ey),
                         stroke=SVG_WALL_COLOR, stroke_width=4,
                         stroke_linecap="round"))

        # Dimension label at midpoint
        mx, my = (sx + ex) / 2, (sy + ey) / 2
        label = f"{seg.length_m:.2f} m"
        # Offset label perpendicular to wall
        dx, dy = ex - sx, ey - sy
        nl = math.hypot(dx, dy) or 1
        offset = 14
        lx = mx + (-dy / nl) * offset
        ly = my + (dx / nl) * offset

        dwg.add(dwg.text(label, insert=(lx, ly),
                         font_size="11px", font_family=SVG_FONT,
                         fill=SVG_DIM_COLOR, text_anchor="middle",
                         dominant_baseline="middle"))

        # Openings
        for opening in seg.openings:
            t = opening.position_along_wall / (seg.length_m or 1)
            ox = sx + t * (ex - sx)
            oy = sy + t * (ey - sy)
            color = SVG_DOOR_COLOR if opening.opening_type == "door" else SVG_WIN_COLOR
            dwg.add(dwg.circle(center=(ox, oy), r=6,
                                fill=color, opacity=0.85))
            dwg.add(dwg.text(opening.opening_type[0].upper(),
                             insert=(ox, oy + 4),
                             font_size="9px", font_family=SVG_FONT,
                             fill="white", text_anchor="middle"))

    dwg.save()
    log.info("svg_saved", path=str(out))


# ── JSON export ───────────────────────────────────────────────────────────────
def _export_json(walls: list[WallSegment], scale_confidence: str, out: Path) -> dict:
    """Export the full structured result as JSON and return the dict."""
    from app.pipeline.common_backend import compute_room_area

    area = compute_room_area(walls)

    payload = {
        "scale_confidence": scale_confidence,
        "room_area_m2": area,
        "wall_count": len(walls),
        "walls": [
            {
                "id": seg.id,
                "length_m": seg.length_m,
                "start": list(seg.start),
                "end": list(seg.end),
                "has_opening": seg.has_opening,
                "opening_type": seg.opening_type,
                "openings": [
                    {
                        "type": o.opening_type,
                        "position_along_wall_m": o.position_along_wall,
                        "width_m": o.width_m,
                    }
                    for o in seg.openings
                ],
            }
            for seg in walls
        ],
        "error_estimate": _compute_error_estimate(scale_confidence),
    }

    with open(out, "w") as f:
        json.dump(payload, f, indent=2)

    log.info("json_saved", path=str(out))
    return payload


def _compute_error_estimate(scale_confidence: str) -> dict:
    """Return a heuristic error estimate based on the capture tier."""
    if scale_confidence == "native_metric":
        return {"method": "lidar_native", "expected_wall_error_cm": 2.5}
    elif scale_confidence == "scaled_via_reference":
        return {"method": "scale_propagation", "expected_wall_error_cm": 5.0}
    else:
        return {"method": "unscaled_sfm", "expected_wall_error_cm": None}


# ── Validation CSV ────────────────────────────────────────────────────────────
def _export_validation_csv(
    walls: list[WallSegment],
    tape_measurements: dict,     # {wall_id (str/int): real_length_m}
    out: Path,
):
    """
    Write a CSV comparing pipeline wall lengths to physical tape measurements.

    Columns: wall_id, pipeline_m, tape_m, abs_error_cm, pct_error
    """
    rows = []
    for seg in walls:
        tape = tape_measurements.get(str(seg.id)) or tape_measurements.get(seg.id)
        if tape is not None:
            abs_err_cm = abs(seg.length_m - tape) * 100
            pct_err = abs_err_cm / (tape * 100) * 100 if tape > 0 else None
        else:
            abs_err_cm = None
            pct_err = None

        rows.append({
            "wall_id": seg.id,
            "pipeline_length_m": seg.length_m,
            "tape_length_m": tape or "",
            "abs_error_cm": f"{abs_err_cm:.2f}" if abs_err_cm is not None else "",
            "pct_error": f"{pct_err:.2f}" if pct_err is not None else "",
        })

    with open(out, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys() if rows else [])
        writer.writeheader()
        writer.writerows(rows)

    log.info("csv_saved", path=str(out), rows=len(rows))
