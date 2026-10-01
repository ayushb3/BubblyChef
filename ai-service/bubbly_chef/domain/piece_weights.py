"""Typical weights and sizes, for converting between pieces, packages and mass.

A recipe says "1 onion" and the pantry holds "1 lb onions"; a recipe says "1 can
tomatoes" and the pantry holds a "28 oz can". Neither side states how the two
relate, so this module supplies the everyday figure a cook would reach for:

- ``EACH_WEIGHTS_G``: one whole piece of a food ("an egg", "a medium onion");
- ``CONTAINER_SIZES``: one can/jar/bag/... of a food, at its most common retail size;
- ``JUICE_YIELD_ML``: how much juice one citrus fruit gives.

Every figure here is an **estimate**, and every conversion that uses one is flagged
``approximate`` all the way to the review sheet (the matcher's
``IngredientMatch.approximate``): the deduction is made, but shown as "about".
Anything without a figure here stays absent, the lookup returns None, and the cook
flow keeps asking the user (``imprecise`` / ``unit_conflict``) rather than inventing
a number. That is the same "correctness over coverage" rule as ``density.py``;
the difference is only that these figures are typical rather than physical, which
is why they are flagged.

Sizes are ``(amount, unit)`` pairs with a unit spelled the way
``normalizer.normalize_unit`` spells it (``g``, ``oz``, ``lb``, ``ml``, ``fl oz``,
``count``), so no unit constant is repeated here. Keys are normalized food names
(``normalize_food_name`` output); lookups also try the singular, so
"chicken thighs" finds "chicken thigh".
"""

from __future__ import annotations

Size = tuple[float, str]

# ── One whole piece, in grams ──────────────────────────────────────────────
#
# Mostly USDA FoodData Central household weights for a "medium" item. Where the
# settled product figure differs from USDA the comment says why. Purchased weight
# and edible weight differ for peeled fruit; this table does not try to track
# that, which is part of why the result is flagged approximate.
EACH_WEIGHTS_G: dict[str, float] = {
    "eggs": 50.0,            # USDA: 1 large egg, shell removed = 50 g
    "onion": 150.0,          # a supermarket "medium" onion; USDA's 110 g is a smaller one
    "lemon": 100.0,          # whole fruit with peel; USDA's 58 g is the peeled flesh
    "lime": 67.0,            # USDA: 1 fruit, 2" diameter
    "orange": 130.0,         # USDA: 1 fruit, 2-5/8" diameter = 131 g
    "apple": 180.0,          # USDA: 1 medium, 3" diameter = 182 g
    "banana": 118.0,         # USDA: 1 medium (7"-7-7/8") = 118 g, peeled
    "potato": 170.0,         # USDA: 1 medium = 173 g
    "sweet potato": 130.0,   # USDA: 1 medium, 5" long = 130 g
    "tomato": 120.0,         # USDA: 1 medium = 123 g
    "carrot": 60.0,          # USDA: 1 medium = 61 g
    "bell pepper": 120.0,    # USDA: 1 medium = 119 g
    "cucumber": 300.0,       # USDA: 1 cucumber, 8-1/4" = 301 g
    "zucchini": 196.0,       # USDA: 1 medium = 196 g
    "avocado": 136.0,        # USDA: 1 fruit without skin and seed = 136 g
    "chicken breast": 200.0,  # one boneless skinless breast, 6-8 oz raw
    "chicken thigh": 115.0,  # one boneless skinless thigh, ~4 oz raw
}

# A bare count of these foods in a recipe means a smaller piece than the pantry's
# whole item: "3 garlic" in a recipe is three cloves, not three heads. Used only
# for the recipe's bare count ("3 garlic"), never for a pantry row's own unit.
BARE_COUNT_MEANS_UNIT: dict[str, str] = {"garlic": "clove"}

