# AI Provider Abstraction
"""
Provides a unified interface for AI completions across different providers.
Supports structured output generation with Pydantic models.
"""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Callable
from typing import Any, Literal, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


# =============================================================================
# Failure classification (issue #514)
# =============================================================================
#
# What actually went wrong on the provider side, carried alongside
# ProviderUnavailableError / NoProviderAvailableError so callers (chat nodes,
# /health/ai) can tell a quota failure from an auth failure from a plain
# network blip, instead of collapsing everything into one generic message.

ProviderFailureKind = Literal[
    "rate_limited",
    "quota_exhausted",
    "auth",
    "model_not_found",
    "bad_request",
    "overloaded",
    "timeout",
    "network",
    "unknown",
]

# The one case that predates failure-kind classification: no provider is
# configured at all (empty provider list). Never used for a configured
# provider that merely failed — see `user_message_for_failure`.
NOT_CONFIGURED_MESSAGE = "No AI provider is configured. Please add a Gemini API key or start Ollama."

# User-facing copy per failure kind. Kept kawaii-light: no emoji, one or two
# short sentences, never a status code or an internal word like "provider" /
# "API" (the not-configured case is the one exception, and that text is
# unchanged from before this issue). Edit here to change what users see —
# everything else reads from this map.
FAILURE_MESSAGES: dict[str, str] = {
    "quota_exhausted": "Bubbly's AI is over its budget right now. Please try again later.",
    "rate_limited": "The AI is busy, try again in a minute.",
    "overloaded": "The AI is busy, try again in a minute.",
    "auth": (
        "Bubbly's AI can't sign in right now. The team needs to fix its key, "
        "so please try again later."
    ),
    "model_not_found": "Bubbly's AI can't find the model it needs right now. Please try again later.",
    "timeout": "Bubbly's AI is having trouble connecting, try again in a moment.",
    "network": "Bubbly's AI is having trouble connecting, try again in a moment.",
    "bad_request": "Bubbly's AI hit a snag, try again in a moment.",
    "unknown": "Bubbly's AI hit a snag, try again in a moment.",
}


def user_message_for_failure(kind: str | None, configured: bool) -> str:
    """The user-facing message for a given AI failure.

    ``configured=False`` (no provider registered at all) always wins — it is
    the only case allowed to say "No AI provider is configured", per #514.
    Otherwise looks up ``kind`` in ``FAILURE_MESSAGES``, falling back to the
    generic "unknown" copy for an unrecognised or missing kind.
    """
    if not configured:
        return NOT_CONFIGURED_MESSAGE
    return FAILURE_MESSAGES.get(kind or "unknown", FAILURE_MESSAGES["unknown"])


def infer_kind_from_message(message: str) -> ProviderFailureKind:
    """Best-effort fallback classification from raw error text.

    Used only when a caller constructs ``ProviderUnavailableError`` /
    ``NoProviderAvailableError`` without an explicit ``kind`` — production
    raise sites in ``ai/gemini.py`` always pass one, classified from the
    actual HTTP status. This exists so error text that already names the
    problem (e.g. a bubbled-up "429 ... RESOURCE_EXHAUSTED") still gets a
    sensible kind instead of silently defaulting to "unknown".
    """
    text = message.lower()
    if "429" in text:
        if any(term in text for term in ("quota", "billing", "resource_exhausted")):
            return "quota_exhausted"
        return "rate_limited"
    if any(term in text for term in ("401", "403", "unauthenticated", "permission_denied")):
        return "auth"
    if "404" in text:
        return "model_not_found"
    if any(code in text for code in ("500", "502", "503", "504")) or "overload" in text:
        return "overloaded"
    if "400" in text:
        return "bad_request"
    if "timeout" in text:
        return "timeout"
    if "connection" in text or "network" in text:
        return "network"
    return "unknown"


# =============================================================================
# Tool-calling result types
# =============================================================================


class ToolCall(BaseModel):
    """A single tool call requested by the model.

    Attributes:
        id:        Provider-assigned call ID (used to match results back).
        name:      The registered tool name to invoke.
        arguments: Decoded arguments dict — keys match the tool's parameter names.
    """

    id: str
    name: str
    arguments: dict[str, Any]


class ToolCallResponse(BaseModel):
    """Result returned by ``complete_with_tools``.

    Exactly one of ``text`` or ``tool_calls`` will be populated per turn:

    - ``tool_calls`` is non-empty → the model wants to call tools; the caller
      should invoke them, append observations, and call ``complete_with_tools``
      again with the extended message history.
    - ``tool_calls`` is empty / ``text`` is set → the model produced a final
      answer; the ReAct loop should break and return ``text``.
    """

    text: str | None = None
    tool_calls: list[ToolCall] = []


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

        Default: raises NotImplementedError — providers that support vision override this.
        Callers should check supports_vision before calling.

        ``time_remaining``, when given, returns the seconds left in the caller's
        overall budget (issue #481); a provider should not start, or keep
        waiting on, a call past it.
        """
        raise NotImplementedError(f"{self.name} does not support vision")

    @property
    def supports_vision(self) -> bool:
        """Whether this provider supports image input."""
        return False

    @property
    def supports_tool_calling(self) -> bool:
        """Whether this provider supports tool-calling (function calling).

        Defaults to False. Providers that implement ``complete_with_tools``
        should override this to return True.
        """
        return False

    async def complete_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        temperature: float = 0.7,
    ) -> "ToolCallResponse":
        """Run one turn of the tool-calling loop.

        ``messages`` is a running conversation in a provider-neutral format.
        For the first call the list contains a single user message; on
        subsequent iterations the caller appends assistant tool-use turns and
        tool-result turns before calling again.

        Message dict shape (provider-neutral):
            {"role": "user" | "assistant" | "tool_result", "content": str | list}

        Providers translate this to their own wire format internally.

        ``tools`` is the list of tool schemas produced by the registry's
        ``get_tool_schemas()`` — JSON Schema dicts with ``name``, ``description``
        and ``parameters``.

        Returns a ``ToolCallResponse``:
        - If ``tool_calls`` is non-empty, the model wants to call tools.
        - If ``tool_calls`` is empty, ``text`` contains the final answer.

        Default implementation raises NotImplementedError.  Only providers
        where ``supports_tool_calling`` is True should be called here.
        """
        raise NotImplementedError(f"{self.name} does not support tool calling")

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
    """Raised when a provider is not available.

    Carries ``kind`` — what actually went wrong (rate limit, auth, model
    missing, ...) — and the raw HTTP ``status_code`` when there was one, so
    ``AIManager`` can surface the real failure instead of a generic message
    (#514). Raise sites should pass an explicit, correctly-classified
    ``kind``; when omitted it is inferred from ``message`` as a fallback.
    """

    def __init__(
        self,
        message: str,
        kind: ProviderFailureKind | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.kind: ProviderFailureKind = kind if kind is not None else infer_kind_from_message(message)
        self.status_code = status_code


class StructuredOutputError(AIProviderError):
    """Raised when structured output parsing fails."""

    pass
