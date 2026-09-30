"""Issue #408: no meal type named means any dish.

The time-of-day default used to write `meal_type: snack` at 14:00-17:00 (and
`late-night snack` after 21:00), which was saved and inherited next turn. A
meal type is now only one the user named, on this turn or an earlier one; the
brainstorm prompts carry a neutral rule instead (the #248 guard: no breakfast
list at midnight).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.meal import MealOptionLLM, MealOptionsLLMResult
from bubbly_chef.models.recipe import RecipeConstraints
from bubbly_chef.prompts.recipe import (
    BRAINSTORM_SYSTEM_PROMPT,
    BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY,
)
from bubbly_chef.workflows.meal.nodes import meal_options_stage
from bubbly_chef.workflows.recipe.nodes import extract_recipe_constraints

from .test_issue_651_make_it_a_meal import _dish_llm, _env, _repo, _state

NEUTRAL_RULE = (
    "If no meal type is given, don't assume one from the time of day or frame "
    "the ideas as snacks; suggest ordinary dishes for any meal."
)


def _extraction_ai(extraction: RecipeConstraints) -> MagicMock:
    async def _complete(*, prompt: str, response_schema: type, temperature: float = 0.7) -> Any:
        if response_schema is RecipeConstraints:
            return extraction
        raise AssertionError(f"Unexpected model call: {response_schema!r}")

    ai = MagicMock()
    ai.complete = AsyncMock(side_effect=_complete)
    return ai


def _extract_state(prior: dict[str, Any] | None = None) -> Any:
    session = {"metadata": {"recipe_constraints": prior}} if prior else None
    return {
        "input_text": "just give me some recipe ideas",
        "user_id": "user-1",
        "session": session,
        "errors": [],
        "warnings": [],
    }


class TestExtractionNeverInventsAMealType:
    @pytest.mark.asyncio
    async def test_unset_meal_type_stays_none_with_no_prior(self) -> None:
        ai = _extraction_ai(RecipeConstraints(meal_type=None))
        with (
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            patch(
                "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
                AsyncMock(return_value=[]),
            ),
            # The clock the old default read: forces "snack" on main, and
            # `create=True` keeps the patch valid once the function is gone.
            patch(
                "bubbly_chef.workflows.recipe.nodes._default_meal_type",
                return_value="snack",
                create=True,
            ),
        ):
            out = await extract_recipe_constraints(_extract_state())
        assert out["recipe_constraints"].get("meal_type") is None

    @pytest.mark.asyncio
    async def test_a_named_meal_type_from_a_prior_turn_still_carries(self) -> None:
        ai = _extraction_ai(RecipeConstraints(meal_type=None))
        with (
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            patch(
                "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
                AsyncMock(return_value=[]),
            ),
        ):
            out = await extract_recipe_constraints(_extract_state({"meal_type": "dinner"}))
        assert out["recipe_constraints"]["meal_type"] == "dinner"


class TestBrainstormPromptsCarryTheNeutralRule:
    def test_both_brainstorm_prompts_say_so(self) -> None:
        assert NEUTRAL_RULE in BRAINSTORM_SYSTEM_PROMPT
        assert NEUTRAL_RULE in BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY


class TestMealOptionsPrompt:
    @pytest.mark.asyncio
    async def test_plan_a_meal_has_no_meal_type_line(self) -> None:
        options = [
            MealOptionLLM(
                title="Cozy Night",
                dishes=[_dish_llm("main", "Pasta"), _dish_llm("side", "Salad")],
            )
        ]
        prompts: list[str] = []

        async def _complete(
            *, prompt: str, response_schema: type, temperature: float = 0.7
        ) -> Any:
            if response_schema is MealOptionsLLMResult:
                prompts.append(prompt)
                return MealOptionsLLMResult(options=options, follow_ups=[])
            if response_schema is RecipeConstraints:
                return RecipeConstraints(meal_type=None)
            raise AssertionError(f"Unexpected model call: {response_schema!r}")

        ai = MagicMock()
        ai.complete = AsyncMock(side_effect=_complete)
        with (
            _env(_repo(), ai),
            patch(
                "bubbly_chef.workflows.recipe.nodes._default_meal_type",
                return_value="snack",
                create=True,
            ),
        ):
            await meal_options_stage(_state(None, input_text="plan a meal"))

        assert len(prompts) == 1
        assert "Meal type:" not in prompts[0]
