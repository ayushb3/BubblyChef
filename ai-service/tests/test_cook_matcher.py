"""Unit tests for the cook_matcher service."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from unittest.mock import AsyncMock, MagicMock

from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.services.cook_matcher import (
    _LLMIngredientMatch,
    _LLMMatchBatch,
    match_ingredients,
    match_ingredients_with_llm,
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


class TestDuplicateIngredientDeduction:
    """Several recipe lines resolving to one pantry row must not over-claim it.

    Regression cover for the case where each line was compared against the row's
    untouched quantity, so a recipe asking for more than the row holds reported
    every line "ready" and the confirm step deducted once per line.
    """

    def test_duplicate_ingredient_does_not_double_count(self) -> None:
        """Two lines for the same item split one row's quantity between them."""
        pantry = [_make_item("eggs", 3.0, "count", qty_base=3.0, unit_base="count")]
        ingredients = [
            {"name": "eggs", "quantity": 2.0, "unit": "count"},
            {"name": "eggs", "quantity": 2.0, "unit": "count"},
        ]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert len(proposal.matches) == 2
        first, second = proposal.matches

        # First line takes 2 of the 3 available.
        assert first.status == "ready"
        assert first.deduct_qty == pytest.approx(2.0)

        # Only 1 remains, so the second line is short by 1 — not a second "ready".
        assert second.status == "shortfall"
        assert second.deduct_qty == pytest.approx(1.0)
        assert second.shortfall == pytest.approx(1.0)
        assert second.pantry_qty_available == pytest.approx(1.0)

    def test_total_deduction_never_exceeds_stock(self) -> None:
        """Summed deductions across duplicate lines stay within the row."""
        pantry = [_make_item("eggs", 3.0, "count", qty_base=3.0, unit_base="count")]
        ingredients = [{"name": "eggs", "quantity": 2.0, "unit": "count"}] * 3

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        total = sum(m.deduct_qty or 0.0 for m in proposal.matches)
        assert total == pytest.approx(3.0)

    def test_duplicates_within_capacity_are_both_ready(self) -> None:
        """Splitting a row that can cover both lines leaves both ready."""
        pantry = [_make_item("eggs", 12.0, "count", qty_base=12.0, unit_base="count")]
        ingredients = [
            {"name": "eggs", "quantity": 2.0, "unit": "count"},
            {"name": "eggs", "quantity": 3.0, "unit": "count"},
        ]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert [m.status for m in proposal.matches] == ["ready", "ready"]
        assert sum(m.deduct_qty or 0.0 for m in proposal.matches) == pytest.approx(5.0)
        # The second line sees the row already reduced by the first.
        assert proposal.matches[1].pantry_qty_available == pytest.approx(10.0)

    def test_synonym_collision_shares_one_pantry_row(self) -> None:
        """Distinct names that normalize together still share one row's stock.

        normalize_food_name() maps cheddar and parmesan onto "cheese", so these
        two lines resolve to the same pantry item despite never repeating a name.
        This is the variant most likely to slip past review.
        """
        pantry = [_make_item("cheese", 100.0, "g", qty_base=100.0, unit_base="g")]
        ingredients = [
            {"name": "cheddar", "quantity": 60.0, "unit": "g"},
            {"name": "parmesan", "quantity": 60.0, "unit": "g"},
        ]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert len(proposal.matches) == 2
        assert proposal.matches[0].pantry_item_id == proposal.matches[1].pantry_item_id

        assert proposal.matches[0].status == "ready"
        assert proposal.matches[1].status == "shortfall"
        assert sum(m.deduct_qty or 0.0 for m in proposal.matches) == pytest.approx(100.0)


