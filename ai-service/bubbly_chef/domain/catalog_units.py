"""Default ``valid_units`` for each pantry-catalog food (issue #727).

The hosted ``food_catalog.valid_units`` column was seeded empty (``'[]'``), so
picking an autocomplete suggestion never autofilled the unit
(``AddItemRow.handleCatalogSelect`` reads ``valid_units[0]``). ``pantry_catalog.json``
carries no unit information, so this module is the source of truth: a per-category
default list, refined by ordered keyword rules and a few exact-canonical overrides.

The FIRST unit in each list is the autofill default, so it is the unit people most
often buy that food in (a gallon of milk, a dozen eggs, a pound of onions). Every
unit must be one the app already recognises: spelled as the pantry unit picker
spells it (``item``, ``L``, ``lb``...) where it has one, and otherwise a unit
``domain/normalizer.py`` understands. ``tests/test_food_catalog_seed.py`` enforces
that, and that the migration under ``supabase/migrations/`` matches this module.
"""

from __future__ import annotations

import re
from collections.abc import Mapping

# Per-category fallback when no rule or override applies.
CATEGORY_UNITS: dict[str, list[str]] = {
    "produce": ["lb", "item"],
    "dairy": ["oz", "lb", "package"],
    "meat": ["lb", "oz", "package"],
    "seafood": ["lb", "oz", "package"],
    "dry_goods": ["lb", "bag", "kg"],
    "snacks": ["bag", "oz", "lb"],
    "condiments": ["bottle", "oz", "jar"],
    "bakery": ["loaf", "slice", "item"],
    "beverages": ["quart", "L", "gallon"],
    "other": ["item"],
}

# Exact canonical -> units. Wins over the keyword rules below.
CANONICAL_UNITS: dict[str, list[str]] = {
    # dairy
    "whole egg": ["dozen", "item"],
    "white egg": ["dozen", "item"],
    "yolk egg": ["dozen", "item"],
    "grade a eggs": ["dozen", "item"],
    "stick butter": ["stick", "lb", "oz"],
    "american cheese singles": ["package", "slice"],
    "pasteurized process cheese": ["package", "slice", "oz"],
    "heavy cream": ["pint", "quart", "fl oz"],
    "sour cream": ["container", "oz"],
    "cottage cheese": ["container", "oz"],
    "full fat cottage cheese": ["container", "oz"],
    "full fat cream cheese": ["package", "oz"],
    "yogurt": ["container", "oz"],
    "greek yogurt": ["container", "oz"],
    # produce
    "garlic": ["head", "clove"],
    "overripe bananas": ["item", "lb"],
    "ripe and slightly ripe bananas": ["lb", "bunch", "item"],
    "kale": ["bunch", "bag", "oz"],
    "collards": ["bunch", "lb"],
    "beet greens": ["bunch", "lb"],
    "bok choy cabbage": ["lb", "head", "item"],
    "celery": ["bunch", "item"],
    "(scallion) green onion": ["bunch", "item"],
    "bulb and greens leeks": ["item", "bunch", "lb"],
    "bulb shallots": ["lb", "item"],
    "bulb fennel": ["item", "lb"],
    "green asparagus": ["bunch", "lb"],
    "beets": ["bunch", "lb"],
    "red radishes": ["bunch", "lb"],
    "radicchio": ["head", "item"],
    "sweet corn": ["item", "lb"],
    "green peas": ["lb", "bag", "oz"],
    "snap beans": ["lb", "oz", "bag"],
    "brussels sprouts": ["lb", "oz", "bag"],
    "baby carrots": ["bag", "lb", "oz"],
    "carrots": ["lb", "bag", "bunch"],
    "mature carrots": ["lb", "bag", "bunch"],
    "whole tomatoes": ["can", "oz"],
    "grape tomatoes": ["container", "oz", "lb"],
    "unsweetened applesauce": ["jar", "oz"],
    "green olives": ["jar", "can", "oz"],
    "breaded onion rings": ["bag", "oz"],
    "cucumber pickles": ["jar", "oz"],
    "restaurant ketchup": ["bottle", "oz"],
    "potato flour": ["bag", "lb", "kg"],
    "cassava flour": ["bag", "lb", "kg"],
    # dry goods
    "hummus": ["container", "oz"],
    "creamy peanut butter": ["jar", "oz", "lb"],
    "peanuts": ["bag", "lb", "oz"],
    "canned chickpeas": ["can", "oz"],
    "chickpeas": ["can", "lb", "bag"],
    # bakery
    "oatmeal cookies": ["package", "dozen", "item"],
    # seafood
    "canned in olive oil anchovies": ["can", "jar", "oz"],
    "shrimp crustaceans": ["lb", "bag", "oz"],
    "tail only lobster": ["item", "lb"],
    "crab crustaceans": ["lb", "item"],
    "legs only snow crab": ["lb", "package"],
    # meat
    "beef frankfurter": ["package", "item", "lb"],
    "breakfast sausage sausage": ["package", "lb", "oz"],
    "italian sausage": ["package", "lb", "item"],
    "pork sausage": ["package", "lb", "oz"],
    "turkey sausage": ["package", "lb", "oz"],
    "sliced ham": ["lb", "oz", "package"],
    "cured pork": ["lb", "oz", "package"],
    "chicken breast": ["lb", "item", "package"],
    "chicken thighs": ["lb", "item", "package"],
    "drumstick chicken": ["lb", "item", "package"],
    "wing chicken": ["lb", "item", "package"],
    "broiler or fryers chicken": ["item", "lb"],
    # condiments
    "table salt": ["container", "oz", "lb"],
    "prepared mustard": ["bottle", "jar", "oz"],
    "pasta sauce": ["jar", "oz", "can"],
    "salsa sauce": ["jar", "oz"],
    # beverages / plant milks
    "unsweetened almond milk": ["quart", "L", "gallon"],
    "unsweetened oat milk": ["quart", "L", "gallon"],
}

