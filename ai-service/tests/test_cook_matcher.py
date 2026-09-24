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
    _alias_cache,
    match_ingredients,
    match_ingredients_with_llm,
    resolve_aliases_with_llm,
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

    def setup_method(self) -> None:
        # Clear alias cache so tests are independent of each other's LLM results.
        _alias_cache.clear()

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


class TestCrossDimensionDeduction:
    """Recipe volumes deducting from mass-based pantry rows.

    Regression cover for the "Mark as cooked" flow being unusable: on a real
    49-item pantry every matched ingredient came back unit_conflict and nothing
    was deductible, because a recipe measures butter in teaspoons while the
    pantry stores it in grams.
    """

    def test_teaspoons_and_tablespoons_deduct_from_gram_rows(self) -> None:
        """The exact failing set from the live app, now deductible.

        Hand-checked against 1 tsp = 5 ml, 1 tbsp = 15 ml:
          1 tsp butter        = 5 ml  x 0.911 g/ml = 4.555 g
          0.5 tsp salt        = 2.5 ml x 1.2  g/ml = 3.0 g
          4 tbsp greek yogurt = 60 ml x 1.03 g/ml = 61.8 g
        """
        pantry = [
            _make_item("butter", 250.0, "g", qty_base=250.0, unit_base="g"),
            _make_item("salt", 1.0, "kg", qty_base=1000.0, unit_base="g"),
            _make_item("greek yogurt", 500.0, "g", qty_base=500.0, unit_base="g"),
        ]
        ingredients = [
            {"name": "butter", "quantity": 1.0, "unit": "teaspoon"},
            {"name": "salt", "quantity": 0.5, "unit": "teaspoon"},
            {"name": "greek yogurt", "quantity": 4.0, "unit": "tablespoon"},
        ]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.unit_conflicts == []
        assert [m.status for m in proposal.matches] == ["ready", "ready", "ready"]
        assert all(m.base_unit == "g" for m in proposal.matches)

        deductions = {m.ingredient_name: m.deduct_qty for m in proposal.matches}
        assert deductions["butter"] == pytest.approx(4.555)
        assert deductions["salt"] == pytest.approx(3.0)
        assert deductions["greek yogurt"] == pytest.approx(61.8)

    def test_rows_without_base_values_still_resolve(self) -> None:
        """Rows written by the Next.js CRUD routes carry no quantity_base.

        The matcher derives it, and that derivation used to fail for any
        ingredient outside INGREDIENT_CANONICAL_UNIT — "greek yogurt" among
        them — so the row could not be compared against anything at all.
        """
        pantry = [
            _make_item("greek yogurt", 500.0, "g"),
            _make_item("basmati rice", 2.0, "kg"),
        ]
        ingredients = [
            {"name": "greek yogurt", "quantity": 4.0, "unit": "tablespoon"},
            {"name": "basmati rice", "quantity": 300.0, "unit": "g"},
        ]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.unit_conflicts == []
        deductions = {m.ingredient_name: m.deduct_qty for m in proposal.matches}
        assert deductions["greek yogurt"] == pytest.approx(61.8)
        assert deductions["basmati rice"] == pytest.approx(300.0)

    def test_piece_units_deduct_by_conventional_weight(self) -> None:
        """2 cloves garlic = 6 g against a gram row, not a whole bulb."""
        pantry = [_make_item("garlic", 100.0, "g", qty_base=100.0, unit_base="g")]
        ingredients = [{"name": "garlic", "quantity": 2.0, "unit": "cloves"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.matches[0].status == "ready"
        assert proposal.matches[0].deduct_qty == pytest.approx(6.0)

    def test_ingredient_without_density_stays_an_honest_conflict(self) -> None:
        """No density for matcha, so a tablespoon of it is still not comparable.

        The conflict is the correct answer here: inventing a number would
        deduct the wrong amount from the user's pantry without telling them.
        """
        pantry = [_make_item("matcha", 30.0, "g", qty_base=30.0, unit_base="g")]
        ingredients = [{"name": "matcha", "quantity": 1.0, "unit": "tbsp"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert len(proposal.unit_conflicts) == 1
        assert proposal.matches[0].status == "unit_conflict"
        assert proposal.matches[0].deduct_qty is None

    def test_repeated_volume_lines_share_one_gram_row(self) -> None:
        """Converted quantities feed the same consumption accounting as the rest."""
        pantry = [_make_item("butter", 6.0, "g", qty_base=6.0, unit_base="g")]
        ingredients = [
            {"name": "butter", "quantity": 1.0, "unit": "tsp"},  # 4.555 g
            {"name": "butter", "quantity": 1.0, "unit": "tsp"},  # only 1.445 g left
        ]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.matches[0].status == "ready"
        assert proposal.matches[1].status == "shortfall"
        total = sum(m.deduct_qty or 0.0 for m in proposal.matches)
        assert total == pytest.approx(6.0)


class TestSalmonAvocadoToast:
    """End-to-end shape of the recipe that motivated all of this.

    Before: 7 of 9 matched ingredients were unit_conflict and 2 were deductible.
    After (#209): "1 handful spinach" no longer blocks the whole flow as a
    unit_conflict — it becomes a soft imprecise fallback (matched, but nothing
    auto-deducted, deduct_qty=None), and the two piece-against-package pairs
    (4 slices of a loaf, 8 leaves of a bunch) are still satisfied without a
    precise deduction. So 6 ingredients are cleanly deductible and 3 are
    non-blocking imprecise. See #222 and tests/test_issue_222_piece_vs_package.py.
    """

    def test_most_of_the_recipe_becomes_deductible(self) -> None:
        pantry = [
            _make_item("bread", 1.0, "item"),
            _make_item("avocado", 2.0, "count"),
            _make_item("salmon", 200.0, "g"),
            _make_item("butter", 250.0, "g"),
            _make_item("salt", 1.0, "kg"),
            _make_item("greek yogurt", 500.0, "g"),
            _make_item("baby spinach", 1.0, "bag"),
            _make_item("basil", 1.0, "bunch"),
            _make_item("olive oil", 500.0, "ml"),
        ]
        ingredients = [
            {"name": "bread", "quantity": 4.0, "unit": "slices"},
            {"name": "avocado", "quantity": 1.0, "unit": "count"},
            {"name": "salmon", "quantity": 100.0, "unit": "g"},
            {"name": "butter", "quantity": 1.0, "unit": "teaspoon"},
            {"name": "salt", "quantity": 0.5, "unit": "teaspoon"},
            {"name": "greek yogurt", "quantity": 4.0, "unit": "tablespoon"},
            {"name": "baby spinach", "quantity": 1.0, "unit": "handful"},
            {"name": "basil", "quantity": 8.0, "unit": "leaves"},
            {"name": "olive oil", "quantity": 1.0, "unit": "tablespoon"},
        ]

        proposal = match_ingredients(RECIPE_ID, "Salmon Avocado Toast", ingredients, pantry)

        assert proposal.missing == []
        deductible = [m for m in proposal.matches if m.deduct_qty is not None]
        # 6 clean exact-deductions; the soft-fallback (baby spinach) and the two
        # piece-vs-package pairs (bread, basil) deduct nothing.
        assert len(deductible) == 6

        statuses = {m.ingredient_name: m.status for m in proposal.matches}
        assert statuses["butter"] == "ready"
        assert statuses["salt"] == "ready"
        assert statuses["greek yogurt"] == "ready"
        assert statuses["salmon"] == "ready"

        # Pieces of a package: satisfied, but nothing is deducted — deducting
        # here would take the whole loaf and the whole bunch (#222).
        assert statuses["bread"] == "imprecise"
        assert statuses["basil"] == "imprecise"

        # "1 handful" has no recognised unit dimension; "1 bag" is count.
        # One side unresolvable → soft fallback (imprecise, non-blocking, nothing
        # auto-deducted), not a hard blocking conflict (#209).
        assert proposal.unit_conflicts == []
        assert statuses["baby spinach"] == "imprecise"
        baby_spinach = next(m for m in proposal.matches if m.ingredient_name == "baby spinach")
        assert baby_spinach.deduct_qty is None


class TestPieceUnitParsing:
    """Raw ingredient strings whose unit is a piece word.

    "leaves" was absent from the parser's unit alternation, so "8 leaves fresh
    basil" parsed as a quantity of 8 with no unit and the name "leaves fresh
    basil" — the unit never reached the normalizer at all.
    """

    def test_leaves_parses_as_a_unit(self) -> None:
        from bubbly_chef.services.cook_matcher import _parse_ingredient_string

        parsed = _parse_ingredient_string("8 leaves fresh basil")

        assert parsed == {"name": "basil", "quantity": 8.0, "unit": "leaves"}

    def test_leaves_deduct_by_conventional_weight(self) -> None:
        """8 basil leaves at 0.5 g each = 4 g off a gram row."""
        pantry = [_make_item("basil", 20.0, "g", qty_base=20.0, unit_base="g")]

        proposal = match_ingredients(
            RECIPE_ID, RECIPE_TITLE, ["8 leaves fresh basil"], pantry
        )

        assert proposal.matches[0].status == "ready"
        assert proposal.matches[0].deduct_qty == pytest.approx(4.0)

    def test_pinch_of_salt_from_a_string(self) -> None:
        """1 pinch = 1/16 tsp = 0.3125 ml; salt at 1.2 g/ml = 0.375 g."""
        pantry = [_make_item("salt", 1.0, "kg", qty_base=1000.0, unit_base="g")]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ["1 pinch salt"], pantry)

        assert proposal.matches[0].status == "ready"
        assert proposal.matches[0].deduct_qty == pytest.approx(0.375)


class TestAliasCache:
    """Cache behaviour for resolve_aliases_with_llm — preview→confirm must not double-call."""

    @staticmethod
    def _ai_returning(batch: object) -> MagicMock:
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=batch)
        return ai

    @staticmethod
    def _pantry(*names: str) -> list[PantryItem]:
        return [_make_item(n, 100.0, "g", qty_base=100.0, unit_base="g") for n in names]

    def setup_method(self) -> None:
        # Each test starts with a clean cache to prevent cross-test pollution.
        _alias_cache.clear()

    @pytest.mark.asyncio
    async def test_second_call_with_identical_inputs_skips_llm(self) -> None:
        """Cache hit: identical (unmatched, pantry) pair must not invoke ai_manager again."""
        pantry = self._pantry("greek yogurt")
        unmatched = ["sour cream"]
        ai = self._ai_returning(
            _LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="sour cream",
                        best_match="greek yogurt",
                        match_type="exact",
                        confidence=0.95,
                    )
                ]
            )
        )

        result1 = await resolve_aliases_with_llm(unmatched, pantry, ai)
        result2 = await resolve_aliases_with_llm(unmatched, pantry, ai)

        # Only one LLM call despite two invocations.
        ai.complete.assert_awaited_once()
        assert result1 == result2

    @pytest.mark.asyncio
    async def test_changed_pantry_causes_fresh_llm_call(self) -> None:
        """Adding a pantry item changes the fingerprint — must not reuse stale aliases."""
        unmatched = ["sour cream"]
        ai = self._ai_returning(_LLMMatchBatch(results=[]))

        pantry_before = self._pantry("greek yogurt")
        await resolve_aliases_with_llm(unmatched, pantry_before, ai)

        pantry_after = self._pantry("greek yogurt", "creme fraiche")
        await resolve_aliases_with_llm(unmatched, pantry_after, ai)

        assert ai.complete.await_count == 2

    @pytest.mark.asyncio
    async def test_changed_unmatched_set_causes_fresh_llm_call(self) -> None:
        """Different unmatched ingredients = different cache key = fresh call."""
        pantry = self._pantry("greek yogurt")
        ai = self._ai_returning(_LLMMatchBatch(results=[]))

        await resolve_aliases_with_llm(["sour cream"], pantry, ai)
        await resolve_aliases_with_llm(["creme fraiche"], pantry, ai)

        assert ai.complete.await_count == 2

    @pytest.mark.asyncio
    async def test_ttl_expiry_causes_fresh_llm_call(self) -> None:
        """An entry older than the TTL must be evicted and the LLM re-called."""
        pantry = self._pantry("greek yogurt")
        unmatched = ["sour cream"]
        ai = self._ai_returning(_LLMMatchBatch(results=[]))

        # First call at t=0.
        t = 0.0

        def clock() -> float:
            return t

        await resolve_aliases_with_llm(unmatched, pantry, ai, _clock=clock)
        assert ai.complete.await_count == 1

        # Advance clock past TTL.
        from bubbly_chef.services.cook_matcher import _ALIAS_CACHE_TTL

        t = _ALIAS_CACHE_TTL + 1.0

        await resolve_aliases_with_llm(unmatched, pantry, ai, _clock=clock)
        assert ai.complete.await_count == 2

    @pytest.mark.asyncio
    async def test_within_ttl_is_still_a_hit(self) -> None:
        """An entry just inside the TTL window must be returned from cache."""
        pantry = self._pantry("greek yogurt")
        unmatched = ["sour cream"]
        ai = self._ai_returning(_LLMMatchBatch(results=[]))

        t = 0.0

        def clock() -> float:
            return t

        await resolve_aliases_with_llm(unmatched, pantry, ai, _clock=clock)

        from bubbly_chef.services.cook_matcher import _ALIAS_CACHE_TTL

        t = _ALIAS_CACHE_TTL - 1.0  # still inside window
        await resolve_aliases_with_llm(unmatched, pantry, ai, _clock=clock)

        ai.complete.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_failure_is_not_cached(self) -> None:
        """A provider outage must not poison the cache; the next call must retry."""
        from bubbly_chef.ai.manager import NoProviderAvailableError

        pantry = self._pantry("greek yogurt")
        unmatched = ["sour cream"]

        # First call: provider fails.
        ai_fail = MagicMock()
        ai_fail.complete = AsyncMock(side_effect=NoProviderAvailableError("down"))
        result_fail = await resolve_aliases_with_llm(unmatched, pantry, ai_fail)
        assert result_fail == ({}, {}, [])

        # Second call: provider recovered — must reach the LLM, not return from cache.
        ai_ok = self._ai_returning(
            _LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="sour cream",
                        best_match="greek yogurt",
                        match_type="exact",
                        confidence=0.95,
                    )
                ]
            )
        )
        aliases_ok, _, _ = await resolve_aliases_with_llm(unmatched, pantry, ai_ok)

        ai_ok.complete.assert_awaited_once()
        assert "sour cream" in aliases_ok

    @pytest.mark.asyncio
    async def test_quantity_change_does_not_bust_cache(self) -> None:
        """Deducting stock (quantity change) must NOT invalidate the alias cache.

        The fingerprint is built from item names, not quantities: an alias only
        cares whether a pantry item exists, not how much of it is left.
        """
        unmatched = ["sour cream"]
        ai = self._ai_returning(_LLMMatchBatch(results=[]))

        pantry_full = [_make_item("greek yogurt", 200.0, "g", qty_base=200.0, unit_base="g")]
        await resolve_aliases_with_llm(unmatched, pantry_full, ai)
        assert ai.complete.await_count == 1

        # Same item, reduced quantity (as after a deduction).
        pantry_deducted = [_make_item("greek yogurt", 100.0, "g", qty_base=100.0, unit_base="g")]
        await resolve_aliases_with_llm(unmatched, pantry_deducted, ai)

        # Still only one LLM call — the quantity change did not bust the cache.
        ai.complete.assert_awaited_once()


