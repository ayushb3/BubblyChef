# Ollama AI Provider (Local)
"""
Ollama provider for self-hosted local LLM inference.
"""

import json
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from .provider import AIProvider, ProviderUnavailableError, StructuredOutputError

T = TypeVar("T", bound=BaseModel)


class OllamaProvider(AIProvider):
    """Ollama local LLM provider."""

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        model: str = "llama3.2:3b",
        timeout: float = 120.0,
    ):
        """
        Initialize Ollama provider.

        Args:
            base_url: Ollama server URL
            model: Model to use
            timeout: Request timeout in seconds (longer for local inference)
        """
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self._client = httpx.AsyncClient(timeout=timeout)

    @property
    def name(self) -> str:
        return f"ollama/{self.model}"

    async def complete(
        self,
        prompt: str,
        response_schema: type[T] | None = None,
        temperature: float = 0.7,
    ) -> T | str:
        """Generate completion using Ollama API."""

        # Build the request
        url = f"{self.base_url}/api/generate"

        # If we want structured output, add instructions
        full_prompt = prompt
        if response_schema:
            schema_json = json.dumps(response_schema.model_json_schema(), indent=2)
            full_prompt = f"""{prompt}

Respond with valid JSON matching this schema:
```json
{schema_json}
```

Return ONLY the JSON, no markdown formatting or extra text."""

        payload = {
            "model": self.model,
            "prompt": full_prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
            },
        }

        # Ollama supports JSON mode with format parameter
        if response_schema:
            payload["format"] = "json"

        try:
            response = await self._client.post(url, json=payload)
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise ProviderUnavailableError(f"Ollama API error: {e}") from e
        except httpx.RequestError as e:
            raise ProviderUnavailableError(f"Ollama connection error: {e}") from e

        # Parse response
        data = response.json()
        text = data.get("response", "")

        if not text:
            raise StructuredOutputError("Empty response from Ollama")

        # If no schema, return raw text
        if not response_schema:
            return str(text)

        # Parse structured output
        try:
            # Clean up the response
            cleaned = text.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[7:]
            if cleaned.startswith("```"):
                cleaned = cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()

            parsed = json.loads(cleaned)
            return response_schema.model_validate(parsed)
        except json.JSONDecodeError as e:
            raise StructuredOutputError(f"Failed to parse JSON: {text}") from e
        except ValidationError as e:
            raise StructuredOutputError(f"Schema validation failed: {e}") from e

    async def is_available(self) -> bool:
        """Check if Ollama server is reachable and model is available."""
        try:
            # Check if server is up
            response = await self._client.get(f"{self.base_url}/api/tags")
            if response.status_code != 200:
                return False

            # Check if our model is available
            data = response.json()
            models = [m.get("name", "") for m in data.get("models", [])]

            # Model names might have :latest suffix
            model_base = self.model.split(":")[0]
            return any(model_base in m for m in models)
        except httpx.RequestError:
            return False

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()
