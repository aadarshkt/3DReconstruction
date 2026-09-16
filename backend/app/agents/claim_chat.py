"""
Natural Language Q&A Router and Claim Assistant.
Routes user queries to:
- POLICY: PolicyRAGEngine (cites policy clauses & page numbers)
- COST: CostEngine & stored estimate breakdown
- GEOMETRY: 3D reconstruction measurements & walls (deterministic, no hallucination)
- GENERAL: Grounded claim assistant
"""
import re
from typing import Any, Optional

import structlog

from app.agents.cost_engine import CostEngine
from app.agents.llm_client import LLMClient
from app.agents.policy_rag import PolicyRAGEngine
from app.agents.prompts import CHAT_CLASSIFY_PROMPT

log = structlog.get_logger()


class ClaimChatRouter:
    """
    Intelligent conversation router for physical property insurance claims.
    """

    def __init__(
        self,
        llm_client: Optional[LLMClient] = None,
        rag_engine: Optional[PolicyRAGEngine] = None,
        cost_engine: Optional[CostEngine] = None,
    ):
        self.llm_client = llm_client or LLMClient()
        self.rag_engine = rag_engine or PolicyRAGEngine(llm_client=self.llm_client)
        self.cost_engine = cost_engine or CostEngine(llm_client=self.llm_client)

    def classify_intent(self, question: str) -> str:
        """
        Classify query intent into POLICY, COST, GEOMETRY, or GENERAL.
        Uses lightweight LLM classification with robust keyword fallback.
        """
        q_lower = question.lower()

        # Keyword heuristics for high-confidence immediate routing
        if any(k in q_lower for k in ["how much", "cost", "price", "rate", "estimate", "quote", "expense", "payout"]):
            return "COST"
        if any(k in q_lower for k in ["wall", "dimension", "area", "square meter", "m2", "length", "door", "window", "perimeter", "scan"]):
            return "GEOMETRY"
        if any(k in q_lower for k in ["policy", "cover", "exclusion", "peril", "deductible", "clause", "limit", "rider"]):
            return "POLICY"

        # LLM classification
        try:
            raw = self.llm_client.chat(
                user_prompt=question,
                system_prompt=CHAT_CLASSIFY_PROMPT,
                temperature=0.0,
            ).strip().upper()
            for cat in ["POLICY", "COST", "GEOMETRY", "GENERAL"]:
                if cat in raw:
                    return cat
        except Exception as e:
            log.warning("intent_classification_failed", error=str(e))


        return "GENERAL"

    def handle_geometry_query(self, question: str, metrics: Optional[dict[str, Any]]) -> dict[str, Any]:
        """
        Answer questions regarding room geometry directly from deterministic 3D reconstruction measurements.
        """
        if not metrics:
            return {
                "reply": "No 3D scan or reconstruction measurements are currently linked to this claim.",
                "source_type": "geometry_metrics",
                "sources": [],
            }

        room_area = metrics.get("room_area_m2")
        wall_count = metrics.get("wall_count")
        damage_area = metrics.get("damage_area_m2")
        walls = metrics.get("walls", [])

        # Build clean deterministic report
        lines = ["Here are the physical measurements from your 3D reconstruction scan:"]
        if room_area is not None:
            lines.append(f"• **Total Room Floor Area**: {room_area:.2f} m² ({room_area * 10.7639:.1f} sq ft)")
        if wall_count is not None:
            lines.append(f"• **Detected Wall Count**: {wall_count} wall segments")
        if damage_area is not None:
            lines.append(f"• **Estimated Damage Surface**: {damage_area:.2f} m²")

        if walls:
            lines.append("\n**Wall Segment Breakdown**:")
            for i, w in enumerate(walls[:6], 1):
                length = w.get("length_m", 0.0)
                opening = " (has opening)" if w.get("has_opening") else ""
                lines.append(f"  - Wall #{i}: {length:.2f}m{opening}")
            if len(walls) > 6:
                lines.append(f"  - ...and {len(walls) - 6} additional wall segments.")

        reply = "\n".join(lines)
        sources = [{
            "type": "3D Reconstruction",
            "reference": "results.json",
            "details": f"Room Area: {room_area}m², Walls: {wall_count}",
        }]

        return {
            "reply": reply,
            "source_type": "geometry_metrics",
            "sources": sources,
        }

    def handle_cost_query(
        self,
        question: str,
        claim_data: dict[str, Any],
        cost_estimate: Optional[dict[str, Any]],
        metrics: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        """
        Answer questions about repair costs, line items, and payout calculations.
        """
        if cost_estimate:
            gross = cost_estimate.get("gross_estimate_usd", 0.0)
            net = cost_estimate.get("net_claim_payout", 0.0)
            deductible = cost_estimate.get("deductible_usd")
            items = cost_estimate.get("line_items", [])

            lines = [
                f"**Repair Cost Summary** for Claim {claim_data.get('id', '')[:8]}:",
                f"• **Gross Estimated Repair Cost**: ${gross:,.2f}",
            ]
            if deductible is not None:
                lines.append(f"• **Policy Deductible**: -${deductible:,.2f}")
                lines.append(f"• **Estimated Net Payout**: **${net:,.2f}**")
            else:
                lines.append(f"• **Estimated Net Payout**: **${net:,.2f}** (Deductible not yet applied)")

            if items:
                lines.append("\n**Key Scoped Repair Line Items**:")
                for item in items[:5]:
                    lines.append(
                        f"  - **{item.get('description', item.get('item'))}**: "
                        f"{item.get('quantity')} {item.get('unit')} @ ${item.get('unit_total_usd')}/{item.get('unit')} = "
                        f"**${item.get('total_usd', 0.0):,.2f}**"
                    )

            recommendations = cost_estimate.get("recommendations", [])
            if recommendations:
                lines.append(f"\n💡 *Note*: {recommendations[0]}")

            return {
                "reply": "\n".join(lines),
                "source_type": "cost_engine",
                "sources": [{
                    "type": "Deterministic Rate Table",
                    "reference": "Standard Repair Rates",
                    "details": f"Gross: ${gross:,.2f} | Net: ${net:,.2f}",
                }],
            }

        # If estimate hasn't been generated yet, provide explanation
        return {
            "reply": (
                "A formal cost estimate has not been generated for this claim yet. "
                "Click **'Estimate Costs'** to calculate itemized labor and material costs "
                "based on the 3D scan dimensions and repair rate tables."
            ),
            "source_type": "cost_engine",
            "sources": [],
        }

    def handle_policy_query(
        self,
        claim_id: str,
        question: str,
        claim_data: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Query the uploaded policy via RAG.
        """
        if not claim_data.get("has_policy_pdf"):
            return {
                "reply": (
                    "No insurance policy PDF has been uploaded for this claim yet. "
                    "Please upload your policy booklet (e.g. HO-3 / HO-5) so the system can verify coverage clauses and exclusions."
                ),
                "source_type": "policy_rag",
                "sources": [],
            }

        rag_res = self.rag_engine.query_policy(
            claim_id=claim_id,
            question=question,
            claim_data=claim_data,
        )

        return {
            "reply": rag_res.get("answer", ""),
            "source_type": "policy_rag",
            "sources": rag_res.get("sources", []),
        }

    def handle_general_query(
        self,
        question: str,
        claim_data: dict[str, Any],
        cost_estimate: Optional[dict[str, Any]],
        metrics: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        """
        Answer general questions with unified context across policy, cost, and geometry.
        """
        status = claim_data.get("status", "created")
        cause = claim_data.get("cause_of_loss", "unknown")
        desc = claim_data.get("damage_description", "")
        has_pdf = claim_data.get("has_policy_pdf", False)

        context = (
            f"Claim Context:\n"
            f"- Status: {status}\n"
            f"- Cause of Loss: {cause}\n"
            f"- Damage Description: {desc}\n"
            f"- Policy Uploaded: {'Yes' if has_pdf else 'No'}\n"
        )
        if metrics:
            context += f"- 3D Scan Area: {metrics.get('room_area_m2')} m², Walls: {metrics.get('wall_count')}\n"
        if cost_estimate:
            context += f"- Cost Estimate: Gross ${cost_estimate.get('gross_estimate_usd')}, Net Payout ${cost_estimate.get('net_claim_payout')}\n"

        system_prompt = (
            "You are an empathetic, licensed insurance claims navigator. "
            "Help the policyholder understand their claim status, next steps, and duties after loss. "
            "Be clear, concise, professional, and practical."
        )

        reply = self.llm_client.chat(
            user_prompt=f"{context}\nUser Question: {question}",
            system_prompt=system_prompt,
            temperature=0.2,
        )

        return {
            "reply": reply,
            "source_type": "general_llm",
            "sources": [],
        }

    def handle_chat(
        self,
        claim_id: str,
        message: str,
        claim_data: dict[str, Any],
        reconstruction_metrics: Optional[dict[str, Any]] = None,
        cost_estimate: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """
        Orchestrate conversational chat:
        1. Classifies intent (POLICY, COST, GEOMETRY, GENERAL)
        2. Dispatches to specialized handler with source attribution
        """
        intent = self.classify_intent(message)
        log.info("chat_query_routed", claim_id=claim_id, message=message[:60], intent=intent)

        if intent == "GEOMETRY":
            result = self.handle_geometry_query(message, reconstruction_metrics)
        elif intent == "COST":
            result = self.handle_cost_query(message, claim_data, cost_estimate, reconstruction_metrics)
        elif intent == "POLICY":
            result = self.handle_policy_query(claim_id, message, claim_data)
        else:
            result = self.handle_general_query(message, claim_data, cost_estimate, reconstruction_metrics)

        result["intent"] = intent
        result["claim_id"] = claim_id
        return result
