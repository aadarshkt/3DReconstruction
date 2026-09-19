"""
RAG Engine for Insurance Policy Analysis and Ingestion.
Uses pdfplumber for section-aware PDF chunking, ChromaDB for vector storage,
and LLMClient for semantic embeddings and policy reasoning.
"""
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

try:
    import chromadb
    from chromadb.config import Settings as ChromaSettings
except ImportError:
    chromadb = None  # type: ignore
    ChromaSettings = None  # type: ignore

try:
    import pdfplumber
except ImportError:
    pdfplumber = None  # type: ignore

import structlog

from app.agents.llm_client import LLMClient
from app.agents.prompts import POLICY_ANALYSIS_SYSTEM_PROMPT, POLICY_QUERY_SYSTEM_PROMPT
from app.config import settings


log = structlog.get_logger()

# Regex patterns for standard HO-3 / Homeowner policy sections
SECTION_PATTERNS = [
    (r"(?i)\bAGREEMENT\b", "AGREEMENT"),
    (r"(?i)\bDEFINITIONS\b", "DEFINITIONS"),
    (r"(?i)\bSECTION\s+I\s*[-–—]\s*PROPERTY\s+COVERAGES\b", "SECTION I - PROPERTY COVERAGES"),
    (r"(?i)\bCOVERAGE\s+A\s*[-–—]\s*DWELLING\b", "COVERAGE A - DWELLING"),
    (r"(?i)\bCOVERAGE\s+B\s*[-–—]\s*OTHER\s+STRUCTURES\b", "COVERAGE B - OTHER STRUCTURES"),
    (r"(?i)\bCOVERAGE\s+C\s*[-–—]\s*PERSONAL\s+PROPERTY\b", "COVERAGE C - PERSONAL PROPERTY"),
    (r"(?i)\bCOVERAGE\s+D\s*[-–—]\s*LOSS\s+OF\s+USE\b", "COVERAGE D - LOSS OF USE"),
    (r"(?i)\bADDITIONAL\s+COVERAGES\b", "ADDITIONAL COVERAGES"),
    (r"(?i)\bSECTION\s+I\s*[-–—]\s*PERILS\s+INSURED\s+AGAINST\b", "SECTION I - PERILS INSURED AGAINST"),
    (r"(?i)\bSECTION\s+I\s*[-–—]\s*EXCLUSIONS\b", "SECTION I - EXCLUSIONS"),
    (r"(?i)\bSECTION\s+I\s*[-–—]\s*CONDITIONS\b", "SECTION I - CONDITIONS"),
    (r"(?i)\bSECTION\s+II\s*[-–—]\s*LIABILITY\s+COVERAGES\b", "SECTION II - LIABILITY COVERAGES"),
    (r"(?i)\bSECTION\s+II\s*[-–—]\s*EXCLUSIONS\b", "SECTION II - EXCLUSIONS"),
    (r"(?i)\bSECTION\s+II\s*[-–—]\s*CONDITIONS\b", "SECTION II - CONDITIONS"),
    (r"(?i)\bSECTIONS\s+I\s+AND\s+II\s*[-–—]\s*CONDITIONS\b", "SECTIONS I AND II - CONDITIONS"),
    (r"(?i)\bDUTIES\s+AFTER\s+LOSS\b", "DUTIES AFTER LOSS"),
    (r"(?i)\bLOSS\s+SETTLEMENT\b", "LOSS SETTLEMENT"),
]


@dataclass
class PolicyChunk:
    text: str
    page: int
    section: str
    subsection: str
    chunk_index: int


