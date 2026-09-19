"""Issue #394: stored `profiles.dietary_preferences` must actually influence
recipe generation and chat, not just save into a void.

Covers:
- `get_stored_dietary_preferences`: happy path, missing profile, empty list,
  malformed column, unreachable DB (degrades, never raises), empty user_id.
- `extract_recipe_constraints` (recipe grounding): stored preferences fill in
  the `dietary` constraint when the message says nothing about diet; an
  explicit in-message ask wins over the stored default (the precedence this
  ticket calls for); an empty stored list changes nothing.
- `format_dietary_context` (chat): stored preferences are surfaced as prompt
  context with the same "default, not a prohibition" wording; no stored
  preferences yields "" so callers can concatenate unconditionally.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.recipe import RecipeConstraints
from bubbly_chef.services.dietary_preferences import get_stored_dietary_preferences
from bubbly_chef.workflows.chat.nodes import format_dietary_context
from bubbly_chef.workflows.recipe.nodes import extract_recipe_constraints


def _mock_recipe_nodes_ai(return_value: Any) -> Any:
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=return_value)
    return patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager",
        MagicMock(return_value=ai),
    )


def _base_state(input_text: str, **extra: Any) -> dict[str, Any]:
    return {
        "input_text": input_text,
        "errors": [],
        "warnings": [],
        "session": None,
        "user_id": "user-123",
        **extra,
    }


# ---------------------------------------------------------------------------
# get_stored_dietary_preferences
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_returns_stored_preferences() -> None:
    repo = MagicMock()
    repo.get_profile = AsyncMock(return_value={"dietary_preferences": ["Vegetarian", "Gluten-Free"]})
    with patch(
        "bubbly_chef.services.dietary_preferences.get_repository",
        AsyncMock(return_value=repo),
    ):
        result = await get_stored_dietary_preferences("user-123")
    assert result == ["Vegetarian", "Gluten-Free"]


@pytest.mark.asyncio
async def test_empty_preferences_list_returns_empty() -> None:
    repo = MagicMock()
    repo.get_profile = AsyncMock(return_value={"dietary_preferences": []})
    with patch(
        "bubbly_chef.services.dietary_preferences.get_repository",
        AsyncMock(return_value=repo),
    ):
        result = await get_stored_dietary_preferences("user-123")
    assert result == []


@pytest.mark.asyncio
async def test_missing_profile_row_degrades_to_empty() -> None:
    repo = MagicMock()
    repo.get_profile = AsyncMock(return_value=None)
    with patch(
        "bubbly_chef.services.dietary_preferences.get_repository",
        AsyncMock(return_value=repo),
    ):
        result = await get_stored_dietary_preferences("user-123")
    assert result == []


@pytest.mark.asyncio
async def test_malformed_column_degrades_to_empty() -> None:
    repo = MagicMock()
    repo.get_profile = AsyncMock(return_value={"dietary_preferences": "Vegetarian"})
    with patch(
        "bubbly_chef.services.dietary_preferences.get_repository",
        AsyncMock(return_value=repo),
    ):
        result = await get_stored_dietary_preferences("user-123")
    assert result == []


@pytest.mark.asyncio
async def test_unreachable_db_degrades_never_raises() -> None:
    with patch(
        "bubbly_chef.services.dietary_preferences.get_repository",
        AsyncMock(side_effect=ConnectionError("db unreachable")),
    ):
        result = await get_stored_dietary_preferences("user-123")
    assert result == []


@pytest.mark.asyncio
async def test_get_profile_raising_degrades_never_raises() -> None:
    repo = MagicMock()
    repo.get_profile = AsyncMock(side_effect=RuntimeError("boom"))
    with patch(
        "bubbly_chef.services.dietary_preferences.get_repository",
        AsyncMock(return_value=repo),
    ):
        result = await get_stored_dietary_preferences("user-123")
    assert result == []


@pytest.mark.asyncio
async def test_empty_user_id_skips_lookup_entirely() -> None:
    with patch(
        "bubbly_chef.services.dietary_preferences.get_repository",
        AsyncMock(side_effect=AssertionError("should not be called")),
    ):
        result = await get_stored_dietary_preferences("")
    assert result == []


# ---------------------------------------------------------------------------
# extract_recipe_constraints: stored preferences reach the constraints used
# for generation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stored_dietary_fills_in_when_message_says_nothing() -> None:
    """No dietary in the message or session -> stored profile default applies."""
    fresh_llm = RecipeConstraints(meal_type="dinner")  # no dietary mentioned

    with (
        _mock_recipe_nodes_ai(fresh_llm),
        patch(
            "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
            AsyncMock(return_value=["Vegetarian"]),
        ),
    ):
        result = await extract_recipe_constraints(_base_state("what should I cook tonight?"))

    assert result["recipe_constraints"]["dietary"] == ["Vegetarian"]


@pytest.mark.asyncio
async def test_explicit_message_dietary_wins_over_stored_default() -> None:
    """Precedence: an explicit ask *this message* overrides the stored default."""
    fresh_llm_explicit = RecipeConstraints(meal_type="dinner", dietary=["Vegan"])

    stored_default = AsyncMock(return_value=["Vegetarian"])

    with (
        _mock_recipe_nodes_ai(fresh_llm_explicit),
        patch(
            "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
            stored_default,
        ),
    ):
        result = await extract_recipe_constraints(_base_state("make me something vegan tonight"))

    assert result["recipe_constraints"]["dietary"] == ["Vegan"]
    # The stored-preference lookup must not even be needed to win — but it's
    # fine if it's called; what matters is it never overwrites the explicit value.
    stored_default.assert_not_called()


@pytest.mark.asyncio
async def test_empty_stored_preferences_changes_nothing() -> None:
    fresh_llm = RecipeConstraints(meal_type="dinner")

    with (
        _mock_recipe_nodes_ai(fresh_llm),
        patch(
            "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
            AsyncMock(return_value=[]),
        ),
    ):
        result = await extract_recipe_constraints(_base_state("what should I cook tonight?"))

    assert result["recipe_constraints"]["dietary"] == []


@pytest.mark.asyncio
async def test_session_inherited_dietary_wins_over_stored_default() -> None:
    """A dietary constraint carried over from an earlier turn in the same
    session also outranks the stored profile default — the user already
    made an explicit choice this conversation."""
    prior = {"dietary": ["Dairy-Free"]}
    fresh_llm = RecipeConstraints(meal_type="dinner")  # nothing new this turn
    stored_default = AsyncMock(return_value=["Vegetarian"])

    state = _base_state(
        "make me the first one",
        session={
            "conversation_id": "conv-1",
            "metadata": {"recipe_constraints": prior},
        },
    )

    with (
        _mock_recipe_nodes_ai(fresh_llm),
        patch(
            "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
            stored_default,
        ),
    ):
        result = await extract_recipe_constraints(state)

    assert result["recipe_constraints"]["dietary"] == ["Dairy-Free"]
    stored_default.assert_not_called()


@pytest.mark.asyncio
async def test_failed_profile_lookup_does_not_break_generation() -> None:
    """A dietary lookup failure degrades to no preferences, not an error."""
    fresh_llm = RecipeConstraints(meal_type="dinner")

    with (
        _mock_recipe_nodes_ai(fresh_llm),
        patch(
            "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
            AsyncMock(return_value=[]),  # dietary_preferences.py's own degrade path
        ),
    ):
        result = await extract_recipe_constraints(_base_state("what should I cook tonight?"))

    assert result["recipe_constraints"]["dietary"] == []
    assert "recipe_constraints" in result  # node completed normally, no raise


# ---------------------------------------------------------------------------
# format_dietary_context (chat)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_dietary_context_includes_stored_preferences() -> None:
    with patch(
        "bubbly_chef.workflows.chat.nodes.get_stored_dietary_preferences",
        AsyncMock(return_value=["Vegetarian", "Gluten-Free"]),
    ):
        context = await format_dietary_context(_base_state("what's for dinner?"))

    assert "Vegetarian, Gluten-Free" in context
    assert "default" in context.lower()


@pytest.mark.asyncio
async def test_chat_dietary_context_empty_when_no_preferences() -> None:
    with patch(
        "bubbly_chef.workflows.chat.nodes.get_stored_dietary_preferences",
        AsyncMock(return_value=[]),
    ):
        context = await format_dietary_context(_base_state("what's for dinner?"))

    assert context == ""
