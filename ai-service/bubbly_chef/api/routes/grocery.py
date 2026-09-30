"""Grocery-list AI-service routes (issue #497 / Spec B.5).

Exposes:
- POST /v1/grocery/regenerate  -- refresh the list from depletions + low and
                                  expiring stock (deterministic, no LLM)
- POST /v1/grocery/from-meal   -- put a saved meal's missing ingredients on the list

These two live here, not in the Next.js CRUD layer, because they need the
Python-only cook matcher / staples / pantry model. Plain list CRUD (check,
uncheck, add, remove, share) is Next.js `/api/grocery/*`. Routes stay thin: the
work is in `services/grocery.py` and the pure planners in `domain/grocery.py`.
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.models.grocery import (
    GroceryFromMealRequest,
    GroceryFromMealResponse,
    GroceryItemOut,
    RegenerateGroceryResponse,
)
from bubbly_chef.repository.supabase_repo import get_repository
from bubbly_chef.services.grocery import (
    MealNotFoundError,
    add_meal_missing_to_list,
    regenerate_grocery_list,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/grocery", tags=["grocery"])


def _items(rows: list[dict[str, Any]]) -> list[GroceryItemOut]:
    return [
        GroceryItemOut(
            id=str(r["id"]),
            name=r["name"],
            quantity=None if r.get("quantity") is None else float(r["quantity"]),
            unit=r.get("unit"),
            category=r.get("category") or "other",
            source=r.get("source") or "manual",
            source_ref=r.get("source_ref"),
            checked=bool(r.get("checked")),
        )
        for r in rows
    ]


@router.post(
    "/regenerate",
    response_model=RegenerateGroceryResponse,
    summary="Regenerate the grocery list from depletions and low/expiring stock",
    responses={401: {"description": "Missing or invalid JWT"}},
)
async def regenerate(user_id: str = Depends(get_current_user_id)) -> RegenerateGroceryResponse:
    logger.info(f"Grocery regenerate: user={user_id}")
    repo = await get_repository()
    result = await regenerate_grocery_list(repo, user_id)
    return RegenerateGroceryResponse(
        added=result.added,
        updated=result.updated,
        removed=result.removed,
        items=_items(result.items),
    )


@router.post(
    "/from-meal",
    response_model=GroceryFromMealResponse,
    summary="Add a saved meal's missing ingredients to the grocery list",
    responses={
        401: {"description": "Missing or invalid JWT"},
        404: {"description": "Meal not found"},
    },
)
async def from_meal(
    request: GroceryFromMealRequest,
    user_id: str = Depends(get_current_user_id),
) -> GroceryFromMealResponse:
    logger.info(f"Grocery from meal: user={user_id}, meal={request.meal_id}")
    repo = await get_repository()
    try:
        result = await add_meal_missing_to_list(repo, user_id, request.meal_id)
    except MealNotFoundError as e:
        raise HTTPException(status_code=404, detail="Meal not found") from e
    return GroceryFromMealResponse(
        to_buy=result.to_buy,
        added=result.added,
        already_on_list=result.already_on_list,
        items=_items(result.items),
    )
