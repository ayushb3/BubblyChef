"""Tests for issue #732: when the AI is down, say *why* (the primary's reason).

Production: Gemini is spend-capped, Ollama is not configured (connection
refused). `/health/ai` correctly reports `quota_exhausted`, but chat told users
"trouble connecting, try again in a moment" -- the fallback's `network` kind.

Two causes, both covered here:

1. The Gemini *streaming* path read a 429 body off an unread streamed response,
   which raises `httpx.ResponseNotRead` from inside the `except` block. The
   classified `ProviderUnavailableError` never existed, so the manager recorded
   no kind for Gemini and the Ollama `network` kind was all that was left.
2. The cascade picked the first non-"generic" kind, so a transient `timeout`
   (not generic) could still outrank a configuration problem like quota.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.ai.gemini import GeminiProvider
from bubbly_chef.ai.manager import AIManager, NoProviderAvailableError, _aggregate_kind
from bubbly_chef.ai.ollama import OllamaProvider
from bubbly_chef.ai.provider import ProviderUnavailableError, user_message_for_failure

QUOTA_COPY = "Bubbly's AI is over its budget right now. Please try again later."


def _fake(name: str, kind: str) -> MagicMock:
    """A provider whose every call fails with ``kind``."""
    provider = MagicMock()
    provider.name = name
    provider.is_available = AsyncMock(return_value=True)
    error = ProviderUnavailableError(f"{name} failed", kind=kind)  # type: ignore[arg-type]
    provider.complete = AsyncMock(side_effect=error)

    async def _stream(*args: object, **kwargs: object) -> AsyncIterator[str]:
        raise error
        yield ""  # pragma: no cover - makes this an async generator

    provider.stream_complete = _stream
    return provider


# (first-tried kind, second-tried kind, what the user must hear about)
_RANKING_CASES = [
    # The production shape and its mirror image.
    ("quota_exhausted", "network", "quota_exhausted"),
    ("network", "quota_exhausted", "quota_exhausted"),
    # A transient timeout is not "generic" but still must not mask a config problem.
    ("timeout", "quota_exhausted", "quota_exhausted"),
    ("quota_exhausted", "timeout", "quota_exhausted"),
    ("auth", "network", "auth"),
    ("network", "model_not_found", "model_not_found"),
    ("timeout", "auth", "auth"),
    # Config problems outrank busy/rate-limit, which outrank timeout/network.
    ("rate_limited", "quota_exhausted", "quota_exhausted"),
    ("timeout", "rate_limited", "rate_limited"),
    ("network", "overloaded", "overloaded"),
    # Both transient: the one that actually reached a server beats "unreachable".
    ("network", "timeout", "timeout"),
    ("timeout", "network", "timeout"),
    # Equally uninformative: keep the first (primary) one.
    ("unknown", "network", "unknown"),
    ("network", "network", "network"),
]


class TestAggregateKindRanking:
    @pytest.mark.parametrize(("first", "second", "expected"), _RANKING_CASES)
    def test_pure_ranking(self, first: str, second: str, expected: str) -> None:
        assert _aggregate_kind([first, second]) == expected

    def test_empty_is_none(self) -> None:
        assert _aggregate_kind([]) is None


class TestCascadeSurfacesTheMostMeaningfulKind:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(("first", "second", "expected"), _RANKING_CASES)
    async def test_complete(self, first: str, second: str, expected: str) -> None:
        manager = AIManager(providers=[_fake("a", first), _fake("b", second)])

        with pytest.raises(NoProviderAvailableError) as exc_info:
            await manager.complete(prompt="hi")

        assert exc_info.value.kind == expected
        # /health/ai's last_failure_kind must agree with what chat says.
        assert manager.last_failure_kind == expected

    @pytest.mark.asyncio
    @pytest.mark.parametrize(("first", "second", "expected"), _RANKING_CASES)
    async def test_stream_complete(self, first: str, second: str, expected: str) -> None:
        manager = AIManager(providers=[_fake("a", first), _fake("b", second)])

        with pytest.raises(NoProviderAvailableError) as exc_info:
            async for _ in manager.stream_complete(prompt="hi"):
                pass

        assert exc_info.value.kind == expected
        assert manager.last_failure_kind == expected

    @pytest.mark.asyncio
    async def test_quota_then_network_tells_the_user_about_the_budget(self) -> None:
        manager = AIManager(
            providers=[_fake("gemini", "quota_exhausted"), _fake("ollama", "network")]
        )
        with pytest.raises(NoProviderAvailableError) as exc_info:
            async for _ in manager.stream_complete(prompt="hi"):
                pass

        err = exc_info.value
        assert user_message_for_failure(err.kind, err.configured) == QUOTA_COPY


class _UnreadBody(httpx.AsyncByteStream):
    """A response body that has not been read yet, like a real network stream."""

    def __init__(self, body: bytes) -> None:
        self._body = body

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield self._body


def _gemini_streaming_429(body: bytes) -> GeminiProvider:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, stream=_UnreadBody(body))

    provider = GeminiProvider(api_key="test-key", model="gemini-3.1-flash-lite")
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return provider


_SPEND_CAP_BODY = (
    b'{"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", '
    b'"message": "Your project has exceeded its monthly spending cap."}}'
)


class TestGeminiStreamingQuotaIsClassified:
    """The real root cause of #732: the streamed 429 body was unread."""

    @pytest.mark.asyncio
    async def test_streamed_spend_cap_429_raises_a_classified_error(self) -> None:
        provider = _gemini_streaming_429(_SPEND_CAP_BODY)

        with pytest.raises(ProviderUnavailableError) as exc_info:
            async for _ in provider.stream_complete(prompt="hi"):
                pass

        assert exc_info.value.kind == "quota_exhausted"
        assert exc_info.value.status_code == 429

    @pytest.mark.asyncio
    async def test_spend_capped_gemini_plus_unreachable_ollama_says_budget(self) -> None:
        """Production end to end with real providers, only the wire is faked:
        Gemini returns a streamed spend-cap 429, Ollama refuses the connection."""
        gemini = _gemini_streaming_429(_SPEND_CAP_BODY)
        ollama = OllamaProvider(base_url="http://127.0.0.1:1", timeout=2.0)
        manager = AIManager(providers=[gemini, ollama])
        try:
            with pytest.raises(NoProviderAvailableError) as exc_info:
                async for _ in manager.stream_complete(prompt="hi"):
                    pass
        finally:
            await ollama.close()

        err = exc_info.value
        assert err.kind == "quota_exhausted"
        assert user_message_for_failure(err.kind, err.configured) == QUOTA_COPY
        assert manager.last_failure_kind == "quota_exhausted"


