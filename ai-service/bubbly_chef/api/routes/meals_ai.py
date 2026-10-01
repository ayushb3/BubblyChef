"""Meal-screen AI routes for the BubblyChef AI microservice (issue #652).

Exposes:
- POST /v1/meals/side-alternatives  -- 1-3 alternative sides for one slot
- POST /v1/meals/expand-dish        -- expand an outline into a full recipe
- POST /v1/meals/cook                -- one combined CookProposal for a
                                         whole meal (issue #654, no writes)
- POST /v1/meals/cook/confirm        -- apply the combined deduction, mark
                                         every cooked dish, and claim the
                                         meal's `times_cooked` (issue #654)

The first two routes are thin: they load the target meal through the
repository (a 404 when it doesn't exist or isn't this user's) and delegate
everything else to `workflows/meal/sides.py`, which reuses the meal_plan
pick stage's `_expand_dish` and pantry-opt-out gate rather than
re-implementing them. Neither writes to the DB -- the client persists an
accepted result through `PUT /api/meals/[id]` (Next.js).

The cook routes reuse `services/meal_cook.py` and `services/cook_matcher.py`
-- see `docs/plans/2026-09-29-issue-654-a-meal-deduction-contract.md` for the
full contract (§2a, §2c).
"""

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.api.deps import get_ai_manager
from bubbly_chef.models.cook import (
    MealCookConfirmRequest,
    MealCookProposal,
    MealCookRequest,
)
from bubbly_chef.models.meal import MealDishOutline
from bubbly_chef.models.recipe import RecipeCard
from bubbly_chef.repository.supabase_repo import get_repository
from bubbly_chef.services.meal_cook import (
    MealCookDishInput,
    apply_collapsed_deductions,
    correlate_expired,
    match_meal_with_llm,
)
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


# ---------------------------------------------------------------------------
# Meal cook endpoints (issue #654)
# ---------------------------------------------------------------------------


def _dish_mismatch(recipe_id: Any) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "error_kind": "dish_mismatch",
            "message": f"{recipe_id} is not a dish of this meal",
        },
    )


def _member_recipe_ids(dishes: list[dict[str, Any]]) -> set[str]:
    """Recipe ids that count as a member of this meal (contract §2a N1).

    A dish whose `recipe` came back `{}` -- the recipe was deleted between
    `meal_dishes`' read and `get_recipe`'s -- doesn't count as a member, so
    it can never be "cooked".
    """
    return {str(dish["recipe_id"]) for dish in dishes if dish.get("recipe")}