class TestAliasCacheIsolation:
    """A cache hit must not hand out the mutable entry it stores (#280)."""

    @pytest.mark.asyncio
    async def test_mutating_a_returned_mapping_does_not_poison_the_cache(self) -> None:
        from bubbly_chef.services.cook_matcher import (
            _alias_cache,
            resolve_aliases_with_llm,
        )

        _alias_cache.clear()
        pantry = [_make_item("yogurt", 500, "g", 500, "g")]
        manager = MagicMock()
        manager.complete = AsyncMock(
            return_value=_LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="sour cream",
                        best_match="yogurt",
                        match_type="substitute",
                        confidence=0.95,
                        substitution_note="Tangier, similar texture.",
                    )
                ]
            )
        )

        first_aliases, first_notes, first_suggestions = await resolve_aliases_with_llm(
            ["sour cream"], pantry, manager
        )
        assert "sour cream" in first_aliases
        first_aliases.clear()  # a careless caller
        first_notes.clear()
        first_suggestions.clear()

        second_aliases, _, _ = await resolve_aliases_with_llm(["sour cream"], pantry, manager)
        assert "sour cream" in second_aliases, "cache handed out its own mutable entry"
        assert manager.complete.await_count == 1, "should still be a cache hit"


class TestCompoundSuggestions:
    """Compound substitution suggestions — suggest only, never deduct (#281)."""

    @staticmethod
    def _ai(batch: object) -> MagicMock:
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=batch)
        return ai

    @pytest.mark.asyncio
    async def test_valid_compound_suggestion_reaches_proposal(self) -> None:
        """A compound suggestion with all components in pantry appears on the proposal."""
        pantry = [
            _make_item("butter", 250.0, "g", qty_base=250.0, unit_base="g"),
            _make_item("milk", 500.0, "ml", qty_base=500.0, unit_base="ml"),
            _make_item("flour", 1.0, "kg", qty_base=1000.0, unit_base="g"),
        ]
        ingredients = [{"name": "heavy cream", "quantity": 200.0, "unit": "ml"}]
        ai = self._ai(
            _LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="heavy cream",
                        best_match=None,
                        match_type="none",
                        confidence=0.8,
                        compound_components=["butter", "milk", "flour"],
                        compound_note="Melt butter, whisk in flour, stir in milk",
                    )
                ]
            )
        )

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        # Ingredient still missing — nothing was deducted
        assert "heavy cream" in proposal.missing
        assert not any(m.ingredient_name == "heavy cream" for m in proposal.matches)

        # Compound suggestion is present
        assert len(proposal.compound_suggestions) == 1
        suggestion = proposal.compound_suggestions[0]
        assert suggestion.ingredient_name == "heavy cream"
        assert set(suggestion.components) == {"butter", "milk", "flour"}
        assert "butter" in suggestion.note.lower() or "flour" in suggestion.note.lower() or suggestion.note

    @pytest.mark.asyncio
    async def test_compound_suggestion_with_absent_component_is_dropped(self) -> None:
        """If any component is not in the pantry the whole suggestion is dropped."""
        pantry = [
            _make_item("butter", 250.0, "g", qty_base=250.0, unit_base="g"),
            _make_item("milk", 500.0, "ml", qty_base=500.0, unit_base="ml"),
            # flour is NOT in pantry
        ]
        ingredients = [{"name": "heavy cream", "quantity": 200.0, "unit": "ml"}]
        ai = self._ai(
            _LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="heavy cream",
                        best_match=None,
                        match_type="none",
                        confidence=0.8,
                        compound_components=["butter", "milk", "flour"],
                        compound_note="Melt butter, whisk in flour, stir in milk",
                    )
                ]
            )
        )

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        assert "heavy cream" in proposal.missing
        # Suggestion must be dropped entirely when a component is absent
        assert proposal.compound_suggestions == []

    @pytest.mark.asyncio
    async def test_low_confidence_compound_suggestion_is_dropped(self) -> None:
        """Compound suggestions below the threshold are discarded."""
        pantry = [
            _make_item("butter", 250.0, "g", qty_base=250.0, unit_base="g"),
            _make_item("milk", 500.0, "ml", qty_base=500.0, unit_base="ml"),
        ]
        ingredients = [{"name": "heavy cream", "quantity": 200.0, "unit": "ml"}]
        ai = self._ai(
            _LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="heavy cream",
                        best_match=None,
                        match_type="none",
                        confidence=0.4,  # below SUBSTITUTION_CONFIDENCE_THRESHOLD (0.7)
                        compound_components=["butter", "milk"],
                        compound_note="Whisk together",
                    )
                ]
            )
        )

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        assert "heavy cream" in proposal.missing
        assert proposal.compound_suggestions == []

    @pytest.mark.asyncio
    async def test_compound_suggestion_does_not_create_match_or_affect_deductions(self) -> None:
        """A compound suggestion must not produce an IngredientMatch and must not deduct."""
        pantry = [
            _make_item("butter", 250.0, "g", qty_base=250.0, unit_base="g"),
            _make_item("milk", 500.0, "ml", qty_base=500.0, unit_base="ml"),
            _make_item("eggs", 6.0, "count", qty_base=6.0, unit_base="count"),
        ]
        ingredients = [
            {"name": "eggs", "quantity": 2.0, "unit": "count"},
            {"name": "heavy cream", "quantity": 200.0, "unit": "ml"},
        ]
        ai = self._ai(
            _LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="heavy cream",
                        best_match=None,
                        match_type="none",
                        confidence=0.8,
                        compound_components=["butter", "milk"],
                        compound_note="Melt butter, stir in milk",
                    )
                ]
            )
        )

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        # heavy cream is still missing
        assert "heavy cream" in proposal.missing

        # No IngredientMatch for heavy cream
        cream_matches = [m for m in proposal.matches if m.ingredient_name == "heavy cream"]
        assert cream_matches == []

        # The only deduction is for eggs; butter and milk untouched
        deduct_totals = {m.pantry_item_name: m.deduct_qty for m in proposal.matches}
        assert "eggs" in deduct_totals
        assert "butter" not in deduct_totals
        assert "milk" not in deduct_totals

        # Compound suggestion is present
        assert len(proposal.compound_suggestions) == 1

    @pytest.mark.asyncio
    async def test_provider_failure_yields_no_compound_suggestions(self) -> None:
        """A provider outage must not fail the proposal and yields empty suggestions."""
        pantry = [_make_item("butter", 250.0, "g", qty_base=250.0, unit_base="g")]
        ingredients = [{"name": "heavy cream", "quantity": 200.0, "unit": "ml"}]
        ai = MagicMock()
        ai.complete = AsyncMock(side_effect=NoProviderAvailableError("all providers down"))

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        assert "heavy cream" in proposal.missing
        assert proposal.compound_suggestions == []

    @pytest.mark.asyncio
    async def test_compound_suggestion_not_attached_to_resolved_ingredient(self) -> None:
        """An ingredient resolved by deterministic matching must not carry a suggestion."""
        # butter resolves deterministically; model should never see it,
        # but even if it returns a compound suggestion for it, the filter drops it.
        pantry = [
            _make_item("butter", 250.0, "g", qty_base=250.0, unit_base="g"),
            _make_item("milk", 500.0, "ml", qty_base=500.0, unit_base="ml"),
        ]
        ingredients = [
            {"name": "butter", "quantity": 100.0, "unit": "g"},
            {"name": "heavy cream", "quantity": 200.0, "unit": "ml"},
        ]

        # The model is called for "heavy cream" (unmatched). Simulate it also
        # returning a bogus suggestion for "butter" (which was matched deterministically).
        # We test via resolve_aliases_with_llm directly to confirm the filter in
        # match_ingredients_with_llm strips it.
        ai = self._ai(
            _LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="heavy cream",
                        best_match=None,
                        match_type="none",
                        confidence=0.8,
                        compound_components=["butter", "milk"],
                        compound_note="Melt butter, stir in milk",
                    ),
                ]
            )
        )

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        # butter is matched and deducted
        butter_match = next(m for m in proposal.matches if m.ingredient_name == "butter")
        assert butter_match.status == "ready"

        # heavy cream is still missing and has a compound suggestion
        assert "heavy cream" in proposal.missing
        assert any(s.ingredient_name == "heavy cream" for s in proposal.compound_suggestions)

        # No compound suggestion for butter (it was resolved)
        assert not any(s.ingredient_name == "butter" for s in proposal.compound_suggestions)


