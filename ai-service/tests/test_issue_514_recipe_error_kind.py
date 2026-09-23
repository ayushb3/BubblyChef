"""Issue #514, decision 2 — recipe generation/refinement surface a kind-aware
message on a `NoProviderAvailableError`, instead of the generic "Please try
again" that also covers unrelated failures (bad LLM output, parse errors).

Narrow by design: only `generate_grounded_recipe` and `refine_recipe_node`
gain a `NoProviderAvailableError` branch; everything else (ValueError from an
unexpected response type, parse failures) keeps the existing generic message.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.models.base import Intent
from bubbly_chef.workflows.recipe.nodes import generate_grounded_recipe, refine_recipe_node


def _quota_error() -> NoProviderAvailableError:
    return NoProviderAvailableError(
        "All providers failed. Errors: [quota exceeded]",
        kind="quota_exhausted",
        configured=True,
    )


@pytest.mark.asyncio
async def test_generate_grounded_recipe_quota_failure_names_budget():
    state = {
        "input_text": "chicken curry",
        "user_id": "user-1",
        "errors": [],
        "warnings": [],
        "selected_recipe_name": "chicken curry",
        "recipe_constraints": {},
        "scored_pantry_items": [],
        "web_search_result": None,
    }

    ai_manager = MagicMock()
    ai_manager.complete = AsyncMock(side_effect=_quota_error())

    with patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager", return_value=ai_manager
    ):
        result = await generate_grounded_recipe(state)

    assert result["intent"] == Intent.GENERAL_CHAT.value
    message = result["assistant_message"]
    assert "Sorry, I couldn't generate a recipe" not in message, (
        f"quota failure surfaced the generic retry copy instead of budget-specific "
        f"wording: {message!r}"
    )
    assert "budget" in message.lower() or "quota" in message.lower()


@pytest.mark.asyncio
async def test_refine_recipe_node_quota_failure_names_budget():
    picked_recipe = {
        "id": "11111111-1111-1111-1111-111111111111",
        "title": "Creamy Garlic Spaghetti",
        "description": "A rich garlic pasta.",
        "ingredients": [{"name": "spaghetti", "quantity": 200, "unit": "g"}],
        "instructions": ["Boil pasta."],
    }
    state = {
        "input_text": "make it spicier",
        "user_id": "user-1",
        "errors": [],
        "warnings": [],
        "session": {"metadata": {"picked_recipe": picked_recipe}},
    }

    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])

    with (
        patch(
            "bubbly_chef.workflows.recipe.nodes._generate_recipe_followup",
            AsyncMock(side_effect=_quota_error()),
        ),
        patch(
            "bubbly_chef.workflows.recipe.nodes.get_repository",
            AsyncMock(return_value=repo),
        ),
        patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock()),
    ):
        result = await refine_recipe_node(state)

    assert result["intent"] == Intent.GENERAL_CHAT.value
    message = result["assistant_message"]
    assert "Sorry, I couldn't refine" not in message
    assert "budget" in message.lower() or "quota" in message.lower()
