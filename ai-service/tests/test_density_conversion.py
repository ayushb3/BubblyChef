"""Tests for volume<->mass conversion via ingredient density.

Every expected value is worked out by hand in the assertion so the numbers can
be audited without re-running the code: 1 tsp = 5 ml, 1 tbsp = 15 ml,
1 cup = 240 ml (see _TO_ML), multiplied by the density in g/ml.

The refusal tests matter as much as the conversions. Deducting a made-up
quantity corrupts the pantry silently, so an ingredient with no defensible
density must keep returning (None, None) and let the cook flow report an honest
unit conflict.
"""

from __future__ import annotations

import pytest

from bubbly_chef.domain.density import (
    INGREDIENT_DENSITY_G_PER_ML,
    UNCONVERTIBLE_TO_MASS_UNITS,
    density_g_per_ml,
    piece_weight_g,
)
from bubbly_chef.domain.normalizer import normalize_to_base_unit


class TestDensityLookup:
    """density_g_per_ml() resolves by name, head noun, then category."""

    def test_exact_ingredient_entry(self) -> None:
        assert density_g_per_ml("butter") == 0.911

    def test_lookup_is_case_insensitive(self) -> None:
        assert density_g_per_ml("  Olive Oil ") == density_g_per_ml("olive oil")

    def test_head_noun_family_fallback(self) -> None:
        """'almond milk' has no entry but its head noun 'milk' does."""
        assert density_g_per_ml("almond milk") == 1.03
        assert density_g_per_ml("avocado oil") == 0.92

    def test_head_noun_only_matches_the_last_word(self) -> None:
        """'milk chocolate' is not a milk and 'flour tortilla' is not a flour.

        Matching the qualifier instead of the head noun would price milk
        chocolate at 1.03 g/ml when it is nearer 0.6 — the exact class of
        silent error the head-noun restriction exists to prevent.
        """
        assert density_g_per_ml("milk chocolate") is None
        assert density_g_per_ml("flour tortilla") is None

    def test_specific_entry_beats_head_noun(self) -> None:
        """Almond flour is much lighter than wheat flour; it must not use 0.53."""
        assert density_g_per_ml("almond flour") == 0.40
        assert density_g_per_ml("flour") == 0.53

    def test_beverage_category_fallback(self) -> None:
        assert density_g_per_ml("elderflower cordial", category="beverages") == 1.0

    def test_no_category_fallback_for_wide_categories(self) -> None:
        """produce/dairy/meat span 0.4-1.4 g/ml, so no single default is honest."""
        for category in ("produce", "dairy", "meat", "dry_goods", "other"):
            assert density_g_per_ml("mystery item", category=category) is None

    def test_unknown_name_refuses(self) -> None:
        assert density_g_per_ml("chicken breast") is None
        assert density_g_per_ml("") is None


class TestPieceWeights:
    """piece_weight_g() only answers for (unit, ingredient) pairs it knows."""

    def test_known_pairs(self) -> None:
        assert piece_weight_g("clove", "garlic") == 3.0
        assert piece_weight_g("stick", "butter") == 113.0
        assert piece_weight_g("slice", "bread") == 28.0

    def test_piece_weight_is_ingredient_specific(self) -> None:
        """A stick of celery is not 113 g, so 'stick' alone means nothing."""
        assert piece_weight_g("stick", "celery") is None
        assert piece_weight_g("slice", "watermelon") is None


