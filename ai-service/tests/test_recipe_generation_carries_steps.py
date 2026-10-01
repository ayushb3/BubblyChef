"""Generation paths carry structured steps on the recipe they return (issue #648).

Covers the grounded chat recipe (`generate_grounded_recipe`, which also backs
`/v1/recipes/refine`'s chat-follow-up twin `refine_recipe_node`) and the
standalone `services/recipe_generator.generate_recipe` used directly by both
`/v1/recipes/generate` and `/v1/recipes/refine`. Also pins the "invalid steps
become null rather than failing generation" fallback in both places.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.recipe import StepMetadata
from bubbly_chef.services.recipe_generator import (
    AIRecipeIngredient,
    AIRecipeOutput,
    generate_recipe,
)
from bubbly_chef.workflows.recipe.nodes import generate_grounded_recipe
from bubbly_chef.workflows.state import LLMRecipeResult


# ---------------------------------------------------------------------------
# services/recipe_generator.py::generate_recipe — /v1/recipes/generate and
# /v1/recipes/refine
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_recipe_attaches_valid_structured_steps():
    ai_manager = MagicMock()
    ai_manager.complete = AsyncMock(
        return_value=AIRecipeOutput(
            title="Tomato Pasta",
            description="Simple and quick",
            ingredients=[AIRecipeIngredient(name="pasta")],
            instructions=["Boil the pasta", "Toss with sauce"],
            steps=[
                StepMetadata(label="Boil pasta", hands_on=False, ongoing_label="the pasta boils"),
                StepMetadata(label="Toss with sauce"),
            ],
        )
    )

    result = await generate_recipe(prompt="pasta", pantry_items=[], ai_manager=ai_manager)

    assert result.recipe.steps is not None
    assert len(result.recipe.steps) == 2
    assert [s.text for s in result.recipe.steps] == result.recipe.instructions
    assert result.recipe.steps[0].hands_on is False
    assert result.recipe.steps[1].depends_on == [0]


@pytest.mark.asyncio
async def test_generate_recipe_falls_back_to_null_steps_on_count_mismatch():
    """The model's steps count doesn't match instructions -- the recipe still
    generates, just with steps=None rather than failing outright."""
    ai_manager = MagicMock()
    ai_manager.complete = AsyncMock(
        return_value=AIRecipeOutput(
            title="Tomato Pasta",
            description="Simple and quick",
            ingredients=[AIRecipeIngredient(name="pasta")],
            instructions=["Boil the pasta", "Toss with sauce"],
            steps=[StepMetadata(label="Boil pasta")],  # only one, for two instructions
        )
    )

    result = await generate_recipe(prompt="pasta", pantry_items=[], ai_manager=ai_manager)

    assert result.recipe.steps is None
    assert result.recipe.instructions == ["Boil the pasta", "Toss with sauce"]


@pytest.mark.asyncio
async def test_generate_recipe_with_no_model_steps_leaves_steps_none():
    """A model output with no steps field at all (defaults to []) is treated
    the same as a mismatch when instructions is non-empty: null, not a crash."""
    ai_manager = MagicMock()
    ai_manager.complete = AsyncMock(
        return_value=AIRecipeOutput(
            title="Tomato Pasta",
            description="d",
            ingredients=[AIRecipeIngredient(name="pasta")],
            instructions=["Boil the pasta"],
        )
    )

    result = await generate_recipe(prompt="pasta", pantry_items=[], ai_manager=ai_manager)

    assert result.recipe.steps is None


# ---------------------------------------------------------------------------
# workflows/recipe/nodes.py::generate_grounded_recipe — the chat recipe card
# ---------------------------------------------------------------------------


def _mock_ai(llm_result: LLMRecipeResult) -> Any:
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=llm_result)
    return patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager",
        MagicMock(return_value=ai),
    )


@pytest.mark.asyncio
async def test_grounded_chat_recipe_carries_structured_steps():
    llm_result = LLMRecipeResult(
        title="Chicken Potato Bake",
        description="d",
        ingredients=[{"name": "potato"}],
        instructions=["Preheat the oven", "Roast for 40 minutes"],
        steps=[
            StepMetadata(label="Preheat oven", hands_on=True),
            StepMetadata(label="Roast", hands_on=False, ongoing_label="it roasts"),
        ],
    )
    state = {
        "input_text": "Chicken Potato Bake",
        "selected_recipe_name": "Chicken Potato Bake",
        "scored_pantry_items": [],
        "pantry_snapshot": [],
        "recipe_constraints": {},
    }

    with _mock_ai(llm_result):
        result = await generate_grounded_recipe(state)  # type: ignore[arg-type]

    recipe = result["proposal"].recipe
    assert recipe.steps is not None
    assert len(recipe.steps) == 2
    assert recipe.steps[0].text == "Preheat the oven"
    assert recipe.steps[1].hands_on is False
    assert recipe.steps[1].duration_minutes == 40  # estimated from "40 minutes" in the text


@pytest.mark.asyncio
async def test_grounded_chat_recipe_falls_back_to_null_steps_on_mismatch():
    llm_result = LLMRecipeResult(
        title="Chicken Potato Bake",
        description="d",
        ingredients=[{"name": "potato"}],
        instructions=["Preheat the oven", "Roast for 40 minutes"],
        steps=[StepMetadata(label="Preheat oven")],  # count mismatch
    )
    state = {
        "input_text": "Chicken Potato Bake",
        "selected_recipe_name": "Chicken Potato Bake",
        "scored_pantry_items": [],
        "pantry_snapshot": [],
        "recipe_constraints": {},
    }

    with _mock_ai(llm_result):
        result = await generate_grounded_recipe(state)  # type: ignore[arg-type]

    assert result["proposal"].recipe.steps is None
