"""Issue #877: meal options can't be three variations of the same protein.

After the option stage's single structured call, a deterministic check reads each option's
main protein (a small keyword table over the main dish's ingredients) and cuisine. When two
options share both, the first is kept and ONE bounded replacement call asks for the
duplicate(s) -- never a second full regeneration. A replacement that is still a duplicate,
names an allergen or fails to arrive leaves the original in place (never below the options
we had) and the reply says so honestly.

No live model call anywhere: `AIManager` and the repository are stubs.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from bubbly_chef.models.meal import MealDishOutlineLLM, MealOptionLLM, MealOptionsLLMResult
from bubbly_chef.models.pantry import FoodCategory, PantryItem
from bubbly_chef.models.recipe import RecipeConstraints
from bubbly_chef.workflows.meal.nodes import meal_options_stage
from bubbly_chef.workflows.meal.variety import (
    main_protein,
    option_key,
    replace_duplicate_options,
)

from .test_issue_500_allergies import profile
from .test_issue_651_make_it_a_meal import _dish_llm, _env, _repo, _state


def _opt(
    title: str,
    main: str,
    ingredients: Sequence[str],
    *,
    cuisine: str | None = None,
    side: bool = True,
) -> MealOptionLLM:
    dishes: list[MealDishOutlineLLM] = [_dish_llm("main", main, list(ingredients))]
    if side:
        dishes.append(_dish_llm("side", "Green Salad", ["lettuce", "lemon"]))
    return MealOptionLLM(title=title, blurb=None, cuisine=cuisine, dishes=dishes)


def _chicken(title: str, cuisine: str | None = "Italian") -> MealOptionLLM:
    return _opt(title, f"{title} Chicken", ["chicken thighs", "garlic"], cuisine=cuisine)


def _beef(title: str = "Beef Night", cuisine: str | None = "Mexican") -> MealOptionLLM:
    return _opt(title, "Beef Tacos", ["ground beef", "tortilla"], cuisine=cuisine)


def _fish(title: str = "Fish Night", cuisine: str | None = "Thai") -> MealOptionLLM:
    return _opt(title, "Coconut Fish Curry", ["cod", "coconut milk"], cuisine=cuisine)


# ---------------------------------------------------------------------------
# The key
# ---------------------------------------------------------------------------


class TestMainProtein:
    @pytest.mark.parametrize(
        ("ingredients", "expected"),
        [
            (["chicken thighs", "garlic"], "chicken"),
            (["ground beef", "onion"], "beef"),
            (["pork belly", "ginger"], "pork"),
            (["bacon", "pasta"], "pork"),
            (["salmon fillet", "lemon"], "fish"),
            (["shrimp", "rice"], "fish"),
            (["firm tofu", "broccoli"], "tofu"),
            (["tempeh"], "tofu"),
            (["chickpeas", "tomato"], "beans"),
            (["red lentils", "cumin"], "beans"),
            (["black beans", "rice"], "beans"),
            (["eggs", "spinach"], "eggs"),
            (["lamb shoulder"], "lamb"),
            (["mushroom", "rice", "garlic"], "none"),
            ([], "none"),
        ],
    )
    def test_read_from_the_main_dishes_ingredients(
        self, ingredients: list[str], expected: str
    ) -> None:
        assert main_protein("Some Dish", ingredients) == expected

    def test_the_first_listed_protein_wins(self) -> None:
        assert main_protein("Dish", ["chicken", "black beans"]) == "chicken"
        assert main_protein("Dish", ["black beans", "chicken"]) == "beans"

    @pytest.mark.parametrize(
        "ingredient",
        ["chicken stock", "chicken broth", "egg noodles", "eggplant", "green beans", "fish sauce"],
    )
    def test_look_alikes_that_are_not_the_protein_do_not_count(self, ingredient: str) -> None:
        assert main_protein("Veg Dish", [ingredient, "rice"]) == "none"

    def test_the_dish_name_is_the_fallback_when_no_ingredient_says_it(self) -> None:
        assert main_protein("Crispy Chicken Parm", ["breadcrumbs", "mozzarella"]) == "chicken"
        assert main_protein("Crispy Chicken Parm", []) == "chicken"

    def test_ingredients_beat_the_name(self) -> None:
        assert main_protein("Chicken-Style Tofu", ["tofu"]) == "tofu"

    def test_the_key_reads_the_main_dish_not_a_side(self) -> None:
        option = MealOptionLLM(
            title="Tofu Night",
            cuisine="Thai",
            dishes=[
                _dish_llm("side", "Chicken Wings", ["chicken"]),
                _dish_llm("main", "Tofu Stir Fry", ["tofu", "broccoli"]),
            ],
        )
        assert option_key(option) == ("tofu", "thai")

    def test_the_cuisine_is_normalised(self) -> None:
        a = option_key(_chicken("A", cuisine="Italian"))
        b = option_key(_chicken("B", cuisine="  italian-style "))
        assert a == b
        assert option_key(_chicken("C", cuisine=None))[1] == ""


# ---------------------------------------------------------------------------
# The replace-once step
# ---------------------------------------------------------------------------


class _Proposer:
    """A stand-in for the bounded model call: records the extra prompt text it was given."""

    def __init__(self, answer: Sequence[MealOptionLLM] | Exception) -> None:
        self.answer = answer
        self.extras: list[str] = []

    async def __call__(self, extra: str) -> list[MealOptionLLM]:
        self.extras.append(extra)
        if isinstance(self.answer, Exception):
            raise self.answer
        return list(self.answer)


def _accept_all_sync(_option: Any) -> bool:
    return True


@pytest.mark.asyncio
class TestReplaceDuplicateOptions:
    async def _run(
        self,
        options: list[MealOptionLLM],
        proposer: _Proposer,
        *,
        request_text: str = "Plan dinner",
        accept: Any = _accept_all_sync,
    ) -> Any:
        return await replace_duplicate_options(
            options, request_text=request_text, propose=proposer, accept=accept
        )

    async def test_distinct_options_make_no_call(self) -> None:
        proposer = _Proposer([])
        options = [_chicken("A"), _beef(), _fish()]
        outcome = await self._run(options, proposer)
        assert proposer.extras == []
        assert outcome.options == options
        assert outcome.shared_protein is None

    async def test_two_duplicates_cost_exactly_one_call_and_keep_the_first(self) -> None:
        first, second, third = _chicken("A"), _chicken("B"), _chicken("C")
        beef, fish = _beef(), _fish()
        proposer = _Proposer([beef, fish])
        outcome = await self._run([first, second, third], proposer)
        assert len(proposer.extras) == 1
        assert outcome.options == [first, beef, fish]
        assert outcome.shared_protein is None

    async def test_the_replacement_prompt_names_what_stays_and_what_to_avoid(self) -> None:
        proposer = _Proposer([_beef()])
        await self._run([_chicken("Lemon Night"), _chicken("Garlic Night"), _fish()], proposer)
        extra = proposer.extras[0]
        assert "Lemon Night" in extra and "Coconut Fish Curry" in extra
        assert "Garlic Night" not in extra
        assert "chicken" in extra
        assert "exactly 1" in extra

    async def test_a_different_cuisine_is_not_a_duplicate(self) -> None:
        proposer = _Proposer([])
        options = [_chicken("A", "Italian"), _chicken("B", "Thai"), _beef()]
        outcome = await self._run(options, proposer)
        assert proposer.extras == []
        assert outcome.options == options

    async def test_a_third_option_on_one_protein_is_replaced_whatever_its_cuisine(self) -> None:
        # Live (#877): three chicken mains labelled "American", "Asian-Inspired", "Rustic".
        a, b, c = _chicken("A", "American"), _chicken("B", "Asian-Inspired"), _chicken("C", "Rustic")
        beef = _beef()
        outcome = await self._run([a, b, c], _Proposer([beef]))
        assert outcome.options == [a, b, beef]
        assert outcome.shared_protein is None

    async def test_a_replacement_cannot_be_a_third_on_a_full_protein(self) -> None:
        a, b, c = _chicken("A", "American"), _chicken("B", "Thai"), _chicken("C", "Rustic")
        outcome = await self._run([a, b, c], _Proposer([_chicken("D", "Greek")]))
        assert outcome.options == [a, b, c]
        assert outcome.shared_protein == "chicken"

    async def test_two_unknown_cuisines_count_as_the_same(self) -> None:
        proposer = _Proposer([_beef()])
        outcome = await self._run([_chicken("A", None), _chicken("B", None), _fish()], proposer)
        assert len(proposer.extras) == 1
        assert [option_key(o)[0] for o in outcome.options] == ["chicken", "beef", "fish"]

    async def test_a_meatless_main_is_never_a_duplicate(self) -> None:
        veg = [
            _opt("A", "Mushroom Risotto", ["mushroom", "rice"], cuisine="Italian"),
            _opt("B", "Pesto Pasta", ["basil", "pasta"], cuisine="Italian"),
        ]
        proposer = _Proposer([])
        outcome = await self._run(veg, proposer)
        assert proposer.extras == []
        assert outcome.options == veg

    async def test_a_replacement_that_is_still_a_duplicate_is_not_used(self) -> None:
        first, second, fish = _chicken("A"), _chicken("B"), _fish()
        outcome = await self._run([first, second, fish], _Proposer([_chicken("C")]))
        assert outcome.options == [first, second, fish]
        assert outcome.shared_protein == "chicken"

    async def test_a_replacement_the_caller_rejects_is_not_used(self) -> None:
        first, second = _chicken("A"), _chicken("B")
        outcome = await self._run(
            [first, second], _Proposer([_beef()]), accept=lambda _o: False
        )
        assert outcome.options == [first, second]
        assert outcome.shared_protein == "chicken"

    async def test_a_failed_call_leaves_the_options_alone_and_does_not_raise(self) -> None:
        first, second = _chicken("A"), _chicken("B")
        outcome = await self._run([first, second], _Proposer(RuntimeError("provider down")))
        assert outcome.options == [first, second]
        assert outcome.shared_protein == "chicken"

    async def test_an_empty_answer_leaves_the_options_alone(self) -> None:
        first, second = _chicken("A"), _chicken("B")
        outcome = await self._run([first, second], _Proposer([]))
        assert outcome.options == [first, second]
        assert outcome.shared_protein == "chicken"

    async def test_asking_for_the_protein_by_name_is_not_policed(self) -> None:
        proposer = _Proposer([_beef()])
        options = [_chicken("A"), _chicken("B"), _chicken("C")]
        outcome = await self._run(options, proposer, request_text="Use up my chicken thighs")
        assert proposer.extras == []
        assert outcome.options == options

    async def test_a_single_option_is_left_alone(self) -> None:
        proposer = _Proposer([])
        outcome = await self._run([_chicken("A")], proposer)
        assert proposer.extras == []
        assert len(outcome.options) == 1

    async def test_position_is_preserved_for_the_replaced_option(self) -> None:
        a, b, c = _chicken("A"), _fish(), _chicken("C")
        beef = _beef()
        outcome = await self._run([a, b, c], _Proposer([beef]))
        assert outcome.options == [a, b, beef]


# ---------------------------------------------------------------------------
# The option stage, end to end with a stubbed model
# ---------------------------------------------------------------------------


def _pantry() -> list[PantryItem]:
    # Everything the stubbed options use, so the to-buy cap never trims a set under test.
    names = [
        "chicken thighs", "garlic", "lettuce", "lemon", "ground beef", "tortilla", "cod",
        "coconut milk", "rice",
    ]
    return [PantryItem(name=n, category=FoodCategory.OTHER, quantity=4.0) for n in names]


def _scripted_ai(*answers: MealOptionsLLMResult | Exception) -> MagicMock:
    """Answers the option-stage call in order; constraint extraction returns nothing."""
    queue = list(answers)

    async def _complete(*, prompt: str, response_schema: type, temperature: float = 0.7) -> Any:
        if response_schema is MealOptionsLLMResult:
            nxt = queue.pop(0)
            if isinstance(nxt, Exception):
                raise nxt
            return nxt
        if response_schema is RecipeConstraints:
            return RecipeConstraints()
        raise AssertionError(f"Unexpected model call: {response_schema!r}")

    ai = MagicMock()
    ai.complete = AsyncMock(side_effect=_complete)
    return ai


def _option_calls(ai: MagicMock) -> list[Any]:
    return [
        c for c in ai.complete.await_args_list if c.kwargs["response_schema"] is MealOptionsLLMResult
    ]


async def _stage(ai: MagicMock, *, input_text: str = "Plan dinner", allergies: tuple[str, ...] = ()) -> Any:
    repo = _repo(pantry=_pantry())
    repo.get_recent_dish_titles = AsyncMock(return_value=[])
    with _env(repo, ai), profile(allergies):
        return await meal_options_stage(_state(None, input_text=input_text))


def _mains(out: Any) -> list[str]:
    return [o.dishes[0].name for o in out["proposal"].options]


@pytest.mark.asyncio
class TestOptionStage:
    async def test_three_chickens_get_one_replacement_call_and_come_out_varied(self) -> None:
        three = MealOptionsLLMResult(options=[_chicken("A"), _chicken("B"), _chicken("C")])
        fix = MealOptionsLLMResult(options=[_beef(), _fish()])
        ai = _scripted_ai(three, fix)
        out = await _stage(ai)
        assert len(_option_calls(ai)) == 2
        assert _mains(out) == ["A Chicken", "Beef Tacos", "Coconut Fish Curry"]
        assert [o.option_id for o in out["proposal"].options] == ["opt_1", "opt_2", "opt_3"]
        assert out["assistant_message"] == "Here are three meal ideas!"

    async def test_three_chickens_with_three_cuisine_labels_still_get_replaced(self) -> None:
        # The live failure: the model labelled three chicken mains with three cuisines.
        three = MealOptionsLLMResult(
            options=[
                _chicken("A", "American"),
                _chicken("B", "Asian-Inspired"),
                _chicken("C", "Rustic"),
            ]
        )
        ai = _scripted_ai(three, MealOptionsLLMResult(options=[_beef()]))
        out = await _stage(ai)
        assert len(_option_calls(ai)) == 2
        assert _mains(out) == ["A Chicken", "B Chicken", "Beef Tacos"]

    async def test_the_replacement_call_is_the_same_prompt_plus_the_replacement_block(self) -> None:
        three = MealOptionsLLMResult(options=[_chicken("A"), _chicken("B"), _chicken("C")])
        ai = _scripted_ai(three, MealOptionsLLMResult(options=[_beef(), _fish()]))
        await _stage(ai)
        first, second = (c.kwargs["prompt"] for c in _option_calls(ai))
        assert second.startswith(first)
        assert "REPLACEMENT ROUND" in second
        assert "REPLACEMENT ROUND" not in first

    async def test_distinct_options_still_cost_one_call(self) -> None:
        ai = _scripted_ai(MealOptionsLLMResult(options=[_chicken("A"), _beef(), _fish()]))
        out = await _stage(ai)
        assert len(_option_calls(ai)) == 1
        assert len(out["proposal"].options) == 3

    async def test_a_replacement_that_is_still_chicken_ships_with_an_honest_note(self) -> None:
        three = MealOptionsLLMResult(options=[_chicken("A"), _chicken("B"), _chicken("C")])
        still = MealOptionsLLMResult(options=[_chicken("D"), _chicken("E")])
        ai = _scripted_ai(three, still)
        out = await _stage(ai)
        assert len(_option_calls(ai)) == 2  # bounded: never a third
        assert len(out["proposal"].options) == 3  # never below 3
        assert "chicken" in out["assistant_message"]

    async def test_a_failing_replacement_call_still_ships_three_options(self) -> None:
        three = MealOptionsLLMResult(options=[_chicken("A"), _chicken("B"), _chicken("C")])
        ai = _scripted_ai(three, RuntimeError("provider down"))
        out = await _stage(ai)
        assert len(out["proposal"].options) == 3
        assert out["proposal"] is not None
        assert "chicken" in out["assistant_message"]

    async def test_a_replacement_naming_an_allergen_is_not_used(self) -> None:
        three = MealOptionsLLMResult(options=[_chicken("A"), _chicken("B"), _chicken("C")])
        peanut = _opt("Satay", "Peanut Beef", ["beef", "peanut sauce"], cuisine="Thai")
        ai = _scripted_ai(three, MealOptionsLLMResult(options=[peanut, _fish()]))
        out = await _stage(ai, allergies=("peanut",))
        assert "Peanut Beef" not in _mains(out)
        assert "Coconut Fish Curry" in _mains(out)
        assert len(out["proposal"].options) == 3

    async def test_naming_the_protein_in_the_request_makes_no_replacement_call(self) -> None:
        three = MealOptionsLLMResult(options=[_chicken("A"), _chicken("B"), _chicken("C")])
        ai = _scripted_ai(three)
        out = await _stage(ai, input_text="Dinner with my chicken thighs please")
        assert len(_option_calls(ai)) == 1
        assert out["assistant_message"] == "Here are three meal ideas!"

    async def test_the_option_schema_asks_for_a_cuisine(self) -> None:
        assert "cuisine" in MealOptionLLM.model_json_schema()["properties"]