# Ordered (pattern, units) rules matched as whole words against the canonical. The
# first match wins, so the more specific rules come first. Patterns are alternations
# of whole words, never bare substrings ("oil" must not match "boiled").
_RULES: list[tuple[re.Pattern[str], list[str]]] = [
    (re.compile(r"\b(juice)\b"), ["bottle", "L", "fl oz"]),
    (re.compile(r"\b(soy milk)\b"), ["quart", "L", "gallon"]),
    (re.compile(r"\b(buttermilk)\b"), ["quart", "gallon", "L"]),
    (re.compile(r"\bmilk\b"), ["gallon", "L", "cup"]),
    (re.compile(r"\b(flour|sugars?)\b"), ["bag", "lb", "kg"]),
    (re.compile(r"\b(butter)\b"), ["jar", "oz", "lb"]),
    (re.compile(r"\b(oil)\b"), ["bottle", "L", "fl oz"]),
    (re.compile(r"\b(sauce|paste|puree|crushed)\b.*\b(tomato|tomatoes)\b"), ["can", "oz"]),
    (re.compile(r"\b(nuts|seeds|flaxseed|kernels)\b"), ["bag", "oz", "lb"]),
    (re.compile(r"\b(cheese)\b"), ["oz", "lb", "package"]),
    (re.compile(r"\b(bread)\b"), ["loaf", "slice", "item"]),
    (re.compile(r"\b(mushrooms?)\b"), ["oz", "lb", "package"]),
    (re.compile(r"\b(lettuce)\b"), ["head", "bag", "item"]),
    (re.compile(r"\b(spinach|arugula)\b"), ["bag", "oz", "bunch"]),
    (re.compile(r"\b(cabbage)\b"), ["head", "lb", "item"]),
    (re.compile(r"\b(cauliflower|broccoli)\b"), ["head", "lb", "item"]),
    (re.compile(r"\b(onions|potatoes|sweet potatoes)\b"), ["lb", "bag", "item"]),
    (
        re.compile(r"\b(strawberries|raspberries|blueberries|blackberries|cherries)\b"),
        ["container", "oz", "lb"],
    ),
    (
        re.compile(r"\b(grapes|apples|oranges|pears|peaches|nectarines|plums?)\b"),
        ["lb", "bag", "item"],
    ),
    (
        re.compile(
            r"\b(avocado|mango|pineapple|melons?|watermelon|squash|eggplant|plantains|"
            r"pumpkin|kiwifruit|kiwi|mandarin|figs|cucumber|peppers?|apricot|"
            r"pawpaw|rutabaga|turnips|parsnips|tomatillos|tomatoes|tomato)\b"
        ),
        ["item", "lb"],
    ),
    (
        re.compile(r"\b(beans|lentils|pea|bulgur|rice|oats|millet|farro|sorghum|buckwheat)\b"),
        ["lb", "bag", "kg"],
    ),
]


def _units(canonical: str, category: str) -> list[str]:
    if canonical in CANONICAL_UNITS:
        return CANONICAL_UNITS[canonical]
    for pattern, units in _RULES:
        if pattern.search(canonical):
            return units
    return CATEGORY_UNITS.get(category, CATEGORY_UNITS["other"])


def valid_units_for(entry: Mapping[str, object]) -> list[str]:
    """Return the ordered unit list for a catalog entry; ``[0]`` is the autofill default."""
    return list(_units(str(entry["canonical"]).lower(), str(entry["category"])))
