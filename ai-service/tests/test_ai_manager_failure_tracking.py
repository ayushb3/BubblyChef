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
