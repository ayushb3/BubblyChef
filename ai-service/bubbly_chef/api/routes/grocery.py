"""Grocery-list AI-service route (issue #497 / Spec B.5).

Exposes:
- POST /v1/grocery/meal-to-buy  -- a saved meal's missing ingredients, computed
                                   against the current pantry (deterministic,
                                   no LLM, **writes nothing**)

The grocery list itself is generated and stored client-side (issue #497), so
this is the only grocery route here: it exists because the cook matcher and
the pantry model are Python-only. The client adds the names to the list after
the user confirms.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.repository.supabase_repo import get_repository
from bubbly_chef.services.grocery import MealNotFoundError, ToBuyItem, meal_to_buy_items

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/grocery", tags=["grocery"])


class MealToBuyRequest(BaseModel):
    """Body for POST /v1/grocery/meal-to-buy."""

    meal_id: str = Field(min_length=1, description="UUID of the saved meal")


class MealToBuyResponse(BaseModel):
    """Response for POST /v1/grocery/meal-to-buy."""

    to_buy: list[str] = Field(description="What the meal needs that the pantry lacks, once each")
    items: list[ToBuyItem] = Field(
        default_factory=list,
        description=(
            "The same foods, in the same order, each with the dishes (by position) that need it "
            "and that dish's own wording (issue #805). Additive: `to_buy` is unchanged."
        ),
    )


@router.post(
    "/meal-to-buy",
    response_model=MealToBuyResponse,
    summary="A saved meal's missing ingredients (read-only)",
    responses={
        401: {"description": "Missing or invalid JWT"},
        404: {"description": "Meal not found"},
    },
)
async def meal_to_buy_route(
    request: MealToBuyRequest,
    user_id: str = Depends(get_current_user_id),
) -> MealToBuyResponse:
    logger.info(f"Grocery meal-to-buy: user={user_id}, meal={request.meal_id}")
    repo = await get_repository()
    try:
        items = await meal_to_buy_items(repo, user_id, request.meal_id)
    except MealNotFoundError as e:
        raise HTTPException(status_code=404, detail="Meal not found") from e
    return MealToBuyResponse(to_buy=[item.name for item in items], items=items)
