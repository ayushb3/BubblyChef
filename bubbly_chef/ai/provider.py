# AI Provider Abstraction
"""
Provides a unified interface for AI completions across different providers.
Supports structured output generation with Pydantic models.
"""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class AIProvider(ABC):
    """Base class for AI providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name for logging/debugging."""
        ...

    @abstractmethod
    async def complete(
        self,
        prompt: str,
        response_schema: type[T] | None = None,
        temperature: float = 0.7,
    ) -> T | str:
        """
        Generate a completion.

        Args:
            prompt: The input prompt
            response_schema: Optional Pydantic model for structured output
            temperature: Sampling temperature (0.0 - 1.0)

        Returns:
            Parsed Pydantic model if schema provided, otherwise raw string
        """
        ...

    async def stream_complete(
        self,
        prompt: str,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        """
        Stream text tokens. No structured output — streaming is only for free-text.

        Default implementation: calls complete() and yields the full response as one chunk.
        Providers can override this with true streaming support.
        """
        result = await self.complete(prompt=prompt, temperature=temperature)
        text = result if isinstance(result, str) else str(result)
        yield text

    @abstractmethod
    async def is_available(self) -> bool:
        """Check if the provider is currently available."""
        ...


class AIProviderError(Exception):
    """Base exception for AI provider errors."""

    pass


class ProviderUnavailableError(AIProviderError):
    """Raised when a provider is not available."""

    pass


class StructuredOutputError(AIProviderError):
    """Raised when structured output parsing fails."""

    pass
