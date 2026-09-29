"""Meal-screen AI routes for the BubblyChef AI microservice (issue #652).

Exposes:
- POST /v1/meals/side-alternatives  -- 1-3 alternative sides for one slot
- POST /v1/meals/expand-dish        -- expand an outline into a full recipe

Both routes are thin: they load the target meal through the repository (a
404 when it doesn't exist or isn't this user's) and delegate everything else
to `workflows/meal/sides.py`, which reuses the meal_plan pick stage's
`_expand_dish` and pantry-opt-out gate rather than re-implementing them.
Neither route writes to the DB -- the client persists an accepted result
through `PUT /api/meals/[id]` (Next.js).
"""

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.api.deps import get_ai_manager
from bubbly_chef.models.meal import MealDishOutline
from bubbly_chef.models.recipe import RecipeCard
from bubbly_chef.repository.supabase_repo import get_repository
from bubbly_chef.workflows.meal.sides import (
    MealGenerationUnavailableError,
    MealNotFoundError,
    expand_meal_dish,
    generate_side_alternatives,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/meals", tags=["meals-ai"])


class SideAlternativesRequest(BaseModel):
    """Request body for POST /v1/meals/side-alternatives."""

    meal_id: str = Field(description="UUID of the meal")
    position: Literal[1, 2] | None = Field(
        default=None,
        description="The side being replaced (1 or 2); omit when adding a new side",
    )


class SideAlternativesResponse(BaseModel):
    """Response body for POST /v1/meals/side-alternatives."""

    alternatives: list[MealDishOutline]


class ExpandDishRequest(BaseModel):
    """Request body for POST /v1/meals/expand-dish."""

    meal_id: str = Field(description="UUID of the meal")
    position: Literal[1, 2] = Field(description="Where the dish will go in the meal: 1 or 2")
    outline: MealDishOutline = Field(description="The picked side-alternatives outline")


class ExpandDishResponse(BaseModel):
    """Response body for POST /v1/meals/expand-dish."""

    proposal_type: str = "meal_dish"
    role: str
    position: int
    recipe: RecipeCard


def _http_error(e: MealGenerationUnavailableError) -> HTTPException:
    """502 in the same `detail: {error_kind, message}` shape as
    `POST /v1/recipes/{id}/steps/ensure`."""
    return HTTPException(status_code=502, detail={"error_kind": e.error_kind, "message": e.message})


@router.post(
    "/side-alternatives",
    response_model=SideAlternativesResponse,
    summary="Propose alternative sides for one slot in a meal",
    responses={
        200: {"description": "1-3 alternative side outlines"},
        401: {"description": "Missing or invalid JWT"},
        404: {"description": "Meal not found"},
        502: {"description": "The model is unavailable or returned no valid alternatives"},
    },
)
async def side_alternatives(
    request: SideAlternativesRequest,
    user_id: str = Depends(get_current_user_id),
) -> SideAlternativesResponse:
    logger.info(
        f"Side alternatives: user={user_id}, meal={request.meal_id}, position={request.position}"
    )
    repo = await get_repository()
    try:
        alternatives = await generate_side_alternatives(
            user_id=user_id,
            meal_id=request.meal_id,
            position=request.position,
            repo=repo,
            ai_manager=get_ai_manager(),
        )
    except MealNotFoundError as e:
        raise HTTPException(status_code=404, detail="Meal not found") from e
    except MealGenerationUnavailableError as e:
        raise _http_error(e) from e

    return SideAlternativesResponse(alternatives=alternatives)


@router.post(
    "/expand-dish",
    response_model=ExpandDishResponse,
    summary="Expand one dish outline into a full recipe for a meal",
    responses={
        200: {"description": "The expanded recipe, at the meal's servings"},
        401: {"description": "Missing or invalid JWT"},
        404: {"description": "Meal not found"},
        502: {"description": "The model is unavailable or returned invalid structured output"},
    },
)
async def expand_dish(
    request: ExpandDishRequest,
    user_id: str = Depends(get_current_user_id),
) -> ExpandDishResponse:
    logger.info(
        f"Expand dish: user={user_id}, meal={request.meal_id}, position={request.position}"
    )
    repo = await get_repository()
    try:
        recipe = await expand_meal_dish(
            user_id=user_id,
            meal_id=request.meal_id,
            position=request.position,
            outline=request.outline,
            repo=repo,
            ai_manager=get_ai_manager(),
        )
    except MealNotFoundError as e:
        raise HTTPException(status_code=404, detail="Meal not found") from e
    except MealGenerationUnavailableError as e:
        raise _http_error(e) from e

    return ExpandDishResponse(
        role=request.outline.role, position=request.position, recipe=recipe
    )
