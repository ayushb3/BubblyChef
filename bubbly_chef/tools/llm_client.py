"""LLM client abstraction with Ollama implementation."""

import json
import logging
from abc import ABC, abstractmethod
from typing import TypeVar

import httpx
from pydantic import BaseModel
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from bubbly_chef.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# Task identifiers for task-specific mocking
TASK_CLASSIFY_INTENT = "classify_intent"
TASK_PARSE_PANTRY_ITEMS = "parse_pantry_items"
TASK_GENERAL_CHAT = "general_chat"
TASK_PARSE_RECIPE = "parse_recipe"


class LLMError(Exception):
    """Base exception for LLM-related errors."""

    pass


class LLMTimeoutError(LLMError):
    """LLM request timed out."""

    pass


class LLMConnectionError(LLMError):
    """Could not connect to LLM service."""

    pass


class LLMParseError(LLMError):
    """Could not parse LLM response."""

    pass


class LLMClient(ABC):
    """Abstract base class for LLM clients."""

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        system_prompt: str | None = None,
        temperature: float = 0.1,
    ) -> str:
        """Generate text from the LLM."""
        pass

    @abstractmethod
    async def generate_structured(
        self,
        prompt: str,
        response_model: type[T],
        system_prompt: str | None = None,
        temperature: float = 0.1,
    ) -> tuple[T | None, str | None]:
        """
        Generate structured output from the LLM.

        Returns:
            Tuple of (parsed_model, error_message)
            If successful, error_message is None.
            If failed, parsed_model is None and error_message contains details.
        """
        pass

    @abstractmethod
    async def is_available(self) -> bool:
        """Check if the LLM service is available."""
        pass


