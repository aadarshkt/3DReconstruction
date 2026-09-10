# Implementation Plan: Phone-Capture-to-Dimensioned-Floor-Plan Pipeline

## 1. Requirements

### 1.1 Functional requirements
- Accept three input tiers: (a) a set of overlapping photos, (b) a walkthrough video, (c) an ARKit LiDAR capture (RoomPlan/scene mesh export).
- Produce a metric, stitched 3D digital twin of the captured property, preserving spatial geometry and visual condition. The system must support interactive 3D navigation, measurements, and spatially anchored damage annotations. It must also derive a dimensioned 2D floor plan as a secondary output for area calculations, estimating workflows, and claim documentation.
- Achieve cm-level dimensional accuracy against a physically measured ground truth.
- Support one scale-anchoring mechanism for non-metric tiers (photos/video).
- Report a confidence/error estimate alongside the plan.

### 1.2 Non-functional requirements
- Reproducible pipeline: same input -> same output (deterministic seeds where randomness is used, e.g., RANSAC).
- Modular stages so any tier can be swapped without touching downstream code (common intermediate representation: metric point cloud/mesh).
- Runs end-to-end offline once captured (no cloud dependency required for the demo).
- Walk-in test constraint: pipeline must run on a previously-unseen room within interview time limits, so runtime and manual-tuning steps must be minimized (favor automatic reconstruction commands over hand-tuned parameters per scene).

### 1.3 Environment / tooling requirements
- **Photos/Video tier:** COLMAP (SfM + dense MVS), Python 3.10+, Open3D, NumPy, `ezdxf`.
- **LiDAR tier:** iOS device with LiDAR (iPhone 12 Pro+/iPad Pro), RoomPlan or ARKit scene reconstruction API, Xcode/Swift.
- **Common backend:** Open3D or PCL for point-cloud processing, `ezdxf` for DXF export, `svgwrite` or matplotlib for SVG/plots.
- **Validation:** a physical tape measure, one known reference object (A4 sheet or door height) per photo/video session.
- **Hardware:** any modern laptop for photo tier (CPU is enough for a single room; GPU speeds up dense MVS and any Gaussian Splatting experiment).

### 1.4 Success criteria
- Wall length error <= 3 cm on rooms up to ~5m x 5m for LiDAR tier; <= 5 cm for photo/video tier with a good scale reference.
- Correct topology: right number of walls, doors, windows detected without manual correction on a simple rectangular/L-shaped room.
- End-to-end run completes within a bounded time window suitable for a live walk-in test (target: under 10-15 minutes for photo/video tier on a single room; near-real-time for LiDAR tier).

---

## 2. Implementation Steps

### Step 0 — Common intermediate representation
Define one schema every tier must produce before the shared backend takes over:
- A metric point cloud (`.ply`) in real-world units (meters), gravity-aligned (Z-up or Y-up, pick one and stay consistent).
- A scale-confidence flag: `"native_metric"` (LiDAR) or `"scaled_via_reference"` (photos/video) with the reference length used.

This is the seam that lets you swap tiers without touching the floor-plan generator.

### Step 1 — Tier A: Photos -> metric point cloud

1. Capture 25-40 overlapping photos, 60-70% overlap, varied height, include one reference object of known length in at least 2 frames.
2. Run COLMAP automatic reconstruction:
```bash
DATASET_PATH=/path/to/room
colmap automatic_reconstructor \
  --workspace_path $DATASET_PATH \
  --image_path $DATASET_PATH/images
```
This runs feature extraction, matching, sparse SfM, and dense MVS in one command, producing a dense point cloud/mesh under `$DATASET_PATH/dense`. [web:90][web:101]

3. If you need explicit control (e.g., to inspect intermediate sparse output before committing to dense), use the manual sequence instead:
```bash
colmap feature_extractor --database_path db.db --image_path images/
colmap exhaustive_matcher --database_path db.db
colmap mapper --image_path images/ --output_path sparse/
colmap image_undistorter --image_path images/ --input_path sparse/0 \
  --output_path dense/ --output_type COLMAP
colmap patch_match_stereo --workspace_path dense/
colmap stereo_fusion --workspace_path dense/ --output_path dense/fused.ply
```
[web:90]

