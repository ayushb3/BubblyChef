"""Unit tests for the cook_matcher service."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.services.cook_matcher import match_ingredients


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


class TestMatchIngredients:
    """Happy-path and error-path tests for match_ingredients()."""

    def test_ready_when_pantry_has_enough(self) -> None:
        """Ingredient with sufficient base-unit quantity → status=ready."""
        pantry = [_make_item("eggs", 12.0, "count", qty_base=12.0, unit_base="count")]
        ingredients = [{"name": "eggs", "quantity": 2.0, "unit": "count"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert len(proposal.matches) == 1
        assert proposal.matches[0].status == "ready"
        assert proposal.matches[0].deduct_qty == pytest.approx(2.0)
        assert proposal.missing == []

    def test_shortfall_when_pantry_has_too_little(self) -> None:
        """Ingredient with insufficient quantity → status=shortfall."""
        pantry = [_make_item("milk", 1.0, "cup", qty_base=240.0, unit_base="ml")]
        # Recipe needs 3 cups = 720 ml; pantry has 240 ml
        ingredients = [{"name": "milk", "quantity": 3.0, "unit": "cup"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert len(proposal.matches) == 1
        match = proposal.matches[0]
        assert match.status == "shortfall"
        assert match.shortfall == pytest.approx(480.0, abs=1.0)
        assert match.deduct_qty == pytest.approx(240.0)  # deduct what we have

    def test_missing_when_no_pantry_match(self) -> None:
        """Ingredient with no pantry counterpart → appears in missing list."""
        pantry: list[PantryItem] = []
        ingredients = [{"name": "truffle oil", "quantity": 1.0, "unit": "tbsp"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.missing == ["truffle oil"]
        assert proposal.matches == []

    def test_unit_conflict_when_conversion_impossible(self) -> None:
        """Ingredient where recipe unit can't be converted to pantry base unit → unit_conflict."""
        # sugar in pantry is measured in count (items), recipe asks for grams
        pantry = [_make_item("sugar", 1.0, "item", qty_base=1.0, unit_base="count")]
        # 200g of sugar — can't compare grams to count
        ingredients = [{"name": "sugar", "quantity": 200.0, "unit": "g"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        # Should be a unit_conflict, not missing
        assert len(proposal.unit_conflicts) == 1
        assert proposal.unit_conflicts[0]["ingredient"] == "sugar"
        assert any(m.status == "unit_conflict" for m in proposal.matches)

    def test_no_quantity_ingredient_is_ready(self) -> None:
        """Ingredient with no quantity in recipe → status=ready (informational only)."""
        pantry = [_make_item("salt", 500.0, "g", qty_base=500.0, unit_base="g")]
        ingredients = [{"name": "salt", "quantity": None, "unit": None}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert len(proposal.matches) == 1
        assert proposal.matches[0].status == "ready"
        assert proposal.matches[0].deduct_qty is None

    def test_mixed_ingredients(self) -> None:
        """Recipe with a mix of ready, shortfall, and missing ingredients."""
        pantry = [
            _make_item("eggs", 6.0, "count", qty_base=6.0, unit_base="count"),
            _make_item("butter", 2.0, "oz", qty_base=56.7, unit_base="g"),
        ]
        ingredients = [
            {"name": "eggs", "quantity": 3.0, "unit": "count"},       # ready
            {"name": "butter", "quantity": 200.0, "unit": "g"},       # shortfall (only 56.7g)
            {"name": "vanilla extract", "quantity": 1.0, "unit": "tsp"},  # missing
        ]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        statuses = {m.ingredient_name: m.status for m in proposal.matches}
        assert statuses["eggs"] == "ready"
        assert statuses["butter"] == "shortfall"
        assert "vanilla extract" in proposal.missing

    def test_empty_pantry_all_missing(self) -> None:
        """All ingredients go missing when pantry is empty."""
        pantry: list[PantryItem] = []
        ingredients = [
            {"name": "chicken breast", "quantity": 2.0, "unit": "lb"},
            {"name": "garlic", "quantity": 3.0, "unit": "count"},
        ]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert len(proposal.missing) == 2
        assert proposal.matches == []

    def test_empty_ingredients_returns_empty_proposal(self) -> None:
        """Recipe with no ingredients → empty proposal."""
        pantry = [_make_item("eggs", 12.0, "count", qty_base=12.0, unit_base="count")]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, [], pantry)

        assert proposal.matches == []
        assert proposal.missing == []
        assert proposal.unit_conflicts == []

    def test_proposal_ids_and_title(self) -> None:
        """Proposal carries recipe_id and recipe_title through."""
        import uuid as _uuid

        rid = str(_uuid.uuid4())
        proposal = match_ingredients(rid, "My Recipe", [], [])

        assert str(proposal.recipe_id) == rid
        assert proposal.recipe_title == "My Recipe"
