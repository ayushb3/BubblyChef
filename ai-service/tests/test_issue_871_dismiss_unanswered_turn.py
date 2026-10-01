"""Issue #871 -- Dismiss on a failed chat send must not come back on reload.

``POST /v1/chat/stream`` saves the user turn BEFORE the reply streams, so a
stream that dies leaves it stored with no reply. Dismiss used to clear the
bubble on the client only; on reload the turn came back under no reply.

``DELETE /v1/chat/history/{conversation_id}/unanswered`` removes the
conversation's newest stored message, but only when it is a user turn (so no
assistant reply follows it), and only for the calling user.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.repository.supabase_repo import SupabaseRepository


class _Query:
    """Fluent stub over an in-memory ``conversation_history`` table honouring
    ``eq`` filters, ``order(desc)`` + ``limit`` and ``delete`` like PostgREST."""

    def __init__(self, store: "_Store") -> None:
        self._store = store
        self._filters: dict[str, Any] = {}
        self._desc = False
        self._limit: int | None = None
        self._delete = False

    def select(self, *_args: Any, **_kwargs: Any) -> "_Query":
        return self

    def delete(self) -> "_Query":
        self._delete = True
        return self

    def eq(self, column: str, value: Any) -> "_Query":
        self._filters[column] = value
        return self

    def order(self, _column: str, desc: bool = False) -> "_Query":
        self._desc = desc
        return self

    def limit(self, n: int) -> "_Query":
        self._limit = n
        return self

    def execute(self) -> Any:
        rows = [r for r in self._store.rows if all(r.get(k) == v for k, v in self._filters.items())]
        if self._delete:
            self._store.deletes += 1
            for r in rows:
                self._store.rows.remove(r)
            return type("Result", (), {"data": rows})()
        if self._desc:
            rows = list(reversed(rows))
        if self._limit is not None:
            rows = rows[: self._limit]
        return type("Result", (), {"data": rows})()


class _Store:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.deletes = 0

    def table(self, _name: str) -> _Query:
        return _Query(self)


_next_id = 0


def _row(
    role: str, content: str, user_id: str = "u1", conversation_id: str = "c1"
) -> dict[str, Any]:
    global _next_id
    _next_id += 1
    return {
        "id": f"row-{_next_id}",
        "user_id": user_id,
        "conversation_id": conversation_id,
        "role": role,
        "content": content,
    }


def _repo(rows: list[dict[str, Any]]) -> tuple[SupabaseRepository, _Store]:
    store = _Store(rows)
    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = store  # type: ignore[assignment]
    return repo, store


async def _dismiss(repo: SupabaseRepository, user_id: str = "u1", conv: str = "c1") -> bool:
    return await repo.delete_unanswered_user_turn(user_id=user_id, conversation_id=conv)


@pytest.mark.asyncio
class TestDeleteUnansweredUserTurn:
    async def test_deletes_the_trailing_unanswered_user_turn(self) -> None:
        repo, store = _repo([_row("assistant", "hi!"), _row("user", "plan dinner")])

        assert await _dismiss(repo) is True
        assert [r["content"] for r in store.rows] == ["hi!"]

    async def test_keeps_a_user_turn_that_has_a_reply(self) -> None:
        repo, store = _repo([_row("user", "plan dinner"), _row("assistant", "Pasta?")])

        assert await _dismiss(repo) is False
        assert len(store.rows) == 2
        assert store.deletes == 0

    async def test_deletes_only_the_newest_of_several_user_turns(self) -> None:
        """Earlier unanswered turns are real history; only the newest goes."""
        repo, store = _repo([_row("user", "first"), _row("user", "second")])

        assert await _dismiss(repo) is True
        assert [r["content"] for r in store.rows] == ["first"]

    async def test_another_users_trailing_turn_is_never_touched(self) -> None:
        repo, store = _repo([_row("user", "plan dinner", user_id="someone-else")])

        assert await _dismiss(repo, user_id="u1") is False
        assert len(store.rows) == 1
        assert store.deletes == 0

    async def test_another_conversations_trailing_turn_is_never_touched(self) -> None:
        repo, store = _repo([_row("user", "plan dinner", conversation_id="other")])

        assert await _dismiss(repo, conv="c1") is False
        assert len(store.rows) == 1

    async def test_empty_conversation_deletes_nothing(self) -> None:
        repo, store = _repo([])

        assert await _dismiss(repo) is False
        assert store.deletes == 0

    async def test_dismissed_turn_no_longer_appears_in_history(self) -> None:
        repo, _ = _repo([_row("assistant", "hi!"), _row("user", "plan dinner")])

        await _dismiss(repo)

        history = await repo.get_history("u1", "c1")
        assert [r["content"] for r in history] == ["hi!"]


TEST_USER_ID = "test-user-123"
TEST_CONV_ID = "550e8400-e29b-41d4-a716-446655440001"


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    app = create_app()

    async def _fake_user_id() -> str:
        return TEST_USER_ID

    app.dependency_overrides[get_current_user_id] = _fake_user_id
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
class TestDismissRoute:
    async def test_route_scopes_the_delete_to_the_authenticated_user(
        self, client: AsyncClient
    ) -> None:
        repo = AsyncMock()
        repo.delete_unanswered_user_turn = AsyncMock(return_value=True)
        with patch(
            "bubbly_chef.api.routes.chat.get_repository",
            new_callable=AsyncMock,
            return_value=repo,
        ):
            res = await client.delete(f"/v1/chat/history/{TEST_CONV_ID}/unanswered")

        assert res.status_code == 200
        assert res.json() == {"deleted": True}
        repo.delete_unanswered_user_turn.assert_awaited_once_with(
            user_id=TEST_USER_ID, conversation_id=TEST_CONV_ID
        )

    async def test_route_reports_nothing_deleted(self, client: AsyncClient) -> None:
        repo = AsyncMock()
        repo.delete_unanswered_user_turn = AsyncMock(return_value=False)
        with patch(
            "bubbly_chef.api.routes.chat.get_repository",
            new_callable=AsyncMock,
            return_value=repo,
        ):
            res = await client.delete(f"/v1/chat/history/{TEST_CONV_ID}/unanswered")

        assert res.status_code == 200
        assert res.json() == {"deleted": False}

    async def test_route_surfaces_a_repository_failure_as_500(self, client: AsyncClient) -> None:
        repo = AsyncMock()
        repo.delete_unanswered_user_turn = AsyncMock(side_effect=RuntimeError("db down"))
        with patch(
            "bubbly_chef.api.routes.chat.get_repository",
            new_callable=AsyncMock,
            return_value=repo,
        ):
            res = await client.delete(f"/v1/chat/history/{TEST_CONV_ID}/unanswered")

        assert res.status_code == 500

    async def test_route_requires_auth(self) -> None:
        app = create_app()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            res = await ac.delete(f"/v1/chat/history/{TEST_CONV_ID}/unanswered")

        assert res.status_code in (401, 403)
