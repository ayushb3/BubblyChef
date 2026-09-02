"""Food name normalization utilities."""

from __future__ import annotations

import json
import re
from pathlib import Path

from bubbly_chef.domain.catalog import categorize as catalog_categorize
from bubbly_chef.domain.catalog import lookup as catalog_lookup
from bubbly_chef.domain.density import density_g_per_ml, piece_weight_g

# Synonym mappings: normalized_name -> [synonyms]
SYNONYMS: dict[str, list[str]] = {
    # Dairy
    "milk": ["whole milk", "2% milk", "skim milk", "fat free milk", "1% milk"],
    "eggs": ["egg", "dozen eggs", "large eggs", "organic eggs"],
    "butter": ["unsalted butter", "salted butter"],
    "cheese": ["cheddar", "mozzarella", "parmesan", "swiss cheese"],
    "yogurt": ["greek yogurt", "plain yogurt", "vanilla yogurt"],
    "cream": ["heavy cream", "whipping cream", "half and half"],
    # Produce
    "apple": ["apples", "red apple", "green apple", "gala apple", "fuji apple"],
    "banana": ["bananas", "ripe banana"],
    "orange": ["oranges", "navel orange"],
    "lemon": ["lemons", "fresh lemon"],
    "lime": ["limes", "fresh lime"],
    "tomato": ["tomatoes", "roma tomato", "cherry tomatoes", "grape tomatoes"],
    "onion": ["onions", "yellow onion", "red onion", "white onion"],
    "garlic": ["garlic cloves", "fresh garlic", "garlic bulb"],
    "potato": ["potatoes", "russet potato", "yukon gold", "red potato"],
    "carrot": ["carrots", "baby carrots"],
    "lettuce": ["romaine", "iceberg lettuce", "mixed greens", "salad greens"],
    "spinach": ["baby spinach", "fresh spinach"],
    "broccoli": ["broccoli florets", "fresh broccoli"],
    "bell pepper": ["bell peppers", "red pepper", "green pepper"],
    "cucumber": ["cucumbers", "english cucumber"],
    "avocado": ["avocados", "ripe avocado"],
    # Meat
    "chicken breast": ["chicken breasts", "boneless chicken"],
    "ground beef": ["beef mince", "minced beef", "hamburger meat"],
    "bacon": ["bacon strips", "turkey bacon"],
    "steak": ["beef steak", "ribeye", "sirloin"],
    # Pantry staples
    "flour": ["all purpose flour", "ap flour", "white flour"],
    "sugar": ["white sugar", "granulated sugar"],
    "salt": ["table salt", "kosher salt", "sea salt"],
    "olive oil": ["extra virgin olive oil", "evoo"],
    "rice": ["white rice", "jasmine rice", "basmati rice", "brown rice"],
    "pasta": ["spaghetti", "penne", "linguine", "fettuccine", "macaroni"],
    "bread": ["loaf of bread", "white bread", "wheat bread"],
    # Condiments
    "ketchup": ["catsup", "tomato ketchup"],
    "mustard": ["yellow mustard", "dijon mustard"],
    "mayonnaise": ["mayo"],
    "soy sauce": ["shoyu", "tamari"],
}