@dataclass
class PolicyAnalysis:
    is_covered: Optional[bool] = None
    confidence: str = "medium"  # "high", "medium", "low"
    relevant_clauses: list[dict[str, Any]] = field(default_factory=list)
    page_references: list[int] = field(default_factory=list)
    exclusions_found: list[dict[str, Any]] = field(default_factory=list)
    deductible: Optional[float] = None
    coverage_limit: Optional[float] = None
    duties_after_loss: list[str] = field(default_factory=list)
    reasoning: str = ""
    recommendations: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class PolicyRAGEngine:
    """
    Manages policy extraction, section-aware chunking, vector indexing with ChromaDB,
    and policy retrieval / question-answering.
    """

    def __init__(
        self,
        persist_dir: Optional[Path] = None,
        llm_client: Optional[LLMClient] = None,
    ):
        self.persist_dir = persist_dir or settings.CHROMA_PERSIST_DIR
        self.persist_dir.mkdir(parents=True, exist_ok=True)
        if chromadb is not None and ChromaSettings is not None:
            self.client = chromadb.PersistentClient(
                path=str(self.persist_dir),
                settings=ChromaSettings(anonymized_telemetry=False),
            )
        else:
            self.client = None
            log.warning("chromadb_not_available", msg="ChromaDB not available; policy RAG vector storage disabled.")
        self.llm_client = llm_client or LLMClient()

    def _get_collection_name(self, claim_id: str) -> str:
        # Chroma collection names: 3-63 chars, alphanumeric, underscores, hyphens
        clean_id = claim_id.replace("-", "_")
        return f"policy_{clean_id}"[:63]

    def extract_text_from_pdf(self, pdf_path: str | Path) -> list[dict[str, Any]]:
        """
        Extract text page by page from a policy PDF.
        Returns a list of dicts: [{"page": 1, "text": "..."}]
        """
        path = Path(pdf_path)
        if not path.exists():
            raise FileNotFoundError(f"PDF not found at {pdf_path}")

        if pdfplumber is None:
            log.warning("pdfplumber_not_available", msg="pdfplumber not available; cannot extract text from PDF.")
            return []

        pages_data = []
        with pdfplumber.open(path) as pdf:
            for i, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
                pages_data.append({"page": i, "text": text.strip()})
        return pages_data

    def chunk_policy_pages(
        self,
        pages_data: list[dict[str, Any]],
        chunk_size: int = 800,
        chunk_overlap: int = 100,
    ) -> list[PolicyChunk]:
        """
        Perform section-aware chunking on extracted PDF pages.
        Detects standard insurance policy sections and tags chunks accordingly.
        """
        chunks: list[PolicyChunk] = []
        current_section = "GENERAL / DECLARATIONS"
        current_subsection = "GENERAL"
        chunk_counter = 0

        for item in pages_data:
            page_num = item["page"]
            text = item["text"]
            if not text:
                continue

            lines = text.splitlines()
            buffer_lines: list[str] = []
            buffer_len = 0

            for line in lines:
                trimmed = line.strip()
                if not trimmed:
                    continue

                # Check if this line introduces a new section
                matched_section = None
                for pat, sec_name in SECTION_PATTERNS:
                    if re.search(pat, trimmed):
                        matched_section = sec_name
                        break

                if matched_section:
                    # Flush current buffer if any
                    if buffer_lines:
                        chunk_text = "\n".join(buffer_lines).strip()
                        if chunk_text:
                            chunks.append(
                                PolicyChunk(
                                    text=chunk_text,
                                    page=page_num,
                                    section=current_section,
                                    subsection=current_subsection,
                                    chunk_index=chunk_counter,
                                )
                            )
                            chunk_counter += 1
                        buffer_lines = []
                        buffer_len = 0

                    current_section = matched_section
                    current_subsection = trimmed[:100]

                buffer_lines.append(trimmed)
                buffer_len += len(trimmed) + 1

                # If buffer exceeds chunk size, emit chunk and keep overlap
                if buffer_len >= chunk_size:
                    chunk_text = "\n".join(buffer_lines).strip()
                    chunks.append(
                        PolicyChunk(
                            text=chunk_text,
                            page=page_num,
                            section=current_section,
                            subsection=current_subsection,
                            chunk_index=chunk_counter,
                        )
                    )
                    chunk_counter += 1

                    # Retain last few lines for overlap
                    overlap_chars = 0
                    overlap_lines = []
                    for l in reversed(buffer_lines):
                        overlap_chars += len(l) + 1
                        overlap_lines.insert(0, l)
                        if overlap_chars >= chunk_overlap:
                            break
                    buffer_lines = overlap_lines
                    buffer_len = sum(len(l) + 1 for l in buffer_lines)

            # Flush end of page buffer
            if buffer_lines:
                chunk_text = "\n".join(buffer_lines).strip()
                if chunk_text:
                    chunks.append(
                        PolicyChunk(
                            text=chunk_text,
                            page=page_num,
                            section=current_section,
                            subsection=current_subsection,
                            chunk_index=chunk_counter,
                        )
                    )
                    chunk_counter += 1

        return chunks

    def ingest_policy(
        self,
        claim_id: str,
        pdf_path: str | Path,
    ) -> dict[str, Any]:
        """
        End-to-end ingestion:
        1. Extract text
        2. Chunk with section tagging
        3. Compute embeddings
        4. Store in ChromaDB
        """
        log.info("ingest_policy_started", claim_id=claim_id, pdf_path=str(pdf_path))
        pages_data = self.extract_text_from_pdf(pdf_path)
        chunks = self.chunk_policy_pages(
            pages_data,
            chunk_size=settings.RAG_CHUNK_SIZE,
            chunk_overlap=settings.RAG_CHUNK_OVERLAP,
        )

        if not chunks:
            raise ValueError(f"No extractable text found in policy PDF: {pdf_path}")

        coll_name = self._get_collection_name(claim_id)
        # Delete existing collection for this claim if re-uploading
        try:
            self.client.delete_collection(name=coll_name)
        except Exception:
            pass

        collection = self.client.create_collection(
            name=coll_name,
            metadata={"claim_id": claim_id, "total_chunks": len(chunks)},
        )

        texts = [c.text for c in chunks]
        embeddings = self.llm_client.embed(texts)

        ids = [f"{claim_id}_chunk_{c.chunk_index}" for c in chunks]
        metadatas = [
            {
                "claim_id": claim_id,
                "page": c.page,
                "section": c.section,
                "subsection": c.subsection,
                "chunk_index": c.chunk_index,
            }
            for c in chunks
        ]

        # Add to ChromaDB in batches of 100
        batch_size = 100
        for i in range(0, len(chunks), batch_size):
            collection.add(
                ids=ids[i : i + batch_size],
                embeddings=embeddings[i : i + batch_size],
                documents=texts[i : i + batch_size],
                metadatas=metadatas[i : i + batch_size],
            )

        log.info(
            "ingest_policy_complete",
            claim_id=claim_id,
            total_pages=len(pages_data),
            total_chunks=len(chunks),
        )

        return {
            "claim_id": claim_id,
            "total_pages": len(pages_data),
            "total_chunks": len(chunks),
            "collection_name": coll_name,
        }

    def retrieve_chunks(
        self,
        claim_id: str,
        query: str,
        top_k: Optional[int] = None,
        section_filter: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """
        Query the ChromaDB collection for the top-k most semantically relevant chunks.
        """
        k = top_k or settings.RAG_TOP_K
        coll_name = self._get_collection_name(claim_id)
        try:
            collection = self.client.get_collection(name=coll_name)
        except Exception as e:
            raise RuntimeError(f"Policy not found or not indexed for claim {claim_id}: {e}")

        query_emb = self.llm_client.embed([query])
        if not query_emb:
            return []

        where_clause = None
        if section_filter:
            where_clause = {"section": section_filter}

        results = collection.query(
            query_embeddings=query_emb,
            n_results=min(k, collection.count()),
            where=where_clause,
        )

        retrieved = []
        if results and results["documents"]:
            docs = results["documents"][0]
            metas = results["metadatas"][0]
            distances = results.get("distances", [[]])[0]
            for i, doc in enumerate(docs):
                meta = metas[i] if i < len(metas) else {}
                dist = distances[i] if i < len(distances) else None
                retrieved.append(
                    {
                        "text": doc,
                        "page": meta.get("page", 1),
                        "section": meta.get("section", "UNKNOWN"),
                        "subsection": meta.get("subsection", ""),
                        "chunk_index": meta.get("chunk_index", 0),
                        "distance": dist,
                    }
                )

        return retrieved

    def analyze_coverage(
        self,
        claim_id: str,
        claim_data: dict[str, Any],
        reconstruction_metrics: Optional[dict[str, Any]] = None,
    ) -> PolicyAnalysis:
        """
        Perform comprehensive coverage analysis for a physical damage claim against the policy.
        Gathers relevant chunks across perils, exclusions, and conditions,
        then calls the LLM to generate a verified, legally grounded coverage opinion.
        """
        cause = claim_data.get("cause_of_loss", "property damage")
        description = claim_data.get("damage_description", "")
        prop_type = claim_data.get("property_type", "residential")

        # Gather relevant chunks across multiple query perspectives
        search_queries = [
            f"{cause} damage coverage {description}",
            f"exclusions for {cause} water mold rot intentional neglect",
            "deductible loss settlement duties after loss conditions",
        ]

        seen_chunks = set()
        chunks_for_prompt = []

        for q in search_queries:
            results = self.retrieve_chunks(claim_id, q, top_k=4)
            for r in results:
                c_idx = r["chunk_index"]
                if c_idx not in seen_chunks:
                    seen_chunks.add(c_idx)
                    chunks_for_prompt.append(r)

        # Build context
        context_parts = []
        for i, c in enumerate(chunks_for_prompt, 1):
            context_parts.append(
                f"--- Policy Excerpt #{i} (Page {c['page']}, Section: {c['section']}) ---\n"
                f"{c['text']}\n"
            )
        context_str = "\n".join(context_parts)

        metrics_str = ""
        if reconstruction_metrics:
            metrics_str = (
                f"\n3D Physical Scan / Reconstruction Metrics:\n"
                f"- Room Area: {reconstruction_metrics.get('room_area_m2', 'N/A')} m²\n"
                f"- Wall Count: {reconstruction_metrics.get('wall_count', 'N/A')}\n"
                f"- Estimated Damage Area: {reconstruction_metrics.get('damage_area_m2', 'N/A')} m²\n"
            )

        system_prompt = POLICY_ANALYSIS_SYSTEM_PROMPT


        user_prompt = (
            f"Claim Information:\n"
            f"- Property Type: {prop_type}\n"
            f"- Cause of Loss: {cause}\n"
            f"- Damage Description: {description}\n"
            f"{metrics_str}\n"
            f"Retrieved Policy Excerpts:\n"
            f"{context_str}\n\n"
            f"Determine coverage, applicable exclusions, deductible/limits, and insured duties."
        )

        raw_response = self.llm_client.chat(
            user_prompt=user_prompt,
            system_prompt=system_prompt,
            json_mode=True,
        )

        try:
            parsed = json.loads(raw_response)
            return PolicyAnalysis(
                is_covered=parsed.get("is_covered"),
                confidence=parsed.get("confidence", "medium"),
                relevant_clauses=parsed.get("relevant_clauses", []),
                page_references=parsed.get("page_references", []),
                exclusions_found=parsed.get("exclusions_found", []),
                deductible=parsed.get("deductible"),
                coverage_limit=parsed.get("coverage_limit"),
                duties_after_loss=parsed.get("duties_after_loss", []),
                reasoning=parsed.get("reasoning", ""),
                recommendations=parsed.get("recommendations", []),
            )
        except Exception as e:
            log.warning("policy_analysis_parse_fallback", raw=raw_response, error=str(e))
            return PolicyAnalysis(
                is_covered=None,
                confidence="low",
                reasoning=raw_response,
            )

    def query_policy(
        self,
        claim_id: str,
        question: str,
        claim_data: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """
        Answer arbitrary natural language questions about the policy in the context of the claim.
        """
        chunks = self.retrieve_chunks(claim_id, question, top_k=settings.RAG_TOP_K)
        if not chunks:
            return {
                "answer": "No relevant policy sections were found for this query.",
                "sources": [],
            }

        context_parts = []
        sources = []
        for i, c in enumerate(chunks, 1):
            context_parts.append(
                f"[Excerpt {i}] (Page {c['page']}, Section: {c['section']})\n{c['text']}\n"
            )
            sources.append(
                {
                    "page": c["page"],
                    "section": c["section"],
                    "subsection": c["subsection"],
                    "snippet": c["text"][:150] + "...",
                }
            )
        context_str = "\n".join(context_parts)

        claim_info_str = ""
        if claim_data:
            claim_info_str = (
                f"\nClaim Context:\n"
                f"- Cause of Loss: {claim_data.get('cause_of_loss')}\n"
                f"- Damage: {claim_data.get('damage_description')}\n"
            )

        system_prompt = POLICY_QUERY_SYSTEM_PROMPT


        user_prompt = (
            f"User Question: {question}\n"
            f"{claim_info_str}\n"
            f"Policy Sections:\n"
            f"{context_str}\n\n"
            f"Please provide an accurate, grounded answer citing page numbers and policy clauses."
        )

        answer = self.llm_client.chat(
            user_prompt=user_prompt,
            system_prompt=system_prompt,
            json_mode=False,
        )

        return {
            "answer": answer,
            "sources": sources,
        }
