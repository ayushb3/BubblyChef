"""Issue #718: the meal path honours the profile's expiry-priority setting (#502).

PR #717 wired Off / Gentle / Aggressive into the brainstorm, grounded-card and
single-recipe prompts, but the meal-options path (option stage, dish expansion at the
pick stage, and the meal screen's side swap / add) kept its own hard-coded Gentle
wording, so Off still wove expiring food in and Aggressive changed nothing.

As in #502 these are rendered-prompt tests: they assert on the text the model sees, with
the model stubbed at the `AIManager` boundary (no live calls). The level is read through
the real `get_stored_expiry_priority` from a stubbed profile row, so the profile-load
point #717 added is what is exercised.

* Off        -- no expiring-items emphasis anywhere in the prompt; items stay available.
* Gentle     -- today's wording, byte for byte.
* Aggressive -- stronger wording; the #288 coherence guard stays, and an explicit dish
                request (named dish, cuisine, "Must use") still wins.
"""

from __future__ import annotations

import re
from contextlib import contextmanager
from datetime import date, timedelta
from collections.abc import Iterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.domain.expiry_priority import DEFAULT_EXPIRY_PRIORITY
from bubbly_chef.models.meal import (
    MealConstraintsEcho,
    MealDishOutlineLLM,
    MealSideAlternativesLLMResult,
)
from bubbly_chef.models.pantry import FoodCategory, PantryItem
from bubbly_chef.models.recipe import RecipeConstraints
from bubbly_chef.prompts.meal import (
    MEAL_DISH_PANTRY_BLOCK,
    MEAL_OPTIONS_SYSTEM_PROMPT,
    MEAL_OPTIONS_SYSTEM_PROMPT_NO_PANTRY,
    meal_dish_pantry_block,
    meal_options_system_prompt,
)
from bubbly_chef.workflows.meal.nodes import meal_options_stage, meal_pick_stage

from .test_issue_651_make_it_a_meal import (
    _env,
    _option_ai,
    _option_prompt,
    _pick_ai,
    _pick_state,
    _repo,
    _retained,
    _state,
)

LEVELS = ["off", "gentle", "aggressive"]

_GENTLE_EXPIRY_RULE = (
    "- Ingredients marked as expiring soon are a strong preference, not a "
    "requirement: weave them into an option where they genuinely fit a dish, and "
    "leave them out of an option where they don't belong. Don't wedge a sweet "
    "ingredient like fruit into a savoury dish unless the user asked for that "
    "combination or it's a genuine part of the cuisine in play.\n"
)

_GENTLE_DISH_BLOCK = (
    "Priority ingredients (expiring soon -- a strong preference, not a "
    "requirement): {priority_items}\n"
    "Supporting ingredients available: {supporting_items}\n"
    "Build the recipe from these ingredients where you can. For any missing "
    "ingredients, suggest pantry substitutes where possible."
)


# ---------------------------------------------------------------------------
# The prompt builders
# ---------------------------------------------------------------------------


