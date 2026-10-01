"""Issue #762: a "different sides" follow-up must not repeat earlier sides.

On production a fixed-main follow-up reused a side from the previous set in
every option. Two defences, both pinned here with the model stubbed at the
`AIManager` boundary: a hard prompt rule, and a deterministic post-check in the
option stage that drops any side whose normalised name was already shown. An
option left with no new side keeps its main and gets an empty sides list; there
is no regenerate loop.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from bubbly_chef.models.meal import (
    MealDishOutline,
    MealOption,
    MealOptionLLM,
    MealOptionsLLMResult,
    MealPlanSessionState,
)
from bubbly_chef.models.recipe import RecipeConstraints
from bubbly_chef.prompts.meal import MEAL_OPTIONS_FIXED_MAIN_NO_REPEAT_RULE
from bubbly_chef.workflows.meal.nodes import (
    _descriptor_dish_names,
    _shown_dish_keys,
    meal_options_stage,
)

from .test_issue_651_make_it_a_meal import (
    _RID,
    _USER_A,
    _dish_llm,
    _env,
    _repo,
    _row,
    _saved_fixed,
    _state,
)

_MAIN = "Lemon Butter Pasta"


def _shown_option(title: str, *dishes: str) -> MealOption:
    return MealOption(
        option_id="opt_1",
        title=title,
        dishes=[
            MealDishOutline(role="main" if i == 0 else "side", name=d)
            for i, d in enumerate(dishes)
        ],
    )


def _retained(*, fixed: bool) -> MealPlanSessionState:
    return MealPlanSessionState(
        options=[
            _shown_option("Pasta with Broccoli", _MAIN, "Roasted Broccoli"),
            _shown_option("Pasta with Bread", _MAIN, "Garlic Bread"),
        ],
        shown_options=[
            f"Pasta with Rice ({_MAIN}, Rice)",
            f"Pasta with Broccoli ({_MAIN}, Roasted Broccoli)",
            f"Pasta with Bread ({_MAIN}, Garlic Bread)",
        ],
        fixed_main=_saved_fixed() if fixed else None,
    )


def _fixed_option(title: str, *sides: str) -> MealOptionLLM:
    return MealOptionLLM(
        title=title,
        blurb="Model blurb that names the old sides.",
        dishes=[_dish_llm("main", _MAIN), *[_dish_llm("side", s) for s in sides]],
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


def _sent_prompt(ai: MagicMock) -> str:
    return next(
        c.kwargs["prompt"]
        for c in ai.complete.await_args_list
        if c.kwargs["response_schema"] is MealOptionsLLMResult
    )


async def _followup(
    new_options: list[MealOptionLLM], *, fixed: bool = True, text: str = "Show me different sides"
) -> tuple[Any, MagicMock]:
    retained = _retained(fixed=fixed)
    ai = _ai(new_options)
    repo = _repo({(_USER_A, _RID): _row()}, meal_plan_state=retained)
    with _env(repo, ai):
        out = await meal_options_stage(
            _state(
                {"meal_followup": True},
                input_text=text,
                session={"metadata": {"meal_plan": retained.model_dump(mode="json")}},
            )
        )
    return out, ai


class TestPromptRule:
    @pytest.mark.asyncio
    async def test_follow_up_prompt_carries_the_hard_no_repeat_rule(self) -> None:
        _, ai = await _followup([_fixed_option("A", "Buttered Peas"), _fixed_option("B", "Slaw")])
        prompt = _sent_prompt(ai)
        assert MEAL_OPTIONS_FIXED_MAIN_NO_REPEAT_RULE in prompt
        assert "Hard rule" in prompt
        assert '"Just shown"' in prompt

    @pytest.mark.asyncio
    async def test_first_fixed_main_turn_has_no_such_rule(self) -> None:
        ai = _ai([_fixed_option("A", "Buttered Peas"), _fixed_option("B", "Slaw")])
        with _env(_repo({(_USER_A, _RID): _row()}), ai):
            await meal_options_stage(_state({"meal_fixed_main": {"recipe_id": _RID}}))
        assert MEAL_OPTIONS_FIXED_MAIN_NO_REPEAT_RULE not in _sent_prompt(ai)


class TestPostCheck:
    @pytest.mark.asyncio
    async def test_repeated_sides_dropped_and_an_empty_option_keeps_its_main(self) -> None:
        out, _ = await _followup(
            [
                # A repeat (differently cased) beside a new side: only the new side stays.
                _fixed_option("Pasta with Broccoli and Peas", "roasted BROCCOLI", "Buttered Peas"),
                # Only a repeat: the option keeps its main with an empty sides list.
                _fixed_option("Pasta with Bread", "Garlic Bread"),
                # An earlier-set repeat, punctuated differently: now identical to the
                # main-only option above, so it is shown once.
                _fixed_option("Pasta with Rice", "Rice!"),
            ]
        )
        options = out["proposal"].options
        assert [[d.name for d in o.dishes] for o in options] == [
            [_MAIN, "Buttered Peas"],
            [_MAIN],
        ]
        assert [o.title for o in options] == [f"{_MAIN} with Buttered Peas", _MAIN]
        # The model's blurb described sides that are gone.
        assert all(o.blurb is None for o in options)
        names = {d.name for o in options for d in o.dishes}
        assert not names & {"Roasted Broccoli", "roasted BROCCOLI", "Garlic Bread", "Rice!"}

    @pytest.mark.asyncio
    async def test_no_regenerate_loop(self) -> None:
        _, ai = await _followup([_fixed_option("A", "Garlic Bread"), _fixed_option("B", "Rice")])
        option_calls = [
            c
            for c in ai.complete.await_args_list
            if c.kwargs["response_schema"] is MealOptionsLLMResult
        ]
        assert len(option_calls) == 1

    @pytest.mark.asyncio
    async def test_new_sides_pass_through_untouched(self) -> None:
        out, _ = await _followup(
            [
                _fixed_option("Pasta with Peas", "Buttered Peas"),
                _fixed_option("Pasta with Slaw and Carrots", "Crunchy Slaw", "Glazed Carrots"),
            ]
        )
        options = out["proposal"].options
        assert [[d.name for d in o.dishes] for o in options] == [
            [_MAIN, "Buttered Peas"],
            [_MAIN, "Crunchy Slaw", "Glazed Carrots"],
        ]
        assert options[0].title == "Pasta with Peas"
        assert options[0].blurb == "Model blurb that names the old sides."

    @pytest.mark.asyncio
    async def test_follow_up_without_a_fixed_main_keeps_a_repeated_side(self) -> None:
        # "Something quicker" on a free-form meal may legitimately keep the same
        # salad, so the deterministic check is only for a fixed main.
        new_options = [
            MealOptionLLM(
                title="Quick Pasta",
                dishes=[_dish_llm("main", "Aglio e Olio"), _dish_llm("side", "Roasted Broccoli")],
            ),
            MealOptionLLM(
                title="Quick Rice",
                dishes=[_dish_llm("main", "Egg Fried Rice"), _dish_llm("side", "Cucumber Salad")],
            ),
        ]
        out, ai = await _followup(new_options, fixed=False, text="Something quicker")
        assert MEAL_OPTIONS_FIXED_MAIN_NO_REPEAT_RULE not in _sent_prompt(ai)
        sides = [d.name for o in out["proposal"].options for d in o.dishes if d.role == "side"]
        assert sides == ["Roasted Broccoli", "Cucumber Salad"]


class TestShownDishKeys:
    def test_descriptor_dish_names(self) -> None:
        assert _descriptor_dish_names("Pasta (Pasta, Garlic Bread)") == ["Pasta", "Garlic Bread"]
        assert _descriptor_dish_names("Mac (and cheese) (Mac, Slaw)") == ["Mac", "Slaw"]

    def test_keys_are_normalised_and_combine_latest_and_earlier(self) -> None:
        keys = _shown_dish_keys(
            ["Old (Main, Rice-Bowl.)"], [_shown_option("New", "Main", "Garlic  Bread")]
        )
        assert {"rice bowl", "garlic bread", "main"} <= keys