def _stream_envelope(body: str) -> dict:
    """The `envelope` event's data out of a raw SSE body."""
    import json

    for line in body.splitlines():
        if line.startswith("data: "):
            event = json.loads(line[6:])
            if event.get("type") == "envelope":
                return event["data"]
    raise AssertionError(f"no envelope event in stream: {body[:300]}")


@pytest_asyncio.fixture
async def _client():
    app = create_app()

    async def _fake_user_id() -> str:
        return "test-user-732"

    app.dependency_overrides[get_current_user_id] = _fake_user_id
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _failing_manager(exc: Exception) -> MagicMock:
    manager = MagicMock()
    manager.providers = [MagicMock(name="fake-provider")]
    manager.complete = AsyncMock(side_effect=exc)

    async def _raising_stream(*args: object, **kwargs: object) -> AsyncIterator[str]:
        raise exc
        yield ""  # pragma: no cover

    manager.stream_complete = _raising_stream
    return manager


class TestEnvelopeFlagsAnAiErrorReply:
    """The client can't tell a canned failure reply from an answer, so it
    offered the normal follow-up pills on it. The envelope now says so."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("kind", "configured", "expected"),
        [
            ("quota_exhausted", True, "quota_exhausted"),
            ("timeout", True, "timeout"),
            ("network", True, "network"),
            (None, False, "not_configured"),
        ],
    )
    async def test_stream_envelope_carries_ai_error_kind(
        self, _client: AsyncClient, kind: str | None, configured: bool, expected: str
    ) -> None:
        exc = NoProviderAvailableError("All providers failed", kind=kind, configured=configured)
        with patch(
            "bubbly_chef.workflows.router.get_ai_manager",
            return_value=_failing_manager(exc),
        ):
            response = await _client.post("/v1/chat/stream", json={"message": "hi"})

        assert response.status_code == 200
        envelope = _stream_envelope(response.text)
        assert envelope["metadata"]["ai_error_kind"] == expected
        assert envelope["metadata"]["follow_ups_pending"] is False

    def test_graph_path_envelope_carries_ai_error_kind(self) -> None:
        """Non-streamed intents (recipe, meal, pantry...) build their envelope
        from workflow state; a node that hit NoProviderAvailableError tags it."""
        from bubbly_chef.workflows.router import _build_envelope_from_state

        state = {
            "intent": "general_chat",
            "assistant_message": QUOTA_COPY,
            "ai_failure_kind": "quota_exhausted",
            "ai_failure_configured": True,
        }
        envelope = _build_envelope_from_state(state, "hi", None)
        assert envelope.metadata["ai_error_kind"] == "quota_exhausted"

        ok = _build_envelope_from_state(
            {"intent": "general_chat", "assistant_message": "Try an omelette."}, "hi", None
        )
        assert "ai_error_kind" not in ok.metadata

    @pytest.mark.asyncio
    async def test_a_normal_reply_has_no_ai_error_kind(self, _client: AsyncClient) -> None:
        manager = MagicMock()
        manager.providers = [MagicMock(name="fake-provider")]
        manager.complete = AsyncMock(return_value="[]")

        async def _ok_stream(*args: object, **kwargs: object) -> AsyncIterator[str]:
            yield "Try a simple omelette."

        manager.stream_complete = _ok_stream
        with patch("bubbly_chef.workflows.router.get_ai_manager", return_value=manager):
            response = await _client.post(
                "/v1/chat/stream", json={"message": "hi", "follow_up_chips": False}
            )

        envelope = _stream_envelope(response.text)
        assert "ai_error_kind" not in envelope["metadata"]


class TestUnreachableOllamaIsNetwork:
    @pytest.mark.asyncio
    async def test_connection_refused_is_network_not_timeout(self) -> None:
        ollama = OllamaProvider(base_url="http://127.0.0.1:1", timeout=2.0)
        try:
            with pytest.raises(ProviderUnavailableError) as exc_info:
                await ollama.complete(prompt="hi")
        finally:
            await ollama.close()

        assert exc_info.value.kind == "network"
