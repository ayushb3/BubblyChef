"""refine_recipe_node — #416 AC1 refine-in-place engine wiring.

Root cause: a `recipe_card` follow-up on an already-pinned recipe ("make it
spicier", "something with tomato flavor instead") was dispatched to
`research_recipe -> generate_grounded_recipe`, which builds a brand-new
standalone recipe from `selected_recipe_name or input_text` and never reads
the pinned recipe. `refine_recipe_node` fixes this by reusing the existing,
already-shipped follow-up engine — `services/recipe_generator.py::
generate_recipe(previous_recipe=...)`, the same function `/v1/recipes/refine`
calls — instead of reimplementing the follow-up prompt.

These tests assert the node:
1. Loads `picked_recipe` from `session.metadata.picked_recipe` and passes it
   as `previous_recipe` to `generate_recipe` (not a from-scratch call).
2. Preserves the pinned recipe's id on the returned card (in-place identity).
3. Falls back gracefully (general_chat) when no recipe is pinned.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from bubbly_chef.models.base import Intent, WorkflowStatus
from bubbly_chef.models.recipe import RecipeCard
from bubbly_chef.services.recipe_generator import (
    GenerateRecipeResponse,
    IngredientStatus,
)
from bubbly_chef.workflows.recipe.nodes import refine_recipe_node


def _picked_recipe_dict(recipe_id) -> dict:
    return {
        "id": str(recipe_id),
        "title": "Creamy Garlic Spaghetti",
        "description": "A rich garlic pasta.",
        "ingredients": [
            {"name": "spaghetti", "quantity": 200, "unit": "g"},
            {"name": "garlic", "quantity": 3, "unit": "cloves"},
        ],
        "instructions": ["Boil pasta.", "Saute garlic.", "Toss together."],
    }


def _state(input_text: str, picked_recipe: dict | None):
    return {
        "input_text": input_text,
        "user_id": "user-1",
        "errors": [],
        "warnings": [],
        "session": {"metadata": {"picked_recipe": picked_recipe}},
    }


@pytest.mark.asyncio
async def test_refine_recipe_node_passes_pinned_recipe_as_previous_recipe():
    """The engine call must receive the PINNED recipe as previous_recipe, not
    generate a fresh standalone dish from input_text alone."""
    recipe_id = uuid4()
    picked = _picked_recipe_dict(recipe_id)

    refined_card = RecipeCard(
        title="Creamy Tomato Garlic Spaghetti",
        description="Now with tomato.",
        ingredients=[],
        instructions=["Boil pasta.", "Saute garlic and tomato.", "Toss together."],
    )
    fake_response = GenerateRecipeResponse(
        recipe=refined_card,
        ingredients_status=[
            IngredientStatus(ingredient_name="spaghetti", status="have"),
            IngredientStatus(ingredient_name="tomato", status="missing"),
        ],
        missing_count=1,
        have_count=1,
        partial_count=0,
        pantry_match_score=0.5,
    )

    gen_recipe_mock = AsyncMock(return_value=fake_response)
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])

    with (
        patch(
            "bubbly_chef.workflows.recipe.nodes._generate_recipe_followup",
            gen_recipe_mock,
        ),
        patch(
            "bubbly_chef.workflows.recipe.nodes.get_repository",
            AsyncMock(return_value=repo),
        ),
        patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock()),
    ):
        result = await refine_recipe_node(
            _state("something with tomato flavor instead", picked)
        )

    # The engine was called with the PINNED recipe as previous_recipe, not
    # left unset (which would fall through to from-scratch generation).
    gen_recipe_mock.assert_awaited_once()
    call_kwargs = gen_recipe_mock.await_args.kwargs
    assert call_kwargs["previous_recipe"] is not None
    assert call_kwargs["previous_recipe"].title == "Creamy Garlic Spaghetti"
    assert call_kwargs["prompt"] == "something with tomato flavor instead"

    # Recipe id is preserved (in-place identity) even though the LLM output
    # carries a freshly-generated default id.
    assert result["intent"] == Intent.RECIPE_CARD.value
    assert result["proposal"].recipe.id == recipe_id
    assert result["proposal"].recipe.title == "Creamy Tomato Garlic Spaghetti"
    assert result["workflow_status"] == WorkflowStatus.AWAITING_REVIEW.value


@pytest.mark.asyncio
async def test_refine_recipe_node_without_pinned_recipe_falls_back_gracefully():
    """No picked_recipe in session -- must not crash; falls back to a plain
    chat response asking the user to pick a recipe first."""
    with patch(
        "bubbly_chef.workflows.recipe.nodes._generate_recipe_followup"
    ) as gen_recipe_mock:
        result = await refine_recipe_node(_state("make it spicier", None))

    gen_recipe_mock.assert_not_called()
    assert result["intent"] == Intent.GENERAL_CHAT.value
    assert result["proposal"] is None
