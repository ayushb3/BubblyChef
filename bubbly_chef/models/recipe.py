"""Recipe-related Pydantic models."""

from datetime import datetime
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, HttpUrl


class Ingredient(BaseModel):
    """An ingredient in a recipe."""
    
    name: str = Field(description="Ingredient name")
    quantity: float | None = Field(default=None, description="Amount needed")
    unit: str | None = Field(default=None, description="Unit of measurement")
    preparation: str | None = Field(
        default=None,
        description="Preparation notes (e.g., 'diced', 'minced')"
    )
    optional: bool = Field(default=False, description="Whether ingredient is optional")
    substitutes: list[str] = Field(
        default_factory=list,
        description="Possible substitutes for this ingredient"
    )


class RecipeCard(BaseModel):
    """A recipe card with all details."""
    
    id: UUID = Field(default_factory=uuid4)
    title: str = Field(description="Recipe title")
    description: str | None = Field(default=None, description="Brief description")
    source_url: str | None = Field(default=None, description="Original recipe URL")
    image_url: str | None = Field(default=None, description="Recipe image URL")
    
    # Timing
    prep_time_minutes: int | None = Field(default=None)
    cook_time_minutes: int | None = Field(default=None)
    total_time_minutes: int | None = Field(default=None)
    
    # Servings
    servings: int | None = Field(default=None)
    
    # Content
    ingredients: list[Ingredient] = Field(default_factory=list)
    instructions: list[str] = Field(
        default_factory=list,
        description="Step-by-step instructions"
    )
    
    # Metadata
    cuisine: str | None = Field(default=None, description="Cuisine type")
    meal_type: str | None = Field(
        default=None,
        description="Meal type (breakfast, lunch, dinner, snack)"
    )
    dietary_tags: list[str] = Field(
        default_factory=list,
        description="Dietary tags (vegan, gluten-free, etc.)"
    )
    difficulty: str | None = Field(
        default=None,
        description="Difficulty level (easy, medium, hard)"
    )
    
    # Notes
    tips: list[str] = Field(default_factory=list, description="Cooking tips")
    notes: str | None = Field(default=None, description="Additional notes")
    
    # Timestamps
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class RecipeCardProposal(BaseModel):
    """A proposal containing a recipe card."""
    
    recipe: RecipeCard = Field(description="The proposed recipe card")
    source_url: str | None = Field(
        default=None,
        description="URL the recipe was extracted from"
    )
    source_text: str | None = Field(
        default=None,
        description="Original text/transcript used"
    )
    pantry_match_score: float | None = Field(
        default=None,
        ge=0.0, le=1.0,
        description="How well recipe ingredients match current pantry"
    )
    missing_ingredients: list[str] = Field(
        default_factory=list,
        description="Ingredients not found in pantry"
    )
    available_ingredients: list[str] = Field(
        default_factory=list,
        description="Ingredients available in pantry"
    )
