"""Recipe generation endpoints."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
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
    constraints: dict[str, Any] | None = Field(
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

        # Fill up to 4 suggestions (even number for 2-column grid)
        for s in generic:
            if len(suggestions) >= 4:
                break
            if s not in suggestions:
                suggestions.append(s)

        logger.info(
            "Recipe suggestions generated",
            extra={
                "suggestions_count": len(suggestions[:4]),
                "pantry_items_count": len(pantry_items),
                "expiring_count": len(expiring),
            },
        )

        return suggestions[:4]

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
        ]


# =============================================================================
# Recipe Library CRUD
# =============================================================================


class SaveRecipeRequest(BaseModel):
    """Request to save a recipe to the library."""

    title: str = Field(description="Recipe title")
    description: str | None = None
    ingredients: list[dict[str, Any]] | None = None
    instructions: list[str] | None = None
    cuisine: str | None = None
    meal_type: str | None = None
    dietary_tags: list[str] | None = None
    difficulty: str | None = None
    prep_time_minutes: int | None = None
    cook_time_minutes: int | None = None
    total_time_minutes: int | None = None
    servings: int | None = None


@router.post("", response_model=RecipeCard, status_code=201)
async def save_recipe(request: SaveRecipeRequest) -> RecipeCard:
    """Save a recipe to the library."""
    from bubbly_chef.models.recipe import Ingredient

    ingredients: list[Ingredient] = []
    for ing in request.ingredients or []:
        ingredients.append(
            Ingredient(
                name=ing.get("name", ""),
                quantity=ing.get("quantity"),
                unit=ing.get("unit"),
            )
        )

    recipe = RecipeCard(
        title=request.title,
        description=request.description,
        ingredients=ingredients,
        instructions=request.instructions or [],
        cuisine=request.cuisine,
        meal_type=request.meal_type,
        dietary_tags=request.dietary_tags or [],
        difficulty=request.difficulty,
        prep_time_minutes=request.prep_time_minutes,
        cook_time_minutes=request.cook_time_minutes,
        total_time_minutes=request.total_time_minutes,
        servings=request.servings,
        source_type="manual",
    )

    repo = await get_repository()
    saved = await repo.add_recipe(recipe)
    logger.info(f"Recipe saved: {saved.title} ({saved.id})")
    return saved


class RefineRecipeRequest(BaseModel):
    """Request to refine an existing recipe via AI."""

    instruction: str = Field(description="What to change, e.g. 'make it vegetarian'")


@router.get("", response_model=list[RecipeCard])
async def list_recipes(
    search: str | None = Query(default=None, description="Full-text search on title/description"),
    cuisine: str | None = Query(default=None, description="Filter by cuisine"),
    max_time: int | None = Query(default=None, description="Max total_time_minutes"),
    is_draft: bool | None = Query(
        default=None, description="Filter drafts (true) or final (false)"
    ),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[RecipeCard]:
    """List saved recipes with optional filters."""
    repo = await get_repository()
    return await repo.get_all_recipes(
        search=search,
        cuisine=cuisine,
        max_time=max_time,
        is_draft=is_draft,
        limit=limit,
        offset=offset,
    )


@router.get("/{recipe_id}", response_model=RecipeCard)
async def get_recipe(recipe_id: UUID) -> RecipeCard:
    """Get a single saved recipe by ID."""
    repo = await get_repository()
    recipe = await repo.get_recipe(recipe_id)
    if recipe is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe


@router.delete("/{recipe_id}", status_code=204)
async def delete_recipe(recipe_id: UUID) -> None:
    """Delete a saved recipe."""
    repo = await get_repository()
    deleted = await repo.delete_recipe(recipe_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Recipe not found")


@router.put("/{recipe_id}", response_model=RecipeCard)
async def update_recipe_endpoint(
    recipe_id: UUID, request: SaveRecipeRequest
) -> RecipeCard:
    """Update an existing saved recipe."""
    from bubbly_chef.models.recipe import Ingredient

    repo = await get_repository()
    existing = await repo.get_recipe(recipe_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Recipe not found")

    if request.title:
        existing.title = request.title
    if request.description is not None:
        existing.description = request.description
    if request.ingredients is not None:
        existing.ingredients = [
            Ingredient(
                name=ing.get("name", ""),
                quantity=ing.get("quantity"),
                unit=ing.get("unit"),
            )
            for ing in request.ingredients
        ]
    if request.instructions is not None:
        existing.instructions = request.instructions
    if request.cuisine is not None:
        existing.cuisine = request.cuisine
    if request.meal_type is not None:
        existing.meal_type = request.meal_type
    if request.dietary_tags is not None:
        existing.dietary_tags = request.dietary_tags
    if request.difficulty is not None:
        existing.difficulty = request.difficulty
    if request.prep_time_minutes is not None:
        existing.prep_time_minutes = request.prep_time_minutes
    if request.cook_time_minutes is not None:
        existing.cook_time_minutes = request.cook_time_minutes
    if request.total_time_minutes is not None:
        existing.total_time_minutes = request.total_time_minutes
    if request.servings is not None:
        existing.servings = request.servings

    existing.updated_at = datetime.now(UTC)
    updated = await repo.update_recipe(existing)
    logger.info(f"Recipe updated: {updated.title} ({updated.id})")
    return updated


@router.post("/{recipe_id}/refine", response_model=RecipeCard)
async def refine_recipe(recipe_id: UUID, request: RefineRecipeRequest) -> RecipeCard:
    """
    Refine an existing saved recipe via AI instruction.

    Examples:
    - "make it vegetarian"
    - "reduce cook time to 20 minutes"
    - "add more protein"
    """
    repo = await get_repository()
    recipe = await repo.get_recipe(recipe_id)
    if recipe is None:
        raise HTTPException(status_code=404, detail="Recipe not found")

    ai_manager = get_ai_manager()

    prompt = (
        f"Refine this recipe: '{recipe.title}'.\n"
        f"Current description: {recipe.description or 'N/A'}\n"
        f"Ingredients: {', '.join(i.name for i in recipe.ingredients)}\n\n"
        f"User instruction: {request.instruction}\n\n"
        "Return a complete updated recipe as JSON matching the RecipeCard schema. "
        "Keep the same id. Only change what is necessary per the instruction."
    )

    try:
        updated = await ai_manager.complete(prompt, RecipeCard)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI refinement failed: {e}") from e

    if not isinstance(updated, RecipeCard):
        raise HTTPException(status_code=500, detail="AI did not return a valid recipe")

    # Preserve identity fields
    updated.id = recipe.id
    updated.created_at = recipe.created_at
    updated.updated_at = datetime.now(UTC)

    await repo.update_recipe(updated)
    return updated
