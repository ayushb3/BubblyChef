# AI Provider Abstraction
"""
Provides a unified interface for AI completions across different providers.
Supports structured output generation with Pydantic models.
"""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import Any, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


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
    ) -> T | str:
        """
        Generate a completion from an image + text prompt.

        Default: raises NotImplementedError — providers that support vision override this.
        Callers should check supports_vision before calling.
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
    """Raised when a provider is not available."""

    pass


class StructuredOutputError(AIProviderError):
    """Raised when structured output parsing fails."""

    pass
