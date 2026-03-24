# Gemini AI Provider
"""
Google Gemini provider using the free tier API.
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from .provider import AIProvider, ProviderUnavailableError, StructuredOutputError

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


class GeminiProvider(AIProvider):
    """Google Gemini API provider."""

    BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-1.5-flash",
        timeout: float = 60.0,
    ):
        """
        Initialize Gemini provider.

        Args:
            api_key: Google AI API key
            model: Model to use (gemini-1.5-flash recommended for free tier)
            timeout: Request timeout in seconds
        """
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
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
            if e.response.status_code == 429:
                raise ProviderUnavailableError("Gemini rate limit exceeded") from e
            raise ProviderUnavailableError(f"Gemini API error: {e}") from e
        except httpx.RequestError as e:
            raise ProviderUnavailableError(f"Gemini connection error: {e}") from e

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
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            logger.warning(
                "Gemini streaming failed, falling back to non-streaming",
                extra={"error": str(e)},
            )
            # Fallback: use non-streaming complete and yield full response
            result = await self.complete(prompt=prompt, temperature=temperature)
            text = result if isinstance(result, str) else str(result)
            yield text

    async def is_available(self) -> bool:
        """Check if Gemini API is reachable."""
        try:
            url = f"{self.BASE_URL}/models/{self.model}"
            response = await self._client.get(
                url,
                params={"key": self.api_key},
            )
            if response.status_code == 200:
                return True
            logger.warning(
                "Gemini availability check failed",
                extra={"status_code": response.status_code, "model": self.model},
            )
            return False
        except httpx.RequestError as e:
            logger.warning(
                "Gemini availability check failed: connection error",
                extra={"error": str(e)},
            )
            return False

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()
