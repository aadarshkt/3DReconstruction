flowchart TD
    A["2D Images (Tier A uploads or Tier B video frames)"] --> B["COLMAP automatic_reconstructor (SfM + Dense MVS)"]
    B --> C{"Did automatic_reconstructor produce fused.ply?"}
    C -- Yes --> E["Raw Dense Point Cloud (fused.ply)"]
    C -- No --> D["_run_manual_dense() Fallback (Feature Extractor → Matcher → Mapper → Undistort → PatchMatch → Fusion)"]
    D --> E
    E --> F["_apply_scale() (Convert arbitrary units to real-world metres)"]
    F --> G["Final Metric Point Cloud (scan_metric.ply)"]