# Category keyword mappings
CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "produce": [
        "apple",
        "banana",
        "orange",
        "lemon",
        "lime",
        "tomato",
        "onion",
        "garlic",
        "potato",
        "carrot",
        "celery",
        "lettuce",
        "spinach",
        "broccoli",
        "pepper",
        "cucumber",
        "avocado",
        "fruit",
        "vegetable",
        "berry",
        "grape",
        "melon",
        "peach",
        "pear",
        "mango",
    ],
    "dairy": [
        "milk",
        "cheese",
        "yogurt",
        "butter",
        "cream",
        "cottage",
        "sour cream",
        "cream cheese",
        "mozzarella",
        "cheddar",
        "parmesan",
    ],
    "meat": [
        "chicken",
        "beef",
        "pork",
        "lamb",
        "turkey",
        "steak",
        "bacon",
        "sausage",
        "ham",
        "ground",
        "chop",
        "rib",
        "wing",
    ],
    "seafood": [
        "fish",
        "salmon",
        "tuna",
        "shrimp",
        "crab",
        "lobster",
        "cod",
        "tilapia",
        "halibut",
    ],
    "frozen": ["frozen", "ice cream"],
    "dry_goods": [
        "flour",
        "sugar",
        "rice",
        "pasta",
        "cereal",
        "oat",
        "bean",
        "lentil",
    ],
    "canned": [
        "canned",
        "can of",
    ],
    "beverages": [
        "water",
        "juice",
        "soda",
        "coffee",
        "tea",
        "drink",
    ],
    "condiments": [
        "sauce",
        "ketchup",
        "mustard",
        "mayo",
        "dressing",
        "vinegar",
        "oil",
        "soy sauce",
        "hot sauce",
    ],
    "bakery": [
        "bread",
        "bagel",
        "muffin",
        "croissant",
        "donut",
        "cake",
        "pastry",
    ],
    "snacks": [
        "chip",
        "cracker",
        "cookie",
        "candy",
        "chocolate",
        "popcorn",
        "nuts",
    ],
}

# Build reverse lookup
_REVERSE_SYNONYMS: dict[str, str] = {}
for normalized, synonyms in SYNONYMS.items():
    _REVERSE_SYNONYMS[normalized.lower()] = normalized
    for syn in synonyms:
        _REVERSE_SYNONYMS[syn.lower()] = normalized


def _word_set(text: str) -> set[str]:
    """Lowercase word set for *text*, stripping a trailing plural "s"."""
    words = re.split(r"[\s,]+", text.lower().strip())
    return {w[:-1] if w.endswith("s") and len(w) > 1 else w for w in words if w}


def _same_head_words(cleaned: str, canonical: str) -> bool:
    """True when *canonical* is the same words as *cleaned* (order/plural aside).

    Guards the catalog exact-match fallback in `normalize_food_name` against
    accepting a hit that merely shares a synonym with a more specific product
    row — see the comment at that call site.
    """
    return _word_set(cleaned) == _word_set(canonical)


def normalize_food_name(name: str) -> str:
    """
    Normalize a food name to canonical form.

    - Lowercases and strips whitespace
    - Removes common prefixes (organic, fresh, etc.)
    - Maps synonyms to canonical names
    """
    if not name:
        return name

    # Clean up
    cleaned = name.lower().strip()

    # Remove common non-essential prefixes
    prefixes = ["organic ", "fresh ", "raw ", "natural ", "premium ", "local "]
    for prefix in prefixes:
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix) :]

    # Remove quantity words at the start or end. The negative lookahead keeps a
    # leading number that is immediately followed by "%" (e.g. "2% milk") intact
    # — that digit is part of the product name, not a quantity to strip, and
    # without it "2% milk" degrades to "% milk".
    cleaned = re.sub(
        r"^\d+(?!%)\s*(?:lb|lbs|oz|g|kg|ml|l|pk|pack|ct|count|gallon|gal|qt|quart|dozen)?\s*(?:of\s+)?",
        "",
        cleaned,
    )
    cleaned = re.sub(
        r"\s+\d+\s*(?:lb|lbs|oz|g|kg|ml|l|pk|pack|ct|count|gallon|gal|qt|quart|dozen)$",
        "",
        cleaned,
    ).strip()

    # Check synonym lookup (takes priority for known items)
    if cleaned in _REVERSE_SYNONYMS:
        return _REVERSE_SYNONYMS[cleaned]

    # Check catalog for an *exact* canonical/synonym hit only (data-driven,
    # USDA-backed). Fuzzy matching is deliberately not used here: rapidfuzz's
    # WRatio scores a short string contained in a longer one very highly, which
    # is substring matching under another name (e.g. "chicken" -> "broilers or
    # fryers chicken", "ham" -> "ground beef"). A name this exact lookup misses
    # falls through to resolve_aliases_with_llm in services/cook_matcher.py,
    # which resolves it far better than a fuzzy string score can — refuse
    # rather than guess, the same rule domain/density.py already states for
    # itself.
    #
    # An exact index hit alone is not enough of a guard: the catalog's raw USDA
    # synonym lists attach bare generic words ("ham", "oil", "corn", "chicken")
    # to one specific product row each (a sliced deli ham, a coconut oil, a
    # corn oil, a braised chicken drumstick), so an exact hit can still silently
    # inject descriptive words the input never had. Only trust the catalog when
    # the canonical is the same set of words as the input (plurals aside) — a
    # spelling/ordering normalization, not a guess at which specific product
    # variant was meant.
    catalog_entry = catalog_lookup(cleaned, fuzzy=False)
    if catalog_entry and _same_head_words(cleaned, catalog_entry.canonical):
        return catalog_entry.canonical

    return cleaned


