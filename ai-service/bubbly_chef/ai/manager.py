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


# How much a failure kind tells the user (issue #732, building on #514). Lower
# ranks win when every provider in the cascade failed:
#
#   0  configuration problems that won't fix themselves (quota, key, model)
#   1  busy / rate-limited / bad request: the provider answered, with a reason
#   2  timeout: a request went out and nothing came back in time
#   3  network / unknown: says nothing about *why*; e.g. an Ollama fallback
#      that was never really configured refusing the connection
#
# Ties keep the first kind seen, i.e. the primary provider's.
_KIND_RANK: dict[str, int] = {
    "quota_exhausted": 0,
    "auth": 0,
    "model_not_found": 0,
    "rate_limited": 1,
    "overloaded": 1,
    "bad_request": 1,
    "timeout": 2,
    "network": 3,
    "unknown": 3,
}
_LEAST_INFORMATIVE_RANK = 3

# Failures that are about the *account behind a key*, not about the request
# (#737): the key's spend cap is hit, the key is rejected, or it is being rate
# limited. A second key in its own Google project can plausibly succeed where
# the first one failed for one of these; for anything else (a bad request, a
# timeout, an overloaded model) the second key would fail the same way, so a
# gated fallback provider must not be tried.
ACCOUNT_FAILURE_KINDS: frozenset[str] = frozenset({"quota_exhausted", "auth", "rate_limited"})


def _aggregate_kind(kinds: list[str]) -> str | None:
    """Pick the most meaningful failure kind out of everything tried.

    Providers are tried in registration order (Gemini, then the local Ollama
    fallback), but the *last* failure is rarely the one the user needs to
    hear about: an unreachable fallback says "network" while the primary's
    real reason is "quota_exhausted". Kinds are ranked by ``_KIND_RANK``
    (configuration problems that won't fix themselves above transient ones)
    and the best rank wins regardless of order. Among equal ranks the first
    kind seen wins. Unrecognised kinds rank as least informative. Returns
    ``None`` when nothing failed at all. ``/health/ai``'s
    ``last_failure_kind`` uses the same function, so chat and health agree.
    """
    best: str | None = None
    best_rank = _LEAST_INFORMATIVE_RANK + 1
    for kind in kinds:
        rank = _KIND_RANK.get(kind, _LEAST_INFORMATIVE_RANK)
        if rank < best_rank:
            best, best_rank = kind, rank
    return best


