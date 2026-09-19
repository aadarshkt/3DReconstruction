"""
Deterministic Cost Estimation Engine with LLM-Assisted Scoping.
Combines 3D reconstruction physical metrics with standard insurance repair rate tables.
"""
import json
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

import structlog

from app.agents.llm_client import LLMClient
from app.agents.prompts import COST_SCOPING_SYSTEM_PROMPT

log = structlog.get_logger()

# ==============================================================================
# [PLACEHOLDER / HARDCODED RATES]
# The rates below are standardized US residential repair and restoration baseline
# estimates (USD). In production, these values should be queried dynamically from
# commercial construction databases (e.g., Verisk Xactimate API, CoreLogic Symbility,
# or Gordian RSMeans) filtered by the property's postal zip code and current quarter.
# ==============================================================================
RATE_TABLE: dict[str, dict[str, Any]] = {
    "drywall_repair": {
        "description": "Drywall patch, tape, skim coat, and sand",
        "unit": "m2",
        "material": 12.0,  # [HARDCODED PLACEHOLDER]
        "labor": 25.0,     # [HARDCODED PLACEHOLDER]
        "total": 37.0,
    },
    "drywall_replace": {
        "description": "Tear out damaged drywall, hang 1/2in sheetrock, tape & finish",
        "unit": "m2",
        "material": 18.0,  # [HARDCODED PLACEHOLDER]
        "labor": 35.0,     # [HARDCODED PLACEHOLDER]
        "total": 53.0,
    },
    "interior_paint": {
        "description": "Interior primer sealer and two finish coats paint",
        "unit": "m2",
        "material": 5.0,
        "labor": 15.0,
        "total": 20.0,
    },
    "ceiling_repair": {
        "description": "Ceiling plaster/drywall patch, texture match, and paint",
        "unit": "m2",
        "material": 20.0,
        "labor": 40.0,
        "total": 60.0,
    },
    "flooring_hardwood": {
        "description": "Hardwood flooring tear-out, replacement, and finish",
        "unit": "m2",
        "material": 45.0,
        "labor": 30.0,
        "total": 75.0,
    },
    "flooring_tile": {
        "description": "Porcelain/ceramic tile removal, cement board, and new tile",
        "unit": "m2",
        "material": 35.0,
        "labor": 40.0,
        "total": 75.0,
    },
    "flooring_carpet": {
        "description": "Carpet and pad tear-out and commercial/residential carpet install",
        "unit": "m2",
        "material": 20.0,
        "labor": 15.0,
        "total": 35.0,
    },
    "baseboard_replace": {
        "description": "Replace primed MDF/wood baseboard and trim",
        "unit": "m",
        "material": 8.0,
        "labor": 12.0,
        "total": 20.0,
    },
    "door_replace": {
        "description": "Interior prehung door removal and replacement",
        "unit": "each",
        "material": 250.0,
        "labor": 150.0,
        "total": 400.0,
    },
    "window_replace": {
        "description": "Vinyl replacement window unit with insulation and trim",
        "unit": "each",
        "material": 350.0,
        "labor": 200.0,
        "total": 550.0,
    },
    "plumbing_repair": {
        "description": "Supply pipe repair, valve replacement, or fixture re-connection",
        "unit": "each",
        "material": 100.0,
        "labor": 200.0,
        "total": 300.0,
    },
    "electrical_repair": {
        "description": "Re-wire flooded outlet/switch, box replacement, circuit test",
        "unit": "each",
        "material": 80.0,
        "labor": 150.0,
        "total": 230.0,
    },
    "water_extraction": {
        "description": "Commercial water extraction, air movers, dehumidification setup",
        "unit": "m2",
        "material": 10.0,
        "labor": 25.0,
        "total": 35.0,
    },
    "mold_remediation": {
        "description": "Antimicrobial surface treatment, HEPA vacuuming, containment",
        "unit": "m2",
        "material": 20.0,
        "labor": 45.0,
        "total": 65.0,
    },
    "insulation": {
        "description": "R-13/R-19 fiberglass wall cavity insulation replacement",
        "unit": "m2",
        "material": 15.0,
        "labor": 20.0,
        "total": 35.0,
    },
    "roof_shingle": {
        "description": "Asphalt shingle tear-off, underlayment, and new architectural shingles",
        "unit": "m2",
        "material": 30.0,
        "labor": 45.0,
        "total": 75.0,
    },
}


@dataclass
class CalculatedLineItem:
    item: str
    description: str
    quantity: float
    unit: str
    location: str
    justification: str
    unit_material_usd: float
    unit_labor_usd: float
    unit_total_usd: float
    material_subtotal_usd: float
    labor_subtotal_usd: float
    total_usd: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CostEstimate:
    claim_id: str
    damage_summary: str
    line_items: list[CalculatedLineItem]
    subtotal_material_usd: float
    subtotal_labor_usd: float
    subtotal_usd: float
    overhead_and_profit_pct: float
    overhead_and_profit_usd: float
    gross_estimate_usd: float
    deductible_usd: Optional[float]
    coverage_limit_usd: Optional[float]
    net_claim_payout: float
    is_below_deductible: bool
    exceeds_policy_limit: bool
    recommendations: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["line_items"] = [item.to_dict() if hasattr(item, "to_dict") else item for item in self.line_items]
        return d


