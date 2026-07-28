"""Pantry helper HTTP routes for the BubblyChef AI microservice.

Exposes:
- POST /v1/pantry/estimate-expiry   — estimate an expiry date for an item
- POST /v1/pantry/estimate-category — categorize an item name via the catalog

The expiry heuristic (`tools/expiry`) and catalog categorizer
(`domain/catalog`) are Python-only and are the single source of truth shared by
the AI ingest paths. These endpoints let the Next.js CRUD routes (manual add,
bulk add) reuse them instead of forking the logic into TypeScript, so items
added by hand get the same defaults as AI-parsed items (#158, #159).
"""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.domain.catalog import categorize
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


class EstimateCategoryRequest(BaseModel):
    name: str = Field(..., description="Item name to categorize")


class EstimateCategoryResponse(BaseModel):
    category: str | None = Field(
        ...,
        description="Matched food category string, or null if the catalog has no confident match",
    )


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


@router.post(
    "/estimate-category",
    summary="Categorize a pantry item by name",
    response_model=EstimateCategoryResponse,
    responses={
        200: {"description": "Category string, or null if no confident match"},
        401: {"description": "Missing or invalid JWT"},
    },
)
async def estimate_category(
    request: EstimateCategoryRequest,
    user_id: str = Depends(get_current_user_id),
) -> EstimateCategoryResponse:
    """Infer a food category from an item name using the catalog fuzzy matcher.

    Deterministic — no LLM call. Returns null when the catalog has no match
    above the confidence threshold (95). Callers should fall back to 'other'
    on null so that a failed or absent estimate never blocks the add.
    """
    return EstimateCategoryResponse(category=categorize(request.name))
