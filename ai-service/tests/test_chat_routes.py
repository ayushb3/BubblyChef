"""Tests for /v1/chat routes.

Mocks:
- get_current_user_id dependency → fixed test user_id
- run_chat_workflow_streaming → predictable SSE event sequence
- SupabaseRepository.get_history / save_message → in-memory stubs
"""

import json
import sys
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# ---------------------------------------------------------------------------
# Stub out bubbly_chef.workflows.router before any app import attempts it.
# The ai-service router.py inherits old monolith imports (api.deps, repository.sqlite)
# that don't exist in the ai-service tree. We inject a fake module so the
# lazy import in chat.py resolves without touching those paths.
# ---------------------------------------------------------------------------
_router_stub = MagicMock()


async def _fake_stream_default(*args: Any, **kwargs: Any) -> AsyncIterator[str]:
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


# We cannot reference TEST_CONV_ID before definition, so define it first.
TEST_USER_ID = "test-user-123"
TEST_CONV_ID = "550e8400-e29b-41d4-a716-446655440001"


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


_router_stub.run_chat_workflow_streaming = _fake_stream
sys.modules.setdefault("bubbly_chef.workflows.router", _router_stub)

# Now safe to import app modules
from bubbly_chef.api.auth import get_current_user_id  # noqa: E402
from bubbly_chef.main import create_app  # noqa: E402


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

    with patch(
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

    with patch(
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

