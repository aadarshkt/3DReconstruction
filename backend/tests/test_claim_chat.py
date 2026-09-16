"""
Unit and integration tests for Natural Language Claim Chat:
- Intent classification (POLICY, COST, GEOMETRY, GENERAL)
- Geometry handler
- Cost handler
- Policy handler
- End-to-end chat routing
"""
from unittest.mock import MagicMock
import pytest

from app.agents.claim_chat import ClaimChatRouter


class MockChatLLM:
    def chat(self, user_prompt: str, system_prompt: str = None, **kwargs) -> str:
        sys = system_prompt or ""
        if "Classify this user message" in sys or "CLASSIFY" in sys:
            p = user_prompt.lower()
            if any(w in p for w in ["cost", "price", "deductible", "payout"]):
                return "COST"
            if any(w in p for w in ["wall", "area", "big", "room", "dimension", "length"]):
                return "GEOMETRY"
            if any(w in p for w in ["policy", "cover", "exclusion", "peril", "clause"]):
                return "POLICY"
            return "GENERAL"
        return "As your insurance claims guide, I recommend documenting all damage with clear photos before beginning cleanup."



def test_intent_classification():
    """Verify intent router classifies various user queries correctly."""
    router = ClaimChatRouter(llm_client=MockChatLLM())

    assert router.classify_intent("How much will it cost to replace the water-damaged drywall?") == "COST"
    assert router.classify_intent("What is the total price for the repair?") == "COST"
    assert router.classify_intent("What is the length of wall 2 and room area?") == "GEOMETRY"
    assert router.classify_intent("Is mold damage excluded under my insurance policy?") == "POLICY"
    assert router.classify_intent("What should I do right after a pipe burst?") == "GENERAL"


def test_geometry_handler():
    """Verify deterministic geometry answering directly from 3D scan metrics."""
    router = ClaimChatRouter(llm_client=MockChatLLM())
    metrics = {
        "room_area_m2": 24.5,
        "wall_count": 4,
        "damage_area_m2": 3.8,
        "walls": [
            {"id": 1, "length_m": 5.2, "has_opening": False},
            {"id": 2, "length_m": 4.7, "has_opening": True},
        ],
    }

    res = router.handle_geometry_query("What are the dimensions?", metrics)
    assert res["source_type"] == "geometry_metrics"
    assert "24.50 m²" in res["reply"]
    assert "Wall #1: 5.20m" in res["reply"]
    assert len(res["sources"]) > 0


def test_cost_handler():
    """Verify cost handler summarizes gross, net payout, and line items."""
    router = ClaimChatRouter(llm_client=MockChatLLM())
    cost_estimate = {
        "gross_estimate_usd": 2450.0,
        "deductible_usd": 1000.0,
        "net_claim_payout": 1450.0,
        "line_items": [
            {"item": "drywall_replace", "description": "Tear out drywall", "quantity": 10.0, "unit": "m2", "unit_total_usd": 53.0, "total_usd": 530.0},
        ],
        "recommendations": ["Check moisture content before sealing"],
    }

    res = router.handle_cost_query("What will it cost?", {"id": "c123"}, cost_estimate, None)
    assert res["source_type"] == "cost_engine"
    assert "$2,450.00" in res["reply"]
    assert "$1,000.00" in res["reply"]
    assert "$1,450.00" in res["reply"]


def test_end_to_end_chat_routing():
    """Verify end-to-end chat dispatching and envelope."""
    router = ClaimChatRouter(llm_client=MockChatLLM())

    claim_data = {
        "id": "claim-xyz",
        "status": "complete",
        "cause_of_loss": "water",
        "damage_description": "Broken pipe",
        "has_policy_pdf": False,
    }
    metrics = {"room_area_m2": 30.0, "wall_count": 4}

    # Query about dimensions
    geom_res = router.handle_chat(
        claim_id="claim-xyz",
        message="How big is this room?",
        claim_data=claim_data,
        reconstruction_metrics=metrics,
    )
    assert geom_res["intent"] == "GEOMETRY"
    assert "30.00 m²" in geom_res["reply"]

    # General query
    gen_res = router.handle_chat(
        claim_id="claim-xyz",
        message="What are my next steps?",
        claim_data=claim_data,
    )
    assert gen_res["intent"] == "GENERAL"
    assert len(gen_res["reply"]) > 10
