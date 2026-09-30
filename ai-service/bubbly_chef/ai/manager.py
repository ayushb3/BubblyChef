# AI Manager
"""
Manages AI provider selection and fallback logic.
"""

import asyncio
import logging
import time
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

# Indirection so tests can drive the probe cache's clock.
_monotonic = time.monotonic

# /health/ai generation probe (#576): one tiny prompt, and a wall-clock bound
# on the whole cascade so a hung provider can't hold the single-flight lock
# (and every waiting health hit) for a provider's full ~60s request timeout.
_PROBE_PROMPT = "Reply with the single word: ok"
_PROBE_TIMEOUT_SECONDS = 20.0


# Kinds that say nothing about *why* a call failed (#514).
_GENERIC_KINDS = frozenset({"network", "unknown"})


def _aggregate_kind(kinds: list[str]) -> str | None:
    """Pick the most informative failure kind out of everything tried.

    Providers are tried in registration order — Gemini first, then Ollama
    as the local fallback (#514). A generic "network" kind (e.g. Ollama
    unreachable at localhost) is the least informative failure there is: it
    says nothing about *why* the request actually failed. A specific kind
    from an earlier provider — quota_exhausted, auth, bad_request — is what
    the user needs to hear, so it must win even if a later provider's
    failure is recorded last. "unknown" is just as uninformative: it must
    not outrank a specific kind from a later provider either. Falls back to
    the first kind seen (network or unknown) only when nothing more specific
    occurred, and to ``None`` when nothing failed at all.
    """
    for kind in kinds:
        if kind not in _GENERIC_KINDS:
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
        # Generation-probe cache (#576): the last probe result, when it was
        # taken (monotonic clock), and the lock that makes a cache miss
        # single-flight so concurrent health hits share one provider call.
        self._probe_result: dict[str, Any] | None = None
        self._probe_taken_at: float | None = None
        self._probe_lock = asyncio.Lock()

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
        """Log a provider failure and return the formatted string for the
        method's ``errors`` list.

        Does *not* set ``_last_failure_kind`` / ``_last_failure_at`` itself —
        with Gemini tried before Ollama (see ``ollama_base_url`` default in
        config.py), setting it here unconditionally would let a later,
        generic Ollama "network" failure overwrite an earlier, more
        informative Gemini kind (quota_exhausted/auth/etc.) once the whole
        cascade finishes. ``_finalize_failure`` sets the aggregated kind once
        the cascade for the call is done, the same way ``NoProviderAvailableError.kind``
        is computed (#514). This is the single log site for a provider
        failure across all four call methods (replaces each method's own,
        previously inconsistent, logging).
        """
        logger.warning(
            f"AI provider [{provider.name}] failed: kind={error.kind} "
            f"status_code={error.status_code}: {error}"
        )
        return f"{provider.name}: {error}"

    def _finalize_failure(self, failure_kinds: list[str]) -> str | None:
        """Record the most informative kind out of a completed cascade.

        Called once, after every provider in the cascade has been tried and
        none succeeded — mirrors how ``NoProviderAvailableError.kind`` is
        computed via ``_aggregate_kind`` so ``/health/ai`` reports the same
        kind the raised error carries, instead of whichever provider merely
        failed last (#514). Returns the aggregated kind for reuse when
        raising ``NoProviderAvailableError``.
        """
        aggregated = _aggregate_kind(failure_kinds)
        if aggregated is not None:
            self._last_failure_kind = aggregated
            self._last_failure_at = datetime.now()
        return aggregated

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
            kind=self._finalize_failure(failure_kinds),
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
            kind=self._finalize_failure(failure_kinds),
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
            kind=self._finalize_failure(failure_kinds),
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
            kind=self._finalize_failure(failure_kinds),
            configured=bool(self.providers),
        )

    @property
    def current_provider(self) -> AIProvider | None:
        """The provider that handled the last successful request."""
        return self._current_provider

    async def _run_generation_probe(self, max_output_tokens: int) -> dict[str, Any]:
        """Run one tiny capped generation down the provider cascade (#576).

        Same order and fallback semantics as ``complete()``: the first
        provider that generates wins, and a failure is recorded with its
        classified kind. Reports which provider served the probe and whether
        that was a fallback (anything but the first registered provider), so
        "healthy" on Ollama while Gemini is spend-capped reads as exactly that.
        """
        failures: list[dict[str, str]] = []
        failure_kinds: list[str] = []
        served_by: AIProvider | None = None
        fallback = False

        for index, provider in enumerate(self.providers):
            try:
                await provider.complete(
                    prompt=_PROBE_PROMPT,
                    temperature=0.0,
                    max_output_tokens=max_output_tokens,
                )
            except ProviderUnavailableError as e:
                self._record_failure(provider, e)
                failures.append({"provider": provider.name, "kind": e.kind})
                failure_kinds.append(e.kind)
                continue
            except StructuredOutputError:
                # The provider answered 200 but the capped reply had no text
                # (e.g. the token cap was spent before any output). The
                # generation path itself is alive, which is all the probe asks.
                pass
            except Exception as e:
                logger.error(
                    f"AI probe [{provider.name}] unexpected {type(e).__name__}: {e}",
                    exc_info=True,
                )
                failures.append({"provider": provider.name, "kind": "unknown"})
                failure_kinds.append("unknown")
                continue
            served_by = provider
            fallback = index > 0
            break

        failure_kind: str | None = None
        if served_by is not None:
            self._current_provider = served_by
            self._clear_failure()
        else:
            failure_kind = self._finalize_failure(failure_kinds)

        return {
            "healthy": served_by is not None,
            "provider": served_by.name if served_by is not None else None,
            "fallback": fallback,
            "failure_kind": failure_kind,
            "failures": failures,
            "checked_at": datetime.now().isoformat(),
        }

    def _probe_fresh(self, ttl_seconds: int) -> bool:
        return (
            self._probe_result is not None
            and self._probe_taken_at is not None
            and _monotonic() - self._probe_taken_at < ttl_seconds
        )

    async def _generation_probe(self, ttl_seconds: int, max_output_tokens: int) -> dict[str, Any]:
        """Return the cached probe result, probing first on a cache miss.

        Single-flight: the cache is re-checked after taking the lock, so N
        concurrent health hits on a miss produce one probe and N-1 cache hits.
        A failed probe is cached for the same TTL as a successful one — a
        down provider must not be re-probed on every health hit either.
        """
        if not self._probe_fresh(ttl_seconds):
            async with self._probe_lock:
                if not self._probe_fresh(ttl_seconds):
                    try:
                        result = await asyncio.wait_for(
                            self._run_generation_probe(max_output_tokens),
                            timeout=_PROBE_TIMEOUT_SECONDS,
                        )
                    except TimeoutError:
                        logger.warning(
                            f"AI generation probe timed out after {_PROBE_TIMEOUT_SECONDS:.0f}s"
                        )
                        result = {
                            "healthy": False,
                            "provider": None,
                            "fallback": False,
                            "failure_kind": self._finalize_failure(["timeout"]),
                            "failures": [],
                            "checked_at": datetime.now().isoformat(),
                        }
                    self._probe_result = result
                    self._probe_taken_at = _monotonic()
                    return {**result, "cached": False}
        assert self._probe_result is not None
        return {**self._probe_result, "cached": True}

    async def health_check(
        self,
        generation_probe_ttl_seconds: int = 0,
        generation_probe_max_output_tokens: int = 4,
    ) -> dict[str, Any]:
        """
        Check status of all providers.

        ``is_available()`` only proves a provider is reachable with a valid
        key, so a spend-capped Gemini still reads available (#576). With
        ``generation_probe_ttl_seconds > 0`` this also runs a cached, capped,
        single-flight generation probe and ``healthy`` reflects whether a
        generation actually succeeded. With 0 (the default) nothing is
        generated and ``healthy`` is the reachability-only answer, unchanged.

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

        probe: dict[str, Any] | None = None
        healthy = available_count > 0
        if generation_probe_ttl_seconds > 0:
            probe = await self._generation_probe(
                generation_probe_ttl_seconds, generation_probe_max_output_tokens
            )
            healthy = bool(probe["healthy"])

        return {
            "providers": providers_list,
            "available_count": available_count,
            "healthy": healthy,
            "generation_probe": probe,
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
