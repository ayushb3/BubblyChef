#!/usr/bin/env python3
"""Build the curated food library JSON from hardcoded items + existing catalog.

Usage:
    python3 scripts/build_food_library.py

Output:
    bubbly_chef/data/food_library.json
"""

from __future__ import annotations

import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = PROJECT_ROOT / "web" / "public" / "icons" / "food"
CATALOG_PATH = PROJECT_ROOT / "bubbly_chef" / "data" / "pantry_catalog.json"
OUTPUT_PATH = PROJECT_ROOT / "bubbly_chef" / "data" / "food_library.json"

# ---------------------------------------------------------------------------
# Expiry defaults (mirrors bubbly_chef/domain/expiry.py)
# ---------------------------------------------------------------------------
CATEGORY_DEFAULTS: dict[str, int] = {
    "produce": 7,
    "dairy": 14,
    "meat": 3,
    "seafood": 2,
    "frozen": 90,
    "dry_goods": 365,
    "canned": 730,
    "beverages": 30,
    "condiments": 180,
    "bakery": 5,
    "snacks": 60,
    "other": 14,
}

ITEM_OVERRIDES: dict[str, int] = {
    "milk": 10,
    "eggs": 21,
    "butter": 30,
    "yogurt": 14,
    "cheese": 21,
    "cream": 14,
    "banana": 5,
    "avocado": 4,
    "berries": 3,
    "lettuce": 5,
    "spinach": 5,
    "mushroom": 5,
    "apple": 21,
    "orange": 14,
    "lemon": 21,
    "potato": 21,
    "onion": 30,
    "garlic": 30,
    "carrot": 21,
    "chicken": 2,
    "ground beef": 2,
    "steak": 3,
    "bacon": 7,
    "bread": 7,
}

CATEGORY_LOCATIONS: dict[str, str] = {
    "produce": "fridge",
    "dairy": "fridge",
    "meat": "fridge",
    "seafood": "fridge",
    "frozen": "freezer",
    "dry_goods": "pantry",
    "canned": "pantry",
    "beverages": "fridge",
    "condiments": "fridge",
    "bakery": "counter",
    "snacks": "pantry",
    "other": "pantry",
}

# ---------------------------------------------------------------------------
# Valid units by category
# ---------------------------------------------------------------------------
CATEGORY_UNITS: dict[str, list[str]] = {
    "produce": ["count", "lb", "oz", "bunch", "bag", "container"],
    "dairy": ["count", "oz", "lb", "container", "gallon", "quart", "pint", "cup"],
    "meat": ["lb", "oz", "count", "package"],
    "seafood": ["lb", "oz", "count", "can", "package"],
    "dry_goods": ["count", "oz", "lb", "bag", "box", "can", "jar", "package"],
    "canned": ["count", "oz", "can", "jar"],
    "beverages": ["count", "gallon", "quart", "pint", "fl oz", "liter", "ml", "bottle", "can"],
    "condiments": ["count", "oz", "bottle", "jar", "tbsp", "tsp"],
    "snacks": ["count", "oz", "bag", "box", "package"],
    "bakery": ["count", "loaf", "slice", "package", "bag"],
    "frozen": ["count", "oz", "lb", "bag", "box", "package"],
    "other": ["count", "item", "oz", "lb", "package"],
}

# ---------------------------------------------------------------------------
# Icon slug lookup
# ---------------------------------------------------------------------------
_icon_cache: set[str] | None = None


def _load_icons() -> set[str]:
    global _icon_cache
    if _icon_cache is None:
        if ICON_DIR.is_dir():
            _icon_cache = {f.stem for f in ICON_DIR.glob("*.png")}
        else:
            _icon_cache = set()
    return _icon_cache


def get_icon_slug(canonical: str) -> str | None:
    """Return icon filename stem if a matching PNG exists, else None."""
    icons = _load_icons()
    # Try several slug patterns
    slug = "icon-" + canonical.replace(" ", "-").replace("_", "-")
    if slug in icons:
        return slug
    # Try singular/plural variants
    if slug.endswith("s") and slug[:-1] in icons:
        return slug[:-1]
    if slug + "s" in icons:
        return slug + "s"
    # Try without trailing 's' for items like 'eggs' -> 'icon-egg'
    if canonical.endswith("s"):
        singular_slug = "icon-" + canonical[:-1].replace(" ", "-")
        if singular_slug in icons:
            return singular_slug
    return None


def get_expiry_days(canonical: str, category: str) -> int:
    """Get expiry days for an item, checking overrides first."""
    name_lower = canonical.lower()
    for item_name, days in ITEM_OVERRIDES.items():
        if item_name in name_lower:
            return days
    return CATEGORY_DEFAULTS.get(category, CATEGORY_DEFAULTS["other"])


