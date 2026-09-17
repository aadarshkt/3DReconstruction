"""
Service layer for Guided Tour microservice.
Reads standalone artifacts and provides deterministic demo responses.
"""
import json
from pathlib import Path
from typing import Any, Dict, Optional

ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"


def load_artifact_json(filename: str) -> Dict[str, Any]:
    file_path = ARTIFACTS_DIR / filename
    if not file_path.exists():
        return {}
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_tour_sample_claim() -> Dict[str, Any]:
    """Assemble complete tour demo claim package from standalone artifacts."""
    metadata = load_artifact_json("tour_metadata.json")
    policy = load_artifact_json("sample_policy.json")
    costs = load_artifact_json("sample_cost_estimate.json")
    
    return {
        "status": "success",
        "is_tour_demo": True,
        "job_id": metadata.get("job_id", "tour-demo-spatial-roomplan-24m2"),
        "claim_id": metadata.get("claim_id", "tour-demo-claim-water-ho3"),
        "reconstruction": {
            "tier": metadata.get("tier", "roomplan"),
            "scale_confidence": metadata.get("scale_confidence", "native_metric"),
            "room_area_m2": metadata.get("room_area_m2", 24.5),
            "damage_area_m2": metadata.get("damage_area_m2", 18.2),
            "wall_count": metadata.get("wall_count", 4),
            "walls": metadata.get("walls", []),
            "error_estimate": metadata.get("error_estimate", {}),
            "files": {
                "floor_plan_svg": "/api/v1/tour/artifacts/floor_plan.svg",
                "point_cloud_ply": "/api/v1/tour/artifacts/point_cloud.ply",
            },
        },
        "policy": {
            "has_policy_pdf": True,
            "policy_pdf_url": "/api/v1/tour/artifacts/sample_ho3_policy.pdf",
            "policy_form": policy.get("policy_form", "ISO HO-3 Standard Homeowners"),
            "policy_number": policy.get("policy_number", "HO3-8829104-NY"),
            "deductible": policy.get("deductible", 1000.0),
            "coverage_limit": policy.get("coverage_limit", 350000.0),
            "analysis": policy,
        },
        "cost_estimate": {
            "status": "calculated",
            "estimate": costs,
            "total_estimated_cost": costs.get("net_claim_payout", 4101.47),
        },
    }


def handle_tour_chat(message: str) -> Dict[str, Any]:
    """
    Provide instant, accurate conversational claim answers using tour artifacts.
    No reliance on external LLM keys or network latency during demos.
    """
    msg = message.lower().strip()
    policy = load_artifact_json("sample_policy.json")
    costs = load_artifact_json("sample_cost_estimate.json")
    metadata = load_artifact_json("tour_metadata.json")

    # Intent 1: Coverage / Peril / Is it covered?
    if any(k in msg for k in ["cover", "peril", "leak", "pipe", "water", "policy", "damage"]):
        return {
            "intent": "policy_rag",
            "reply": (
                "**Coverage Determination: Fully Covered Loss.**\n\n"
                "According to your ISO HO-3 Policy (Form HO3-8829104-NY):\n"
                "• **Insured Peril:** Accidental Discharge or Overflow of Water (Peril 12) from within a plumbing system.\n"
                "• **Applicable Clause:** *Coverage A - Dwelling*, Page 9: 'We cover sudden and accidental discharge of water or steam from household plumbing.'\n"
                "• **Exclusion Check:** The gradual continuous seepage exclusion (Page 12) was reviewed and does **not** apply, as moisture scanning confirms sudden pressurized line failure.\n\n"
                "Your deductible is **$1,000.00**, leaving an estimated net recovery of **$4,101.47**."
            ),
            "confidence": 0.98,
            "source": "ISO HO-3 Policy Section I (Page 9)",
        }

    # Intent 2: Cost / Payout / Deductible / Estimates
    if any(k in msg for k in ["cost", "estimate", "payout", "price", "deductible", "how much", "repair", "money"]):
        return {
            "intent": "cost_engine",
            "reply": (
                f"**Itemized Repair Cost Breakdown:**\n\n"
                f"• **Subtotal (Direct Construction):** ${costs.get('subtotal', 4637.70):,.2f}\n"
                f"• **Contractor Overhead & Profit (10%):** ${costs.get('overhead_and_profit_amount', 463.77):,.2f}\n"
                f"• **Gross Claim Total:** ${costs.get('gross_claim_amount', 5101.47):,.2f}\n"
                f"• **Policy Deductible:** -${costs.get('deductible', 1000.00):,.2f}\n"
                f"• **Net Insurance Payout:** **${costs.get('net_claim_payout', 4101.47):,.2f}**\n\n"
                f"Major line items include hardwood replacement (18.2 m² @ $75/m²), drywall flood cut and replacement (14.4 m²), and 3 days commercial dehumidification."
            ),
            "confidence": 0.99,
            "source": "Deterministic Spatial Cost Engine (Xactimate 2025.Q1)",
        }

    # Intent 3: Geometry / Dimensions / Room Size / Walls
    if any(k in msg for k in ["dimension", "area", "size", "wall", "measurement", "square", "meter", "m2", "room"]):
        return {
            "intent": "3d_geometry",
            "reply": (
                f"**3D Spatial Reconstruction Metrics:**\n\n"
                f"• **Total Room Area:** {metadata.get('room_area_m2', 24.5)} m² (263.7 sq ft)\n"
                f"• **Water Damaged Area:** {metadata.get('damage_area_m2', 18.2)} m² (74.3% of subfloor)\n"
                f"• **Perimeter Walls:** 4 walls measured with ±0.8 cm native LiDAR tolerance.\n"
                f"  - Wall 1 (North): 5.40 m\n"
                f"  - Wall 2 (East): 4.50 m (includes door opening)\n"
                f"  - Wall 3 (South): 5.40 m (includes 1.20 m window)\n"
                f"  - Wall 4 (West): 4.50 m\n\n"
                f"All repair materials and paint quantities are directly bound to these exact physical dimensions."
            ),
            "confidence": 0.99,
            "source": "LiDAR Spatial Geometry Engine",
        }

    # Fallback / General Guidance
    return {
        "intent": "general_guidance",
        "reply": (
            "I can assist you with any questions about your guided tour claim:\n"
            "1. **Policy Coverage:** Ask about Peril 12 water damage clauses and exclusions.\n"
            "2. **Repair Estimates:** Ask for cost line items, contractor O&P, or net payout.\n"
            "3. **Room Dimensions:** Ask about verified wall lengths and damaged square meters.\n"
            "4. **Next Steps:** Recommend filing mitigation photos and securing a certified drying certificate."
        ),
        "confidence": 0.95,
        "source": "ClaimSpace Guided Tour Assistant",
    }
