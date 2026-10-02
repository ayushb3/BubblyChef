"""Issue #892: a spice never becomes "0.25 count Cinnamon".

The dish-expansion model is asked for a numeric `quantity` and a unit "ONLY" with
"count" as one of its examples, so a "pinch of black pepper" or "1/4 tsp cinnamon"
can come back as `{"quantity": 0.25, "unit": "count"}`. The unit is lost at the
model boundary, and the cook step chips then show "0.25 count Cinnamon". The
recipe's own unit is kept when the model gave one; an amount that rests on "count"
for a food nobody counts is dropped to "to taste" instead of being invented.
"""

from __future__ import annotations

import pytest

from bubbly_chef.domain.uncountable import is_uncountable_food
from bubbly_chef.models.recipe import Ingredient
from bubbly_chef.prompts.meal import MEAL_DISH_EXPANSION_SYSTEM_PROMPT
from bubbly_chef.prompts.recipe import grounded_recipe_system_prompt
from bubbly_chef.workflows.meal.nodes import _recipe_card_from_llm_result
from bubbly_chef.workflows.state import LLMRecipeResult


def _expansion_payload() -> LLMRecipeResult:
    """A realistic expand-dish result for Roasted Honey Glazed Carrots."""
    return LLMRecipeResult(
        title="Roasted Honey Glazed Carrots",
        servings=2,
        ingredients=[
            {"name": "Carrots", "quantity": 6, "unit": "count", "preparation": "peeled"},
            {"name": "Honey", "quantity": 2, "unit": "tablespoon"},
            {"name": "Olive oil", "quantity": 1, "unit": "tablespoon"},
            {"name": "Cinnamon", "quantity": 0.25, "unit": "count"},
            {"name": "Cumin", "quantity": 0.25, "unit": "count"},
            {"name": "Black pepper", "quantity": 0.1, "unit": "count"},
            {"name": "Paprika", "quantity": 0.25, "unit": "teaspoon"},
            {"name": "Salt", "quantity": 1, "unit": "pinch"},
            {"name": "Onion", "quantity": 0.5, "unit": "count"},
        ],
        instructions=["Roast the carrots.", "Glaze with honey and spices."],
    )


class TestExpandDishKeepsSpiceUnits:
    def test_fractional_count_spices_lose_the_count(self) -> None:
        card = _recipe_card_from_llm_result(_expansion_payload(), servings=2)
        by_name = {i.name: i for i in card.ingredients}

        for spice in ("Cinnamon", "Cumin", "Black pepper"):
            assert by_name[spice].unit is None, spice
            assert by_name[spice].quantity is None, spice

    def test_the_recipes_own_unit_survives(self) -> None:
        card = _recipe_card_from_llm_result(_expansion_payload(), servings=2)
        by_name = {i.name: i for i in card.ingredients}

        assert (by_name["Paprika"].quantity, by_name["Paprika"].unit) == (0.25, "teaspoon")
        assert (by_name["Salt"].quantity, by_name["Salt"].unit) == (1, "pinch")
        assert (by_name["Honey"].quantity, by_name["Honey"].unit) == (2, "tablespoon")
        assert (by_name["Olive oil"].quantity, by_name["Olive oil"].unit) == (1, "tablespoon")

    def test_countable_foods_keep_their_counts(self) -> None:
        card = _recipe_card_from_llm_result(_expansion_payload(), servings=2)
        by_name = {i.name: i for i in card.ingredients}

        assert (by_name["Carrots"].quantity, by_name["Carrots"].unit) == (6, "count")
        # Half an onion is a real amount.
        assert (by_name["Onion"].quantity, by_name["Onion"].unit) == (0.5, "count")


class TestIngredientBoundary:
    @pytest.mark.parametrize(
        ("name", "quantity", "unit"),
        [
            ("cinnamon", 0.25, "count"),
            ("ground cumin", 0.25, "item"),
            ("black pepper", 0.1, "count"),
            ("garlic powder", 0.5, "items"),
            ("red pepper flakes", 0.25, None),  # a fraction with no unit at all
            ("olive oil", 0.5, "count"),
            ("soy sauce", 0.25, "count"),
            ("cinnamon", 1, "count"),  # a whole "count" of a spice is as meaningless
        ],
    )
    def test_uncountable_food_with_a_count_amount_becomes_to_taste(
        self, name: str, quantity: float, unit: str | None
    ) -> None:
        ing = Ingredient(name=name, quantity=quantity, unit=unit)
        assert ing.quantity is None
        assert ing.unit is None

    @pytest.mark.parametrize(
        ("name", "quantity", "unit"),
        [
            ("cinnamon", 0.25, "tsp"),
            ("black pepper", 1, "pinch"),
            ("salt", 2, "dash"),
            ("olive oil", 2, "tbsp"),
            ("cinnamon sticks", 2, "count"),  # a stick is a countable form
            ("bell pepper", 0.5, "count"),
            ("red bell pepper", 1, "count"),
            ("jalapeno pepper", 2, "count"),
            ("eggs", 2, "count"),
            ("onion", 0.5, "count"),
            ("lemon", 0.5, None),
            ("cumin", None, None),
        ],
    )
    def test_everything_else_is_untouched(
        self, name: str, quantity: float | None, unit: str | None
    ) -> None:
        ing = Ingredient(name=name, quantity=quantity, unit=unit)
        assert (ing.quantity, ing.unit) == (quantity, unit)


class TestUncountableFood:
    @pytest.mark.parametrize(
        "name",
        [
            "Cinnamon",
            "ground cumin",
            "Black pepper",
            "salt and pepper",
            "smoked paprika",
            "garlic powder",
            "red pepper flakes",
            "olive oil",
            "apple cider vinegar",
            "soy sauce",
            "chicken broth",
            "vanilla extract",
            "all-purpose flour",
            "honey",
            "water",
            "lemon juice",
            "kosher salt, to taste",
        ],
    )
    def test_spices_powders_and_liquids(self, name: str) -> None:
        assert is_uncountable_food(name)

    @pytest.mark.parametrize(
        "name",
        [
            "carrots",
            "eggs",
            "onion",
            "bell pepper",
            "red bell pepper",
            "chili pepper",
            "cinnamon stick",
            "cinnamon sticks",
            "bay leaves",
            "chicken breast",
            "lemon",
            "garlic",
            "",
        ],
    )
    def test_countable_foods(self, name: str) -> None:
        assert not is_uncountable_food(name)


class TestPromptGuidance:
    def test_meal_dish_prompt_says_how_to_write_seasoning_amounts(self) -> None:
        prompt = MEAL_DISH_EXPANSION_SYSTEM_PROMPT
        assert '"tsp"' in prompt and '"pinch"' in prompt
        assert "never" in prompt.lower() and "count" in prompt
        # "count" is no longer offered as a generic example unit.
        assert 'e.g. "cups", "tablespoon", "g", "count"' not in prompt

    def test_recipe_prompt_says_how_to_write_seasoning_amounts(self) -> None:
        prompt = grounded_recipe_system_prompt("gentle")
        assert '"tsp"' in prompt and '"pinch"' in prompt
        assert 'e.g. "cups", "tablespoon", "g", "count"' not in prompt

