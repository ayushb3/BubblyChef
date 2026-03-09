"""Recipe generation service using AI."""

import asyncio
from pydantic import BaseModel, Field

from bubbly_chef.ai import AIManager
from bubbly_chef.ai.provider import StructuredOutputError
from bubbly_chef.domain.normalizer import normalize_food_name
from bubbly_chef.models.pantry import PantryItem
from bubbly_chef.models.recipe import RecipeCard, Ingredient


# Maximum retry attempts for AI generation
MAX_RETRIES = 2


class AIRecipeIngredient(BaseModel):
    """Ingredient structure for AI output."""

    name: str = Field(description="Ingredient name")
    quantity: float | None = Field(default=None, description="Amount needed")
    unit: str | None = Field(default=None, description="Unit of measurement")
    preparation: str | None = Field(default=None, description="Preparation notes")
    optional: bool = Field(default=False, description="If ingredient is optional")


class AIRecipeOutput(BaseModel):
    """Schema for LLM recipe generation output."""

    title: str = Field(description="Recipe title")
    description: str = Field(description="Brief description of the dish")
    prep_time_minutes: int | None = Field(default=None)
    cook_time_minutes: int | None = Field(default=None)
    servings: int | None = Field(default=None)
    ingredients: list[AIRecipeIngredient]
    instructions: list[str] = Field(description="Step-by-step instructions")
    tips: list[str] = Field(default_factory=list, description="Cooking tips")
    cuisine: str | None = Field(default=None, description="Cuisine type")
    difficulty: str | None = Field(default=None, description="easy, medium, or hard")


class IngredientStatus(BaseModel):
    """Status of an ingredient relative to pantry."""

    ingredient_name: str
    status: str = Field(description="have, partial, or missing")
    pantry_item_id: str | None = None
    pantry_item_name: str | None = None
    have_quantity: float | None = None
    have_unit: str | None = None
    need_quantity: float | None = None
    need_unit: str | None = None


class GenerateRecipeRequest(BaseModel):
    """Request for recipe generation."""

    prompt: str = Field(description="User's recipe request")
    constraints: dict | None = Field(default=None, description="Optional constraints")
    previous_recipe_context: str | None = Field(
        default=None, description="Previous recipe for follow-up requests"
    )


class GenerateRecipeResponse(BaseModel):
    """Response from recipe generation."""

    recipe: RecipeCard
    ingredients_status: list[IngredientStatus]
    missing_count: int
    have_count: int
    partial_count: int
    pantry_match_score: float = Field(ge=0.0, le=1.0)


RECIPE_GENERATION_PROMPT = """You are a helpful cooking assistant. Generate a recipe based on the user's request.

## User's Pantry
The user has these ingredients available:
{pantry_items_formatted}

## Items Expiring Soon (prioritize using these!)
{expiring_items}

## User Request
{user_prompt}

## Constraints
{constraints}

Generate a recipe that:
1. Uses ingredients from the user's pantry when possible
2. Prioritizes items that are expiring soon
3. Clearly lists all ingredients with quantities and units
4. Provides clear, numbered step-by-step instructions
5. Estimates prep and cook time realistically

IMPORTANT: You MUST return actual recipe data, NOT a schema or template. Generate a real recipe with actual values.

Example of what to return:
{{
  "title": "Honey Garlic Chicken Stir-Fry",
  "description": "A quick and delicious stir-fry with tender chicken and crisp vegetables",
  "prep_time_minutes": 10,
  "cook_time_minutes": 15,
  "servings": 4,
  "ingredients": [
    {{"name": "chicken breast", "quantity": 1, "unit": "lb", "preparation": "sliced thin", "optional": false}},
    {{"name": "garlic", "quantity": 3, "unit": "cloves", "preparation": "minced", "optional": false}},
    {{"name": "soy sauce", "quantity": 3, "unit": "tablespoons", "preparation": null, "optional": false}}
  ],
  "instructions": [
    "Slice chicken breast into thin strips and season with salt and pepper",
    "Mince garlic and prepare your vegetables",
    "Heat oil in a large wok or skillet over high heat"
  ],
  "tips": ["Add extra honey for a sweeter sauce", "Use a very hot wok for best results"],
  "cuisine": "Asian",
  "difficulty": "easy"
}}

Now generate YOUR recipe following this same structure with ACTUAL VALUES (not the schema).
"""

