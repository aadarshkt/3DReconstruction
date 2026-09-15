"""
Tier C (LiDAR) pipeline.

Supports two export formats from iOS RoomPlan / ARKit:

1. **RoomPlan CapturedRoom JSON** — high-level semantic (walls, doors, windows
   with dimensions already in metres).  Fastest path.

2. **USDZ mesh** — raw ARKit scene reconstruction mesh.  We sample it into a
   point cloud and pass it to the common backend.

Since LiDAR output is natively metric, no scale-anchoring is needed.
The output is flagged `"native_metric"` in the result payload.
"""
import json
from pathlib import Path
from typing import Callable

import numpy as np
import open3d as o3d
import structlog

from app.config import get_job_dir, get_results_dir

log = structlog.get_logger()
ProgressCb = Callable[[str, int], None]


def run_lidar_tier(job_id: str, progress_cb: ProgressCb, diag=None) -> Path:
    """
    Convert LiDAR export to a metric point cloud.

    Tries RoomPlan JSON first, falls back to USDZ mesh.

    Returns
    -------
    Path to scan_metric.ply (natively metric, Z-up, gravity-aligned)
    """
    job_dir = get_job_dir(job_id)
    progress_cb("lidar_converting", 10)

    # ── Try RoomPlan JSON ──────────────────────────────────────────────────────
    json_files = list(job_dir.glob("*.json")) + list((job_dir / "images").glob("*.json"))
    if json_files:
        log.info("lidar_json_found", path=str(json_files[0]))
        return _from_roomplan_json(job_id, json_files[0], progress_cb, diag)

    # ── Try USDZ mesh ──────────────────────────────────────────────────────────
    usdz_files = list(job_dir.glob("*.usdz")) + list((job_dir / "images").glob("*.usdz"))
    if usdz_files:
        log.info("lidar_usdz_found", path=str(usdz_files[0]))
        return _from_usdz(job_id, usdz_files[0], progress_cb, diag)

    # ── Try PLY / OBJ (pre-converted mesh) ────────────────────────────────────
    mesh_files = list(job_dir.glob("*.ply")) + list(job_dir.glob("*.obj"))
    if mesh_files:
        log.info("lidar_mesh_found", path=str(mesh_files[0]))
        return _from_mesh_file(job_id, mesh_files[0], progress_cb, diag)

    raise FileNotFoundError(
        f"No LiDAR export found in job {job_id}. "
        "Expected a RoomPlan .json, .usdz, .ply, or .obj file."
    )


# ── RoomPlan JSON → point cloud ───────────────────────────────────────────────
def _from_roomplan_json(job_id: str, json_path: Path, progress_cb: ProgressCb, diag=None) -> Path:
    """
    Parse a RoomPlan CapturedRoom JSON export and synthesise a point cloud
    from the wall / floor / ceiling geometry.

    RoomPlan JSON structure (abbreviated):
    {
      "walls": [
        {
          "dimensions": {"width": 4.12, "height": 2.4},
          "transform": [[r00,r01,r02,tx], [r10,r11,r12,ty], ...]
        }, ...
      ],
      "doors": [...],
      "windows": [...]
    }
    """
    progress_cb("lidar_converting", 30)

    with open(json_path) as f:
        data = json.load(f)

    all_points: list[np.ndarray] = []

    for wall in data.get("walls", []):
        pts = _sample_wall(wall)
        all_points.append(pts)

    for door in data.get("doors", []):
        pts = _sample_wall(door, density=50)
        all_points.append(pts)

    for window in data.get("windows", []):
        pts = _sample_wall(window, density=50)
        all_points.append(pts)

    if not all_points:
        raise ValueError("RoomPlan JSON contained no walls/doors/windows.")

    points = np.vstack(all_points)
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(points)
    pcd.estimate_normals()

    out = _save_metric_ply(job_id, pcd)
    progress_cb("lidar_converting", 90)
    log.info("roomplan_json_converted", job_id=job_id, n_points=len(pcd.points))
    if diag is not None:
        diag.set_metric("lidar_source", "roomplan_json")
        diag.set_metric("lidar_point_cloud_points", len(pcd.points))
    return out