@router.post(
    "/cook",
    response_model=MealCookProposal,
    summary="Match every dish in a meal against the pantry, merged into one proposal",
    responses={
        200: {"description": "MealCookProposal with merged per-pantry-item match results"},
        401: {"description": "Missing or invalid JWT"},
        404: {"description": "Meal not found"},
        409: {"description": "A requested recipe_id is not a dish of this meal"},
        422: {"description": "Duplicate recipe_id in dishes"},
    },
)
async def meal_cook(
    request: MealCookRequest,
    user_id: str = Depends(get_current_user_id),
) -> MealCookProposal:
    """Build a MealCookProposal for a whole meal cook. No writes -- the user
    must call /cook/confirm to apply."""
    logger.info(
        f"Meal cook proposal: user={user_id}, meal={request.meal_id}, "
        f"dishes={len(request.dishes)}"
    )
    try:
        repo = await get_repository()

        meal_data = await repo.get_meal_with_dishes(user_id, str(request.meal_id))
        if meal_data is None:
            raise HTTPException(status_code=404, detail="Meal not found")

        meal_row = meal_data["meal"]
        dish_rows: list[dict[str, Any]] = meal_data["dishes"]
        dish_by_recipe_id = {str(d["recipe_id"]): d for d in dish_rows}
        member_ids = _member_recipe_ids(dish_rows)

        dish_inputs: list[MealCookDishInput] = []
        for dish_request in request.dishes:
            recipe_id_str = str(dish_request.recipe_id)
            if recipe_id_str not in member_ids:
                raise _dish_mismatch(recipe_id_str)
            dish_row = dish_by_recipe_id[recipe_id_str]
            dish_inputs.append(
                MealCookDishInput(
                    recipe_id=dish_request.recipe_id,
                    title=dish_row["recipe"].get("title", ""),
                    role=dish_row["role"],
                    position=dish_row["position"],
                    request=dish_request,
                    recipe_row=dish_row["recipe"],
                )
            )
        # Position order (main, then side 1, then side 2) -- the request may
        # list dishes in whatever order the client collected them.
        dish_inputs.sort(key=lambda d: d.position)

        pantry_items = await repo.get_all_pantry_items(user_id)

        result = await match_meal_with_llm(
            dishes=dish_inputs,
            meal_servings=request.servings,
            pantry_items=pantry_items,
            ai_manager=get_ai_manager(),
        )
        expired_items = correlate_expired(result.matches, pantry_items, dedupe=True)

        return MealCookProposal(
            meal_id=request.meal_id,
            meal_title=meal_row.get("title", ""),
            servings=request.servings,
            dishes=result.dishes,
            matches=result.matches,
            missing=result.missing,
            missing_sources=result.missing_sources,
            missing_notes=result.missing_notes,
            unit_conflicts=result.unit_conflicts,
            compound_suggestions=result.compound_suggestions,
            expired_items=expired_items,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Meal cook proposal failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Meal cook proposal failed: {str(e)}") from e


@router.post(
    "/cook/confirm",
    summary="Apply the combined pantry deduction for a whole meal cook",
    responses={
        200: {"description": "Deductions applied and every cooked dish marked as cooked"},
        401: {"description": "Missing or invalid JWT"},
        404: {"description": "Meal not found"},
        409: {
            "description": (
                "A requested recipe_id is not a dish of this meal, or this "
                "cook_ref is still being confirmed, or a previous confirm "
                "for it never finished"
            )
        },
        422: {"description": "Duplicate recipe_id in recipe_ids, or a malformed cook_ref"},
    },
)
async def meal_cook_confirm(
    request: MealCookConfirmRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Claim `cook_ref` first, then apply deductions and mark every cooked
    dish + the meal as cooked. Never double-deducts: see
    `SupabaseRepository.claim_meal_cook` for the idempotency rules."""
    logger.info(
        f"Meal cook confirm: user={user_id}, meal={request.meal_id}, "
        f"cook_ref={request.cook_ref}, recipes={len(request.recipe_ids)}"
    )
    try:
        repo = await get_repository()

        meal_data = await repo.get_meal_with_dishes(user_id, str(request.meal_id))
        if meal_data is None:
            raise HTTPException(status_code=404, detail="Meal not found")

        meal_row = meal_data["meal"]
        # A replay of THIS SAME ref skips the membership check (contract §2c
        # S3) -- the claim below classifies it. Otherwise a dish swapped
        # after a successful confirm would turn a harmless replay into a
        # dish_mismatch.
        is_own_replay = meal_row.get("last_cook_ref") == request.cook_ref
        if not is_own_replay:
            member_ids = _member_recipe_ids(meal_data["dishes"])
            for recipe_id in request.recipe_ids:
                if str(recipe_id) not in member_ids:
                    raise _dish_mismatch(recipe_id)

        claim = await repo.claim_meal_cook(user_id, str(request.meal_id), request.cook_ref)
        if claim is None:
            raise HTTPException(status_code=404, detail="Meal not found")

        if claim.outcome == "replay_applied":
            return {
                "success": True,
                "already_confirmed": True,
                "deductions_applied": 0,
                "deductions_requested": 0,
                "deductions_skipped": [],
                "recipes_marked_cooked": [],
                "meal_times_cooked": claim.times_cooked,
                "cooked_on": claim.cooked_on.isoformat(),
                "cooked_at": claim.cooked_at.isoformat() if claim.cooked_at else None,
            }
        if claim.outcome == "replay_in_progress":
            raise HTTPException(
                status_code=409,
                detail={
                    "error_kind": "confirm_in_progress",
                    "message": "This cook is still being saved.",
                },
            )
        if claim.outcome == "replay_claimed":
            raise HTTPException(
                status_code=409,
                detail={
                    "error_kind": "confirm_incomplete",
                    "message": (
                        "This cook started saving but didn't finish. "
                        "Your pantry may be partly updated."
                    ),
                },
            )

        # claim.outcome == "claimed", but the FIRST read's last_cook_ref
        # looked like our own ref (is_own_replay), so the membership check
        # above was skipped. The claim not classifying this as a replay
        # means another device already moved last_cook_ref on between our
        # two reads -- this is actually a fresh claim over that newer state,
        # not a replay, so the membership check we skipped still has to run,
        # against the `meal_data` we already read, before any deduction
        # write (issue #654, code review N1).
        if is_own_replay:
            member_ids = _member_recipe_ids(meal_data["dishes"])
            for recipe_id in request.recipe_ids:
                if str(recipe_id) not in member_ids:
                    raise _dish_mismatch(recipe_id)

        # claim.outcome == "claimed": apply the writes. A failure here leaves
        # the meal row's status at 'claimed' -- a retry within 30s of the
        # claim gets confirm_in_progress, and a later one confirm_incomplete.
        try:
            applied, requested, skipped = await apply_collapsed_deductions(
                repo, user_id, request.deductions
            )
            marked: list[str] = []
            for recipe_id in request.recipe_ids:
                # A dish whose recipe vanished after the deductions is skipped,
                # not raised: a raise would strand the claim (#676).
                if await repo.update_recipe_cooked(user_id=user_id, recipe_id=str(recipe_id)):
                    marked.append(str(recipe_id))
            await repo.mark_meal_cook_applied(user_id, str(request.meal_id), request.cook_ref)
        except Exception as e:
            logger.error(
                f"Meal cook confirm failed after claim: user={user_id}, "
                f"meal={request.meal_id}, cook_ref={request.cook_ref}: {e}",
                exc_info=True,
            )
            raise HTTPException(
                status_code=500, detail=f"Meal cook confirm failed: {str(e)}"
            ) from e

        return {
            "success": True,
            "already_confirmed": False,
            "deductions_applied": applied,
            "deductions_requested": requested,
            "deductions_skipped": skipped,
            "recipes_marked_cooked": marked,
            "meal_times_cooked": claim.times_cooked,
            "cooked_on": claim.cooked_on.isoformat(),
            "cooked_at": claim.cooked_at.isoformat() if claim.cooked_at else None,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Meal cook confirm failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Meal cook confirm failed: {str(e)}") from e