4. **Scale anchoring**: measure the reference object's length in the reconstructed (unscaled) point cloud, compute `scale = real_length / reconstructed_length`, and apply it uniformly to all points before saving as your metric `.ply`.

### Step 2 — Tier B: Video -> metric point cloud

1. Extract frames at 2-4 fps with `ffmpeg`:
```bash
ffmpeg -i walkthrough.mp4 -vf fps=3 images/frame_%04d.jpg
```
2. Feed the extracted frames into the **same COLMAP pipeline as Step 1**. This reuses all Tier A code — the only difference is the frame source.
3. Apply the same scale-anchoring approach.
4. (Optional enhancement, not required for MVP) Train a 3D Gaussian Splatting model using the COLMAP poses for a denser/higher-fidelity point cloud before handing off to Step 4.

### Step 3 — Tier C: LiDAR -> metric point cloud

1. Use ARKit **RoomPlan** for the fast path (semantic walls/doors/windows with dimensions built in), or **ARKit Scene Reconstruction** if you want raw mesh geometry to process yourself. [web:61][web:76][web:77]
2. Export the captured room as USDZ/JSON (RoomPlan) or as a mesh (Scene Reconstruction).
3. Since LiDAR output is already metric, skip scale-anchoring — flag it `"native_metric"`.
4. Convert the exported geometry into the same point-cloud/mesh format used by Tiers A/B so it enters the common backend identically.

### Step 4 — Common backend: point cloud -> structural elements

Using Open3D, iteratively remove dominant planes (floor, ceiling, walls) with RANSAC, then cluster what remains:

```python
import open3d as o3d
import numpy as np

pcd = o3d.io.read_point_cloud("scan_metric.ply")

def extract_plane(cloud, dist_thresh=0.02):
    model, inliers = cloud.segment_plane(
        distance_threshold=dist_thresh, ransac_n=3, num_iterations=1000)
    return model, cloud.select_by_index(inliers), cloud.select_by_index(inliers, invert=True)

# Floor
floor_model, floor_cloud, remainder = extract_plane(pcd)
# Ceiling
ceiling_model, ceiling_cloud, remainder = extract_plane(remainder)

walls = []
while len(remainder.points) > 500:
    model, wall_cloud, remainder = extract_plane(remainder, dist_thresh=0.015)
    if len(wall_cloud.points) < 300:
        break
    walls.append((model, wall_cloud))
```
This RANSAC-based plane extraction is the standard approach for indoor point clouds (floor/ceiling/walls are the dominant planes). [web:91][web:96][web:103]

### Step 5 — Wall segment extraction and vectorization

1. For each retained wall plane, project its inlier points onto a horizontal slice (e.g., z = 1.2-1.5 m) and fit a 2D line (least-squares or RANSAC line fit) to get the wall's 2D position and length.
2. Snap near-orthogonal walls to exact 90-degree angles (common in real rooms) using an angle-clustering heuristic (e.g., round each wall's angle to the nearest of the room's dominant axis pair).
3. Detect openings (doors/windows) as gaps in a wall's point density profile along its length; classify by height (a full-height gap starting near floor = door, a mid-height gap = window).
4. Close the loop of wall segments into room polygon(s).

### Step 6 — Dimensioning and export

Use `ezdxf` to build a dimensioned DXF:
```python
import ezdxf

doc = ezdxf.new()
msp = doc.modelspace()

for (x1, y1), (x2, y2) in wall_segments:
    msp.add_line((x1, y1), (x2, y2))
    msp.add_aligned_dim(p1=(x1, y1), p2=(x2, y2), distance=0.3).render()

doc.saveas("floor_plan.dxf")
```
Also export a quick SVG/PNG preview for the live demo (faster to eyeball than opening a CAD file).

### Step 7 — Validation harness

1. Physically measure at least 4-6 reference lengths in the test room (wall lengths, one diagonal, one door width) before or right after capture.
2. Compare pipeline output vs. tape measurements; compute absolute error (cm) and percentage error per wall.
3. Log results into a small CSV/report auto-generated after each run — this becomes your evidence for the "defend your design" portion and your walk-in test submission.

---

## 3. Analysis of Results (what to expect and how to interpret them)

