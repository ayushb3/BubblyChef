"""Pantry helper HTTP routes for the BubblyChef AI microservice.

Exposes:
- POST /v1/pantry/estimate-expiry      — estimate an expiry date for an item
- POST /v1/pantry/estimate-category    — categorize an item name via the catalog
- POST /v1/pantry/normalize-base-unit  — derive quantity_base / unit_base (#224)

The expiry heuristic (`tools/expiry`) and catalog categorizer
(`domain/catalog`) are Python-only and are the single source of truth shared by
the AI ingest paths. These endpoints let the Next.js CRUD routes (manual add,
bulk add) reuse them instead of forking the logic into TypeScript, so items
added by hand get the same defaults as AI-parsed items (#158, #159, #224).
"""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.domain.normalizer import normalize_to_base_unit, resolve_category
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
    """Infer a food category from an item name.

    Uses keyword matching then catalog fuzzy match (threshold=95).
    Returns null when neither has a confident match — callers should
    fall back to 'other' so a failed estimate never blocks the add.
    """
    return EstimateCategoryResponse(category=resolve_category(request.name))


# ---------------------------------------------------------------------------
# Normalize base unit (#224)
# ---------------------------------------------------------------------------


class NormalizeBaseUnitRequest(BaseModel):
    name: str = Field(..., description="Item name (normalized form preferred)")
    quantity: float = Field(..., description="Display quantity from the pantry row")
    unit: str = Field(..., description="Display unit from the pantry row")
    category: str = Field(
        default="other",
        description="Food category — improves density-based conversions",
    )


class NormalizeBaseUnitResponse(BaseModel):
    quantity_base: float | None = Field(
        ...,
        description="Quantity in the canonical base unit, or null when conversion is not possible",
    )
    unit_base: str | None = Field(
        ...,
        description="Canonical base unit (count | ml | g), or null when conversion is not possible",
    )


@router.post(
    "/normalize-base-unit",
    summary="Derive quantity_base / unit_base for a pantry row (#224)",
    response_model=NormalizeBaseUnitResponse,
    responses={
        200: {"description": "Base-unit pair, or nulls when conversion is impossible"},
        401: {"description": "Missing or invalid JWT"},
    },
)
async def normalize_base_unit(
    request: NormalizeBaseUnitRequest,
    user_id: str = Depends(get_current_user_id),
) -> NormalizeBaseUnitResponse:
    """Convert (name, quantity, unit) into the canonical base unit.

    Delegates to ``normalize_to_base_unit`` in ``domain/normalizer``, which is
    the single source of truth used by the cook-matcher and the ingest workflows.
    Returns ``(null, null)`` when no defensible conversion exists (e.g. "1 tbsp
    matcha" — no density entry for matcha so g-to-ml is impossible) — callers
    must leave ``quantity_base``/``unit_base`` as NULL rather than blocking the write.

    Failure modes that leave the response as nulls:
    - Unknown unit not in any conversion table.
    - Cross-dimension conversion for an ingredient with no density entry.
    The write succeeds regardless; the cook flow derives the values at runtime
    from the raw ``(quantity, unit)`` when base values are absent.
    """
    qty_base, ub = normalize_to_base_unit(
        name=request.name,
        quantity=request.quantity,
        unit=request.unit,
        category=request.category,
    )
    return NormalizeBaseUnitResponse(quantity_base=qty_base, unit_base=ub)
