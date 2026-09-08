"""Tests for the culinary staples feature (#305).

Covers:
- Absent staple → status=assumed, never in missing list
- Staple present in pantry → normal match + deduction (never assumed)
- Non-staple absent → still missing
- Recipe whose only unmatched ingredients are staples → fully makeable
- Assumed ingredients never reach the LLM substitution tier
- CULINARY_STAPLES set contents spot-check
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from unittest.mock import AsyncMock, MagicMock

from bubbly_chef.domain.staples import CULINARY_STAPLES, is_staple
from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.services.cook_matcher import (
    _alias_cache,
    match_ingredients,
    match_ingredients_with_llm,
    _unmatched_ingredient_names,
    _LLMMatchBatch,
)


def _make_item(
    name: str,
    qty: float,
    unit: str,
    qty_base: float | None = None,
    unit_base: str | None = None,
) -> PantryItem:
    return PantryItem(
        id=uuid.uuid4(),
        name=name,
        category=FoodCategory.OTHER,
        storage_location=StorageLocation.PANTRY,
        quantity=qty,
        unit=unit,
        quantity_base=qty_base,
        unit_base=unit_base,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


RECIPE_ID = str(uuid.uuid4())
RECIPE_TITLE = "Test Recipe"


# ---------------------------------------------------------------------------
# is_staple() — domain function
# ---------------------------------------------------------------------------


class TestIsStaple:
    def test_salt_is_a_staple(self) -> None:
        assert is_staple("salt") is True

    def test_black_pepper_is_a_staple(self) -> None:
        assert is_staple("black pepper") is True

    def test_pepper_is_a_staple(self) -> None:
        assert is_staple("pepper") is True

    def test_olive_oil_is_a_staple(self) -> None:
        assert is_staple("olive oil") is True

    def test_oil_is_a_staple(self) -> None:
        assert is_staple("oil") is True

    def test_water_is_not_a_staple(self) -> None:
        """Water is intentionally excluded — see comment in staples.py."""
        assert is_staple("water") is False

    def test_sugar_is_a_staple(self) -> None:
        assert is_staple("sugar") is True

    def test_garlic_powder_is_a_staple(self) -> None:
        assert is_staple("garlic powder") is True

    def test_cumin_is_a_staple(self) -> None:
        assert is_staple("cumin") is True

    def test_truffle_oil_is_not_a_staple(self) -> None:
        """A specialty ingredient not in the curated set must not be assumed."""
        assert is_staple("truffle oil") is False

    def test_tahini_is_not_a_staple(self) -> None:
        assert is_staple("tahini") is False

    def test_heavy_cream_is_not_a_staple(self) -> None:
        assert is_staple("heavy cream") is False

    def test_case_insensitive(self) -> None:
        """Lookups are case-insensitive."""
        assert is_staple("SALT") is True
        assert is_staple("Black Pepper") is True

    def test_staples_set_is_non_empty(self) -> None:
        assert len(CULINARY_STAPLES) > 0

    def test_set_contains_expected_members(self) -> None:
        """Spot-check the documented curated list."""
        for name in ("salt", "black pepper", "olive oil", "sugar", "cumin"):
            assert name in CULINARY_STAPLES, f"{name!r} missing from CULINARY_STAPLES"
        # water and bare parsley are intentionally absent
        assert "water" not in CULINARY_STAPLES
        assert "parsley" not in CULINARY_STAPLES


# ---------------------------------------------------------------------------
# match_ingredients — assumed status
# ---------------------------------------------------------------------------


class TestAssumedStaples:
    """Absent staples → assumed, not missing (#305)."""

    def test_absent_salt_is_assumed_not_missing(self) -> None:
        """Salt not in pantry → status=assumed, not in missing list."""
        pantry = [_make_item("chicken", 500.0, "g", qty_base=500.0, unit_base="g")]
        ingredients = [
            {"name": "chicken", "quantity": 200.0, "unit": "g"},
            {"name": "salt", "quantity": 1.0, "unit": "tsp"},
        ]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert "salt" not in proposal.missing
        assumed = [m for m in proposal.matches if m.status == "assumed"]
        assert len(assumed) == 1
        assert assumed[0].ingredient_name == "salt"
        assert assumed[0].pantry_item_id is None
        assert assumed[0].deduct_qty is None

    def test_absent_pepper_is_assumed_not_missing(self) -> None:
        pantry: list[PantryItem] = []
        ingredients = [{"name": "black pepper", "quantity": 0.5, "unit": "tsp"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert "black pepper" not in proposal.missing
        assert any(m.status == "assumed" for m in proposal.matches)

    def test_absent_oil_is_assumed_not_missing(self) -> None:
        pantry: list[PantryItem] = []
        ingredients = [{"name": "olive oil", "quantity": 2.0, "unit": "tbsp"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert "olive oil" not in proposal.missing
        assert any(m.status == "assumed" and m.ingredient_name == "olive oil" for m in proposal.matches)

    def test_non_staple_absent_is_still_missing(self) -> None:
        """A genuine missing ingredient that is not a staple must still be missing."""
        pantry: list[PantryItem] = []
        ingredients = [{"name": "tahini", "quantity": 2.0, "unit": "tbsp"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert "tahini" in proposal.missing
        assert not any(m.status == "assumed" for m in proposal.matches)

    def test_staple_present_in_pantry_matches_normally(self) -> None:
        """Salt in the pantry is matched and deducted, never assumed."""
        pantry = [_make_item("salt", 1.0, "kg", qty_base=1000.0, unit_base="g")]
        ingredients = [{"name": "salt", "quantity": 1.0, "unit": "tsp"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.missing == []
        assert not any(m.status == "assumed" for m in proposal.matches)
        assert proposal.matches[0].status == "ready"
        assert proposal.matches[0].deduct_qty is not None
        assert proposal.matches[0].deduct_qty > 0

    def test_recipe_only_missing_staples_not_reported_partial(self) -> None:
        """A recipe whose only unmatched ingredients are staples is fully matched.

        Specifically: proposal.missing is empty, so the cook is not told
        the recipe is partial/unmakeable due to these ingredients.
        """
        pantry = [
            _make_item("chicken", 500.0, "g", qty_base=500.0, unit_base="g"),
            _make_item("garlic", 50.0, "g", qty_base=50.0, unit_base="g"),
        ]
        ingredients = [
            {"name": "chicken", "quantity": 200.0, "unit": "g"},
            {"name": "garlic", "quantity": 2.0, "unit": "clove"},
            {"name": "salt", "quantity": 1.0, "unit": "tsp"},
            {"name": "black pepper", "quantity": 0.5, "unit": "tsp"},
            {"name": "olive oil", "quantity": 1.0, "unit": "tbsp"},
        ]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.missing == [], f"Expected empty missing, got: {proposal.missing}"
        assumed_names = {m.ingredient_name for m in proposal.matches if m.status == "assumed"}
        assert "salt" in assumed_names
        assert "black pepper" in assumed_names
        assert "olive oil" in assumed_names

    def test_multiple_staples_all_assumed(self) -> None:
        """Multiple absent staples are all tagged assumed, not missing."""
        pantry: list[PantryItem] = []
        ingredients = [
            {"name": "salt", "quantity": None, "unit": None},
            {"name": "pepper", "quantity": None, "unit": None},
            {"name": "oil", "quantity": None, "unit": None},
        ]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.missing == []
        assert len([m for m in proposal.matches if m.status == "assumed"]) == 3


# ---------------------------------------------------------------------------
# _unmatched_ingredient_names — staples excluded before LLM tier
# ---------------------------------------------------------------------------


class TestUnmatchedNamesExcludesStaples:
    """Staples must not be sent to the LLM substitution tier (#305)."""

    def test_absent_staple_not_in_unmatched_names(self) -> None:
        pantry: list[PantryItem] = []
        ingredients = [
            {"name": "tahini", "quantity": 2.0, "unit": "tbsp"},
            {"name": "salt", "quantity": 1.0, "unit": "tsp"},
        ]

        unmatched = _unmatched_ingredient_names(ingredients, pantry)

        assert "tahini" in unmatched
        assert "salt" not in unmatched

    def test_all_staples_excluded_from_unmatched(self) -> None:
        pantry: list[PantryItem] = []
        staple_ingredients = [{"name": n, "quantity": 1.0, "unit": "tsp"} for n in ("salt", "pepper", "oil")]
        unmatched = _unmatched_ingredient_names(staple_ingredients, pantry)
        assert unmatched == []

    def test_non_staple_absent_still_in_unmatched(self) -> None:
        pantry: list[PantryItem] = []
        ingredients = [{"name": "truffle oil", "quantity": 1.0, "unit": "tsp"}]
        unmatched = _unmatched_ingredient_names(ingredients, pantry)
        assert "truffle oil" in unmatched


# ---------------------------------------------------------------------------
# match_ingredients_with_llm — staples do not trigger an LLM call
# ---------------------------------------------------------------------------


class TestStaplesDoNotReachLLM:
    def setup_method(self) -> None:
        _alias_cache.clear()

    @pytest.mark.asyncio
    async def test_fully_matched_plus_staples_no_llm_call(self) -> None:
        """When every unmatched ingredient is a staple, the LLM is never called."""
        pantry = [_make_item("pasta", 500.0, "g", qty_base=500.0, unit_base="g")]
        ingredients = [
            {"name": "pasta", "quantity": 200.0, "unit": "g"},
            {"name": "salt", "quantity": 1.0, "unit": "tsp"},
            {"name": "olive oil", "quantity": 2.0, "unit": "tbsp"},
        ]
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=_LLMMatchBatch(results=[]))

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        ai.complete.assert_not_called()
        assert proposal.missing == []
        assumed = [m for m in proposal.matches if m.status == "assumed"]
        assert len(assumed) == 2

    @pytest.mark.asyncio
    async def test_genuinely_missing_plus_staples_calls_llm_for_missing_only(self) -> None:
        """Non-staple missing ingredient goes to LLM; staples do not."""
        pantry = [_make_item("pasta", 500.0, "g", qty_base=500.0, unit_base="g")]
        ingredients = [
            {"name": "pasta", "quantity": 200.0, "unit": "g"},
            {"name": "tahini", "quantity": 2.0, "unit": "tbsp"},
            {"name": "salt", "quantity": 1.0, "unit": "tsp"},
        ]
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=_LLMMatchBatch(results=[]))

        await match_ingredients_with_llm(RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai)

        ai.complete.assert_called_once()
        # The prompt only contained "tahini", not "salt"
        call_args = ai.complete.call_args
        prompt: str = call_args.kwargs.get("prompt") or call_args.args[0]
        assert "tahini" in prompt
        assert "salt" not in prompt


# ---------------------------------------------------------------------------
# recipe_generator — match_ingredient_to_pantry assumed status (#305)
# ---------------------------------------------------------------------------


class TestRecipeGeneratorAssumedStatus:
    """Absent staples → status=assumed in recipe_generator path (#305)."""

    def test_absent_salt_is_assumed(self) -> None:
        """Salt not in pantry → status=assumed, not missing."""
        from bubbly_chef.models.recipe import Ingredient
        from bubbly_chef.services.recipe_generator import match_ingredient_to_pantry

        ing = Ingredient(name="salt", quantity=1.0, unit="tsp")
        result = match_ingredient_to_pantry(ing, [])

        assert result.status == "assumed"

    def test_absent_black_pepper_is_assumed(self) -> None:
        from bubbly_chef.models.recipe import Ingredient
        from bubbly_chef.services.recipe_generator import match_ingredient_to_pantry

        ing = Ingredient(name="black pepper", quantity=0.5, unit="tsp")
        result = match_ingredient_to_pantry(ing, [])

        assert result.status == "assumed"

    def test_absent_olive_oil_is_assumed(self) -> None:
        from bubbly_chef.models.recipe import Ingredient
        from bubbly_chef.services.recipe_generator import match_ingredient_to_pantry

        ing = Ingredient(name="olive oil", quantity=2.0, unit="tbsp")
        result = match_ingredient_to_pantry(ing, [])

        assert result.status == "assumed"

    def test_absent_tahini_is_still_missing(self) -> None:
        """Non-staple absent from pantry must remain missing."""
        from bubbly_chef.models.recipe import Ingredient
        from bubbly_chef.services.recipe_generator import match_ingredient_to_pantry

        ing = Ingredient(name="tahini", quantity=2.0, unit="tbsp")
        result = match_ingredient_to_pantry(ing, [])

        assert result.status == "missing"

    def test_fresh_parsley_absent_is_missing_regression(self) -> None:
        """Regression: bare 'parsley' was removed from staples; absent fresh parsley
        must still be reported as missing, not assumed (#305 staples pruning)."""
        from bubbly_chef.models.recipe import Ingredient
        from bubbly_chef.services.recipe_generator import match_ingredient_to_pantry

        ing = Ingredient(name="parsley", quantity=2.0, unit="tbsp")
        result = match_ingredient_to_pantry(ing, [])

        assert result.status == "missing", (
            "Fresh parsley was removed from CULINARY_STAPLES intentionally — "
            "it must still be reported as missing when absent."
        )

    def test_assumed_staple_not_in_missing_count(self) -> None:
        """missing_count excludes assumed staples; all-staple gap → missing_count=0."""
        import asyncio
        from unittest.mock import AsyncMock, MagicMock, patch
        from bubbly_chef.services.recipe_generator import GenerateRecipeResponse, generate_recipe
        from bubbly_chef.models.recipe import RecipeCard, Ingredient

        # Build a fake RecipeCard (salt + pepper only — no pantry items needed)
        fake_recipe = RecipeCard(
            title="Salt & Pepper Steak",
            description="A simple dish.",
            instructions=["Season the steak with salt and pepper.", "Cook to desired doneness."],
            ingredients=[
                Ingredient(name="steak", quantity=200.0, unit="g"),
                Ingredient(name="salt", quantity=1.0, unit="tsp"),
                Ingredient(name="black pepper", quantity=0.5, unit="tsp"),
            ],
        )

        # Patch AIManager.complete to return the fake recipe
        from bubbly_chef.services.recipe_generator import AIRecipeOutput
        mock_ai_output = AIRecipeOutput(
            title=fake_recipe.title,
            description=fake_recipe.description or "",
            prep_time_minutes=None,
            cook_time_minutes=None,
            servings=None,
            ingredients=[
                {"name": "steak", "quantity": 200.0, "unit": "g", "preparation": None, "optional": False},
                {"name": "salt", "quantity": 1.0, "unit": "tsp", "preparation": None, "optional": False},
                {"name": "black pepper", "quantity": 0.5, "unit": "tsp", "preparation": None, "optional": False},
            ],
            instructions=["Season the steak.", "Cook."],
            tips=[],
            cuisine=None,
            difficulty=None,
        )

        mock_ai = MagicMock()
        mock_ai.complete = AsyncMock(return_value=mock_ai_output)

        # Pantry has steak but NOT salt or pepper
        pantry = [_make_item("steak", 500.0, "g", qty_base=500.0, unit_base="g")]

        response: GenerateRecipeResponse = asyncio.run(
            generate_recipe("make me a steak dish", pantry, mock_ai)
        )

        assert response.missing_count == 0, (
            f"Expected missing_count=0 (salt+pepper are staples), got {response.missing_count}"
        )
        assumed_statuses = [s for s in response.ingredients_status if s.status == "assumed"]
        assert len(assumed_statuses) == 2


# ---------------------------------------------------------------------------
# nodes.py availability builder — staple assumed / available (#305)
# ---------------------------------------------------------------------------


class TestNodesAvailabilityBuilder:
    """Unit tests for the staple-aware availability loop in nodes.py.

    The availability logic is embedded in generate_grounded_response_node(), a
    LangGraph node that requires a full WorkflowState. Rather than spin up
    LangGraph, we test the is_staple + normalize_food_name interplay that drives
    both new branches directly, confirming the decision is identical to what
    cook_matcher uses (they share the same domain functions).
    """

    def test_is_staple_normalizes_before_lookup(self) -> None:
        """nodes.py calls is_staple(normalize_food_name(ing.name.lower())).
        Confirm the chain works for the exact names the LLM commonly returns."""
        from bubbly_chef.domain.normalizer import normalize_food_name

        for raw_name in ("Salt", "Black Pepper", "Olive Oil", "CUMIN"):
            normalized = normalize_food_name(raw_name.lower())
            assert is_staple(normalized), f"{raw_name!r} → {normalized!r} not in staples"

    def test_fresh_parsley_not_a_staple_after_normalization(self) -> None:
        """Regression: 'parsley' removed from staples; the availability builder
        must NOT tag it as assumed when absent from pantry."""
        from bubbly_chef.domain.normalizer import normalize_food_name

        normalized = normalize_food_name("parsley")
        assert not is_staple(normalized), (
            "parsley was pruned from CULINARY_STAPLES intentionally; "
            f"normalize_food_name('parsley') = {normalized!r} must not be a staple"
        )

    def test_water_not_a_staple_after_normalization(self) -> None:
        """Regression: 'water' removed from staples (#305 pruning)."""
        from bubbly_chef.domain.normalizer import normalize_food_name

        normalized = normalize_food_name("water")
        assert not is_staple(normalized), (
            f"water was pruned intentionally; normalize_food_name('water') = {normalized!r}"
        )
