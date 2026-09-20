"""
Tests for Saved Executions API and PDF Report Generation.
"""
from pathlib import Path
from unittest.mock import patch
import pytest
from starlette.testclient import TestClient

from app.main import app, get_db
from app.models.claim import Claim, ClaimStatus
from app.models.job import Job, JobStatus, Tier
from app.pipeline.report_generator import generate_execution_pdf


class MockAsyncSession:
    """In-memory async session mock for testing routes without live PostgreSQL."""

    def __init__(self):
        self.claims: dict[str, Claim] = {}
        self.jobs: dict[str, Job] = {}

    def add(self, obj):
        if isinstance(obj, Claim):
            self.claims[obj.id] = obj
        elif isinstance(obj, Job):
            self.jobs[obj.id] = obj

    async def commit(self):
        pass

    async def refresh(self, obj):
        pass

    async def delete(self, obj):
        if isinstance(obj, Claim) and obj.id in self.claims:
            del self.claims[obj.id]
        elif isinstance(obj, Job) and obj.id in self.jobs:
            del self.jobs[obj.id]

    async def get(self, model, ident):
        if model == Claim:
            return self.claims.get(str(ident))
        if model == Job:
            return self.jobs.get(str(ident))
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
def test_setup():
    mock_session = MockAsyncSession()

    async def override_get_db():
        yield mock_session

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client, mock_session
    app.dependency_overrides.clear()


def test_list_executions_empty(test_setup):
    client, _ = test_setup
    res = client.get("/api/v1/executions")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_create_and_get_execution(test_setup):
    client, session = test_setup

    # 1. Create a dummy completed job
    job = Job(
        id="job-12345",
        tier=Tier.lidar,
        room_area_m2=24.5,
        wall_count=4,
        status=JobStatus.complete,
        result_payload={
            "walls": [{"id": 1, "length_m": 5.4, "has_opening": False}],
            "files": {"floor_plan_svg": "floor_plan.svg"},
        },
    )
    session.add(job)

    # 2. Create execution linked to job
    create_payload = {
        "title": "Master Bedroom Assessment",
        "job_id": "job-12345",
        "property_type": "residential",
        "cause_of_loss": "water",
        "damage_description": "Water leak from ensuite bathroom",
    }
    create_res = client.post("/api/v1/executions", json=create_payload)
    assert create_res.status_code == 201
    created_data = create_res.json()
    exec_id = created_data["id"]
    assert created_data["title"] == "Master Bedroom Assessment"
    assert created_data["job_id"] == "job-12345"

    # 3. Fetch execution detail
    get_res = client.get(f"/api/v1/executions/{exec_id}")
    assert get_res.status_code == 200
    detail = get_res.json()
    assert detail["id"] == exec_id
    assert detail["job"]["room_area_m2"] == 24.5
    assert detail["claim"]["cause_of_loss"] == "water"
    assert detail["report_url"] == f"/api/v1/executions/{exec_id}/pdf"


def test_rename_and_delete_execution(test_setup):
    client, session = test_setup

    claim = Claim(
        id="claim-rename-test",
        title="Old Title",
        status=ClaimStatus.created,
        property_type="residential",
        cause_of_loss="water",
    )
    session.add(claim)

    # Rename
    patch_res = client.patch(
        "/api/v1/executions/claim-rename-test",
        json={"title": "Updated Assessment Name"},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["title"] == "Updated Assessment Name"

    # Delete
    del_res = client.delete("/api/v1/executions/claim-rename-test")
    assert del_res.status_code == 204

    # Verify gone
    get_res = client.get("/api/v1/executions/claim-rename-test")
    assert get_res.status_code == 404


def test_generate_pdf_report(tmp_path):
    claim = Claim(
        id="claim-pdf-test",
        title="Executive Assessment Report",
        status=ClaimStatus.complete,
        property_type="residential",
        cause_of_loss="water",
        damage_description="Burst pipe in kitchen ceiling",
        has_policy_pdf=True,
        policy_pdf_filename="test_policy.pdf",
        policy_analysis={"is_covered": True, "deductible": 1000.0, "coverage_limit": 100000.0},
        cost_estimate={
            "line_items": [
                {"code": "WTR-01", "description": "Extraction", "unit": "m²", "quantity": 10, "unit_price": 30.0, "total": 300.0}
            ],
            "net_claim_payout": 300.0,
        },
        total_estimated_cost=300.0,
    )

    job = Job(
        id="job-pdf-test",
        tier=Tier.lidar,
        room_area_m2=15.0,
        wall_count=4,
        status=JobStatus.complete,
        result_payload={"walls": [{"id": 1, "length_m": 4.0, "has_opening": False}]},
    )

    out_file = tmp_path / "test_report.pdf"
    res_path = generate_execution_pdf(claim, job, out_file)
    assert res_path.exists()
    assert res_path.stat().st_size > 1000  # Generated valid PDF bytes