def resolve_category(name: str) -> str | None:
    """Return the best deterministic category for *name*, or None.

    Tries keyword matching first (``detect_category``), then the food
    catalog (``catalog_categorize``).  This is the single shared helper
    used by both the manual-add path and the receipt ingest path so the
    two paths can never drift.
    """
    return detect_category(name) or catalog_categorize(name) or None


def detect_category(name: str) -> str | None:
    """
    Detect food category from name using keyword matching.

    Returns category string or None if no match.
    """
    if not name:
        return None

    name_lower = name.lower()

    # Try keyword matching first (domain-specific, highest priority)
    scores: dict[str, int] = {}
    for category, keywords in CATEGORY_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in name_lower)
        if score > 0:
            scores[category] = score

    if scores:
        return max(scores, key=lambda k: scores[k])

    # Fall back to catalog lookup for items not covered by keywords
    return catalog_categorize(name)


# ---------------------------------------------------------------------------
# Food-library normalization (fuzzy match against food_library.json canonicals)
# ---------------------------------------------------------------------------

_FOOD_LIBRARY_PATH = Path(__file__).resolve().parent.parent / "data" / "food_library.json"

_food_library_canonicals: list[str] | None = None


def _load_food_library_canonicals() -> list[str]:
    """Load canonical names from food_library.json, caching at module level."""
    global _food_library_canonicals
    if _food_library_canonicals is not None:
        return _food_library_canonicals

    if not _FOOD_LIBRARY_PATH.is_file():
        _food_library_canonicals = []
        return _food_library_canonicals

    try:
        with open(_FOOD_LIBRARY_PATH, encoding="utf-8") as f:
            entries: list[dict[str, object]] = json.load(f)
        _food_library_canonicals = [
            str(e["canonical"]) for e in entries if "canonical" in e
        ]
    except (json.JSONDecodeError, OSError):
        _food_library_canonicals = []

    return _food_library_canonicals


def normalize_to_library(name: str) -> str:
    """
    Normalize a food name against the food library's canonical entries.

    Uses rapidfuzz WRatio with a score cutoff of 75 to find the best
    canonical match.  Returns the canonical name if a match is found,
    otherwise returns the original name unchanged.

    For multi-word queries, extracts the top candidates and prefers ones
    that appear as whole words in the query (avoiding "applewood" → "apple").
    """
    if not name or not name.strip():
        return name

    canonicals = _load_food_library_canonicals()
    if not canonicals:
        return name

    query = name.strip().lower()
    query_words = set(query.split())

    try:
        from rapidfuzz import process
        from rapidfuzz.fuzz import WRatio

        results = process.extract(
            query,
            canonicals,
            scorer=WRatio,
            score_cutoff=75,
            limit=5,
        )
        if not results:
            return name

        # Prefer candidates that appear as whole words in the query
        # e.g. for "bacon applewood uncured", prefer "bacon" over "apple"
        for matched_name, score, _idx in results:
            match_words = set(matched_name.split())
            if match_words & query_words:  # at least one word overlaps exactly
                return str(matched_name)

        # Fallback: use top match but guard against short false positives
        top_name, top_score, _ = results[0]
        if len(query_words) >= 3 and len(top_name.split()) == 1 and top_score < 90:
            return name  # reject weak short match
        return str(top_name)
    except ImportError:
        pass

    return name


