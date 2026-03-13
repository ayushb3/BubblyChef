# AI Manager
"""
Manages AI provider selection and fallback logic.
"""

import logging
from datetime import datetime
from typing import Type, TypeVar
from pydantic import BaseModel

from .provider import AIProvider, ProviderUnavailableError

logger = logging.getLogger(__name__)

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
        start_time = datetime.now()

        for provider in self.providers:
            try:
                if not await provider.is_available():
                    logger.debug(f"Provider {provider.name} not available, skipping")
                    continue

                logger.info(
                    "AI request starting",
                    extra={
                        "provider": provider.name,
                        "prompt_length": len(prompt),
                        "has_schema": response_schema is not None,
                        "temperature": temperature,
                    }
                )

                result = await provider.complete(
                    prompt=prompt,
                    response_schema=response_schema,
                    temperature=temperature,
                )
                self._current_provider = provider

                elapsed = (datetime.now() - start_time).total_seconds()
                logger.info(
                    "AI request completed",
                    extra={
                        "provider": provider.name,
                        "elapsed_seconds": elapsed,
                        "response_type": type(result).__name__,
                    }
                )

                return result

            except ProviderUnavailableError as e:
                elapsed = (datetime.now() - start_time).total_seconds()
                logger.warning(
                    "AI provider failed, trying next",
                    extra={
                        "provider": provider.name,
                        "error": str(e),
                        "elapsed_seconds": elapsed,
                    }
                )
                errors.append(f"{provider.name}: {e}")
                continue
            except Exception as e:
                elapsed = (datetime.now() - start_time).total_seconds()
                logger.error(
                    "AI request failed with unexpected error",
                    extra={
                        "provider": provider.name,
                        "error": str(e),
                        "error_type": type(e).__name__,
                        "elapsed_seconds": elapsed,
                    },
                    exc_info=True
                )
                errors.append(f"{provider.name}: {e}")
                continue

        elapsed = (datetime.now() - start_time).total_seconds()
        logger.error(
            "All AI providers failed",
            extra={
                "elapsed_seconds": elapsed,
                "errors": errors,
            }
        )
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
