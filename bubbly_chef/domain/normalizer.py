"""Food name normalization utilities."""

import re

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