# ---------------------------------------------------------------------------
# Size adjectives that models write into the unit field of recipe ingredients.
# "2 medium avocados" → unit="medium" (should normalise to count, not conflict).
# Defined here so normalizer.py (the single source of truth for unit handling)
# can strip them, and cook_matcher.py re-exports the constant so nothing else
# needs to duplicate the list.
# ---------------------------------------------------------------------------
SIZE_ADJECTIVE_UNITS: frozenset[str] = frozenset({
    "small",
    "medium",
    "large",
    "extra-large",
    "extra large",
    "xl",
    "x-large",
})

_UNIT_ALIASES: dict[str, str] = {
    "pound": "lb", "pounds": "lb",
    "ounce": "oz", "ounces": "oz",
    "kilogram": "kg", "kilograms": "kg",
    "gram": "g", "grams": "g",
    "liter": "l", "liters": "l", "litre": "l", "litres": "l",  # lowercase l — matches _TO_ML
    "milliliter": "ml", "milliliters": "ml", "millilitre": "ml", "millilitres": "ml",
    "piece": "item", "pieces": "item",
    "each": "item",
    # Culinary units
    "dozen": "dozen",
    "stick": "stick",
    "cup": "cup", "cups": "cup",
    "tbsp": "tbsp", "tablespoon": "tbsp", "tablespoons": "tbsp",
    "tsp": "tsp", "teaspoon": "tsp", "teaspoons": "tsp",
    "fl oz": "fl oz", "fluid ounce": "fl oz", "fluid ounces": "fl oz",
    "gallon": "gallon", "gallons": "gallon", "gal": "gallon",
    "quart": "quart", "quarts": "quart", "qt": "quart",
    "pint": "pint", "pints": "pint", "pt": "pint",
    "count": "count", "ct": "count",
    "item": "count", "items": "count",
    "sticks": "stick",
    # Piece units — a discrete piece of an ingredient
    "slice": "slice", "slices": "slice",
    "leaf": "leaf", "leaves": "leaf",
    "clove": "clove", "cloves": "clove",
    "sprig": "sprig", "sprigs": "sprig",
    "head": "head", "heads": "head",
    "bunch": "bunch", "bunches": "bunch",
    "handful": "handful", "handfuls": "handful",
    # Small culinary volumes
    "pinch": "pinch", "pinches": "pinch",
    "dash": "dash", "dashes": "dash",
    # Package units — one purchased container of a thing
    "can": "can", "cans": "can",
    "package": "package", "packages": "package", "pkg": "package", "pkgs": "package",
    "bag": "bag", "bags": "bag",
    "bottle": "bottle", "bottles": "bottle",
    "jar": "jar", "jars": "jar",
    "box": "box", "boxes": "box",
    "container": "container", "containers": "container",
    "loaf": "loaf", "loaves": "loaf",
}


def normalize_unit(unit: str) -> str:
    """Normalize unit string to canonical form.

    Size adjectives ("medium", "large", "small", etc.) that a model may write
    into the unit field are treated as absent — they carry no measurement
    information and should not trigger a unit_conflict in the cook matcher.
    """
    if not unit:
        return "item"
    normalized = unit.lower().strip()
    # Size adjectives are not units. Treat them as "no unit given" so the
    # normalizer falls through to the ingredient's canonical count-based unit
    # rather than returning (None, None) and producing a spurious unit_conflict.
    if normalized in SIZE_ADJECTIVE_UNITS:
        return "item"
    return _UNIT_ALIASES.get(normalized, normalized)