# ---------------------------------------------------------------------------
# Hardcoded grocery items (~300+)
# ---------------------------------------------------------------------------
# fmt: off
ITEMS: list[dict] = [
    # ---- Produce ----
    {"canonical": "tomato", "category": "produce", "emoji": "\U0001f345", "synonyms": ["tomatoes", "roma tomato", "cherry tomatoes", "grape tomatoes"]},
    {"canonical": "potato", "category": "produce", "emoji": "\U0001f954", "synonyms": ["potatoes", "russet potato", "yukon gold", "red potato"]},
    {"canonical": "onion", "category": "produce", "emoji": "\U0001f9c5", "synonyms": ["onions", "yellow onion", "red onion", "white onion"]},
    {"canonical": "garlic", "category": "produce", "emoji": "\U0001f9c4", "synonyms": ["garlic cloves", "fresh garlic"]},
    {"canonical": "carrot", "category": "produce", "emoji": "\U0001f955", "synonyms": ["carrots", "baby carrots"]},
    {"canonical": "broccoli", "category": "produce", "emoji": "\U0001f966", "synonyms": ["broccoli florets"]},
    {"canonical": "spinach", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["baby spinach", "fresh spinach"]},
    {"canonical": "lettuce", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["romaine", "iceberg lettuce", "mixed greens"]},
    {"canonical": "cucumber", "category": "produce", "emoji": "\U0001f952", "synonyms": ["cucumbers", "english cucumber"]},
    {"canonical": "bell pepper", "category": "produce", "emoji": "\U0001fad1", "synonyms": ["bell peppers", "red pepper", "green pepper", "yellow pepper"]},
    {"canonical": "zucchini", "category": "produce", "emoji": "\U0001f952", "synonyms": ["zucchinis", "courgette"]},
    {"canonical": "celery", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["celery stalks"]},
    {"canonical": "mushroom", "category": "produce", "emoji": "\U0001f344", "synonyms": ["mushrooms", "button mushroom", "cremini", "portobello"]},
    {"canonical": "avocado", "category": "produce", "emoji": "\U0001f951", "synonyms": ["avocados", "ripe avocado"]},
    {"canonical": "lemon", "category": "produce", "emoji": "\U0001f34b", "synonyms": ["lemons", "fresh lemon"]},
    {"canonical": "lime", "category": "produce", "emoji": "\U0001f34b", "synonyms": ["limes", "fresh lime"]},
    {"canonical": "orange", "category": "produce", "emoji": "\U0001f34a", "synonyms": ["oranges", "navel orange"]},
    {"canonical": "strawberry", "category": "produce", "emoji": "\U0001f353", "synonyms": ["strawberries"]},
    {"canonical": "blueberry", "category": "produce", "emoji": "\U0001fad0", "synonyms": ["blueberries"]},
    {"canonical": "raspberry", "category": "produce", "emoji": "\U0001f347", "synonyms": ["raspberries"]},
    {"canonical": "grape", "category": "produce", "emoji": "\U0001f347", "synonyms": ["grapes", "red grapes", "green grapes"]},
    {"canonical": "watermelon", "category": "produce", "emoji": "\U0001f349", "synonyms": ["watermelons"]},
    {"canonical": "cantaloupe", "category": "produce", "emoji": "\U0001f348", "synonyms": ["cantaloupes", "melon"]},
    {"canonical": "peach", "category": "produce", "emoji": "\U0001f351", "synonyms": ["peaches"]},
    {"canonical": "pear", "category": "produce", "emoji": "\U0001f350", "synonyms": ["pears"]},
    {"canonical": "plum", "category": "produce", "emoji": "\U0001f351", "synonyms": ["plums"]},
    {"canonical": "mango", "category": "produce", "emoji": "\U0001f96d", "synonyms": ["mangoes", "mangos"]},
    {"canonical": "pineapple", "category": "produce", "emoji": "\U0001f34d", "synonyms": ["pineapples"]},
    {"canonical": "kiwi", "category": "produce", "emoji": "\U0001f95d", "synonyms": ["kiwis", "kiwifruit"]},
    {"canonical": "sweet potato", "category": "produce", "emoji": "\U0001f360", "synonyms": ["sweet potatoes", "yam", "yams"]},
    {"canonical": "corn", "category": "produce", "emoji": "\U0001f33d", "synonyms": ["sweet corn", "corn on the cob"]},
    {"canonical": "green beans", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["string beans", "snap beans"]},
    {"canonical": "peas", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["green peas", "snap peas", "snow peas"]},
    {"canonical": "asparagus", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["asparagus spears"]},
    {"canonical": "cabbage", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["green cabbage", "red cabbage", "napa cabbage"]},
    {"canonical": "cauliflower", "category": "produce", "emoji": "\U0001f966", "synonyms": ["cauliflower florets"]},
    {"canonical": "beet", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["beets", "beetroot"]},
    {"canonical": "radish", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["radishes"]},
    {"canonical": "artichoke", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["artichokes"]},
    {"canonical": "brussels sprouts", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["brussel sprouts"]},
    {"canonical": "kale", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["curly kale", "lacinato kale"]},
    {"canonical": "arugula", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["rocket"]},
    {"canonical": "cilantro", "category": "produce", "emoji": "\U0001f33f", "synonyms": ["fresh cilantro", "coriander"]},
    {"canonical": "parsley", "category": "produce", "emoji": "\U0001f33f", "synonyms": ["fresh parsley", "flat leaf parsley"]},
    {"canonical": "basil", "category": "produce", "emoji": "\U0001f33f", "synonyms": ["fresh basil", "sweet basil"]},
    {"canonical": "mint", "category": "produce", "emoji": "\U0001f33f", "synonyms": ["fresh mint", "spearmint", "peppermint"]},
    {"canonical": "rosemary", "category": "produce", "emoji": "\U0001f33f", "synonyms": ["fresh rosemary"]},
    {"canonical": "thyme", "category": "produce", "emoji": "\U0001f33f", "synonyms": ["fresh thyme"]},
    {"canonical": "ginger root", "category": "produce", "emoji": "\U0001f9c1", "synonyms": ["ginger", "fresh ginger"]},
    {"canonical": "apple", "category": "produce", "emoji": "\U0001f34e", "synonyms": ["apples", "red apple", "green apple", "gala apple", "fuji apple", "granny smith"]},
    {"canonical": "banana", "category": "produce", "emoji": "\U0001f34c", "synonyms": ["bananas"]},

    # ---- Dairy ----
    {"canonical": "milk", "category": "dairy", "emoji": "\U0001f95b", "synonyms": ["whole milk", "2% milk", "skim milk", "1% milk"]},
    {"canonical": "eggs", "category": "dairy", "emoji": "\U0001f95a", "synonyms": ["egg", "large eggs", "dozen eggs", "free range eggs"], "valid_units": ["dozen", "count"]},
    {"canonical": "butter", "category": "dairy", "emoji": "\U0001f9c8", "synonyms": ["unsalted butter", "salted butter"]},
    {"canonical": "yogurt", "category": "dairy", "emoji": "\U0001f95b", "synonyms": ["greek yogurt", "plain yogurt", "vanilla yogurt"]},
    {"canonical": "cheese", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["cheddar", "american cheese", "swiss"]},
    {"canonical": "cream cheese", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["philly cream cheese"]},
    {"canonical": "sour cream", "category": "dairy", "emoji": "\U0001f95b", "synonyms": []},
    {"canonical": "heavy cream", "category": "dairy", "emoji": "\U0001f95b", "synonyms": ["whipping cream", "heavy whipping cream"]},
    {"canonical": "half and half", "category": "dairy", "emoji": "\U0001f95b", "synonyms": ["half & half"]},
    {"canonical": "cottage cheese", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": []},
    {"canonical": "mozzarella", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["mozzarella cheese", "fresh mozzarella"]},
    {"canonical": "parmesan", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["parmesan cheese", "parmigiano reggiano"]},
    {"canonical": "cheddar", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["cheddar cheese", "sharp cheddar", "mild cheddar"]},
    {"canonical": "swiss cheese", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["swiss"]},
    {"canonical": "brie", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["brie cheese"]},
    {"canonical": "gouda", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["gouda cheese", "smoked gouda"]},
    {"canonical": "feta", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["feta cheese", "crumbled feta"]},
    {"canonical": "ricotta", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["ricotta cheese"]},
    {"canonical": "whipped cream", "category": "dairy", "emoji": "\U0001f95b", "synonyms": ["cool whip"]},
    {"canonical": "evaporated milk", "category": "dairy", "emoji": "\U0001f95b", "synonyms": []},
    {"canonical": "condensed milk", "category": "dairy", "emoji": "\U0001f95b", "synonyms": ["sweetened condensed milk"]},
    {"canonical": "buttermilk", "category": "dairy", "emoji": "\U0001f95b", "synonyms": []},
    {"canonical": "kefir", "category": "dairy", "emoji": "\U0001f95b", "synonyms": []},
    {"canonical": "ghee", "category": "dairy", "emoji": "\U0001f9c8", "synonyms": ["clarified butter"]},

    # ---- Meat ----
    {"canonical": "chicken breast", "category": "meat", "emoji": "\U0001f357", "synonyms": ["chicken breasts", "boneless chicken"]},
    {"canonical": "chicken thighs", "category": "meat", "emoji": "\U0001f357", "synonyms": ["bone-in thighs"]},
    {"canonical": "ground beef", "category": "meat", "emoji": "\U0001f969", "synonyms": ["beef mince", "hamburger meat"]},
    {"canonical": "pork chops", "category": "meat", "emoji": "\U0001f969", "synonyms": ["pork loin chops"]},
    {"canonical": "bacon", "category": "meat", "emoji": "\U0001f953", "synonyms": ["bacon strips", "turkey bacon"]},
    {"canonical": "ham", "category": "meat", "emoji": "\U0001f969", "synonyms": ["sliced ham", "deli ham", "honey ham"]},
    {"canonical": "sausage", "category": "meat", "emoji": "\U0001f32d", "synonyms": ["sausages", "breakfast sausage", "italian sausage"]},
    {"canonical": "ground turkey", "category": "meat", "emoji": "\U0001f983", "synonyms": ["turkey mince"]},
    {"canonical": "turkey breast", "category": "meat", "emoji": "\U0001f983", "synonyms": ["deli turkey", "sliced turkey"]},
    {"canonical": "lamb chops", "category": "meat", "emoji": "\U0001f969", "synonyms": ["lamb loin chops"]},
    {"canonical": "ground lamb", "category": "meat", "emoji": "\U0001f969", "synonyms": ["lamb mince"]},
    {"canonical": "pork belly", "category": "meat", "emoji": "\U0001f969", "synonyms": []},
    {"canonical": "ribs", "category": "meat", "emoji": "\U0001f356", "synonyms": ["baby back ribs", "spare ribs", "pork ribs"]},
    {"canonical": "brisket", "category": "meat", "emoji": "\U0001f969", "synonyms": ["beef brisket"]},
    {"canonical": "steak", "category": "meat", "emoji": "\U0001f969", "synonyms": ["beef steak"]},
    {"canonical": "sirloin", "category": "meat", "emoji": "\U0001f969", "synonyms": ["sirloin steak", "top sirloin"]},
    {"canonical": "ribeye", "category": "meat", "emoji": "\U0001f969", "synonyms": ["ribeye steak", "rib eye"]},
    {"canonical": "filet mignon", "category": "meat", "emoji": "\U0001f969", "synonyms": ["beef tenderloin"]},
    {"canonical": "hot dogs", "category": "meat", "emoji": "\U0001f32d", "synonyms": ["frankfurters", "wieners"]},
    {"canonical": "pepperoni", "category": "meat", "emoji": "\U0001f355", "synonyms": []},
    {"canonical": "salami", "category": "meat", "emoji": "\U0001f969", "synonyms": ["genoa salami"]},
    {"canonical": "prosciutto", "category": "meat", "emoji": "\U0001f969", "synonyms": []},

    # ---- Seafood ----
    {"canonical": "salmon", "category": "seafood", "emoji": "\U0001f41f", "synonyms": ["salmon fillet", "atlantic salmon"]},
    {"canonical": "tuna", "category": "seafood", "emoji": "\U0001f41f", "synonyms": ["tuna steak", "ahi tuna"]},
    {"canonical": "cod", "category": "seafood", "emoji": "\U0001f41f", "synonyms": ["cod fillet", "pacific cod"]},
    {"canonical": "tilapia", "category": "seafood", "emoji": "\U0001f41f", "synonyms": ["tilapia fillet"]},
    {"canonical": "shrimp", "category": "seafood", "emoji": "\U0001f990", "synonyms": ["prawns", "jumbo shrimp"]},
    {"canonical": "lobster", "category": "seafood", "emoji": "\U0001f99e", "synonyms": ["lobster tail"]},
    {"canonical": "crab", "category": "seafood", "emoji": "\U0001f980", "synonyms": ["crab meat", "king crab"]},
    {"canonical": "scallops", "category": "seafood", "emoji": "\U0001f41f", "synonyms": ["sea scallops", "bay scallops"]},
    {"canonical": "oysters", "category": "seafood", "emoji": "\U0001f9aa", "synonyms": []},
    {"canonical": "clams", "category": "seafood", "emoji": "\U0001f41a", "synonyms": ["littleneck clams"]},
    {"canonical": "mussels", "category": "seafood", "emoji": "\U0001f41a", "synonyms": []},
    {"canonical": "sardines", "category": "seafood", "emoji": "\U0001f41f", "synonyms": ["canned sardines"]},
    {"canonical": "anchovies", "category": "seafood", "emoji": "\U0001f41f", "synonyms": []},
    {"canonical": "halibut", "category": "seafood", "emoji": "\U0001f41f", "synonyms": ["halibut fillet"]},
    {"canonical": "sea bass", "category": "seafood", "emoji": "\U0001f41f", "synonyms": ["bass", "branzino"]},
    {"canonical": "trout", "category": "seafood", "emoji": "\U0001f41f", "synonyms": ["rainbow trout"]},
    {"canonical": "catfish", "category": "seafood", "emoji": "\U0001f41f", "synonyms": ["catfish fillet"]},
    {"canonical": "canned tuna", "category": "canned", "emoji": "\U0001f41f", "synonyms": ["tuna can", "chunk light tuna"], "valid_units": ["can", "count"]},
    {"canonical": "canned salmon", "category": "canned", "emoji": "\U0001f41f", "synonyms": ["salmon can"], "valid_units": ["can", "count"]},

    # ---- Pantry Staples (dry_goods, canned, condiments, beverages) ----
    {"canonical": "all-purpose flour", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": ["flour", "ap flour", "white flour", "all purpose flour"]},
    {"canonical": "bread flour", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": []},
    {"canonical": "whole wheat flour", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": ["wheat flour"]},
    {"canonical": "cornstarch", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": ["corn starch"]},
    {"canonical": "baking soda", "category": "dry_goods", "emoji": "\U0001f9c2", "synonyms": ["bicarbonate of soda"]},
    {"canonical": "baking powder", "category": "dry_goods", "emoji": "\U0001f9c2", "synonyms": []},
    {"canonical": "salt", "category": "dry_goods", "emoji": "\U0001f9c2", "synonyms": ["table salt", "kosher salt", "sea salt"]},
    {"canonical": "black pepper", "category": "dry_goods", "emoji": "\U0001f336\ufe0f", "synonyms": ["pepper", "ground pepper", "peppercorn"]},
    {"canonical": "sugar", "category": "dry_goods", "emoji": "\U0001f36c", "synonyms": ["white sugar", "granulated sugar"]},
    {"canonical": "brown sugar", "category": "dry_goods", "emoji": "\U0001f36c", "synonyms": ["light brown sugar", "dark brown sugar"]},
    {"canonical": "powdered sugar", "category": "dry_goods", "emoji": "\U0001f36c", "synonyms": ["confectioners sugar", "icing sugar"]},
    {"canonical": "honey", "category": "condiments", "emoji": "\U0001f36f", "synonyms": ["raw honey", "local honey"]},
    {"canonical": "maple syrup", "category": "condiments", "emoji": "\U0001f341", "synonyms": ["pure maple syrup"]},
    {"canonical": "vanilla extract", "category": "dry_goods", "emoji": "\U0001f36c", "synonyms": ["vanilla", "pure vanilla"]},
    {"canonical": "cocoa powder", "category": "dry_goods", "emoji": "\U0001f36b", "synonyms": ["unsweetened cocoa"]},
    {"canonical": "chocolate chips", "category": "dry_goods", "emoji": "\U0001f36b", "synonyms": ["semi sweet chips", "dark chocolate chips"]},
    {"canonical": "olive oil", "category": "condiments", "emoji": "\U0001fad2", "synonyms": ["extra virgin olive oil", "evoo"]},
    {"canonical": "vegetable oil", "category": "condiments", "emoji": "\U0001fad2", "synonyms": ["canola oil", "cooking oil"]},
    {"canonical": "coconut oil", "category": "condiments", "emoji": "\U0001fad2", "synonyms": ["virgin coconut oil"]},
    {"canonical": "sesame oil", "category": "condiments", "emoji": "\U0001fad2", "synonyms": ["toasted sesame oil"]},
    {"canonical": "apple cider vinegar", "category": "condiments", "emoji": "\U0001fad7", "synonyms": ["acv"]},
    {"canonical": "white vinegar", "category": "condiments", "emoji": "\U0001fad7", "synonyms": ["distilled vinegar"]},
    {"canonical": "balsamic vinegar", "category": "condiments", "emoji": "\U0001fad7", "synonyms": ["balsamic"]},
    {"canonical": "soy sauce", "category": "condiments", "emoji": "\U0001f958", "synonyms": ["shoyu", "tamari"]},
    {"canonical": "fish sauce", "category": "condiments", "emoji": "\U0001f41f", "synonyms": ["nam pla"]},
    {"canonical": "worcestershire sauce", "category": "condiments", "emoji": "\U0001fad7", "synonyms": ["worcestershire"]},
    {"canonical": "hot sauce", "category": "condiments", "emoji": "\U0001f336\ufe0f", "synonyms": ["tabasco", "sriracha", "frank's red hot"]},
    {"canonical": "ketchup", "category": "condiments", "emoji": "\U0001f958", "synonyms": ["catsup", "tomato ketchup"]},
    {"canonical": "mustard", "category": "condiments", "emoji": "\U0001f958", "synonyms": ["yellow mustard", "dijon mustard"]},
    {"canonical": "mayonnaise", "category": "condiments", "emoji": "\U0001f958", "synonyms": ["mayo"]},
    {"canonical": "ranch dressing", "category": "condiments", "emoji": "\U0001f957", "synonyms": ["ranch"]},
    {"canonical": "italian dressing", "category": "condiments", "emoji": "\U0001f957", "synonyms": []},
    {"canonical": "salsa", "category": "condiments", "emoji": "\U0001fad8", "synonyms": ["pico de gallo", "tomato salsa"]},
    {"canonical": "tomato sauce", "category": "canned", "emoji": "\U0001f345", "synonyms": ["marinara", "pasta sauce"]},
    {"canonical": "tomato paste", "category": "canned", "emoji": "\U0001f345", "synonyms": []},
    {"canonical": "canned tomatoes", "category": "canned", "emoji": "\U0001f345", "synonyms": ["diced tomatoes", "crushed tomatoes", "whole tomatoes"]},
    {"canonical": "chicken broth", "category": "canned", "emoji": "\U0001f372", "synonyms": ["chicken stock", "chicken bone broth"]},
    {"canonical": "beef broth", "category": "canned", "emoji": "\U0001f372", "synonyms": ["beef stock"]},
    {"canonical": "vegetable broth", "category": "canned", "emoji": "\U0001f372", "synonyms": ["vegetable stock", "veggie broth"]},
    {"canonical": "rice", "category": "dry_goods", "emoji": "\U0001f35a", "synonyms": ["white rice", "jasmine rice", "basmati rice"]},
    {"canonical": "brown rice", "category": "dry_goods", "emoji": "\U0001f35a", "synonyms": []},
    {"canonical": "pasta", "category": "dry_goods", "emoji": "\U0001f35d", "synonyms": ["dried pasta"]},
    {"canonical": "spaghetti", "category": "dry_goods", "emoji": "\U0001f35d", "synonyms": []},
    {"canonical": "penne", "category": "dry_goods", "emoji": "\U0001f35d", "synonyms": ["penne rigate"]},
    {"canonical": "quinoa", "category": "dry_goods", "emoji": "\U0001f35a", "synonyms": []},
    {"canonical": "oats", "category": "dry_goods", "emoji": "\U0001f35a", "synonyms": ["rolled oats", "oatmeal", "old fashioned oats"]},
    {"canonical": "cornmeal", "category": "dry_goods", "emoji": "\U0001f33d", "synonyms": ["polenta"]},
    {"canonical": "breadcrumbs", "category": "dry_goods", "emoji": "\U0001f35e", "synonyms": ["panko", "italian breadcrumbs"]},
    {"canonical": "crackers", "category": "snacks", "emoji": "\U0001f9c0", "synonyms": ["saltines", "ritz crackers"]},
    {"canonical": "tortillas", "category": "bakery", "emoji": "\U0001fad4", "synonyms": ["flour tortillas", "corn tortillas", "wraps"]},
    {"canonical": "pita bread", "category": "bakery", "emoji": "\U0001f35e", "synonyms": ["pita"]},
    {"canonical": "naan", "category": "bakery", "emoji": "\U0001f35e", "synonyms": ["naan bread"]},
    {"canonical": "coffee", "category": "beverages", "emoji": "\u2615", "synonyms": ["ground coffee", "coffee beans"]},
    {"canonical": "tea", "category": "beverages", "emoji": "\U0001fad6", "synonyms": ["tea bags", "green tea", "black tea"]},
    {"canonical": "juice", "category": "beverages", "emoji": "\U0001f9c3", "synonyms": ["orange juice", "apple juice"]},
    {"canonical": "sparkling water", "category": "beverages", "emoji": "\U0001f4a7", "synonyms": ["seltzer", "club soda", "sparkling"]},
    {"canonical": "almond milk", "category": "beverages", "emoji": "\U0001f95b", "synonyms": []},
    {"canonical": "soy milk", "category": "beverages", "emoji": "\U0001f95b", "synonyms": ["soymilk"]},
    {"canonical": "oat milk", "category": "beverages", "emoji": "\U0001f95b", "synonyms": []},
    {"canonical": "protein powder", "category": "dry_goods", "emoji": "\U0001f4aa", "synonyms": ["whey protein"]},
    {"canonical": "peanut butter", "category": "condiments", "emoji": "\U0001f95c", "synonyms": ["pb", "creamy peanut butter", "crunchy peanut butter"]},
    {"canonical": "almond butter", "category": "condiments", "emoji": "\U0001f95c", "synonyms": []},
    {"canonical": "jelly", "category": "condiments", "emoji": "\U0001f353", "synonyms": ["grape jelly"]},
    {"canonical": "jam", "category": "condiments", "emoji": "\U0001f353", "synonyms": ["strawberry jam", "fruit preserves"]},
    {"canonical": "nutella", "category": "condiments", "emoji": "\U0001f36b", "synonyms": ["hazelnut spread", "chocolate hazelnut spread"]},
    {"canonical": "tahini", "category": "condiments", "emoji": "\U0001f95c", "synonyms": ["sesame paste"]},
    {"canonical": "hummus", "category": "condiments", "emoji": "\U0001f958", "synonyms": []},
    {"canonical": "canned beans", "category": "canned", "emoji": "\U0001fad8", "synonyms": ["beans"]},
    {"canonical": "black beans", "category": "canned", "emoji": "\U0001fad8", "synonyms": ["canned black beans"]},
    {"canonical": "chickpeas", "category": "canned", "emoji": "\U0001fad8", "synonyms": ["garbanzo beans", "canned chickpeas"]},
    {"canonical": "lentils", "category": "dry_goods", "emoji": "\U0001fad8", "synonyms": ["red lentils", "green lentils", "brown lentils"]},
    {"canonical": "kidney beans", "category": "canned", "emoji": "\U0001fad8", "synonyms": ["canned kidney beans", "red kidney beans"]},
    {"canonical": "pinto beans", "category": "canned", "emoji": "\U0001fad8", "synonyms": ["canned pinto beans"]},
    {"canonical": "almonds", "category": "snacks", "emoji": "\U0001f95c", "synonyms": ["raw almonds", "roasted almonds"]},
    {"canonical": "walnuts", "category": "snacks", "emoji": "\U0001f95c", "synonyms": []},
    {"canonical": "cashews", "category": "snacks", "emoji": "\U0001f95c", "synonyms": ["raw cashews", "roasted cashews"]},
    {"canonical": "peanuts", "category": "snacks", "emoji": "\U0001f95c", "synonyms": ["roasted peanuts"]},
    {"canonical": "pecans", "category": "snacks", "emoji": "\U0001f95c", "synonyms": []},
    {"canonical": "sunflower seeds", "category": "snacks", "emoji": "\U0001f33b", "synonyms": []},
    {"canonical": "pumpkin seeds", "category": "snacks", "emoji": "\U0001f383", "synonyms": ["pepitas"]},
    {"canonical": "chia seeds", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": []},
    {"canonical": "flax seeds", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": ["flaxseed", "ground flax"]},
    {"canonical": "raisins", "category": "snacks", "emoji": "\U0001f347", "synonyms": []},
    {"canonical": "dried cranberries", "category": "snacks", "emoji": "\U0001f347", "synonyms": ["craisins"]},
    {"canonical": "coconut flakes", "category": "dry_goods", "emoji": "\U0001f965", "synonyms": ["shredded coconut", "desiccated coconut"]},

    # ---- Bakery ----
    {"canonical": "bread", "category": "bakery", "emoji": "\U0001f35e", "synonyms": ["loaf of bread", "white bread", "wheat bread", "sourdough"]},
    {"canonical": "bagels", "category": "bakery", "emoji": "\U0001f96f", "synonyms": ["bagel", "plain bagel"]},
    {"canonical": "croissant", "category": "bakery", "emoji": "\U0001f950", "synonyms": ["croissants"]},
    {"canonical": "english muffins", "category": "bakery", "emoji": "\U0001f35e", "synonyms": ["english muffin"]},
    {"canonical": "dinner rolls", "category": "bakery", "emoji": "\U0001f35e", "synonyms": ["rolls"]},
    {"canonical": "hamburger buns", "category": "bakery", "emoji": "\U0001f35e", "synonyms": ["burger buns"]},
    {"canonical": "hot dog buns", "category": "bakery", "emoji": "\U0001f35e", "synonyms": []},

    # ---- Frozen ----
    {"canonical": "frozen vegetables", "category": "frozen", "emoji": "\u2744\ufe0f", "synonyms": ["frozen veggies", "frozen mixed vegetables"]},
    {"canonical": "frozen fruit", "category": "frozen", "emoji": "\u2744\ufe0f", "synonyms": ["frozen berries", "frozen mixed fruit"]},
    {"canonical": "ice cream", "category": "frozen", "emoji": "\U0001f368", "synonyms": ["vanilla ice cream"]},
    {"canonical": "frozen pizza", "category": "frozen", "emoji": "\U0001f355", "synonyms": []},
    {"canonical": "frozen fries", "category": "frozen", "emoji": "\U0001f35f", "synonyms": ["french fries", "frozen french fries"]},
    {"canonical": "frozen chicken", "category": "frozen", "emoji": "\U0001f357", "synonyms": ["frozen chicken breasts", "frozen chicken tenders"]},
    {"canonical": "frozen shrimp", "category": "frozen", "emoji": "\U0001f990", "synonyms": []},
    {"canonical": "frozen waffles", "category": "frozen", "emoji": "\U0001f9c7", "synonyms": ["eggo waffles"]},

    # ---- Snacks ----
    {"canonical": "chips", "category": "snacks", "emoji": "\U0001f35f", "synonyms": ["potato chips", "tortilla chips"]},
    {"canonical": "popcorn", "category": "snacks", "emoji": "\U0001f37f", "synonyms": ["microwave popcorn"]},
    {"canonical": "pretzels", "category": "snacks", "emoji": "\U0001f968", "synonyms": []},
    {"canonical": "granola bars", "category": "snacks", "emoji": "\U0001f36b", "synonyms": ["protein bars", "energy bars"]},
    {"canonical": "trail mix", "category": "snacks", "emoji": "\U0001f95c", "synonyms": []},
    {"canonical": "cookies", "category": "snacks", "emoji": "\U0001f36a", "synonyms": ["cookie", "chocolate chip cookies"]},
    {"canonical": "chocolate", "category": "snacks", "emoji": "\U0001f36b", "synonyms": ["dark chocolate", "milk chocolate"]},

    # ---- Additional Pantry / Condiments ----
    {"canonical": "cinnamon", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": ["ground cinnamon"]},
    {"canonical": "cumin", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": ["ground cumin"]},
    {"canonical": "paprika", "category": "dry_goods", "emoji": "\U0001f336\ufe0f", "synonyms": ["smoked paprika"]},
    {"canonical": "oregano", "category": "dry_goods", "emoji": "\U0001f33f", "synonyms": ["dried oregano"]},
    {"canonical": "garlic powder", "category": "dry_goods", "emoji": "\U0001f9c4", "synonyms": []},
    {"canonical": "onion powder", "category": "dry_goods", "emoji": "\U0001f9c5", "synonyms": []},
    {"canonical": "chili powder", "category": "dry_goods", "emoji": "\U0001f336\ufe0f", "synonyms": []},
    {"canonical": "turmeric", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": ["ground turmeric"]},
    {"canonical": "bay leaves", "category": "dry_goods", "emoji": "\U0001f343", "synonyms": ["bay leaf"]},
    {"canonical": "red pepper flakes", "category": "dry_goods", "emoji": "\U0001f336\ufe0f", "synonyms": ["crushed red pepper"]},
    {"canonical": "italian seasoning", "category": "dry_goods", "emoji": "\U0001f33f", "synonyms": []},
    {"canonical": "taco seasoning", "category": "dry_goods", "emoji": "\U0001f32e", "synonyms": []},
    {"canonical": "bbq sauce", "category": "condiments", "emoji": "\U0001f356", "synonyms": ["barbecue sauce"]},
    {"canonical": "teriyaki sauce", "category": "condiments", "emoji": "\U0001f363", "synonyms": []},
    {"canonical": "hoisin sauce", "category": "condiments", "emoji": "\U0001f958", "synonyms": []},
    {"canonical": "oyster sauce", "category": "condiments", "emoji": "\U0001f9aa", "synonyms": []},
    {"canonical": "dijon mustard", "category": "condiments", "emoji": "\U0001f958", "synonyms": []},
    {"canonical": "relish", "category": "condiments", "emoji": "\U0001f952", "synonyms": ["sweet relish", "pickle relish"]},
    {"canonical": "pickles", "category": "condiments", "emoji": "\U0001f952", "synonyms": ["dill pickles"]},
    {"canonical": "olives", "category": "canned", "emoji": "\U0001fad2", "synonyms": ["black olives", "green olives", "kalamata olives"]},
    {"canonical": "capers", "category": "condiments", "emoji": "\U0001f33f", "synonyms": []},
    {"canonical": "tofu", "category": "produce", "emoji": "\U0001f958", "synonyms": ["firm tofu", "silken tofu", "extra firm tofu"]},
    {"canonical": "tempeh", "category": "produce", "emoji": "\U0001f958", "synonyms": []},

    # ---- Additional Beverages ----
    {"canonical": "water", "category": "beverages", "emoji": "\U0001f4a7", "synonyms": ["bottled water"]},
    {"canonical": "soda", "category": "beverages", "emoji": "\U0001f964", "synonyms": ["cola", "soft drink", "coke", "pepsi"]},
    {"canonical": "beer", "category": "beverages", "emoji": "\U0001f37a", "synonyms": []},
    {"canonical": "wine", "category": "beverages", "emoji": "\U0001f377", "synonyms": ["red wine", "white wine"]},
    {"canonical": "coconut water", "category": "beverages", "emoji": "\U0001f965", "synonyms": []},
    {"canonical": "sports drink", "category": "beverages", "emoji": "\U0001f964", "synonyms": ["gatorade", "electrolyte drink"]},

    # ---- Eggs and milk with specific units ----
    {"canonical": "cream", "category": "dairy", "emoji": "\U0001f95b", "synonyms": ["light cream"]},

    # ---- Additional Produce (round 2) ----
    {"canonical": "scallions", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["green onions", "spring onions"]},
    {"canonical": "leek", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["leeks"]},
    {"canonical": "shallot", "category": "produce", "emoji": "\U0001f9c5", "synonyms": ["shallots"]},
    {"canonical": "chives", "category": "produce", "emoji": "\U0001f33f", "synonyms": ["fresh chives"]},
    {"canonical": "dill", "category": "produce", "emoji": "\U0001f33f", "synonyms": ["fresh dill"]},
    {"canonical": "sage", "category": "produce", "emoji": "\U0001f33f", "synonyms": ["fresh sage"]},
    {"canonical": "tarragon", "category": "produce", "emoji": "\U0001f33f", "synonyms": ["fresh tarragon"]},
    {"canonical": "lemongrass", "category": "produce", "emoji": "\U0001f33f", "synonyms": []},
    {"canonical": "jalapeno", "category": "produce", "emoji": "\U0001f336\ufe0f", "synonyms": ["jalapenos", "jalapeno pepper"]},
    {"canonical": "serrano pepper", "category": "produce", "emoji": "\U0001f336\ufe0f", "synonyms": ["serrano"]},
    {"canonical": "habanero", "category": "produce", "emoji": "\U0001f336\ufe0f", "synonyms": ["habanero pepper"]},
    {"canonical": "poblano pepper", "category": "produce", "emoji": "\U0001f336\ufe0f", "synonyms": ["poblano"]},
    {"canonical": "anaheim pepper", "category": "produce", "emoji": "\U0001f336\ufe0f", "synonyms": ["anaheim"]},
    {"canonical": "cherry", "category": "produce", "emoji": "\U0001f352", "synonyms": ["cherries", "sweet cherries"]},
    {"canonical": "apricot", "category": "produce", "emoji": "\U0001f351", "synonyms": ["apricots"]},
    {"canonical": "nectarine", "category": "produce", "emoji": "\U0001f351", "synonyms": ["nectarines"]},
    {"canonical": "fig", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["figs", "fresh figs"]},
    {"canonical": "pomegranate", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["pomegranates"]},
    {"canonical": "coconut", "category": "produce", "emoji": "\U0001f965", "synonyms": ["fresh coconut"]},
    {"canonical": "cranberries", "category": "produce", "emoji": "\U0001f347", "synonyms": ["fresh cranberries"]},
    {"canonical": "papaya", "category": "produce", "emoji": "\U0001f96d", "synonyms": ["papayas"]},
    {"canonical": "passion fruit", "category": "produce", "emoji": "\U0001f96d", "synonyms": ["passionfruit"]},
    {"canonical": "dragon fruit", "category": "produce", "emoji": "\U0001f96d", "synonyms": ["pitaya"]},
    {"canonical": "guava", "category": "produce", "emoji": "\U0001f96d", "synonyms": ["guavas"]},
    {"canonical": "lychee", "category": "produce", "emoji": "\U0001f96d", "synonyms": ["lychees", "litchi"]},
    {"canonical": "starfruit", "category": "produce", "emoji": "\U0001f96d", "synonyms": ["carambola"]},
    {"canonical": "persimmon", "category": "produce", "emoji": "\U0001f96d", "synonyms": ["persimmons"]},
    {"canonical": "turnip", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["turnips"]},
    {"canonical": "parsnip", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["parsnips"]},
    {"canonical": "rutabaga", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["swede"]},
    {"canonical": "daikon", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["daikon radish"]},
    {"canonical": "jicama", "category": "produce", "emoji": "\U0001f96c", "synonyms": []},
    {"canonical": "fennel", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["fennel bulb"]},
    {"canonical": "endive", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["belgian endive"]},
    {"canonical": "radicchio", "category": "produce", "emoji": "\U0001f96c", "synonyms": []},
    {"canonical": "watercress", "category": "produce", "emoji": "\U0001f96c", "synonyms": []},
    {"canonical": "bok choy", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["baby bok choy"]},
    {"canonical": "swiss chard", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["chard", "rainbow chard"]},
    {"canonical": "collard greens", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["collards"]},
    {"canonical": "mustard greens", "category": "produce", "emoji": "\U0001f96c", "synonyms": []},
    {"canonical": "turnip greens", "category": "produce", "emoji": "\U0001f96c", "synonyms": []},
    {"canonical": "okra", "category": "produce", "emoji": "\U0001f96c", "synonyms": []},
    {"canonical": "eggplant", "category": "produce", "emoji": "\U0001f346", "synonyms": ["aubergine"]},
    {"canonical": "butternut squash", "category": "produce", "emoji": "\U0001f383", "synonyms": []},
    {"canonical": "acorn squash", "category": "produce", "emoji": "\U0001f383", "synonyms": []},
    {"canonical": "spaghetti squash", "category": "produce", "emoji": "\U0001f383", "synonyms": []},
    {"canonical": "yellow squash", "category": "produce", "emoji": "\U0001f383", "synonyms": ["summer squash"]},
    {"canonical": "delicata squash", "category": "produce", "emoji": "\U0001f383", "synonyms": []},
    {"canonical": "pumpkin", "category": "produce", "emoji": "\U0001f383", "synonyms": ["sugar pumpkin"]},
    {"canonical": "tomatillo", "category": "produce", "emoji": "\U0001f345", "synonyms": ["tomatillos"]},
    {"canonical": "plantain", "category": "produce", "emoji": "\U0001f34c", "synonyms": ["plantains"]},
    {"canonical": "yuca", "category": "produce", "emoji": "\U0001f954", "synonyms": ["cassava"]},
    {"canonical": "edamame", "category": "produce", "emoji": "\U0001f96c", "synonyms": ["soybeans"]},
    {"canonical": "bean sprouts", "category": "produce", "emoji": "\U0001f331", "synonyms": ["mung bean sprouts"]},
    {"canonical": "water chestnuts", "category": "canned", "emoji": "\U0001f330", "synonyms": ["sliced water chestnuts"]},
    {"canonical": "bamboo shoots", "category": "canned", "emoji": "\U0001f38d", "synonyms": ["canned bamboo shoots"]},
    {"canonical": "hearts of palm", "category": "canned", "emoji": "\U0001f334", "synonyms": []},
    {"canonical": "artichoke hearts", "category": "canned", "emoji": "\U0001f96c", "synonyms": ["canned artichoke hearts"]},
    {"canonical": "roasted red peppers", "category": "canned", "emoji": "\U0001fad1", "synonyms": ["jarred roasted peppers"]},
    {"canonical": "sun dried tomatoes", "category": "condiments", "emoji": "\U0001f345", "synonyms": ["sundried tomatoes"]},
    {"canonical": "chipotle in adobo", "category": "canned", "emoji": "\U0001f336\ufe0f", "synonyms": ["chipotle peppers"]},
    {"canonical": "coconut milk", "category": "canned", "emoji": "\U0001f965", "synonyms": ["canned coconut milk"]},
    {"canonical": "coconut cream", "category": "canned", "emoji": "\U0001f965", "synonyms": []},
    {"canonical": "sweetened condensed coconut milk", "category": "canned", "emoji": "\U0001f965", "synonyms": []},
    {"canonical": "evaporated coconut milk", "category": "canned", "emoji": "\U0001f965", "synonyms": []},

    # ---- Additional Meat / Deli ----
    {"canonical": "chicken wings", "category": "meat", "emoji": "\U0001f357", "synonyms": ["wings", "buffalo wings"]},
    {"canonical": "chicken drumsticks", "category": "meat", "emoji": "\U0001f357", "synonyms": ["drumsticks"]},
    {"canonical": "whole chicken", "category": "meat", "emoji": "\U0001f357", "synonyms": ["roasting chicken"]},
    {"canonical": "ground chicken", "category": "meat", "emoji": "\U0001f357", "synonyms": []},
    {"canonical": "ground pork", "category": "meat", "emoji": "\U0001f969", "synonyms": ["pork mince"]},
    {"canonical": "pork tenderloin", "category": "meat", "emoji": "\U0001f969", "synonyms": []},
    {"canonical": "pork shoulder", "category": "meat", "emoji": "\U0001f969", "synonyms": ["pork butt", "boston butt"]},
    {"canonical": "pork loin", "category": "meat", "emoji": "\U0001f969", "synonyms": ["pork loin roast"]},
    {"canonical": "lamb shank", "category": "meat", "emoji": "\U0001f356", "synonyms": ["lamb shanks"]},
    {"canonical": "lamb leg", "category": "meat", "emoji": "\U0001f356", "synonyms": ["leg of lamb"]},
    {"canonical": "veal", "category": "meat", "emoji": "\U0001f969", "synonyms": ["veal cutlet"]},
    {"canonical": "duck", "category": "meat", "emoji": "\U0001f986", "synonyms": ["duck breast"]},
    {"canonical": "cornish hen", "category": "meat", "emoji": "\U0001f414", "synonyms": ["cornish game hen"]},
    {"canonical": "liver", "category": "meat", "emoji": "\U0001f969", "synonyms": ["chicken liver", "beef liver"]},
    {"canonical": "chorizo", "category": "meat", "emoji": "\U0001f32d", "synonyms": ["spanish chorizo", "mexican chorizo"]},
    {"canonical": "bratwurst", "category": "meat", "emoji": "\U0001f32d", "synonyms": ["brats"]},
    {"canonical": "kielbasa", "category": "meat", "emoji": "\U0001f32d", "synonyms": ["polish sausage"]},
    {"canonical": "andouille sausage", "category": "meat", "emoji": "\U0001f32d", "synonyms": ["andouille"]},
    {"canonical": "bologna", "category": "meat", "emoji": "\U0001f969", "synonyms": ["baloney"]},
    {"canonical": "corned beef", "category": "meat", "emoji": "\U0001f969", "synonyms": []},
    {"canonical": "beef jerky", "category": "snacks", "emoji": "\U0001f969", "synonyms": ["jerky"]},

    # ---- Additional Seafood ----
    {"canonical": "swordfish", "category": "seafood", "emoji": "\U0001f41f", "synonyms": ["swordfish steak"]},
    {"canonical": "mahi mahi", "category": "seafood", "emoji": "\U0001f41f", "synonyms": ["dolphinfish"]},
    {"canonical": "red snapper", "category": "seafood", "emoji": "\U0001f41f", "synonyms": ["snapper"]},
    {"canonical": "grouper", "category": "seafood", "emoji": "\U0001f41f", "synonyms": []},
    {"canonical": "octopus", "category": "seafood", "emoji": "\U0001f419", "synonyms": []},
    {"canonical": "squid", "category": "seafood", "emoji": "\U0001f991", "synonyms": ["calamari"]},
    {"canonical": "crawfish", "category": "seafood", "emoji": "\U0001f99e", "synonyms": ["crayfish", "crawdad"]},
    {"canonical": "smoked salmon", "category": "seafood", "emoji": "\U0001f41f", "synonyms": ["lox"]},
    {"canonical": "fish sticks", "category": "frozen", "emoji": "\U0001f41f", "synonyms": ["fish fingers"]},

    # ---- Additional Dry Goods / Grains ----
    {"canonical": "couscous", "category": "dry_goods", "emoji": "\U0001f35a", "synonyms": ["pearl couscous", "israeli couscous"]},
    {"canonical": "farro", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": []},
    {"canonical": "barley", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": ["pearl barley"]},
    {"canonical": "bulgur", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": ["bulgur wheat"]},
    {"canonical": "millet", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": []},
    {"canonical": "buckwheat", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": ["kasha"]},
    {"canonical": "wild rice", "category": "dry_goods", "emoji": "\U0001f35a", "synonyms": []},
    {"canonical": "arborio rice", "category": "dry_goods", "emoji": "\U0001f35a", "synonyms": ["risotto rice"]},
    {"canonical": "sushi rice", "category": "dry_goods", "emoji": "\U0001f35a", "synonyms": ["calrose rice"]},
    {"canonical": "egg noodles", "category": "dry_goods", "emoji": "\U0001f35d", "synonyms": []},
    {"canonical": "ramen noodles", "category": "dry_goods", "emoji": "\U0001f35c", "synonyms": ["instant ramen"]},
    {"canonical": "udon noodles", "category": "dry_goods", "emoji": "\U0001f35c", "synonyms": ["udon"]},
    {"canonical": "soba noodles", "category": "dry_goods", "emoji": "\U0001f35c", "synonyms": ["buckwheat noodles"]},
    {"canonical": "rice noodles", "category": "dry_goods", "emoji": "\U0001f35c", "synonyms": ["pad thai noodles", "vermicelli"]},
    {"canonical": "lasagna noodles", "category": "dry_goods", "emoji": "\U0001f35d", "synonyms": ["lasagna sheets"]},
    {"canonical": "orzo", "category": "dry_goods", "emoji": "\U0001f35d", "synonyms": []},
    {"canonical": "rotini", "category": "dry_goods", "emoji": "\U0001f35d", "synonyms": ["fusilli"]},
    {"canonical": "rigatoni", "category": "dry_goods", "emoji": "\U0001f35d", "synonyms": []},
    {"canonical": "macaroni", "category": "dry_goods", "emoji": "\U0001f35d", "synonyms": ["elbow macaroni"]},
    {"canonical": "angel hair", "category": "dry_goods", "emoji": "\U0001f35d", "synonyms": ["angel hair pasta", "capellini"]},
    {"canonical": "bow tie pasta", "category": "dry_goods", "emoji": "\U0001f35d", "synonyms": ["farfalle"]},
    {"canonical": "linguine", "category": "dry_goods", "emoji": "\U0001f35d", "synonyms": []},
    {"canonical": "fettuccine", "category": "dry_goods", "emoji": "\U0001f35d", "synonyms": []},
    {"canonical": "tortellini", "category": "dry_goods", "emoji": "\U0001f35d", "synonyms": ["cheese tortellini"]},
    {"canonical": "ravioli", "category": "dry_goods", "emoji": "\U0001f35d", "synonyms": ["cheese ravioli"]},
    {"canonical": "gnocchi", "category": "dry_goods", "emoji": "\U0001f35d", "synonyms": ["potato gnocchi"]},
    {"canonical": "pancake mix", "category": "dry_goods", "emoji": "\U0001f95e", "synonyms": ["pancake batter"]},
    {"canonical": "cake mix", "category": "dry_goods", "emoji": "\U0001f382", "synonyms": ["box cake mix"]},
    {"canonical": "brownie mix", "category": "dry_goods", "emoji": "\U0001f36b", "synonyms": []},
    {"canonical": "muffin mix", "category": "dry_goods", "emoji": "\U0001f9c1", "synonyms": []},
    {"canonical": "biscuit mix", "category": "dry_goods", "emoji": "\U0001f35e", "synonyms": ["bisquick"]},
    {"canonical": "instant yeast", "category": "dry_goods", "emoji": "\U0001f35e", "synonyms": ["yeast", "active dry yeast"]},
    {"canonical": "gelatin", "category": "dry_goods", "emoji": "\U0001f36c", "synonyms": ["unflavored gelatin"]},
    {"canonical": "cornflakes", "category": "dry_goods", "emoji": "\U0001f35a", "synonyms": ["corn flakes"]},
    {"canonical": "granola", "category": "dry_goods", "emoji": "\U0001f35a", "synonyms": []},
    {"canonical": "cereal", "category": "dry_goods", "emoji": "\U0001f963", "synonyms": ["breakfast cereal"]},
    {"canonical": "instant oatmeal", "category": "dry_goods", "emoji": "\U0001f963", "synonyms": ["oatmeal packets"]},

    # ---- Additional Canned ----
    {"canonical": "canned corn", "category": "canned", "emoji": "\U0001f33d", "synonyms": ["cream corn"]},
    {"canonical": "canned peas", "category": "canned", "emoji": "\U0001f96c", "synonyms": []},
    {"canonical": "canned green beans", "category": "canned", "emoji": "\U0001f96c", "synonyms": []},
    {"canonical": "canned mushrooms", "category": "canned", "emoji": "\U0001f344", "synonyms": []},
    {"canonical": "canned pumpkin", "category": "canned", "emoji": "\U0001f383", "synonyms": ["pumpkin puree"]},
    {"canonical": "canned peaches", "category": "canned", "emoji": "\U0001f351", "synonyms": []},
    {"canonical": "canned pineapple", "category": "canned", "emoji": "\U0001f34d", "synonyms": ["pineapple chunks"]},
    {"canonical": "canned mandarin oranges", "category": "canned", "emoji": "\U0001f34a", "synonyms": []},
    {"canonical": "applesauce", "category": "canned", "emoji": "\U0001f34e", "synonyms": ["apple sauce"]},
    {"canonical": "cranberry sauce", "category": "canned", "emoji": "\U0001f347", "synonyms": []},
    {"canonical": "enchilada sauce", "category": "canned", "emoji": "\U0001f32e", "synonyms": ["red enchilada sauce", "green enchilada sauce"]},
    {"canonical": "green chiles", "category": "canned", "emoji": "\U0001f336\ufe0f", "synonyms": ["diced green chiles"]},
    {"canonical": "cream of mushroom soup", "category": "canned", "emoji": "\U0001f372", "synonyms": []},
    {"canonical": "cream of chicken soup", "category": "canned", "emoji": "\U0001f372", "synonyms": []},
    {"canonical": "condensed tomato soup", "category": "canned", "emoji": "\U0001f372", "synonyms": ["tomato soup"]},
    {"canonical": "refried beans", "category": "canned", "emoji": "\U0001fad8", "synonyms": []},
    {"canonical": "navy beans", "category": "canned", "emoji": "\U0001fad8", "synonyms": ["white beans", "great northern beans"]},
    {"canonical": "cannellini beans", "category": "canned", "emoji": "\U0001fad8", "synonyms": ["white kidney beans"]},

    # ---- Additional Condiments / Sauces ----
    {"canonical": "pesto", "category": "condiments", "emoji": "\U0001f33f", "synonyms": ["basil pesto"]},
    {"canonical": "alfredo sauce", "category": "condiments", "emoji": "\U0001f95b", "synonyms": []},
    {"canonical": "curry paste", "category": "condiments", "emoji": "\U0001f35b", "synonyms": ["red curry paste", "green curry paste"]},
    {"canonical": "miso paste", "category": "condiments", "emoji": "\U0001f372", "synonyms": ["miso", "white miso"]},
    {"canonical": "gochujang", "category": "condiments", "emoji": "\U0001f336\ufe0f", "synonyms": ["korean chili paste"]},
    {"canonical": "sambal", "category": "condiments", "emoji": "\U0001f336\ufe0f", "synonyms": ["sambal oelek"]},
    {"canonical": "chili garlic sauce", "category": "condiments", "emoji": "\U0001f336\ufe0f", "synonyms": []},
    {"canonical": "sweet chili sauce", "category": "condiments", "emoji": "\U0001f336\ufe0f", "synonyms": ["thai sweet chili"]},
    {"canonical": "steak sauce", "category": "condiments", "emoji": "\U0001f969", "synonyms": ["a1 sauce"]},
    {"canonical": "cocktail sauce", "category": "condiments", "emoji": "\U0001f990", "synonyms": []},
    {"canonical": "tartar sauce", "category": "condiments", "emoji": "\U0001f41f", "synonyms": []},
    {"canonical": "buffalo sauce", "category": "condiments", "emoji": "\U0001f357", "synonyms": ["wing sauce"]},
    {"canonical": "chimichurri", "category": "condiments", "emoji": "\U0001f33f", "synonyms": []},
    {"canonical": "mango chutney", "category": "condiments", "emoji": "\U0001f96d", "synonyms": ["chutney"]},
    {"canonical": "horseradish", "category": "condiments", "emoji": "\U0001f96c", "synonyms": ["prepared horseradish"]},
    {"canonical": "wasabi", "category": "condiments", "emoji": "\U0001f33f", "synonyms": ["wasabi paste"]},
    {"canonical": "anchovy paste", "category": "condiments", "emoji": "\U0001f41f", "synonyms": []},
    {"canonical": "harissa", "category": "condiments", "emoji": "\U0001f336\ufe0f", "synonyms": ["harissa paste"]},

    # ---- Additional Frozen ----
    {"canonical": "frozen broccoli", "category": "frozen", "emoji": "\U0001f966", "synonyms": []},
    {"canonical": "frozen spinach", "category": "frozen", "emoji": "\U0001f96c", "synonyms": []},
    {"canonical": "frozen corn", "category": "frozen", "emoji": "\U0001f33d", "synonyms": []},
    {"canonical": "frozen peas", "category": "frozen", "emoji": "\U0001f96c", "synonyms": []},
    {"canonical": "frozen edamame", "category": "frozen", "emoji": "\U0001f96c", "synonyms": []},
    {"canonical": "frozen dumplings", "category": "frozen", "emoji": "\U0001f95f", "synonyms": ["gyoza", "potstickers"]},
    {"canonical": "frozen burritos", "category": "frozen", "emoji": "\U0001f32f", "synonyms": []},
    {"canonical": "frozen fish fillets", "category": "frozen", "emoji": "\U0001f41f", "synonyms": []},
    {"canonical": "frozen meatballs", "category": "frozen", "emoji": "\U0001f356", "synonyms": []},
    {"canonical": "frozen pie crust", "category": "frozen", "emoji": "\U0001f967", "synonyms": ["pie shell"]},
    {"canonical": "frozen puff pastry", "category": "frozen", "emoji": "\U0001f950", "synonyms": ["puff pastry"]},
    {"canonical": "frozen bread dough", "category": "frozen", "emoji": "\U0001f35e", "synonyms": []},

    # ---- Additional Bakery ----
    {"canonical": "sourdough bread", "category": "bakery", "emoji": "\U0001f35e", "synonyms": ["sourdough"]},
    {"canonical": "rye bread", "category": "bakery", "emoji": "\U0001f35e", "synonyms": []},
    {"canonical": "ciabatta", "category": "bakery", "emoji": "\U0001f35e", "synonyms": ["ciabatta bread"]},
    {"canonical": "baguette", "category": "bakery", "emoji": "\U0001f956", "synonyms": ["french bread"]},
    {"canonical": "focaccia", "category": "bakery", "emoji": "\U0001f35e", "synonyms": []},
    {"canonical": "brioche", "category": "bakery", "emoji": "\U0001f35e", "synonyms": ["brioche buns"]},
    {"canonical": "cornbread", "category": "bakery", "emoji": "\U0001f33d", "synonyms": ["corn bread"]},
    {"canonical": "banana bread", "category": "bakery", "emoji": "\U0001f34c", "synonyms": []},
    {"canonical": "muffins", "category": "bakery", "emoji": "\U0001f9c1", "synonyms": ["blueberry muffins"]},
    {"canonical": "scones", "category": "bakery", "emoji": "\U0001f9c1", "synonyms": []},
    {"canonical": "donuts", "category": "bakery", "emoji": "\U0001f369", "synonyms": ["doughnuts"]},
    {"canonical": "cake", "category": "bakery", "emoji": "\U0001f370", "synonyms": []},
    {"canonical": "pie", "category": "bakery", "emoji": "\U0001f967", "synonyms": ["apple pie"]},

    # ---- Additional Snacks ----
    {"canonical": "rice cakes", "category": "snacks", "emoji": "\U0001f35a", "synonyms": []},
    {"canonical": "fruit snacks", "category": "snacks", "emoji": "\U0001f353", "synonyms": []},
    {"canonical": "dried fruit", "category": "snacks", "emoji": "\U0001f347", "synonyms": ["mixed dried fruit"]},
    {"canonical": "dried apricots", "category": "snacks", "emoji": "\U0001f351", "synonyms": []},
    {"canonical": "dried mango", "category": "snacks", "emoji": "\U0001f96d", "synonyms": []},
    {"canonical": "beef sticks", "category": "snacks", "emoji": "\U0001f969", "synonyms": ["slim jim"]},
    {"canonical": "cheese puffs", "category": "snacks", "emoji": "\U0001f9c0", "synonyms": ["cheetos"]},
    {"canonical": "goldfish crackers", "category": "snacks", "emoji": "\U0001f41f", "synonyms": ["goldfish"]},
    {"canonical": "animal crackers", "category": "snacks", "emoji": "\U0001f36a", "synonyms": []},
    {"canonical": "graham crackers", "category": "snacks", "emoji": "\U0001f36a", "synonyms": []},
    {"canonical": "marshmallows", "category": "snacks", "emoji": "\u2601\ufe0f", "synonyms": ["mini marshmallows"]},
    {"canonical": "gummy bears", "category": "snacks", "emoji": "\U0001f43b", "synonyms": ["gummies"]},
    {"canonical": "mixed nuts", "category": "snacks", "emoji": "\U0001f95c", "synonyms": ["nut mix"]},
    {"canonical": "macadamia nuts", "category": "snacks", "emoji": "\U0001f95c", "synonyms": ["macadamias"]},
    {"canonical": "pine nuts", "category": "snacks", "emoji": "\U0001f95c", "synonyms": ["pignoli"]},
    {"canonical": "pistachios", "category": "snacks", "emoji": "\U0001f95c", "synonyms": []},
    {"canonical": "hazelnuts", "category": "snacks", "emoji": "\U0001f95c", "synonyms": ["filberts"]},
    {"canonical": "brazil nuts", "category": "snacks", "emoji": "\U0001f95c", "synonyms": []},
    {"canonical": "sesame seeds", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": []},
    {"canonical": "poppy seeds", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": []},
    {"canonical": "hemp seeds", "category": "dry_goods", "emoji": "\U0001f33e", "synonyms": ["hemp hearts"]},
    {"canonical": "dried dates", "category": "snacks", "emoji": "\U0001f334", "synonyms": ["medjool dates", "dates"]},

    # ---- Additional Beverages ----
    {"canonical": "lemonade", "category": "beverages", "emoji": "\U0001f34b", "synonyms": []},
    {"canonical": "iced tea", "category": "beverages", "emoji": "\U0001fad6", "synonyms": ["sweet tea"]},
    {"canonical": "kombucha", "category": "beverages", "emoji": "\U0001fad6", "synonyms": []},
    {"canonical": "energy drink", "category": "beverages", "emoji": "\U0001f964", "synonyms": ["red bull", "monster"]},
    {"canonical": "tonic water", "category": "beverages", "emoji": "\U0001f4a7", "synonyms": []},
    {"canonical": "cranberry juice", "category": "beverages", "emoji": "\U0001f347", "synonyms": []},
    {"canonical": "grape juice", "category": "beverages", "emoji": "\U0001f347", "synonyms": []},
    {"canonical": "tomato juice", "category": "beverages", "emoji": "\U0001f345", "synonyms": []},
    {"canonical": "vegetable juice", "category": "beverages", "emoji": "\U0001f96c", "synonyms": ["v8"]},
    {"canonical": "hot chocolate mix", "category": "beverages", "emoji": "\U0001f375", "synonyms": ["cocoa mix"]},
    {"canonical": "matcha", "category": "beverages", "emoji": "\U0001f375", "synonyms": ["matcha powder"]},
    {"canonical": "chai", "category": "beverages", "emoji": "\U0001fad6", "synonyms": ["chai tea"]},

    # ---- Additional Dairy ----
    {"canonical": "provolone", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["provolone cheese"]},
    {"canonical": "colby jack", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["colby jack cheese"]},
    {"canonical": "pepper jack", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["pepper jack cheese"]},
    {"canonical": "muenster", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["muenster cheese"]},
    {"canonical": "havarti", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["havarti cheese"]},
    {"canonical": "gruyere", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["gruyere cheese"]},
    {"canonical": "mascarpone", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["mascarpone cheese"]},
    {"canonical": "blue cheese", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["bleu cheese", "gorgonzola"]},
    {"canonical": "string cheese", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["cheese sticks"]},
    {"canonical": "american cheese", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["american singles", "cheese slices"]},
    {"canonical": "goat cheese", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["chevre"]},
    {"canonical": "queso fresco", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": []},
    {"canonical": "cotija", "category": "dairy", "emoji": "\U0001f9c0", "synonyms": ["cotija cheese"]},
    {"canonical": "egg whites", "category": "dairy", "emoji": "\U0001f95a", "synonyms": ["liquid egg whites"]},
    {"canonical": "eggnog", "category": "dairy", "emoji": "\U0001f95b", "synonyms": []},

    # ---- Push past 500 ----
    {"canonical": "sriracha", "category": "condiments", "emoji": "\U0001f336\ufe0f", "synonyms": ["rooster sauce"]},
    {"canonical": "ponzu", "category": "condiments", "emoji": "\U0001f34b", "synonyms": ["ponzu sauce"]},
    {"canonical": "rice vinegar", "category": "condiments", "emoji": "\U0001fad7", "synonyms": ["rice wine vinegar"]},
    {"canonical": "mirin", "category": "condiments", "emoji": "\U0001f376", "synonyms": []},
    {"canonical": "cooking wine", "category": "condiments", "emoji": "\U0001f377", "synonyms": ["sherry"]},
    {"canonical": "corn syrup", "category": "dry_goods", "emoji": "\U0001f33d", "synonyms": ["light corn syrup"]},
    {"canonical": "molasses", "category": "dry_goods", "emoji": "\U0001f36f", "synonyms": ["blackstrap molasses"]},
    {"canonical": "agave nectar", "category": "condiments", "emoji": "\U0001f335", "synonyms": ["agave syrup"]},
    {"canonical": "almond extract", "category": "dry_goods", "emoji": "\U0001f95c", "synonyms": []},
    {"canonical": "food coloring", "category": "dry_goods", "emoji": "\U0001f308", "synonyms": []},
    {"canonical": "sprinkles", "category": "dry_goods", "emoji": "\U0001f382", "synonyms": ["jimmies"]},
]
# fmt: on


def build_library() -> list[dict]:
    """Build the food library from hardcoded items, optionally merging with catalog."""
    library: dict[str, dict] = {}

    # Step 1: Process hardcoded items
    for item in ITEMS:
        canonical = item["canonical"].lower().strip()
        category = item["category"]
        entry = {
            "canonical": canonical,
            "category": category,
            "emoji": item["emoji"],
            "synonyms": item.get("synonyms", []),
            "valid_units": item.get("valid_units", CATEGORY_UNITS.get(category, CATEGORY_UNITS["other"])),
            "expiry_days": get_expiry_days(canonical, category),
            "default_location": CATEGORY_LOCATIONS.get(category, "pantry"),
            "icon_slug": get_icon_slug(canonical),
        }
        library[canonical] = entry

    # Step 2: Merge with existing catalog if it exists
    if CATALOG_PATH.is_file():
        try:
            with open(CATALOG_PATH) as f:
                catalog = json.load(f)
            for entry in catalog:
                canonical = entry.get("canonical", "").lower().strip()
                if not canonical:
                    continue
                category = entry.get("category", "other")
                if canonical in library:
                    # Catalog takes priority -- merge carefully
                    existing = library[canonical]
                    # Keep catalog synonyms + our synonyms (deduped)
                    cat_synonyms = entry.get("synonyms", [])
                    our_synonyms = existing.get("synonyms", [])
                    merged_synonyms = list(dict.fromkeys(cat_synonyms + our_synonyms))
                    existing["synonyms"] = merged_synonyms
                    # Catalog emoji takes priority if present
                    if entry.get("emoji"):
                        existing["emoji"] = entry["emoji"]
                else:
                    # New entry from catalog
                    library[canonical] = {
                        "canonical": canonical,
                        "category": category,
                        "emoji": entry.get("emoji", ""),
                        "synonyms": entry.get("synonyms", []),
                        "valid_units": CATEGORY_UNITS.get(category, CATEGORY_UNITS["other"]),
                        "expiry_days": get_expiry_days(canonical, category),
                        "default_location": CATEGORY_LOCATIONS.get(category, "pantry"),
                        "icon_slug": get_icon_slug(canonical),
                    }
            print(f"Merged {len(catalog)} catalog entries")
        except (json.JSONDecodeError, KeyError) as e:
            print(f"Warning: Could not read catalog: {e}")
    else:
        print("No existing catalog found, using hardcoded items only")

    # Step 3: Sort by canonical name and return
    return sorted(library.values(), key=lambda x: x["canonical"])


def main() -> None:
    library = build_library()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(library, f, indent=2, ensure_ascii=False)
    print(f"Wrote {len(library)} entries to {OUTPUT_PATH}")

    # Verify
    icon_count = sum(1 for item in library if item["icon_slug"])
    categories = {item["category"] for item in library}
    print(f"  Icons assigned: {icon_count}")
    print(f"  Categories: {', '.join(sorted(categories))}")


if __name__ == "__main__":
    main()
