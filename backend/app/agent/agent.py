"""
Insurance claim agent orchestration.

`run_claim_agent(claim_id)` runs synchronously (it is invoked from a Celery
task), driving:

1. Reconstruction via the existing pipeline (synchronously, no nested task).
2. Damage assessment via the LLM (photos + structured metrics).
3. Report generation.

All state updates are written through a synchronous SQLAlchemy session,
matching the Celery worker pattern.
"""
import json
from typing import Optional

import structlog
from sqlalchemy.orm import Session

from app.agent import tools
from app.agent.report import build_claim_report, build_observability_report, write_claim_outputs
from app.config import settings
from app.models.claim import Claim, ClaimStatus
from app.models.job import JobStatus
from app.services.llm import LLMClient

log = structlog.get_logger()

ASSESSMENT_SYSTEM_PROMPT = (
    "You are an experienced property insurance claims assessor. "
    "Review the provided property photos and measured reconstruction data, "
    "then return a single JSON object with exactly these keys: "
    "damage_types (array of strings), affected_area_m2 (number or null), "
    "severity (one of 'none', 'minor', 'moderate', 'severe'), "
    "repair_scope (string), estimated_loss_band (string). "
    "Be conservative: report only damage that is visible in the photos or "
    "directly implied by the measurements. Return JSON only."
)


def run_claim_agent(claim_id: str) -> dict:
    """
    Run the full claim agent flow. Never raises — failures are persisted to
    the claim record and returned in the result dict.
    """
    db = tools._session()
    try:
        claim = db.query(Claim).filter(Claim.id == claim_id).first()
        if claim is None:
            return {"claim_id": claim_id, "status": "failed", "error": "Claim not found."}

        try:
            return _process_claim(db, claim)
        except Exception as exc:
            log.error("claim_agent_failed", claim_id=claim_id, error=str(exc), exc_info=True)
            _update_claim(db, claim_id, status=ClaimStatus.failed, error_message=str(exc)[:2000])
            return {"claim_id": claim_id, "status": "failed", "error": str(exc)}

    finally:
        db.close()


def _process_claim(db: Session, claim: Claim) -> dict:
    claim_id = claim.id

    # ── 1. Reconstruct ───────────────────────────────────────────────────────
    _update_claim(db, claim_id, status=ClaimStatus.reconstructing, progress_pct=10)

    inputs = tools.get_claim_input_files(claim_id)
    tier = tools.determine_tier(inputs)

    job_id = tools.create_reconstruction_job(tier, claim.scale_reference_m)
    _update_claim(db, claim_id, job_id=job_id)
    tools.move_claim_files_to_job(claim_id, job_id)

    from app.tasks.celery_tasks import _run_pipeline_core
    _run_pipeline_core(job_id)

    job = tools.get_job_record(job_id)
    if job is None or job.status != JobStatus.complete:
        raise RuntimeError(f"Reconstruction job {job_id} did not complete (status={job.status}).")

    # ── 2. Assess damage ─────────────────────────────────────────────────────
    _update_claim(db, claim_id, status=ClaimStatus.assessing, progress_pct=80)

    metrics = _build_metrics(job)
    imagery = tools.collect_imagery(job_id)
    try:
        damage_assessment, llm_input, raw_response = _assess_damage(claim, metrics, imagery)
    except Exception as exc:
        log.warning("llm_assessment_failed", claim_id=claim_id, error=str(exc))
        damage_assessment = {
            "severity": "unknown",
            "affected_area_m2": None,
            "damage_types": [],
            "repair_scope": "LLM assessment unavailable — metrics-only reconstruction summary provided.",
            "estimated_loss_band": "unknown",
            "llm_error": str(exc)[:500],
        }
        llm_input = {"model": settings.LLM_MODEL, "imagery": imagery, "error": str(exc)}
        raw_response = str(exc)

    _update_claim(db, claim_id, damage_assessment=damage_assessment)

    # ── 3. Draft report ──────────────────────────────────────────────────────
    _update_claim(db, claim_id, status=ClaimStatus.drafting, progress_pct=90)

    claim_markdown = build_claim_report(claim, job, damage_assessment)
    obs_markdown = build_observability_report(claim, job, damage_assessment, llm_input, raw_response)
    report_path = write_claim_outputs(
        claim_id, job_id, claim_markdown, obs_markdown, damage_assessment, llm_input, raw_response
    )

    _update_claim(
        db,
        claim_id,
        status=ClaimStatus.ready_for_review,
        progress_pct=100,
        report_path=report_path,
    )

    log.info("claim_agent_complete", claim_id=claim_id, job_id=job_id)
    return {"claim_id": claim_id, "status": "ready_for_review", "job_id": job_id}


# ── Damage assessment ─────────────────────────────────────────────────────────
def _build_metrics(job) -> dict:
    payload = job.result_payload or {}
    return {
        "room_area_m2": job.room_area_m2,
        "wall_count": job.wall_count,
        "scale_confidence": payload.get("scale_confidence"),
        "error_estimate": payload.get("error_estimate"),
        "walls": payload.get("walls", []),
    }


def _assess_damage(claim: Claim, metrics: dict, imagery: list[str]) -> tuple[dict, dict, str]:
    client = LLMClient()

    user_content = (
        f"Reconstruction metrics: {json.dumps(metrics)}\n"
        f"Incident type: {claim.incident_type}\n"
        f"Incident description: {claim.incident_description or 'Not provided'}\n"
        "Return the assessment as JSON only."
    )
    messages = [
        {"role": "system", "content": ASSESSMENT_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    if imagery:
        raw = client.chat_vision_sync(messages, imagery)
    else:
        messages[1]["content"] = (
            "No photos are available for this claim. "
            "Assess damage using the measurements alone, and mark any "
            "photo-dependent conclusions as unknown.\n\n" + user_content
        )
        raw = client.chat_sync(messages)

    llm_input = {
        "model": settings.LLM_MODEL,
        "max_tokens": settings.LLM_MAX_TOKENS,
        "system_prompt": ASSESSMENT_SYSTEM_PROMPT,
        "user_content": messages[1]["content"],
        "imagery": imagery,
    }
    return _parse_json_response(raw), llm_input, raw


def _parse_json_response(text: str) -> dict:
    """Parse a JSON object out of an LLM response (handles code fences)."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.removeprefix("```json").removeprefix("```").strip()
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Last-resort: extract the first {...} block
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(cleaned[start : end + 1])
        raise ValueError(f"LLM did not return valid JSON: {text[:500]}")


# ── Helpers ───────────────────────────────────────────────────────────────────
def _update_claim(db: Session, claim_id: str, **kwargs):
    claim = db.query(Claim).filter(Claim.id == claim_id).first()
    if claim:
        for key, value in kwargs.items():
            setattr(claim, key, value)
        db.commit()