Based on published accuracy benchmarks for these methods:

| Tier | Typical error | Notes |
|---|---|---|
| LiDAR (RoomPlan/ARKit) | ~1-3 cm, ~1% relative | Best accuracy, minimal manual work, limited to LiDAR devices [web:4][web:9][web:11] |
| Video (frames -> COLMAP) | ~3-7 cm | Depends heavily on frame coverage/overlap and scale-reference precision |
| Photos (COLMAP SfM/MVS) | ~2-5 cm with good overlap and reference object | Sensitive to texture-poor walls, motion blur, and reference-measurement error [web:1][web:3][web:9] |

Expected failure patterns to document in your analysis:
- **Plain, texture-poor walls** (common in painted rooms) cause SfM feature matching to fail or produce sparse coverage, degrading wall-plane fitting in the photo/video tiers.
- **Scale error propagation**: any error in measuring the reference object directly and linearly scales every dimension in the final plan — this is usually the single largest error source in Tiers A/B, larger than triangulation noise itself.
- **Non-orthogonal or curved walls**: the 90-degree snapping heuristic in Step 5 will distort genuinely non-rectangular rooms; this must be flagged, not silently "corrected."
- **Door/window misclassification**: gap-based heuristics can confuse a wide doorway with a window or miss openings that are heavily occluded by furniture.
- **LiDAR range limits**: RoomPlan/ARKit LiDAR is reliable to a few meters; very large or oddly shaped rooms and reflective/dark surfaces reduce depth accuracy. [web:11]

When you run the walk-in test, report not just the final DXF but this error table — a room-specific accuracy report is stronger evidence of engineering rigor than a clean-looking plan alone.

---

## 4. How to Improve Further

### Near-term improvements (extend the current implementation)
- **Automatic reference-object detection** (e.g., detect an A4 sheet or door via a small object-detection model) to remove manual scale input and its associated error.
- **Multi-reference averaging**: use 2-3 reference measurements instead of one and least-squares fit the scale factor, reducing sensitivity to any single measurement error.
- **Loop-closure / multi-scan registration** (ICP) to stitch multiple rooms or repeated passes of the same room, improving robustness for larger walk-in test spaces.
- **Confidence-weighted wall fitting**: weight RANSAC inliers by local point density/normal consistency instead of treating all inliers equally, improving robustness against furniture occlusion.
- **Cross-tier fusion**: if both photos and a partial LiDAR capture exist for the same room, fuse them (LiDAR for scale-truth, photos for coverage in LiDAR-blind spots) rather than treating tiers as fully independent.

### Medium-term improvements
- Add a **3D Gaussian Splatting** stage for the video tier to densify geometry beyond COLMAP's MVS output before plane fitting, which should reduce wall-fitting noise, especially in weakly-textured areas. [web:23][web:73]
- Replace heuristic door/window detection with a **trained point-cloud segmentation model** (e.g., a lightweight PointNet-style classifier) for higher precision on ambiguous openings.
- Introduce a **human-in-the-loop correction UI** (drag wall endpoints, confirm/reject detected openings) so the automated output is a fast draft, not a forced final answer — this directly mitigates the failure patterns above without requiring perfect automation.

### Long-term / productization improvements
- Build an **Android parity path** using ARCore Depth API with your own plane/opening detection, since ARCore doesn't provide RoomPlan's semantic layer out of the box. [web:63]
- Track per-room **error budgets** over many test rooms to build a calibration model that predicts expected accuracy from capture quality metrics (image count, overlap, texture score) before the user even exports a plan.
- Package the common backend (Steps 4-6) as a standalone library so new capture tiers (e.g., future stereo-depth phones) can be added by only writing a new "tier adapter" that outputs the metric point cloud/mesh schema.

---

## Key resources referenced
- COLMAP CLI / automatic reconstructor docs [web:90][web:101]
- Open3D RANSAC plane segmentation docs and examples [web:91][web:99]
- Point cloud segmentation guide (RANSAC + DBSCAN for indoor scenes) [web:103]
- Wall detection via RANSAC discussion [web:94][web:96]
- Apple RoomPlan and ARKit Scene Reconstruction documentation [web:61][web:76][web:77]
