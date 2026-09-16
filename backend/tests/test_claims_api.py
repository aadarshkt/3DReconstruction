"""
API endpoint tests for Claims and Policy RAG routes.
Tests:
- POST /api/v1/claims
- GET /api/v1/claims/{id}
- POST /api/v1/claims/{id}/policy/upload
- POST /api/v1/claims/{id}/policy/analyze
- POST /api/v1/claims/{id}/policy/query
"""
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest
from starlette.testclient import TestClient

from app.main import app, get_db
from app.models.claim import Claim, ClaimStatus
from app.agents.policy_rag import PolicyAnalysis

FIXTURE_PDF = Path(__file__).parent / "fixtures" / "sample_ho3_policy.pdf"


class MockAsyncSession:
    """In-memory async session mock for testing routes without live PostgreSQL."""

    def __init__(self):
        self.claims: dict[str, Claim] = {}

    def add(self, obj):
        if isinstance(obj, Claim):
            self.claims[obj.id] = obj

    async def commit(self):
        pass

    async def refresh(self, obj):
        pass

    async def get(self, model, ident):
        if model == Claim:
            return self.claims.get(str(ident))
        return None

    async def execute(self, stmt):
        class ResultMock:
            def __init__(self, items):
                self.items = items
            def scalars(self):
                return self
            def all(self):
                return self.items
        return ResultMock(list(self.claims.values()))


@pytest.fixture
def test_client():
    mock_session = MockAsyncSession()

    async def override_get_db():
        yield mock_session

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client, mock_session
    app.dependency_overrides.clear()


def test_create_and_get_claim(test_client):
    client, session = test_client

    # 1. Create claim
    payload = {
        "property_type": "residential",
        "damage_description": "Water heater leak flooded utility room and adjacent hallway",
        "cause_of_loss": "water",
        "policy_number": "POL-998877",
        "insurer_name": "State Farm",
    }
    resp = client.post("/api/v1/claims", json=payload)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert "id" in data
    claim_id = data["id"]
    assert data["damage_description"] == payload["damage_description"]
    assert data["status"] == "created"

    # 2. Get claim
    get_resp = client.get(f"/api/v1/claims/{claim_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == claim_id


def test_upload_policy_and_analyze(test_client, tmp_path):
    client, session = test_client

    # Create initial claim
    claim = Claim(
        property_type="residential",
        damage_description="Frozen burst pipe causing drywall damage",
        cause_of_loss="water",
        status=ClaimStatus.created,
    )
    session.add(claim)
    claim_id = claim.id

    # Mock RAG engine methods
    mock_analysis = PolicyAnalysis(
        is_covered=True,
        confidence="high",
        relevant_clauses=[{"clause": "Accidental discharge or overflow", "page": 9}],
        page_references=[9],
        exclusions_found=[],
        deductible=1000.0,
        coverage_limit=250000.0,
        duties_after_loss=["Prompt notice"],
        reasoning="Covered sudden water release from domestic plumbing.",
        recommendations=["Preserve defective pipe part as evidence"],
    )

    with patch("app.api.claims.rag_engine.ingest_policy") as mock_ingest, \
         patch("app.api.claims.rag_engine.analyze_coverage") as mock_analyze, \
         patch("app.api.claims.rag_engine.query_policy") as mock_query:

        mock_ingest.return_value = {"claim_id": claim_id, "total_pages": 22, "total_chunks": 45}
        mock_analyze.return_value = mock_analysis
        mock_query.return_value = {
            "answer": "Plumbing discharge is covered under Section I - Perils Insured Against.",
            "sources": [{"page": 9, "section": "PERILS INSURED AGAINST", "snippet": "Accidental discharge..."}],
        }

        # 1. Upload policy PDF
        with open(FIXTURE_PDF, "rb") as f:
            upload_resp = client.post(
                f"/api/v1/claims/{claim_id}/policy/upload",
                files={"file": ("sample_ho3.pdf", f, "application/pdf")},
            )
        assert upload_resp.status_code == 200, upload_resp.text
        upload_data = upload_resp.json()
        assert upload_data["status"] == "success"
        assert upload_data["ingest_stats"]["total_pages"] == 22

        # 2. Run analysis
        analyze_resp = client.post(f"/api/v1/claims/{claim_id}/policy/analyze")
        assert analyze_resp.status_code == 200, analyze_resp.text
        analysis_data = analyze_resp.json()
        assert analysis_data["status"] == "success"
        assert analysis_data["analysis"]["is_covered"] is True
        assert analysis_data["analysis"]["deductible"] == 1000.0

        # 3. Query policy
        query_resp = client.post(
            f"/api/v1/claims/{claim_id}/policy/query",
            json={"question": "What is covered regarding burst pipes?"},
        )
        assert query_resp.status_code == 200, query_resp.text
        query_data = query_resp.json()
        assert "answer" in query_data
        assert len(query_data["sources"]) > 0

        # 4. Estimate costs
        estimate_resp = client.post(
            f"/api/v1/claims/{claim_id}/estimate",
            json={"overhead_and_profit_pct": 10.0},
        )
        assert estimate_resp.status_code == 200, estimate_resp.text
        est_data = estimate_resp.json()
        assert est_data["status"] == "success"
        assert "cost_estimate" in est_data
        assert "gross_estimate_usd" in est_data["cost_estimate"]
        assert est_data["cost_estimate"]["deductible_usd"] == 1000.0

        # 5. Conversational chat
        chat_resp = client.post(
            f"/api/v1/claims/{claim_id}/chat",
            json={"message": "How much is my deductible and net payout?"},
        )
        assert chat_resp.status_code == 200, chat_resp.text
        chat_data = chat_resp.json()
        assert "reply" in chat_data
        assert chat_data["intent"] == "COST"


def test_load_sample_policy_endpoint(test_client):
    client, session = test_client
    claim = Claim(
        id="test-claim-load-sample",
        cause_of_loss="water",
        damage_description="Burst kitchen pipe",
        property_type="residential",
    )
    session.add(claim)

    with patch("app.api.claims.rag_engine.ingest_policy") as mock_ingest:
        mock_ingest.return_value = {"total_pages": 22, "total_chunks": 142}
        resp = client.post(f"/api/v1/claims/{claim.id}/policy/load-sample")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["status"] == "success"
        assert data["ingest_stats"]["total_pages"] == 22


def test_seed_demo_endpoint(test_client):
    client, session = test_client
    with patch("app.api.claims.seed_demo_pipeline") as mock_seed:
        mock_seed.return_value = {
            "job_id": "a441e175-fa81-54b1-872f-532658f8b0fa",
            "claim_id": "9a4de56b-a2eb-5eb6-86fe-6ecb8d78daec",
            "status": "seeded",
            "has_policy_pdf": True,
            "policy_indexed": True,
            "ingest_stats": {"total_pages": 22, "total_chunks": 142},
        }
        resp = client.post("/api/v1/claims/seed-demo")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["status"] == "success"
        assert data["job_id"] == "a441e175-fa81-54b1-872f-532658f8b0fa"



