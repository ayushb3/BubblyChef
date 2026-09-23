"""Issue #514 — AI errors should carry the Gemini failure kind to chat.

The block at the bottom of this file (`TestChatEndpointsSurfaceFailureKind`
and friends) exercises the fix end-to-end: real HTTP requests against
`/v1/chat` and `/v1/chat/stream`, and `/health/ai`, with only the AI
manager mocked.

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


# ---------------------------------------------------------------------------
# End-to-end: real HTTP requests against /v1/chat and /v1/chat/stream, and
# /health/ai, with only the AI manager mocked.
# ---------------------------------------------------------------------------

import logging  # noqa: E402

import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from bubbly_chef.api.auth import get_current_user_id  # noqa: E402
from bubbly_chef.ai.provider import ProviderUnavailableError  # noqa: E402
from bubbly_chef.main import create_app  # noqa: E402

TEST_USER_ID = "test-user-514-endpoint"


def _manager_always_failing(exc: Exception) -> MagicMock:
    """A manager stand-in whose complete/stream_complete both raise `exc`.

    `stream_complete` must be an async generator — a plain AsyncMock side
    effect won't do, since callers do `async for token in ...`.
    """
    manager = MagicMock()
    manager.providers = [MagicMock(name="fake-provider")]
    manager.complete = AsyncMock(side_effect=exc)

    async def _raising_stream(*args, **kwargs):
        raise exc
        yield ""  # pragma: no cover — makes this an async generator

    manager.stream_complete = _raising_stream
    return manager


@pytest_asyncio.fixture
async def _endpoint_client():
    app = create_app()

    async def _fake_user_id() -> str:
        return TEST_USER_ID

    app.dependency_overrides[get_current_user_id] = _fake_user_id
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


class TestChatEndpointsSurfaceFailureKind:
    """Both /v1/chat and /v1/chat/stream must read the failure kind, not
    always say "No AI provider is configured" (#514).
    """

    @pytest.mark.asyncio
    async def test_non_streaming_quota_failure_names_budget(self, _endpoint_client) -> None:
        exc = NoProviderAvailableError(
            "All providers failed", kind="quota_exhausted", configured=True
        )
        with patch(
            "bubbly_chef.workflows.router.get_ai_manager",
            return_value=_manager_always_failing(exc),
        ):
            response = await _endpoint_client.post("/v1/chat", json={"message": "hi"})

        assert response.status_code == 200
        message = response.json()["assistant_message"]
        assert "No AI provider is configured" not in message
        assert "budget" in message.lower() or "quota" in message.lower()

    @pytest.mark.asyncio
    async def test_streaming_quota_failure_names_budget(self, _endpoint_client) -> None:
        exc = NoProviderAvailableError(
            "All providers failed", kind="quota_exhausted", configured=True
        )
        with patch(
            "bubbly_chef.workflows.router.get_ai_manager",
            return_value=_manager_always_failing(exc),
        ):
            response = await _endpoint_client.post(
                "/v1/chat/stream", json={"message": "hi"}
            )

        assert response.status_code == 200
        body = response.text
        assert "No AI provider is configured" not in body
        assert "budget" in body.lower() or "quota" in body.lower()

    @pytest.mark.asyncio
    async def test_empty_provider_list_still_says_not_configured(self, _endpoint_client) -> None:
        exc = NoProviderAvailableError("All providers failed", kind=None, configured=False)
        with patch(
            "bubbly_chef.workflows.router.get_ai_manager",
            return_value=_manager_always_failing(exc),
        ):
            response = await _endpoint_client.post("/v1/chat", json={"message": "hi"})

        assert response.status_code == 200
        message = response.json()["assistant_message"]
        assert "No AI provider is configured" in message

    @pytest.mark.asyncio
    async def test_auth_failure_logs_one_warning_with_kind(
        self, _endpoint_client, caplog: pytest.LogCaptureFixture
    ) -> None:
        provider = MagicMock()
        provider.name = "gemini/gemini-3.1-flash-lite"
        provider.is_available = AsyncMock(return_value=True)
        provider.complete = AsyncMock(
            side_effect=ProviderUnavailableError(
                "Gemini API error 401: unauthenticated", kind="auth", status_code=401
            )
        )
        manager = AIManager(providers=[provider])

        with (
            patch("bubbly_chef.workflows.router.get_ai_manager", return_value=manager),
            caplog.at_level(logging.WARNING, logger="bubbly_chef.ai.manager"),
        ):
            response = await _endpoint_client.post("/v1/chat", json={"message": "hi"})

        assert response.status_code == 200
        message = response.json()["assistant_message"]
        assert "No AI provider is configured" not in message

        warning_records = [
            r for r in caplog.records
            if r.name == "bubbly_chef.ai.manager" and r.levelno == logging.WARNING
        ]
        kind_warnings = [r for r in warning_records if "kind=auth" in r.getMessage()]
        assert len(kind_warnings) == 1, (
            f"expected exactly one WARNING log naming kind=auth, got: {warning_records}"
        )


@pytest.mark.asyncio
async def test_health_ai_shows_failure_kind_then_clears_after_success(
    _endpoint_client,
) -> None:
    provider = MagicMock()
    provider.name = "gemini/gemini-3.1-flash-lite"
    provider.is_available = AsyncMock(return_value=True)
    provider.complete = AsyncMock(
        side_effect=ProviderUnavailableError(
            "Gemini API error 401: unauthenticated", kind="auth", status_code=401
        )
    )
    manager = AIManager(providers=[provider])

    with patch("bubbly_chef.api.deps.get_ai_manager", return_value=manager):
        with pytest.raises(NoProviderAvailableError):
            await manager.complete(prompt="hello")

        response = await _endpoint_client.get("/health/ai")
        body = response.json()
        assert body["last_failure_kind"] == "auth"
        assert body["last_failure_at"] is not None

        provider.complete = AsyncMock(return_value="a fine reply")
        await manager.complete(prompt="hello again")

        response = await _endpoint_client.get("/health/ai")
        body = response.json()
        assert body["last_failure_kind"] is None
        assert body["last_failure_at"] is None
