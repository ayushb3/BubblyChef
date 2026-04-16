"""Expiry date heuristics based on food category."""

from datetime import date, timedelta

from bubbly_chef.models.pantry import FoodCategory, StorageLocation


class ExpiryHeuristics:
    """
    Deterministic expiry date estimation based on food category and storage.

    Provides reasonable default expiry estimates when no expiry date is
    available from the product or receipt.
    """

    # Default shelf life in days by category and storage location
    # Format: (category, storage_location) -> days
    SHELF_LIFE_DAYS: dict[tuple[FoodCategory, StorageLocation], int] = {
        # Produce - short shelf life
        (FoodCategory.PRODUCE, StorageLocation.FRIDGE): 7,
        (FoodCategory.PRODUCE, StorageLocation.COUNTER): 5,
        (FoodCategory.PRODUCE, StorageLocation.FREEZER): 180,
        (FoodCategory.PRODUCE, StorageLocation.PANTRY): 5,
        # Dairy - refrigerated
        (FoodCategory.DAIRY, StorageLocation.FRIDGE): 14,
        (FoodCategory.DAIRY, StorageLocation.FREEZER): 90,
        (FoodCategory.DAIRY, StorageLocation.COUNTER): 1,  # Don't leave dairy out!
        (FoodCategory.DAIRY, StorageLocation.PANTRY): 1,
        # Meat - very short unless frozen
        (FoodCategory.MEAT, StorageLocation.FRIDGE): 3,
        (FoodCategory.MEAT, StorageLocation.FREEZER): 120,
        (FoodCategory.MEAT, StorageLocation.COUNTER): 0,  # Never!
        (FoodCategory.MEAT, StorageLocation.PANTRY): 0,
        # Seafood - shortest
        (FoodCategory.SEAFOOD, StorageLocation.FRIDGE): 2,
        (FoodCategory.SEAFOOD, StorageLocation.FREEZER): 90,
        (FoodCategory.SEAFOOD, StorageLocation.COUNTER): 0,
        (FoodCategory.SEAFOOD, StorageLocation.PANTRY): 0,
        # Frozen - long life in freezer
        (FoodCategory.FROZEN, StorageLocation.FREEZER): 180,
        (FoodCategory.FROZEN, StorageLocation.FRIDGE): 3,
        (FoodCategory.FROZEN, StorageLocation.COUNTER): 0,
        (FoodCategory.FROZEN, StorageLocation.PANTRY): 0,
        # Canned - very long shelf life
        (FoodCategory.CANNED, StorageLocation.PANTRY): 730,  # 2 years
        (FoodCategory.CANNED, StorageLocation.FRIDGE): 730,
        (FoodCategory.CANNED, StorageLocation.FREEZER): 730,
        (FoodCategory.CANNED, StorageLocation.COUNTER): 730,
        # Dry goods - long shelf life
        (FoodCategory.DRY_GOODS, StorageLocation.PANTRY): 365,
        (FoodCategory.DRY_GOODS, StorageLocation.FRIDGE): 365,
        (FoodCategory.DRY_GOODS, StorageLocation.FREEZER): 365,
        (FoodCategory.DRY_GOODS, StorageLocation.COUNTER): 365,
        # Condiments - moderate to long
        (FoodCategory.CONDIMENTS, StorageLocation.FRIDGE): 180,
        (FoodCategory.CONDIMENTS, StorageLocation.PANTRY): 90,
        (FoodCategory.CONDIMENTS, StorageLocation.FREEZER): 365,
        (FoodCategory.CONDIMENTS, StorageLocation.COUNTER): 30,
        # Beverages
        (FoodCategory.BEVERAGES, StorageLocation.FRIDGE): 14,
        (FoodCategory.BEVERAGES, StorageLocation.PANTRY): 180,
        (FoodCategory.BEVERAGES, StorageLocation.FREEZER): 365,
        (FoodCategory.BEVERAGES, StorageLocation.COUNTER): 7,
        # Snacks
        (FoodCategory.SNACKS, StorageLocation.PANTRY): 90,
        (FoodCategory.SNACKS, StorageLocation.FRIDGE): 90,
        (FoodCategory.SNACKS, StorageLocation.FREEZER): 180,
        (FoodCategory.SNACKS, StorageLocation.COUNTER): 30,
        # Bakery - short shelf life
        (FoodCategory.BAKERY, StorageLocation.COUNTER): 5,
        (FoodCategory.BAKERY, StorageLocation.PANTRY): 7,
        (FoodCategory.BAKERY, StorageLocation.FRIDGE): 10,
        (FoodCategory.BAKERY, StorageLocation.FREEZER): 90,
        # Other - conservative estimate
        (FoodCategory.OTHER, StorageLocation.FRIDGE): 7,
        (FoodCategory.OTHER, StorageLocation.PANTRY): 30,
        (FoodCategory.OTHER, StorageLocation.FREEZER): 90,
        (FoodCategory.OTHER, StorageLocation.COUNTER): 7,
    }

    # Specific item overrides (normalized name -> days in default storage)
    SPECIFIC_ITEMS: dict[str, int] = {
        "milk": 10,
        "eggs": 21,
        "bread": 7,
        "bananas": 5,
        "avocado": 4,
        "lettuce": 5,
        "spinach": 5,
        "ground beef": 2,
        "chicken breast": 2,
        "yogurt": 14,
        "butter": 30,
        "cheese": 21,
    }

    # Default storage location by category
    DEFAULT_STORAGE: dict[FoodCategory, StorageLocation] = {
        FoodCategory.PRODUCE: StorageLocation.FRIDGE,
        FoodCategory.DAIRY: StorageLocation.FRIDGE,
        FoodCategory.MEAT: StorageLocation.FRIDGE,
        FoodCategory.SEAFOOD: StorageLocation.FRIDGE,
        FoodCategory.FROZEN: StorageLocation.FREEZER,
        FoodCategory.CANNED: StorageLocation.PANTRY,
        FoodCategory.DRY_GOODS: StorageLocation.PANTRY,
        FoodCategory.CONDIMENTS: StorageLocation.FRIDGE,
        FoodCategory.BEVERAGES: StorageLocation.FRIDGE,
        FoodCategory.SNACKS: StorageLocation.PANTRY,
        FoodCategory.BAKERY: StorageLocation.COUNTER,
        FoodCategory.OTHER: StorageLocation.PANTRY,
    }

    def estimate_expiry(
        self,
        category: FoodCategory,
        storage: StorageLocation | None = None,
        name: str | None = None,
        purchase_date: date | None = None,
    ) -> tuple[date, bool]:
        """
        Estimate expiry date for a food item.

        Args:
            category: Food category
            storage: Storage location (defaults based on category if not provided)
            name: Optional item name for specific overrides
            purchase_date: Purchase date (defaults to today)

        Returns:
            Tuple of (estimated_expiry_date, is_estimated)
            is_estimated is always True since this is a heuristic
        """
        if purchase_date is None:
            purchase_date = date.today()

        if storage is None:
            storage = self.get_default_storage(category)

        # Check for specific item override
        if name:
            name_lower = name.lower()
            for item_name, days in self.SPECIFIC_ITEMS.items():
                if item_name in name_lower:
                    expiry = purchase_date + timedelta(days=days)
                    return expiry, True

        # Use category/storage lookup
        key = (category, storage)
        days = self.SHELF_LIFE_DAYS.get(key, 30)  # Default 30 days

        expiry = purchase_date + timedelta(days=days)
        return expiry, True

    def get_default_storage(self, category: FoodCategory) -> StorageLocation:
        """Get the default storage location for a category."""
        return self.DEFAULT_STORAGE.get(category, StorageLocation.PANTRY)

    def get_expiry_status(self, expiry_date: date | None) -> str:
        """
        Get expiry status string.

        Returns: "expired", "expiring_soon" (within 3 days), "fresh", or "unknown"
        """
        if expiry_date is None:
            return "unknown"

        today = date.today()
        days_until = (expiry_date - today).days

        if days_until < 0:
            return "expired"
        elif days_until <= 3:
            return "expiring_soon"
        else:
            return "fresh"

    def days_until_expiry(self, expiry_date: date | None) -> int | None:
        """Get number of days until expiry, negative if expired."""
        if expiry_date is None:
            return None
        return (expiry_date - date.today()).days


# Singleton instance
_expiry_heuristics: ExpiryHeuristics | None = None


def get_expiry_heuristics() -> ExpiryHeuristics:
    """Get the singleton expiry heuristics instance."""
    global _expiry_heuristics
    if _expiry_heuristics is None:
        _expiry_heuristics = ExpiryHeuristics()
    return _expiry_heuristics