# ── Unit → ml conversions ──────────────────────────────────────────────────
_TO_ML: dict[str, float] = {
    "ml": 1.0,
    "l": 1000.0,
    "cup": 240.0,
    "tbsp": 15.0,
    "tsp": 5.0,
    "fl oz": 29.57,
    "pint": 473.0,
    "quart": 946.0,
    "gallon": 3785.0,
    # Conventional fractions of a teaspoon, not guesses: a pinch is 1/16 tsp
    # and a dash is 1/8 tsp. With a density they become real weights — a pinch
    # of salt works out at 0.375 g, matching the ~0.36 g usually quoted.
    "pinch": 5.0 / 16.0,
    "dash": 5.0 / 8.0,
}

# ── Unit → grams conversions ───────────────────────────────────────────────
# Only units that mean a fixed mass on their own. Volume units (cup, tbsp) reach
# grams through ingredient density instead — see density.py — because a cup of
# flour (125 g) and a cup of butter (227 g) are not the same weight.
#
# "stick" is likewise not here: it is 113 g of butter but nothing like that as a
# stick of celery, so it lives in PIECE_WEIGHTS_G keyed by ingredient.
_TO_G: dict[str, float] = {
    "g": 1.0,
    "kg": 1000.0,
    "lb": 453.59,
    "oz": 28.35,
}

# ── Piece vs package units ─────────────────────────────────────────────────
# Both map to "count" below, but they count different things: a piece unit
# counts pieces *of* an ingredient, a package unit counts packages *containing*
# an unknown number of those pieces. Comparing "4 slices" against "1 loaf" is a
# category error, not a shortfall — see
# docs/adr/0003-piece-vs-package-units-are-incommensurable.md.
#
# "count" and "ct" belong to neither set: "6 count garlic" is a genuine tally
# and must keep deducting normally.
PIECE_UNITS: frozenset[str] = frozenset(
    {"slice", "leaf", "clove", "sprig", "stick"}
)
PACKAGE_UNITS: frozenset[str] = frozenset(
    {
        "item",
        "loaf",
        "bunch",
        "head",
        "bag",
        "can",
        "package",
        "bottle",
        "jar",
        "box",
        "container",
    }
)

# normalize_unit() maps "item" → "count", which erases exactly the distinction
# these predicates exist to make. They therefore run their own minimal alias
# pass over the *raw* display unit: case, whitespace and plurals only, never
# collapsing a package unit into "count".
_RAW_UNIT_SINGULARS: dict[str, str] = {
    "leaves": "leaf",
    "loaves": "loaf",
    "bunches": "bunch",
    "boxes": "box",
    "pkg": "package",
    "pkgs": "package",
}


def _canonical_raw_unit(unit: str | None) -> str:
    """Lowercase, strip and de-pluralize *unit* without collapsing synonyms."""
    if not unit:
        return ""
    raw = unit.lower().strip()
    if raw in _RAW_UNIT_SINGULARS:
        return _RAW_UNIT_SINGULARS[raw]
    if raw.endswith("s") and raw[:-1] in (PIECE_UNITS | PACKAGE_UNITS):
        return raw[:-1]
    return raw


def is_piece_unit(unit: str | None) -> bool:
    """True when *unit* counts pieces of an ingredient (slice, clove, leaf)."""
    return _canonical_raw_unit(unit) in PIECE_UNITS


def is_package_unit(unit: str | None) -> bool:
    """True when *unit* counts purchased packages (loaf, bunch, can, item)."""
    return _canonical_raw_unit(unit) in PACKAGE_UNITS


