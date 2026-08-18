# Anthropic AI Provider (SAP proxy / dev only)
"""
Anthropic Messages API provider, designed for the SAP proxy at
http://localhost:6655/anthropic/ (no API key) or direct Anthropic endpoints.

IMPORTANT: This provider is dev-only and is only activated when
BUBBLY_USE_ANTHROPIC_PROXY=true.  Do NOT enable it in production.
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from .provider import AIProvider, ProviderUnavailableError, StructuredOutputError, ToolCall, ToolCallResponse

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


class AnthropicProvider(AIProvider):
    """Anthropic Messages API provider (SAP proxy or direct)."""

    def __init__(
        self,
        base_url: str,
        api_key: str = "",
        model: str = "anthropic--claude-4.6-sonnet",
        max_tokens: int = 4096,
        timeout: float = 60.0,
    ) -> None:
        """
        Initialize AnthropicProvider.

        Args:
            base_url: Base URL of the proxy or Anthropic endpoint
                      (trailing slash stripped automatically).
            api_key: Optional API key — omit for the SAP proxy (no key needed).
            model: Anthropic/proxy model ID.
            max_tokens: Maximum tokens to generate (required by Anthropic API).
            timeout: Request timeout in seconds.
        """
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.max_tokens = max_tokens
        self.timeout = timeout
        self._client = httpx.AsyncClient(timeout=timeout)

    @property
    def name(self) -> str:
        return f"anthropic/{self.model}"

    def _headers(self) -> dict[str, str]:
        """Build request headers.

        When an api_key is configured we send it two ways so the same provider
        works against both endpoints it targets:
          - ``Authorization: Bearer <key>`` — required by the SAP proxy, which
            rejects requests lacking it with 401 MISSING_AUTHORIZATION_HEADER.
          - ``x-api-key: <key>`` — the header the direct Anthropic API expects.
        Sending both is harmless: each endpoint reads the one it knows.
        """
        headers = {
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
            headers["x-api-key"] = self.api_key
        return headers

    def _build_prompt(
        self, prompt: str, response_schema: type[T] | None
    ) -> str:
        """Append JSON-schema instruction when structured output is requested."""
        if not response_schema:
            return prompt
        schema_json = json.dumps(response_schema.model_json_schema(), indent=2)
        return f"""{prompt}

Respond with valid JSON matching this schema:
```json
{schema_json}
```

