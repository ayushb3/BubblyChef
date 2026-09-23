"""#416 (bug 2, independent of refine-in-place): `preferred_ingredients` never
reached the generation prompt.

Root cause: the user's requested flavor ("tomato") is correctly extracted
into `RecipeConstraints.preferred_ingredients` (`recipe/nodes.py`,
`extract_recipe_constraints`), but was used ONLY to score pantry items
(`score_and_rank`, +5) -- never handed to the LLM. It was absent from both
the grounded `GROUNDED_RECIPE_SYSTEM_PROMPT.format()` call and the brainstorm
`constraints_str` builder, so an explicit ingredient request never reached
the model and pantry-grounding dominated instead.

These tests assert the string actually lands in the rendered prompt on both
paths -- following the prompt-text assertion pattern already established in
`tests/test_issue_336_recipe_card_expiry_coherence.py` (LLM output itself is
not deterministically testable).
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.workflows.recipe.nodes import (
    brainstorm_recipe_ideas,
    generate_grounded_recipe,
)
from bubbly_chef.workflows.state import LLMRecipeResult


def _mock_structured_ai() -> Any:
    """Mock for the grounded path (get_ai_manager().complete(response_schema=...))."""
    ai = MagicMock()
    ai.complete = AsyncMock(
        return_value=LLMRecipeResult(
            title="Tomato Garlic Spaghetti",
            description="d",
            ingredients=[],
            instructions=["step"],
        )
    )
    return patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager",
        MagicMock(return_value=ai),
    )


def _mock_text_ai() -> Any:
    """Mock for the brainstorm path (get_ai_manager().complete(prompt=...) -> str)."""
    ai = MagicMock()
    ai.complete = AsyncMock(return_value="1. **Tomato Garlic Pasta**\n")
    return patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager",
        MagicMock(return_value=ai),
    )


def _captured_prompt(mock_mgr: Any) -> str:
    return str(mock_mgr.return_value.complete.call_args.kwargs["prompt"])


@pytest.mark.asyncio
async def test_grounded_recipe_prompt_includes_preferred_ingredients():
    state = {
        "input_text": "Tomato Garlic Spaghetti",
        "selected_recipe_name": "Tomato Garlic Spaghetti",
        "scored_pantry_items": [],
        "pantry_snapshot": [],
        "recipe_constraints": {"preferred_ingredients": ["tomato"]},
    }
    with _mock_structured_ai() as ai:
        await generate_grounded_recipe(state)  # type: ignore[arg-type]

    prompt = _captured_prompt(ai)
    assert "Preferred flavors/ingredients" in prompt
    assert "tomato" in prompt


@pytest.mark.asyncio
async def test_grounded_recipe_prompt_omits_preferred_ingredients_when_absent():
    """No preferred_ingredients -- the placeholder still renders (no format
    KeyError) with the 'none specified' fallback, not a blank/broken line."""
    state = {
        "input_text": "Garlic Spaghetti",
        "selected_recipe_name": "Garlic Spaghetti",
        "scored_pantry_items": [],
        "pantry_snapshot": [],
        "recipe_constraints": {},
    }
    with _mock_structured_ai() as ai:
        await generate_grounded_recipe(state)  # type: ignore[arg-type]

    prompt = _captured_prompt(ai)
    assert "Preferred flavors/ingredients" in prompt
    assert "none specified" in prompt


@pytest.mark.asyncio
async def test_brainstorm_prompt_includes_preferred_ingredients():
    state = {
        "input_text": "something with tomato flavor",
        "scored_pantry_items": [],
        # use_pantry=False so this hits the LLM path directly rather than
        # the "empty pantry, nothing to suggest" early-return branch (#243)
        # that would otherwise short-circuit before any prompt is built.
        "recipe_constraints": {"preferred_ingredients": ["tomato"], "use_pantry": False},
    }
    with _mock_text_ai() as ai:
        await brainstorm_recipe_ideas(state)  # type: ignore[arg-type]

    prompt = _captured_prompt(ai)
    assert "Preferred flavors/ingredients" in prompt
    assert "tomato" in prompt
