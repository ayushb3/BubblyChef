"""Regression tests for #222 — piece units against package rows.

A recipe's piece unit (slice, leaf, clove) counts pieces *of* an ingredient; a
pantry row's package unit (loaf, bunch, head, item) counts packages containing
an unknown number of those pieces. The two used to compare as bare counts,
which reported a shortfall and deducted the entire package. They now resolve to
status="imprecise": the ingredient is satisfied and nothing is deducted.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from bubbly_chef.domain.normalizer import (
    PACKAGE_UNITS,
    PIECE_UNITS,
    is_package_unit,
    is_piece_unit,
)
from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.services.cook_matcher import match_ingredients

RECIPE_ID = str(uuid.uuid4())
RECIPE_TITLE = "Salmon Avocado Toast"


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


class TestUnitClassification:
    """The two sets are the single source of truth for the distinction."""

    def test_piece_and_package_sets_are_disjoint(self) -> None:
        assert not (PIECE_UNITS & PACKAGE_UNITS)

    def test_count_belongs_to_neither_set(self) -> None:
        """'6 count garlic' is a genuine tally, not a package."""
        assert not is_package_unit("count")
        assert not is_piece_unit("count")
        assert not is_package_unit("ct")

    def test_plurals_and_casing_resolve(self) -> None:
        assert is_piece_unit("Slices")
        assert is_piece_unit("leaves")
        assert is_package_unit(" Loaves ")
        assert is_package_unit("bunches")

    def test_empty_unit_is_neither(self) -> None:
        assert not is_piece_unit(None)
        assert not is_package_unit("")


class TestImpreciseMatches:
    """Piece-vs-package pairs no longer destroy the package."""

    def test_slices_against_a_loaf_deducts_nothing(self) -> None:
        pantry = [_make_item("bread", 1.0, "item", qty_base=1.0, unit_base="count")]
        ingredients = [{"name": "bread", "quantity": 4.0, "unit": "slices"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        match = proposal.matches[0]
        assert match.status == "imprecise"
        assert match.deduct_qty is None
        assert match.shortfall is None

    def test_leaves_against_a_bunch_deducts_nothing(self) -> None:
        pantry = [_make_item("basil", 1.0, "bunch", qty_base=1.0, unit_base="count")]
        ingredients = [{"name": "basil", "quantity": 8.0, "unit": "leaves"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.matches[0].status == "imprecise"
        assert proposal.matches[0].deduct_qty is None

    def test_cloves_against_a_head_deducts_nothing(self) -> None:
        pantry = [_make_item("garlic", 1.0, "head", qty_base=1.0, unit_base="count")]
        ingredients = [{"name": "garlic", "quantity": 2.0, "unit": "cloves"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.matches[0].status == "imprecise"
        assert proposal.matches[0].deduct_qty is None

    def test_imprecise_is_not_a_unit_conflict_and_not_missing(self) -> None:
        pantry = [_make_item("bread", 1.0, "loaf", qty_base=1.0, unit_base="count")]
        ingredients = [{"name": "bread", "quantity": 4.0, "unit": "slice"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.unit_conflicts == []
        assert proposal.missing == []

    def test_the_package_row_stays_available_to_later_ingredients(self) -> None:
        """An imprecise match claims nothing, so it cannot starve a later line."""
        pantry = [_make_item("bread", 2.0, "item", qty_base=2.0, unit_base="count")]
        ingredients = [
            {"name": "bread", "quantity": 4.0, "unit": "slices"},
            {"name": "bread", "quantity": 2.0, "unit": "count"},
        ]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.matches[0].status == "imprecise"
        assert proposal.matches[1].status == "ready"
        assert proposal.matches[1].deduct_qty == 2.0


class TestGenuineConversionsAreUnchanged:
    """`imprecise` must never short-circuit a conversion that would succeed."""

    def test_raw_item_triggers_the_package_path_but_count_does_not(self) -> None:
        """normalize_unit() maps 'item' → 'count'; the raw unit must be read."""
        as_item = match_ingredients(
            RECIPE_ID,
            RECIPE_TITLE,
            [{"name": "garlic", "quantity": 2.0, "unit": "cloves"}],
            [_make_item("garlic", 6.0, "item", qty_base=6.0, unit_base="count")],
        )
        as_count = match_ingredients(
            RECIPE_ID,
            RECIPE_TITLE,
            [{"name": "garlic", "quantity": 2.0, "unit": "cloves"}],
            [_make_item("garlic", 6.0, "count", qty_base=6.0, unit_base="count")],
        )

        assert as_item.matches[0].status == "imprecise"
        assert as_count.matches[0].status == "ready"
        assert as_count.matches[0].deduct_qty == 2.0

    def test_piece_weight_conversion_against_a_mass_row_still_deducts(self) -> None:
        """2 slices cheese against 500 g resolves through the conventional weight."""
        pantry = [_make_item("cheese", 500.0, "g", qty_base=500.0, unit_base="g")]
        ingredients = [{"name": "cheese", "quantity": 2.0, "unit": "slices"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        match = proposal.matches[0]
        assert match.status == "ready"
        assert match.base_unit == "g"
        assert match.deduct_qty is not None and match.deduct_qty > 0

    def test_counted_eggs_against_a_dozen_still_deducts(self) -> None:
        pantry = [_make_item("eggs", 1.0, "dozen", qty_base=12.0, unit_base="count")]
        ingredients = [{"name": "eggs", "quantity": 2.0, "unit": "count"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.matches[0].status == "ready"
        assert proposal.matches[0].deduct_qty == 2.0

    def test_unconvertible_pair_is_still_a_unit_conflict(self) -> None:
        """A non-piece recipe unit against a package row keeps the old refusal."""
        pantry = [_make_item("matcha", 1.0, "bag", qty_base=1.0, unit_base="count")]
        ingredients = [{"name": "matcha", "quantity": 2.0, "unit": "handful"}]

        proposal = match_ingredients(RECIPE_ID, RECIPE_TITLE, ingredients, pantry)

        assert proposal.matches[0].status == "unit_conflict"
        assert len(proposal.unit_conflicts) == 1
