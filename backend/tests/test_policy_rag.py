"""
Unit and integration tests for Policy RAG:
- Section-aware chunking
- Text extraction from HO-3 PDF
- ChromaDB indexing and retrieval
- PolicyAnalysis structure
"""
from pathlib import Path
import pytest
from app.agents.policy_rag import PolicyRAGEngine, PolicyChunk, PolicyAnalysis

FIXTURE_PDF = Path(__file__).parent / "fixtures" / "sample_ho3_policy.pdf"


class MockLLMClient:
    """Mock LLM client for deterministic testing without remote API keys."""

    def __init__(self, dim: int = 64):
        self.dim = dim

    def embed(self, texts: list[str], **kwargs) -> list[list[float]]:
        # Deterministic bag-of-words / hash based embedding
        embeddings = []
        for text in texts:
            vec = [0.0] * self.dim
            words = text.lower().split()
            for w in words:
                idx = hash(w) % self.dim
                vec[idx] += 1.0
            # Normalize
            norm = sum(v * v for v in vec) ** 0.5 or 1.0
            embeddings.append([v / norm for v in vec])
        return embeddings

    def chat(self, user_prompt: str, system_prompt: str = None, json_mode: bool = False, **kwargs) -> str:
        if json_mode:
            return """{
                "is_covered": true,
                "confidence": "high",
                "relevant_clauses": [
                    {"clause": "Accidental discharge or overflow of water or steam", "section": "SECTION I - PERILS INSURED AGAINST", "page": 9}
                ],
                "page_references": [9, 10],
                "exclusions_found": [
                    {"exclusion": "Water Damage / Flood", "applies": false, "reasoning": "Loss is internal plumbing burst, not external surface flood"}
                ],
                "deductible": 1000.0,
                "coverage_limit": 300000.0,
                "duties_after_loss": ["Give prompt notice", "Protect property from further damage"],
                "reasoning": "Sudden and accidental burst pipe water damage is a covered peril under standard HO-3 Section I.",
                "recommendations": ["Mitigate active moisture", "Retain plumbing repair invoice"]
            }"""
        return "Under Section I - Perils Insured Against (page 9), accidental discharge of water from plumbing is covered."


def test_pdf_extraction():
    """Verify that sample HO-3 policy extracts text from all pages."""
    assert FIXTURE_PDF.exists(), f"Sample policy fixture missing: {FIXTURE_PDF}"
    engine = PolicyRAGEngine(llm_client=MockLLMClient())
    pages = engine.extract_text_from_pdf(FIXTURE_PDF)
    assert len(pages) == 22
    assert "HOMEOWNERS 3" in pages[0]["text"]


def test_section_aware_chunking():
    """Verify that section headers are detected and metadata is correctly tagged."""
    engine = PolicyRAGEngine(llm_client=MockLLMClient())
    pages = engine.extract_text_from_pdf(FIXTURE_PDF)
    chunks = engine.chunk_policy_pages(pages, chunk_size=600, chunk_overlap=80)

    assert len(chunks) > 10
    sections = {c.section for c in chunks}

    # Verify major HO-3 sections are captured
    assert any("AGREEMENT" in s for s in sections)
    assert any("DEFINITIONS" in s for s in sections)
    assert any("SECTION I - PROPERTY COVERAGES" in s or "COVERAGE" in s for s in sections)
    assert any("PERILS INSURED AGAINST" in s for s in sections)
    assert any("EXCLUSIONS" in s for s in sections)
    assert any("CONDITIONS" in s for s in sections)

    # Check chunk continuity and metadata
    for c in chunks:
        assert c.page >= 1
        assert len(c.text) > 0
        assert c.chunk_index >= 0


def test_chromadb_ingestion_and_retrieval(tmp_path):
    """Verify that chunks are indexed into ChromaDB and retrieved by semantic relevance."""
    mock_llm = MockLLMClient()
    engine = PolicyRAGEngine(persist_dir=tmp_path / "chromadb", llm_client=mock_llm)

    claim_id = "test-claim-1234"
    stats = engine.ingest_policy(claim_id, FIXTURE_PDF)

    assert stats["claim_id"] == claim_id
    assert stats["total_pages"] == 22
    assert stats["total_chunks"] > 0

    # Retrieve water damage clauses
    retrieved = engine.retrieve_chunks(claim_id, "water damage plumbing overflow", top_k=5)
    assert len(retrieved) > 0
    assert "text" in retrieved[0]
    assert "page" in retrieved[0]
    assert "section" in retrieved[0]


def test_policy_analysis_reasoning(tmp_path):
    """Verify that analyze_coverage orchestrates retrieval and structured analysis."""
    mock_llm = MockLLMClient()
    engine = PolicyRAGEngine(persist_dir=tmp_path / "chromadb", llm_client=mock_llm)

    claim_id = "claim-test-analysis"
    engine.ingest_policy(claim_id, FIXTURE_PDF)

    claim_data = {
        "cause_of_loss": "water",
        "damage_description": "Frozen pipe burst under kitchen sink, flooding living room drywall and floor",
        "property_type": "residential",
    }
    reconstruction_metrics = {
        "room_area_m2": 24.5,
        "wall_count": 4,
        "damage_area_m2": 6.8,
    }

    analysis = engine.analyze_coverage(claim_id, claim_data, reconstruction_metrics)
    assert isinstance(analysis, PolicyAnalysis)
    assert analysis.is_covered is True
    assert analysis.confidence == "high"
    assert len(analysis.relevant_clauses) > 0
    assert analysis.deductible == 1000.0
    assert analysis.coverage_limit == 300000.0
    assert len(analysis.duties_after_loss) > 0
    assert "Sudden and accidental" in analysis.reasoning


def test_policy_query_qa(tmp_path):
    """Verify natural language Q&A against the indexed policy."""
    mock_llm = MockLLMClient()
    engine = PolicyRAGEngine(persist_dir=tmp_path / "chromadb", llm_client=mock_llm)

    claim_id = "claim-test-qa"
    engine.ingest_policy(claim_id, FIXTURE_PDF)

    res = engine.query_policy(claim_id, "Is plumbing water damage covered?")
    assert "answer" in res
    assert len(res["sources"]) > 0
    assert "page" in res["sources"][0]