class TestOptionsPromptByLevel:
    def test_gentle_is_todays_text(self) -> None:
        gentle = meal_options_system_prompt("gentle")
        assert _GENTLE_EXPIRY_RULE in gentle
        assert gentle == MEAL_OPTIONS_SYSTEM_PROMPT

    def test_default_level_is_gentle(self) -> None:
        assert DEFAULT_EXPIRY_PRIORITY == "gentle"
        assert meal_options_system_prompt() == MEAL_OPTIONS_SYSTEM_PROMPT

    def test_off_has_no_expiry_language_at_all(self) -> None:
        assert "expir" not in meal_options_system_prompt("off").lower()

    def test_off_keeps_the_rest_of_the_prompt(self) -> None:
        off = meal_options_system_prompt("off")
        assert "Must use" in off
        assert "Propose 3 meal options" in off
        assert "Match the cuisine, mood, and dietary restrictions" in off
        assert "Give each option a short, appetizing title" in off

    def test_aggressive_is_stronger_than_gentle(self) -> None:
        aggressive = meal_options_system_prompt("aggressive")
        assert "high priority" in aggressive
        assert "strong preference, not a requirement" not in aggressive
        assert aggressive != meal_options_system_prompt("gentle")

    def test_aggressive_keeps_the_288_coherence_guard(self) -> None:
        flat = " ".join(meal_options_system_prompt("aggressive").split())
        assert "wedge a sweet ingredient like fruit into a savoury dish" in flat
        assert "clash" in flat

    def test_aggressive_explicit_dish_request_still_wins(self) -> None:
        flat = " ".join(meal_options_system_prompt("aggressive").split())
        assert "named dish" in flat
        assert "still wins" in flat

    @pytest.mark.parametrize("level", LEVELS)
    def test_must_use_still_overrides_at_every_level(self, level: str) -> None:
        flat = " ".join(meal_options_system_prompt(level).split())  # type: ignore[arg-type]
        assert "every option must actually use them -- this overrides every other preference" in flat

    @pytest.mark.parametrize("level", LEVELS)
    def test_the_shape_rules_are_untouched(self, level: str) -> None:
        assert "Never default to exactly one side" in meal_options_system_prompt(level)  # type: ignore[arg-type]

    def test_the_no_pantry_prompt_is_a_single_text(self) -> None:
        # It carries no expiring-items rule to vary; it only forbids mentioning them.
        assert "NOT to use their pantry" in MEAL_OPTIONS_SYSTEM_PROMPT_NO_PANTRY


class TestDishPantryBlockByLevel:
    def test_gentle_is_todays_text(self) -> None:
        assert meal_dish_pantry_block("gentle") == _GENTLE_DISH_BLOCK
        assert MEAL_DISH_PANTRY_BLOCK == _GENTLE_DISH_BLOCK
        assert meal_dish_pantry_block() == _GENTLE_DISH_BLOCK

    def test_off_has_no_priority_line_or_expiry_language(self) -> None:
        off = meal_dish_pantry_block("off")
        assert "expir" not in off.lower()
        assert "Priority" not in off
        assert "{priority_items}" not in off
        assert "{supporting_items}" in off

    def test_aggressive_is_stronger_and_keeps_the_guard(self) -> None:
        flat = " ".join(meal_dish_pantry_block("aggressive").split())
        assert "use them up" in flat
        assert "strong preference, not a requirement" not in flat
        assert "wedge a sweet ingredient like fruit into a savoury dish" in flat
        assert "still wins" in flat

    @pytest.mark.parametrize("level", LEVELS)
    def test_every_level_formats_cleanly(self, level: str) -> None:
        text = meal_dish_pantry_block(level).format(  # type: ignore[arg-type]
            priority_items="spinach", supporting_items="rice"
        )
        assert "rice" in text
        assert "{" not in text


# ---------------------------------------------------------------------------
# The option stage, rendered
# ---------------------------------------------------------------------------


def _expiring_pantry() -> list[PantryItem]:
    return [
        PantryItem(
            name="spinach",
            category=FoodCategory.OTHER,
            quantity=1.0,
            expiry_date=date.today() + timedelta(days=2),
        ),
        PantryItem(name="rice", category=FoodCategory.OTHER, quantity=2.0),
    ]


@contextmanager
def _profile_level(level: str | None) -> Iterator[None]:
    """The stored profile row `get_stored_expiry_priority` reads."""
    profile_repo = MagicMock()
    profile = {} if level is None else {"expiry_priority": level}
    profile_repo.get_profile = AsyncMock(return_value=profile)
    with patch(
        "bubbly_chef.services.expiry_priority.get_repository",
        AsyncMock(return_value=profile_repo),
    ):
        yield


async def _options_prompt(level: str | None, input_text: str = "Plan dinner") -> str:
    ai = _option_ai(extraction=RecipeConstraints())
    with _env(_repo(pantry=_expiring_pantry()), ai), _profile_level(level):
        await meal_options_stage(_state(None, input_text=input_text))
    return _option_prompt(ai)


