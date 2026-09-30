"""Issue #651 §6: `SupabaseRepository.get_recent_cuisines` and
`workflows.meal.nodes._recent_cuisine_hint`.

Follows the fake-client pattern from `test_issue_493_saved_recipe_search.py`
(`_FakeClient`/`_FakeQuery` replaying canned `.select().eq()...execute()`
chains) rather than hitting a real Supabase instance. The fake query also
supports the `.not_.is_(...)` property/method pair the real postgrest client
uses -- `.not_("col", "is", "null")`, as a plain 3-arg call, is NOT the real
API (it's a property that flips a negate flag); a bug of that shape is
exactly what this repo method must not repeat.

The shared fixture (spec §6): recipes as (id, cuisine, created, cooked) --
  A: thai,    09-01, 09-28
  B: Italian, 09-27, -
  C: italian, 09-20, 09-26
  D: thai,    09-25, -
  E: mexican, 09-24, -
  F: korean,  09-29, - (a draft)
  G: french,  08-01, -
gives ['thai', 'italian']: F is excluded as a draft, G is outside the
5-sample window, and the thai/italian tie goes to thai via A (the most
recent coalesced date).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.repository.supabase_repo import SupabaseRepository
from bubbly_chef.workflows.meal.nodes import _recent_cuisine_hint

_FIXTURE_ROWS: list[dict[str, Any]] = [
    {
        "id": "A", "user_id": "u1", "cuisine": "thai",
        "created_at": "2026-09-01", "last_cooked_at": "2026-09-28", "is_draft": False,
    },
    {
        "id": "B", "user_id": "u1", "cuisine": "Italian",
        "created_at": "2026-09-27", "last_cooked_at": None, "is_draft": False,
    },
    {
        "id": "C", "user_id": "u1", "cuisine": "italian",
        "created_at": "2026-09-20", "last_cooked_at": "2026-09-26", "is_draft": False,
    },
    {
        "id": "D", "user_id": "u1", "cuisine": "thai",
        "created_at": "2026-09-25", "last_cooked_at": None, "is_draft": False,
    },
    {
        "id": "E", "user_id": "u1", "cuisine": "mexican",
        "created_at": "2026-09-24", "last_cooked_at": None, "is_draft": False,
    },
    {
        "id": "F", "user_id": "u1", "cuisine": "korean",
        "created_at": "2026-09-29", "last_cooked_at": None, "is_draft": True,
    },
    {
        "id": "G", "user_id": "u1", "cuisine": "french",
        "created_at": "2026-08-01", "last_cooked_at": None, "is_draft": False,
    },
]


class _FakeQuery:
    """Replays canned rows for a `.select().eq().not_.is_().order().limit()
    .execute()` chain -- close enough to postgrest-py's real
    `BaseFilterRequestBuilder` to exercise `.not_` as the property it really
    is (flips `negate_next`, returns `self`), not a 3-arg callable.
    """

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows
        self._eq_filters: dict[str, Any] = {}
        self._not_null_fields: set[str] = set()
        self._negate_next = False
        self._order_field: str | None = None
        self._order_desc = False
        self._limit: int | None = None

    def select(self, *_args: Any, **_kwargs: Any) -> _FakeQuery:
        return self

    def eq(self, field: str, value: Any) -> _FakeQuery:
        self._eq_filters[field] = value
        return self

    @property
    def not_(self) -> _FakeQuery:
        self._negate_next = True
        return self

    def is_(self, field: str, value: Any) -> _FakeQuery:
        if self._negate_next and value == "null":
            self._not_null_fields.add(field)
        self._negate_next = False
        return self

    def order(self, field: str, *, desc: bool = False, **_kwargs: Any) -> _FakeQuery:
        self._order_field = field
        self._order_desc = desc
        return self

    def limit(self, n: int) -> _FakeQuery:
        self._limit = n
        return self

    def execute(self) -> Any:
        rows = [
            r for r in self._rows
            if all(r.get(k) == v for k, v in self._eq_filters.items())
            and all(r.get(f) is not None for f in self._not_null_fields)
        ]
        if self._order_field:
            rows = sorted(
                rows, key=lambda r: r.get(self._order_field) or "", reverse=self._order_desc
            )
        if self._limit is not None:
            rows = rows[: self._limit]
        return type("Result", (), {"data": rows})()


class _FakeClient:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def table(self, _name: str) -> _FakeQuery:
        return _FakeQuery(self._rows)


class _RaisingClient:
    def table(self, _name: str) -> Any:
        raise RuntimeError("db down")


def _repo_for(rows: list[dict[str, Any]]) -> SupabaseRepository:
    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = _FakeClient(rows)  # type: ignore[assignment]
    return repo


@pytest.mark.asyncio
class TestGetRecentCuisines:
    async def test_shared_fixture_gives_thai_then_italian(self) -> None:
        repo = _repo_for(_FIXTURE_ROWS)
        result = await repo.get_recent_cuisines("u1")
        assert result == ["thai", "italian"]

    async def test_cross_user_isolation(self) -> None:
        rows = [{**r, "user_id": "someone-else"} for r in _FIXTURE_ROWS]
        repo = _repo_for(rows)
        result = await repo.get_recent_cuisines("u1")
        assert result == []

    async def test_no_recipes_gives_empty_list(self) -> None:
        repo = _repo_for([])
        result = await repo.get_recent_cuisines("u1")
        assert result == []

    async def test_query_error_gives_empty_list_never_raises(self) -> None:
        repo = SupabaseRepository.__new__(SupabaseRepository)
        repo.client = _RaisingClient()  # type: ignore[assignment]
        result = await repo.get_recent_cuisines("u1")
        assert result == []

    async def test_blank_and_null_cuisines_are_dropped(self) -> None:
        rows = [
            {
                "id": "1", "user_id": "u1", "cuisine": "  ",
                "created_at": "2026-09-05", "last_cooked_at": None, "is_draft": False,
            },
            {
                "id": "2", "user_id": "u1", "cuisine": None,
                "created_at": "2026-09-04", "last_cooked_at": None, "is_draft": False,
            },
            {
                "id": "3", "user_id": "u1", "cuisine": "Greek",
                "created_at": "2026-09-03", "last_cooked_at": None, "is_draft": False,
            },
        ]
        repo = _repo_for(rows)
        result = await repo.get_recent_cuisines("u1")
        assert result == ["greek"]


def _meal_repo_for_hint(*, cuisines: Any) -> MagicMock:
    """A repo whose `get_recent_cuisines` is explicitly configured -- as
    opposed to the #650 tests' bare `MagicMock()`, exercised separately
    below."""
    repo = MagicMock()
    repo.get_recent_cuisines = AsyncMock(return_value=cuisines)
    return repo


@pytest.mark.asyncio
class TestRecentCuisineHint:
    async def test_hint_names_the_top_cuisines(self) -> None:
        repo = _meal_repo_for_hint(cuisines=["thai", "italian"])
        with patch(
            "bubbly_chef.workflows.meal.nodes.get_repository",
            new_callable=AsyncMock,
            return_value=repo,
        ):
            hint = await _recent_cuisine_hint("u1")
        assert "thai, italian" in hint
        # Never names a draft's cuisine (korean, from the shared fixture's F)
        # -- get_recent_cuisines itself excludes it; this just confirms the
        # hint doesn't add anything beyond what the repo returned.
        assert "korean" not in hint

    async def test_empty_list_gives_empty_hint(self) -> None:
        repo = _meal_repo_for_hint(cuisines=[])
        with patch(
            "bubbly_chef.workflows.meal.nodes.get_repository",
            new_callable=AsyncMock,
            return_value=repo,
        ):
            hint = await _recent_cuisine_hint("u1")
        assert hint == ""

    async def test_non_list_result_treated_as_empty(self) -> None:
        repo = _meal_repo_for_hint(cuisines="not-a-list")
        with patch(
            "bubbly_chef.workflows.meal.nodes.get_repository",
            new_callable=AsyncMock,
            return_value=repo,
        ):
            hint = await _recent_cuisine_hint("u1")
        assert hint == ""

    async def test_repo_error_gives_empty_hint(self) -> None:
        repo = MagicMock()
        repo.get_recent_cuisines = AsyncMock(side_effect=RuntimeError("db down"))
        with patch(
            "bubbly_chef.workflows.meal.nodes.get_repository",
            new_callable=AsyncMock,
            return_value=repo,
        ):
            hint = await _recent_cuisine_hint("u1")
        assert hint == ""

    async def test_bare_magicmock_repo_never_raises(self) -> None:
        """The #650 test suite's `_meal_repo` helper returns a bare
        `MagicMock()` with no `get_recent_cuisines` configured -- calling
        (and awaiting) that auto-created attribute raises `TypeError`, which
        must be caught the same as any other failure (spec §6)."""
        repo = MagicMock()  # no get_recent_cuisines configured
        with patch(
            "bubbly_chef.workflows.meal.nodes.get_repository",
            new_callable=AsyncMock,
            return_value=repo,
        ):
            hint = await _recent_cuisine_hint("u1")
        assert hint == ""
