"""
Claim and observability report generation.

The claim report is the business-facing document (policy, damage assessment).
The observability report is the technical document (pipeline parameters, stage
timings, diagnostics, artifacts, and LLM assessment I/O).

All artifacts for a run are written under the job's report directory:
    data/{job_id}/reports/
"""
import json
from pathlib import Path

import structlog

from app.config import get_images_dir, get_job_report_dir, settings
from app.models.claim import Claim
from app.models.job import Job

log = structlog.get_logger()

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".heic"}

FILE_LABELS = {
    "floor_plan_svg": "Floor Plan SVG",
    "floor_plan_dxf": "Floor Plan DXF (CAD)",
    "point_cloud_ply": "3D Point Cloud (PLY)",
    "validation_csv": "Validation CSV",
}


def build_claim_report(claim: Claim, job: Job, damage_assessment: dict) -> str:
    """Render the business-facing Markdown claim report."""
    assessment = damage_assessment or {}

    lines = [
        "# Insurance Claim Report",
        "",
        "## Claim Details",
        "",
        f"- **Claim ID:** {claim.id}",
        f"- **Policyholder:** {claim.policyholder_name}",
        f"- **Policy Number:** {claim.policy_number}",
        f"- **Property Address:** {claim.property_address}",
        f"- **Incident Type:** {claim.incident_type}",
        f"- **Incident Description:** {claim.incident_description or 'Not provided'}",
        "",
        "## Reconstruction Summary",
        "",
        f"- **Floor Area:** {_fmt_area(job.room_area_m2)}",
        f"- **Wall Segments:** {job.wall_count if job.wall_count is not None else 'N/A'}",
        f"- **Scale Confidence:** {(job.result_payload or {}).get('scale_confidence', 'N/A')}",
        "",
        "## Damage Assessment",
        "",
    ]

    if assessment:
        lines += [
            f"- **Severity:** {assessment.get('severity', 'N/A')}",
            f"- **Affected Area:** {_fmt_area(assessment.get('affected_area_m2'))}",
            f"- **Damage Types:** {', '.join(assessment.get('damage_types', [])) or 'None reported'}",
            f"- **Estimated Loss Band:** {assessment.get('estimated_loss_band', 'N/A')}",
            "",
            "### Repair Scope",
            "",
            str(assessment.get("repair_scope", "Not provided")),
            "",
        ]
    else:
        lines += ["_No damage assessment available._", ""]

    lines += [
        "## Suggested Next Steps",
        "",
        "- An adjuster should review the reconstruction outputs and photos.",
        "- Confirm the damage assessment against the 3D point cloud and floor plan.",
        "- Update this report with any policy-specific coverage determinations.",
        "",
        "## Raw Assessment JSON",
        "",
        "```json",
        json.dumps(assessment, indent=2),
        "```",
        "",
    ]

    return "\n".join(lines)


def build_observability_report(
    claim: Claim,
    job: Job,
    damage_assessment: dict,
    llm_input: dict,
    llm_raw_response: str,
) -> str:
    """Render the technical observability Markdown report."""
    base = settings.DASHBOARD_BASE_URL.rstrip("/")
    payload = job.result_payload or {}
    diag = payload.get("diagnostics", {})
    files = payload.get("files", {})

    lines = [
        "# Observability Report",
        "",
        "## Run Identifiers",
        "",
        f"- **Claim ID:** {claim.id}",
        f"- **Job ID:** {job.id}",
        f"- **Tier:** {job.tier.value if hasattr(job.tier, 'value') else job.tier}",
        f"- **Scale Reference (m):** {claim.scale_reference_m}",
        f"- **Scale Confidence:** {payload.get('scale_confidence', 'N/A')}",
        f"- **Scale Factor:** {payload.get('scale_factor', 'N/A')}",
        f"- **Scale Method:** {payload.get('scale_method', 'N/A')}",
        "",
        "## Dashboard & Artifacts",
        "",
        f"- **Job dashboard:** {base}/?job_id={job.id}",
        f"- **Claim status (API):** {base}/claims/{claim.id}",
        "",
    ]

    for key, label in FILE_LABELS.items():
        path = files.get(key)
        if path:
            filename = path.split("/")[-1]
            lines.append(f"- **{label}:** {base}/jobs/{job.id}/files/{filename}")

    lines.append("")

    names = _imagery_names(job)
    lines += [
        "## Imagery",
        "",
        f"- **Image Count:** {len(names)}",
        "",
        "Filenames (used for reconstruction; up to 8 assessed by the LLM):",
        "",
    ]
    for name in names:
        lines.append(f"- `{name}`")
    lines.append("")

    lines += [
        "## Pipeline Parameters",
        "",
        "```json",
        json.dumps(diag.get("parameters", {}), indent=2),
        "```",
        "",
    ]

    lines += [
        "## Stage Timeline",
        "",
        "| Stage | Duration (ms) |",
        "| --- | ---: |",
    ]
    for stage in diag.get("stages", []):
        lines.append(f"| {stage['stage']} | {stage['duration_ms']} |")
    lines.append("")

    lines += [
        "## Diagnostics",
        "",
        "```json",
        json.dumps(diag.get("metrics", {}), indent=2),
        "```",
        "",
    ]

    warnings = diag.get("warnings", [])
    lines += ["## Warnings", ""]
    if warnings:
        for warning in warnings:
            lines.append(f"- ⚠️ {warning}")
    else:
        lines.append("_None_")
    lines.append("")

    lines += [
        "## LLM Assessment I/O",
        "",
        "### Input",
        "",
        "```json",
        json.dumps(llm_input, indent=2),
        "```",
        "",
        "### Raw Response",
        "",
        "```",
        llm_raw_response or "",
        "```",
        "",
        "### Parsed Assessment",
        "",
        "```json",
        json.dumps(damage_assessment, indent=2),
        "```",
        "",
        "## Local Artifacts",
        "",
        f"- Reports: `backend/data/{job.id}/reports/`",
        f"- Reconstruction outputs: `backend/data/{job.id}/results/`",
        "",
    ]

    return "\n".join(lines)


def write_claim_outputs(
    claim_id: str,
    job_id: str,
    claim_markdown: str,
    obs_markdown: str,
    damage_assessment: dict,
    llm_input: dict,
    llm_raw_response: str,
) -> str:
    """Write all run artifacts into the job report directory."""
    report_dir = get_job_report_dir(job_id)

    (report_dir / "claim_report.md").write_text(claim_markdown)
    (report_dir / "observability_report.md").write_text(obs_markdown)
    (report_dir / "damage_assessment.json").write_text(json.dumps(damage_assessment, indent=2))
    (report_dir / "llm_input.json").write_text(json.dumps(llm_input, indent=2))
    (report_dir / "llm_raw_response.txt").write_text(llm_raw_response or "")

    log.info("claim_outputs_written", claim_id=claim_id, job_id=job_id)
    return f"{job_id}/reports/claim_report.md"


def _fmt_area(value) -> str:
    if value is None:
        return "N/A"
    return f"{float(value):.2f} m²"


def _imagery_names(job: Job) -> list[str]:
    images_dir = get_images_dir(job.id)
    return sorted(
        p.name
        for p in images_dir.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    )
