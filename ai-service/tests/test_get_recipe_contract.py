"""Contract test for SupabaseRepository.get_recipe (issues #376 / #417).

`get_recipe` used to declare `-> RecipeCard | None` while returning the raw
Supabase row, held down by a `type: ignore` at the return and another at
each caller. The declared type is now the honest dict shape. These tests pin
the declaration and the runtime shape together so they cannot drift apart
again without a test going red.
"""

from __future__ import annotations

from typing import Any, get_type_hints

import pytest

from bubbly_chef.models.recipe import RecipeCard
from bubbly_chef.repository.supabase_repo import SupabaseRepository


class _FakeQuery:
    """Replays a canned `.single()` select result and records the filters."""

    def __init__(self, store: dict[str, Any], row: dict[str, Any] | None) -> None:
        self._store = store
        self._row = row

    def select(self, *_args: Any, **_kwargs: Any) -> _FakeQuery:
        return self

    def eq(self, column: str, value: Any) -> _FakeQuery:
        self._store["filters"].append((column, value))
        return self

    def single(self) -> _FakeQuery:
        return self

    def execute(self) -> Any:
        return type("Result", (), {"data": self._row})()


class _FakeClient:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self.store: dict[str, Any] = {"filters": []}
        self._row = row

    def table(self, _name: str) -> _FakeQuery:
        return _FakeQuery(self.store, self._row)


def _repo_for(row: dict[str, Any] | None) -> tuple[SupabaseRepository, _FakeClient]:
    """Build a repository around a fake client, bypassing create_client()."""
    repo = SupabaseRepository.__new__(SupabaseRepository)
    client = _FakeClient(row)
    repo.client = client  # type: ignore[assignment]
    return repo, client


_ROW: dict[str, Any] = {
    "id": "recipe-42",
    "user_id": "user-1",
    "title": "Lemon Garlic Pasta",
    "ingredients": [{"name": "spaghetti", "quantity": 200, "unit": "g"}],
    "instructions": ["Boil pasta."],
    "tags": [],
    "times_cooked": 0,
}


def test_declared_return_type_is_the_honest_dict() -> None:
    """The annotation says dict-or-None, not RecipeCard-or-None."""
    hints = get_type_hints(SupabaseRepository.get_recipe)
    assert hints["return"] == (dict[str, Any] | None)


@pytest.mark.asyncio
async def test_returns_the_raw_row_matching_the_declared_type() -> None:
    """Runtime shape is the row as Supabase handed it back — no model wrapping."""
    repo, client = _repo_for(_ROW)

    result = await repo.get_recipe("user-1", "recipe-42")

    assert isinstance(result, dict)
    assert not isinstance(result, RecipeCard)
    assert result == _ROW
    # Callers index it as a plain mapping (recipes_ai.py, router.py).
    assert result.get("title") == "Lemon Garlic Pasta"
    assert result["ingredients"][0]["name"] == "spaghetti"
    # Both the id and the owning user are applied as filters.
    assert ("id", "recipe-42") in client.store["filters"]
    assert ("user_id", "user-1") in client.store["filters"]


@pytest.mark.asyncio
async def test_returns_none_when_no_row() -> None:
    repo, _ = _repo_for(None)

    assert await repo.get_recipe("user-1", "recipe-gone") is None