RECIPE_FOLLOWUP_PROMPT = """You are a helpful cooking assistant. The user wants to modify the previous recipe.

## Previous Recipe
{previous_recipe}

## User's Pantry
{pantry_items_formatted}

## User's Modification Request
{user_prompt}

Modify the recipe according to the user's request. Keep the same format but adjust ingredients, instructions, or other aspects as needed.

IMPORTANT: You MUST return actual recipe data with real values, NOT a schema or template.

Example of what to return:
{{
  "title": "Spicy Honey Garlic Chicken Stir-Fry",
  "description": "A quick and delicious stir-fry with tender chicken, crisp vegetables, and a spicy kick",
  "prep_time_minutes": 10,
  "cook_time_minutes": 15,
  "servings": 4,
  "ingredients": [
    {{"name": "chicken breast", "quantity": 1, "unit": "lb", "preparation": "sliced thin", "optional": false}},
    {{"name": "garlic", "quantity": 4, "unit": "cloves", "preparation": "minced", "optional": false}},
    {{"name": "red pepper flakes", "quantity": 1, "unit": "teaspoon", "preparation": null, "optional": false}},
    {{"name": "soy sauce", "quantity": 3, "unit": "tablespoons", "preparation": null, "optional": false}}
  ],
  "instructions": [
    "Slice chicken breast into thin strips and season with salt and pepper",
    "Mince garlic and add red pepper flakes to your prep",
    "Heat oil in a large wok or skillet over high heat",
    "Add chicken and stir-fry for 5-6 minutes until cooked through"
  ],
  "tips": ["Adjust red pepper flakes to taste", "Use a very hot wok for best results"],
  "cuisine": "Asian",
  "difficulty": "easy"
}}

Now generate YOUR modified recipe following this same structure with ACTUAL VALUES (not the schema).
"""


def format_pantry_for_prompt(pantry_items: list[PantryItem]) -> str:
    """Format pantry items for AI prompt context."""
    if not pantry_items:
        return "No items in pantry."

    lines = []
    for item in pantry_items:
        line = f"- {item.name}"
        if item.quantity and item.unit:
            line += f" ({item.quantity} {item.unit})"
        line += f" [{item.location.value}]"
        lines.append(line)

    return "\n".join(lines)


def format_expiring_items(pantry_items: list[PantryItem]) -> str:
    """Format expiring items with emphasis."""
    expiring = [
        item for item in pantry_items
        if item.is_expiring_soon or item.is_expired
    ]

    if not expiring:
        return "No items expiring soon."

    lines = []
    for item in expiring:
        days = item.days_until_expiry
        if days is not None:
            if days < 0:
                urgency = "EXPIRED!"
            elif days == 0:
                urgency = "expires TODAY!"
            elif days == 1:
                urgency = "expires tomorrow!"
            else:
                urgency = f"expires in {days} days"
            lines.append(f"- ⚠️ {item.name} - {urgency}")

    return "\n".join(lines) if lines else "No items expiring soon."


def format_constraints(constraints: dict | None) -> str:
    """Format constraints for prompt."""
    if not constraints:
        return "None specified."

    parts = []
    if constraints.get("max_time_minutes"):
        parts.append(f"- Maximum total time: {constraints['max_time_minutes']} minutes")
    if constraints.get("cuisine"):
        parts.append(f"- Cuisine: {constraints['cuisine']}")
    if constraints.get("dietary"):
        dietary = constraints["dietary"]
        if isinstance(dietary, list):
            parts.append(f"- Dietary requirements: {', '.join(dietary)}")
        else:
            parts.append(f"- Dietary requirements: {dietary}")
    if constraints.get("use_expiring"):
        parts.append("- Prioritize using expiring ingredients")
    if constraints.get("servings"):
        parts.append(f"- Servings: {constraints['servings']}")

    return "\n".join(parts) if parts else "None specified."