class TestLLMSubstitutionMatching:
    """Tier 2 — the model resolves what the synonym table misses (#123)."""

    @staticmethod
    def _ai(batch: object) -> MagicMock:
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=batch)
        return ai

    @pytest.mark.asyncio
    async def test_exact_matches_never_reach_the_model(self) -> None:
        """A fully-matched recipe adds no latency and no API call."""
        pantry = [_make_item("eggs", 12.0, "count", qty_base=12.0, unit_base="count")]
        ingredients = [{"name": "eggs", "quantity": 2.0, "unit": "count"}]
        ai = self._ai(_LLMMatchBatch(results=[]))

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        ai.complete.assert_not_called()
        assert proposal.matches[0].status == "ready"
        assert proposal.matches[0].match_type == "exact"

    @pytest.mark.asyncio
    async def test_substitute_is_surfaced_with_its_note(self) -> None:
        """A confident stand-in becomes a substitute match, not a missing ingredient."""
        pantry = [_make_item("greek yogurt", 200.0, "g", qty_base=200.0, unit_base="g")]
        ingredients = [{"name": "sour cream", "quantity": 100.0, "unit": "g"}]
        ai = self._ai(
            _LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="sour cream",
                        best_match="greek yogurt",
                        match_type="substitute",
                        confidence=0.9,
                        substitution_note="Tangier and thicker, works in most sauces.",
                    )
                ]
            )
        )

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        ai.complete.assert_awaited_once()
        assert proposal.missing == []
        assert len(proposal.matches) == 1
        match = proposal.matches[0]
        assert match.status == "substitute"
        assert match.match_type == "substitute"
        assert match.substitution_note == "Tangier and thicker, works in most sauces."
        assert match.deduct_qty == pytest.approx(100.0)

    @pytest.mark.asyncio
    async def test_no_match_leaves_ingredient_missing(self) -> None:
        """match_type "none" is respected rather than forced into a swap."""
        pantry = [_make_item("eggs", 12.0, "count", qty_base=12.0, unit_base="count")]
        ingredients = [{"name": "tahini", "quantity": 2.0, "unit": "tbsp"}]
        ai = self._ai(
            _LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="tahini",
                        best_match=None,
                        match_type="none",
                        confidence=0.95,
                    )
                ]
            )
        )

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        assert proposal.missing == ["tahini"]
        assert proposal.matches == []

    @pytest.mark.asyncio
    async def test_low_confidence_suggestion_is_discarded(self) -> None:
        """Swapping an ingredient changes the dish, so weak suggestions are dropped."""
        pantry = [_make_item("cheese", 100.0, "g", qty_base=100.0, unit_base="g")]
        ingredients = [{"name": "tahini", "quantity": 50.0, "unit": "g"}]
        ai = self._ai(
            _LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="tahini",
                        best_match="cheese",
                        match_type="substitute",
                        confidence=0.3,
                        substitution_note="Not really comparable.",
                    )
                ]
            )
        )

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        assert proposal.missing == ["tahini"]

    @pytest.mark.asyncio
    async def test_suggestion_naming_an_absent_item_is_discarded(self) -> None:
        """The model cannot invent stock the user does not have."""
        pantry = [_make_item("eggs", 12.0, "count", qty_base=12.0, unit_base="count")]
        ingredients = [{"name": "tahini", "quantity": 2.0, "unit": "tbsp"}]
        ai = self._ai(
            _LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="tahini",
                        best_match="peanut butter",
                        match_type="substitute",
                        confidence=0.95,
                        substitution_note="Similar nutty paste.",
                    )
                ]
            )
        )

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        assert proposal.missing == ["tahini"]

    @pytest.mark.asyncio
    async def test_provider_failure_degrades_to_missing(self) -> None:
        """A provider outage must not fail the cook proposal."""
        pantry = [_make_item("greek yogurt", 200.0, "g", qty_base=200.0, unit_base="g")]
        ingredients = [{"name": "sour cream", "quantity": 100.0, "unit": "g"}]
        ai = MagicMock()
        ai.complete = AsyncMock(side_effect=NoProviderAvailableError("all providers down"))

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        assert proposal.missing == ["sour cream"]
        assert proposal.matches == []

    @pytest.mark.asyncio
    async def test_substitute_shares_consumption_with_direct_matches(self) -> None:
        """A stand-in cannot claim stock an earlier ingredient already took.

        This is why aliases are resolved into a single matching pass rather than
        matched separately afterwards — a second pass would carry its own
        consumption accounting and reintroduce the #125 over-deduction.
        """
        pantry = [_make_item("cheese", 100.0, "g", qty_base=100.0, unit_base="g")]
        ingredients = [
            {"name": "cheese", "quantity": 80.0, "unit": "g"},
            {"name": "pecorino romano", "quantity": 80.0, "unit": "g"},
        ]
        ai = self._ai(
            _LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="pecorino romano",
                        best_match="cheese",
                        match_type="substitute",
                        confidence=0.9,
                        substitution_note="Milder, less salty.",
                    )
                ]
            )
        )

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        assert proposal.matches[0].status == "ready"
        assert proposal.matches[1].status == "shortfall"
        assert proposal.matches[1].match_type == "substitute"
        assert sum(m.deduct_qty or 0.0 for m in proposal.matches) == pytest.approx(100.0)
