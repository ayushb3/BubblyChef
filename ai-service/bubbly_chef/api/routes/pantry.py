"""Pantry helper HTTP routes for the BubblyChef AI microservice.

Exposes:
- POST /v1/pantry/estimate-expiry — estimate an expiry date for an item

The expiry heuristic (`tools/expiry`) is Python-only and is the single source of
truth shared by the AI ingest paths. This endpoint lets the Next.js CRUD routes
(manual add, bulk add) reuse it instead of forking the table into TypeScript, so
items added by hand or via receipt-confirm get the same default expiries (#158).
"""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.models.pantry import FoodCategory, StorageLocation
from bubbly_chef.tools.expiry import get_expiry_heuristics

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/pantry", tags=["pantry"])


class EstimateExpiryRequest(BaseModel):
    name: str = Field(..., description="Item name (used for specific overrides)")
    category: str = Field(default="other", description="Food category")
    location: str = Field(default="pantry", description="Storage location")


class EstimateExpiryResponse(BaseModel):
    expiry_date: str = Field(..., description="Estimated expiry date (ISO YYYY-MM-DD)")
    is_estimated: bool = Field(..., description="Always true — this is a heuristic")


def _coerce_category(value: str) -> FoodCategory:
    try:
        return FoodCategory(value)
    except ValueError:
        return FoodCategory.OTHER


def _coerce_location(value: str) -> StorageLocation:
    try:
        return StorageLocation(value)
    except ValueError:
        return StorageLocation.PANTRY


@router.post(
    "/estimate-expiry",
    summary="Estimate an expiry date for a pantry item",
    response_model=EstimateExpiryResponse,
    responses={
        200: {"description": "Estimated expiry date"},
        401: {"description": "Missing or invalid JWT"},
    },
)
async def estimate_expiry(
    request: EstimateExpiryRequest,
    user_id: str = Depends(get_current_user_id),
) -> EstimateExpiryResponse:
    """Estimate an expiry date from category/location/name.

    Deterministic heuristic — no LLM call. Callers should treat a failure of this
    endpoint as "no estimate" and proceed with a null expiry rather than blocking
    the add.
    """
    expiry_date, is_estimated = get_expiry_heuristics().estimate_expiry(
        category=_coerce_category(request.category),
        storage=_coerce_location(request.location),
        name=request.name,
    )
    return EstimateExpiryResponse(
        expiry_date=expiry_date.isoformat(),
        is_estimated=is_estimated,
    )
