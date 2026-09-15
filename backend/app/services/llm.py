"""
OpenAI-compatible LLM client.

Thin wrapper around any `/chat/completions`-style endpoint (OpenAI, Azure,
or a self-hosted server). Async by default, with sync convenience wrappers
for use inside Celery worker tasks.
"""
import asyncio
import base64
import mimetypes
from pathlib import Path
from typing import Optional

import httpx
import structlog

from app.config import settings

log = structlog.get_logger()

MIME_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


class LLMError(Exception):
    """Raised when an LLM request fails or returns a non-200 response."""


class LLMClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout_s: Optional[int] = None,
        max_tokens: Optional[int] = None,
    ):
        self.base_url = (base_url or settings.LLM_BASE_URL).rstrip("/")
        self.api_key = api_key if api_key is not None else settings.LLM_API_KEY
        self.model = model or settings.LLM_MODEL
        self.timeout_s = timeout_s or settings.LLM_TIMEOUT_S
        self.max_tokens = max_tokens or settings.LLM_MAX_TOKENS

    # ── Async API ─────────────────────────────────────────────────────────────
    async def chat(self, messages: list[dict]) -> str:
        """Send a plain text chat request and return the assistant text."""
        return await self._complete(messages)

    async def chat_vision(self, messages: list[dict], image_paths: list[str]) -> str:
        """
        Send a multimodal request with images attached to the final user turn.

        `messages` should be a standard list of {role, content} dicts; the last
        message's role must be "user". Images are appended to that turn.
        """
        if not image_paths:
            return await self.chat(messages)

        # Deep-copy so we don't mutate the caller's list
        msgs = [dict(m) for m in messages]
        last = msgs[-1]
        if last.get("role") != "user":
            raise LLMError("The last message must have role 'user' for vision input.")

        text = last.get("content", "")
        content: list[dict] = []
        if text:
            content.append({"type": "text", "text": text})
        for path in image_paths:
            content.append({
                "type": "image_url",
                "image_url": {"url": self._data_url(path)},
            })
        last["content"] = content

        return await self._complete(msgs)

    async def _complete(self, messages: list[dict]) -> str:
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": self.max_tokens,
        }

        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            try:
                resp = await client.post(
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                )
            except httpx.HTTPError as exc:
                log.error("llm_request_error", error=str(exc))
                raise LLMError(f"LLM request failed: {exc}") from exc

        if resp.status_code != 200:
            log.error("llm_non_200", status=resp.status_code, body=resp.text[:500])
            raise LLMError(f"LLM returned HTTP {resp.status_code}: {resp.text[:500]}")

        data = resp.json()
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError(f"Unexpected LLM response shape: {data}") from exc

    def _data_url(self, path: str) -> str:
        p = Path(path)
        mime = MIME_BY_EXT.get(p.suffix.lower()) or mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        encoded = base64.b64encode(p.read_bytes()).decode("ascii")
        return f"data:{mime};base64,{encoded}"

    # ── Sync wrappers (for Celery workers) ────────────────────────────────────
    def chat_sync(self, messages: list[dict]) -> str:
        return asyncio.run(self.chat(messages))

    def chat_vision_sync(self, messages: list[dict], image_paths: list[str]) -> str:
        return asyncio.run(self.chat_vision(messages, image_paths))
