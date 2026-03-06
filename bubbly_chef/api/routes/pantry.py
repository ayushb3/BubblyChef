"""Pantry CRUD endpoints."""

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from bubbly_chef.models.pantry import (
    PantryItem,
    PantryItemCreate,
    PantryItemUpdate,
    Category,
    Location,
)
from bubbly_chef.repository.sqlite import get_repository
from bubbly_chef.domain.normalizer import normalize_food_name, detect_category
from bubbly_chef.domain.expiry import estimate_expiry_days, get_default_location
from bubbly_chef.logger import get_logger, log_db_operation, log_error

logger = get_logger(__name__)

router = APIRouter(prefix="/pantry", tags=["Pantry"])


class PantryListResponse(BaseModel):
    """Response for pantry list endpoint."""

    items: list[PantryItem]
    total_count: int
    expiring_soon_count: int
    expired_count: int


@router.get("", response_model=PantryListResponse)
async def list_pantry(
    category: Category | None = Query(None, description="Filter by category"),
    location: Location | None = Query(None, description="Filter by storage location"),
    search: str | None = Query(None, description="Search by name"),
) -> PantryListResponse:
    """List all pantry items with optional filtering."""
    repo = await get_repository()

    try:
        # Get items with optional filters
        if search:
            items = await repo.search_pantry_items(search)
            log_db_operation(logger, "search", "pantry_items", len(items), search=search)
        elif category or location:
            items = await repo.get_pantry_items(
                category=category.value if category else None,
                location=location.value if location else None,
            )
            log_db_operation(
                logger,
                "select",
                "pantry_items",
                len(items),
                category=category.value if category else None,
                location=location.value if location else None,
            )
        else:
            items = await repo.get_all_pantry_items()
            log_db_operation(logger, "select", "pantry_items", len(items))

        # Count expiry statuses
        expiring_soon = sum(1 for item in items if item.is_expiring_soon)
        expired = sum(1 for item in items if item.is_expired)

        logger.info(
            f"📦 Listed {len(items)} items "
            f"(expiring: {expiring_soon}, expired: {expired})"
        )

        return PantryListResponse(
            items=items,
            total_count=len(items),
            expiring_soon_count=expiring_soon,
            expired_count=expired,
        )
    except Exception as e:
        log_error(logger, "Failed to list pantry items", e)
        raise


@router.get("/expiring", response_model=list[PantryItem])
async def get_expiring_items(
    days: int = Query(default=3, description="Days until expiry threshold"),
) -> list[PantryItem]:
    """Get items expiring within the specified number of days."""
    repo = await get_repository()
    return await repo.get_expiring_items(days=days)


@router.get("/{item_id}", response_model=PantryItem)
async def get_pantry_item(item_id: str) -> PantryItem:
    """Get a single pantry item by ID."""
    repo = await get_repository()
    item = await repo.get_pantry_item(item_id)

    if not item:
        raise HTTPException(status_code=404, detail="Pantry item not found")

    return item


@router.post("", response_model=PantryItem, status_code=201)
async def create_pantry_item(data: PantryItemCreate) -> PantryItem:
    """
    Create a new pantry item.

    Auto-detects category and estimates expiry if not provided.
    """
    repo = await get_repository()

    try:
        # Normalize the name
        name_normalized = normalize_food_name(data.name)
        logger.debug(f"Normalized '{data.name}' -> '{name_normalized}'")

        # Auto-detect category if not provided
        category = data.category
        if category is None:
            detected = detect_category(name_normalized)
            category = Category(detected) if detected else Category.OTHER
            logger.debug(f"Auto-detected category: {category.value}")

        # Set default location based on category if not provided
        location = data.location
        if location is None:
            default_loc = get_default_location(category.value)
            location = Location(default_loc)
            logger.debug(f"Default location for {category.value}: {location.value}")

        # Estimate expiry if not provided
        expiry_date = data.expiry_date
        if expiry_date is None:
            days = estimate_expiry_days(name_normalized, category.value, location.value)
            if days:
                from datetime import date, timedelta

                expiry_date = date.today() + timedelta(days=days)
                logger.debug(f"Estimated expiry: {expiry_date} ({days} days)")

        # Create the item
        item = PantryItem(
            name=data.name,
            name_normalized=name_normalized,
            category=category,
            location=location,
            quantity=data.quantity,
            unit=data.unit,
            expiry_date=expiry_date,
        )

        result = await repo.add_pantry_item(item)
        log_db_operation(logger, "insert", "pantry_items", 1, item_id=result.id)
        logger.info(
            f"➕ Added pantry item: {result.name} "
            f"({result.quantity} {result.unit}, {result.category.value})"
        )
        return result

    except Exception as e:
        log_error(logger, f"Failed to create pantry item '{data.name}'", e)
        raise


@router.put("/{item_id}", response_model=PantryItem)
async def update_pantry_item(item_id: str, data: PantryItemUpdate) -> PantryItem:
    """Update an existing pantry item."""
    repo = await get_repository()

    try:
        # Get existing item
        item = await repo.get_pantry_item(item_id)
        if not item:
            logger.warning(f"Pantry item not found: {item_id}")
            raise HTTPException(status_code=404, detail="Pantry item not found")

        # Update fields that were provided
        update_data = data.model_dump(exclude_unset=True)

        # Re-normalize name if it changed
        if "name" in update_data:
            update_data["name_normalized"] = normalize_food_name(update_data["name"])
            logger.debug(
                f"Name changed: '{item.name}' -> '{update_data['name']}' "
                f"(normalized: '{update_data['name_normalized']}')"
            )

        update_data["updated_at"] = datetime.utcnow()

        result = await repo.update_pantry_item(item_id, update_data)
        log_db_operation(logger, "update", "pantry_items", 1, item_id=item_id)
        logger.info(f"✏️  Updated pantry item: {result.name} (id={item_id})")
        return result

    except HTTPException:
        raise
    except Exception as e:
        log_error(logger, f"Failed to update pantry item {item_id}", e)
        raise


@router.delete("/{item_id}")
async def delete_pantry_item(item_id: str) -> dict:
    """Delete a pantry item."""
    repo = await get_repository()

    try:
        # Get item name before deletion for logging
        item = await repo.get_pantry_item(item_id)
        item_name = item.name if item else "unknown"

        deleted = await repo.delete_pantry_item(item_id)

        if not deleted:
            logger.warning(f"Pantry item not found for deletion: {item_id}")
            raise HTTPException(status_code=404, detail="Pantry item not found")

        log_db_operation(logger, "delete", "pantry_items", 1, item_id=item_id)
        logger.info(f"🗑️  Deleted pantry item: {item_name} (id={item_id})")
        return {"success": True, "deleted_id": item_id}

    except HTTPException:
        raise
    except Exception as e:
        log_error(logger, f"Failed to delete pantry item {item_id}", e)
        raise