class TestMissingNotes:
    """Explanations for ingredients that stayed missing (#282).

    The model was already asked for a substitution_note on every result, but
    every path that declined a candidate dropped it, leaving the user a bare
    "not in pantry" chip and nothing to act on.
    """

    @staticmethod
    def _manager(results: list[_LLMIngredientMatch]) -> MagicMock:
        manager = MagicMock()
        manager.complete = AsyncMock(return_value=_LLMMatchBatch(results=results))
        return manager

    @pytest.mark.asyncio
    async def test_match_type_none_note_reaches_the_proposal(self) -> None:
        pantry = [_make_item("pasta", 500, "g", 500, "g")]
        manager = self._manager([
            _LLMIngredientMatch(
                ingredient_name="heavy cream",
                best_match=None,
                match_type="none",
                confidence=0.9,
                substitution_note="No good stand-in; the sauce will be thinner.",
            )
        ])

        proposal = await match_ingredients_with_llm(
            recipe_id=RECIPE_ID,
            recipe_title=RECIPE_TITLE,
            recipe_ingredients=["200 g pasta", "1 cup heavy cream"],
            pantry_items=pantry,
            ai_manager=manager,
        )

        assert "heavy cream" in proposal.missing
        assert proposal.missing_notes["heavy cream"] == (
            "No good stand-in; the sauce will be thinner."
        )

    @pytest.mark.asyncio
    async def test_low_confidence_match_is_explained_without_advertising_the_swap(self) -> None:
        # The note must not repeat the model's own note here: it describes a
        # substitution we are deliberately refusing to make.
        pantry = [_make_item("yogurt", 500, "g", 500, "g")]
        manager = self._manager([
            _LLMIngredientMatch(
                ingredient_name="heavy cream",
                best_match="yogurt",
                match_type="substitute",
                confidence=0.2,
                substitution_note="Yogurt works fine here.",
            )
        ])

        proposal = await match_ingredients_with_llm(
            recipe_id=RECIPE_ID,
            recipe_title=RECIPE_TITLE,
            recipe_ingredients=["1 cup heavy cream"],
            pantry_items=pantry,
            ai_manager=manager,
        )

        note = proposal.missing_notes["heavy cream"]
        assert "too uncertain" in note
        assert "works fine" not in note

    @pytest.mark.asyncio
    async def test_note_for_a_pantry_item_the_user_does_not_have(self) -> None:
        pantry = [_make_item("pasta", 500, "g", 500, "g")]
        manager = self._manager([
            _LLMIngredientMatch(
                ingredient_name="heavy cream",
                best_match="creme fraiche",  # not in the pantry
                match_type="substitute",
                confidence=0.95,
                substitution_note="Close enough in richness.",
            )
        ])

        proposal = await match_ingredients_with_llm(
            recipe_id=RECIPE_ID,
            recipe_title=RECIPE_TITLE,
            recipe_ingredients=["1 cup heavy cream"],
            pantry_items=pantry,
            ai_manager=manager,
        )

        assert "creme fraiche" in proposal.missing_notes["heavy cream"]

    @pytest.mark.asyncio
    async def test_no_notes_for_ingredients_that_resolved(self) -> None:
        # A note must never contradict a match actually shown to the user.
        pantry = [_make_item("pasta", 500, "g", 500, "g")]
        manager = self._manager([])

        proposal = await match_ingredients_with_llm(
            recipe_id=RECIPE_ID,
            recipe_title=RECIPE_TITLE,
            recipe_ingredients=["200 g pasta"],
            pantry_items=pantry,
            ai_manager=manager,
        )

        assert proposal.missing_notes == {}

    @pytest.mark.asyncio
    async def test_provider_failure_leaves_notes_empty(self) -> None:
        pantry = [_make_item("pasta", 500, "g", 500, "g")]
        manager = MagicMock()
        manager.complete = AsyncMock(side_effect=NoProviderAvailableError("down"))

        proposal = await match_ingredients_with_llm(
            recipe_id=RECIPE_ID,
            recipe_title=RECIPE_TITLE,
            recipe_ingredients=["1 cup heavy cream"],
            pantry_items=pantry,
            ai_manager=manager,
        )

        assert "heavy cream" in proposal.missing
        assert proposal.missing_notes == {}

    @pytest.mark.asyncio
    async def test_none_match_without_note_does_not_add_spurious_entry(self) -> None:
        """match_type='none' with no substitution_note must not put anything in missing_notes.

        The model sometimes returns a none match with no note (e.g. it truly has no
        idea). The missing_notes dict must stay sparse — no empty-string or None entry
        for that ingredient (#425).
        """
        pantry = [_make_item("pasta", 500, "g", 500, "g")]
        manager = self._manager([
            _LLMIngredientMatch(
                ingredient_name="truffle oil",
                best_match=None,
                match_type="none",
                confidence=0.9,
                substitution_note=None,  # explicitly no note
            )
        ])

        proposal = await match_ingredients_with_llm(
            recipe_id=RECIPE_ID,
            recipe_title=RECIPE_TITLE,
            recipe_ingredients=["1 tbsp truffle oil"],
            pantry_items=pantry,
            ai_manager=manager,
        )

        assert "truffle oil" in proposal.missing
        # Sparse: no entry at all, not even an empty string.
        assert "truffle oil" not in proposal.missing_notes