def format_recipe_for_context(recipe: RecipeCard) -> str:
    """Format a recipe for use as context in follow-up prompts."""
    lines = [
        f"Title: {recipe.title}",
        f"Description: {recipe.description or 'N/A'}",
        "",
        "Ingredients:",
    ]

    for ing in recipe.ingredients:
        ing_line = f"- {ing.name}"
        if ing.quantity and ing.unit:
            ing_line = f"- {ing.quantity} {ing.unit} {ing.name}"
        if ing.preparation:
            ing_line += f", {ing.preparation}"
        if ing.optional:
            ing_line += " (optional)"
        lines.append(ing_line)

    lines.append("")
    lines.append("Instructions:")
    for i, step in enumerate(recipe.instructions, 1):
        lines.append(f"{i}. {step}")

    return "\n".join(lines)


def match_ingredient_to_pantry(
    ingredient: Ingredient, pantry_items: list[PantryItem]
) -> IngredientStatus:
    """Match a recipe ingredient to pantry items."""
    ingredient_normalized = normalize_food_name(ingredient.name)

    # Try to find a matching pantry item
    best_match: PantryItem | None = None
    best_score = 0.0

    for item in pantry_items:
        # Exact normalized match
        if item.name_normalized == ingredient_normalized:
            best_match = item
            best_score = 1.0
            break

        # Partial match - ingredient is substring of pantry item or vice versa
        if (
            ingredient_normalized in item.name_normalized
            or item.name_normalized in ingredient_normalized
        ):
            score = 0.7
            if score > best_score:
                best_match = item
                best_score = score

        # Word overlap
        ing_words = set(ingredient_normalized.split())
        item_words = set(item.name_normalized.split())
        overlap = len(ing_words & item_words)
        if overlap > 0:
            score = overlap / max(len(ing_words), len(item_words)) * 0.6
            if score > best_score:
                best_match = item
                best_score = score

    if best_match is None or best_score < 0.3:
        return IngredientStatus(
            ingredient_name=ingredient.name,
            status="missing",
            need_quantity=ingredient.quantity,
            need_unit=ingredient.unit,
        )

    # We have a match - determine if we have enough
    # For now, simplified logic: if we have the item, assume we have it
    # (Unit conversion would be needed for proper partial matching)
    if ingredient.quantity is not None and best_match.quantity is not None:
        # Same unit comparison (simplified)
        if (
            ingredient.unit == best_match.unit
            and best_match.quantity < ingredient.quantity
        ):
            return IngredientStatus(
                ingredient_name=ingredient.name,
                status="partial",
                pantry_item_id=best_match.id,
                pantry_item_name=best_match.name,
                have_quantity=best_match.quantity,
                have_unit=best_match.unit,
                need_quantity=ingredient.quantity,
                need_unit=ingredient.unit,
            )

    return IngredientStatus(
        ingredient_name=ingredient.name,
        status="have",
        pantry_item_id=best_match.id,
        pantry_item_name=best_match.name,
        have_quantity=best_match.quantity,
        have_unit=best_match.unit,
        need_quantity=ingredient.quantity,
        need_unit=ingredient.unit,
    )


def calculate_pantry_match_score(statuses: list[IngredientStatus]) -> float:
    """Calculate how well pantry matches recipe ingredients."""
    if not statuses:
        return 0.0

    score = 0.0
    for status in statuses:
        if status.status == "have":
            score += 1.0
        elif status.status == "partial":
            score += 0.5
        # missing = 0

    return score / len(statuses)


