# AI Manager
"""
Manages AI provider selection and fallback logic.
"""

from typing import Type, TypeVar
from pydantic import BaseModel

from .provider import AIProvider, ProviderUnavailableError

T = TypeVar("T", bound=BaseModel)


class NoProviderAvailableError(Exception):
    """Raised when no AI providers are available."""
    pass


class AIManager:
    """
    Manages multiple AI providers with automatic fallback.

    Tries providers in order until one succeeds.
    """

    def __init__(self, providers: list[AIProvider] | None = None):
        """
        Initialize AI manager.

        Args:
            providers: List of AI providers in priority order
        """
        self.providers: list[AIProvider] = providers or []
        self._current_provider: AIProvider | None = None

    def add_provider(self, provider: AIProvider) -> None:
        """Add a provider to the list."""
        self.providers.append(provider)

    async def get_available_provider(self) -> AIProvider:
        """Get the first available provider."""
        for provider in self.providers:
            if await provider.is_available():
                return provider
        raise NoProviderAvailableError(
            f"No AI providers available. Tried: {[p.name for p in self.providers]}"
        )

    async def complete(
        self,
        prompt: str,
        response_schema: Type[T] | None = None,
        temperature: float = 0.7,
    ) -> T | str:
        """
        Generate completion using the best available provider.

        Tries each provider in order, falling back on failure.

        Args:
            prompt: The input prompt
            response_schema: Optional Pydantic model for structured output
            temperature: Sampling temperature

        Returns:
            Parsed Pydantic model if schema provided, otherwise raw string

        Raises:
            NoProviderAvailableError: If no providers are available or all fail
        """
        errors = []

        for provider in self.providers:
            try:
                if not await provider.is_available():
                    continue

                result = await provider.complete(
                    prompt=prompt,
                    response_schema=response_schema,
                    temperature=temperature,
                )
                self._current_provider = provider
                return result

            except ProviderUnavailableError as e:
                errors.append(f"{provider.name}: {e}")
                continue

        raise NoProviderAvailableError(
            f"All providers failed. Errors: {errors}"
        )

    @property
    def current_provider(self) -> AIProvider | None:
        """The provider that handled the last successful request."""
        return self._current_provider

    async def health_check(self) -> dict:
        """
        Check status of all providers.

        Returns:
            Dict with provider status information
        """
        status = {
            "providers": [],
            "available_count": 0,
        }

        for provider in self.providers:
            available = await provider.is_available()
            status["providers"].append({
                "name": provider.name,
                "available": available,
            })
            if available:
                status["available_count"] += 1

        status["healthy"] = status["available_count"] > 0
        return status

    async def close(self) -> None:
        """Close all provider connections."""
        for provider in self.providers:
            if hasattr(provider, "close"):
                await provider.close()