# ── One container, at its most common retail size ──────────────────────────
#
# Keyed (container unit, food). The rationale for each is the size a US grocery
# shelf stocks most; a stated size ("28 oz can") always wins over these.
CONTAINER_SIZES: dict[tuple[str, str], Size] = {
    # Cans
    ("can", "tomato"): (14.5, "oz"),          # standard diced/whole can; 28 oz is the large one
    ("can", "diced tomatoes"): (14.5, "oz"),
    ("can", "crushed tomatoes"): (28.0, "oz"),  # crushed ships mostly as the large can
    ("can", "tomato sauce"): (15.0, "oz"),
    ("can", "tomato paste"): (6.0, "oz"),
    ("can", "chickpeas"): (15.0, "oz"),       # 15 oz is the standard bean can
    ("can", "black beans"): (15.0, "oz"),
    ("can", "kidney beans"): (15.0, "oz"),
    ("can", "pinto beans"): (15.0, "oz"),
    ("can", "white beans"): (15.0, "oz"),
    ("can", "cannellini beans"): (15.0, "oz"),
    ("can", "tuna"): (5.0, "oz"),             # the standard tuna can
    ("can", "coconut milk"): (13.5, "fl oz"),  # the standard coconut milk can
    ("can", "broth"): (14.5, "fl oz"),
    ("can", "chicken broth"): (14.5, "fl oz"),
    # Cartons
    ("container", "broth"): (32.0, "fl oz"),  # the quart carton
    ("container", "chicken broth"): (32.0, "fl oz"),
    ("container", "stock"): (32.0, "fl oz"),
    ("container", "eggs"): (12.0, "count"),   # an egg carton is a dozen
    ("container", "yogurt"): (32.0, "oz"),
    ("container", "sour cream"): (16.0, "oz"),
    ("container", "cottage cheese"): (16.0, "oz"),
    ("container", "salt"): (26.0, "oz"),      # the round table-salt canister
    ("container", "oats"): (18.0, "oz"),      # canister of rolled oats
    # Jars
    ("jar", "pasta sauce"): (24.0, "oz"),
    ("jar", "peanut butter"): (16.0, "oz"),
    ("jar", "salsa"): (16.0, "oz"),
    ("jar", "honey"): (12.0, "oz"),
    # Ground spices: the usual supermarket spice jar is 1.5-3 oz, call it 2 oz.
    ("jar", "cumin"): (2.0, "oz"),
    ("jar", "paprika"): (2.0, "oz"),
    ("jar", "chili powder"): (2.0, "oz"),
    ("jar", "cinnamon"): (2.0, "oz"),
    ("jar", "black pepper"): (2.0, "oz"),
    ("jar", "garlic powder"): (2.0, "oz"),
    ("jar", "turmeric"): (2.0, "oz"),
    ("jar", "cayenne"): (2.0, "oz"),
    # Bottles
    ("bottle", "olive oil"): (500.0, "ml"),   # 16.9 fl oz, the common bottle
    ("bottle", "vegetable oil"): (48.0, "fl oz"),
    ("bottle", "honey"): (12.0, "oz"),        # the squeeze bear
    ("bottle", "soy sauce"): (10.0, "fl oz"),
    ("bottle", "vinegar"): (16.0, "fl oz"),
    ("bottle", "hot sauce"): (5.0, "fl oz"),
    ("bottle", "wine"): (750.0, "ml"),
    # Bags and boxes
    ("bag", "flour"): (5.0, "lb"),            # the standard supermarket bag
    ("bag", "sugar"): (4.0, "lb"),
    ("bag", "brown sugar"): (2.0, "lb"),
    ("bag", "rice"): (2.0, "lb"),
    ("bag", "spinach"): (5.0, "oz"),          # the standard clamshell/bag
    ("bag", "cheese"): (8.0, "oz"),           # shredded cheese bag
    ("bag", "carrot"): (1.0, "lb"),
    ("bag", "potato"): (5.0, "lb"),
    ("bag", "onion"): (3.0, "lb"),
    ("box", "pasta"): (16.0, "oz"),
    ("bag", "pasta"): (16.0, "oz"),
    ("package", "pasta"): (16.0, "oz"),
    # Packages
    ("package", "butter"): (1.0, "lb"),       # four sticks
    ("package", "bacon"): (12.0, "oz"),
    ("package", "ground beef"): (1.0, "lb"),
    ("package", "cream cheese"): (8.0, "oz"),
}

# ── Citrus juice, ml per fruit ─────────────────────────────────────────────
#
# One lemon gives about 3 tbsp (45 ml), a lime about 2 tbsp (30 ml), an orange
# about 1/4 cup (60 ml): the usual kitchen yields (USDA lists the same order of
# magnitude). Lets "2 tbsp lemon juice" come out of a pantry row of lemons.
JUICE_YIELD_ML: dict[str, float] = {
    "lemon": 45.0,
    "lime": 30.0,
    "orange": 60.0,
}


def name_variants(name: str) -> list[str]:
    """`name` lowercased, then its singular spellings, most specific first."""
    key = name.lower().strip()
    if not key:
        return []
    variants = [key]
    if key.endswith("ies") and len(key) > 4:
        variants.append(key[:-3] + "y")
    if key.endswith("es") and len(key) > 3:
        variants.append(key[:-2])
    if key.endswith("s") and len(key) > 2:
        variants.append(key[:-1])
    return variants


def each_weight_g(name: str) -> float | None:
    """Grams in one whole piece of `name`, or None when there is no typical figure."""
    for variant in name_variants(name):
        weight = EACH_WEIGHTS_G.get(variant)
        if weight is not None:
            return weight
    return None


def bare_count_unit(name: str) -> str | None:
    """The piece a bare count of `name` means in a recipe ("3 garlic" -> clove), if any."""
    for variant in name_variants(name):
        unit = BARE_COUNT_MEANS_UNIT.get(variant)
        if unit is not None:
            return unit
    return None


def container_size(unit: str, name: str) -> Size | None:
    """The typical size of one `unit` (can, jar, bag, ...) of `name`, or None."""
    unit_key = unit.lower().strip()
    for variant in name_variants(name):
        size = CONTAINER_SIZES.get((unit_key, variant))
        if size is not None:
            return size
    return None


def juice_yield_ml(name: str) -> float | None:
    """Millilitres of juice one `name` fruit gives, or None."""
    for variant in name_variants(name):
        yield_ml = JUICE_YIELD_ML.get(variant)
        if yield_ml is not None:
            return yield_ml
    return None
