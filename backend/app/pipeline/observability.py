"""
Pipeline run diagnostics collector.

The pipeline threads a `RunDiagnostics` object through the tier-specific
stages so that timings, parameters, and intermediate metrics are persisted
into the job's `result_payload["diagnostics"]` block for the observability
report and dashboard.
"""
import time

from app.config import settings


# Settings that materially affect reconstruction output and are surfaced for
# reproducibility in the observability report.
PARAMETER_KEYS = [
    "COLMAP_BIN",
    "COLMAP_NUM_THREADS",
    "COLMAP_QUALITY",
    "VIDEO_EXTRACT_FPS",
    "RANSAC_DISTANCE_THRESH",
    "MIN_WALL_POINTS",
    "WALL_SLICE_Z_MIN",
    "WALL_SLICE_Z_MAX",
    "WALL_SLICE_REL_MIN",
    "WALL_SLICE_REL_MAX",
    "LLM_MODEL",
    "LLM_TIMEOUT_S",
    "LLM_MAX_TOKENS",
]


def snapshot_parameters() -> dict:
    """Return a snapshot of pipeline-relevant settings."""
    return {key: getattr(settings, key, None) for key in PARAMETER_KEYS}


class RunDiagnostics:
    """Collects timings, metrics, and warnings for one pipeline run."""

    def __init__(self, tier: str, scale_reference_m: float | None):
        self.tier = str(tier.value) if hasattr(tier, "value") else str(tier)
        self.scale_reference_m = scale_reference_m
        self._started_at = time.time()
        self._stages: list[dict] = []
        self._current_stage: str | None = None
        self._stage_started_at: float | None = None
        self._metrics: dict = {}
        self._warnings: list[str] = []

    def observe_stage(self, stage: str, pct: int):
        """Record a stage transition; timings are measured between transitions."""
        now = time.time()
        if self._current_stage is None:
            self._current_stage = stage
            self._stage_started_at = now
        elif self._current_stage != stage:
            self._close_stage(now)
            self._current_stage = stage
            self._stage_started_at = now

    def set_metric(self, key: str, value):
        self._metrics[key] = value

    def add_warning(self, message: str):
        if message not in self._warnings:
            self._warnings.append(message)

    def finish(self):
        if self._current_stage is not None:
            self._close_stage(time.time())
            self._current_stage = None
            self._stage_started_at = None

    def _close_stage(self, now: float):
        if self._current_stage is None or self._stage_started_at is None:
            return
        self._stages.append({
            "stage": self._current_stage,
            "duration_ms": round((now - self._stage_started_at) * 1000),
        })

    def to_dict(self) -> dict:
        self.finish()
        return {
            "tier": self.tier,
            "scale_reference_m": self.scale_reference_m,
            "total_duration_ms": round((time.time() - self._started_at) * 1000),
            "stages": self._stages,
            "metrics": self._metrics,
            "warnings": self._warnings,
            "parameters": snapshot_parameters(),
        }
