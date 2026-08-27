"""Ingredient density data, for converting between volume and mass units.

A recipe says "1 teaspoon butter"; the pantry row says "250 g butter". Comparing
them needs a density — grams per millilitre — and density is a property of the
ingredient, not of the units. This module holds that data.

Design rule: **correctness over coverage.** A wrong deduction silently corrupts
the user's pantry, which is worse than the honest "unit conflict" the cook flow
reports when it cannot compare two units. So every entry here is a real,
citable figure, and anything without one is deliberately absent — the lookup
returns None and the caller keeps refusing the conversion.

Values are given to two or three significant figures. Most come from either
the physical density of the substance or from USDA/King Arthur cup weights
divided by the 240 ml measuring cup this codebase uses (see ``_TO_ML``).
"""

from __future__ import annotations

# ── Per-ingredient densities, g per ml ─────────────────────────────────────
#
# Keys are normalized food names (post ``normalize_food_name``), which is why
# "greek yogurt" is absent — it collapses to "yogurt" — while "sour cream",
# which does not collapse, is listed in its own right.
INGREDIENT_DENSITY_G_PER_ML: dict[str, float] = {
    # Water and water-like liquids
    "water": 1.0,
    "milk": 1.03,           # physical density of whole milk
    "buttermilk": 1.03,
    "broth": 1.0,
    "stock": 1.0,
    "wine": 0.99,           # table wine, ~12% ABV
    "vinegar": 1.01,
    "lemon juice": 1.03,
    "lime juice": 1.03,
    # Dairy
    "cream": 0.99,          # heavy/whipping cream
    "sour cream": 0.96,     # 1 cup = 230 g
    "yogurt": 1.03,         # plain and greek alike, 1 cup ≈ 245 g
    "cream cheese": 0.97,   # 1 cup = 232 g
    "cottage cheese": 0.94, # 1 cup = 226 g
    "ricotta": 0.98,        # 1 cup = 246 g
    "butter": 0.911,        # physical density of butterfat at fridge temp
    "margarine": 0.91,
    # Cheeses: these assume grated/shredded, which is how a recipe measures
    # cheese by volume. A solid block is denser, but nobody measures a block
    # in cups.
    "cheese": 0.45,         # shredded cheddar, 1 cup = 113 g
    "cheddar": 0.45,
    "mozzarella": 0.45,
    "parmesan": 0.42,       # grated, 1 cup = 100 g
    # Fats and oils
    "olive oil": 0.91,
    "vegetable oil": 0.92,
    "coconut oil": 0.92,
    "sesame oil": 0.92,
    # Syrups and thick condiments
    "honey": 1.42,
    "maple syrup": 1.32,
    "molasses": 1.40,
    "soy sauce": 1.2,       # 1 tbsp = 18 g
    "mayonnaise": 0.91,     # 1 tbsp = 13.8 g
    "ketchup": 1.14,        # 1 tbsp = 17 g
    "peanut butter": 1.08,  # 1 cup = 258 g
    "tomato sauce": 1.04,   # 1 cup = 245 g
    # Flours and dry goods
    "flour": 0.53,          # all-purpose, spooned, 1 cup = 125 g
    "bread flour": 0.55,
    "whole wheat flour": 0.53,
    "almond flour": 0.40,   # 1 cup = 96 g — much lighter than wheat flour
    "coconut flour": 0.47,
    "sugar": 0.85,          # granulated, 1 cup = 200 g
    "brown sugar": 0.93,    # packed, 1 cup = 220 g
    "powdered sugar": 0.50,  # unsifted, 1 cup = 120 g
    "salt": 1.2,            # table salt, 1 tsp = 6 g
    "rice": 0.85,           # uncooked long grain, 1 cup = 200 g
    "quinoa": 0.75,         # uncooked, 1 cup = 180 g
    "oats": 0.40,           # rolled, 1 cup = 95 g
    "cornstarch": 0.50,     # 1 cup = 120 g
    "breadcrumbs": 0.45,    # dried, 1 cup = 108 g
    "cocoa powder": 0.42,   # 1 cup = 100 g
    "baking powder": 0.80,  # 1 tsp = 4 g
    "baking soda": 1.2,     # 1 tsp = 6 g
    "chocolate chips": 0.71,  # 1 cup = 170 g
}

