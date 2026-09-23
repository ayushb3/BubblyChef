# AI Manager
"""
Manages AI provider selection and fallback logic.
"""

import logging
from collections.abc import AsyncIterator, Callable
from datetime import datetime
from typing import Any, TypeVar

from pydantic import BaseModel

from .provider import (
    AIProvider,
    ProviderUnavailableError,
    StructuredOutputError,
    ToolCallResponse,
    infer_kind_from_message,
)

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


def _aggregate_kind(kinds: list[str]) -> str | None:
    """Pick the most informative failure kind out of everything tried.

    Providers are tried in registration order — Gemini first, then Ollama
    as the local fallback (#514). A generic "network" kind (e.g. Ollama
    unreachable at localhost) is the least informative failure there is: it
    says nothing about *why* the request actually failed. A specific kind
    from an earlier provider — quota_exhausted, auth, bad_request — is what
    the user needs to hear, so it must win even if a later provider's
    failure is recorded last. Falls back to the first kind seen (which will
    be "network") only when nothing more specific occurred, and to ``None``
    when nothing failed at all.
    """
    for kind in kinds:
        if kind != "network":
            return kind
    return kinds[0] if kinds else None


class NoProviderAvailableError(Exception):
    """Raised when no AI providers are available.

    Carries the most *informative* failure-kind classification out of every
    ``ProviderUnavailableError`` that led here (``kind``, via
    ``_aggregate_kind`` — a specific kind like ``quota_exhausted`` or
    ``auth`` from an earlier provider wins over a generic ``network`` kind
    from a later one, e.g. an unreachable local Ollama fallback), and
    whether any provider was registered at all (``configured``) — #514.
    ``configured`` is only ``False`` when the manager's provider list is
    empty; a registered-but-failing provider is still "configured".
    """

    def __init__(
        self,
        message: str,
        kind: str | None = None,
        configured: bool = True,
    ) -> None:
        super().__init__(message)
        self.kind: str = kind if kind is not None else infer_kind_from_message(message)
        self.configured = configured


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
        # Last provider-level failure seen across complete/vision_complete/
        # complete_with_tools/stream_complete (#514). Cleared on the next
        # success from any of those four methods so /health/ai only ever
        # reports a failure that hasn't since been superseded by a success.
        self._last_failure_kind: str | None = None
        self._last_failure_at: datetime | None = None

    def add_provider(self, provider: AIProvider) -> None:
        """Add a provider to the list."""
        self.providers.append(provider)

    @property
    def last_failure_kind(self) -> str | None:
        """The ``kind`` of the most recent provider failure, if any."""
        return self._last_failure_kind

    @property
    def last_failure_at(self) -> datetime | None:
        """When the most recent provider failure was recorded, if any."""
        return self._last_failure_at

    def _record_failure(self, provider: AIProvider, error: ProviderUnavailableError) -> str:
        """Record a provider failure and return the formatted string for the
        method's ``errors`` list.

        Sets ``_last_failure_kind`` / ``_last_failure_at`` and logs once at
        WARNING with the failure's ``kind`` and ``status_code`` — the single
        log site for a provider failure across all four call methods
        (replaces each method's own, previously inconsistent, logging).
        """
        self._last_failure_kind = error.kind
        self._last_failure_at = datetime.now()
        logger.warning(
            f"AI provider [{provider.name}] failed: kind={error.kind} "
            f"status_code={error.status_code}: {error}"
        )
        return f"{provider.name}: {error}"

    def _clear_failure(self) -> None:
        """Clear the last-recorded failure after a success."""
        self._last_failure_kind = None
        self._last_failure_at = None

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
        failure_kinds: list[str] = []
        start_time = datetime.now()
        max_structured_retries = 2

        for provider in self.providers:
            try:
                # Deliberately no `is_available()` pre-check here (#514): a
                # cheap probe request only proves reachability at that
                # instant, and skipping the real call on its say-so throws
                # away the classified `ProviderUnavailableError` the actual
                # request would have raised (auth/model/bad-request/etc.),
                # collapsing every such failure into a generic "not
                # available" string with no kind. Attempt the real call and
                # let it classify its own failure.
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
                        self._clear_failure()

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
                errors.append(self._record_failure(provider, e))
                failure_kinds.append(e.kind)
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
        raise NoProviderAvailableError(
            f"All providers failed. Errors: {errors}",
            kind=_aggregate_kind(failure_kinds),
            configured=bool(self.providers),
        )

    async def vision_complete(
        self,
        prompt: str,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        response_schema: type[T] | None = None,
        temperature: float = 0.3,
        time_remaining: Callable[[], float] | None = None,
    ) -> T | str:
        """
        Generate a completion from an image + text prompt.

        Tries vision-capable providers in order, falls back gracefully.

        Raises:
            NoProviderAvailableError: If no vision-capable provider is available.
        """
        errors: list[str] = []
        failure_kinds: list[str] = []
        start_time = datetime.now()

        for provider in self.providers:
            if not provider.supports_vision:
                continue
            try:
                # See `complete()` for why there's no `is_available()`
                # pre-check gating this call (#514).
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
                    time_remaining=time_remaining,
                )
                self._current_provider = provider
                self._clear_failure()

                elapsed = (datetime.now() - start_time).total_seconds()
                logger.info(
                    f"AI vision request completed on [{provider.name}] in {elapsed:.2f}s"
                )
                return result

            except ProviderUnavailableError as e:
                errors.append(self._record_failure(provider, e))
                failure_kinds.append(e.kind)
                continue
            except Exception as e:
                logger.error(
                    f"AI vision [{provider.name}] unexpected error: {e}",
                    exc_info=True,
                )
                errors.append(f"{provider.name}: {e}")
                continue

        raise NoProviderAvailableError(
            f"No vision-capable provider available. Errors: {errors}",
            kind=_aggregate_kind(failure_kinds),
            configured=bool(self.providers),
        )

    async def complete_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        temperature: float = 0.7,
    ) -> ToolCallResponse:
        """Run one tool-calling turn using the first capable provider.

        Mirrors ``vision_complete``: iterates providers, skips those where
        ``supports_tool_calling`` is False, calls the first available capable
        one, cascades on ProviderUnavailableError.

        Args:
            messages: Running conversation in provider-neutral format.
            tools:    Tool schemas from the registry (name, description, parameters).
            temperature: Sampling temperature.

        Returns:
            ToolCallResponse — either tool calls to execute or a final text answer.

        Raises:
            NoProviderAvailableError: If no tool-calling-capable provider is available.
        """
        errors: list[str] = []
        failure_kinds: list[str] = []
        start_time = datetime.now()

        for provider in self.providers:
            if not provider.supports_tool_calling:
                continue
            try:
                # See `complete()` for why there's no `is_available()`
                # pre-check gating this call (#514).
                logger.info(
                    f"AI tool-calling request starting on [{provider.name}] "
                    f"(messages={len(messages)}, tools={len(tools)})"
                )

                result = await provider.complete_with_tools(
                    messages=messages,
                    tools=tools,
                    temperature=temperature,
                )
                self._current_provider = provider
                self._clear_failure()

                elapsed = (datetime.now() - start_time).total_seconds()
                logger.info(
                    f"AI tool-calling completed on [{provider.name}] in {elapsed:.2f}s "
                    f"(tool_calls={len(result.tool_calls)}, has_text={result.text is not None})"
                )
                return result

            except ProviderUnavailableError as e:
                errors.append(self._record_failure(provider, e))
                failure_kinds.append(e.kind)
                continue
            except Exception as e:
                logger.error(
                    f"AI tool-calling [{provider.name}] unexpected error: {e}",
                    exc_info=True,
                )
                errors.append(f"{provider.name}: {e}")
                continue

        raise NoProviderAvailableError(
            f"No tool-calling-capable provider available. Errors: {errors}",
            kind=_aggregate_kind(failure_kinds),
            configured=bool(self.providers),
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
        failure_kinds: list[str] = []

        for provider in self.providers:
            try:
                # See `complete()` for why there's no `is_available()`
                # pre-check gating this call (#514).
                logger.info(
                    f"AI stream starting on [{provider.name}] (prompt_len={len(prompt)})"
                )

                async for token in provider.stream_complete(
                    prompt=prompt, temperature=temperature
                ):
                    yield token
                self._clear_failure()
                return

            except ProviderUnavailableError as e:
                errors.append(self._record_failure(provider, e))
                failure_kinds.append(e.kind)
                continue
            except Exception as e:
                logger.warning(
                    f"AI stream [{provider.name}] failed: {type(e).__name__}: {e} "
                    "— trying next provider"
                )
                errors.append(f"{provider.name}: {e}")
                continue

        raise NoProviderAvailableError(
            f"All providers failed for streaming. Errors: {errors}",
            kind=_aggregate_kind(failure_kinds),
            configured=bool(self.providers),
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
            "last_failure_kind": self._last_failure_kind,
            "last_failure_at": (
                self._last_failure_at.isoformat() if self._last_failure_at is not None else None
            ),
        }

    async def close(self) -> None:
        """Close all provider connections."""
        for provider in self.providers:
            if hasattr(provider, "close"):
                await provider.close()
