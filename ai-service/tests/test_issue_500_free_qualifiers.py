"""Issue #500: an `<allergen>-free` qualifier clears the phrase it sits in front of.

A model told `NEVER include (allergy): gluten` writes "gluten-free pasta". The literal
term "gluten" was already rejected by the shared matcher's `-free` guard, but the foods
a broad allergy expands to (pasta, bread, flour, mayonnaise) were not, so a correct card
was flagged, regenerated, flagged again and refused. Every use of the matcher shares
the fix: the card guard, the refine guard, the meal guards, pantry pool filtering and
`must_use` stripping.

It is a safety check, so the other direction is pinned just as hard: the qualifier only
covers its own phrase, never a second food, and a plain "pasta" is still flagged.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from bubbly_chef.domain.allergens import allergens_named, drop_naming_allergen
from bubbly_chef.services.allergen_guard import AllergenViolation
from bubbly_chef.services.food_exclusions import FoodExclusions
from bubbly_chef.services.recipe_generator import (
    AIRecipeIngredient,
    AIRecipeOutput,
    generate_recipe,
)
from bubbly_chef.workflows.meal.nodes import option_allergens
from bubbly_chef.workflows.recipe.exclusions import apply_food_exclusions
from bubbly_chef.workflows.recipe.nodes import score_and_rank

# ---------------------------------------------------------------------------
# The matcher
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("allergy", "text"),
    [
        ("gluten", "gluten-free pasta"),
        ("gluten", "Gluten-Free Pasta"),
        ("gluten", "gluten free bread"),
        ("gluten", "gluten-free noodles"),
        ("gluten", "certified gluten-free oats"),
        ("gluten", "free of gluten pasta"),
        ("gluten", "no-gluten tortillas"),
        ("gluten", "pasta (gluten-free)"),
        ("gluten", "bread, gluten-free"),
        ("wheat", "wheat-free bread"),
        ("wheat", "gluten-free pasta"),
        ("egg", "egg-free mayonnaise"),
        ("dairy", "dairy-free cheese"),
        ("dairy", "dairy-free yoghurt"),
        ("milk", "dairy-free butter"),
        ("nuts", "nut-free pesto"),
        ("peanut", "peanut-free granola"),
        ("wheat", "almond flour"),
        ("gluten", "coconut flour"),
        ("wheat", "rice flour"),
    ],
)
def test_a_qualified_phrase_does_not_name_the_allergy(allergy: str, text: str) -> None:
    assert allergens_named([allergy], text) == []


@pytest.mark.parametrize(
    ("allergy", "text"),
    [
        ("gluten", "pasta"),
        ("gluten", "bread"),
        ("gluten", "flour"),
        ("wheat", "flour"),
        ("wheat", "wheat flour"),
        ("egg", "mayonnaise"),
        ("dairy", "cheese"),
        # the qualifier covers only its own phrase
        ("gluten", "pasta (not gluten-free)"),
        ("gluten", "not gluten-free pasta"),
        ("gluten", "non-gluten-free pasta"),
        ("gluten", "gluten-free bread and regular pasta"),
        ("gluten", "gluten-free soy sauce, wheat noodles"),
        ("egg", "egg-free mayonnaise and eggs"),
        ("dairy", "dairy-free cheese or butter"),
        ("nuts", "peanut-free almond butter"),
        # a qualifier for a different allergen says nothing about this one
        ("gluten", "wheat-free pasta"),
        ("dairy", "lactose-free milk"),
        ("milk", "lactose-free cheese"),
        ("peanut", "gluten-free peanut butter"),
        ("gluten", "oat flour"),
    ],
)
def test_everything_else_still_names_the_allergy(allergy: str, text: str) -> None:
    assert allergens_named([allergy], text) == [allergy]


def test_the_qualifier_is_per_allergy() -> None:
    """One field, two allergies: the gluten-free pasta clears gluten, not the peanuts."""
    assert allergens_named(["gluten", "peanut"], "gluten-free pasta with peanut sauce") == [
        "peanut"
    ]


# ---------------------------------------------------------------------------
# Every place the matcher is used
# ---------------------------------------------------------------------------


def _card(title: str, ingredients: list[str]) -> AIRecipeOutput:
    return AIRecipeOutput(
        title=title,
        description="d",
        ingredients=[AIRecipeIngredient(name=n) for n in ingredients],
        instructions=["cook"],
    )


@pytest.mark.asyncio
async def test_card_guard_accepts_a_gluten_free_card_on_the_first_try() -> None:
    ai = MagicMock()
    ai.complete = AsyncMock(
        return_value=_card("Gluten-Free Pasta Bake", ["gluten-free pasta", "tomatoes"])
    )
    result = await generate_recipe("pasta bake", [], ai, allergies=["gluten"])
    assert ai.complete.await_count == 1
    assert result.recipe.title == "Gluten-Free Pasta Bake"


@pytest.mark.asyncio
async def test_card_guard_still_refuses_plain_pasta_for_a_gluten_allergy() -> None:
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=_card("Pasta Bake", ["pasta", "tomatoes"]))
    with pytest.raises(AllergenViolation):
        await generate_recipe("pasta bake", [], ai, allergies=["gluten"])
    assert ai.complete.await_count == 2


def test_pantry_pool_keeps_a_gluten_free_row_and_drops_a_plain_one() -> None:
    rows = [{"name": "Gluten-Free Pasta"}, {"name": "Pasta"}, {"name": "Rice"}]
    names = [r["name"] for r in score_and_rank(rows, {}, ["gluten"])]
    assert names == ["Gluten-Free Pasta", "Rice"]


def test_must_use_keeps_a_gluten_free_ingredient() -> None:
    assert drop_naming_allergen(
        ["use my gluten-free bread", "regular pasta", "rice"], ["gluten"]
    ) == ["use my gluten-free bread", "rice"]
    applied = apply_food_exclusions(
        {"must_use_ingredients": ["gluten-free bread", "pasta"]},
        FoodExclusions(allergies=("gluten",)),
        "make me a sandwich",
    )
    assert applied.constraints["must_use_ingredients"] == ["gluten-free bread"]


def _option(title: str, main: str, main_ings: list[str], side: str, side_ings: list[str]) -> Any:
    from bubbly_chef.models.meal import MealDishOutlineLLM, MealOptionLLM

    return MealOptionLLM(
        title=title,
        dishes=[
            MealDishOutlineLLM(role="main", name=main, key_ingredients=main_ings),
            MealDishOutlineLLM(role="side", name=side, key_ingredients=side_ings),
        ],
    )


def test_meal_option_with_gluten_free_ingredients_is_kept() -> None:
    option = _option(
        "Gluten-Free Pasta Night",
        "Gluten-Free Pasta",
        ["gluten-free pasta"],
        "Garlic Bread (gluten-free)",
        ["gluten-free bread"],
    )
    assert option_allergens(option, ["gluten"]) == []
    plain = _option("Pasta Night", "Pasta Bake", ["pasta"], "Salad", ["lettuce"])
    assert option_allergens(plain, ["gluten"]) == ["gluten"]


def test_fixed_main_title_names_only_the_offending_allergens() -> None:
    """The user's own main carries peanut; the side brings in a different allergen."""
    option = _option("Peanut Shrimp Night", "Peanut Noodles", ["peanut sauce"], "Slaw", ["shrimp"])
    # the title names peanut and shrimp; peanut is the user's own main's, so only shrimp
    assert option_allergens(option, ["peanut", "shrimp"], skip_main=True) == ["shrimp"]
