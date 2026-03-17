"""Expiry date estimation utilities."""

from datetime import date, timedelta

# Default expiry days by category
CATEGORY_DEFAULTS: dict[str, int] = {
    "produce": 7,
    "dairy": 14,
    "meat": 3,
    "seafood": 2,
    "frozen": 90,
    "pantry": 365,
    "beverages": 30,
    "condiments": 180,
    "bakery": 5,
    "snacks": 60,
    "other": 14,
}

# Specific item overrides (days)
ITEM_OVERRIDES: dict[str, int] = {
    # Dairy
    "milk": 10,
    "eggs": 21,
    "butter": 30,
    "yogurt": 14,
    "cheese": 21,
    "cream": 14,
    # Produce - shorter shelf life
    "banana": 5,
    "avocado": 4,
    "berries": 3,
    "lettuce": 5,
    "spinach": 5,
    "mushroom": 5,
    # Produce - longer shelf life
    "apple": 21,
    "orange": 14,
    "lemon": 21,
    "potato": 21,
    "onion": 30,
    "garlic": 30,
    "carrot": 21,
    # Meat
    "chicken": 2,
    "ground beef": 2,
    "steak": 3,
    "bacon": 7,
    # Bakery
    "bread": 7,
}

# Default location by category
CATEGORY_LOCATIONS: dict[str, str] = {
    "produce": "fridge",
    "dairy": "fridge",
    "meat": "fridge",
    "seafood": "fridge",
    "frozen": "freezer",
    "pantry": "pantry",
    "beverages": "fridge",
    "condiments": "fridge",
    "bakery": "counter",
    "snacks": "pantry",
    "other": "pantry",
}

# Location modifiers (multiplier for expiry)
LOCATION_MODIFIERS: dict[str, float] = {
    "fridge": 1.0,
    "freezer": 6.0,  # Frozen items last much longer
    "pantry": 1.0,
    "counter": 0.7,  # Counter items expire faster
}


def estimate_expiry_days(
    name: str,
    category: str,
    location: str,
) -> int | None:
    """
    Estimate days until expiry for an item.

    Args:
        name: Normalized item name
        category: Food category
        location: Storage location

    Returns:
        Estimated days until expiry, or None if unknown
    """
    # Check for specific item override
    name_lower = name.lower()
    base_days = None

    for item_name, days in ITEM_OVERRIDES.items():
        if item_name in name_lower:
            base_days = days
            break

    # Fall back to category default
    if base_days is None:
        base_days = CATEGORY_DEFAULTS.get(category, CATEGORY_DEFAULTS["other"])

    # Apply location modifier
    modifier = LOCATION_MODIFIERS.get(location, 1.0)
    estimated = int(base_days * modifier)

    return estimated


def get_default_location(category: str) -> str:
    """Get the default storage location for a category."""
    return CATEGORY_LOCATIONS.get(category, "pantry")


def calculate_expiry_date(
    name: str,
    category: str,
    location: str,
) -> date | None:
    """
    Calculate expiry date for an item.

    Returns date object or None.
    """
    days = estimate_expiry_days(name, category, location)
    if days is None:
        return None
    return date.today() + timedelta(days=days)
