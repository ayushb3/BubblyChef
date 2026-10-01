"""Issue #667: the meal option stage remembers every option set it showed.

The "Already suggested" prompt block used to list only the previous turn's
three options, so a third "Different ideas" tap could bring back the first
set. `MealPlanSessionState.shown_options` now keeps a rolling list (cap 9) and
the block splits "Just shown" from "Earlier".

The model is stubbed at the `AIManager` boundary; each turn feeds back the
JSON dump of the previous turn's session state, the shape the session store
really holds.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from bubbly_chef.models.meal import (
    MealDishOutline,
    MealFixedMain,
    MealOption,
    MealOptionLLM,
    MealOptionsLLMResult,
    MealPlanSessionState,
)
from bubbly_chef.models.recipe import RecipeConstraints
from bubbly_chef.workflows.meal.nodes import (
    _descriptor_key,
    _option_descriptor,
    _roll_shown_options,
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


def _set(*names: str) -> list[MealOptionLLM]:
    """One option per name; each has its own main and one side."""
    return [
        MealOptionLLM(
            title=name,
            dishes=[_dish_llm("main", f"{name} Main"), _dish_llm("side", f"{name} Side")],
        )
        for name in names
    ]


def _sequenced_ai(sets: list[list[MealOptionLLM]]) -> MagicMock:
    """Returns each option set in turn; extraction returns an empty result."""
    remaining = list(sets)

    async def _complete(*, prompt: str, response_schema: type, temperature: float = 0.7) -> Any:
        if response_schema is MealOptionsLLMResult:
            return MealOptionsLLMResult(options=remaining.pop(0), follow_ups=[])
        if response_schema is RecipeConstraints:
            return RecipeConstraints()
        raise AssertionError(f"Unexpected model call: {response_schema!r}")

    ai = MagicMock()
    ai.complete = AsyncMock(side_effect=_complete)
    return ai


def _option_prompts(ai: MagicMock) -> list[str]:
    return [
        c.kwargs["prompt"]
        for c in ai.complete.await_args_list
        if c.kwargs["response_schema"] is MealOptionsLLMResult
    ]


def _session_from(state: MealPlanSessionState) -> dict[str, Any]:
    return {"metadata": {"meal_plan": state.model_dump(mode="json")}}


def _option(title: str, *dishes: str) -> MealOption:
    return MealOption(
        option_id="opt_1",
        title=title,
        dishes=[
            MealDishOutline(role="main" if i == 0 else "side", name=d)
            for i, d in enumerate(dishes)
        ],
    )


class TestRollShownOptions:
    def test_appends_new_after_prior(self) -> None:
        assert _roll_shown_options(["A (x)"], ["B (y)"]) == ["A (x)", "B (y)"]

    def test_dedupes_on_the_whole_descriptor_case_and_space_insensitive(self) -> None:
        rolled = _roll_shown_options(
            ["Pasta Night (Pasta, Salad)", "Other (a, b)"],
            ["pasta  NIGHT (pasta,  salad)"],
        )
        # The newer entry wins, in the newer position.
        assert rolled == ["Other (a, b)", "pasta  NIGHT (pasta,  salad)"]

    def test_same_title_different_sides_are_both_kept(self) -> None:
        a = "Lemon Pasta with Salad (Lemon Pasta, Salad)"
        b = "Lemon Pasta with Salad (Lemon Pasta, Bread)"
        assert _roll_shown_options([a], [b]) == [a, b]

    def test_caps_at_nine_keeping_the_newest(self) -> None:
        prior = [f"P{i} (x)" for i in range(8)]
        new = [f"N{i} (x)" for i in range(3)]
        rolled = _roll_shown_options(prior, new)
        assert len(rolled) == 9
        assert rolled == [*prior[2:], *new]

    def test_descriptor_helpers(self) -> None:
        option = _option("Cozy Night", "Pasta", "Garlic Bread")
        assert _option_descriptor(option) == "Cozy Night (Pasta, Garlic Bread)"
        assert _descriptor_key("  Cozy   NIGHT (A) ") == "cozy night (a)"


class TestOptionHistoryAcrossTurns:
    @pytest.mark.asyncio
    async def test_third_prompt_lists_set_a_as_earlier_and_set_b_as_just_shown(self) -> None:
        set_a = _set("Alpha One", "Alpha Two", "Alpha Three")
        set_b = _set("Bravo One", "Bravo Two", "Bravo Three")
        set_c = _set("Charlie One", "Charlie Two", "Charlie Three")
        ai = _sequenced_ai([set_a, set_b, set_c])
        repo = _repo()

        session: dict[str, Any] | None = None
        with _env(repo, ai):
            for turn in range(3):
                out = await meal_options_stage(
                    _state(
                        {"meal_followup": True} if turn else None,
                        input_text="Different ideas" if turn else "Plan dinner for 2",
                        session=session,
                    )
                )
                session = _session_from(out["meal_plan_session_state"])

        prompts = _option_prompts(ai)
        assert len(prompts) == 3
        assert "Already suggested" not in prompts[0]

        just_shown, _, earlier = prompts[2].partition("Earlier:")
        assert "Just shown:" in just_shown
        for title in ("Bravo One", "Bravo Two", "Bravo Three"):
            assert title in just_shown
        assert not any(t in just_shown for t in ("Alpha One", "Alpha Two", "Alpha Three"))
        for title in ("Alpha One", "Alpha Two", "Alpha Three"):
            assert title in earlier
        # Set B is "just shown", never repeated under "Earlier".
        assert not any(t in earlier for t in ("Bravo One", "Bravo Two", "Bravo Three"))

        # The substituted block reads as one sentence, with the new tail.
        assert (
            "Already suggested in this conversation: Just shown: Bravo One (Bravo One Main, "
            "Bravo One Side); "
        ) in prompts[2]
        assert ". Earlier: Alpha One (Alpha One Main, Alpha One Side); " in prompts[2]
        assert (
            "Alpha Three Side). If the user's request refers to one of these (most likely one "
            "just shown), build on it; otherwise suggest meals different from all of them."
        ) in prompts[2]

    @pytest.mark.asyncio
    async def test_second_prompt_has_no_earlier_section(self) -> None:
        ai = _sequenced_ai([_set("Alpha One", "Alpha Two"), _set("Bravo One", "Bravo Two")])
        repo = _repo()
        with _env(repo, ai):
            first = await meal_options_stage(_state(None, input_text="Plan dinner"))
            await meal_options_stage(
                _state(
                    {"meal_followup": True},
                    input_text="Different ideas",
                    session=_session_from(first["meal_plan_session_state"]),
                )
            )
        second = _option_prompts(ai)[1]
        assert "Just shown: Alpha One" in second
        assert "Earlier:" not in second

    @pytest.mark.asyncio
    async def test_retained_state_without_shown_options_falls_back_to_its_options(self) -> None:
        legacy = MealPlanSessionState(
            options=[_option("Old One", "Main A", "Side A"), _option("Old Two", "Main B", "Side B")]
        )
        assert legacy.shown_options == []
        ai = _sequenced_ai([_set("Fresh One", "Fresh Two")])
        repo = _repo()
        with _env(repo, ai):
            out = await meal_options_stage(
                _state(
                    {"meal_followup": True},
                    input_text="Different ideas",
                    session=_session_from(legacy),
                )
            )
        prompt = _option_prompts(ai)[0]
        assert "Just shown: Old One (Main A, Side A); Old Two (Main B, Side B)" in prompt
        assert "Earlier:" not in prompt
        # The new state carries the legacy set plus this turn's.
        shown = out["meal_plan_session_state"].shown_options
        assert shown[:2] == ["Old One (Main A, Side A)", "Old Two (Main B, Side B)"]
        assert len(shown) == 4

    @pytest.mark.asyncio
    async def test_a_fresh_plan_starts_a_fresh_list(self) -> None:
        stale = MealPlanSessionState(
            options=[_option("Old One", "Main A", "Side A")],
            shown_options=["Ancient (Main, Side)", "Old One (Main A, Side A)"],
        )
        ai = _sequenced_ai([_set("Fresh One", "Fresh Two")])
        repo = _repo()
        with _env(repo, ai):
            # Not a followup: the retained state is ignored.
            out = await meal_options_stage(
                _state(None, input_text="Plan dinner for 4", session=_session_from(stale))
            )
        assert "Already suggested" not in _option_prompts(ai)[0]
        shown = out["meal_plan_session_state"].shown_options
        assert shown == [
            "Fresh One (Fresh One Main, Fresh One Side)",
            "Fresh Two (Fresh Two Main, Fresh Two Side)",
        ]

    @pytest.mark.asyncio
    async def test_fixed_main_followup_keeps_the_list_and_shows_the_sides(self) -> None:
        main = "Lemon Butter Pasta"
        retained = MealPlanSessionState(
            options=[
                _option("Lemon Butter Pasta with Broccoli", main, "Roasted Broccoli"),
                _option("Lemon Butter Pasta with Bread", main, "Garlic Bread"),
            ],
            shown_options=[
                f"Lemon Butter Pasta with Rice ({main}, Rice)",
                f"Lemon Butter Pasta with Broccoli ({main}, Roasted Broccoli)",
                f"Lemon Butter Pasta with Bread ({main}, Garlic Bread)",
            ],
            fixed_main=_saved_fixed(),
        )
        new_options = [
            MealOptionLLM(
                title="Lemon Butter Pasta with Peas",
                dishes=[_dish_llm("main", main), _dish_llm("side", "Buttered Peas")],
            ),
            MealOptionLLM(
                title="Lemon Butter Pasta with Carrots",
                dishes=[_dish_llm("main", main), _dish_llm("side", "Glazed Carrots")],
            ),
        ]
        ai = _sequenced_ai([new_options])
        repo = _repo({(_USER_A, _RID): _row()}, meal_plan_state=retained)
        with _env(repo, ai):
            out = await meal_options_stage(
                _state(
                    {"meal_followup": True},
                    input_text="Show me different sides for this main",
                    session=_session_from(retained),
                )
            )

        prompt = _option_prompts(ai)[0]
        just_shown, _, earlier = prompt.partition("Earlier:")
        assert f"({main}, Roasted Broccoli)" in just_shown
        assert f"({main}, Garlic Bread)" in just_shown
        assert f"({main}, Rice)" in earlier

        state = out["meal_plan_session_state"]
        assert isinstance(state.fixed_main, MealFixedMain)
        assert len(state.shown_options) == 5
        assert state.shown_options[-2].endswith(f"({main}, Buttered Peas)")
        assert state.shown_options[-1].endswith(f"({main}, Glazed Carrots)")
