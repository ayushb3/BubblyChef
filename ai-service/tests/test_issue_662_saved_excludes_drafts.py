"""Issue #662: drafts never leave `get_user_recipes`.

`recipes.is_draft = true` rows are recipes the user generated but never
saved. `get_user_recipes` (the candidate pool for `search_saved_recipes`, the
lookup's browse branch and the dashboard suggestion) had no draft filter, so
all three could name a recipe the user never saved. The fix filters at that
one place, with the same `eq("is_draft", False)` the recipe library uses.

Runs on the #493 fake client, whose `eq` treats a missing `is_draft` key as
`False` (the column default).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from bubbly_chef.workflows.chat.nodes import saved_recipe_lookup_response

from .test_issue_493_saved_recipe_search import _repo_for


def _row(recipe_id: str, title: str, *, is_draft: bool | None = None) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": recipe_id,
        "user_id": "u1",
        "title": title,
        "description": "",
        "tags": [],
    }
    if is_draft is not None:
        row["is_draft"] = is_draft
    return row


@pytest.mark.asyncio
async def test_get_user_recipes_returns_only_saved_rows() -> None:
    repo = _repo_for(
        [
            _row("saved", "Saved Curry", is_draft=False),
            _row("draft", "Draft Curry", is_draft=True),
            _row("legacy", "Legacy Curry"),  # no is_draft key: the column default, false
        ]
    )
    rows = await repo.get_user_recipes("u1")
    assert {r["id"] for r in rows} == {"saved", "legacy"}


@pytest.mark.asyncio
async def test_search_saved_recipes_never_returns_a_draft() -> None:
    repo = _repo_for(
        [
            _row("draft", "Lemon Pasta", is_draft=True),
            _row("bake", "Lemon Pasta Bake", is_draft=False),
        ]
    )
    rows = await repo.search_saved_recipes("u1", "lemon pasta")
    assert [r["id"] for r in rows] == ["bake"]


@pytest.mark.asyncio
async def test_lookup_browse_lists_no_draft() -> None:
    repo = _repo_for(
        [
            _row("draft", "Zzz Draft Test Pasta", is_draft=True),
            _row("saved", "Butter Chicken", is_draft=False),
        ]
    )
    state: dict[str, Any] = {
        "input_text": "show me my saved recipes",
        "user_id": "u1",
        "errors": [],
    }
    with patch(
        "bubbly_chef.workflows.chat.nodes.get_repository",
        new_callable=AsyncMock,
        return_value=repo,
    ):
        result = await saved_recipe_lookup_response(state)  # type: ignore[arg-type]

    titles = [m["title"] for m in result["saved_recipe_matches"]]
    assert titles == ["Butter Chicken"]
    assert "Zzz Draft" not in result["assistant_message"]
