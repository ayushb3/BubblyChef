"""Recipe generation endpoints."""

from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from bubbly_chef.api.deps import get_ai_manager
from bubbly_chef.logger import get_logger, log_error
from bubbly_chef.models.recipe import RecipeCard
from bubbly_chef.repository.sqlite import get_repository
from bubbly_chef.services.recipe_generator import (
    IngredientStatus,
    generate_recipe,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/recipes", tags=["Recipes"])


class GenerateRecipeRequest(BaseModel):
    """Request for recipe generation."""

    prompt: str = Field(description="User's recipe request", min_length=1)
    constraints: dict | None = Field(
        default=None,
        description=(
            "Optional constraints: max_time_minutes, cuisine,"
            " dietary, use_expiring, servings"
        ),
    )
    previous_recipe_context: str | None = Field(
        default=None,
        description="Previous recipe JSON for follow-up modifications",
    )


class GenerateRecipeAPIResponse(BaseModel):
    """API response for recipe generation."""

    recipe: RecipeCard
    ingredients_status: list[IngredientStatus]
    missing_count: int
    have_count: int
    partial_count: int
    pantry_match_score: float = Field(ge=0.0, le=1.0)


@router.post("/generate", response_model=GenerateRecipeAPIResponse)
async def generate_recipe_endpoint(request: GenerateRecipeRequest) -> GenerateRecipeAPIResponse:
    """
    Generate a recipe based on user prompt and pantry context.

    The AI will consider the user's pantry items and suggest a recipe
    that uses available ingredients, prioritizing items that are expiring soon.

    Examples:
    - "What can I make with chicken?"
    - "Quick dinner under 30 minutes"
    - "Use up my broccoli before it expires"
    - "Something Italian with pasta"

    The response includes:
    - The generated recipe with all details
    - Status of each ingredient (have/partial/missing)
    - Overall pantry match score
    """
    start_time = datetime.now()
    repo = await get_repository()
    ai_manager = get_ai_manager()

    logger.info(
        "Recipe generation requested",
        extra={
            "prompt": request.prompt[:100],
            "prompt_length": len(request.prompt),
            "has_constraints": request.constraints is not None,
            "has_context": request.previous_recipe_context is not None,
        },
    )

    try:
        # Fetch user's pantry items
        pantry_items = await repo.get_all_pantry_items()
        logger.info(f"🍳 Generating recipe with {len(pantry_items)} pantry items")

        # Parse previous recipe if provided (for follow-ups)
        previous_recipe = None
        if request.previous_recipe_context:
            try:
                import json

                previous_data = json.loads(request.previous_recipe_context)
                previous_recipe = RecipeCard(**previous_data)
                logger.debug("Using previous recipe context for follow-up")
            except Exception as e:
                logger.warning(f"Failed to parse previous recipe: {e}")

        # Generate the recipe
        result = await generate_recipe(
            prompt=request.prompt,
            pantry_items=pantry_items,
            ai_manager=ai_manager,
            constraints=request.constraints,
            previous_recipe=previous_recipe,
        )

        elapsed = (datetime.now() - start_time).total_seconds()
        logger.info(
            "Recipe generated successfully",
            extra={
                "recipe_title": result.recipe.title,
                "ingredients_count": len(result.recipe.ingredients),
                "pantry_match_score": result.pantry_match_score,
                "have_count": result.have_count,
                "missing_count": result.missing_count,
                "elapsed_seconds": elapsed,
            },
        )

        return GenerateRecipeAPIResponse(
            recipe=result.recipe,
            ingredients_status=result.ingredients_status,
            missing_count=result.missing_count,
            have_count=result.have_count,
            partial_count=result.partial_count,
            pantry_match_score=result.pantry_match_score,
        )

    except Exception as e:
        elapsed = (datetime.now() - start_time).total_seconds()
        logger.error(
            "Recipe generation failed",
            extra={
                "error": str(e),
                "error_type": type(e).__name__,
                "elapsed_seconds": elapsed,
                "prompt": request.prompt[:100],
            },
            exc_info=True,
        )
        log_error(logger, f"Failed to generate recipe for prompt: {request.prompt[:50]}...", e)
        raise HTTPException(status_code=500, detail=f"Recipe generation failed: {str(e)}")


@router.get("/suggestions", response_model=list[str])
async def get_recipe_suggestions() -> list[str]:
    """
    Get recipe prompt suggestions based on current pantry state.

    Returns suggestions like:
    - "Use up [expiring item]"
    - "Something with [main ingredient]"
    - Generic suggestions if pantry is empty
    """
    repo = await get_repository()

    logger.info("Fetching recipe suggestions")

    try:
        pantry_items = await repo.get_all_pantry_items()
        suggestions = []

        # Check for expiring items
        expiring = [item for item in pantry_items if item.is_expiring_soon]
        if expiring:
            for item in expiring[:2]:
                suggestions.append(f"Use up my {item.name.lower()} before it expires")

        # Check for main proteins/ingredients
        proteins = [item for item in pantry_items if item.category.value in ("meat", "seafood")]
        if proteins:
            suggestions.append(f"What can I make with {proteins[0].name.lower()}?")

        # Add some generic suggestions
        generic = [
            "Quick dinner under 30 minutes",
            "Something healthy and light",
            "Comfort food for tonight",
            "Easy weeknight meal",
        ]

        # Fill up to 5 suggestions
        for s in generic:
            if len(suggestions) >= 5:
                break
            if s not in suggestions:
                suggestions.append(s)

        logger.info(
            "Recipe suggestions generated",
            extra={
                "suggestions_count": len(suggestions[:5]),
                "pantry_items_count": len(pantry_items),
                "expiring_count": len(expiring),
            },
        )

        return suggestions[:5]

    except Exception as e:
        logger.error(
            "Failed to get recipe suggestions",
            extra={"error": str(e), "error_type": type(e).__name__},
            exc_info=True,
        )
        log_error(logger, "Failed to get recipe suggestions", e)
        # Return generic suggestions on error
        return [
            "Quick dinner under 30 minutes",
            "Something with chicken",
            "Healthy vegetarian meal",
            "Easy pasta dish",
            "Comfort food for tonight",
        ]