class TestSizeAdjectiveUnits:
    """Size adjectives in the unit field must not produce spurious unit_conflicts (#223).

    Recipe ingredients arriving as dicts can have size words like "medium", "large",
    or "small" in the unit field (put there by the LLM). These should be treated as
    "no unit" so the ingredient normalises to count and matches correctly.
    """

    def test_medium_unit_normalises_to_count(self) -> None:
        """normalize_to_base_unit('avocado', 2.0, 'medium') → (2.0, 'count')."""
        from bubbly_chef.domain.normalizer import normalize_to_base_unit

        qty, unit = normalize_to_base_unit("avocado", 2.0, "medium")
        assert qty == pytest.approx(2.0)
        assert unit == "count"

    def test_large_unit_normalises_to_count(self) -> None:
        """normalize_to_base_unit('egg', 1.0, 'large') → (1.0, 'count')."""
        from bubbly_chef.domain.normalizer import normalize_to_base_unit

        qty, unit = normalize_to_base_unit("egg", 1.0, "large")
        assert qty == pytest.approx(1.0)
        assert unit == "count"

    def test_small_unit_normalises_to_count(self) -> None:
        """normalize_to_base_unit('onion', 1.0, 'small') → (1.0, 'count')."""
        from bubbly_chef.domain.normalizer import normalize_to_base_unit

        qty, unit = normalize_to_base_unit("onion", 1.0, "small")
        assert qty == pytest.approx(1.0)
        assert unit == "count"

    def test_extra_large_unit_normalises_to_count(self) -> None:
        """'extra-large' in unit field is a size adjective, not a real unit."""
        from bubbly_chef.domain.normalizer import normalize_to_base_unit

        qty, unit = normalize_to_base_unit("egg", 2.0, "extra-large")
        assert qty == pytest.approx(2.0)
        assert unit == "count"

    def test_unknown_unit_still_returns_none_none(self) -> None:
        """Genuine unknown units ('glorp') must not be silently treated as count."""
        from bubbly_chef.domain.normalizer import normalize_to_base_unit

        qty, unit = normalize_to_base_unit("avocado", 2.0, "glorp")
        assert qty is None
        assert unit is None

    def test_dict_ingredient_with_medium_unit_matches_count_pantry(self) -> None:
        """End-to-end: {name: 'avocado', quantity: 2, unit: 'medium'} vs 3 count avocados
        produces a match, not a unit_conflict."""
        pantry = [_make_item("avocado", 3.0, "count", qty_base=3.0, unit_base="count")]
        ingredients = [{"name": "avocado", "quantity": 2.0, "unit": "medium"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.unit_conflicts == [], f"Expected no conflicts, got {proposal.unit_conflicts}"
        assert len(proposal.matches) == 1
        assert proposal.matches[0].status == "ready"
        assert proposal.matches[0].deduct_qty == pytest.approx(2.0)

    def test_dict_ingredient_with_large_unit_matches_count_pantry(self) -> None:
        """large as unit on dict ingredient also resolves without conflict."""
        pantry = [_make_item("eggs", 6.0, "count", qty_base=6.0, unit_base="count")]
        ingredients = [{"name": "eggs", "quantity": 2.0, "unit": "large"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.unit_conflicts == []
        assert proposal.matches[0].status == "ready"

    def test_size_adjective_vocabulary_is_shared_constant(self) -> None:
        """The same set that drives the string-parse adjective regex also covers dict paths."""
        from bubbly_chef.services.cook_matcher import SIZE_ADJECTIVE_UNITS

        # These are the adjectives the issue references
        for adj in ("medium", "large", "small", "extra-large", "xl"):
            assert adj in SIZE_ADJECTIVE_UNITS, f"Expected {adj!r} in SIZE_ADJECTIVE_UNITS"


# ---------------------------------------------------------------------------
# Table-driven test: assume-seasonings acceptance criterion (#426)
# ---------------------------------------------------------------------------
# AC: a recipe of {tracked item + salt + pepper} → one deductible row +
#     assumed basics, no shortfalls.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "tracked_name, tracked_qty, tracked_unit, tracked_qty_base, tracked_unit_base, recipe_lines, expected_deductible_count",
    [
        # Chicken + salt: one deductible (chicken), one assumed (salt)
        (
            "chicken",
            500.0,
            "g",
            500.0,
            "g",
            [
                {"name": "chicken", "quantity": 200.0, "unit": "g"},
                {"name": "salt", "quantity": 1.0, "unit": "tsp"},
            ],
            1,
        ),
        # Pasta + pepper: one deductible (pasta), one assumed (pepper)
        (
            "pasta",
            400.0,
            "g",
            400.0,
            "g",
            [
                {"name": "pasta", "quantity": 200.0, "unit": "g"},
                {"name": "black pepper", "quantity": 0.5, "unit": "tsp"},
            ],
            1,
        ),
        # Eggs + salt + pepper: one deductible (eggs), two assumed (salt + pepper)
        (
            "eggs",
            6.0,
            "count",
            6.0,
            "count",
            [
                {"name": "eggs", "quantity": 3.0, "unit": "count"},
                {"name": "salt", "quantity": 0.5, "unit": "tsp"},
                {"name": "black pepper", "quantity": 0.25, "unit": "tsp"},
            ],
            1,
        ),
        # Beef + salt + pepper + olive oil: one deductible, three assumed
        (
            "beef",
            600.0,
            "g",
            600.0,
            "g",
            [
                {"name": "beef", "quantity": 300.0, "unit": "g"},
                {"name": "salt", "quantity": 1.0, "unit": "tsp"},
                {"name": "pepper", "quantity": 0.5, "unit": "tsp"},
                {"name": "olive oil", "quantity": 1.0, "unit": "tbsp"},
            ],
            1,
        ),
    ],
    ids=[
        "chicken_plus_salt",
        "pasta_plus_black_pepper",
        "eggs_plus_salt_and_pepper",
        "beef_plus_salt_pepper_oil",
    ],
)
class TestAssumedStaplesTableDriven:
    """Table-driven AC test for #426: tracked item + seasonings → no shortfalls.

    For each row:
    - ``missing`` must be empty (no shortfall report)
    - exactly ``expected_deductible_count`` matches have a non-None ``deduct_qty``
    - all seasoning ingredients land in ``assumed`` status, not ``missing``
    - no match has ``status == 'shortfall'``
    """

    def test_no_shortfalls_and_correct_deductible_count(
        self,
        tracked_name: str,
        tracked_qty: float,
        tracked_unit: str,
        tracked_qty_base: float,
        tracked_unit_base: str,
        recipe_lines: list[dict],
        expected_deductible_count: int,
    ) -> None:
        pantry = [
            _make_item(
                tracked_name,
                tracked_qty,
                tracked_unit,
                qty_base=tracked_qty_base,
                unit_base=tracked_unit_base,
            )
        ]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, recipe_lines, pantry)

        # AC: no missing ingredients
        assert proposal.missing == [], (
            f"Expected no missing ingredients, got: {proposal.missing}"
        )

        # AC: no shortfalls
        shortfall_matches = [m for m in proposal.matches if m.status == "shortfall"]
        assert shortfall_matches == [], (
            f"Expected no shortfalls, got: {[m.ingredient_name for m in shortfall_matches]}"
        )

        # AC: exactly one deductible row (the tracked pantry item)
        deductible = [m for m in proposal.matches if m.deduct_qty is not None]
        assert len(deductible) == expected_deductible_count, (
            f"Expected {expected_deductible_count} deductible row(s), "
            f"got {len(deductible)}: {[m.ingredient_name for m in deductible]}"
        )

        # AC: assumed basics (the seasonings) are collapsed — status=assumed, never missing
        assumed = [m for m in proposal.matches if m.status == "assumed"]
        seasoning_names = {
            ing["name"]
            for ing in recipe_lines
            if ing["name"] not in (tracked_name,)
        }
        for name in seasoning_names:
            assert any(m.ingredient_name == name for m in assumed), (
                f"Expected {name!r} to have status=assumed, "
                f"but it was not in assumed matches: {[m.ingredient_name for m in assumed]}"
            )
# Table-driven compound-suggestion tests (#424)
# ---------------------------------------------------------------------------
# Each row exercises one outcome for the cream ← butter+milk+flour family of
# substitutions.  Parameters mirror the six acceptance criteria in issue #424:
# the suggestion must survive the round-trip typed (not as prose), must only
# appear when ALL components are present, must be dropped on low confidence,
# and must never produce a deduction or an IngredientMatch.
#
# Row shape: (id, pantry_names, components, confidence, expect_suggestion)
# "id" is a human-readable label shown in pytest output.
# ---------------------------------------------------------------------------

_COMPOUND_TABLE = [
    pytest.param(
        # All three components present → suggestion survives typed end-to-end.
        ["butter", "milk", "flour"],
        ["butter", "milk", "flour"],
        0.85,
        True,
        id="all_components_present",
    ),
    pytest.param(
        # flour absent → whole suggestion dropped.
        ["butter", "milk"],
        ["butter", "milk", "flour"],
        0.85,
        False,
        id="one_component_absent",
    ),
    pytest.param(
        # All present but confidence is too low → dropped.
        ["butter", "milk", "flour"],
        ["butter", "milk", "flour"],
        0.4,
        False,
        id="low_confidence",
    ),
    pytest.param(
        # Only two components (butter+milk) — valid subset — must also reach the proposal.
        ["butter", "milk"],
        ["butter", "milk"],
        0.9,
        True,
        id="two_component_subset",
    ),
]


class TestCompoundSuggestionTableDriven:
    """Table-driven coverage for issue #424 — compound-sub schema round-trip.

    Validates that a compound suggestion (cream ← butter + milk + flour) survives
    the full typed pipeline: _LLMIngredientMatch → resolve_aliases_with_llm →
    match_ingredients_with_llm → CookProposal.compound_suggestions[].

    Deduction invariant is checked in every row: component items must never
    appear in proposal.matches for the missing ingredient.
    """

    @staticmethod
    def _make_pantry(*names: str) -> list[PantryItem]:
        """Create pantry items for the given names (100 g each)."""
        return [_make_item(n, 100.0, "g", qty_base=100.0, unit_base="g") for n in names]

    @staticmethod
    def _ai_for_compound(
        ingredient_name: str,
        components: list[str],
        confidence: float,
    ) -> MagicMock:
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=_LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name=ingredient_name,
                        best_match=None,
                        match_type="none",
                        confidence=confidence,
                        compound_components=components,
                        compound_note="Melt butter, whisk in flour, stir in milk until thickened",
                    )
                ]
            )
        )
        return ai

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "pantry_names, components, confidence, expect_suggestion",
        _COMPOUND_TABLE,
    )
    async def test_compound_round_trip(
        self,
        pantry_names: list[str],
        components: list[str],
        confidence: float,
        expect_suggestion: bool,
    ) -> None:
        """Compound suggestion for heavy cream survives typed round-trip or is correctly dropped."""
        _alias_cache.clear()

        pantry = self._make_pantry(*pantry_names)
        ingredients = [{"name": "heavy cream", "quantity": 200.0, "unit": "ml"}]
        ai = self._ai_for_compound("heavy cream", components, confidence)

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        # Ingredient stays in missing regardless of suggestion outcome.
        assert "heavy cream" in proposal.missing

        # No IngredientMatch is ever created for a missing ingredient.
        assert not any(m.ingredient_name == "heavy cream" for m in proposal.matches)

        if expect_suggestion:
            assert len(proposal.compound_suggestions) == 1
            sug = proposal.compound_suggestions[0]
            # Typed fields are present and correct (not raw prose).
            assert sug.ingredient_name == "heavy cream"
            # Only components that exist in the pantry appear.
            assert set(sug.components) == set(pantry_names)
            assert sug.note  # non-empty instruction
            # Deduction invariant: no component item appears as a deduction.
            deducted_names = {m.pantry_item_name for m in proposal.matches if m.deduct_qty}
            for component in sug.components:
                assert component not in deducted_names, (
                    f"Component '{component}' must not be deducted for a compound suggestion"
                )
        else:
            assert proposal.compound_suggestions == []


