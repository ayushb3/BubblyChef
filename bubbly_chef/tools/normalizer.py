"""Food name normalization with synonyms mapping."""

import re
from abc import ABC, abstractmethod

from bubbly_chef.models.pantry import FoodCategory


class Normalizer(ABC):
    """Abstract base class for name normalization."""

    @abstractmethod
    def normalize(self, name: str) -> str:
        """Normalize a food name to canonical form."""
        pass

    @abstractmethod
    def get_category(self, name: str) -> FoodCategory:
        """Determine food category from name."""
        pass


class FoodNormalizer(Normalizer):
    """
    Food name normalizer with synonym mapping and category detection.

    Uses deterministic rules for normalization, avoiding LLM calls
    for common operations.
    """

    # Synonym mappings: normalized_name -> [synonyms]
    SYNONYMS: dict[str, list[str]] = {
        # Dairy
        "milk": [
            "whole milk",
            "2% milk",
            "skim milk",
            "fat free milk",
            "1% milk",
            "dairy milk",
        ],
        "eggs": ["egg", "dozen eggs", "large eggs", "organic eggs", "free range eggs"],
        "butter": ["unsalted butter", "salted butter", "sweet cream butter"],
        "cheese": [
            "cheddar",
            "mozzarella",
            "parmesan",
            "swiss cheese",
            "american cheese",
        ],
        "yogurt": ["greek yogurt", "plain yogurt", "vanilla yogurt"],
        "cream": ["heavy cream", "whipping cream", "half and half", "half & half"],
        # Produce
        "apple": [
            "apples",
            "red apple",
            "green apple",
            "gala apple",
            "fuji apple",
            "honeycrisp",
        ],
        "banana": ["bananas", "ripe banana", "banana bunch"],
        "orange": ["oranges", "navel orange", "valencia orange"],
        "lemon": ["lemons", "fresh lemon"],
        "lime": ["limes", "fresh lime"],
        "tomato": [
            "tomatoes",
            "roma tomato",
            "cherry tomatoes",
            "grape tomatoes",
            "beefsteak",
        ],
        "onion": ["onions", "yellow onion", "red onion", "white onion", "sweet onion"],
        "garlic": ["garlic cloves", "fresh garlic", "garlic bulb", "cloves of garlic"],
        "potato": [
            "potatoes",
            "russet potato",
            "yukon gold",
            "red potato",
            "sweet potato",
        ],
        "carrot": ["carrots", "baby carrots"],
        "celery": ["celery stalks", "celery bunch"],
        "lettuce": [
            "romaine",
            "iceberg lettuce",
            "butter lettuce",
            "mixed greens",
            "salad greens",
        ],
        "spinach": ["baby spinach", "fresh spinach"],
        "broccoli": ["broccoli florets", "fresh broccoli"],
        "bell pepper": ["bell peppers", "red pepper", "green pepper", "yellow pepper"],
        "cucumber": ["cucumbers", "english cucumber"],
        "avocado": ["avocados", "ripe avocado", "hass avocado"],
        # Meat
        "chicken breast": [
            "chicken breasts",
            "boneless chicken",
            "skinless chicken breast",
        ],
        "ground beef": [
            "beef mince",
            "minced beef",
            "hamburger meat",
            "lean ground beef",
        ],
        "bacon": ["bacon strips", "turkey bacon", "thick cut bacon"],
        "pork chop": ["pork chops", "bone-in pork chop"],
        "steak": ["beef steak", "ribeye", "sirloin", "ny strip", "filet mignon"],
        # Pantry staples
        "flour": [
            "all purpose flour",
            "ap flour",
            "white flour",
            "bread flour",
            "whole wheat flour",
        ],
        "sugar": ["white sugar", "granulated sugar", "cane sugar"],
        "brown sugar": ["light brown sugar", "dark brown sugar"],
        "salt": ["table salt", "kosher salt", "sea salt", "iodized salt"],
        "black pepper": ["pepper", "ground pepper", "peppercorns"],
        "olive oil": ["extra virgin olive oil", "evoo", "virgin olive oil"],
        "vegetable oil": ["cooking oil", "canola oil", "corn oil"],
        "rice": [
            "white rice",
            "long grain rice",
            "jasmine rice",
            "basmati rice",
            "brown rice",
        ],
        "pasta": [
            "spaghetti",
            "penne",
            "linguine",
            "fettuccine",
            "macaroni",
            "noodles",
        ],
        "bread": ["loaf of bread", "white bread", "wheat bread", "sliced bread"],
        # Canned goods
        "canned tomatoes": ["diced tomatoes", "crushed tomatoes", "tomato sauce"],
        "chicken broth": ["chicken stock", "chicken bouillon"],
        "beef broth": ["beef stock", "beef bouillon"],
        "canned beans": [
            "black beans",
            "kidney beans",
            "pinto beans",
            "chickpeas",
            "garbanzo beans",
        ],
        "canned tuna": ["tuna fish", "chunk light tuna", "albacore tuna"],
        # Condiments
        "ketchup": ["catsup", "tomato ketchup"],
        "mustard": ["yellow mustard", "dijon mustard", "spicy mustard"],
        "mayonnaise": ["mayo", "hellmanns", "miracle whip"],
        "soy sauce": ["shoyu", "tamari"],
        "hot sauce": ["sriracha", "tabasco", "franks red hot"],
    }

    # Category keyword mappings
    CATEGORY_KEYWORDS: dict[FoodCategory, list[str]] = {
        FoodCategory.PRODUCE: [
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
            "salad",
            "herb",
            "berry",
            "grape",
            "melon",
            "peach",
            "pear",
            "plum",
            "mango",
            "kiwi",
            "pineapple",
        ],
        FoodCategory.DAIRY: [
            "milk",
            "cheese",
            "yogurt",
            "butter",
            "cream",
            "cottage",
            "sour cream",
            "cream cheese",
            "ricotta",
            "mozzarella",
            "cheddar",
            "parmesan",
            "feta",
        ],
        FoodCategory.MEAT: [
            "chicken",
            "beef",
            "pork",
            "lamb",
            "turkey",
            "duck",
            "steak",
            "ground",
            "bacon",
            "sausage",
            "ham",
            "meatball",
            "roast",
            "chop",
            "rib",
            "wing",
        ],
        FoodCategory.SEAFOOD: [
            "fish",
            "salmon",
            "tuna",
            "shrimp",
            "crab",
            "lobster",
            "scallop",
            "cod",
            "tilapia",
            "halibut",
            "trout",
            "sardine",
            "anchovy",
            "clam",
            "mussel",
            "oyster",
            "squid",
            "calamari",
            "octopus",
        ],
        FoodCategory.FROZEN: [
            "frozen",
            "ice cream",
            "popsicle",
            "frozen pizza",
            "frozen meal",
            "frozen vegetable",
            "frozen fruit",
        ],
        FoodCategory.CANNED: [
            "canned",
            "can of",
            "tin of",
            "preserved",
            "jarred",
        ],
        FoodCategory.DRY_GOODS: [
            "flour",
            "sugar",
            "rice",
            "pasta",
            "cereal",
            "oat",
            "grain",
            "bean",
            "lentil",
            "quinoa",
            "couscous",
            "bread",
            "cracker",
            "chip",
        ],
        FoodCategory.CONDIMENTS: [
            "sauce",
            "ketchup",
            "mustard",
            "mayo",
            "dressing",
            "vinegar",
            "oil",
            "soy sauce",
            "hot sauce",
            "bbq",
            "relish",
            "pickle",
        ],
        FoodCategory.BEVERAGES: [
            "water",
            "juice",
            "soda",
            "coffee",
            "tea",
            "beer",
            "wine",
            "drink",
            "beverage",
            "cola",
            "sprite",
            "milk",  # milk can be beverage or dairy
        ],
        FoodCategory.SNACKS: [
            "chip",
            "cracker",
            "cookie",
            "candy",
            "chocolate",
            "popcorn",
            "pretzel",
            "nuts",
            "granola bar",
            "snack",
        ],
        FoodCategory.BAKERY: [
            "bread",
            "bagel",
            "muffin",
            "croissant",
            "donut",
            "cake",
            "pie",
            "pastry",
            "bun",
            "roll",
        ],
    }

    def __init__(self) -> None:
        # Build reverse lookup: synonym -> normalized
        self._reverse_synonyms: dict[str, str] = {}
        for normalized, synonyms in self.SYNONYMS.items():
            self._reverse_synonyms[normalized.lower()] = normalized
            for syn in synonyms:
                self._reverse_synonyms[syn.lower()] = normalized

    def normalize(self, name: str) -> str:
        """
        Normalize a food name to canonical form.

        - Lowercases and strips whitespace
        - Removes common prefixes (organic, fresh, etc.)
        - Maps synonyms to canonical names
        - Singularizes common plurals
        """
        if not name:
            return name

        # Clean up
        cleaned = name.lower().strip()

        # Remove common non-essential prefixes
        prefixes_to_remove = [
            "organic ",
            "fresh ",
            "raw ",
            "natural ",
            "premium ",
            "quality ",
            "best ",
            "finest ",
            "store brand ",
            "generic ",
            "local ",
        ]
        for prefix in prefixes_to_remove:
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix) :]

        # Remove quantity words at the start
        cleaned = re.sub(
            r"^\d+\s*(?:lb|lbs|oz|g|kg|ml|l|pk|pack|ct|count|pc|pcs|piece|pieces)?\s*(?:of\s+)?",
            "",
            cleaned,
        )

        # Check synonym lookup
        if cleaned in self._reverse_synonyms:
            return self._reverse_synonyms[cleaned]

        # Try partial match for longer descriptions
        for synonym, normalized in self._reverse_synonyms.items():
            if synonym in cleaned or cleaned in synonym:
                return normalized

        # No match found, return cleaned version
        return cleaned

    def get_category(self, name: str) -> FoodCategory:
        """Determine food category from name using keyword matching."""
        if not name:
            return FoodCategory.OTHER

        name_lower = name.lower()

        # Check each category's keywords
        scores: dict[FoodCategory, int] = {}
        for category, keywords in self.CATEGORY_KEYWORDS.items():
            score = sum(1 for kw in keywords if kw in name_lower)
            if score > 0:
                scores[category] = score

        if not scores:
            return FoodCategory.OTHER

        # Return category with highest score
        return max(scores, key=lambda k: scores[k])

    def are_similar(self, name1: str, name2: str) -> bool:
        """Check if two food names are similar (same canonical form)."""
        return self.normalize(name1) == self.normalize(name2)


# Singleton instance
_normalizer: FoodNormalizer | None = None


def get_normalizer() -> FoodNormalizer:
    """Get the singleton normalizer instance."""
    global _normalizer
    if _normalizer is None:
        _normalizer = FoodNormalizer()
    return _normalizer
