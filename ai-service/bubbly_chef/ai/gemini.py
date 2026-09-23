# Gemini AI Provider
"""
Google Gemini provider using the free tier API.
"""

import asyncio
import base64
import json
import logging
import re
from collections.abc import AsyncIterator, Callable
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from .provider import (
    AIProvider,
    ProviderFailureKind,
    ProviderUnavailableError,
    StructuredOutputError,
    ToolCall,
    ToolCallResponse,
)

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# A real Gemini 429 carries `"status": "RESOURCE_EXHAUSTED"` and the message
# "You exceeded your current quota, please check your plan and billing
# details" for *both* a brief per-minute throttle and an actual daily/spend
# cap — those words alone can't tell the two apart, and a per-minute throttle
# is the common free-tier case. The one field that does distinguish them is
# the QuotaFailure detail's `quotaId`, e.g.
# `GenerateRequestsPerMinutePerProjectPerModel-FreeTier` vs
# `GenerateRequestsPerDayPerProjectPerModel-FreeTier`. Match it directly
# instead of keying off words that appear in both cases.
_QUOTA_ID_RE = re.compile(r'"quotaId"\s*:\s*"([^"]+)"', re.IGNORECASE)


def _classify_http_error(status_code: int, body: str) -> ProviderFailureKind:
    """Classify a Gemini HTTP error response into a `ProviderFailureKind`.

    Args:
        status_code: The HTTP status code Gemini returned. Callers must pass
            the *full*, untruncated response body — the `quotaId` detail this
            relies on can sit past any prefix used for logging/display.
        body: The raw response body (used to tell a quota/billing 429 apart
            from a plain per-minute rate-limit 429).
    """
    if status_code == 429:
        quota_match = _QUOTA_ID_RE.search(body)
        if quota_match:
            quota_id = quota_match.group(1).lower()
            if "day" in quota_id:
                return "quota_exhausted"
            if "minute" in quota_id or "second" in quota_id:
                return "rate_limited"
        # No quotaId detail to key off. Gemini's per-minute throttle and its
        # daily/spend-cap 429 share the same RESOURCE_EXHAUSTED status and
        # the same "exceeded your current quota ... billing details"
        # message, so "quota"/"billing"/"resource_exhausted" in the body
        # can't distinguish them — treating any of those words as decisive
        # is exactly what made every real 429 classify as quota_exhausted
        # before this fix. Default to the more common, more benign case
        # (a brief throttle) rather than the alarming one.
        return "rate_limited"
    if status_code in (401, 403):
        return "auth"
    if status_code == 404:
        return "model_not_found"
    if status_code == 400:
        return "bad_request"
    if status_code >= 500:
        return "overloaded"
    return "unknown"


# Gemini 5xx responses (overloaded / internal / gateway) are transient; the
# same request usually succeeds a moment later.
_TRANSIENT_STATUS_CODES = frozenset({500, 502, 503, 504})

# The availability pre-check runs before every request. It only has to prove
# the key and model resolve, so it gets a short timeout of its own instead of
# the 60s client default — otherwise a slow check alone could eat most of the
# scan client's 45s budget before the vision call even starts.
_AVAILABILITY_TIMEOUT_SECONDS = 5.0

# A vision retry is only started if at least this much of the caller's budget
# would be left once the backoff has elapsed. Real receipt scans take ~5-8s
# (issue #479), so an attempt with less than this can't realistically finish
# before the scan client aborts; it would only spend quota on a response
# nobody receives.
_MIN_VISION_ATTEMPT_SECONDS = 5.0


