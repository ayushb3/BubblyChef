# AI Provider Abstraction
"""
Provides a unified interface for AI completions across different providers.
Supports structured output generation with Pydantic models.
"""

from abc import ABC, abstractmethod
from typing import TypeVar, Type, Any
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
        response_schema: Type[T] | None = None,
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