class TestOptionStageRendered:
    @pytest.mark.asyncio
    async def test_gentle_system_rule_and_pantry_label_are_todays_text(self) -> None:
        prompt = await _options_prompt("gentle")
        assert _GENTLE_EXPIRY_RULE in prompt
        assert "\nExpiring soon (weave in where it fits, not mandatory): spinach" in prompt

    @pytest.mark.asyncio
    async def test_no_stored_level_is_gentle(self) -> None:
        assert await _options_prompt(None) == await _options_prompt("gentle")

    @pytest.mark.asyncio
    async def test_off_has_no_expiring_emphasis_anywhere(self) -> None:
        prompt = await _options_prompt("off")
        assert "expir" not in prompt.lower()

    @pytest.mark.asyncio
    async def test_off_still_lists_the_expiring_item_as_available(self) -> None:
        prompt = await _options_prompt("off")
        other = re.search(r"Other available: (.*)", prompt)
        assert other is not None
        assert "spinach" in other.group(1)
        assert "rice" in other.group(1)

    @pytest.mark.asyncio
    async def test_aggressive_is_stronger_in_rule_and_label(self) -> None:
        prompt = await _options_prompt("aggressive")
        assert "high priority" in prompt
        assert "strong preference, not a requirement" not in prompt
        assert (
            "\nExpiring soon (use these up, building ideas around them where they fit): spinach"
            in prompt
        )

    @pytest.mark.asyncio
    async def test_aggressive_keeps_the_coherence_guard_and_the_explicit_request(self) -> None:
        flat = " ".join((await _options_prompt("aggressive", "A savoury chicken dinner")).split())
        assert "wedge a sweet ingredient like fruit into a savoury dish" in flat
        assert "named dish" in flat and "still wins" in flat
        assert "User: A savoury chicken dinner" in flat

    @pytest.mark.asyncio
    @pytest.mark.parametrize("level", LEVELS)
    async def test_no_pantry_turn_is_untouched_by_the_level(self, level: str) -> None:
        ai = _option_ai(extraction=RecipeConstraints(use_pantry=False))
        with _env(_repo(pantry=_expiring_pantry()), ai), _profile_level(level):
            await meal_options_stage(_state(None, input_text="Plan dinner, ignore my pantry"))
        prompt = _option_prompt(ai)
        assert prompt.startswith(MEAL_OPTIONS_SYSTEM_PROMPT_NO_PANTRY)
        assert "spinach" not in prompt

    @pytest.mark.asyncio
    async def test_a_failing_profile_read_is_gentle(self) -> None:
        ai = _option_ai(extraction=RecipeConstraints())
        boom = AsyncMock(side_effect=RuntimeError("db down"))
        with (
            _env(_repo(pantry=_expiring_pantry()), ai),
            patch("bubbly_chef.services.expiry_priority.get_repository", boom),
        ):
            await meal_options_stage(_state(None, input_text="Plan dinner"))
        assert _GENTLE_EXPIRY_RULE in _option_prompt(ai)


# ---------------------------------------------------------------------------
# The pick stage (dish expansion), rendered
# ---------------------------------------------------------------------------


async def _dish_prompts(level: str | None) -> list[str]:
    ai = _pick_ai()
    state = _pick_state(_retained(fixed=None))
    with _env(_repo(pantry=_expiring_pantry()), ai), _profile_level(level):
        out = await meal_pick_stage(state)
    assert out.get("proposal") is not None
    prompts = [c.kwargs["prompt"] for c in ai.complete.await_args_list]
    assert len(prompts) == 3  # main + two sides
    return prompts


class TestPickStageRendered:
    @pytest.mark.asyncio
    async def test_gentle_block_is_todays_text(self) -> None:
        for prompt in await _dish_prompts("gentle"):
            assert "Priority ingredients (expiring soon -- a strong preference" in prompt
            assert re.search(r"Supporting ingredients available: spinach[^\n]*, rice", prompt)

    @pytest.mark.asyncio
    async def test_no_stored_level_is_gentle(self) -> None:
        assert await _dish_prompts(None) == await _dish_prompts("gentle")

    @pytest.mark.asyncio
    async def test_off_has_no_expiring_emphasis_and_keeps_items_available(self) -> None:
        for prompt in await _dish_prompts("off"):
            assert "expir" not in prompt.lower()
            assert "Priority" not in prompt
            assert "spinach" in prompt and "rice" in prompt

    @pytest.mark.asyncio
    async def test_aggressive_promotes_the_expiring_item_with_the_stronger_block(self) -> None:
        for prompt in await _dish_prompts("aggressive"):
            flat = " ".join(prompt.split())
            assert "(expiring soon -- use them up if you can): spinach" in flat
            assert "strong preference, not a requirement" not in flat
            assert "wedge a sweet ingredient like fruit into a savoury dish" in flat
            assert "still wins" in flat