# ── Unit → count conversions ───────────────────────────────────────────────
# Piece and package units count as one discrete thing each. A pantry row
# measured in counts is counting exactly these — slices, cloves, cans, bags —
# so 1:1 is the only mapping that keeps both sides in the same dimension.
#
# Where the two sides count different things (4 slices vs 1 loaf) the cook
# matcher intercepts the pair before this mapping can turn it into a bogus
# shortfall — see is_piece_unit/is_package_unit above.
#
# "handful" is deliberately absent: it is neither a discrete thing nor a fixed
# amount (see UNCONVERTIBLE_TO_MASS_UNITS in density.py).
_TO_COUNT: dict[str, float] = {
    "count": 1.0,
    "item": 1.0,
    "dozen": 12.0,
    # Pieces of an ingredient
    "slice": 1.0,
    "leaf": 1.0,
    "clove": 1.0,
    "sprig": 1.0,
    "head": 1.0,
    "bunch": 1.0,
    # One purchased package of a thing
    "can": 1.0,
    "package": 1.0,
    "bag": 1.0,
    "bottle": 1.0,
    "jar": 1.0,
    "box": 1.0,
    "container": 1.0,
    "loaf": 1.0,
}


# ── Unit → dimension ───────────────────────────────────────────────────────
# The dimension a unit is measured in, used as a last-resort base unit for
# ingredients no registry covers. "kg" is mass whatever it holds, so a pantry
# row reading "2 kg basmati rice" has a base unit of grams even though nothing
# in the codebase has ever heard of basmati rice.
#
# "stick" is absent on purpose: it is a piece unit whose dimension depends on
# the ingredient (butter is 113 g, celery is not), so it resolves through
# PIECE_WEIGHTS_G or not at all.
_UNIT_DIMENSION: dict[str, str] = {
    **{unit: "count" for unit in _TO_COUNT},
    **{unit: "ml" for unit in _TO_ML},
    **{unit: "g" for unit in _TO_G},
}


def _resolve_density(name: str, category: str) -> float | None:
    """Density in g/ml for *name*, retrying under its canonical name.

    The caller may hand us a raw label ("unsalted butter", "greek yogurt") that
    the density table does not key on, so a miss is retried against
    normalize_food_name()'s canonical form. Still None when nothing defensible
    exists — that is a refusal, not a gap to paper over with a default.
    """
    density = density_g_per_ml(name, category)
    if density is None:
        density = density_g_per_ml(normalize_food_name(name), category)
    return density


def _resolve_piece_weight(unit: str, name: str) -> float | None:
    """Grams in one *unit* of *name*, retrying under its canonical name."""
    weight = piece_weight_g(unit, name)
    if weight is None:
        weight = piece_weight_g(unit, normalize_food_name(name))
    return weight


