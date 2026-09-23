"""Issue #535: a subtractive tweak ("no cheese") drops the previous turn's
additions (e.g. "add mushrooms") when refining a picked recipe.

Reproduction sequence (matches the issue exactly):
1. User picks a recipe.
2. User asks to "add mushrooms" -> refine turn 1, mushrooms land in the
   recipe.
3. User asks for "no cheese" -> refine turn 2, calls
   `generate_recipe(previous_recipe=<turn 1's recipe, which has mushrooms>)`.
   Mushrooms disappear from the result even though the user never mentioned
   them.

The mechanical writeback path (session.metadata.picked_recipe ->
refine_recipe_node -> generate_recipe(previous_recipe=...)) is already
correct and covered by `test_refine_recipe_node.py` — the pinned recipe
(including mushrooms) really does reach `generate_recipe` as
`previous_recipe`. The defect is upstream of the plumbing, in
`RECIPE_FOLLOWUP_PROMPT` (`bubbly_chef/prompts/recipe.py`) itself: its only
instruction to the model is "Modify the recipe according to the user's
request. Keep the same format but adjust ingredients, instructions, or other
aspects as needed." That gives the model no anchor that ingredients/steps it
was NOT asked to touch must be preserved verbatim, so a subtractive request
("no cheese") invites the model to regenerate the dish wholesale rather than
apply a targeted diff — and anything from the prior turn that isn't
re-stated (mushrooms) is free to vanish.

Following the repo's established pattern for prompt-quality bugs (LLM output
itself is not deterministically testable — see
`test_preferred_ingredients_reach_prompt.py`'s docstring), this test asserts
on the rendered prompt text: it must instruct the model to preserve
everything from the previous recipe it was not asked to change.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.recipe import Ingredient, RecipeCard
from bubbly_chef.services.recipe_generator import AIRecipeOutput, generate_recipe


def _mock_ai(title: str = "Creamy Garlic Spaghetti") -> Any:
    ai = MagicMock()
    ai.complete = AsyncMock(
        return_value=AIRecipeOutput(
            title=title,
            description="d",
            ingredients=[],
            instructions=["step"],
        )
    )
    return ai


@pytest.mark.asyncio
async def test_followup_prompt_instructs_model_to_preserve_untouched_ingredients():
    """The rendered RECIPE_FOLLOWUP_PROMPT must tell the model that anything
    the user's request doesn't mention -- ingredients, quantities,
    instructions -- must be kept exactly as in the previous recipe. Without
    this anchor, "no cheese" (turn 2) has license to drop "mushrooms" (added
    turn 1) even though the user never asked for that.
    """
    previous_recipe = RecipeCard(
        title="Creamy Garlic Mushroom Spaghetti",
        description="Garlic pasta with mushrooms and cheese.",
        ingredients=[
            Ingredient(name="spaghetti", quantity=200, unit="g"),
            Ingredient(name="mushrooms", quantity=150, unit="g"),
            Ingredient(name="parmesan cheese", quantity=50, unit="g"),
        ],
        instructions=[
            "Boil pasta.",
            "Saute mushrooms and garlic.",
            "Toss pasta with cheese and mushrooms.",
        ],
    )

    ai = _mock_ai()
    with patch("bubbly_chef.services.recipe_generator.AIManager", MagicMock()):
        await generate_recipe(
            prompt="no cheese",
            pantry_items=[],
            ai_manager=ai,
            previous_recipe=previous_recipe,
        )

    prompt = str(ai.complete.call_args.kwargs["prompt"])

    # The prompt must anchor the model to preserve everything the user did
    # not ask to change -- ingredients, quantities, and instructions from
    # the previous recipe -- and edit only what the request forces.
    assert "keep every other ingredient" in prompt.lower() or (
        "preserve" in prompt.lower() and "exactly" in prompt.lower()
    )
