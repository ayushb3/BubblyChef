"""Default quantity and unit inference for pantry items."""

from bubbly_chef.models.pantry import FoodCategory

# Common default quantities for items when not specified
DEFAULT_QUANTITIES = {
    # Dairy
    "milk": {"quantity": 1, "unit": "gallon"},
    "eggs": {"quantity": 1, "unit": "dozen"},
    "egg": {"quantity": 1, "unit": "dozen"},
    "butter": {"quantity": 1, "unit": "lb"},
    "cheese": {"quantity": 1, "unit": "lb"},
    "yogurt": {"quantity": 1, "unit": "container"},
    "cream": {"quantity": 1, "unit": "pint"},

    # Produce
    "bananas": {"quantity": 1, "unit": "bunch"},
    "banana": {"quantity": 1, "unit": "bunch"},
    "lettuce": {"quantity": 1, "unit": "head"},
    "tomatoes": {"quantity": 1, "unit": "lb"},
    "tomato": {"quantity": 1, "unit": "lb"},
    "potatoes": {"quantity": 1, "unit": "lb"},
    "potato": {"quantity": 1, "unit": "lb"},
    "onions": {"quantity": 1, "unit": "lb"},
    "onion": {"quantity": 1, "unit": "lb"},
    "carrots": {"quantity": 1, "unit": "lb"},
    "carrot": {"quantity": 1, "unit": "lb"},

    # Meat/Seafood
    "chicken": {"quantity": 1, "unit": "lb"},
    "beef": {"quantity": 1, "unit": "lb"},
    "pork": {"quantity": 1, "unit": "lb"},
    "fish": {"quantity": 1, "unit": "lb"},
    "salmon": {"quantity": 1, "unit": "lb"},
    "tuna": {"quantity": 1, "unit": "can"},
    "shrimp": {"quantity": 1, "unit": "lb"},

    # Bakery
    "bread": {"quantity": 1, "unit": "loaf"},
    "bagels": {"quantity": 1, "unit": "package"},
    "bagel": {"quantity": 1, "unit": "package"},
    "rolls": {"quantity": 1, "unit": "package"},
    "tortillas": {"quantity": 1, "unit": "package"},

    # Beverages
    "juice": {"quantity": 1, "unit": "bottle"},
    "soda": {"quantity": 1, "unit": "bottle"},
    "water": {"quantity": 1, "unit": "bottle"},
    "wine": {"quantity": 1, "unit": "bottle"},
    "beer": {"quantity": 1, "unit": "bottle"},

    # Condiments
    "ketchup": {"quantity": 1, "unit": "bottle"},
    "mustard": {"quantity": 1, "unit": "bottle"},
    "mayo": {"quantity": 1, "unit": "jar"},
    "mayonnaise": {"quantity": 1, "unit": "jar"},
    "hot sauce": {"quantity": 1, "unit": "bottle"},

    # Frozen
    "ice cream": {"quantity": 1, "unit": "pint"},
    "frozen": {"quantity": 1, "unit": "package"},

    # Snacks/Crackers
    "crackers": {"quantity": 1, "unit": "box"},
    "cracker": {"quantity": 1, "unit": "box"},
    "chips": {"quantity": 1, "unit": "bag"},
    "cookies": {"quantity": 1, "unit": "package"},
    "cookie": {"quantity": 1, "unit": "package"},
    "popcorn": {"quantity": 1, "unit": "bag"},
    "pretzels": {"quantity": 1, "unit": "bag"},

    # Default fallback
    "default": {"quantity": 1, "unit": "item"},
}


def get_default_quantity_and_unit(name: str, category: str) -> tuple[float, str]:
    """
    Get smart default quantity and unit for an item.

    Args:
        name: Normalized item name
        category: Item category

    Returns:
        Tuple of (quantity, unit)
    """
    name_lower = name.lower()

    # Check for specific item matches
    for key, defaults in DEFAULT_QUANTITIES.items():
        if key in name_lower:
            return defaults["quantity"], defaults["unit"]

    # Fallback to category-based defaults
    if category == FoodCategory.DAIRY.value:
        return 1, "container"
    elif category == FoodCategory.PRODUCE.value:
        return 1, "lb"
    elif category == FoodCategory.MEAT.value or category == FoodCategory.SEAFOOD.value:
        return 1, "lb"
    elif category == FoodCategory.BAKERY.value:
        return 1, "loaf"
    elif category == FoodCategory.BEVERAGES.value:
        return 1, "bottle"
    elif category == FoodCategory.CONDIMENTS.value:
        return 1, "jar"
    elif category == FoodCategory.FROZEN.value:
        return 1, "package"
    elif category == FoodCategory.SNACKS.value:
        return 1, "package"

    # Ultimate fallback
    return DEFAULT_QUANTITIES["default"]["quantity"], DEFAULT_QUANTITIES["default"]["unit"]
