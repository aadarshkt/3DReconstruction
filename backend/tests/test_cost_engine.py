"""
Unit and integration tests for Cost Estimation Engine:
- Rate table verification
- Deterministic calculation math & O&P
- Policy deductible & limit cross-referencing
- LLM scoping with fallback
- End-to-end claim cost estimation
"""
from unittest.mock import MagicMock
import pytest

from app.agents.cost_engine import CostEngine, RATE_TABLE, CostEstimate


class MockScopingLLMClient:
    def chat(self, user_prompt: str, system_prompt: str = None, json_mode: bool = False, **kwargs) -> str:
        return """{
            "damage_summary": "Water damage to lower drywall and trim from kitchen supply leak",
            "line_items": [
                {
                    "item": "drywall_replace",
                    "quantity": 4.0,
                    "unit": "m2",
                    "location": "Kitchen lower wall",
                    "justification": "Flood cut replacement"
                },
                {
                    "item": "interior_paint",
                    "quantity": 8.0,
                    "unit": "m2",
                    "location": "Kitchen wall",
                    "justification": "Primer and two coats"
                },
                {
                    "item": "baseboard_replace",
                    "quantity": 3.5,
                    "unit": "m",
                    "location": "Along lower wall",
                    "justification": "MDF baseboard swollen"
                },
                {
                    "item": "water_extraction",
                    "quantity": 12.0,
                    "unit": "m2",
                    "location": "Kitchen floor",
                    "justification": "Remediation drying"
                }
            ],
            "recommendations": ["Check subfloor moisture before reinstalling trim"]
        }"""


def test_rate_table_integrity():
    """Verify rate table entries have valid units, positive costs, and correct subtotals."""
    assert len(RATE_TABLE) >= 12
    for key, val in RATE_TABLE.items():
        assert "material" in val and val["material"] >= 0
        assert "labor" in val and val["labor"] >= 0
        assert "total" in val and val["total"] > 0
        assert "unit" in val
        # Check material + labor equals total
        assert round(val["material"] + val["labor"], 2) == round(val["total"], 2)


def test_deterministic_calculation_math():
    """Verify exact deterministic math, O&P calculation, and itemized lines."""
    engine = CostEngine()

    scope = {
        "damage_summary": "Test scope",
        "line_items": [
            {"item": "drywall_replace", "quantity": 10.0, "unit": "m2", "location": "Wall 1"},
            {"item": "interior_paint", "quantity": 20.0, "unit": "m2", "location": "Wall 1"},
        ],
    }

    # drywall_replace: 10 * $53 = $530 ($180 mat + $350 lab)
    # interior_paint: 20 * $20 = $400 ($100 mat + $300 lab)
    # Subtotal: $930 ($280 mat + $650 lab)
    # O&P (10%): $93.00
    # Gross: $1,023.00

    estimate = engine.calculate_estimate(
        claim_id="claim-test-calc",
        scope=scope,
        deductible_usd=None,
        overhead_and_profit_pct=10.0,
    )

    assert estimate.subtotal_material_usd == 280.0
    assert estimate.subtotal_labor_usd == 650.0
    assert estimate.subtotal_usd == 930.0
    assert estimate.overhead_and_profit_usd == 93.0
    assert estimate.gross_estimate_usd == 1023.0
    assert estimate.net_claim_payout == 1023.0
    assert not estimate.is_below_deductible
    assert not estimate.exceeds_policy_limit


def test_deductible_and_limit_logic():
    """Verify deductible subtraction and below-deductible warnings."""
    engine = CostEngine()

    scope = {
        "damage_summary": "Minor repair",
        "line_items": [
            {"item": "drywall_repair", "quantity": 2.0, "unit": "m2"}, # 2 * $37 = $74
        ],
    }

    # Subtotal = $74, O&P (10%) = $7.40, Gross = $81.40
    # Case 1: Deductible $500 -> Gross ($81.40) <= Deductible ($500)
    est_below = engine.calculate_estimate(
        claim_id="claim-1",
        scope=scope,
        deductible_usd=500.0,
        overhead_and_profit_pct=10.0,
    )
    assert est_below.gross_estimate_usd == 81.40
    assert est_below.net_claim_payout == 0.0
    assert est_below.is_below_deductible is True
    assert any("below your policy deductible" in r for r in est_below.recommendations)

    # Case 2: Deductible $50 -> Net = $81.40 - $50 = $31.40
    est_above = engine.calculate_estimate(
        claim_id="claim-2",
        scope=scope,
        deductible_usd=50.0,
        overhead_and_profit_pct=10.0,
    )
    assert est_above.net_claim_payout == 31.40
    assert est_above.is_below_deductible is False

    # Case 3: Coverage limit cap
    est_capped = engine.calculate_estimate(
        claim_id="claim-3",
        scope=scope,
        coverage_limit_usd=25.0,
    )
    assert est_capped.net_claim_payout == 25.0
    assert est_capped.exceeds_policy_limit is True


def test_llm_scoping_and_estimation_pipeline():
    """Verify end-to-end claim estimation with mocked LLM scoping."""
    mock_llm = MockScopingLLMClient()
    engine = CostEngine(llm_client=mock_llm)

    claim_data = {
        "cause_of_loss": "water",
        "damage_description": "Dishwasher burst flooded floor and damaged drywall",
        "property_type": "residential",
    }
    reconstruction_metrics = {
        "room_area_m2": 18.0,
        "wall_count": 4,
        "damage_area_m2": 4.0,
    }
    policy_analysis = {
        "is_covered": True,
        "deductible": 500.0,
        "coverage_limit": 100000.0,
    }

    estimate = engine.estimate_claim(
        claim_id="claim-pipe-1",
        claim_data=claim_data,
        reconstruction_metrics=reconstruction_metrics,
        policy_analysis=policy_analysis,
    )

    assert isinstance(estimate, CostEstimate)
    assert len(estimate.line_items) == 4
    assert estimate.gross_estimate_usd > 500.0
    assert estimate.net_claim_payout == round(estimate.gross_estimate_usd - 500.0, 2)
    assert estimate.deductible_usd == 500.0
    assert estimate.coverage_limit_usd == 100000.0


def test_rule_based_fallback_scoping():
    """Verify that when LLM throws an error, rule-based fallback generates sensible scope."""
    failing_llm = MagicMock()
    failing_llm.chat.side_effect = RuntimeError("API unavailable")

    engine = CostEngine(llm_client=failing_llm)

    scope = engine.scope_repairs(
        cause_of_loss="water",
        damage_description="Pipe burst water damage",
        reconstruction_metrics={"damage_area_m2": 6.0, "room_area_m2": 20.0},
    )

    assert "line_items" in scope
    assert len(scope["line_items"]) >= 3
    items = [it["item"] for it in scope["line_items"]]
    assert "drywall_replace" in items
    assert "water_extraction" in items