async def generate_recipe(
    prompt: str,
    pantry_items: list[PantryItem],
    ai_manager: AIManager,
    constraints: dict | None = None,
    previous_recipe: RecipeCard | None = None,
) -> GenerateRecipeResponse:
    """
    Generate a recipe using AI based on prompt and pantry context.

    Includes retry logic for intermittent AI failures.

    Args:
        prompt: User's recipe request
        pantry_items: User's current pantry items
        ai_manager: AI manager for LLM calls
        constraints: Optional constraints (max_time, cuisine, dietary)
        previous_recipe: Previous recipe for follow-up modifications

    Returns:
        Generated recipe with ingredient availability status

    Raises:
        StructuredOutputError: If AI fails after all retries
    """
    # Format pantry context
    pantry_formatted = format_pantry_for_prompt(pantry_items)
    expiring_formatted = format_expiring_items(pantry_items)
    constraints_formatted = format_constraints(constraints)

    # Choose prompt based on whether this is a follow-up
    if previous_recipe:
        full_prompt = RECIPE_FOLLOWUP_PROMPT.format(
            previous_recipe=format_recipe_for_context(previous_recipe),
            pantry_items_formatted=pantry_formatted,
            user_prompt=prompt,
        )
    else:
        full_prompt = RECIPE_GENERATION_PROMPT.format(
            pantry_items_formatted=pantry_formatted,
            expiring_items=expiring_formatted,
            user_prompt=prompt,
            constraints=constraints_formatted,
        )

    # Retry logic for AI generation
    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            # Call AI to generate recipe
            result = await ai_manager.complete(
                prompt=full_prompt,
                response_schema=AIRecipeOutput,
                temperature=0.8,  # Higher temperature for creativity
            )

            # Success! Break out of retry loop
            break

        except StructuredOutputError as e:
            last_error = e
            if attempt < MAX_RETRIES:
                # Wait briefly before retry (exponential backoff)
                wait_time = 2 ** attempt  # 1s, 2s, 4s
                await asyncio.sleep(wait_time)
                continue
            else:
                # All retries exhausted
                raise StructuredOutputError(
                    f"Failed to generate recipe after {MAX_RETRIES + 1} attempts. "
                    f"Last error: {str(last_error)}"
                ) from e

    # Convert AI output to RecipeCard
    ingredients = [
        Ingredient(
            name=ing.name,
            quantity=ing.quantity,
            unit=ing.unit,
            preparation=ing.preparation,
            optional=ing.optional,
            substitutes=[],
        )
        for ing in result.ingredients
    ]

    # Calculate total time
    total_time = None
    if result.prep_time_minutes and result.cook_time_minutes:
        total_time = result.prep_time_minutes + result.cook_time_minutes
    elif result.prep_time_minutes:
        total_time = result.prep_time_minutes
    elif result.cook_time_minutes:
        total_time = result.cook_time_minutes

    recipe = RecipeCard(
        title=result.title,
        description=result.description,
        prep_time_minutes=result.prep_time_minutes,
        cook_time_minutes=result.cook_time_minutes,
        total_time_minutes=total_time,
        servings=result.servings,
        ingredients=ingredients,
        instructions=result.instructions,
        tips=result.tips,
        cuisine=result.cuisine,
        difficulty=result.difficulty,
    )

    # Match ingredients to pantry
    statuses = [
        match_ingredient_to_pantry(ing, pantry_items) for ing in recipe.ingredients
    ]

    # Count statuses
    have_count = sum(1 for s in statuses if s.status == "have")
    partial_count = sum(1 for s in statuses if s.status == "partial")
    missing_count = sum(1 for s in statuses if s.status == "missing")

    # Calculate match score
    match_score = calculate_pantry_match_score(statuses)

    return GenerateRecipeResponse(
        recipe=recipe,
        ingredients_status=statuses,
        missing_count=missing_count,
        have_count=have_count,
        partial_count=partial_count,
        pantry_match_score=match_score,
    )
