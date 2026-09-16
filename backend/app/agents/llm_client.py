"""
LLM and Embedding client wrapping OpenAI-compatible APIs (OpenAI, OpenRouter, etc.).
"""
import os
import time
from typing import Any, Optional
import httpx
import structlog

from app.config import settings

log = structlog.get_logger()


class LLMClient:
    """
    Client for interacting with LLM completions (e.g. OpenRouter)
    and Embeddings (e.g. OpenAI text-embedding-3-small).
    """

    def __init__(
        self,
        llm_base_url: Optional[str] = None,
        llm_api_key: Optional[str] = None,
        llm_model: Optional[str] = None,
        embedding_base_url: Optional[str] = None,
        embedding_api_key: Optional[str] = None,
        embedding_model: Optional[str] = None,
        timeout: Optional[float] = None,
    ):
        self.llm_base_url = (llm_base_url or settings.LLM_BASE_URL).rstrip("/")
        self.llm_api_key = (
            llm_api_key
            or settings.LLM_API_KEY
            or os.getenv("OPENROUTER_API_KEY", "")
            or os.getenv("OPENAI_API_KEY", "")
        )
        self.llm_model = llm_model or settings.LLM_MODEL

        self.embedding_base_url = (
            embedding_base_url or settings.EMBEDDING_BASE_URL
        ).rstrip("/")
        self.embedding_api_key = (
            embedding_api_key
            or settings.EMBEDDING_API_KEY
            or os.getenv("OPENAI_API_KEY", "")
            or self.llm_api_key
        )
        self.embedding_model = embedding_model or settings.EMBEDDING_MODEL
        self.timeout = timeout or settings.LLM_TIMEOUT_S

    def chat(
        self,
        user_prompt: str,
        system_prompt: Optional[str] = None,
        json_mode: bool = False,
        temperature: float = 0.1,
        max_retries: int = 3,
    ) -> str:
        """
        Send a chat completion request to the LLM API.
        """
        url = f"{self.llm_base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.llm_api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/floorplan-pipeline",
            "X-Title": "FloorPlan Insurance Agent",
        }

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_prompt})

        payload: dict[str, Any] = {
            "model": self.llm_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": settings.LLM_MAX_TOKENS,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        last_err: Optional[Exception] = None
        for attempt in range(max_retries):
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    resp = client.post(url, headers=headers, json=payload)
                    resp.raise_for_status()
                    data = resp.json()
                    return data["choices"][0]["message"]["content"]
            except Exception as e:
                last_err = e
                log.warning(
                    "llm_chat_retry",
                    attempt=attempt + 1,
                    max_retries=max_retries,
                    error=str(e),
                )
                time.sleep(2**attempt)

        log.error("llm_chat_failed", error=str(last_err))
        raise RuntimeError(f"LLM chat call failed after {max_retries} attempts: {last_err}")

    def embed(
        self,
        texts: list[str],
        batch_size: int = 64,
        max_retries: int = 3,
    ) -> list[list[float]]:
        """
        Generate vector embeddings for a list of texts using an OpenAI-compatible endpoint.
        """
        if not texts:
            return []

        url = f"{self.embedding_base_url}/embeddings"
        headers = {
            "Authorization": f"Bearer {self.embedding_api_key}",
            "Content-Type": "application/json",
        }

        all_embeddings: list[list[float]] = []

        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            payload = {
                "model": self.embedding_model,
                "input": batch,
            }

            last_err: Optional[Exception] = None
            batch_success = False

            for attempt in range(max_retries):
                try:
                    with httpx.Client(timeout=self.timeout) as client:
                        resp = client.post(url, headers=headers, json=payload)
                        resp.raise_for_status()
                        data = resp.json()
                        # Sort by index to ensure correct ordering
                        sorted_items = sorted(data["data"], key=lambda x: x["index"])
                        for item in sorted_items:
                            all_embeddings.append(item["embedding"])
                        batch_success = True
                        break
                except Exception as e:
                    last_err = e
                    log.warning(
                        "embedding_retry",
                        attempt=attempt + 1,
                        batch_start=i,
                        error=str(e),
                    )
                    time.sleep(2**attempt)

            if not batch_success:
                log.error("embedding_batch_failed", batch_start=i, error=str(last_err))
                raise RuntimeError(
                    f"Embedding call failed for batch starting at {i}: {last_err}"
                )

        return all_embeddings
