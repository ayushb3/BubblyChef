"""Pantry-related Pydantic models."""

from datetime import date, datetime
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, computed_field


class Category(str, Enum):
    """Food categories."""

    PRODUCE = "produce"
    DAIRY = "dairy"
    MEAT = "meat"
    SEAFOOD = "seafood"
    FROZEN = "frozen"
    PANTRY = "pantry"  # Canned, dry goods, etc.
    BEVERAGES = "beverages"
    CONDIMENTS = "condiments"
    BAKERY = "bakery"
    SNACKS = "snacks"
    OTHER = "other"


class Location(str, Enum):
    """Storage locations."""

    FRIDGE = "fridge"
    FREEZER = "freezer"
    PANTRY = "pantry"
    COUNTER = "counter"


class PantryItem(BaseModel):
    """A single item in the pantry."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str = Field(description="Display name")
    name_normalized: str = Field(default="", description="Normalized name for matching")
    category: Category = Field(default=Category.OTHER)
    location: Location = Field(default=Location.PANTRY)
    quantity: float = Field(default=1.0, ge=0)
    unit: str = Field(default="item")
    expiry_date: date | None = Field(default=None)
    added_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    @computed_field
    @property
    def days_until_expiry(self) -> int | None:
        """Days until this item expires."""
        if not self.expiry_date:
            return None
        return (self.expiry_date - date.today()).days

    @computed_field
    @property
    def is_expired(self) -> bool:
        """Whether this item is expired."""
        if self.days_until_expiry is None:
            return False
        return self.days_until_expiry < 0

    @computed_field
    @property
    def is_expiring_soon(self) -> bool:
        """Whether this item expires within 3 days."""
        if self.days_until_expiry is None:
            return False
        return 0 <= self.days_until_expiry <= 3


class PantryItemCreate(BaseModel):
    """Request model for creating a pantry item."""

    name: str
    quantity: float = 1.0
    unit: str = "item"
    category: Category | None = None  # Auto-detect if not provided
    location: Location | None = None  # Default based on category
    expiry_date: date | None = None  # Auto-estimate if not provided


class PantryItemUpdate(BaseModel):
    """Request model for updating a pantry item."""

    name: str | None = None
    quantity: float | None = None
    unit: str | None = None
    category: Category | None = None
    location: Location | None = None
    expiry_date: date | None = None


# Keep old names for backwards compatibility
FoodCategory = Category
StorageLocation = Location