def _sample_wall(element: dict, density: int = 200) -> np.ndarray:
    """
    Uniformly sample `density` 3D points on a RoomPlan wall / door / window.

    The RoomPlan transform is a column-major 4×4 matrix placed in the world.
    Dimensions give width (X) × height (Y) of the planar element.
    """
    dims = element.get("dimensions", {})
    w = float(dims.get("width", 1.0))
    h = float(dims.get("height", 2.4))

    # Random samples in local (u, v) ∈ [0, w] × [0, h]
    u = np.random.uniform(0, w, density)
    v = np.random.uniform(0, h, density)
    local_pts = np.column_stack([u - w / 2, v, np.zeros(density)])

    # Apply RoomPlan world transform (list of 4 rows, each 4 elements)
    T_raw = element.get("transform", [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]])
    T = np.array(T_raw, dtype=float)
    if T.shape != (4, 4):
        T = T.reshape(4, 4)

    # Homogeneous transform
    ones = np.ones((density, 1))
    local_h = np.hstack([local_pts, ones])
    world_pts = (T @ local_h.T).T[:, :3]
    return world_pts


# ── USDZ → point cloud ────────────────────────────────────────────────────────
def _from_usdz(job_id: str, usdz_path: Path, progress_cb: ProgressCb, diag=None) -> Path:
    """
    Convert a USDZ (ZIP of USD files) to a point cloud by extracting the mesh
    and sampling it.

    USDZ is a ZIP archive.  We extract it, look for a .usdc or .usd mesh file,
    then use Open3D to load and sample.

    Note: Open3D does not natively read USD.  We rely on the `usd-core` Python
    package or convert to OBJ first using `usdcat` (part of USD tools).
    """
    import zipfile
    import tempfile

    progress_cb("lidar_converting", 20)

    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(usdz_path, "r") as zf:
            zf.extractall(tmp)
        tmp_path = Path(tmp)

        # Look for mesh files in extracted contents
        obj_files = list(tmp_path.rglob("*.obj"))
        ply_files = list(tmp_path.rglob("*.ply"))
        usd_files = list(tmp_path.rglob("*.usdc")) + list(tmp_path.rglob("*.usd"))

        if obj_files:
            mesh = o3d.io.read_triangle_mesh(str(obj_files[0]))
        elif ply_files:
            mesh = o3d.io.read_triangle_mesh(str(ply_files[0]))
        elif usd_files:
            # Try converting with usdcat if available
            converted = Path(tmp) / "converted.obj"
            import subprocess
            subprocess.run(["usdcat", "--flatten", "-o", str(converted), str(usd_files[0])],
                           check=True)
            mesh = o3d.io.read_triangle_mesh(str(converted))
        else:
            raise FileNotFoundError("No usable mesh found inside USDZ archive.")

    return _mesh_to_ply(job_id, mesh, progress_cb, diag)


# ── Generic mesh file → point cloud ──────────────────────────────────────────
def _from_mesh_file(job_id: str, mesh_path: Path, progress_cb: ProgressCb, diag=None) -> Path:
    progress_cb("lidar_converting", 25)
    mesh = o3d.io.read_triangle_mesh(str(mesh_path))
    return _mesh_to_ply(job_id, mesh, progress_cb, diag)


def _mesh_to_ply(job_id: str, mesh: o3d.geometry.TriangleMesh, progress_cb: ProgressCb, diag=None) -> Path:
    """Sample a mesh surface into a dense point cloud."""
    n_points = max(50_000, len(mesh.vertices) * 10)
    pcd = mesh.sample_points_poisson_disk(number_of_points=n_points)
    pcd.estimate_normals()
    out = _save_metric_ply(job_id, pcd)
    progress_cb("lidar_converting", 90)
    log.info("mesh_to_ply_done", job_id=job_id, n_points=len(pcd.points))
    if diag is not None:
        diag.set_metric("lidar_source", "mesh")
        diag.set_metric("lidar_point_cloud_points", len(pcd.points))
    return out


# ── Save helper ───────────────────────────────────────────────────────────────
def _save_metric_ply(job_id: str, pcd: o3d.geometry.PointCloud) -> Path:
    from app.config import get_results_dir
    out = get_results_dir(job_id) / "scan_metric.ply"
    o3d.io.write_point_cloud(str(out), pcd)
    return out
