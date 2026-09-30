"""Recipe AI routes for the BubblyChef AI microservice.

Exposes:
- POST /v1/recipes/generate        — generate a recipe from constraints + pantry
- POST /v1/recipes/refine          — refine an existing recipe with a prompt
- POST /v1/recipes/cook            — build a CookProposal (match ingredients to pantry)
- POST /v1/recipes/cook/confirm    — apply deductions + mark recipe as cooked
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.models.cook import CookConfirmRequest, CookProposal
from bubbly_chef.repository.supabase_repo import get_repository
from bubbly_chef.services.meal_cook import apply_collapsed_deductions, correlate_expired

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/recipes", tags=["recipes-ai"])


class GenerateRequest(BaseModel):
    """Request body for recipe generation."""

    prompt: str = Field(
        description="What the user wants — e.g., 'quick pasta dinner'",
        min_length=1,
        max_length=5000,
    )
    cuisine: str | None = Field(default=None, description="Preferred cuisine")
    max_time_minutes: int | None = Field(default=None, description="Max total cook time")
    dietary: list[str] = Field(default_factory=list, description="Dietary constraints")
    difficulty: str | None = Field(default=None, description="easy/medium/hard")
    servings: int | None = Field(default=None, description="Number of servings")
    use_pantry: bool = Field(default=True, description="Ground recipe in user's pantry items")


class RefineRequest(BaseModel):
    """Request body for recipe refinement."""

    recipe: dict[str, Any] = Field(description="The current recipe to refine")
    prompt: str = Field(
        description="Refinement instruction — e.g., 'make it vegetarian'",
        min_length=1,
        max_length=5000,
    )


@router.post(
    "/generate",
    summary="Generate a recipe from constraints",
    responses={
        200: {"description": "Generated recipe with ingredient availability"},
        401: {"description": "Missing or invalid JWT"},
    },
)
async def generate_recipe(
    request: GenerateRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Generate a pantry-aware recipe using the AI pipeline."""
    logger.info(
        f"Recipe generate: user={user_id}, prompt='{request.prompt[:50]}...', "
        f"use_pantry={request.use_pantry}"
    )

    try:
        from bubbly_chef.api.deps import get_ai_manager
        from bubbly_chef.services.recipe_generator import generate_recipe as gen_recipe

        ai_manager = get_ai_manager()

        # Fetch pantry items for grounding
        pantry_items = []
        if request.use_pantry:
            repo = await get_repository()
            pantry_items = await repo.get_all_pantry_items(user_id)

        constraints: dict[str, Any] = {}
        if request.cuisine:
            constraints["cuisine"] = request.cuisine
        if request.max_time_minutes:
            constraints["max_time_minutes"] = request.max_time_minutes
        if request.dietary:
            constraints["dietary"] = request.dietary
        if request.difficulty:
            constraints["difficulty"] = request.difficulty
        if request.servings:
            constraints["servings"] = request.servings

        result = await gen_recipe(
            prompt=request.prompt,
            pantry_items=pantry_items,
            ai_manager=ai_manager,
            constraints=constraints if constraints else None,
        )

        return {
            "recipe": result.recipe.model_dump(mode="json") if hasattr(result.recipe, "model_dump") else result.recipe,
            "ingredients_status": [
                s.model_dump(mode="json") if hasattr(s, "model_dump") else s
                for s in (result.ingredients_status or [])
            ],
            "missing_count": result.missing_count,
            "have_count": result.have_count,
            "partial_count": getattr(result, "partial_count", 0),
            "pantry_match_score": result.pantry_match_score,
        }

    except Exception as e:
        logger.error(f"Recipe generation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Recipe generation failed: {str(e)}") from e


