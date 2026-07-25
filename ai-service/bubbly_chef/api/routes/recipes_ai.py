"""Recipe AI routes for the BubblyChef AI microservice.

Exposes:
- POST /v1/recipes/generate — generate a recipe from constraints + pantry
- POST /v1/recipes/refine  — refine an existing recipe with a prompt
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.repository.supabase_repo import get_repository

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
            "recipe": result.recipe.model_dump(mode="json")
            if hasattr(result.recipe, "model_dump")
            else result.recipe,
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
        from bubbly_chef.models.recipe import RecipeCard
        from bubbly_chef.services.recipe_generator import generate_recipe as gen_recipe

        ai_manager = get_ai_manager()

        # Build a RecipeCard from the dict for the previous_recipe param
        previous_recipe = RecipeCard(**request.recipe) if request.recipe else None

        repo = await get_repository()
        pantry_items = await repo.get_all_pantry_items(user_id)

        result = await gen_recipe(
            prompt=request.prompt,
            pantry_items=pantry_items,
            ai_manager=ai_manager,
            previous_recipe=previous_recipe,
        )

        return {
            "recipe": result.recipe.model_dump(mode="json")
            if hasattr(result.recipe, "model_dump")
            else result.recipe,
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