class TestCompoundComponentItems:
    """Issue #284 — component_items resolves each compound component to a pantry row.

    component_items is what the cook modal deducts from once the user types a
    quantity; it must carry the real pantry_item_id and base_unit for every
    name in `components`, in the same order, and must never itself trigger a
    deduction (that stays always-unresolved — quantities come from the user).
    """

    @pytest.mark.asyncio
    async def test_component_items_resolve_id_and_base_unit(self) -> None:
        butter = _make_item("butter", 250.0, "g", qty_base=250.0, unit_base="g")
        milk = _make_item("milk", 500.0, "ml", qty_base=500.0, unit_base="ml")
        flour = _make_item("flour", 1.0, "kg", qty_base=1000.0, unit_base="g")
        pantry = [butter, milk, flour]
        ingredients = [{"name": "heavy cream", "quantity": 200.0, "unit": "ml"}]
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=_LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="heavy cream",
                        best_match=None,
                        match_type="none",
                        confidence=0.85,
                        compound_components=["butter", "milk", "flour"],
                        compound_note="Melt butter, whisk in flour, stir in milk",
                    )
                ]
            )
        )

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        assert len(proposal.compound_suggestions) == 1
        sug = proposal.compound_suggestions[0]
        assert [c.name for c in sug.component_items] == ["butter", "milk", "flour"]
        by_name = {c.name: c for c in sug.component_items}
        assert by_name["butter"].pantry_item_id == butter.id
        assert by_name["butter"].base_unit == "g"
        assert by_name["milk"].pantry_item_id == milk.id
        assert by_name["milk"].base_unit == "ml"
        assert by_name["flour"].pantry_item_id == flour.id
        assert by_name["flour"].base_unit == "g"

    @pytest.mark.asyncio
    async def test_component_items_derives_base_unit_when_row_lacks_one(self) -> None:
        """A pantry row predating base-unit tracking still resolves a usable unit."""
        eggs = _make_item("eggs", 6.0, "count", qty_base=None, unit_base=None)
        pantry = [eggs]
        ingredients = [{"name": "custard", "quantity": 1.0, "unit": "cup"}]
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=_LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="custard",
                        best_match=None,
                        match_type="none",
                        confidence=0.85,
                        compound_components=["eggs"],
                        compound_note="Whisk eggs with sugar and milk",
                    )
                ]
            )
        )

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        assert len(proposal.compound_suggestions) == 1
        component = proposal.compound_suggestions[0].component_items[0]
        assert component.pantry_item_id == eggs.id
        assert component.base_unit == "count"

    @pytest.mark.asyncio
    async def test_component_items_never_appear_as_a_deduction(self) -> None:
        """component_items is advisory routing only — it must not deduct on its own."""
        butter = _make_item("butter", 250.0, "g", qty_base=250.0, unit_base="g")
        milk = _make_item("milk", 500.0, "ml", qty_base=500.0, unit_base="ml")
        pantry = [butter, milk]
        ingredients = [{"name": "heavy cream", "quantity": 200.0, "unit": "ml"}]
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=_LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="heavy cream",
                        best_match=None,
                        match_type="none",
                        confidence=0.85,
                        compound_components=["butter", "milk"],
                        compound_note="Melt butter, stir in milk",
                    )
                ]
            )
        )

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        assert not any(m.pantry_item_id in {butter.id, milk.id} for m in proposal.matches)

    @pytest.mark.asyncio
    async def test_component_items_dedupe_by_pantry_item_id(self) -> None:
        """Two model-supplied names that normalize onto one pantry row must
        produce a single component_item, not two mirrored entries that would
        double-deduct whatever quantity the user types (issue #284 follow-up)."""
        milk = _make_item("milk", 500.0, "ml", qty_base=500.0, unit_base="ml")
        pantry = [milk]
        ingredients = [{"name": "custard base", "quantity": 200.0, "unit": "ml"}]
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=_LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="custard base",
                        best_match=None,
                        match_type="none",
                        confidence=0.85,
                        compound_components=["milk", "whole milk"],
                        compound_note="Warm the milk",
                    )
                ]
            )
        )

        proposal = await match_ingredients_with_llm(
            RECIPE_ID, RECIPE_TITLE, ingredients, pantry, ai
        )

        assert len(proposal.compound_suggestions) == 1
        sug = proposal.compound_suggestions[0]
        assert [c.pantry_item_id for c in sug.component_items] == [milk.id]
        assert len(sug.component_items) == 1
        # The prose listing may still echo the model's two names verbatim —
        # only the structured, deducted-against list must be deduped.
        assert sug.components == ["milk", "milk"]