class CostEngine:
    """
    Cost estimation engine that decouples LLM-driven repair scoping
    from deterministic, rate-table-backed cost calculations.
    """

    def __init__(self, llm_client: Optional[LLMClient] = None, rate_table: Optional[dict[str, Any]] = None):
        self.llm_client = llm_client or LLMClient()
        self.rate_table = rate_table or RATE_TABLE

    def _fallback_scoping(
        self,
        cause_of_loss: str,
        damage_description: str,
        metrics: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Rule-based scoping fallback used if the LLM API is unavailable.
        Uses exact 3D metrics to create baseline repair line items.
        """
        # [PLACEHOLDER HEURISTICS]: Scoping multipliers (e.g. 1.5x paint blending,
        # 2.0x extraction zone, 2ft flood-cut perimeter) are standard IICRC S500 restoration
        # defaults. In production, adjusters define exact scoping rules or use computer vision.
        damage_area = float(metrics.get("damage_area_m2") or 5.0)
        room_area = float(metrics.get("room_area_m2") or 20.0)
        wall_length = float(metrics.get("estimated_wall_length_m") or (damage_area / 2.4))

        items = []
        if cause_of_loss.lower() in ("water", "flood", "leak"):
            items.append({
                "item": "drywall_replace",
                "quantity": round(damage_area, 2),
                "unit": "m2",
                "location": "Damaged wall section",
                "justification": "Flood cut removal and replacement of waterlogged drywall",
            })
            items.append({
                "item": "interior_paint",
                "quantity": round(damage_area * 1.5, 2),
                "unit": "m2",
                "location": "Repaired wall and adjacent blending area",
                "justification": "Primer and two coats color match",
            })
            items.append({
                "item": "baseboard_replace",
                "quantity": round(wall_length, 2),
                "unit": "m",
                "location": "Along affected wall base",
                "justification": "Swollen baseboard trim removal",
            })
            items.append({
                "item": "water_extraction",
                "quantity": round(min(damage_area * 2.0, room_area), 2),
                "unit": "m2",
                "location": "Affected room floor",
                "justification": "Structural drying and moisture mitigation",
            })
            items.append({
                "item": "plumbing_repair",
                "quantity": 1.0,
                "unit": "each",
                "location": "Plumbing supply point",
                "justification": "Repair origin pipe/valve leak",
            })
        else:
            # Generic property repair
            items.append({
                "item": "drywall_repair",
                "quantity": round(damage_area, 2),
                "unit": "m2",
                "location": "Damaged area",
                "justification": "Surface repair and patching",
            })
            items.append({
                "item": "interior_paint",
                "quantity": round(damage_area, 2),
                "unit": "m2",
                "location": "Damaged surface",
                "justification": "Repaint restored wall",
            })

        return {
            "damage_summary": f"Scope of restoration for {cause_of_loss}: {damage_description[:100]}",
            "line_items": items,
            "recommendations": [
                "Verify moisture levels with professional meter before closing drywall",
                "Retain all contractor invoices for insurance adjuster review",
            ],
        }

    def scope_repairs(
        self,
        cause_of_loss: str,
        damage_description: str,
        property_type: str = "residential",
        reconstruction_metrics: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """
        Use the LLM to analyze the physical damage description + 3D scan measurements
        and determine the required repair line items from the allowed rate table.
        """
        metrics = reconstruction_metrics or {}
        walls_info = ""
        if "walls" in metrics:
            walls_info = f"- Detected Walls Count: {len(metrics['walls'])}\n"
            sample_walls = metrics["walls"][:5]
            walls_info += f"- Wall lengths (first few): {[w.get('length_m') for w in sample_walls]}\n"

        prompt_context = (
            f"Property Type: {property_type}\n"
            f"Cause of Loss: {cause_of_loss}\n"
            f"Damage Description: {damage_description}\n"
            f"3D Pipeline Measurements:\n"
            f"- Room Floor Area: {metrics.get('room_area_m2', 'N/A')} m²\n"
            f"- Wall Count: {metrics.get('wall_count', 'N/A')}\n"
            f"- Estimated Damage Area: {metrics.get('damage_area_m2', 'N/A')} m²\n"
            f"{walls_info}"
        )

        try:
            raw_response = self.llm_client.chat(
                user_prompt=prompt_context,
                system_prompt=COST_SCOPING_SYSTEM_PROMPT,
                json_mode=True,
            )
            parsed = json.loads(raw_response)
            if "line_items" in parsed and isinstance(parsed["line_items"], list) and len(parsed["line_items"]) > 0:
                return parsed
        except Exception as e:
            log.warning("llm_scoping_failed_fallback_to_rules", error=str(e))

        return self._fallback_scoping(cause_of_loss, damage_description, metrics)

    def calculate_estimate(
        self,
        claim_id: str,
        scope: dict[str, Any],
        deductible_usd: Optional[float] = None,
        coverage_limit_usd: Optional[float] = None,
        overhead_and_profit_pct: float = 10.0,
    ) -> CostEstimate:
        """
        Pure deterministic calculation:
        1. Multiplies quantities by RATE_TABLE unit prices
        2. Calculates labor & material subtotals
        3. Adds General Contractor Overhead & Profit (O&P)
        4. Applies policy deductible and coverage limit
        """
        raw_items = scope.get("line_items", [])
        damage_summary = scope.get("damage_summary", "Itemized Repair Scope")
        recommendations = scope.get("recommendations", [])

        calculated_items: list[CalculatedLineItem] = []
        total_material = 0.0
        total_labor = 0.0

        for it in raw_items:
            item_key = it.get("item", "").strip().lower()
            qty = float(it.get("quantity", 0.0))
            location = it.get("location", "Area of Loss")
            justification = it.get("justification", "")

            # Match against rate table or fallback to drywall_repair
            rate_info = self.rate_table.get(item_key)
            if not rate_info:
                # Try finding closest key or use drywall_repair default
                rate_info = self.rate_table["drywall_repair"]
                item_key = "drywall_repair"

            mat_rate = float(rate_info["material"])
            lab_rate = float(rate_info["labor"])
            tot_rate = float(rate_info["total"])
            unit = rate_info.get("unit", it.get("unit", "m2"))
            desc = rate_info.get("description", item_key)

            mat_sub = round(qty * mat_rate, 2)
            lab_sub = round(qty * lab_rate, 2)
            tot_line = round(mat_sub + lab_sub, 2)

            total_material += mat_sub
            total_labor += lab_sub

            calculated_items.append(
                CalculatedLineItem(
                    item=item_key,
                    description=desc,
                    quantity=qty,
                    unit=unit,
                    location=location,
                    justification=justification,
                    unit_material_usd=mat_rate,
                    unit_labor_usd=lab_rate,
                    unit_total_usd=tot_rate,
                    material_subtotal_usd=mat_sub,
                    labor_subtotal_usd=lab_sub,
                    total_usd=tot_line,
                )
            )

        subtotal = round(total_material + total_labor, 2)
        op_usd = round(subtotal * (overhead_and_profit_pct / 100.0), 2)
        gross_total = round(subtotal + op_usd, 2)

        # Policy Deductible & Payout math
        net_payout = gross_total
        is_below_deductible = False
        exceeds_limit = False

        if deductible_usd is not None and deductible_usd > 0:
            if gross_total <= deductible_usd:
                net_payout = 0.0
                is_below_deductible = True
                recommendations.append(
                    f"Notice: Gross estimated repair cost (${gross_total:,.2f}) is below your policy deductible "
                    f"(${deductible_usd:,.2f}). Filing this claim may not result in an insurance payout."
                )
            else:
                net_payout = round(gross_total - deductible_usd, 2)

        if coverage_limit_usd is not None and coverage_limit_usd > 0:
            if net_payout > coverage_limit_usd:
                exceeds_limit = True
                net_payout = coverage_limit_usd
                recommendations.append(
                    f"Warning: Estimated repair costs exceed the policy limit of ${coverage_limit_usd:,.2f}."
                )

        return CostEstimate(
            claim_id=claim_id,
            damage_summary=damage_summary,
            line_items=calculated_items,
            subtotal_material_usd=round(total_material, 2),
            subtotal_labor_usd=round(total_labor, 2),
            subtotal_usd=subtotal,
            overhead_and_profit_pct=overhead_and_profit_pct,
            overhead_and_profit_usd=op_usd,
            gross_estimate_usd=gross_total,
            deductible_usd=deductible_usd,
            coverage_limit_usd=coverage_limit_usd,
            net_claim_payout=net_payout,
            is_below_deductible=is_below_deductible,
            exceeds_policy_limit=exceeds_limit,
            recommendations=recommendations,
        )

    def estimate_claim(
        self,
        claim_id: str,
        claim_data: dict[str, Any],
        reconstruction_metrics: Optional[dict[str, Any]] = None,
        policy_analysis: Optional[dict[str, Any]] = None,
        overhead_and_profit_pct: float = 10.0,
    ) -> CostEstimate:
        """
        Orchestrate complete cost estimation:
        1. Scopes repair items using physical 3D scan metrics + damage description
        2. Pulls deductible and limits from policy analysis if present
        3. Calculates itemized and net payable costs
        """
        cause = claim_data.get("cause_of_loss", "property damage")
        description = claim_data.get("damage_description", "")
        prop_type = claim_data.get("property_type", "residential")

        # Extract deductible & limit from policy analysis if available
        deductible = None
        limit = None
        if policy_analysis:
            deductible = policy_analysis.get("deductible")
            limit = policy_analysis.get("coverage_limit")

        # Scope work
        scope = self.scope_repairs(
            cause_of_loss=cause,
            damage_description=description,
            property_type=prop_type,
            reconstruction_metrics=reconstruction_metrics,
        )

        # Deterministic cost calculation
        return self.calculate_estimate(
            claim_id=claim_id,
            scope=scope,
            deductible_usd=deductible,
            coverage_limit_usd=limit,
            overhead_and_profit_pct=overhead_and_profit_pct,
        )
