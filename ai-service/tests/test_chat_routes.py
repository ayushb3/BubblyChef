"""Tests for /v1/chat routes.

Mocks:
- get_current_user_id dependency → fixed test user_id
- run_chat_workflow_streaming → patched directly on the router module
- SupabaseRepository.get_history / save_message → in-memory stubs
"""

import json
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.repository.supabase_repo import SupabaseRepository

TEST_USER_ID = "test-user-123"
TEST_CONV_ID = "550e8400-e29b-41d4-a716-446655440001"

_STREAM_PATCH = "bubbly_chef.workflows.router.run_chat_workflow_streaming"


async def _fake_stream(*args: Any, **kwargs: Any) -> AsyncIterator[str]:
    yield json.dumps({"type": "token", "content": "Hello"})
    yield json.dumps({"type": "token", "content": " world"})
    yield json.dumps({"type": "done"})
    yield json.dumps(
        {
            "type": "envelope",
            "data": {
                "request_id": "req-1",
                "workflow_id": "wf-1",
                "conversation_id": TEST_CONV_ID,
                "intent": "general_chat",
                "assistant_message": "Hello world",
                "proposal": None,
                "confidence": {"overall": 0.9},
                "requires_review": False,
                "next_action": "none",
            },
        }
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def app():
    """Create a fresh FastAPI app with auth dependency overridden."""
    _app = create_app()

    async def _fake_user_id() -> str:
        return TEST_USER_ID

    _app.dependency_overrides[get_current_user_id] = _fake_user_id
    return _app


@pytest_asyncio.fixture
async def client(app):
    """Async HTTP client wired to the test app."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_repo() -> MagicMock:
    """Build a mock repository with async save_message and get_history."""
    repo = MagicMock()
    repo.save_message = AsyncMock(return_value=None)
    repo.get_history = AsyncMock(
        return_value=[
            {
                "id": "msg-1",
                "role": "user",
                "content": "Hi",
                "created_at": "2026-04-08T00:00:00Z",
            }
        ]
    )
    # Supabase client for sessions listing
    sessions_result = MagicMock()
    sessions_result.data = [
        {
            "conversation_id": TEST_CONV_ID,
            "active_mode": "default",
            "metadata": {},
            "created_at": "2026-04-08T00:00:00Z",
            "updated_at": "2026-04-08T00:00:00Z",
        }
    ]
    (
        repo.client.table.return_value
        .select.return_value
        .eq.return_value
        .order.return_value
        .execute.return_value
    ) = sessions_result
    return repo


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_stream_returns_sse(client: AsyncClient) -> None:
    """POST /v1/chat/stream returns text/event-stream content type."""
    mock_repo = _make_mock_repo()

    with patch(_STREAM_PATCH, side_effect=_fake_stream), patch(
        "bubbly_chef.api.routes.chat.get_repository",
        new_callable=AsyncMock,
        return_value=mock_repo,
    ):
        response = await client.post(
            "/v1/chat/stream",
            json={"message": "Hello", "conversation_id": TEST_CONV_ID},
        )

    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]


@pytest.mark.asyncio
async def test_chat_stream_yields_tokens(client: AsyncClient) -> None:
    """POST /v1/chat/stream body contains token and envelope SSE events."""
    mock_repo = _make_mock_repo()

    with patch(_STREAM_PATCH, side_effect=_fake_stream), patch(
        "bubbly_chef.api.routes.chat.get_repository",
        new_callable=AsyncMock,
        return_value=mock_repo,
    ):
        response = await client.post(
            "/v1/chat/stream",
            json={"message": "Hello", "conversation_id": TEST_CONV_ID},
        )

    body = response.text
    assert "event: token" in body
    assert "event: done" in body
    assert "event: envelope" in body
    assert "Hello" in body
    assert "world" in body


@pytest.mark.asyncio
async def test_chat_stream_requires_auth(app) -> None:
    """POST /v1/chat/stream without auth header returns 401."""
    app.dependency_overrides.clear()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post(
            "/v1/chat/stream",
            json={"message": "Hello"},
        )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_chat_history_returns_messages(client: AsyncClient) -> None:
    """GET /v1/chat/history/{id} returns the mocked message list."""
    mock_repo = _make_mock_repo()

    with patch(
        "bubbly_chef.api.routes.chat.get_repository",
        new_callable=AsyncMock,
        return_value=mock_repo,
    ):
        response = await client.get(f"/v1/chat/history/{TEST_CONV_ID}")

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["role"] == "user"
    assert data[0]["content"] == "Hi"


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_limit", [0, -5, 201])
async def test_chat_history_rejects_out_of_bounds_limit(
    client: AsyncClient, bad_limit: int
) -> None:
    """#384: `limit` is bounded (1-200) at the route so a caller can't turn
    it into "return nothing" (0, negative) or an unbounded fetch (too large)."""
    mock_repo = _make_mock_repo()

    with patch(
        "bubbly_chef.api.routes.chat.get_repository",
        new_callable=AsyncMock,
        return_value=mock_repo,
    ):
        response = await client.get(
            f"/v1/chat/history/{TEST_CONV_ID}", params={"limit": bad_limit}
        )

    assert response.status_code == 422


class _RealHistoryQuery:
    """Fluent query stub that threads order()/limit() through like real
    PostgREST -- unlike `_make_mock_repo`'s canned return_value, this backs
    a REAL `SupabaseRepository.get_history` call, so the route test below
    exercises the actual ordering/slicing logic, not just a mocked repo
    method."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows
        self._desc = False
        self._limit: int | None = None

    def select(self, *_args: Any, **_kwargs: Any) -> "_RealHistoryQuery":
        return self

    def eq(self, *_args: Any, **_kwargs: Any) -> "_RealHistoryQuery":
        return self

    def order(self, _column: str, desc: bool = False) -> "_RealHistoryQuery":
        self._desc = desc
        return self

    def limit(self, n: int) -> "_RealHistoryQuery":
        self._limit = n
        return self

    def execute(self) -> Any:
        rows = list(reversed(self._rows)) if self._desc else list(self._rows)
        if self._limit is not None:
            rows = rows[: self._limit]
        return type("Result", (), {"data": rows})()


class _RealHistoryClient:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def table(self, _name: str) -> _RealHistoryQuery:
        return _RealHistoryQuery(self._rows)


def _real_repo_with_messages(count: int) -> SupabaseRepository:
    """A real SupabaseRepository backed by a fake client holding `count`
    messages, oldest-first, content "message 0" .. "message {count-1}"."""
    rows = [
        {
            "id": f"msg-{i}",
            "role": "user" if i % 2 == 0 else "assistant",
            "content": f"message {i}",
            "created_at": f"2026-01-01T{i:02d}:00:00Z",
        }
        for i in range(count)
    ]
    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = _RealHistoryClient(rows)  # type: ignore[assignment]
    return repo


@pytest.mark.asyncio
async def test_chat_history_endpoint_restores_most_recent_messages_not_oldest(
    client: AsyncClient,
) -> None:
    """#384 (per orchestrator's re-review of PR #596, finding 1): the
    docstring in test_issue_384_chat_history_window.py claims this exact
    coverage exists -- this is that test. A conversation with 30 stored
    messages (over the route's default limit=20) must, on
    GET /v1/chat/history/{id} with no explicit limit, come back as the most
    recent 20 messages in chronological (oldest-first) order -- not the
    first 20, which is what the pre-#384 code returned."""
    real_repo = _real_repo_with_messages(30)

    with patch(
        "bubbly_chef.api.routes.chat.get_repository",
        new_callable=AsyncMock,
        return_value=real_repo,
    ):
        response = await client.get(f"/v1/chat/history/{TEST_CONV_ID}")

    assert response.status_code == 200
    data = response.json()
    assert [row["content"] for row in data] == [f"message {i}" for i in range(10, 30)]


@pytest.mark.asyncio
async def test_chat_history_requires_auth(app) -> None:
    """GET /v1/chat/history/{id} without auth header returns 401."""
    app.dependency_overrides.clear()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get(f"/v1/chat/history/{TEST_CONV_ID}")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_chat_sessions_list(client: AsyncClient) -> None:
    """GET /v1/chat/sessions returns the user's session list."""
    mock_repo = _make_mock_repo()

    with patch(
        "bubbly_chef.api.routes.chat.get_repository",
        new_callable=AsyncMock,
        return_value=mock_repo,
    ):
        response = await client.get("/v1/chat/sessions")

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["conversation_id"] == TEST_CONV_ID



# ---------------------------------------------------------------------------
# Cook handoff — request context reaching the workflow (issue #122)
# ---------------------------------------------------------------------------


COOKING_CONTEXT = {
    "cooking_recipe": {
        "id": "recipe-42",
        "title": "Lemon Garlic Pasta",
        "ingredients": ["spaghetti", "lemon", "garlic", "olive oil"],
    }
}


@pytest.mark.asyncio
async def test_chat_stream_forwards_context_to_workflow(client: AsyncClient) -> None:
    """POST /v1/chat/stream passes request.context through to the workflow."""
    mock_repo = _make_mock_repo()
    captured: dict[str, Any] = {}

    async def _capturing_stream(*args: Any, **kwargs: Any) -> AsyncIterator[str]:
        captured.update(kwargs)
        async for chunk in _fake_stream():
            yield chunk

    with patch(_STREAM_PATCH, side_effect=_capturing_stream), patch(
        "bubbly_chef.api.routes.chat.get_repository",
        new_callable=AsyncMock,
        return_value=mock_repo,
    ):
        response = await client.post(
            "/v1/chat/stream",
            json={
                "message": "how do I julienne the carrots?",
                "conversation_id": TEST_CONV_ID,
                "context": COOKING_CONTEXT,
            },
        )

    assert response.status_code == 200
    assert captured["context"] == COOKING_CONTEXT


@pytest.mark.asyncio
async def test_chat_non_streaming_forwards_context_to_workflow(client: AsyncClient) -> None:
    """POST /v1/chat passes request.context through to the workflow."""
    mock_repo = _make_mock_repo()
    captured: dict[str, Any] = {}

    async def _capturing_stream(*args: Any, **kwargs: Any) -> AsyncIterator[str]:
        captured.update(kwargs)
        async for chunk in _fake_stream():
            yield chunk

    with patch(_STREAM_PATCH, side_effect=_capturing_stream), patch(
        "bubbly_chef.api.routes.chat.get_repository",
        new_callable=AsyncMock,
        return_value=mock_repo,
    ):
        response = await client.post(
            "/v1/chat",
            json={
                "message": "what can I swap for lemon zest?",
                "conversation_id": TEST_CONV_ID,
                "context": COOKING_CONTEXT,
            },
        )

    assert response.status_code == 200
    assert captured["context"] == COOKING_CONTEXT


@pytest.mark.asyncio
async def test_chat_stream_context_defaults_to_none(client: AsyncClient) -> None:
    """Requests without context still forward context=None (no regression)."""
    mock_repo = _make_mock_repo()
    captured: dict[str, Any] = {}

    async def _capturing_stream(*args: Any, **kwargs: Any) -> AsyncIterator[str]:
        captured.update(kwargs)
        async for chunk in _fake_stream():
            yield chunk

    with patch(_STREAM_PATCH, side_effect=_capturing_stream), patch(
        "bubbly_chef.api.routes.chat.get_repository",
        new_callable=AsyncMock,
        return_value=mock_repo,
    ):
        response = await client.post(
            "/v1/chat/stream",
            json={"message": "Hello", "conversation_id": TEST_CONV_ID},
        )

    assert response.status_code == 200
    assert captured["context"] is None


@pytest.mark.asyncio
async def test_chat_stream_forwards_forced_intent_source(client: AsyncClient) -> None:
    """A confirm-band tap carries the request that raised the band through to the
    workflow alongside forced_intent (#436 verify finding)."""
    mock_repo = _make_mock_repo()
    captured: dict[str, Any] = {}

    async def _capturing_stream(*args: Any, **kwargs: Any) -> AsyncIterator[str]:
        captured.update(kwargs)
        async for chunk in _fake_stream():
            yield chunk

    with patch(_STREAM_PATCH, side_effect=_capturing_stream), patch(
        "bubbly_chef.api.routes.chat.get_repository",
        new_callable=AsyncMock,
        return_value=mock_repo,
    ):
        response = await client.post(
            "/v1/chat/stream",
            json={
                "message": "Tweak this recipe",
                "conversation_id": TEST_CONV_ID,
                "forced_intent": "recipe_card",
                "forced_intent_source": "hmm what about something with mushrooms",
            },
        )

    assert response.status_code == 200
    assert captured["forced_intent"] == "recipe_card"
    assert captured["forced_intent_source"] == "hmm what about something with mushrooms"


@pytest.mark.asyncio
async def test_chat_stream_forwards_follow_up_chips_flag(client: AsyncClient) -> None:
    """A caller that renders no chips (guided cook) can opt out of the pass (#506)."""
    mock_repo = _make_mock_repo()
    captured: dict[str, Any] = {}

    async def _capturing_stream(*args: Any, **kwargs: Any) -> AsyncIterator[str]:
        captured.update(kwargs)
        async for chunk in _fake_stream():
            yield chunk

    with patch(_STREAM_PATCH, side_effect=_capturing_stream), patch(
        "bubbly_chef.api.routes.chat.get_repository",
        new_callable=AsyncMock,
        return_value=mock_repo,
    ):
        default = await client.post(
            "/v1/chat/stream", json={"message": "hi", "conversation_id": TEST_CONV_ID}
        )
        assert default.status_code == 200
        assert captured["follow_up_chips"] is True

        opted_out = await client.post(
            "/v1/chat/stream",
            json={"message": "hi", "conversation_id": TEST_CONV_ID, "follow_up_chips": False},
        )
        assert opted_out.status_code == 200
        assert captured["follow_up_chips"] is False