class GeminiProvider(AIProvider):
    """Google Gemini API provider."""

    BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-3.1-flash-lite",
        timeout: float = 60.0,
        vision_timeout: float = 18.0,
        vision_max_retries: int = 1,
        vision_retry_backoff: float = 1.0,
    ):
        """
        Initialize Gemini provider.

        Args:
            api_key: Google AI API key
            model: Model to use (gemini-3.1-flash-lite recommended for free tier —
                fastest and most token-efficient of the current Flash lineup;
                gemini-2.5-flash is deprecated, retiring no earlier than 2026-10-16)
            timeout: Request timeout in seconds for text completions
            vision_timeout: Per-attempt request timeout in seconds for vision
                calls (issue #476). Deliberately shorter than ``timeout`` so a
                single retry still fits inside the Next.js scan client's fixed
                45s abort budget instead of racing it.
            vision_max_retries: Number of retries (beyond the first attempt)
                for vision calls that fail transiently: a network error
                (timeout, connection error) or a Gemini 5xx (overloaded /
                internal error). 4xx responses (auth, malformed request, rate
                limit) are not retried — retrying them can't help.
            vision_retry_backoff: Seconds to wait before a vision retry.
        """
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.vision_timeout = vision_timeout
        self.vision_max_retries = vision_max_retries
        self.vision_retry_backoff = vision_retry_backoff
        self._client = httpx.AsyncClient(timeout=timeout)

    @property
    def name(self) -> str:
        return f"gemini/{self.model}"

    async def complete(
        self,
        prompt: str,
        response_schema: type[T] | None = None,
        temperature: float = 0.7,
    ) -> T | str:
        """Generate completion using Gemini API."""

        # Build the request
        url = f"{self.BASE_URL}/models/{self.model}:generateContent"

        # If we want structured output, add instructions to the prompt
        full_prompt = prompt
        if response_schema:
            schema_json = json.dumps(response_schema.model_json_schema(), indent=2)
            full_prompt = f"""{prompt}

Respond with valid JSON matching this schema:
```json
{schema_json}
```

Return ONLY the JSON, no markdown formatting or extra text."""

        generation_config: dict[str, Any] = {
            "temperature": temperature,
            "topP": 0.95,
            "topK": 40,
        }

        # If structured output, request JSON mime type
        if response_schema:
            generation_config["responseMimeType"] = "application/json"

        payload: dict[str, Any] = {
            "contents": [{"parts": [{"text": full_prompt}]}],
            "generationConfig": generation_config,
        }

        try:
            response = await self._client.post(
                url,
                json=payload,
                params={"key": self.api_key},
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            full_body = e.response.text if hasattr(e.response, "text") else str(e)
            error_body = full_body[:500]
            status = e.response.status_code
            # Classify off the full, untruncated body (issue #514): the
            # QuotaFailure `quotaId` detail this relies on can sit past the
            # 500-char prefix used for the display message below.
            kind = _classify_http_error(status, full_body)
            if status == 429:
                raise ProviderUnavailableError(
                    f"Gemini [{self.model}] rate limit 429: {error_body}",
                    kind=kind,
                    status_code=status,
                ) from e
            raise ProviderUnavailableError(
                f"Gemini [{self.model}] API error {status}: {error_body}",
                kind=kind,
                status_code=status,
            ) from e
        except httpx.RequestError as e:
            request_kind: ProviderFailureKind = (
                "timeout" if isinstance(e, httpx.TimeoutException) else "network"
            )
            raise ProviderUnavailableError(
                f"Gemini [{self.model}] connection error: {type(e).__name__}: {e}",
                kind=request_kind,
            ) from e

        # Parse response
        data = response.json()
        try:
            text = data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError) as e:
            raise StructuredOutputError(f"Unexpected Gemini response format: {data}") from e

        # If no schema, return raw text
        if not response_schema:
            return str(text)

        # Parse structured output
        try:
            # Clean up the response (remove markdown code blocks if present)
            cleaned = text.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[7:]
            if cleaned.startswith("```"):
                cleaned = cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()

            parsed = json.loads(cleaned)
            result: T = response_schema.model_validate(parsed)
            return result
        except json.JSONDecodeError as e:
            raise StructuredOutputError(f"Failed to parse JSON: {text}") from e
        except ValidationError as e:
            raise StructuredOutputError(f"Schema validation failed: {e}") from e

    @property
    def supports_vision(self) -> bool:
        return True

    @property
    def supports_tool_calling(self) -> bool:
        return True

    def _build_gemini_tools(self, tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Translate provider-neutral tool schemas to Gemini functionDeclarations format."""
        declarations = []
        for t in tools:
            declarations.append(
                {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get(
                        "parameters", {"type": "object", "properties": {}}
                    ),
                }
            )
        return [{"functionDeclarations": declarations}]

    def _messages_to_gemini(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Convert provider-neutral messages to Gemini ``contents`` format.

        Provider-neutral roles:
          - "user"        → Gemini role "user", text part.
          - "assistant"   → Gemini role "model"; content may be a list of
                            pre-built Gemini parts (functionCall parts) or a str.
          - "tool_result" → Gemini role "user", functionResponse part.
                            The node stores pre-built Gemini part dicts in ``content``.
        """
        result = []
        for msg in messages:
            role = msg["role"]
            content = msg["content"]
            if role == "tool_result":
                # Pre-built functionResponse part(s) from the ReAct node
                parts = content if isinstance(content, list) else [content]
                result.append({"role": "user", "parts": parts})
            elif role == "assistant" and isinstance(content, list):
                result.append({"role": "model", "parts": content})
            else:
                result.append({"role": "user" if role == "user" else "model",
                                "parts": [{"text": str(content)}]})
        return result

    async def complete_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        temperature: float = 0.7,
    ) -> ToolCallResponse:
        """Run one tool-calling turn against the Gemini generateContent API.

        Args:
            messages:    Provider-neutral running conversation.
            tools:       Registry tool schemas (name, description, parameters).
            temperature: Sampling temperature.

        Returns:
            ToolCallResponse with either tool_calls or final text.
        """
        url = f"{self.BASE_URL}/models/{self.model}:generateContent"
        gemini_tools = self._build_gemini_tools(tools)
        gemini_contents = self._messages_to_gemini(messages)

        generation_config: dict[str, Any] = {
            "temperature": temperature,
            "topP": 0.95,
            "topK": 40,
        }

        payload: dict[str, Any] = {
            "contents": gemini_contents,
            "tools": gemini_tools,
            "generationConfig": generation_config,
        }

        try:
            response = await self._client.post(
                url,
                json=payload,
                params={"key": self.api_key},
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            full_body = e.response.text if hasattr(e.response, "text") else str(e)
            error_body = full_body[:500]
            status = e.response.status_code
            # See `complete()` for why classification uses the full body.
            kind = _classify_http_error(status, full_body)
            if status == 429:
                raise ProviderUnavailableError(
                    f"Gemini [{self.model}] tool-calling rate limit 429: {error_body}",
                    kind=kind,
                    status_code=status,
                ) from e
            raise ProviderUnavailableError(
                f"Gemini [{self.model}] tool-calling API error "
                f"{status}: {error_body}",
                kind=kind,
                status_code=status,
            ) from e
        except httpx.RequestError as e:
            request_kind: ProviderFailureKind = (
                "timeout" if isinstance(e, httpx.TimeoutException) else "network"
            )
            raise ProviderUnavailableError(
                f"Gemini [{self.model}] tool-calling connection error: {type(e).__name__}: {e}",
                kind=request_kind,
            ) from e

        data = response.json()
        try:
            parts: list[dict[str, Any]] = (
                data["candidates"][0]["content"]["parts"]
            )
        except (KeyError, IndexError) as e:
            raise ProviderUnavailableError(
                f"Gemini [{self.model}] unexpected tool-calling response: {data}"
            ) from e

        # Collect function calls (if any)
        tool_calls = []
        text_parts = []
        for part in parts:
            if "functionCall" in part:
                fc = part["functionCall"]
                import uuid
                tool_calls.append(
                    ToolCall(
                        id=str(uuid.uuid4()),
                        name=fc["name"],
                        arguments=fc.get("args", {}),
                    )
                )
            elif "text" in part:
                text_parts.append(part["text"])

        if tool_calls:
            return ToolCallResponse(tool_calls=tool_calls)
        return ToolCallResponse(text=" ".join(text_parts).strip() or None)

    async def vision_complete(
        self,
        prompt: str,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        response_schema: type[T] | None = None,
        temperature: float = 0.3,
        time_remaining: Callable[[], float] | None = None,
    ) -> T | str:
        """Generate a completion from an image + text prompt using Gemini vision."""
        url = f"{self.BASE_URL}/models/{self.model}:generateContent"

        full_prompt = prompt
        if response_schema:
            schema_json = json.dumps(response_schema.model_json_schema(), indent=2)
            full_prompt = f"""{prompt}

Respond with valid JSON matching this schema:
```json
{schema_json}
```

Return ONLY the JSON, no markdown formatting or extra text."""

        generation_config: dict[str, Any] = {
            "temperature": temperature,
            "topP": 0.95,
            "topK": 40,
        }
        if response_schema:
            generation_config["responseMimeType"] = "application/json"

        image_b64 = base64.b64encode(image_bytes).decode("utf-8")

        payload: dict[str, Any] = {
            "contents": [
                {
                    "parts": [
                        {"inline_data": {"mime_type": mime_type, "data": image_b64}},
                        {"text": full_prompt},
                    ]
                }
            ],
            "generationConfig": generation_config,
        }

        # Retry loop (issue #476): network-layer failures (timeout, connection
        # error — httpx.RequestError) and Gemini 5xx responses are transient
        # and worth one more try. 4xx responses (rate limit, auth, bad
        # request) are raised immediately without a retry.
        response: httpx.Response | None = None
        attempts = 1 + self.vision_max_retries
        for attempt in range(attempts):
            # Each attempt is capped at the per-attempt timeout OR what is left
            # of the caller's request budget (issue #481), whichever is smaller.
            attempt_timeout = self.vision_timeout
            if time_remaining is not None:
                left = time_remaining()
                if left <= 0:
                    raise ProviderUnavailableError(
                        f"Gemini [{self.model}] vision skipped: request budget exhausted",
                        kind="timeout",
                    )
                attempt_timeout = min(attempt_timeout, left)
            try:
                response = await self._client.post(
                    url,
                    json=payload,
                    params={"key": self.api_key},
                    timeout=attempt_timeout,
                )
                response.raise_for_status()
                break
            except httpx.HTTPStatusError as e:
                full_body = e.response.text if hasattr(e.response, "text") else str(e)
                error_body = full_body[:500]
                status = e.response.status_code
                if (
                    status in _TRANSIENT_STATUS_CODES
                    and attempt < attempts - 1
                    and self._budget_allows_retry(time_remaining)
                ):
                    logger.warning(
                        f"Gemini [{self.model}] vision attempt {attempt + 1}/{attempts} "
                        f"got HTTP {status}, retrying after {self.vision_retry_backoff}s"
                    )
                    await asyncio.sleep(self.vision_retry_backoff)
                    continue
                # See `complete()` for why classification uses the full body.
                kind = _classify_http_error(status, full_body)
                if status == 429:
                    raise ProviderUnavailableError(
                        f"Gemini [{self.model}] vision rate limit 429: {error_body}",
                        kind=kind,
                        status_code=status,
                    ) from e
                raise ProviderUnavailableError(
                    f"Gemini [{self.model}] vision API error {status}: "
                    f"{error_body}",
                    kind=kind,
                    status_code=status,
                ) from e
            except httpx.RequestError as e:
                if attempt < attempts - 1 and self._budget_allows_retry(time_remaining):
                    logger.warning(
                        f"Gemini [{self.model}] vision attempt {attempt + 1}/{attempts} "
                        f"failed with {type(e).__name__}, retrying after "
                        f"{self.vision_retry_backoff}s"
                    )
                    await asyncio.sleep(self.vision_retry_backoff)
                    continue
                vision_kind: ProviderFailureKind = (
                    "timeout" if isinstance(e, httpx.TimeoutException) else "network"
                )
                raise ProviderUnavailableError(
                    f"Gemini [{self.model}] vision connection error: {type(e).__name__}: {e}",
                    kind=vision_kind,
                ) from e

        assert response is not None  # loop always ends via break or raise

        data = response.json()
        try:
            text = data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError) as e:
            raise StructuredOutputError(f"Unexpected Gemini response format: {data}") from e

        if not response_schema:
            return str(text)

        try:
            cleaned = text.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[7:]
            if cleaned.startswith("```"):
                cleaned = cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()

            parsed = json.loads(cleaned)
            result: T = response_schema.model_validate(parsed)
            return result
        except json.JSONDecodeError as e:
            raise StructuredOutputError(f"Failed to parse JSON: {text}") from e
        except ValidationError as e:
            raise StructuredOutputError(f"Schema validation failed: {e}") from e

    async def stream_complete(
        self,
        prompt: str,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        """Stream tokens using Gemini streamGenerateContent SSE endpoint."""
        url = f"{self.BASE_URL}/models/{self.model}:streamGenerateContent"

        generation_config: dict[str, Any] = {
            "temperature": temperature,
            "topP": 0.95,
            "topK": 40,
        }

        payload: dict[str, Any] = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": generation_config,
        }

        try:
            async with self._client.stream(
                "POST",
                url,
                json=payload,
                params={"key": self.api_key, "alt": "sse"},
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    json_str = line[6:]  # strip 'data: ' prefix
                    if not json_str.strip():
                        continue
                    try:
                        chunk_data = json.loads(json_str)
                        text = chunk_data["candidates"][0]["content"]["parts"][0]["text"]
                        yield text
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                full_body = e.response.text if hasattr(e.response, "text") else str(e)
                error_body = full_body[:500]
                logger.warning(
                    f"Gemini [{self.model}] stream hit 429 rate limit, cascading: "
                    f"{error_body[:200]}"
                )
                # See `complete()` for why classification uses the full body.
                raise ProviderUnavailableError(
                    f"Gemini stream rate limit exceeded: {error_body}",
                    kind=_classify_http_error(429, full_body),
                    status_code=429,
                ) from e
            # Non-429 HTTP errors: fallback to non-streaming on same model
            logger.warning(
                f"Gemini [{self.model}] stream failed "
                f"(status={e.response.status_code}), falling back to non-streaming"
            )
            result = await self.complete(prompt=prompt, temperature=temperature)
            text = result if isinstance(result, str) else str(result)
            yield text
        except httpx.RequestError as e:
            logger.warning(
                f"Gemini [{self.model}] stream connection error, "
                f"falling back to non-streaming: {e}"
            )
            result = await self.complete(prompt=prompt, temperature=temperature)
            text = result if isinstance(result, str) else str(result)
            yield text

    def _budget_allows_retry(self, time_remaining: Callable[[], float] | None) -> bool:
        """True if a vision retry still fits in the caller's budget."""
        if time_remaining is None:
            return True
        left_after_backoff = time_remaining() - self.vision_retry_backoff
        if left_after_backoff < _MIN_VISION_ATTEMPT_SECONDS:
            logger.warning(
                f"Gemini [{self.model}] vision retry skipped: {left_after_backoff:.1f}s of "
                f"request budget would be left, need {_MIN_VISION_ATTEMPT_SECONDS:.0f}s"
            )
            return False
        return True

    async def is_available(self) -> bool:
        """Check if Gemini API is reachable.

        Returns True on 200 and 429 (rate-limited but reachable) so the
        manager lets complete()/stream_complete() run and cascade on
        ProviderUnavailableError instead of silently skipping the provider.
        """
        try:
            url = f"{self.BASE_URL}/models/{self.model}"
            response = await self._client.get(
                url,
                params={"key": self.api_key},
                timeout=_AVAILABILITY_TIMEOUT_SECONDS,
            )
            if response.status_code == 200:
                return True
            if response.status_code == 429:
                # Rate-limited but API key and model are valid — let the
                # caller attempt the request so the manager can cascade.
                logger.info(
                    f"Gemini [{self.model}] availability check got 429 (rate-limited), "
                    "treating as available for cascade"
                )
                return True
            logger.warning(
                f"Gemini [{self.model}] availability check failed "
                f"(status={response.status_code})"
            )
            return False
        except httpx.RequestError as e:
            logger.warning(
                f"Gemini [{self.model}] availability check connection error: {type(e).__name__}: {e}"
            )
            return False

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()