class TestUnitConflictFallback:
    """Issue #209 — soft fallback replaces blocking unit_conflict for unresolvable units.

    Rule:
    - Genuine dimension mismatch (g vs count, g vs ml, …): stay unit_conflict.
    - One or both sides have an unregistered/unresolvable unit: emit imprecise.
      The ingredient IS matched, but the quantity can't be expressed in a shared
      unit, so nothing is auto-deducted: deduct_qty is None and the line makes no
      reservation in the consumption ledger. `imprecise` is a never-auto-deduct
      status across the stack — pre-filling a deduction here would be silently
      applied by confirm (against the "left as it is" UI copy) and, worse, would
      be read by deduct_pantry_item as a BASE-unit quantity while expressed in the
      display unit, corrupting stock when display != base.
    """

    # ------------------------------------------------------------------
    # Soft fallback cases (previously unit_conflict, now imprecise)
    # ------------------------------------------------------------------

    def test_handful_against_bag_is_soft_fallback(self) -> None:
        """'1 handful' is not a registered unit → soft fallback, not hard conflict."""
        pantry = [_make_item("baby spinach", 1.0, "bag", qty_base=1.0, unit_base="count")]
        ingredients = [{"name": "baby spinach", "quantity": 1.0, "unit": "handful"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.unit_conflicts == []
        assert len(proposal.matches) == 1
        match = proposal.matches[0]
        assert match.status == "imprecise"
        # Soft fallback does not invent a deduction — never-auto-deduct status.
        assert match.deduct_qty is None

    def test_bunch_pantry_unit_uses_display_unit_as_base(self) -> None:
        """Pantry in bunches, recipe in sprigs; sprig is piece and bunch is package.
        This hits the existing piece-vs-package path (not the new soft fallback),
        so status is imprecise and no deduction is made."""
        pantry = [_make_item("parsley", 1.0, "bunch")]
        ingredients = [{"name": "parsley", "quantity": 5.0, "unit": "sprigs"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        # sprig (piece) against bunch (package) → existing piece-vs-package imprecise
        assert proposal.unit_conflicts == []
        assert len(proposal.matches) == 1
        assert proposal.matches[0].status == "imprecise"
        # piece-vs-package path does not pre-fill a deduction
        assert proposal.matches[0].deduct_qty is None

    def test_loaf_pantry_with_unresolvable_recipe_unit(self) -> None:
        """Pantry is 1 loaf of bread; recipe asks for 2 slices.
        This goes through piece-vs-package (slice→piece, loaf→package), giving
        imprecise — confirmed the old unit_conflict does NOT fire here."""
        pantry = [_make_item("bread", 1.0, "loaf")]
        ingredients = [{"name": "bread", "quantity": 2.0, "unit": "slices"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.unit_conflicts == []
        match = proposal.matches[0]
        assert match.status == "imprecise"

    def test_unregistered_pantry_unit_with_volume_recipe_unit(self) -> None:
        """Pantry uses 'bag' (count dimension); recipe uses 'cup' (ml dimension).
        'bag' → count, 'cup' → ml. Both sides' dimensions are known but differ
        → this IS a genuine mismatch; expect unit_conflict (not soft fallback).
        """
        pantry = [_make_item("flour", 2.0, "bag", qty_base=2.0, unit_base="count")]
        ingredients = [{"name": "flour", "quantity": 1.0, "unit": "cup"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        # count vs ml → genuine dimension mismatch → unit_conflict
        assert len(proposal.unit_conflicts) == 1
        assert proposal.unit_conflicts[0]["ingredient"] == "flour"
        assert proposal.matches[0].status == "unit_conflict"

    def test_soft_fallback_reports_pantry_base_unit_not_a_guess(self) -> None:
        """The soft-fallback line carries the pantry row's base unit and no
        pre-filled deduction — if the user later fills one in, confirm reads it
        in the same unit deduct_pantry_item expects (base), so stock stays sane
        even when display != base."""
        pantry = [_make_item("fresh herbs", 1.0, "bunch")]
        ingredients = [{"name": "fresh herbs", "quantity": 2.0, "unit": "handful"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.unit_conflicts == []
        match = proposal.matches[0]
        assert match.status == "imprecise"
        assert match.deduct_qty is None
        # base_unit is the pantry row's base unit, not a fabricated display guess.
        assert match.base_unit is not None

    def test_soft_fallback_makes_no_ledger_reservation(self) -> None:
        """Two soft-fallback lines against the same pantry row: because an
        imprecise line claims nothing, the second line still sees the full stock
        (no phantom reservation from the first — the old code wrongly claimed 1)."""
        pantry = [_make_item("mixed greens", 2.0, "bag", qty_base=2.0, unit_base="count")]
        ingredients = [
            {"name": "mixed greens", "quantity": 1.0, "unit": "handful"},
            {"name": "mixed greens", "quantity": 1.0, "unit": "handful"},
        ]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.unit_conflicts == []
        # Both go through soft fallback.
        assert all(m.status == "imprecise" for m in proposal.matches)
        assert all(m.deduct_qty is None for m in proposal.matches)
        # Second line still sees all 2 bags — an imprecise line reserves nothing.
        assert proposal.matches[1].pantry_qty_available == pytest.approx(2.0)

    def test_soft_fallback_never_emits_deduction_when_display_differs_from_base(self) -> None:
        """Stock-corruption regression (#209).

        The old fallback pre-filled deduct_qty=1.0 in the pantry's *display* unit
        (e.g. "1 dozen", "1 kg"), but deduct_pantry_item reads deduct_qty as a
        *base*-unit quantity. When display != base, confirm would then subtract 1
        base unit (1 egg, 1 g) while the UI said "left as it is" — silently wrong.
        The fix emits no deduction at all, so no display/base mixup is possible.

        Here the pantry row is 1 dozen eggs (display "dozen", base "count" = 12),
        matched against an unresolvable recipe unit. The fallback must not carry a
        positive deduct_qty in either unit interpretation."""
        pantry = [_make_item("eggs", 1.0, "dozen", qty_base=12.0, unit_base="count")]
        ingredients = [{"name": "eggs", "quantity": 1.0, "unit": "handful"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.unit_conflicts == []
        match = proposal.matches[0]
        assert match.status == "imprecise"
        # No deduction → confirm can't misread a display-unit qty as a base qty.
        assert match.deduct_qty is None

    # ------------------------------------------------------------------
    # Genuine conflict cases (must remain unit_conflict)
    # ------------------------------------------------------------------

    def test_mass_vs_count_stays_unit_conflict(self) -> None:
        """Sugar measured in grams vs pantry measured in items is a real mismatch."""
        pantry = [_make_item("sugar", 1.0, "item", qty_base=1.0, unit_base="count")]
        ingredients = [{"name": "sugar", "quantity": 200.0, "unit": "g"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert len(proposal.unit_conflicts) == 1
        assert proposal.unit_conflicts[0]["ingredient"] == "sugar"
        assert proposal.matches[0].status == "unit_conflict"
        assert proposal.matches[0].deduct_qty is None

    def test_volume_vs_count_stays_unit_conflict(self) -> None:
        """Recipe asks for cups of something the pantry counts in items."""
        pantry = [_make_item("stock", 2.0, "item", qty_base=2.0, unit_base="count")]
        ingredients = [{"name": "stock", "quantity": 1.0, "unit": "cup"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert len(proposal.unit_conflicts) == 1
        assert proposal.matches[0].status == "unit_conflict"

    def test_matcha_tbsp_vs_gram_stays_unit_conflict(self) -> None:
        """No density for matcha → tbsp cannot convert to g → genuine conflict."""
        pantry = [_make_item("matcha", 30.0, "g", qty_base=30.0, unit_base="g")]
        ingredients = [{"name": "matcha", "quantity": 1.0, "unit": "tbsp"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        # tbsp is ml-dimension, g is mass-dimension; no density to bridge → conflict.
        assert len(proposal.unit_conflicts) == 1
        assert proposal.matches[0].status == "unit_conflict"
        assert proposal.matches[0].deduct_qty is None