class NoProviderAvailableError(Exception):
    """Raised when no AI providers are available.

    Carries the most *informative* failure-kind classification out of every
    ``ProviderUnavailableError`` that led here (``kind``, via
    ``_aggregate_kind`` — a configuration kind like ``quota_exhausted`` or
    ``auth`` wins over a transient ``timeout`` / ``network`` one whichever
    provider it came from, e.g. an unreachable local Ollama fallback), and
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
        # Non-secret display labels for /health/ai (#737), keyed by provider.
        # A provider with no entry is labelled by its own ``name``.
        self._labels: dict[AIProvider, str] = {}
        # Providers that are only tried once an earlier provider in the same
        # cascade failed with one of these kinds (#737).
        self._only_after_kinds: dict[AIProvider, frozenset[str]] = {}
        self._current_provider: AIProvider | None = None
        # Last provider-level failure seen across complete/vision_complete/
        # complete_with_tools/stream_complete (#514). Cleared on the next
        # success from any of those four methods so /health/ai only ever
        # reports a failure that hasn't since been superseded by a success.
        self._last_failure_kind: str | None = None
        self._last_failure_at: datetime | None = None
        # Generation-probe cache (#576): the last probe result, when it was
        # taken (monotonic clock), and the in-flight probe task that makes a
        # cache miss single-flight so concurrent health hits share one provider call.
        self._probe_result: dict[str, Any] | None = None
        self._probe_taken_at: float | None = None
        self._probe_task: asyncio.Future[dict[str, Any]] | None = None

    def add_provider(
        self,
        provider: AIProvider,
        *,
        label: str | None = None,
        only_after_failure_kinds: frozenset[str] | None = None,
    ) -> None:
        """Add a provider to the list.

        Args:
            provider: The provider, appended after those already registered.
            label: A short, non-secret name shown on ``/health/ai`` (e.g.
                ``gemini-fallback``). Never put a key in it. Defaults to the
                provider's ``name``.
            only_after_failure_kinds: When set, the provider is a gated
                fallback (#737): it is skipped unless an earlier provider in
                the same call failed with one of these kinds, so e.g. a second
                Gemini key is not burned by a ``bad_request``.
        """
        self.providers.append(provider)
        if label is not None:
            self._labels[provider] = label
        if only_after_failure_kinds is not None:
            self._only_after_kinds[provider] = only_after_failure_kinds

    def label_for(self, provider: AIProvider) -> str:
        """The non-secret ``/health/ai`` label for ``provider``."""
        return self._labels.get(provider, provider.name)

    def _gated_out(self, provider: AIProvider, failure_kinds: list[str]) -> bool:
        """True if ``provider`` is a gated fallback whose condition isn't met."""
        allowed = self._only_after_kinds.get(provider)
        if allowed is None:
            return False
        skip = not any(kind in allowed for kind in failure_kinds)
        if skip:
            logger.info(
                f"Skipping fallback provider [{self.label_for(provider)}]: "
                "no earlier quota/auth/rate-limit failure"
            )
        return skip

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
            f"AI provider [{provider.name}] ({self.label_for(provider)}) failed: kind={error.kind} "
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
            if self._gated_out(provider, failure_kinds):
                continue
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
            if not provider.supports_vision or self._gated_out(provider, failure_kinds):
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
            if not provider.supports_tool_calling or self._gated_out(provider, failure_kinds):
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
            if self._gated_out(provider, failure_kinds):
                continue
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
            if self._gated_out(provider, failure_kinds):
                continue
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
                # The provider answered 200 but the capped reply had no text.
                # With a tiny token cap on a thinking model (gemini-3.1-flash-
                # lite) that is plausibly the *usual* success: the cap is spent
                # on thinking tokens, finishReason is MAX_TOKENS and the
                # response carries no parts, which GeminiProvider reports as
                # StructuredOutputError. The request was accepted and billed-
                # as-generation, so the path is alive, which is all the probe
                # asks. Only ProviderUnavailableError (429/auth/5xx/network)
                # means generation is down.
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
            # Deliberately does NOT set `_current_provider`: that property
            # means "the provider that handled the last *user* request" and
            # the chat nodes read it to name the active provider, so a
            # background health probe served by the fallback must not change
            # what chat reports.
            self._clear_failure()
        else:
            failure_kind = self._finalize_failure(failure_kinds)

        return {
            "healthy": served_by is not None,
            "provider": served_by.name if served_by is not None else None,
            # Which registered provider/key served it, by its non-secret label (#737).
            "label": self.label_for(served_by) if served_by is not None else None,
            "fallback": fallback,
            "failure_kind": failure_kind,
            "failures": failures,
            "checked_at": datetime.now().isoformat(),
        }

    def _fresh_probe(
        self, success_ttl_seconds: int, failure_ttl_seconds: int
    ) -> dict[str, Any] | None:
        """The cached probe result if it is still within its TTL, else ``None``.

        A failed probe uses the (shorter) failure TTL so ``/health/ai``
        recovers soon after an outage ends; a failure TTL of 0 re-probes on
        every call. A success uses the success TTL.
        """
        if self._probe_result is None or self._probe_taken_at is None:
            return None
        ttl = success_ttl_seconds if self._probe_result["healthy"] else failure_ttl_seconds
        if _monotonic() - self._probe_taken_at < ttl:
            return self._probe_result
        return None

    async def _probe_and_store(self, max_output_tokens: int) -> dict[str, Any]:
        try:
            try:
                result = await asyncio.wait_for(
                    self._run_generation_probe(max_output_tokens),
                    timeout=_PROBE_TIMEOUT_SECONDS,
                )
            except TimeoutError:
                logger.warning(f"AI generation probe timed out after {_PROBE_TIMEOUT_SECONDS:.0f}s")
                result = {
                    "healthy": False,
                    "provider": None,
                    "label": None,
                    "fallback": False,
                    "failure_kind": self._finalize_failure(["timeout"]),
                    "failures": [],
                    "checked_at": datetime.now().isoformat(),
                }
            self._probe_result = result
            self._probe_taken_at = _monotonic()
            return result
        finally:
            self._probe_task = None

    async def _generation_probe(
        self,
        success_ttl_seconds: int,
        failure_ttl_seconds: int,
        max_output_tokens: int,
    ) -> dict[str, Any]:
        """Return the cached probe result, probing first on a cache miss.

        Single-flight: a miss starts one probe task and every concurrent
        health hit awaits that same task, so N concurrent hits produce one
        provider call — even with a failure TTL of 0, where the *next*
        sequential call probes again but callers already waiting share the
        in-flight one. A failed probe is cached for the failure TTL, a
        successful one for the success TTL (#576).
        """
        cached = self._fresh_probe(success_ttl_seconds, failure_ttl_seconds)
        if cached is not None:
            return {**cached, "cached": True}
        task = self._probe_task
        if task is None:
            task = asyncio.ensure_future(self._probe_and_store(max_output_tokens))
            self._probe_task = task
        # shield: one caller being cancelled must not cancel the shared probe.
        result = await asyncio.shield(task)
        return {**result, "cached": False}

    async def health_check(
        self,
        generation_probe_ttl_seconds: int = 0,
        generation_probe_max_output_tokens: int = 16,
        generation_probe_failure_ttl_seconds: int = 60,
    ) -> dict[str, Any]:
        """
        Check status of all providers.

        ``is_available()`` only proves a provider is reachable with a valid
        key, so a spend-capped Gemini still reads available (#576). With
        ``generation_probe_ttl_seconds > 0`` this also runs a cached, capped,
        single-flight generation probe and ``healthy`` reflects whether a
        generation actually succeeded; a failed probe is cached for the shorter
        ``generation_probe_failure_ttl_seconds`` (0 = re-probe every call). With
        a success TTL of 0 (the default) nothing is
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
                    "label": self.label_for(provider),
                    "available": available,
                }
            )
            if available:
                available_count += 1

        probe: dict[str, Any] | None = None
        healthy = available_count > 0
        if generation_probe_ttl_seconds > 0:
            probe = await self._generation_probe(
                generation_probe_ttl_seconds,
                generation_probe_failure_ttl_seconds,
                generation_probe_max_output_tokens,
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