def normalize_to_base_unit(
    name: str,
    quantity: float,
    unit: str,
    category: str = "other",
    target_unit: str | None = None,
) -> tuple[float, str] | tuple[None, None]:
    """Convert (quantity, unit) to (quantity_base, unit_base) for a named ingredient.

    Conversion is attempted in four tiers, cheapest and most certain first:
    within a dimension (count/ml/g), then a conventional piece weight for the
    ingredient (1 clove garlic = 3 g), then across dimensions using ingredient
    density (1 tsp butter = 5 ml x 0.911 g/ml = 4.6 g).

    Returns (None, None) when none of those apply — an unknown unit, or a
    cross-dimension pair for an ingredient with no defensible density. That
    refusal is deliberate: the cook flow turns it into a visible "unit conflict"
    the user can resolve, which is safer than deducting a made-up quantity.

    Args:
        target_unit: Convert toward this unit instead of looking one up by name.
            Pass it when the destination is already known — matching a recipe line
            against a pantry row whose unit_base is recorded, say. The name registry
            only covers ingredients it lists, so "sour cream" or "greek yogurt" would
            otherwise fall back to the category default of "count" and make a gram
            quantity look like an impossible cross-dimension conversion.

    Examples:
        normalize_to_base_unit("eggs", 1.0, "dozen")   -> (12.0, "count")
        normalize_to_base_unit("butter", 1.0, "stick") -> (113.0, "g")
        normalize_to_base_unit("milk", 2.0, "cup")     -> (480.0, "ml")
        normalize_to_base_unit("matcha", 30.0, "g")    -> (30.0, "g")
        normalize_to_base_unit("sugar", 3.0, "tbsp")   -> (38.25, "g")  # via density
        normalize_to_base_unit("matcha", 3.0, "tbsp")  -> (None, None)  # no density
        normalize_to_base_unit("sour cream", 100.0, "g", target_unit="g") -> (100.0, "g")
    """
    from bubbly_chef.domain.defaults import (
        CATEGORY_CANONICAL_UNIT,
        INGREDIENT_CANONICAL_UNIT,
    )

    canonical_unit = normalize_unit(unit)
    name_lower = name.lower().strip()

    # Caller-supplied destination wins; otherwise the ingredient registry (under
    # the given name, then its canonical form, so "basmati rice" reaches "rice"),
    # then the category default.
    caller_set_target = target_unit is not None
    registry_unit: str | None = None
    if target_unit is None:
        registry_unit = INGREDIENT_CANONICAL_UNIT.get(name_lower)
        if registry_unit is None:
            registry_unit = INGREDIENT_CANONICAL_UNIT.get(normalize_food_name(name_lower))
        target_unit = registry_unit or CATEGORY_CANONICAL_UNIT.get(category, "count")

    # Same unit — no conversion needed
    if canonical_unit == target_unit:
        return quantity, target_unit

    # count conversions
    if target_unit == "count" and canonical_unit in _TO_COUNT:
        return quantity * _TO_COUNT[canonical_unit], "count"

    # ml conversions
    if target_unit == "ml" and canonical_unit in _TO_ML:
        return quantity * _TO_ML[canonical_unit], "ml"

    # g conversions
    if target_unit == "g" and canonical_unit in _TO_G:
        return quantity * _TO_G[canonical_unit], "g"

    # Piece units with a conventional weight for THIS ingredient
    # (1 stick butter = 113 g, 1 clove garlic = 3 g)
    if target_unit == "g":
        piece_g = _resolve_piece_weight(canonical_unit, name_lower)
        if piece_g is not None:
            return quantity * piece_g, "g"

    # Cross-dimension via ingredient density (volume <-> mass)
    density = None
    if (target_unit == "g" and canonical_unit in _TO_ML) or (
        target_unit == "ml" and canonical_unit in _TO_G
    ):
        density = _resolve_density(name_lower, category)

    if density is not None and density > 0:
        if target_unit == "g":
            return quantity * _TO_ML[canonical_unit] * density, "g"
        return quantity * _TO_G[canonical_unit] / density, "ml"

    # Last resort: base the ingredient in whatever dimension its own unit is in.
    #
    # Without this, any ingredient missing from INGREDIENT_CANONICAL_UNIT and
    # called without a category — which is how the cook matcher resolves the
    # pantry side — targets "count" via the category default, so a perfectly
    # ordinary "500 g greek yogurt" row cannot resolve a base unit at all and
    # every recipe line touching it reports a unit conflict.
    #
    # It applies only when neither the caller nor the registry named a target.
    # A registry entry is a deliberate statement about the ingredient (eggs are
    # counted), so "1 pinch eggs" stays a refusal rather than becoming millilitres.
    if not caller_set_target and registry_unit is None:
        inferred_unit = _UNIT_DIMENSION.get(canonical_unit)
        if inferred_unit is not None and inferred_unit != target_unit:
            return normalize_to_base_unit(
                name, quantity, unit, category, target_unit=inferred_unit
            )

    # No defensible conversion — say so rather than guess at one
    return None, None