"""Tests for issue #243 — empty pantry recipe question returns ingest prompt.

When the pantry is empty and the user asks a recipe question, the assistant
must NOT invent recipes. Instead it should return a short message surfacing the
three ingest paths: receipt scan, manual entry, and natural-language chat add.

Non-empty pantry behaviour must remain unchanged (LLM is called, recipe ideas
are returned).
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.workflows.recipe.nodes import brainstorm_recipe_ideas


def _base_state(**overrides: Any) -> dict[str, Any]:
    """Minimal WorkflowState for brainstorm_recipe_ideas."""
    state: dict[str, Any] = {
        "input_text": "what can I cook tonight?",
        "user_id": "test-user-123",
        "scored_pantry_items": [],
        "recipe_constraints": {},
        "conversation_history": [],
        "input_mode": "chat",
    }
    state.update(overrides)
    return state


@pytest.mark.asyncio
async def test_empty_pantry_returns_ingest_prompt() -> None:
    """Empty pantry + recipe question → ingest prompt, no LLM call."""
    state = _base_state(scored_pantry_items=[])

    # If the LLM were called we'd hit a real network; patching ensures it isn't.
    with patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager"
    ) as mock_get_manager:
        result = await brainstorm_recipe_ideas(state)

    # LLM must not be reached at all
    mock_get_manager.assert_not_called()

    msg: str = result["assistant_message"]

    # Must mention all three ingest paths
    assert "scan" in msg.lower(), "Receipt scan path missing from ingest prompt"
    assert "/pantry?add=scan" in msg, "Receipt scan URL missing from ingest prompt"
    assert "type" in msg.lower(), "Manual entry path missing from ingest prompt"
    assert "bought" in msg.lower() or "tell me" in msg.lower(), (
        "Natural-language ingest path missing from ingest prompt"
    )

    # No recipe brainstorm ideas generated
    assert result.get("brainstorm_ideas") == []

    # Workflow still completes cleanly
    assert result["workflow_status"] == "completed"

    # Intent must be GENERAL_CHAT so update_session_node leaves the session in
    # DEFAULT mode — not RECIPE_EXPLORING (which would cause follow-ups to be
    # treated as brainstorm selections with no ideas to pick from).
    assert result["intent"] == Intent.GENERAL_CHAT.value, (
        "Empty-pantry ingest prompt must set intent=GENERAL_CHAT to keep session in DEFAULT"
    )


@pytest.mark.asyncio
async def test_empty_pantry_no_llm_invented_recipe() -> None:
    """Empty pantry guard fires before LLM — no invented recipe content."""
    state = _base_state(scored_pantry_items=[])

    with patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager"
    ) as mock_get_manager:
        result = await brainstorm_recipe_ideas(state)

    # The guard returns before the LLM is ever reached.
    # This is the meaningful assertion — if the guard were deleted the mock
    # manager would be called and this would fail.
    mock_get_manager.assert_not_called()

    msg: str = result["assistant_message"]
    assert "ingredients" not in msg.lower(), "Response looks like an invented recipe"
    assert "instructions" not in msg.lower(), "Response looks like an invented recipe"


@pytest.mark.asyncio
async def test_empty_pantry_session_stays_in_default_mode() -> None:
    """After an ingest prompt, intent=GENERAL_CHAT keeps session in DEFAULT.

    If intent were RECIPE_BRAINSTORM, update_session_node would flip to
    RECIPE_EXPLORING and persist brainstorm_ideas=[]. A follow-up like
    "the first one" would then route as a brainstorm selection with nothing
    to select — the user gets stuck (#243).
    """
    state = _base_state(scored_pantry_items=[])

    with patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager"):
        result = await brainstorm_recipe_ideas(state)

    assert result["intent"] == Intent.GENERAL_CHAT.value
    # brainstorm_ideas being empty is correct here — nothing was brainstormed
    assert result["brainstorm_ideas"] == []


@pytest.mark.asyncio
async def test_non_empty_pantry_calls_llm_and_returns_ideas() -> None:
    """Non-empty pantry → LLM is called, ideas extracted normally."""
    pantry_item = {
        "name": "chicken",
        "quantity": 2.0,
        "unit": "breast",
        "quantity_base": None,
        "unit_base": None,
        "expiry_date": None,
        "_score": 8,
        "_must_use": False,
        "_expired": False,
    }
    state = _base_state(scored_pantry_items=[pantry_item])

    fake_response = "**Grilled Chicken** is a great choice!\n**Chicken Stir Fry** is also quick."
    mock_manager = MagicMock()
    mock_manager.complete = AsyncMock(return_value=fake_response)

    with patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager", return_value=mock_manager
    ):
        result = await brainstorm_recipe_ideas(state)

    mock_manager.complete.assert_awaited_once()

    assert "Grilled Chicken" in result["brainstorm_ideas"]
    assert "Chicken Stir Fry" in result["brainstorm_ideas"]
    assert result["assistant_message"] == fake_response


@pytest.mark.asyncio
async def test_pantry_grounding_off_with_empty_scored_items_still_calls_llm() -> None:
    """When use_pantry=False, empty scored_items is expected — LLM still runs.

    The guard must not fire when the user has explicitly opted out of pantry
    grounding, because an empty list is the intended state in that mode.
    """
    state = _base_state(
        scored_pantry_items=[],
        recipe_constraints={"use_pantry": False},
    )

    fake_response = "**Pasta Carbonara** — a classic!"
    mock_manager = MagicMock()
    mock_manager.complete = AsyncMock(return_value=fake_response)

    with patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager", return_value=mock_manager
    ):
        result = await brainstorm_recipe_ideas(state)

    mock_manager.complete.assert_awaited_once()
    assert result["assistant_message"] == fake_response
