"""
Claim report generation.

Produces a Markdown report and a structured `damage_assessment.json` inside
the claim's data directory.
"""
import json

import structlog

from app.config import get_claim_dir
from app.models.claim import Claim
from app.models.job import Job

log = structlog.get_logger()


def build_claim_report(claim: Claim, job: Job, damage_assessment: dict) -> str:
    """
    Render a human-readable Markdown claim report.
    """
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


def write_claim_outputs(claim_id: str, markdown: str, damage_assessment: dict) -> str:
    """
    Write the report and assessment files, returning the report's relative path.
    """
    claim_dir = get_claim_dir(claim_id)

    report_path = claim_dir / "claim_report.md"
    report_path.write_text(markdown)

    assessment_path = claim_dir / "damage_assessment.json"
    assessment_path.write_text(json.dumps(damage_assessment, indent=2))

    log.info("claim_outputs_written", claim_id=claim_id)
    return "claim_report.md"


def _fmt_area(value) -> str:
    if value is None:
        return "N/A"
    return f"{float(value):.2f} m²"