@router.post(
    "/refine",
    summary="Refine an existing recipe with AI",
    responses={
        200: {"description": "Refined recipe"},
        401: {"description": "Missing or invalid JWT"},
    },
)
async def refine_recipe(
    request: RefineRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Take an existing recipe and a refinement prompt, return updated recipe."""
    logger.info(f"Recipe refine: user={user_id}, prompt='{request.prompt[:50]}...'")

    try:
        from bubbly_chef.api.deps import get_ai_manager
        from bubbly_chef.services.recipe_generator import generate_recipe as gen_recipe
        from bubbly_chef.models.recipe import RecipeCard
        from bubbly_chef.workflows.recipe.nodes import (
            carry_dietary_tags,
            refine_dietary_constraints,
        )

        ai_manager = get_ai_manager()

        # Build a RecipeCard from the dict for the previous_recipe param
        recipe_row = dict(request.recipe) if request.recipe else {}
        # A saved recipe row carries its diet in `tags`; map it to
        # `dietary_tags` the way recipe_card_from_row does (strings only) so the
        # refine diet check can read it (#544).
        raw_tags = recipe_row.get("tags")
        if not recipe_row.get("dietary_tags") and isinstance(raw_tags, list):
            recipe_row["dietary_tags"] = [t for t in raw_tags if isinstance(t, str)]
        previous_recipe = RecipeCard(**recipe_row) if recipe_row else None

        repo = await get_repository()
        pantry_items = await repo.get_all_pantry_items(user_id)

        # No session and no carried field here, so keep the stored diet except
        # what the tweak adds or the saved recipe's ingredients contradict.
        decision = await refine_dietary_constraints(
            user_id, request.prompt, None, previous_recipe, library=True
        )

        result = await gen_recipe(
            prompt=request.prompt,
            pantry_items=pantry_items,
            ai_manager=ai_manager,
            constraints=decision.constraints,
            previous_recipe=previous_recipe,
        )

        # The generator never emits tags. Carry the saved recipe's own onto the
        # refined card (minus any the tweak set aside) so the library's next
        # refine of it still finds the tag that protects its diet (#544).
        if isinstance(result.recipe, RecipeCard) and not result.recipe.dietary_tags:
            result.recipe = result.recipe.model_copy(
                update={
                    "dietary_tags": carry_dietary_tags(
                        previous_recipe, request.prompt, decision.diets_set_aside_now
                    )
                }
            )

        return {
            # `diets_set_aside` / `exclusions_set_aside` are chat-session state;
            # the library has no session.
            "recipe": (
                result.recipe.model_dump(
                    mode="json", exclude={"diets_set_aside", "exclusions_set_aside"}
                )
                if hasattr(result.recipe, "model_dump")
                else result.recipe
            ),
            "ingredients_status": [
                s.model_dump(mode="json") if hasattr(s, "model_dump") else s
                for s in (result.ingredients_status or [])
            ],
            "missing_count": result.missing_count,
            "have_count": result.have_count,
            "pantry_match_score": result.pantry_match_score,
        }

    except Exception as e:
        logger.error(f"Recipe refinement failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Recipe refinement failed: {str(e)}") from e


# ---------------------------------------------------------------------------
# Cook-a-recipe endpoints
# ---------------------------------------------------------------------------


class CookRequest(BaseModel):
    """Request body for POST /v1/recipes/cook."""

    recipe_id: str = Field(description="UUID of the recipe to cook")


@router.post(
    "/cook",
    response_model=CookProposal,
    summary="Match recipe ingredients against pantry",
    responses={
        200: {"description": "CookProposal with per-ingredient match results"},
        401: {"description": "Missing or invalid JWT"},
        404: {"description": "Recipe not found"},
    },
)
async def cook_recipe(
    request: CookRequest,
    user_id: str = Depends(get_current_user_id),
) -> CookProposal:
    """Fetch the recipe and the user's pantry, then return a CookProposal.

    No writes are performed here — the user must call /cook/confirm to apply.
    """
    logger.info(f"Cook proposal: user={user_id}, recipe={request.recipe_id}")

    try:
        from bubbly_chef.api.deps import get_ai_manager
        from bubbly_chef.services.cook_matcher import match_ingredients_with_llm

        repo = await get_repository()

        recipe_data = await repo.get_recipe(user_id, request.recipe_id)
        if recipe_data is None:
            raise HTTPException(status_code=404, detail="Recipe not found")

        pantry_items = await repo.get_all_pantry_items(user_id)

        ingredients: list[dict[str, Any]] = recipe_data.get("ingredients", [])
        title: str = recipe_data.get("title", "")

        # Deterministic matching first; the model is only consulted for whatever
        # the synonym table cannot place, and a provider outage degrades those
        # ingredients to "missing" rather than failing the request.
        proposal = await match_ingredients_with_llm(
            recipe_id=request.recipe_id,
            recipe_title=title,
            recipe_ingredients=ingredients,
            pantry_items=pantry_items,
            ai_manager=get_ai_manager(),
        )

        # Post-hoc expiry correlation: identify which matched ingredients
        # are backed by an expired pantry row. Shared with the meal cook
        # route (issue #654) -- see services/meal_cook.correlate_expired.
        expired_items = correlate_expired(proposal.matches, pantry_items)
        proposal = proposal.model_copy(update={"expired_items": expired_items})

        return proposal

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Cook proposal failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Cook proposal failed: {str(e)}") from e


@router.post(
    "/{recipe_id}/steps/ensure",
    summary="Ensure a recipe has structured steps, deriving them the first time",
    responses={
        200: {"description": "Structured steps -- existing, or just derived and persisted"},
        401: {"description": "Missing or invalid JWT"},
        404: {"description": "Recipe not found"},
        502: {"description": "The model is unavailable or returned invalid step metadata"},
    },
)
async def ensure_recipe_steps(
    recipe_id: str,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Return a recipe's structured steps, deriving and persisting them once.

    Idempotent: a recipe that already has structured steps is returned as-is
    with no model call (`derived=False`). Nothing is persisted on failure --
    the caller falls back to the regex duration parser.
    """
    from bubbly_chef.api.deps import get_ai_manager
    from bubbly_chef.services.structured_steps import (
        RecipeNotFoundError,
        StructuredStepsUnavailableError,
        ensure_structured_steps,
    )

    logger.info(f"Ensure structured steps: user={user_id}, recipe={recipe_id}")

    repo = await get_repository()
    try:
        steps, derived = await ensure_structured_steps(
            user_id=user_id,
            recipe_id=recipe_id,
            repo=repo,
            ai_manager=get_ai_manager(),
        )
    except RecipeNotFoundError as e:
        raise HTTPException(status_code=404, detail="Recipe not found") from e
    except StructuredStepsUnavailableError as e:
        raise HTTPException(
            status_code=502,
            detail={"error_kind": e.error_kind, "message": e.message},
        ) from e

    return {
        "recipe_id": recipe_id,
        "steps": [s.model_dump(mode="json") for s in steps],
        "derived": derived,
    }


@router.post(
    "/cook/confirm",
    summary="Apply pantry deductions and mark recipe as cooked",
    responses={
        200: {"description": "Deductions applied and recipe marked as cooked"},
        401: {"description": "Missing or invalid JWT"},
        404: {"description": "Recipe not found"},
    },
)
async def cook_confirm(
    request: CookConfirmRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Apply user-approved deductions and increment times_cooked on the recipe."""
    logger.info(
        f"Cook confirm: user={user_id}, recipe={request.recipe_id}, "
        f"deductions={len(request.deductions)}"
    )

    try:
        repo = await get_repository()

        # Verify recipe exists and belongs to this user
        recipe_data = await repo.get_recipe(user_id, str(request.recipe_id))
        if recipe_data is None:
            raise HTTPException(status_code=404, detail="Recipe not found")

        # Collapse deductions per pantry item before touching the DB, then
        # apply. Shared with the meal cook confirm route (issue #654) -- see
        # services/meal_cook.apply_collapsed_deductions for why the collapse
        # has to happen before any write.
        applied, requested, skipped = await apply_collapsed_deductions(
            repo, user_id, request.deductions
        )

        # Mark recipe as cooked
        await repo.update_recipe_cooked(user_id=user_id, recipe_id=str(request.recipe_id))

        return {
            "success": True,
            "deductions_applied": applied,
            "deductions_requested": requested,
            "deductions_skipped": skipped,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Cook confirm failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Cook confirm failed: {str(e)}") from e