class TestVolumeToMass:
    """Cross-dimension conversions the cook flow could not previously make."""

    def test_teaspoon_butter_to_grams(self) -> None:
        # 1 tsp = 5 ml; butter is 0.911 g/ml -> 4.555 g
        qty, unit = normalize_to_base_unit("butter", 1.0, "teaspoon", target_unit="g")
        assert unit == "g"
        assert qty == pytest.approx(5.0 * 0.911)
        assert qty == pytest.approx(4.555)

    def test_half_teaspoon_salt_to_grams(self) -> None:
        # 0.5 tsp = 2.5 ml; table salt is 1.2 g/ml -> 3.0 g
        qty, unit = normalize_to_base_unit("salt", 0.5, "teaspoon", target_unit="g")
        assert unit == "g"
        assert qty == pytest.approx(2.5 * 1.2)
        assert qty == pytest.approx(3.0)

    def test_tablespoon_greek_yogurt_to_grams(self) -> None:
        # "greek yogurt" normalizes to "yogurt"; 4 tbsp = 60 ml at 1.03 -> 61.8 g
        qty, unit = normalize_to_base_unit("greek yogurt", 4.0, "tablespoon", target_unit="g")
        assert unit == "g"
        assert qty == pytest.approx(60.0 * 1.03)
        assert qty == pytest.approx(61.8)

    def test_cup_flour_to_grams(self) -> None:
        # 1 cup = 240 ml; all-purpose flour is 0.53 g/ml -> 127.2 g
        qty, unit = normalize_to_base_unit("flour", 1.0, "cup", target_unit="g")
        assert unit == "g"
        assert qty == pytest.approx(240.0 * 0.53)

    def test_tablespoon_sugar_to_grams(self) -> None:
        # Was the documented refusal before density data existed.
        # 3 tbsp = 45 ml; granulated sugar is 0.85 g/ml -> 38.25 g
        qty, unit = normalize_to_base_unit("sugar", 3.0, "tbsp")
        assert unit == "g"
        assert qty == pytest.approx(45.0 * 0.85)
        assert qty == pytest.approx(38.25)

    def test_pinch_and_dash_are_teaspoon_fractions(self) -> None:
        # 1 pinch = 1/16 tsp = 0.3125 ml; salt at 1.2 g/ml -> 0.375 g,
        # which lands on the ~0.36 g a pinch of salt is usually quoted at.
        pinch, _ = normalize_to_base_unit("salt", 1.0, "pinch", target_unit="g")
        assert pinch == pytest.approx(0.375)
        # 1 dash = 1/8 tsp = 0.625 ml -> 0.75 g
        dash, _ = normalize_to_base_unit("salt", 1.0, "dash", target_unit="g")
        assert dash == pytest.approx(0.75)


class TestMassToVolume:
    """The reverse direction, and that it round-trips."""

    def test_pound_of_olive_oil_to_ml(self) -> None:
        # 1 lb = 453.59 g; olive oil is 0.91 g/ml -> 498.45 ml
        qty, unit = normalize_to_base_unit("olive oil", 1.0, "lb", target_unit="ml")
        assert unit == "ml"
        assert qty == pytest.approx(453.59 / 0.91)

    @pytest.mark.parametrize("name", ["butter", "milk", "honey", "flour", "salt"])
    def test_round_trip_ml_to_g_and_back(self, name: str) -> None:
        grams, g_unit = normalize_to_base_unit(name, 100.0, "ml", target_unit="g")
        assert g_unit == "g"
        assert grams is not None

        millilitres, ml_unit = normalize_to_base_unit(name, grams, "g", target_unit="ml")
        assert ml_unit == "ml"
        assert millilitres == pytest.approx(100.0)

    def test_conversion_is_symmetric_across_units(self) -> None:
        """Same amount of honey expressed two ways converts to the same mass."""
        via_tbsp, _ = normalize_to_base_unit("honey", 16.0, "tbsp", target_unit="g")
        via_cup, _ = normalize_to_base_unit("honey", 1.0, "cup", target_unit="g")
        assert via_tbsp == pytest.approx(via_cup)


