"""Pantry query endpoints."""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.repository.sqlite import get_repository
from bubbly_chef.tools.expiry import get_expiry_heuristics

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pantry", tags=["Pantry"])


class CreatePantryItemRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    quantity: float = Field(default=1.0, ge=0, le=1_000_000)
    unit: str = "item"
    category: FoodCategory = FoodCategory.OTHER
    storage_location: StorageLocation = StorageLocation.PANTRY
    expiry_date: str | None = None


class UpdatePantryItemRequest(BaseModel):
    name: str | None = None
    quantity: float | None = None
    unit: str | None = None
    category: FoodCategory | None = None
    storage_location: StorageLocation | None = None
    expiry_date: str | None = None


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
    storage: StorageLocation | None = Query(None, description="Filter by storage location"),
    search: str | None = Query(None, description="Search by name"),
) -> PantryListResponse:
    """
    List all pantry items with optional filtering.

    Returns items with counts of expiring/expired items.
    """
    logger.info("GET /pantry", extra={"category": category, "storage": storage, "search": search})
    repo = await get_repository()
    expiry = get_expiry_heuristics()

    # Get items with optional filters
    if search:
        items = await repo.search_pantry_items(search)
    elif category or storage:
        items = await repo.get_pantry_items(
            category=category.value if category else None,
            location=storage.value if storage else None,
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

    all_items = await repo.get_all_pantry_items()
    now = datetime.now(UTC).date()
    threshold = (datetime.now(UTC) + timedelta(days=days)).date()

    # Filter items that expire within the threshold and are not already expired
    expiring_items = [
        item for item in all_items if item.expiry_date and now <= item.expiry_date <= threshold
    ]

    # Sort by expiry date (soonest first)
    expiring_items.sort(key=lambda x: x.expiry_date or datetime.max.date())

    # Count expired items separately
    expired_items = [item for item in all_items if item.expiry_date and item.expiry_date < now]

    logger.info(f"Found {len(expiring_items)} items expiring within {days} days")

    return PantryListResponse(
        items=expiring_items,
        total_count=len(expiring_items),
        expiring_soon_count=len(expiring_items),
        expired_count=len(expired_items),
    )


@router.post(
    "",
    response_model=PantryItem,
    status_code=201,
    summary="Create a pantry item",
)
async def create_pantry_item(
    body: CreatePantryItemRequest
) -> PantryItem:
    """Create a new pantry item directly (no AI workflow)."""
    logger.info("POST /pantry", extra={"item_name": body.name, "category": body.category.value})
    from datetime import date as date_type

    repo = await get_repository()
    expiry = get_expiry_heuristics()

    expiry_date: date_type | None = None
    estimated = False
    if body.expiry_date:
        try:
            expiry_date = date_type.fromisoformat(body.expiry_date)
        except ValueError:
            raise HTTPException(
                status_code=422, detail="Invalid expiry_date format. Use YYYY-MM-DD."
            )
    else:
        expiry_date, estimated = expiry.estimate_expiry(
            body.category, body.storage_location, body.name
        )

    item = PantryItem(
        name=body.name,
        category=body.category,
        storage_location=body.storage_location,
        quantity=body.quantity,
        unit=body.unit,
        expiry_date=expiry_date,
        estimated_expiry=estimated or body.expiry_date is None,
    )
    saved = await repo.add_pantry_item(item)

    # Check milestone decorations after adding an item (best-effort, never fail the request)
    try:
        from bubbly_chef.api.routes.decorations import run_milestone_check
        await run_milestone_check(repo)
    except Exception:
        logger.warning("Milestone check failed after item creation", exc_info=True)

    return saved


@router.put(
    "/{item_id}",
    response_model=PantryItem,
    summary="Update a pantry item",
)
async def update_pantry_item(item_id: UUID, body: UpdatePantryItemRequest) -> PantryItem:
    """Update an existing pantry item by ID."""
    updated_fields = [k for k, v in body.model_dump().items() if v is not None]
    logger.info("PUT /pantry/%s", item_id, extra={"fields": updated_fields})
    from datetime import date as date_type

    repo = await get_repository()

    existing = await repo.get_pantry_item(str(item_id))
    if not existing:
        raise HTTPException(status_code=404, detail="Pantry item not found")

    updates: dict[str, Any] = {"updated_at": datetime.now(UTC)}
    if body.name is not None:
        updates["name"] = body.name
    if body.quantity is not None:
        updates["quantity"] = body.quantity
    if body.unit is not None:
        updates["unit"] = body.unit
    if body.category is not None:
        updates["category"] = body.category
    if body.storage_location is not None:
        updates["storage_location"] = body.storage_location
    if body.expiry_date is not None:
        try:
            updates["expiry_date"] = date_type.fromisoformat(body.expiry_date)
        except ValueError:
            raise HTTPException(
                status_code=422, detail="Invalid expiry_date format. Use YYYY-MM-DD."
            )

    return await repo.update_pantry_item(str(item_id), updates)


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
    logger.info("GET /pantry/%s", item_id)
    repo = await get_repository()
    expiry = get_expiry_heuristics()

    item = await repo.get_pantry_item(str(item_id))

    if not item:
        logger.warning("Pantry item not found: %s", item_id)
        raise HTTPException(status_code=404, detail="Pantry item not found")

    return PantryItemResponse(
        item=item,
        expiry_status=expiry.get_expiry_status(item.expiry_date),
        days_until_expiry=expiry.days_until_expiry(item.expiry_date),
    )


@router.patch(
    "/{item_id}/slot",
    response_model=PantryItem,
    summary="Update kitchen scene slot for a pantry item",
)
async def update_pantry_item_slot(item_id: UUID, slot_index: int | None = None) -> PantryItem:
    """Update the kitchen scene slot_index for a pantry item."""
    logger.info("PATCH /pantry/%s/slot slot_index=%s", item_id, slot_index)
    repo = await get_repository()

    existing = await repo.get_pantry_item(str(item_id))
    if not existing:
        raise HTTPException(status_code=404, detail="Pantry item not found")

    return await repo.update_pantry_item(str(item_id), {"slot_index": slot_index})


@router.delete(
    "/{item_id}",
    summary="Delete a pantry item",
)
async def delete_pantry_item(item_id: UUID) -> dict[str, Any]:
    """
    Delete a pantry item by ID.

    This is a direct mutation endpoint for manual item removal.
    """
    logger.info("DELETE /pantry/%s", item_id)
    repo = await get_repository()

    deleted = await repo.delete_pantry_item(str(item_id))

    if not deleted:
        logger.warning("Pantry item not found for deletion: %s", item_id)
        raise HTTPException(status_code=404, detail="Pantry item not found")

    return {"success": True, "deleted_id": str(item_id)}