# ---------------------------------------------------------------------------
# The meal screen's side swap / add, rendered
# ---------------------------------------------------------------------------


def _loaded_meal() -> MagicMock:
    loaded = MagicMock()
    loaded.dishes = [{"role": "main", "position": 0, "recipe": {"title": "Noodles"}}]
    loaded.constraints_echo = MealConstraintsEcho()
    loaded.title = "Night"
    loaded.servings = 2
    return loaded


async def _side_alternatives_prompt(level: str) -> str:
    from bubbly_chef.workflows.meal.sides import generate_side_alternatives

    ai = MagicMock()
    ai.complete = AsyncMock(
        return_value=MealSideAlternativesLLMResult(
            alternatives=[
                MealDishOutlineLLM(role="side", name="Cucumber Salad", key_ingredients=["cucumber"])
            ]
        )
    )
    with (
        patch("bubbly_chef.workflows.meal.sides._load_meal", AsyncMock(return_value=_loaded_meal())),
        patch(
            "bubbly_chef.workflows.meal.sides._pantry_items_for_matching",
            AsyncMock(return_value=_expiring_pantry()),
        ),
        _profile_level(level),
    ):
        await generate_side_alternatives(
            user_id="user-1", meal_id="m1", position=None, repo=MagicMock(), ai_manager=ai
        )
    prompt: str = ai.complete.call_args_list[0].kwargs["prompt"]
    return prompt


class TestSideAlternativesRendered:
    @pytest.mark.asyncio
    async def test_gentle_is_todays_block(self) -> None:
        prompt = await _side_alternatives_prompt("gentle")
        assert "Priority ingredients (expiring soon -- a strong preference" in prompt
        assert re.search(r"Supporting ingredients available: spinach[^\n]*, rice", prompt)

    @pytest.mark.asyncio
    async def test_off_has_no_expiring_emphasis(self) -> None:
        prompt = await _side_alternatives_prompt("off")
        assert "expir" not in prompt.lower()
        assert "spinach" in prompt

    @pytest.mark.asyncio
    async def test_aggressive_is_stronger(self) -> None:
        flat = " ".join((await _side_alternatives_prompt("aggressive")).split())
        assert "(expiring soon -- use them up if you can): spinach" in flat
        assert "wedge a sweet ingredient like fruit into a savoury dish" in flat


async def _expanded_side_prompt(level: str) -> str:
    from bubbly_chef.models.meal import MealDishOutline
    from bubbly_chef.workflows.meal.sides import expand_meal_dish

    ai = _pick_ai()
    with (
        patch("bubbly_chef.workflows.meal.sides._load_meal", AsyncMock(return_value=_loaded_meal())),
        patch(
            "bubbly_chef.workflows.meal.sides._pantry_items_for_matching",
            AsyncMock(return_value=_expiring_pantry()),
        ),
        _profile_level(level),
    ):
        await expand_meal_dish(
            user_id="user-1",
            meal_id="m1",
            position=1,
            outline=MealDishOutline(role="side", name="Slaw"),
            repo=MagicMock(),
            ai_manager=ai,
        )
    prompt: str = ai.complete.call_args_list[0].kwargs["prompt"]
    return prompt


class TestExpandMealDishRendered:
    @pytest.mark.asyncio
    async def test_off_has_no_expiring_emphasis(self) -> None:
        prompt = await _expanded_side_prompt("off")
        assert "expir" not in prompt.lower()
        assert "spinach" in prompt

    @pytest.mark.asyncio
    async def test_aggressive_is_stronger(self) -> None:
        flat = " ".join((await _expanded_side_prompt("aggressive")).split())
        assert "(expiring soon -- use them up if you can): spinach" in flat

    @pytest.mark.asyncio
    async def test_gentle_is_todays_block(self) -> None:
        prompt = await _expanded_side_prompt("gentle")
        assert "Priority ingredients (expiring soon -- a strong preference" in prompt
