"""Issue #847 — a Retry after a persisted-but-unanswered user turn must not
store the same user message twice.

``POST /v1/chat/stream`` saves the user turn BEFORE the reply stream starts
(``api/routes/chat.py``), so a stream that dies mid-reply, a server ``error``
event or a late 5xx all leave the user turn in ``conversation_history`` with no
assistant reply after it. The client's Retry resends the identical text, which
used to insert a second identical row (a duplicate bubble on the next resume).

``SupabaseRepository.save_message`` now reuses the trailing row instead: when the
conversation's last stored message is a user turn with identical text (so no
assistant reply sits after it), a second user save is a no-op.
"""

from __future__ import annotations

from typing import Any

import pytest

from bubbly_chef.repository.supabase_repo import SupabaseRepository


class _Query:
    """Fluent stub over an in-memory ``conversation_history`` table. It honours
    ``eq`` filters and ``order(..., desc=True)`` + ``limit`` like PostgREST."""

    def __init__(self, store: "_Store") -> None:
        self._store = store
        self._filters: dict[str, Any] = {}
        self._desc = False
        self._limit: int | None = None
        self._insert: dict[str, Any] | None = None

    def select(self, *_args: Any, **_kwargs: Any) -> "_Query":
        return self

    def insert(self, payload: dict[str, Any]) -> "_Query":
        self._insert = payload
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
        if self._insert is not None:
            self._store.inserts.append(self._insert)
            self._store.rows.append(self._insert)
            return type("Result", (), {"data": [self._insert]})()
        rows = [
            r for r in self._store.rows if all(r.get(k) == v for k, v in self._filters.items())
        ]
        if self._desc:
            rows = list(reversed(rows))
        if self._limit is not None:
            rows = rows[: self._limit]
        return type("Result", (), {"data": rows})()


class _Store:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.inserts: list[dict[str, Any]] = []

    def table(self, _name: str) -> _Query:
        return _Query(self)


def _row(role: str, content: str, conversation_id: str = "c1") -> dict[str, Any]:
    return {"user_id": "u1", "conversation_id": conversation_id, "role": role, "content": content}


def _repo(rows: list[dict[str, Any]]) -> tuple[SupabaseRepository, _Store]:
    store = _Store(rows)
    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = store  # type: ignore[assignment]
    return repo, store


async def _save_user(repo: SupabaseRepository, text: str, conversation_id: str = "c1") -> None:
    await repo.save_message(
        user_id="u1", conversation_id=conversation_id, role="user", content=text
    )


@pytest.mark.asyncio
class TestUserTurnDedupe:
    async def test_retry_of_unanswered_user_turn_is_not_stored_twice(self) -> None:
        """The headline case: first send persisted, the stream died, Retry resends."""
        repo, store = _repo([_row("assistant", "hi!"), _row("user", "plan dinner")])

        await _save_user(repo, "plan dinner")

        assert store.inserts == []
        assert [r["content"] for r in store.rows if r["role"] == "user"] == ["plan dinner"]

    async def test_first_message_of_a_conversation_is_stored(self) -> None:
        repo, store = _repo([])

        await _save_user(repo, "plan dinner")

        assert [r["content"] for r in store.inserts] == ["plan dinner"]

    async def test_same_text_after_an_assistant_reply_is_stored(self) -> None:
        """A real second ask ("yes", "thanks") after a reply is a new turn."""
        repo, store = _repo([_row("user", "plan dinner"), _row("assistant", "How about pasta?")])

        await _save_user(repo, "plan dinner")

        assert [r["content"] for r in store.inserts] == ["plan dinner"]

    async def test_different_text_after_unanswered_user_turn_is_stored(self) -> None:
        repo, store = _repo([_row("user", "plan dinner")])

        await _save_user(repo, "plan lunch")

        assert [r["content"] for r in store.inserts] == ["plan lunch"]

    async def test_other_conversations_trailing_turn_is_ignored(self) -> None:
        repo, store = _repo([_row("user", "plan dinner", conversation_id="other")])

        await _save_user(repo, "plan dinner")

        assert len(store.inserts) == 1

    async def test_assistant_saves_are_never_deduped(self) -> None:
        repo, store = _repo([_row("assistant", "How about pasta?")])

        await repo.save_message(
            user_id="u1", conversation_id="c1", role="assistant", content="How about pasta?"
        )

        assert len(store.inserts) == 1

    async def test_lookup_failure_still_stores_the_turn(self) -> None:
        """Dedupe is best effort: a failed lookup must not lose the user's message."""
        repo, store = _repo([])
        original_table = store.table
        calls = {"n": 0}

        def flaky_table(name: str) -> _Query:
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("lookup down")
            return original_table(name)

        store.table = flaky_table  # type: ignore[method-assign]

        await _save_user(repo, "plan dinner")

        assert [r["content"] for r in store.inserts] == ["plan dinner"]
