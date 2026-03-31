"""Tests for AIManager structured output retry logic and 429 cascade."""

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock

import pytest
from pydantic import BaseModel, Field

from bubbly_chef.ai.manager import AIManager, NoProviderAvailableError
from bubbly_chef.ai.provider import ProviderUnavailableError, StructuredOutputError


class MockSchema(BaseModel):
    """Test schema for structured output."""

    name: str
    value: int = Field(ge=0)


def _make_provider(name: str) -> AsyncMock:
    """Create a mock provider with is_available=True by default."""
    provider = AsyncMock()
    provider.name = name
    provider.is_available = AsyncMock(return_value=True)
    return provider


@pytest.mark.asyncio
async def test_retry_on_structured_output_error() -> None:
    """Provider fails first call with StructuredOutputError, succeeds second call."""
    provider = _make_provider("p1")
    success_result = MockSchema(name="test", value=1)
    provider.complete = AsyncMock(
        side_effect=[
            StructuredOutputError("bad json"),
            success_result,
        ]
    )

    manager = AIManager([provider])
    result = await manager.complete("test prompt", response_schema=MockSchema)

    assert provider.complete.call_count == 2
    assert result == success_result


@pytest.mark.asyncio
async def test_max_retries_then_fallback() -> None:
    """First provider fails all 3 attempts, second provider succeeds on first try."""
    provider1 = _make_provider("p1")
    provider1.complete = AsyncMock(side_effect=StructuredOutputError("always bad"))

    provider2 = _make_provider("p2")
    success_result = MockSchema(name="from_p2", value=42)
    provider2.complete = AsyncMock(return_value=success_result)

    manager = AIManager([provider1, provider2])
    result = await manager.complete("test prompt", response_schema=MockSchema)

    assert provider1.complete.call_count == 3  # 1 initial + 2 retries
    assert provider2.complete.call_count == 1
    assert result == success_result


@pytest.mark.asyncio
async def test_no_retry_on_provider_unavailable() -> None:
    """ProviderUnavailableError triggers no retry — falls straight to next provider."""
    provider1 = _make_provider("p1")
    provider1.complete = AsyncMock(
        side_effect=ProviderUnavailableError("connection refused")
    )

    provider2 = _make_provider("p2")
    provider2.complete = AsyncMock(return_value="plain text result")

    manager = AIManager([provider1, provider2])
    result = await manager.complete("test prompt")

    assert provider1.complete.call_count == 1  # no retry
    assert provider2.complete.call_count == 1
    assert result == "plain text result"


@pytest.mark.asyncio
async def test_no_retry_without_schema() -> None:
    """With response_schema=None, exceptions are NOT retried."""
    provider = _make_provider("p1")
    provider.complete = AsyncMock(side_effect=Exception("unexpected error"))

    manager = AIManager([provider])

    with pytest.raises(NoProviderAvailableError):
        await manager.complete("test prompt", response_schema=None)

    assert provider.complete.call_count == 1  # no retry without schema


@pytest.mark.asyncio
async def test_retry_prompt_includes_error_feedback() -> None:
    """Second retry call's prompt must contain '[RETRY' and the original error message."""
    provider = _make_provider("p1")
    success_result = MockSchema(name="fixed", value=5)
    provider.complete = AsyncMock(
        side_effect=[
            StructuredOutputError("invalid field X"),
            success_result,
        ]
    )

    manager = AIManager([provider])
    await manager.complete("original prompt", response_schema=MockSchema)

    assert provider.complete.call_count == 2
    first_call_prompt: str = provider.complete.call_args_list[0].kwargs["prompt"]
    second_call_prompt: str = provider.complete.call_args_list[1].kwargs["prompt"]

    # First call uses original prompt
    assert first_call_prompt == "original prompt"
    # Second call appends retry feedback with the error message
    assert "[RETRY" in second_call_prompt
    assert "invalid field X" in second_call_prompt


@pytest.mark.asyncio
async def test_all_providers_exhaust_retries() -> None:
    """Two providers, both exhaust all retries.

    NoProviderAvailableError raised, total calls = 6.
    """
    provider1 = _make_provider("p1")
    provider1.complete = AsyncMock(side_effect=StructuredOutputError("p1 always fails"))

    provider2 = _make_provider("p2")
    provider2.complete = AsyncMock(side_effect=StructuredOutputError("p2 always fails"))

    manager = AIManager([provider1, provider2])

    with pytest.raises(NoProviderAvailableError):
        await manager.complete("test prompt", response_schema=MockSchema)

    assert provider1.complete.call_count == 3  # 1 + 2 retries
    assert provider2.complete.call_count == 3  # 1 + 2 retries


# ── 429 Cascade Tests ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_429_cascades_to_next_provider() -> None:
    """When first provider raises ProviderUnavailableError (429), second provider handles it."""
    provider1 = _make_provider("gemini/primary")
    provider1.complete = AsyncMock(
        side_effect=ProviderUnavailableError("Gemini [primary] rate limit 429")
    )

    provider2 = _make_provider("gemini/fallback")
    provider2.complete = AsyncMock(return_value="response from fallback")

    manager = AIManager([provider1, provider2])
    result = await manager.complete("test prompt")

    assert provider1.complete.call_count == 1
    assert provider2.complete.call_count == 1
    assert result == "response from fallback"


