# AI Manager
"""
Manages AI provider selection and fallback logic.
"""

import logging
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any, TypeVar

from pydantic import BaseModel

from .provider import AIProvider, ProviderUnavailableError, StructuredOutputError

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
        response_schema: type[T] | None = None,
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
        max_structured_retries = 2

        for provider in self.providers:
            try:
                if not await provider.is_available():
                    logger.warning(
                        f"AI provider [{provider.name}] not available, skipping"
                    )
                    errors.append(
                        f"{provider.name}: not available (check credentials/model/connection)"
                    )
                    continue

                logger.info(
                    f"AI request starting on [{provider.name}] "
                    f"(prompt_len={len(prompt)}, schema={response_schema is not None})"
                )

                current_prompt = prompt
                last_structured_error: StructuredOutputError | None = None
                total_attempts = 1 + (max_structured_retries if response_schema else 0)

                for attempt in range(total_attempts):
                    try:
                        result = await provider.complete(
                            prompt=current_prompt,
                            response_schema=response_schema,
                            temperature=temperature,
                        )
                        self._current_provider = provider

                        elapsed = (datetime.now() - start_time).total_seconds()
                        logger.info(
                            f"AI request completed on [{provider.name}] "
                            f"in {elapsed:.2f}s → {type(result).__name__}"
                        )

                        return result

                    except StructuredOutputError as e:
                        last_structured_error = e
                        if attempt < max_structured_retries and response_schema is not None:
                            logger.warning(
                                f"[{provider.name}] structured output validation failed "
                                f"(attempt {attempt + 1}): {e}"
                            )
                            current_prompt = (
                                prompt
                                + "\n\n[RETRY: Your previous response had a validation"
                                f" error: {e}. "
                                "Please fix and return valid JSON matching the schema.]"
                            )
                            continue
                        raise

                if last_structured_error:
                    raise last_structured_error

            except ProviderUnavailableError as e:
                elapsed = (datetime.now() - start_time).total_seconds()
                logger.warning(
                    f"AI provider [{provider.name}] failed after {elapsed:.2f}s: {e} "
                    "— trying next"
                )
                errors.append(f"{provider.name}: {e}")
                continue
            except Exception as e:
                elapsed = (datetime.now() - start_time).total_seconds()
                logger.error(
                    f"AI provider [{provider.name}] unexpected {type(e).__name__} "
                    f"after {elapsed:.2f}s: {e}",
                    exc_info=True,
                )
                errors.append(f"{provider.name}: {e}")
                continue

        elapsed = (datetime.now() - start_time).total_seconds()
        logger.error(
            f"All AI providers failed after {elapsed:.2f}s: {errors}"
        )
        raise NoProviderAvailableError(f"All providers failed. Errors: {errors}")

    async def vision_complete(
        self,
        prompt: str,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        response_schema: type[T] | None = None,
        temperature: float = 0.3,
    ) -> T | str:
        """
        Generate a completion from an image + text prompt.

        Tries vision-capable providers in order, falls back gracefully.

        Raises:
            NoProviderAvailableError: If no vision-capable provider is available.
        """
        errors: list[str] = []
        start_time = datetime.now()

        for provider in self.providers:
            if not provider.supports_vision:
                continue
            try:
                if not await provider.is_available():
                    errors.append(f"{provider.name}: not available")
                    continue

                logger.info(
                    f"AI vision request starting on [{provider.name}] "
                    f"(image_bytes={len(image_bytes)}, schema={response_schema is not None})"
                )

                result = await provider.vision_complete(
                    prompt=prompt,
                    image_bytes=image_bytes,
                    mime_type=mime_type,
                    response_schema=response_schema,
                    temperature=temperature,
                )
                self._current_provider = provider

                elapsed = (datetime.now() - start_time).total_seconds()
                logger.info(
                    f"AI vision request completed on [{provider.name}] in {elapsed:.2f}s"
                )
                return result

            except ProviderUnavailableError as e:
                errors.append(f"{provider.name}: {e}")
                continue
            except Exception as e:
                logger.error(
                    f"AI vision [{provider.name}] unexpected error: {e}",
                    exc_info=True,
                )
                errors.append(f"{provider.name}: {e}")
                continue

        raise NoProviderAvailableError(
            f"No vision-capable provider available. Errors: {errors}"
        )

    async def stream_complete(
        self,
        prompt: str,
        temperature: float = 0.7,
    ) -> AsyncIterator[str]:
        """
        Stream text tokens using the best available provider.

        Tries each provider in order, falling back on failure.
        """
        errors: list[str] = []

        for provider in self.providers:
            try:
                if not await provider.is_available():
                    errors.append(f"{provider.name}: not available")
                    continue

                logger.info(
                    f"AI stream starting on [{provider.name}] (prompt_len={len(prompt)})"
                )

                async for token in provider.stream_complete(
                    prompt=prompt, temperature=temperature
                ):
                    yield token
                return

            except Exception as e:
                logger.warning(
                    f"AI stream [{provider.name}] failed: {type(e).__name__}: {e} "
                    "— trying next provider"
                )
                errors.append(f"{provider.name}: {e}")
                continue

        raise NoProviderAvailableError(
            f"All providers failed for streaming. Errors: {errors}"
        )

    @property
    def current_provider(self) -> AIProvider | None:
        """The provider that handled the last successful request."""
        return self._current_provider

    async def health_check(self) -> dict[str, Any]:
        """
        Check status of all providers.

        Returns:
            Dict with provider status information
        """
        providers_list: list[dict[str, Any]] = []
        available_count = 0

        for provider in self.providers:
            available = await provider.is_available()
            providers_list.append(
                {
                    "name": provider.name,
                    "available": available,
                }
            )
            if available:
                available_count += 1

        return {
            "providers": providers_list,
            "available_count": available_count,
            "healthy": available_count > 0,
        }

    async def close(self) -> None:
        """Close all provider connections."""
        for provider in self.providers:
            if hasattr(provider, "close"):
                await provider.close()
