"""Real-world recipe-line vs pantry-row cases for the unit-conversion gaps.

One table, two consumers: ``test_unit_conversion_gaps.py`` runs every case through
the real cook matcher and the real ``deduct_pantry_item``, and asserts the settled
behaviour below. The same table, run on the code before the fix, is the "before"
column in the PR (which of these converted, which went ``unit_conflict`` or
``imprecise``, which converted wrongly).

Expected numbers are written as formulas over the unit constants so they can be
audited by hand rather than pasted from the implementation's output. Constants
mirror ``domain/normalizer.py`` (cup = 240 ml, oz = 28.35 g, lb = 453.59 g, ...).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Unit constants (kept in step with domain/normalizer.py _TO_ML / _TO_G).
OZ = 28.35
LB = 453.59
CUP = 240.0
TBSP = 15.0
TSP = 5.0
FL_OZ = 29.57
PINT = 473.0
QUART = 946.0
GALLON = 3785.0

Row = tuple[str, float, str]


def left(qty: float, base: float, used: float) -> float:
    """Display quantity left on a row of ``qty`` (worth ``base``) after using ``used``."""
    return qty * max(0.0, base - used) / base


@dataclass(frozen=True)
class Case:
    """One recipe line against one pantry row, and what a home cook expects."""

    id: str
    pantry: tuple[Row, ...]
    line: str | dict[str, Any]
    status: str
    deduct: float | None = None
    base: str | None = None
    approx: bool = False
    # Display quantity left on the first pantry row after the deduction is applied.
    remaining: float | None = None
    shortfall: float | None = None
    # Stand-in for the (mocked) LLM alias tier: recipe name -> pantry name.
    aliases: dict[str, str] = field(default_factory=dict)
    note: str = ""


CASES: tuple[Case, ...] = (
    # --- count vs dozen --------------------------------------------------------
    Case("eggs-3-off-a-dozen", (("eggs", 1, "dozen"),), "3 eggs",
         "ready", 3, "count", False, left(1, 12, 3)),
    Case("a-dozen-vs-six-eggs", (("eggs", 6, "item"),), "1 dozen eggs",
         "shortfall", 6, "count", False, 0.0, shortfall=6),
    Case("half-dozen-off-two-dozen", (("eggs", 2, "dozen"),), "1/2 dozen eggs",
         "ready", 6, "count", False, left(2, 24, 6)),
    Case("eggs-off-a-carton", (("eggs", 1, "carton"),), "2 large eggs",
         "ready", 2, "count", True, left(1, 12, 2),
         note="a carton of eggs is a dozen"),
    # --- garlic: clove vs head -------------------------------------------------
    Case("cloves-off-a-head", (("garlic", 1, "head"),), "2 cloves garlic",
         "ready", 2 * 5, "g", True, left(1, 50, 10)),
    Case("a-head-off-loose-cloves", (("garlic", 12, "clove"),), "1 head garlic",
         "ready", 50, "g", True, left(12, 60, 50)),
    Case("cloves-off-grams-of-garlic", (("garlic", 200, "g"),), "3 cloves garlic",
         "ready", 3 * 5, "g", True, left(200, 200, 15)),
    Case("garlic-cloves-as-a-name", (("garlic", 1, "head"),), "2 garlic cloves",
         "ready", 10, "g", True, left(1, 50, 10)),
    Case("garlic-range-1-2-cloves", (("garlic", 1, "head"),), "1-2 cloves garlic",
         "ready", 1.5 * 5, "g", True, left(1, 50, 7.5),
         note="midpoint is deducted"),
    Case("cloves-off-two-bulbs", (("garlic", 2, "bulb"),), "2 cloves garlic",
         "ready", 2 * 5, "g", True, left(2, 100, 10),
         note="a bulb of garlic is a head (#866)"),
    Case("twelve-cloves-from-one-head", (("garlic", 1, "head"),), "12 cloves garlic",
         "shortfall", 50, "g", True, 0.0, shortfall=10),
    # --- onions: count vs weight -----------------------------------------------
    Case("an-onion-off-a-pound", (("onions", 1, "lb"),), "1 onion",
         "ready", 150, "g", True, left(1, LB, 150)),
    Case("two-onions-off-three", (("onions", 3, "item"),), "2 medium onions",
         "ready", 2, "count", False, left(3, 3, 2)),
    Case("grams-of-onion-off-a-count", (("onions", 4, "item"),), "300 g onion",
         "ready", 2, "count", True, left(4, 4, 2)),
    # --- flour: cup vs weight / bag ---------------------------------------------
    Case("a-cup-of-flour-off-two-pounds", (("flour", 2, "lb"),), "1 cup flour",
         "ready", CUP * 0.53, "g", True, left(2, 2 * LB, CUP * 0.53)),
    Case("a-cup-of-flour-off-a-bag", (("flour", 1, "bag"),), "1 cup flour",
         "ready", CUP * 0.53, "g", True, left(1, 5 * LB, CUP * 0.53),
         note="a bag of flour is 5 lb"),
    Case("four-cups-flour-vs-a-pound", (("flour", 1, "lb"),), "4 cups flour",
         "shortfall", LB, "g", True, 0.0, shortfall=4 * CUP * 0.53 - LB),
    Case("grams-of-flour-off-cups", (("flour", 2, "cup"),), "250 g flour",
         "ready", 250, "g", True, left(2, 2 * CUP * 0.53, 250)),
    Case("mixed-number-cups-of-flour", (("flour", 1, "kg"),), "1 1/2 cups flour",
         "ready", 1.5 * CUP * 0.53, "g", True, left(1, 1000, 1.5 * CUP * 0.53)),
    Case("pounds-of-flour-off-a-kilo", (("flour", 1, "kg"),), "2 lb flour",
         "ready", 2 * LB, "g", False, left(1, 1000, 2 * LB)),
    # --- butter: tbsp / sticks / lb ------------------------------------------------
    Case("a-tbsp-of-butter-off-a-pound", (("butter", 1, "lb"),), "1 tbsp butter",
         "ready", TBSP * 0.911, "g", True, left(1, LB, TBSP * 0.911)),
    Case("a-tbsp-of-butter-off-sticks", (("butter", 4, "stick"),), "1 tbsp butter",
         "ready", TBSP * 0.911, "g", True, left(4, 4 * 113, TBSP * 0.911)),
    Case("half-a-cup-butter-off-sticks", (("butter", 4, "stick"),), "1/2 cup butter",
         "ready", 0.5 * CUP * 0.911, "g", True, left(4, 4 * 113, 0.5 * CUP * 0.911)),
    Case("two-sticks-off-a-pound", (("butter", 1, "lb"),), "2 sticks butter",
         "ready", 2 * 113, "g", False, left(1, LB, 226),
         note="a US stick is 1/4 lb by definition, not an estimate"),
    Case("a-stick-off-grams-of-butter", (("butter", 250, "g"),), "1 stick butter",
         "ready", 113, "g", False, left(250, 250, 113)),
    # --- chicken: grams vs pounds vs pieces -------------------------------------------
    Case("grams-chicken-breast-off-pounds", (("chicken breast", 1.5, "lb"),),
         "200 g chicken breast", "ready", 200, "g", False, left(1.5, 1.5 * LB, 200)),
    Case("grams-chicken-via-alias", (("chicken breast", 1.5, "lb"),), "200 g chicken",
         "ready", 200, "g", False, left(1.5, 1.5 * LB, 200),
         aliases={"chicken": "chicken breast"}),
    Case("two-breasts-off-pounds", (("chicken breast", 1.5, "lb"),), "2 chicken breasts",
         "ready", 400, "g", True, left(1.5, 1.5 * LB, 400)),
    Case("a-pound-of-chicken-off-a-count", (("chicken breast", 4, "item"),),
         "1 lb chicken breast", "ready", LB / 200, "count", True, left(4, 4, LB / 200)),
    Case("four-thighs-off-pounds", (("chicken thighs", 2, "lb"),), "4 chicken thighs",
         "ready", 4 * 115, "g", True, left(2, 2 * LB, 460)),
    # --- cans / jars ----------------------------------------------------------------
    Case("a-can-off-a-28-oz-can", (("tomatoes", 1, "28 oz can"),), "1 can tomatoes",
         "ready", 14.5 * OZ, "g", True, left(1, 28 * OZ, 14.5 * OZ),
         note="a recipe can with no size is 14.5 oz"),
    Case("a-can-off-a-size-in-the-name", (("tomatoes 28 oz", 1, "can"),), "1 can tomatoes",
         "ready", 14.5 * OZ, "g", True, left(1, 28 * OZ, 14.5 * OZ)),
    Case("a-sized-can-off-plain-cans", (("tomatoes", 2, "can"),),
         "1 (14.5 oz) can tomatoes", "ready", 1, "count", True, left(2, 2, 1)),
    Case("ounces-of-tomato-off-plain-cans", (("tomatoes", 2, "can"),), "14.5 oz tomatoes",
         "ready", 1, "count", True, left(2, 2, 1)),
    Case("a-can-of-chickpeas-off-grams", (("chickpeas", 500, "g"),), "1 can chickpeas",
         "ready", 15 * OZ, "g", True, left(500, 500, 15 * OZ)),
    Case("a-cup-of-coconut-milk-off-a-can", (("coconut milk", 1, "can"),),
         "1 cup coconut milk", "ready", CUP / (13.5 * FL_OZ), "count", True,
         left(1, 1, CUP / (13.5 * FL_OZ))),
    Case("two-cans-vs-one-can", (("black beans", 1, "can"),), "2 cans black beans",
         "shortfall", 1, "count", False, 0.0, shortfall=1),
    Case("a-can-of-tuna-off-three", (("tuna", 3, "can"),), "1 can tuna",
         "ready", 1, "count", False, left(3, 3, 1)),
    # --- milk and other liquids -----------------------------------------------------------
    Case("half-a-cup-milk-off-a-gallon", (("milk", 1, "gallon"),), "1/2 cup milk",
         "ready", 0.5 * CUP, "ml", False, left(1, GALLON, 120)),
    Case("two-cups-milk-off-a-quart", (("milk", 1, "quart"),), "2 cups milk",
         "ready", 2 * CUP, "ml", False, left(1, QUART, 480)),
    Case("250-ml-milk-off-a-cup", (("milk", 1, "cup"),), "250 ml milk",
         "shortfall", CUP, "ml", False, 0.0, shortfall=10),
    Case("a-pint-of-milk-off-a-litre", (("milk", 1, "l"),), "1 pint milk",
         "ready", PINT, "ml", False, left(1, 1000, PINT)),
    # --- pinch / dash / to taste ----------------------------------------------------------
    Case("a-pinch-of-salt", (("salt", 1, "container"),), "a pinch of salt",
         "to_taste"),
    Case("a-pinch-of-salt-no-pantry", (), "pinch of salt", "assumed"),
    Case("one-pinch-salt-never-deducts", (("salt", 500, "g"),), "1 pinch salt",
         "to_taste"),
    Case("a-dash-of-hot-sauce", (("hot sauce", 1, "bottle"),), "a dash of hot sauce",
         "to_taste"),
    Case("salt-to-taste", (("salt", 1, "kg"),), "salt, to taste", "to_taste"),
    Case("a-pinch-of-saffron-you-lack", (), "1 pinch saffron", "missing",
         note="a missing non-staple is still missing; only the unit stops blocking"),
    Case("pepper-to-taste-no-pantry", (), "freshly ground black pepper, to taste", "assumed"),
    # --- citrus ---------------------------------------------------------------------------
    Case("a-lemon-juiced", (("lemons", 3, "item"),), "1 lemon, juiced",
         "ready", 1, "count", False, left(3, 3, 1)),
    Case("tbsp-lemon-juice-off-lemons", (("lemons", 3, "item"),), "2 tbsp lemon juice",
         "ready", 30 / 45, "count", True, left(3, 3, 30 / 45)),
    Case("juice-of-one-lime", (("limes", 4, "item"),), "juice of 1 lime",
         "ready", 1, "count", False, left(4, 4, 1)),
    Case("a-lemon-off-a-pound", (("lemons", 1, "lb"),), "1 lemon",
         "ready", 100, "g", True, left(1, LB, 100)),
    Case("quarter-cup-lemon-juice", (("lemons", 2, "item"),), "1/4 cup lemon juice",
         "ready", 60 / 45, "count", True, left(2, 2, 60 / 45)),
    # --- leafy greens ---------------------------------------------------------------------
    Case("cups-spinach-off-a-5-oz-bag", (("baby spinach", 1, "5 oz bag"),), "2 cups spinach",
         "ready", 2 * CUP * 0.125, "g", True, left(1, 5 * OZ, 60)),
    Case("cups-spinach-off-a-plain-bag", (("spinach", 1, "bag"),), "2 cups spinach",
         "ready", 60 / (5 * OZ), "count", True, left(1, 1, 60 / (5 * OZ))),
    Case("a-pound-spinach-vs-a-5-oz-bag", (("spinach", 1, "5 oz bag"),), "1 lb spinach",
         "shortfall", 5 * OZ, "g", False, 0.0, shortfall=LB - 5 * OZ),
    Case("cups-spinach-off-grams", (("spinach", 200, "g"),), "4 cups spinach",
         "ready", 4 * CUP * 0.125, "g", True, left(200, 200, 120)),
    # --- spices ---------------------------------------------------------------------------
    Case("a-tsp-cumin-off-a-jar", (("cumin", 1, "jar"),), "1 tsp cumin",
         "ready", (TSP * 0.42) / (2 * OZ), "count", True,
         left(1, 1, (TSP * 0.42) / (2 * OZ))),
    Case("a-tsp-cumin-off-grams", (("cumin", 50, "g"),), "1 tsp cumin",
         "ready", TSP * 0.42, "g", True, left(50, 50, TSP * 0.42)),
    Case("a-quarter-tsp-cinnamon-off-a-jar", (("cinnamon", 1, "jar"),), "1/4 tsp cinnamon",
         "ready", (0.25 * TSP * 0.52) / (2 * OZ), "count", True,
         left(1, 1, (0.25 * TSP * 0.52) / (2 * OZ))),
    # --- metric vs imperial, both ways -----------------------------------------------------
    Case("grams-sugar-off-pounds", (("sugar", 5, "lb"),), "500 g sugar",
         "ready", 500, "g", False, left(5, 5 * LB, 500)),
    Case("a-pound-sugar-off-a-kilo", (("sugar", 1, "kg"),), "1 lb sugar",
         "ready", LB, "g", False, left(1, 1000, LB)),
    Case("cups-sugar-off-a-kilo", (("sugar", 1, "kg"),), "2 cups sugar",
         "ready", 2 * CUP * 0.85, "g", True, left(1, 1000, 2 * CUP * 0.85)),
    Case("a-litre-water-off-a-gallon", (("water", 1, "gallon"),), "1 l water",
         "ready", 1000, "ml", False, left(1, GALLON, 1000)),
    Case("fl-oz-cream-off-a-pint", (("cream", 1, "pint"),), "8 fl oz cream",
         "ready", 8 * FL_OZ, "ml", False, left(1, PINT, 8 * FL_OZ)),
    Case("ounces-parmesan-off-grams", (("parmesan", 100, "g"),), "2 oz parmesan",
         "ready", 2 * OZ, "g", False, left(100, 100, 2 * OZ)),
    Case("a-cup-of-rice-off-a-kilo", (("rice", 1, "kg"),), "1 cup rice",
         "ready", CUP * 0.85, "g", True, left(1, 1000, CUP * 0.85)),
    Case("a-cup-of-oats-off-a-canister", (("oats", 1, "18 oz container"),), "1 cup oats",
         "ready", CUP * 0.40, "g", True, left(1, 18 * OZ, CUP * 0.40)),
    Case("tbsp-honey-off-a-12-oz-bottle", (("honey", 1, "12 oz bottle"),), "2 tbsp honey",
         "ready", 2 * TBSP, "ml", True, left(1, 12 * OZ / 1.42, 2 * TBSP)),
    Case("a-tbsp-olive-oil-off-a-bottle", (("olive oil", 1, "bottle"),), "1 tbsp olive oil",
         "ready", TBSP, "ml", True, left(1, 500, TBSP)),
    Case("tbsp-sugar-off-a-bag", (("sugar", 1, "bag"),), "3 tbsp sugar",
         "ready", 3 * TBSP * 0.85, "g", True, left(1, 4 * LB, 3 * TBSP * 0.85)),
    # --- fractions and ranges ----------------------------------------------------------------
    Case("unicode-half-cup-milk", (("milk", 1, "quart"),), "½ cup milk",
         "ready", 0.5 * CUP, "ml", False, left(1, QUART, 120)),
    Case("range-tbsp-olive-oil", (("olive oil", 500, "ml"),), "1-2 tbsp olive oil",
         "ready", 1.5 * TBSP, "ml", False, left(500, 500, 22.5),
         note="available for the upper bound (30 ml), deducts the midpoint (22.5 ml)"),
    Case("range-that-only-the-midpoint-fits", (("garlic", 12, "g"),), "1-3 cloves garlic",
         "shortfall", 10, "g", True, left(12, 12, 10), shortfall=15 - 12,
         note="upper bound (15 g) is not there, so it is a shortfall; deducts the midpoint"),
    Case("range-to-eggs", (("eggs", 1, "dozen"),), "2 to 3 eggs",
         "ready", 2.5, "count", False, left(1, 12, 2.5)),
    Case("range-as-structured-line", (("garlic", 1, "head"),),
         {"name": "garlic", "quantity": 1.5, "quantity_max": 2, "unit": "clove"},
         "ready", 7.5, "g", True, left(1, 50, 7.5)),
    # --- still not convertible: must keep asking rather than invent ------------------------------
    Case("slices-of-bread-vs-a-loaf", (("bread", 1, "loaf"),), "4 slices bread",
         "imprecise", note="ADR 0003: a loaf has no stated slice count"),
    Case("cloves-of-shallots-vs-a-head", (("shallots", 3, "head"),), "2 cloves shallots",
         "imprecise", note="ADR 0003: no clove weight for shallots; baseline for the bulb row"),
    Case("cloves-of-shallots-vs-bulbs", (("shallots", 3, "bulb"),), "2 cloves shallots",
         "imprecise", note="#866: a bulb is a head, so it is guarded like one, not 2 bulbs"),
    Case("a-bulb-of-fennel-vs-a-head-row", (("fennel", 2, "head"),), "1 bulb fennel",
         "ready", 1, "count", False, left(2, 2, 1),
         note="#866: bulb and head are the same unit"),
    Case("slices-of-bread-vs-a-tin", (("bread", 1, "tin"),), "4 slices bread",
         "imprecise", note="#866: a tin is a can, guarded like one"),
    Case("a-bunch-of-parsley-vs-grams", (("parsley", 50, "g"),), "1 bunch parsley",
         "unit_conflict", note="no honest weight for a bunch"),
    Case("tsp-matcha-vs-grams", (("matcha", 50, "g"),), "1 tsp matcha",
         "unit_conflict", note="no density for matcha"),
    Case("a-handful-of-spinach", (("spinach", 200, "g"),), "1 handful spinach",
         "imprecise", note="a handful has no honest weight"),
    # --- more everyday pairs --------------------------------------------------------------------
    Case("slices-bacon-off-a-pound", (("bacon", 1, "lb"),), "2 slices bacon",
         "ready", 50, "g", True, left(1, LB, 50)),
    Case("a-cup-of-cheese-off-ounces", (("cheese", 8, "oz"),), "1 cup cheese",
         "ready", CUP * 0.45, "g", True, left(8, 8 * OZ, CUP * 0.45)),
    # --- a size on the pantry row: unit side is exact, name side is a label -------------------
    Case("grams-off-a-unit-side-28-oz-can", (("tomatoes", 1, "28 oz can"),), "400 g tomatoes",
         "ready", 400, "g", False, left(1, 28 * OZ, 400),
         note="the size is written in the unit, so it is a stated container size: exact"),
    Case("grams-off-a-name-side-28-oz-can", (("tomatoes 28 oz", 1, "can"),), "400 g tomatoes",
         "ready", 400, "g", True, left(1, 28 * OZ, 400),
         note="the size is only in the name (a label), so the can is an estimate"),
    Case("yogurt-5-3-oz-multipack", (("yogurt 5.3 oz", 1, "pack"),), "150 g yogurt",
         "unit_conflict", aliases={"yogurt": "yogurt 5.3 oz"},
         note="5.3 oz is per cup inside the pack, not the pack: never converted, never exact"),
    Case("yogurt-5-3-oz-box-of-four", (("yogurt 5.3 oz", 1, "box"),), "150 g yogurt",
         "unit_conflict", aliases={"yogurt": "yogurt 5.3 oz"},
         note="box, package and bag behave like pack"),
)