@pytest.mark.asyncio
async def test_429_cascades_through_multiple_providers() -> None:
    """429 on provider 1 and 2, provider 3 succeeds."""
    p1 = _make_provider("gemini/primary")
    p1.complete = AsyncMock(
        side_effect=ProviderUnavailableError("rate limit 429")
    )

    p2 = _make_provider("gemini/fallback-1")
    p2.complete = AsyncMock(
        side_effect=ProviderUnavailableError("rate limit 429")
    )

    p3 = _make_provider("ollama/llama")
    p3.complete = AsyncMock(return_value="ollama response")

    manager = AIManager([p1, p2, p3])
    result = await manager.complete("test prompt")

    assert p1.complete.call_count == 1
    assert p2.complete.call_count == 1
    assert p3.complete.call_count == 1
    assert result == "ollama response"


@pytest.mark.asyncio
async def test_all_providers_429_raises_no_provider() -> None:
    """All providers 429 → NoProviderAvailableError."""
    providers = []
    for name in ["gemini/a", "gemini/b", "ollama/c"]:
        p = _make_provider(name)
        p.complete = AsyncMock(
            side_effect=ProviderUnavailableError(f"{name} rate limit 429")
        )
        providers.append(p)

    manager = AIManager(providers)

    with pytest.raises(NoProviderAvailableError, match="All providers failed"):
        await manager.complete("test prompt")


@pytest.mark.asyncio
async def test_429_cascade_with_structured_output() -> None:
    """429 on first provider doesn't retry structured output — cascades immediately."""
    p1 = _make_provider("gemini/primary")
    p1.complete = AsyncMock(
        side_effect=ProviderUnavailableError("rate limit 429")
    )

    p2 = _make_provider("gemini/fallback")
    success = MockSchema(name="ok", value=1)
    p2.complete = AsyncMock(return_value=success)

    manager = AIManager([p1, p2])
    result = await manager.complete("test prompt", response_schema=MockSchema)

    # 429 is ProviderUnavailableError — no retries, direct cascade
    assert p1.complete.call_count == 1
    assert result == success


@pytest.mark.asyncio
async def test_stream_429_cascades_to_next_provider() -> None:
    """When streaming hits 429, manager cascades to next provider's stream."""

    async def _fail_stream(prompt: str, temperature: float = 0.7) -> AsyncIterator[str]:
        raise ProviderUnavailableError("stream rate limit 429")
        # Make it an async generator
        yield ""  # type: ignore[unreachable]  # noqa: unreachable

    async def _good_stream(prompt: str, temperature: float = 0.7) -> AsyncIterator[str]:
        yield "hello "
        yield "world"

    p1 = _make_provider("gemini/primary")
    p1.stream_complete = _fail_stream

    p2 = _make_provider("gemini/fallback")
    p2.stream_complete = _good_stream

    manager = AIManager([p1, p2])
    tokens: list[str] = []
    async for token in manager.stream_complete("test prompt"):
        tokens.append(token)

    assert tokens == ["hello ", "world"]


@pytest.mark.asyncio
async def test_stream_all_fail_raises() -> None:
    """All stream providers fail → NoProviderAvailableError."""

    async def _fail(prompt: str, temperature: float = 0.7) -> AsyncIterator[str]:
        raise ProviderUnavailableError("429")
        yield ""  # type: ignore[unreachable]  # noqa: unreachable

    p1 = _make_provider("p1")
    p1.stream_complete = _fail

    p2 = _make_provider("p2")
    p2.stream_complete = _fail

    manager = AIManager([p1, p2])

    with pytest.raises(NoProviderAvailableError):
        async for _ in manager.stream_complete("test"):
            pass


@pytest.mark.asyncio
async def test_vision_429_cascades() -> None:
    """Vision 429 on first provider cascades to second."""
    p1 = _make_provider("gemini/primary")
    p1.supports_vision = True
    p1.vision_complete = AsyncMock(
        side_effect=ProviderUnavailableError("vision rate limit 429")
    )

    p2 = _make_provider("gemini/fallback")
    p2.supports_vision = True
    p2.vision_complete = AsyncMock(return_value="vision result")

    manager = AIManager([p1, p2])
    result = await manager.vision_complete("describe this", image_bytes=b"\x89PNG")

    assert p1.vision_complete.call_count == 1
    assert p2.vision_complete.call_count == 1
    assert result == "vision result"


@pytest.mark.asyncio
async def test_is_available_true_does_not_block_cascade() -> None:
    """Even when is_available returns True, 429 in complete() cascades."""
    p1 = _make_provider("gemini/primary")
    p1.is_available = AsyncMock(return_value=True)
    p1.complete = AsyncMock(
        side_effect=ProviderUnavailableError("429 rate limited")
    )

    p2 = _make_provider("gemini/fallback")
    p2.is_available = AsyncMock(return_value=True)
    p2.complete = AsyncMock(return_value="success")

    manager = AIManager([p1, p2])
    result = await manager.complete("test")

    assert p1.is_available.call_count == 1
    assert p1.complete.call_count == 1
    assert result == "success"

