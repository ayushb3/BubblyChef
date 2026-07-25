"""Food name normalization utilities."""

from __future__ import annotations

import json
import re
from pathlib import Path

from bubbly_chef.domain.catalog import categorize as catalog_categorize
from bubbly_chef.domain.catalog import lookup as catalog_lookup

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

    # Remove quantity words at the start or end
    cleaned = re.sub(
        r"^\d+\s*(?:lb|lbs|oz|g|kg|ml|l|pk|pack|ct|count|gallon|gal|qt|quart|dozen)?\s*(?:of\s+)?",
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

    # Try partial match: only if the input contains a known synonym as its full value
    # (i.e., the synonym equals the cleaned input — already handled above — or
    # the cleaned input is contained within a longer known synonym)
    for synonym, normalized in _REVERSE_SYNONYMS.items():
        if len(synonym) > len(cleaned) and cleaned in synonym:
            return normalized

    # Check catalog for canonical form (data-driven, USDA-backed, high threshold)
    catalog_entry = catalog_lookup(cleaned, threshold=95)
    if catalog_entry:
        return catalog_entry.canonical

    return cleaned


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
        with open(_FOOD_LIBRARY_PATH) as f:
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
}


def normalize_unit(unit: str) -> str:
    """Normalize unit string to canonical form."""
    if not unit:
        return "item"
    return _UNIT_ALIASES.get(unit.lower().strip(), unit.lower().strip())


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
}

# ── Unit → grams conversions ───────────────────────────────────────────────
# NOTE: "cup" is intentionally absent — cup→g is ingredient-specific
# (1 cup flour ≈ 125g, 1 cup butter = 227g). Requires density data out of scope here.
# Cup→ml is available via _TO_ML for volume-target ingredients.
_TO_G: dict[str, float] = {
    "g": 1.0,
    "kg": 1000.0,
    "lb": 453.59,
    "oz": 28.35,
    "stick": 113.0,   # 1 stick butter = 113g = 8 tbsp
}

# ── Unit → count conversions ───────────────────────────────────────────────
_TO_COUNT: dict[str, float] = {
    "count": 1.0,
    "item": 1.0,
    "dozen": 12.0,
}


def normalize_to_base_unit(
    name: str,
    quantity: float,
    unit: str,
    category: str = "other",
) -> tuple[float, str] | tuple[None, None]:
    """Convert (quantity, unit) to (quantity_base, unit_base) for a named ingredient.

    Returns (None, None) if conversion is not possible (unknown unit or cross-dimension).

    Examples:
        normalize_to_base_unit("eggs", 1.0, "dozen")   -> (12.0, "count")
        normalize_to_base_unit("butter", 1.0, "stick") -> (113.0, "g")
        normalize_to_base_unit("milk", 2.0, "cup")     -> (480.0, "ml")
        normalize_to_base_unit("matcha", 30.0, "g")    -> (30.0, "g")
        normalize_to_base_unit("sugar", 3.0, "tbsp")   -> (None, None)  # cross-dimension
    """
    from bubbly_chef.domain.defaults import (
        CATEGORY_CANONICAL_UNIT,
        INGREDIENT_CANONICAL_UNIT,
    )

    canonical_unit = normalize_unit(unit)
    name_lower = name.lower().strip()

    # Determine target base unit from ingredient registry, fall back to category
    target_unit = INGREDIENT_CANONICAL_UNIT.get(
        name_lower, CATEGORY_CANONICAL_UNIT.get(category, "count")
    )

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

    # Cross-dimension (e.g. tbsp→g) requires density data — out of scope
    return None, None