Return ONLY the JSON, no markdown formatting or extra text."""

    @staticmethod
    def _strip_fences(text: str) -> str:
        """Remove ```json / ``` fences from the response text."""
        cleaned = text.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        return cleaned.strip()

    def _parse_structured(self, text: str, response_schema: type[T]) -> T:
        """Parse fence-stripped text into the given Pydantic schema."""
        cleaned = self._strip_fences(text)
        try:
            parsed = json.loads(cleaned)
            result: T = response_schema.model_validate(parsed)
            return result
        except json.JSONDecodeError as e:
            raise StructuredOutputError(f"Failed to parse JSON: {text}") from e
        except ValidationError as e:
            raise StructuredOutputError(f"Schema validation failed: {e}") from e

    def _extract_text(self, data: dict[str, Any]) -> str:
        """Extract the text payload from an Anthropic Messages API response."""
        try:
            return str(data["content"][0]["text"])
        except (KeyError, IndexError) as e:
            raise StructuredOutputError(
                f"Unexpected Anthropic response format: {data}"
            ) from e

    async def complete(
        self,
        prompt: str,
        response_schema: type[T] | None = None,
        temperature: float = 0.7,
    ) -> T | str:
        """Generate a completion using the Anthropic Messages API."""
        url = f"{self.base_url}/v1/messages"
        full_prompt = self._build_prompt(prompt, response_schema)

        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "temperature": temperature,
            "messages": [
                {
                    "role": "user",
                    "content": [{"type": "text", "text": full_prompt}],
                }
            ],
        }

        try:
            response = await self._client.post(
                url, json=payload, headers=self._headers()
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            error_body = e.response.text[:500] if hasattr(e.response, "text") else str(e)
            if e.response.status_code == 429:
                raise ProviderUnavailableError(
                    f"Anthropic [{self.model}] rate limit 429: {error_body}"
                ) from e
            raise ProviderUnavailableError(
                f"Anthropic [{self.model}] API error {e.response.status_code}: {error_body}"
            ) from e
        except httpx.RequestError as e:
            raise ProviderUnavailableError(
                f"Anthropic [{self.model}] connection error: {type(e).__name__}: {e}"
            ) from e

        data = response.json()
        text = self._extract_text(data)

        if not response_schema:
            return str(text)

        return self._parse_structured(text, response_schema)

    @property
    def supports_vision(self) -> bool:
        return True

    @property
    def supports_tool_calling(self) -> bool:
        return True

    def _build_anthropic_tools(self, tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Translate provider-neutral tool schemas to Anthropic wire format."""
        anthropic_tools = []
        for t in tools:
            anthropic_tools.append(
                {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "input_schema": t.get("parameters", {"type": "object", "properties": {}}),
                }
            )
        return anthropic_tools

    def _messages_to_anthropic(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Convert provider-neutral messages to Anthropic Messages API format.

        Provider-neutral roles:
          - "user"        → Anthropic "user" with text content block.
          - "assistant"   → Anthropic "assistant"; content may be a list of blocks
                            (tool_use + text) or a plain string.
          - "tool_result" → Anthropic "user" with a tool_result content block.

        The neutral format uses a ``content`` field that can be:
          - str                 plain text
          - list[dict]          pre-built content blocks (for assistant tool-use turns
                                and user tool_result turns built by the ReAct node)
        """
        result = []
        for msg in messages:
            role = msg["role"]
            content = msg["content"]
            if role == "tool_result":
                # Node passes pre-built Anthropic tool_result blocks in content
                result.append({"role": "user", "content": content})
            elif role == "assistant" and isinstance(content, list):
                # Pre-built assistant blocks (tool_use turns)
                result.append({"role": "assistant", "content": content})
            else:
                result.append(
                    {
                        "role": role,
                        "content": [{"type": "text", "text": str(content)}],
                    }
                )
        return result

    async def complete_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        temperature: float = 0.7,
    ) -> ToolCallResponse:
        """Run one tool-calling turn against the Anthropic Messages API.

        Args:
            messages:    Provider-neutral running conversation.
            tools:       Registry tool schemas (name, description, parameters).
            temperature: Sampling temperature.

        Returns:
            ToolCallResponse with either tool_calls (model wants to act) or
            text (final answer).
        """
        url = f"{self.base_url}/v1/messages"
        anthropic_tools = self._build_anthropic_tools(tools)
        anthropic_messages = self._messages_to_anthropic(messages)

        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "temperature": temperature,
            "tools": anthropic_tools,
            "messages": anthropic_messages,
        }

        try:
            response = await self._client.post(url, json=payload, headers=self._headers())
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            error_body = e.response.text[:500] if hasattr(e.response, "text") else str(e)
            if e.response.status_code == 429:
                raise ProviderUnavailableError(
                    f"Anthropic [{self.model}] tool-calling rate limit 429: {error_body}"
                ) from e
            raise ProviderUnavailableError(
                f"Anthropic [{self.model}] tool-calling API error "
                f"{e.response.status_code}: {error_body}"
            ) from e
        except httpx.RequestError as e:
            raise ProviderUnavailableError(
                f"Anthropic [{self.model}] tool-calling connection error: {type(e).__name__}: {e}"
            ) from e

        data = response.json()
        stop_reason = data.get("stop_reason", "")
        content_blocks: list[dict[str, Any]] = data.get("content", [])

        if stop_reason == "tool_use":
            tool_calls = [
                ToolCall(
                    id=block["id"],
                    name=block["name"],
                    arguments=block.get("input", {}),
                )
                for block in content_blocks
                if block.get("type") == "tool_use"
            ]
            return ToolCallResponse(tool_calls=tool_calls)

        # end_turn or any other stop reason → extract text
        text_parts = [
            block.get("text", "")
            for block in content_blocks
            if block.get("type") == "text"
        ]
        return ToolCallResponse(text=" ".join(text_parts).strip() or None)

    async def vision_complete(
        self,
        prompt: str,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        response_schema: type[T] | None = None,
        temperature: float = 0.3,
    ) -> T | str:
        """Generate a completion from an image + text prompt."""
        import base64

        url = f"{self.base_url}/v1/messages"
        full_prompt = self._build_prompt(prompt, response_schema)
        b64 = base64.b64encode(image_bytes).decode("utf-8")

        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "temperature": temperature,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime_type,
                                "data": b64,
                            },
                        },
                        {"type": "text", "text": full_prompt},
                    ],
                }
            ],
        }

        try:
            response = await self._client.post(
                url, json=payload, headers=self._headers()
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            error_body = e.response.text[:500] if hasattr(e.response, "text") else str(e)
            if e.response.status_code == 429:
                raise ProviderUnavailableError(
                    f"Anthropic [{self.model}] vision rate limit 429: {error_body}"
                ) from e
            raise ProviderUnavailableError(
                f"Anthropic [{self.model}] vision API error {e.response.status_code}: "
                f"{error_body}"
            ) from e
        except httpx.RequestError as e:
            raise ProviderUnavailableError(
                f"Anthropic [{self.model}] vision connection error: {type(e).__name__}: {e}"
            ) from e

        data = response.json()
        text = self._extract_text(data)

        if not response_schema:
            return str(text)

        return self._parse_structured(text, response_schema)

    async def stream_complete(
        self,
        prompt: str,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        """Stream tokens using Anthropic SSE (content_block_delta events)."""
        url = f"{self.base_url}/v1/messages"

        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "temperature": temperature,
            "stream": True,
            "messages": [
                {
                    "role": "user",
                    "content": [{"type": "text", "text": prompt}],
                }
            ],
        }

        try:
            async with self._client.stream(
                "POST", url, json=payload, headers=self._headers()
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    json_str = line[6:]  # strip 'data: ' prefix
                    if not json_str.strip():
                        continue
                    try:
                        chunk = json.loads(json_str)
                        if chunk.get("type") == "content_block_delta":
                            delta_text = chunk.get("delta", {}).get("text", "")
                            if delta_text:
                                yield delta_text
                    except (json.JSONDecodeError, KeyError):
                        continue
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                error_body = e.response.text[:500] if hasattr(e.response, "text") else str(e)
                logger.warning(
                    f"Anthropic [{self.model}] stream hit 429 rate limit, cascading: "
                    f"{error_body[:200]}"
                )
                raise ProviderUnavailableError(
                    f"Anthropic stream rate limit exceeded: {error_body}"
                ) from e
            # Non-429 HTTP errors: fall back to non-streaming
            logger.warning(
                f"Anthropic [{self.model}] stream failed "
                f"(status={e.response.status_code}), falling back to non-streaming"
            )
            result = await self.complete(prompt=prompt, temperature=temperature)
            text = result if isinstance(result, str) else str(result)
            yield text
        except httpx.RequestError as e:
            logger.warning(
                f"Anthropic [{self.model}] stream connection error, "
                f"falling back to non-streaming: {e}"
            )
            result = await self.complete(prompt=prompt, temperature=temperature)
            text = result if isinstance(result, str) else str(result)
            yield text

    async def is_available(self) -> bool:
        """Check if the proxy/endpoint is reachable.

        Returns True if the host responds at all (any HTTP status or 200/429),
        False only on httpx.RequestError (unreachable host).  This mirrors
        GeminiProvider.is_available() semantics so the manager cascade works.
        """
        try:
            response = await self._client.get(
                self.base_url,
                headers=self._headers(),
                follow_redirects=True,
            )
            # Any HTTP response (even 404) means the host is up
            _ = response.status_code
            if response.status_code == 429:
                logger.info(
                    f"Anthropic [{self.model}] availability check got 429 "
                    "(rate-limited), treating as available for cascade"
                )
            return True
        except httpx.RequestError as e:
            logger.warning(
                f"Anthropic [{self.model}] availability check connection error: {type(e).__name__}: {e}"
            )
            return False

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()