class OllamaClient(LLMClient):
    """Ollama LLM client implementation with circuit breaker."""

    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float | None = None,
        max_retries: int | None = None,
    ):
        self.base_url = base_url or settings.ollama_base_url
        self.model = model or settings.ollama_model
        self.timeout = timeout or settings.ollama_timeout_seconds
        self.max_retries = max_retries or settings.ollama_max_retries
        self._client: httpx.AsyncClient | None = None

        # Circuit breaker state
        self._consecutive_failures = 0
        self._circuit_open = False
        self._circuit_threshold = 5

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=httpx.Timeout(self.timeout),
            )
        return self._client

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    def _check_circuit(self) -> None:
        """Check if circuit breaker is open."""
        if self._circuit_open:
            raise LLMConnectionError(
                f"Circuit breaker open after {self._circuit_threshold} consecutive failures. "
                "LLM service may be unavailable."
            )

    def _record_success(self) -> None:
        """Record a successful call, reset circuit breaker."""
        self._consecutive_failures = 0
        self._circuit_open = False

    def _record_failure(self) -> None:
        """Record a failed call, potentially open circuit breaker."""
        self._consecutive_failures += 1
        if self._consecutive_failures >= self._circuit_threshold:
            self._circuit_open = True
            logger.warning(f"Circuit breaker opened after {self._consecutive_failures} failures")

    def reset_circuit(self) -> None:
        """Manually reset the circuit breaker."""
        self._consecutive_failures = 0
        self._circuit_open = False

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.ConnectError)),
    )
    async def generate(
        self,
        prompt: str,
        system_prompt: str | None = None,
        temperature: float = 0.1,
    ) -> str:
        """Generate text using Ollama."""
        self._check_circuit()

        client = await self._get_client()

        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
            },
        }

        if system_prompt:
            payload["system"] = system_prompt

        try:
            response = await client.post("/api/generate", json=payload)
            response.raise_for_status()

            result = response.json()
            self._record_success()
            return result.get("response", "")

        except httpx.TimeoutException as e:
            self._record_failure()
            raise LLMTimeoutError(f"Ollama request timed out: {e}") from e
        except httpx.ConnectError as e:
            self._record_failure()
            raise LLMConnectionError(f"Could not connect to Ollama: {e}") from e
        except httpx.HTTPStatusError as e:
            self._record_failure()
            raise LLMError(f"Ollama returned error: {e.response.status_code}") from e

    async def generate_structured(
        self,
        prompt: str,
        response_model: type[T],
        system_prompt: str | None = None,
        temperature: float = 0.1,
    ) -> tuple[T | None, str | None]:
        """
        Generate structured output using Ollama's JSON mode.

        Uses format="json" for strict JSON output, then validates with Pydantic.
        """
        # Build a system prompt that emphasizes JSON output
        json_schema = response_model.model_json_schema()
        schema_str = json.dumps(json_schema, indent=2)

        structured_system = f"""You are a helpful assistant that ALWAYS responds with valid JSON.
Your response must be a valid JSON object that matches this schema:

{schema_str}

{system_prompt or ""}

IMPORTANT:
- Output ONLY valid JSON, no other text
- Do not include markdown code blocks
- Ensure all required fields are present
- Use appropriate types (strings, numbers, arrays)"""

        self._check_circuit()
        client = await self._get_client()

        payload = {
            "model": self.model,
            "prompt": prompt,
            "system": structured_system,
            "stream": False,
            "format": "json",  # Ollama JSON mode
            "options": {
                "temperature": temperature,
            },
        }

        try:
            response = await client.post("/api/generate", json=payload)
            response.raise_for_status()

            result = response.json()
            raw_response = result.get("response", "")
            self._record_success()

            # Try to parse as JSON
            try:
                parsed_json = json.loads(raw_response)
            except json.JSONDecodeError as e:
                return None, f"Invalid JSON from LLM: {e}"

            # Validate with Pydantic
            try:
                model_instance = response_model.model_validate(parsed_json)
                return model_instance, None
            except Exception as e:
                return None, f"JSON does not match schema: {e}"

        except httpx.TimeoutException as e:
            self._record_failure()
            return None, f"LLM timeout: {e}"
        except httpx.ConnectError as e:
            self._record_failure()
            return None, f"Cannot connect to LLM: {e}"
        except httpx.HTTPStatusError as e:
            self._record_failure()
            return None, f"LLM error: {e.response.status_code}"

    async def is_available(self) -> bool:
        """Check if Ollama is running and the model is available."""
        try:
            client = await self._get_client()
            response = await client.get("/api/tags")
            if response.status_code != 200:
                return False

            data = response.json()
            models = [m.get("name", "") for m in data.get("models", [])]

            # Check if our model is available (handle version tags)
            model_base = self.model.split(":")[0]
            return any(model_base in m for m in models)

        except Exception as e:
            logger.warning(f"Ollama availability check failed: {e}")
            return False

    # =========================================================================
    # Task-specific methods for easier testing/mocking
    # =========================================================================

    async def classify_intent(
        self,
        prompt: str,
        response_model: type[T],
        system_prompt: str | None = None,
        temperature: float = 0.1,
    ) -> tuple[T | None, str | None]:
        """
        Classify user intent using the LLM.

        This is a thin wrapper around generate_structured with a task identifier
        to allow task-specific mocking in tests.
        """
        return await self.generate_structured(
            prompt=prompt,
            response_model=response_model,
            system_prompt=system_prompt,
            temperature=temperature,
        )

    async def parse_pantry_items(
        self,
        prompt: str,
        response_model: type[T],
        system_prompt: str | None = None,
        temperature: float = 0.1,
    ) -> tuple[T | None, str | None]:
        """
        Parse pantry items from text using the LLM.

        This is a thin wrapper around generate_structured with a task identifier
        to allow task-specific mocking in tests.
        """
        return await self.generate_structured(
            prompt=prompt,
            response_model=response_model,
            system_prompt=system_prompt,
            temperature=temperature,
        )

    async def generate_chat_response(
        self,
        prompt: str,
        response_model: type[T],
        system_prompt: str | None = None,
        temperature: float = 0.7,
    ) -> tuple[T | None, str | None]:
        """
        Generate a general chat response using the LLM.

        This is a thin wrapper around generate_structured with a task identifier
        to allow task-specific mocking in tests.
        """
        return await self.generate_structured(
            prompt=prompt,
            response_model=response_model,
            system_prompt=system_prompt,
            temperature=temperature,
        )


# Singleton instance
_ollama_client: OllamaClient | None = None


def get_ollama_client() -> OllamaClient:
    """Get the singleton Ollama client."""
    global _ollama_client
    if _ollama_client is None:
        _ollama_client = OllamaClient()
    return _ollama_client