class TestDeliberateRefusals:
    """Conversions that stay impossible on purpose."""

    def test_ingredient_without_density_refuses(self) -> None:
        """matcha is a mass ingredient, but nobody has published its cup weight."""
        assert "matcha" not in INGREDIENT_DENSITY_G_PER_ML
        assert normalize_to_base_unit("matcha", 3.0, "tbsp", target_unit="g") == (None, None)

    def test_volume_measure_of_solid_food_refuses(self) -> None:
        assert normalize_to_base_unit("chicken breast", 1.0, "cup", target_unit="g") == (None, None)
        assert normalize_to_base_unit("pasta", 2.0, "cup", target_unit="g") == (None, None)

    def test_handful_has_no_conventional_size(self) -> None:
        """A handful of spinach is ~30 g and a handful of almonds ~150 g."""
        assert "handful" in UNCONVERTIBLE_TO_MASS_UNITS
        assert normalize_to_base_unit("spinach", 1.0, "handful", target_unit="g") == (None, None)
        assert normalize_to_base_unit("spinach", 1.0, "handful", target_unit="count") == (
            None,
            None,
        )

    def test_bunch_does_not_become_a_weight(self) -> None:
        assert normalize_to_base_unit("parsley", 1.0, "bunch", target_unit="g") == (None, None)

    def test_stick_of_a_non_butter_ingredient_refuses(self) -> None:
        """113 g is the weight of a stick of butter, not of a stick of anything."""
        assert normalize_to_base_unit("celery", 1.0, "stick", target_unit="g") == (None, None)

    def test_mass_still_cannot_become_a_count(self) -> None:
        """No density turns 200 g of sugar into a number of sugar packets."""
        assert normalize_to_base_unit("sugar", 200.0, "g", target_unit="count") == (None, None)

    def test_registry_ingredient_keeps_refusing_a_nonsense_unit(self) -> None:
        """Eggs are counted; a volume unit must not be inferred into ml for them."""
        assert normalize_to_base_unit("eggs", 1.0, "pinch") == (None, None)


class TestPieceUnitConversion:
    """Piece units reach grams by conventional weight, or count 1:1."""

    def test_clove_of_garlic_to_grams(self) -> None:
        qty, unit = normalize_to_base_unit("garlic", 2.0, "cloves", target_unit="g")
        assert (qty, unit) == (6.0, "g")

    def test_slices_of_bread_to_grams(self) -> None:
        qty, unit = normalize_to_base_unit("bread", 4.0, "slices", target_unit="g")
        assert (qty, unit) == (112.0, "g")

    def test_sticks_of_butter_to_grams(self) -> None:
        assert normalize_to_base_unit("butter", 2.0, "stick") == (226.0, "g")

    @pytest.mark.parametrize(
        "unit", ["slices", "leaves", "cloves", "sprigs", "heads", "cans", "bags", "loaves"]
    )
    def test_piece_units_are_count_like(self, unit: str) -> None:
        """A count row counts discrete things, and these are discrete things."""
        qty, base = normalize_to_base_unit("mystery item", 3.0, unit, target_unit="count")
        assert (qty, base) == (3.0, "count")


class TestUnitInferredBaseUnit:
    """Unknown ingredients take their dimension from the unit they came in.

    Regression cover for pantry rows failing to resolve a base unit at all:
    anything outside INGREDIENT_CANONICAL_UNIT used to fall back to "count" via
    the category default, so "500 g greek yogurt" produced (None, None) and every
    recipe line touching it reported a unit conflict before any density work
    could apply.
    """

    @pytest.mark.parametrize(
        ("name", "quantity", "unit", "expected"),
        [
            ("basmati rice", 2.0, "kg", (2000.0, "g")),
            ("greek yogurt", 500.0, "g", (500.0, "g")),
            ("all-purpose flour", 1.0, "kg", (1000.0, "g")),
            ("sourdough starter", 8.0, "oz", (226.8, "g")),
            ("kombucha", 1.5, "l", (1500.0, "ml")),
            ("baby spinach", 1.0, "bag", (1.0, "count")),
        ],
    )
    def test_unknown_ingredient_resolves_from_its_unit(
        self, name: str, quantity: float, unit: str, expected: tuple[float, str]
    ) -> None:
        qty, base = normalize_to_base_unit(name, quantity, unit)
        assert base == expected[1]
        assert qty == pytest.approx(expected[0])

    def test_explicit_target_unit_still_wins(self) -> None:
        """The pantry row's own unit is the only one a deduction can use."""
        assert normalize_to_base_unit("basmati rice", 2.0, "kg", target_unit="count") == (
            None,
            None,
        )

    def test_registry_entry_still_wins_over_the_unit(self) -> None:
        """Milk is a volume ingredient, so a mass unit converts into ml, not g."""
        qty, base = normalize_to_base_unit("milk", 1.0, "kg")
        assert base == "ml"
        assert qty == pytest.approx(1000.0 / 1.03)
