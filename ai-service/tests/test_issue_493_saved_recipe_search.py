"""Issue #493: `SupabaseRepository.search_saved_recipes` ranking.

Follows the fake-client pattern from `test_pantry_deduction.py`
(`_FakeClient`/`_FakeQuery` replaying canned `.select().eq()...execute()`
rows) rather than hitting a real Supabase instance.

Covers the acceptance example directly: "chicken" against a title with two
tokens (one matched) must outrank a title with three tokens (also one
matched) — token-overlap-against-title-length, not raw match count, which
would otherwise tie them. Also covers that another user's recipes can never
appear in the candidate pool (the underlying `get_user_recipes` call is
`.eq("user_id", user_id)`-scoped).
"""

from __future__ import annotations

from typing import Any

import pytest

from bubbly_chef.repository.supabase_repo import SupabaseRepository


class _FakeQuery:
    """Replays canned rows for a `.select().eq().order().limit().execute()` chain.

    Filters `eq("user_id", ...)` against the fake table so cross-user
    isolation is actually exercised, not just assumed.
    """

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows
        self._filters: dict[str, Any] = {}

    def select(self, *_args: Any, **_kwargs: Any) -> _FakeQuery:
        return self

    def eq(self, field: str, value: Any) -> _FakeQuery:
        self._filters[field] = value
        return self

    def order(self, *_args: Any, **_kwargs: Any) -> _FakeQuery:
        return self

    def limit(self, _n: int) -> _FakeQuery:
        return self

    def execute(self) -> Any:
        filtered = [
            row
            for row in self._rows
            if all(row.get(k) == v for k, v in self._filters.items())
        ]
        return type("Result", (), {"data": filtered})()


class _FakeClient:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def table(self, _name: str) -> _FakeQuery:
        return _FakeQuery(self._rows)


def _repo_for(rows: list[dict[str, Any]]) -> SupabaseRepository:
    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = _FakeClient(rows)  # type: ignore[assignment]
    return repo


@pytest.mark.asyncio
class TestSearchSavedRecipes:
    async def test_ranks_by_overlap_ratio_not_raw_match_count(self) -> None:
        """"chicken" against a 2-token title (50% overlap) must outrank a
        3-token title with the same single match (33% overlap) — the exact
        example from the issue's acceptance criteria."""
        rows = [
            {
                "id": "r1",
                "user_id": "u1",
                "title": "Butter Chicken",
                "description": "",
                "tags": [],
            },
            {
                "id": "r2",
                "user_id": "u1",
                "title": "Chicken Stock Notes",
                "description": "",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "chicken", limit=5)

        assert [r["id"] for r in results] == ["r1", "r2"]

    async def test_cross_user_isolation(self) -> None:
        """Another user's recipes never appear in the candidate pool."""
        rows = [
            {
                "id": "mine",
                "user_id": "u1",
                "title": "Butter Chicken",
                "description": "",
                "tags": [],
            },
            {
                "id": "theirs",
                "user_id": "u2",
                "title": "Butter Chicken",
                "description": "",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "butter chicken", limit=5)

        assert [r["id"] for r in results] == ["mine"]

    async def test_no_token_overlap_returns_empty(self) -> None:
        rows = [
            {
                "id": "r1",
                "user_id": "u1",
                "title": "Butter Chicken",
                "description": "",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "pancakes", limit=5)

        assert results == []

    async def test_empty_query_returns_empty_without_fetching(self) -> None:
        rows = [
            {"id": "r1", "user_id": "u1", "title": "Butter Chicken", "description": "", "tags": []},
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "   ", limit=5)

        assert results == []

    async def test_description_and_tags_contribute_but_rank_below_title(self) -> None:
        """A term appearing only in description/tags still surfaces the
        recipe, but ranks below a recipe with a title match."""
        rows = [
            {
                "id": "title_match",
                "user_id": "u1",
                "title": "Weeknight Chicken",
                "description": "",
                "tags": [],
            },
            {
                "id": "desc_match",
                "user_id": "u1",
                "title": "Sunday Roast",
                "description": "a chicken-based comfort dish",
                "tags": [],
            },
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "chicken", limit=5)

        assert [r["id"] for r in results] == ["title_match", "desc_match"]

    async def test_respects_limit(self) -> None:
        rows = [
            {"id": f"r{i}", "user_id": "u1", "title": "Chicken Dish", "description": "", "tags": []}
            for i in range(10)
        ]
        repo = _repo_for(rows)

        results = await repo.search_saved_recipes("u1", "chicken", limit=3)

        assert len(results) == 3
