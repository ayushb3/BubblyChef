"""Issue #758: meal options come back as 3 options with 0-2 sides fitted to the main.

Production returned 2 options, each with exactly one side. The prompt said
"exactly 3" but also "every option must have at least one side", and nothing
told the model a side-less main was a legitimate shape. These tests pin the
fix without calling a model: the prompt text, the response-schema bounds, and
how the option stage handles 0, 1 and 2 sides. The model is stubbed at the
`AIManager` boundary.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

from bubbly_chef.models.meal import (
    MealOptionLLM,
    MealOptionsLLMResult,
)
from bubbly_chef.models.recipe import RecipeConstraints
from bubbly_chef.prompts.meal import (
    MEAL_OPTIONS_FIXED_MAIN_BLOCK,
    MEAL_OPTIONS_SYSTEM_PROMPT,
    MEAL_OPTIONS_SYSTEM_PROMPT_NO_PANTRY,
)
from bubbly_chef.workflows.meal.nodes import _normalize_option_dishes, meal_options_stage

from .test_issue_651_make_it_a_meal import _dish_llm, _env, _repo, _state

_PROMPTS = [MEAL_OPTIONS_SYSTEM_PROMPT, MEAL_OPTIONS_SYSTEM_PROMPT_NO_PANTRY]


def _option(title: str, sides: int) -> MealOptionLLM:
    return MealOptionLLM(
        title=title,
        dishes=[
            _dish_llm("main", f"{title} Main"),
            *[_dish_llm("side", f"{title} Side {i + 1}") for i in range(sides)],
        ],
    )


def _ai(options: list[MealOptionLLM]) -> MagicMock:
    async def _complete(*, prompt: str, response_schema: type, temperature: float = 0.7) -> Any:
        if response_schema is MealOptionsLLMResult:
            return MealOptionsLLMResult(options=options, follow_ups=[])
        if response_schema is RecipeConstraints:
            return RecipeConstraints()
        raise AssertionError(f"Unexpected model call: {response_schema!r}")

    ai = MagicMock()
    ai.complete = AsyncMock(side_effect=_complete)
    return ai


class TestSchemaBounds:
    def test_accepts_two_or_three_options(self) -> None:
        assert len(MealOptionsLLMResult(options=[_option("A", 1), _option("B", 1)]).options) == 2
        three = [_option("A", 1), _option("B", 1), _option("C", 1)]
        assert len(MealOptionsLLMResult(options=three).options) == 3

    def test_rejects_a_single_option(self) -> None:
        with pytest.raises(ValidationError):
            MealOptionsLLMResult(options=[_option("A", 1)])

    def test_rejects_more_than_three_options(self) -> None:
        with pytest.raises(ValidationError):
            MealOptionsLLMResult(options=[_option(c, 1) for c in "ABCD"])

    def test_json_schema_tells_the_model_the_bounds(self) -> None:
        # The Gemini path embeds `model_json_schema()` in the prompt.
        options = MealOptionsLLMResult.model_json_schema()["properties"]["options"]
        assert (options["minItems"], options["maxItems"]) == (2, 3)

    def test_dish_description_allows_no_sides(self) -> None:
        field = MealOptionLLM.model_fields["dishes"]
        assert "0-2 sides" in (field.description or "")


class TestPromptText:
    @pytest.mark.parametrize("prompt", _PROMPTS)
    def test_asks_for_three_options(self, prompt: str) -> None:
        assert "propose 3 " in prompt.lower() or "propose three " in prompt.lower()
        assert "exactly 3" not in prompt

    @pytest.mark.parametrize("prompt", _PROMPTS)
    def test_two_options_only_with_a_reason(self, prompt: str) -> None:
        flat = " ".join(prompt.split())
        assert "only 2" in flat or "only two" in flat
        assert "thin" in flat or "tight" in flat

    @pytest.mark.parametrize("prompt", _PROMPTS)
    def test_sides_are_zero_to_two_and_not_always_one(self, prompt: str) -> None:
        flat = " ".join(prompt.split())
        assert "0, 1 or 2 SIDE dishes" in flat
        assert "at least one side" not in flat
        assert "Never default to exactly one side" in flat

    @pytest.mark.parametrize("prompt", _PROMPTS)
    def test_gives_an_example_of_each_shape(self, prompt: str) -> None:
        flat = " ".join(prompt.split())
        assert "no side" in flat  # the 0-side example
        assert "one side" in flat  # the 1-side example
        assert "two sides" in flat  # the 2-side example

    def test_fixed_main_block_still_demands_a_side(self) -> None:
        # "Make it a meal" is about choosing sides, so a bare main is never an option there.
        assert "1-2 sides" in MEAL_OPTIONS_FIXED_MAIN_BLOCK
        assert "never none" in MEAL_OPTIONS_FIXED_MAIN_BLOCK

    @pytest.mark.asyncio
    async def test_assembled_prompt_reaches_the_model(self) -> None:
        ai = _ai([_option("A", 1), _option("B", 0), _option("C", 2)])
        with _env(_repo(), ai):
            await meal_options_stage(_state(None, input_text="Plan dinner"))
        prompts = [
            c.kwargs["prompt"]
            for c in ai.complete.await_args_list
            if c.kwargs["response_schema"] is MealOptionsLLMResult
        ]
        assert len(prompts) == 1
        assert "Never default to exactly one side" in prompts[0]
        assert prompts[0].rstrip().endswith("Propose 3 meal options:")


class TestParserHandlesZeroToTwoSides:
    @pytest.mark.parametrize("sides", [0, 1, 2])
    def test_keeps_the_option_with_that_many_sides(self, sides: int) -> None:
        raw = [_dish_llm("main", "Main"), *[_dish_llm("side", f"S{i}") for i in range(sides)]]
        dishes = _normalize_option_dishes(raw)
        assert dishes is not None
        assert [d.role for d in dishes] == ["main", *["side"] * sides]

    def test_caps_at_two_sides(self) -> None:
        raw = [_dish_llm("main", "Main"), *[_dish_llm("side", f"S{i}") for i in range(4)]]
        dishes = _normalize_option_dishes(raw)
        assert dishes is not None and len(dishes) == 3

    def test_extra_main_is_demoted_to_a_side(self) -> None:
        dishes = _normalize_option_dishes([_dish_llm("main", "A"), _dish_llm("main", "B")])
        assert dishes is not None
        assert [(d.role, d.name) for d in dishes] == [("main", "A"), ("side", "B")]

    def test_no_dishes_at_all_is_dropped(self) -> None:
        assert _normalize_option_dishes([]) is None


class TestOptionStageEndToEnd:
    @pytest.mark.asyncio
    async def test_three_options_with_zero_one_and_two_sides_all_survive(self) -> None:
        ai = _ai([_option("Curry Night", 0), _option("Roast Night", 1), _option("Feast", 2)])
        with _env(_repo(), ai):
            out = await meal_options_stage(_state(None, input_text="Plan dinner"))
        options = out["meal_plan_session_state"].options
        assert [len(o.dishes) - 1 for o in options] == [0, 1, 2]
        assert [o.option_id for o in options] == ["opt_1", "opt_2", "opt_3"]

    @pytest.mark.asyncio
    async def test_two_options_are_accepted(self) -> None:
        ai = _ai([_option("Soup", 0), _option("Pasta", 1)])
        with _env(_repo(), ai):
            out = await meal_options_stage(_state(None, input_text="Plan dinner"))
        assert len(out["meal_plan_session_state"].options) == 2
        assert "three" not in out["assistant_message"]
