"""Pantry-related Pydantic models."""

from datetime import UTC, date, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, computed_field


class FoodCategory(StrEnum):
    """Food categories for expiry heuristics and organization."""

    PRODUCE = "produce"
    DAIRY = "dairy"
    MEAT = "meat"
    SEAFOOD = "seafood"
    FROZEN = "frozen"
    CANNED = "canned"
    DRY_GOODS = "dry_goods"
    CONDIMENTS = "condiments"
    BEVERAGES = "beverages"
    SNACKS = "snacks"
    BAKERY = "bakery"
    OTHER = "other"


class StorageLocation(StrEnum):
    """Storage locations in a typical kitchen."""

    FRIDGE = "fridge"
    FREEZER = "freezer"
    PANTRY = "pantry"
    COUNTER = "counter"


class ActionType(StrEnum):
    """Types of pantry actions."""

    ADD = "add"
    UPDATE = "update"
    REMOVE = "remove"
    USE = "use"  # Partial consumption


class PantryItem(BaseModel):
    """Represents a single item in the pantry."""

    id: UUID = Field(default_factory=uuid4, description="Unique item identifier")
    client_item_key: str | None = Field(
        default=None,
        description="Deterministic key for proposals (category:name), DB IDs assigned on apply",
    )
    name: str = Field(description="Normalized item name")
    original_name: str | None = Field(
        default=None, description="Original name before normalization"
    )
    category: FoodCategory = Field(default=FoodCategory.OTHER)
    storage_location: StorageLocation = Field(default=StorageLocation.PANTRY)
    quantity: float = Field(default=1.0, ge=0)
    unit: str = Field(default="item", description="Unit of measurement")
    brand: str | None = Field(default=None)
    barcode: str | None = Field(default=None, description="EAN/UPC barcode if available")
    purchase_date: date | None = Field(default=None)
    expiry_date: date | None = Field(default=None)
    estimated_expiry: bool = Field(
        default=False, description="True if expiry_date was estimated, not from label"
    )
    notes: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @computed_field  # type: ignore[prop-decorator]
    @property
    def location(self) -> StorageLocation:
        """Alias for storage_location (backward compatibility)."""
        return self.storage_location

    @computed_field  # type: ignore[prop-decorator]
    @property
    def name_normalized(self) -> str:
        """Return normalized name for matching."""
        return self.name.lower().strip()

    @computed_field  # type: ignore[prop-decorator]
    @property
    def added_at(self) -> datetime:
        """Alias for created_at (frontend compatibility)."""
        return self.created_at

    @computed_field  # type: ignore[prop-decorator]
    @property
    def days_until_expiry(self) -> int | None:
        """Calculate days until expiry."""
        if self.expiry_date is None:
            return None
        return (self.expiry_date - date.today()).days

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_expiring_soon(self) -> bool:
        """Check if item expires within 3 days."""
        days = self.days_until_expiry
        return days is not None and 0 <= days <= 3

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_expired(self) -> bool:
        """Check if item is expired."""
        days = self.days_until_expiry
        return days is not None and days < 0

    def generate_client_key(self) -> str:
        """Generate a deterministic client_item_key from category and normalized name."""
        normalized_name = self.name.lower().strip().replace(" ", "_")
        return f"{self.category.value}:{normalized_name}"


class PantryUpsertAction(BaseModel):
    """An action to add or update a pantry item."""

    action_type: ActionType = Field(description="Type of action")
    item: PantryItem = Field(description="The item to upsert")
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence for this specific action")
    reasoning: str | None = Field(default=None, description="Why this action was proposed")
    match_existing_id: UUID | None = Field(
        default=None,
        description="If UPDATE/REMOVE/USE, the ID of the existing item to modify",
    )


class PantryAction(BaseModel):
    """Alias for PantryUpsertAction for backwards compatibility."""

    action_type: ActionType
    item: PantryItem
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str | None = None
    match_existing_id: UUID | None = None


class PantryProposal(BaseModel):
    """A proposal containing multiple pantry actions."""

    actions: list[PantryUpsertAction] = Field(
        default_factory=list, description="List of proposed pantry actions"
    )
    source_text: str | None = Field(
        default=None, description="Original text that generated this proposal"
    )
    dedup_applied: bool = Field(default=False, description="Whether deduplication was applied")
    normalization_applied: bool = Field(
        default=False, description="Whether name normalization was applied"
    )
