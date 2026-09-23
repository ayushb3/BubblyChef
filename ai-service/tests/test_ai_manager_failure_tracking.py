"""Tests for AIManager's last-failure tracking (issue #514).

`health_check()` should be able to tell `/health/ai` what the last provider
failure actually was (kind + when), and forget it once a subsequent call
succeeds. `NoProviderAvailableError.configured` should distinguish "nothing
is registered at all" from "a provider is registered but failed".
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from bubbly_chef.ai.manager import AIManager, NoProviderAvailableError
from bubbly_chef.ai.provider import ProviderUnavailableError


def _provider(name: str = "gemini/test") -> MagicMock:
    provider = MagicMock()
    provider.name = name
    provider.is_available = AsyncMock(return_value=True)
    provider.supports_vision = False
    provider.supports_tool_calling = False
    return provider


class TestHealthCheckFailureTracking:
    @pytest.mark.asyncio
    async def test_health_check_reflects_last_failure_kind_and_timestamp(self) -> None:
        provider = _provider()
        provider.complete = AsyncMock(
            side_effect=ProviderUnavailableError("quota exceeded", kind="quota_exhausted")
        )
        manager = AIManager(providers=[provider])

        with pytest.raises(NoProviderAvailableError):
            await manager.complete(prompt="hello")

        status = await manager.health_check()
        assert status["last_failure_kind"] == "quota_exhausted"
        assert status["last_failure_at"] is not None

    @pytest.mark.asyncio
    async def test_health_check_clears_failure_after_a_subsequent_success(self) -> None:
        provider = _provider()
        provider.complete = AsyncMock(
            side_effect=[
                ProviderUnavailableError("auth failed", kind="auth"),
                "a successful reply",
            ]
        )
        manager = AIManager(providers=[provider])

        with pytest.raises(NoProviderAvailableError):
            await manager.complete(prompt="hello")
        status_after_failure = await manager.health_check()
        assert status_after_failure["last_failure_kind"] == "auth"

        result = await manager.complete(prompt="hello again")
        assert result == "a successful reply"

        status_after_success = await manager.health_check()
        assert status_after_success["last_failure_kind"] is None
        assert status_after_success["last_failure_at"] is None


class TestAggregatedKindAcrossProviders:
    """Production shape: Gemini (primary) followed by an unreachable local
    Ollama fallback. Both fail, but Gemini's classified failure is the one
    the user needs to hear — not Ollama's generic "network" kind just
    because it was tried last (#514).
    """

    @pytest.mark.asyncio
    async def test_gemini_quota_exhausted_survives_ollama_network_fallback(self) -> None:
        gemini = _provider("gemini/test")
        gemini.complete = AsyncMock(
            side_effect=ProviderUnavailableError(
                "429 RESOURCE_EXHAUSTED", kind="quota_exhausted"
            )
        )
        ollama = _provider("ollama/test")
        ollama.complete = AsyncMock(
            side_effect=ProviderUnavailableError(
                "Ollama connection error: [Errno 111] Connection refused", kind="network"
            )
        )
        manager = AIManager(providers=[gemini, ollama])

        with pytest.raises(NoProviderAvailableError) as exc_info:
            await manager.complete(prompt="hello")

        assert exc_info.value.kind == "quota_exhausted"

    @pytest.mark.asyncio
    async def test_gemini_bad_request_survives_ollama_network_fallback(self) -> None:
        gemini = _provider("gemini/test")
        gemini.complete = AsyncMock(
            side_effect=ProviderUnavailableError("400 Bad Request: invalid key", kind="bad_request")
        )
        ollama = _provider("ollama/test")
        ollama.complete = AsyncMock(
            side_effect=ProviderUnavailableError(
                "Ollama connection error: [Errno 111] Connection refused", kind="network"
            )
        )
        manager = AIManager(providers=[gemini, ollama])

        with pytest.raises(NoProviderAvailableError) as exc_info:
            await manager.complete(prompt="hello")

        assert exc_info.value.kind == "bad_request"

    @pytest.mark.asyncio
    async def test_falls_back_to_network_when_every_provider_is_network(self) -> None:
        gemini = _provider("gemini/test")
        gemini.complete = AsyncMock(
            side_effect=ProviderUnavailableError("connection reset", kind="network")
        )
        ollama = _provider("ollama/test")
        ollama.complete = AsyncMock(
            side_effect=ProviderUnavailableError(
                "Ollama connection error: [Errno 111] Connection refused", kind="network"
            )
        )
        manager = AIManager(providers=[gemini, ollama])

        with pytest.raises(NoProviderAvailableError) as exc_info:
            await manager.complete(prompt="hello")

        assert exc_info.value.kind == "network"


class TestNoIsAvailablePreCheck:
    """Regression coverage for the attempt-2 fix (#514): complete(),
    vision_complete(), complete_with_tools() and stream_complete() must call
    the provider directly and surface its classified failure kind, rather
    than gating the call on a cheap ``is_available()`` probe first.

    Attempt 1 left the pre-check in place; it made every manager-level test
    pass because those tests stub ``is_available`` to return True. Here
    ``is_available`` returns False on purpose — if any cascade method put the
    pre-check back, these would either skip the provider entirely (no call
    to raise a classified error) or otherwise fail to surface the kind the
    real call would have classified, which is exactly what shipped broken to
    production the first time.
    """

    @pytest.mark.asyncio
    async def test_complete_ignores_false_is_available_and_surfaces_kind(self) -> None:
        provider = _provider()
        provider.is_available = AsyncMock(return_value=False)
        provider.complete = AsyncMock(
            side_effect=ProviderUnavailableError("auth failed", kind="auth")
        )
        manager = AIManager(providers=[provider])

        with pytest.raises(NoProviderAvailableError) as exc_info:
            await manager.complete(prompt="hello")

        provider.complete.assert_awaited_once()
        assert exc_info.value.kind == "auth"

    @pytest.mark.asyncio
    async def test_vision_complete_ignores_false_is_available_and_surfaces_kind(self) -> None:
        provider = _provider()
        provider.is_available = AsyncMock(return_value=False)
        provider.supports_vision = True
        provider.vision_complete = AsyncMock(
            side_effect=ProviderUnavailableError("model not found", kind="model_not_found")
        )
        manager = AIManager(providers=[provider])

        with pytest.raises(NoProviderAvailableError) as exc_info:
            await manager.vision_complete(prompt="extract", image_bytes=b"fake")

        provider.vision_complete.assert_awaited_once()
        assert exc_info.value.kind == "model_not_found"

    @pytest.mark.asyncio
    async def test_complete_with_tools_ignores_false_is_available_and_surfaces_kind(
        self,
    ) -> None:
        provider = _provider()
        provider.is_available = AsyncMock(return_value=False)
        provider.supports_tool_calling = True
        provider.complete_with_tools = AsyncMock(
            side_effect=ProviderUnavailableError("bad request", kind="bad_request")
        )
        manager = AIManager(providers=[provider])

        with pytest.raises(NoProviderAvailableError) as exc_info:
            await manager.complete_with_tools(messages=[{"role": "user", "content": "hi"}], tools=[])

        provider.complete_with_tools.assert_awaited_once()
        assert exc_info.value.kind == "bad_request"

    @pytest.mark.asyncio
    async def test_stream_complete_ignores_false_is_available_and_surfaces_kind(self) -> None:
        provider = _provider()
        provider.is_available = AsyncMock(return_value=False)

        async def _raise_overloaded(*args: object, **kwargs: object) -> AsyncMock:
            raise ProviderUnavailableError("overloaded", kind="overloaded")
            yield  # pragma: no cover - makes this an async generator

        provider.stream_complete = _raise_overloaded
        manager = AIManager(providers=[provider])

        with pytest.raises(NoProviderAvailableError) as exc_info:
            async for _ in manager.stream_complete(prompt="hello"):
                pass

        assert exc_info.value.kind == "overloaded"


class TestNoProviderAvailableErrorConfigured:
    @pytest.mark.asyncio
    async def test_configured_is_false_when_no_providers_registered(self) -> None:
        manager = AIManager(providers=[])

        with pytest.raises(NoProviderAvailableError) as exc_info:
            await manager.complete(prompt="hello")

        assert exc_info.value.configured is False

    @pytest.mark.asyncio
    async def test_configured_is_true_when_a_registered_provider_fails(self) -> None:
        provider = _provider()
        provider.complete = AsyncMock(
            side_effect=ProviderUnavailableError("overloaded", kind="overloaded")
        )
        manager = AIManager(providers=[provider])

        with pytest.raises(NoProviderAvailableError) as exc_info:
            await manager.complete(prompt="hello")

        assert exc_info.value.configured is True
        assert exc_info.value.kind == "overloaded"
