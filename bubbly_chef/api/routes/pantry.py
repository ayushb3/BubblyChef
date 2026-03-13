"""Pantry query endpoints."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from bubbly_chef.models.pantry import PantryItem, FoodCategory, StorageLocation
from bubbly_chef.repository.sqlite import get_repository
from bubbly_chef.tools.expiry import get_expiry_heuristics

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pantry", tags=["Pantry"])


class PantryListResponse(BaseModel):
    """Response for pantry list endpoint."""

    items: list[PantryItem]
    total_count: int
    expiring_soon_count: int
    expired_count: int


class PantryItemResponse(BaseModel):
    """Response for single pantry item."""

    item: PantryItem
    expiry_status: str
    days_until_expiry: int | None


@router.get(
    "",
    response_model=PantryListResponse,
    summary="List all pantry items",
)
async def list_pantry(
    category: FoodCategory | None = Query(None, description="Filter by category"),
    storage: StorageLocation | None = Query(
        None, description="Filter by storage location"
    ),
    search: str | None = Query(None, description="Search by name"),
) -> PantryListResponse:
    """
    List all pantry items with optional filtering.

    Returns items with counts of expiring/expired items.
    """
    repo = await get_repository()
    expiry = get_expiry_heuristics()

    # Get items with optional filters
    if search:
        items = await repo.find_pantry_items(name=search)
    elif category or storage:
        items = await repo.find_pantry_items(
            category=category.value if category else None,
            storage_location=storage.value if storage else None,
        )
    else:
        items = await repo.get_all_pantry_items()

    # Count expiry statuses
    expiring_soon = 0
    expired = 0

    for item in items:
        status = expiry.get_expiry_status(item.expiry_date)
        if status == "expiring_soon":
            expiring_soon += 1
        elif status == "expired":
            expired += 1

    return PantryListResponse(
        items=items,
        total_count=len(items),
        expiring_soon_count=expiring_soon,
        expired_count=expired,
    )


@router.get(
    "/expiring",
    response_model=PantryListResponse,
    summary="List pantry items expiring soon",
)
async def list_expiring_items(
    days: int = Query(default=7, ge=1, le=365, description="Days until expiration"),
) -> PantryListResponse:
    """
    Get pantry items expiring within the specified number of days.

    - **days**: Number of days to look ahead (default: 7)
    """
    logger.info(f"Fetching expiring items within {days} days")

    repo = await get_repository()
    expiry = get_expiry_heuristics()

    all_items = await repo.get_all_pantry_items()
    now = datetime.now(timezone.utc).date()
    threshold = (datetime.now(timezone.utc) + timedelta(days=days)).date()

    # Filter items that expire within the threshold and are not already expired
    expiring_items = [
        item for item in all_items
        if item.expiry_date and now <= item.expiry_date <= threshold
    ]

    # Sort by expiry date (soonest first)
    expiring_items.sort(key=lambda x: x.expiry_date or datetime.max.date())

    # Count expired items separately
    expired_items = [
        item for item in all_items
        if item.expiry_date and item.expiry_date < now
    ]

    logger.info(f"Found {len(expiring_items)} items expiring within {days} days")

    return PantryListResponse(
        items=expiring_items,
        total_count=len(expiring_items),
        expiring_soon_count=len(expiring_items),
        expired_count=len(expired_items),
    )


@router.get(
    "/{item_id}",
    response_model=PantryItemResponse,
    summary="Get a single pantry item",
)
async def get_pantry_item(item_id: UUID) -> PantryItemResponse:
    """
    Get a single pantry item by ID.

    Returns the item with expiry status information.
    """
    repo = await get_repository()
    expiry = get_expiry_heuristics()

    item = await repo.get_pantry_item(item_id)

    if not item:
        raise HTTPException(status_code=404, detail="Pantry item not found")

    return PantryItemResponse(
        item=item,
        expiry_status=expiry.get_expiry_status(item.expiry_date),
        days_until_expiry=expiry.days_until_expiry(item.expiry_date),
    )


@router.delete(
    "/{item_id}",
    summary="Delete a pantry item",
)
async def delete_pantry_item(item_id: UUID) -> dict[str, Any]:
    """
    Delete a pantry item by ID.

    This is a direct mutation endpoint for manual item removal.
    """
    repo = await get_repository()

    deleted = await repo.delete_pantry_item(item_id)

    if not deleted:
        raise HTTPException(status_code=404, detail="Pantry item not found")

    return {"success": True, "deleted_id": str(item_id)}
