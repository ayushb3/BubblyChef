"""Issue #514 — AI errors should carry the Gemini failure kind to chat.

Today every `NoProviderAvailableError` — whatever actually went wrong on the
Gemini side (quota exhausted, bad API key, model not found, the service is
overloaded, a network timeout) — surfaces to the user as the exact same
hardcoded string: "No AI provider is configured. Please add a Gemini API key
or start Ollama." That's misleading in the far more common case where a
provider *is* configured but the call failed for some other reason (over
budget, key rejected, model down), and it doesn't help `/health/ai` tell
those cases apart either.

These tests reproduce the bug: two structurally different failures (a
quota/billing failure vs. an auth failure) still produce the *identical*
user-facing message today, and `/health/ai` carries no information about
what the last failure actually was. Both should fail before the fix and
pass after `ProviderFailureKind` classification lands.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.ai.manager import AIManager, NoProviderAvailableError
from bubbly_chef.workflows.chat.nodes import general_chat_response

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _state(**kwargs):
    base: dict = {
        "input_text": "What can I cook tonight?",
        "user_id": "test-user-514",
        "errors": [],
        "warnings": [],
        "session_mode": None,
        "session": None,
        "conversation_history": [],
        "input_mode": "chat",
        "context": None,
    }
    base.update(kwargs)
    return base


def _manager_raising(exc: Exception) -> MagicMock:
    """A manager stand-in whose `.complete` always raises `exc`.

    Mirrors what a real `AIManager` does once every provider it holds has
    raised `ProviderUnavailableError` and it gives up with
    `NoProviderAvailableError` — the node under test only ever sees that
    final exception, never the provider-level detail, which is exactly the
    bug.
    """
    manager = MagicMock()
    manager.providers = [MagicMock(name="fake-provider")]
    manager.complete = AsyncMock(side_effect=exc)
    return manager


# ---------------------------------------------------------------------------
# The bug: distinct failures collapse into one identical message
# ---------------------------------------------------------------------------


class TestChatErrorMessageIgnoresFailureKind:
    @pytest.mark.asyncio
    async def test_quota_failure_should_mention_budget_not_the_generic_string(self):
        """A quota/billing failure should tell the user Bubbly is over budget,
        not the generic "no provider configured" copy — the provider *is*
        configured, it just hit a spend cap.
        """
        quota_error = NoProviderAvailableError(
            "All providers failed. Errors: "
            "['gemini/gemini-3.1-flash-lite: Gemini rate limit 429: "
            "{\"error\": {\"status\": \"RESOURCE_EXHAUSTED\", "
            "\"message\": \"You exceeded your current quota, "
            "please check your billing details.\"}}']"
        )
        manager = _manager_raising(quota_error)

        with (
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager),
            patch("bubbly_chef.workflows.chat.nodes.get_repository", new_callable=AsyncMock),
        ):
            result = await general_chat_response(_state())

        message = result["assistant_message"]
        assert "No AI provider is configured" not in message, (
            f"quota failure surfaced the generic not-configured copy instead of "
            f"budget-specific wording: {message!r}"
        )
        assert "budget" in message.lower() or "quota" in message.lower()

    @pytest.mark.asyncio
    async def test_auth_failure_message_differs_from_quota_failure_message(self):
        """An auth failure (bad/expired API key) is a different situation from
        a quota failure and must read differently to the user — right now
        both produce byte-identical text.
        """
        quota_error = NoProviderAvailableError(
            "All providers failed. Errors: "
            "['gemini/gemini-3.1-flash-lite: Gemini rate limit 429: "
            "{\"error\": {\"status\": \"RESOURCE_EXHAUSTED\"}}']"
        )
        auth_error = NoProviderAvailableError(
            "All providers failed. Errors: "
            "['gemini/gemini-3.1-flash-lite: Gemini API error 401: "
            "{\"error\": {\"status\": \"UNAUTHENTICATED\"}}']"
        )

        with (
            patch(
                "bubbly_chef.workflows.chat.nodes.get_ai_manager",
                return_value=_manager_raising(quota_error),
            ),
            patch("bubbly_chef.workflows.chat.nodes.get_repository", new_callable=AsyncMock),
        ):
            quota_result = await general_chat_response(_state())

        with (
            patch(
                "bubbly_chef.workflows.chat.nodes.get_ai_manager",
                return_value=_manager_raising(auth_error),
            ),
            patch("bubbly_chef.workflows.chat.nodes.get_repository", new_callable=AsyncMock),
        ):
            auth_result = await general_chat_response(_state())

        assert quota_result["assistant_message"] != auth_result["assistant_message"], (
            "a quota failure and an auth failure produced the same user-facing "
            "message — the failure kind never reaches the reply"
        )


# ---------------------------------------------------------------------------
# /health/ai carries no information about what the last failure was
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_health_check_has_no_last_failure_information_after_a_failure():
    """After a provider failure, `AIManager.health_check()` should be able to
    report what kind of failure it was and when — today the returned dict
    has no such fields at all, so `/health/ai` can't surface them either.
    """
    failing_provider = MagicMock()
    failing_provider.name = "gemini/gemini-3.1-flash-lite"
    failing_provider.is_available = AsyncMock(return_value=True)

    manager = AIManager(providers=[failing_provider])

    from bubbly_chef.ai.provider import ProviderUnavailableError

    failing_provider.complete = AsyncMock(
        side_effect=ProviderUnavailableError("Gemini API error 401: unauthenticated")
    )

    with pytest.raises(NoProviderAvailableError):
        await manager.complete(prompt="hello")

    status = await manager.health_check()

    assert "last_failure_kind" in status, (
        "health_check() has no last_failure_kind field — /health/ai can't "
        "distinguish an auth failure from a quota failure from a timeout"
    )
    assert status["last_failure_kind"] == "auth"
