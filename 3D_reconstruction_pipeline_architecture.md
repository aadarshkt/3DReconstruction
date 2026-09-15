flowchart TD
    subgraph TIER_ROUTER["Tier Dispatcher (tier_router.py)"]
        IN_A["Tier A: Photos"] --> COLMAP_A["run_photo_tier()"]
        IN_B["Tier B: Video"] --> FFMPEG["FFmpeg 3fps"] --> COLMAP_B["run_video_tier()"]
        IN_C["Tier C: LiDAR"] --> PARSE_C["run_lidar_tier() (RoomPlan/USDZ)"]
        IN_HYBRID["Tier: Hybrid"] --> ICP["fuse_tiers() (Open3D FPFH + ICP)"]
    end

    COLMAP_A & COLMAP_B --> COLMAP_RUN["COLMAP SfM + MVS → Scale Anchoring"]
    COLMAP_RUN --> METRIC_PLY["scan_metric.ply (Metric Point Cloud)"]
    PARSE_C --> METRIC_PLY
    ICP --> METRIC_PLY

    subgraph COMMON["Common Geometry Engine (common_backend.py)"]
        METRIC_PLY --> OUTLIERS["Statistical Outlier Removal"]
        OUTLIERS --> RANSAC["Multi-Plane RANSAC Extraction"]
        RANSAC --> FLOORS["Floor / Ceiling Z-Bounds"]
        RANSAC --> WALLS["Wall Inlier Clouds"]
        WALLS --> SLICE["Adaptive Horizontal Z-Slice (25%-75%)"]
        SLICE --> REGRESS["2D Linear Regression Lines"]
        REGRESS --> SNAP["Dominant 90° Axis Snapping"]
        SNAP --> GAPS["1D Density Histogram Gap Detection (Doors/Windows)"]
        GAPS --> SHOELACE["Shoelace Formula (Floor Area m²)"]
    end

    subgraph EXPORT["CAD Exporter (exporter.py)"]
        SHOELACE --> DXF["floor_plan.dxf (CAD Polyline + Dimensions)"]
        SHOELACE --> SVG["floor_plan.svg (Scalable Vector Preview)"]
        SHOELACE --> JSON_RES["results.json (Wall Geometry & Metadata)"]
        SHOELACE --> CSV_VAL["validation.csv (Accuracy Comparison)"]
    end