# ── Head-noun fallbacks, g per ml ──────────────────────────────────────────
#
# Applied only when the *last* word of the name matches, so "almond milk" and
# "olive oil" resolve while "milk chocolate" and "flour tortilla" do not. That
# restriction is what makes a keyword tier safe enough to use at all: the last
# word of an English food compound is the thing itself, the earlier words
# qualify it.
#
# Each rule covers a family whose members really do cluster around one value:
# cooking oils are 0.91-0.93, fruit juices and clear broths are 1.00-1.05.
DENSITY_HEAD_NOUN_G_PER_ML: dict[str, float] = {
    "oil": 0.92,      # every culinary oil sits in 0.91-0.93
    "juice": 1.03,    # fruit juices, slightly denser than water from sugar
    "broth": 1.0,
    "stock": 1.0,
    "water": 1.0,
    "wine": 0.99,
    "vinegar": 1.01,
    "syrup": 1.32,
    "sugar": 0.85,
    "flour": 0.53,
    "milk": 1.03,
    "yogurt": 1.03,
    "honey": 1.42,
}

# ── Category fallback, g per ml ────────────────────────────────────────────
#
# Only "beverages", and only because drinks are dilute aqueous solutions that
# genuinely all sit within a few percent of water. There is deliberately no
# entry for produce, dairy, meat or dry goods: those categories span 0.4 to
# 1.4 g/ml and any single number would be a fabrication.
CATEGORY_DENSITY_G_PER_ML: dict[str, float] = {
    "beverages": 1.0,
}

# ── Conventional weights for piece units, in grams ─────────────────────────
#
# Keyed by (unit, normalized name), because a piece unit means nothing on its
# own: a slice of bread is 28 g, a slice of cheese is 21 g, a slice of bacon
# is something else again. Only pairs with a conventional, citable weight
# appear here.
PIECE_WEIGHTS_G: dict[tuple[str, str], float] = {
    ("stick", "butter"): 113.0,     # 1 US stick = 1/4 lb = 8 tbsp
    ("stick", "margarine"): 113.0,
    ("clove", "garlic"): 3.0,       # USDA: garlic, raw, 1 clove = 3 g
    ("slice", "bread"): 28.0,       # commercial sandwich loaf slice
    ("slice", "cheese"): 21.0,      # deli sandwich slice
    ("leaf", "basil"): 0.5,         # a single fresh basil leaf
}

# ── Units this module refuses on purpose ───────────────────────────────────
#
# "handful" and "bunch" are the notable absences from any weight table.
# A handful of spinach is ~30 g and a handful of almonds is ~150 g; a bunch of
# parsley is ~60 g and a bunch of bananas is ~1200 g. There is no conventional
# figure to cite, so these stay unconvertible into mass and the cook flow keeps
# reporting an honest unit conflict rather than inventing a deduction.
UNCONVERTIBLE_TO_MASS_UNITS: frozenset[str] = frozenset({"handful", "bunch"})


def density_g_per_ml(name: str, category: str | None = None) -> float | None:
    """Return grams per millilitre for *name*, or None when there is no basis.

    Lookup order: exact ingredient entry, then head-noun family, then the
    category fallback. Returning None is a normal outcome and means "refuse to
    convert" — callers must not substitute a default.

    Args:
        name: Ingredient name. Normalize it first (``normalize_food_name``) for
            the best hit rate; lookup is case-insensitive either way.
        category: Optional food category, used only as a last resort.

    Examples:
        density_g_per_ml("butter")      -> 0.911
        density_g_per_ml("almond milk") -> 1.03   # head noun "milk"
        density_g_per_ml("chicken")     -> None   # no defensible figure
    """
    if not name:
        return None

    key = name.lower().strip()

    exact = INGREDIENT_DENSITY_G_PER_ML.get(key)
    if exact is not None:
        return exact

    words = key.split()
    if words:
        head_noun = DENSITY_HEAD_NOUN_G_PER_ML.get(words[-1])
        if head_noun is not None:
            return head_noun

    if category:
        return CATEGORY_DENSITY_G_PER_ML.get(category.lower().strip())

    return None


def piece_weight_g(unit: str, name: str) -> float | None:
    """Return the conventional gram weight of one *unit* of *name*, or None.

    Only the pairs in ``PIECE_WEIGHTS_G`` resolve; everything else refuses, so
    "1 stick celery" never gets treated as 113 g of celery.

    Examples:
        piece_weight_g("clove", "garlic") -> 3.0
        piece_weight_g("stick", "celery") -> None
    """
    if not unit or not name:
        return None
    return PIECE_WEIGHTS_G.get((unit.lower().strip(), name.lower().strip()))
