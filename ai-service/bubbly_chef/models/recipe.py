"""Recipe-related Pydantic models."""

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, field_validator


class Ingredient(BaseModel):
    """An ingredient in a recipe."""

    name: str = Field(description="Ingredient name")
    quantity: float | None = Field(default=None, description="Amount needed")
    unit: str | None = Field(default=None, description="Unit of measurement")
    preparation: str | None = Field(
        default=None, description="Preparation notes (e.g., 'diced', 'minced')"
    )
    optional: bool = Field(default=False, description="Whether ingredient is optional")
    substitutes: list[str] = Field(
        default_factory=list, description="Possible substitutes for this ingredient"
    )

    @field_validator("unit", mode="before")
    @classmethod
    def _strip_size_adjective_from_unit(cls, v: object) -> object:
        """Size adjectives ('medium', 'large', 'small', etc.) are not units.

        LLMs sometimes write them into the unit field (e.g. "2 medium avocados"
        becomes unit="medium"). Strip them to None so the cook matcher sees no
        unit and normalises to count, preventing spurious unit_conflicts (#223).
        """
        if not isinstance(v, str):
            return v
        # Import here to avoid a top-level circular dependency risk; the module
        # is lightweight and the import is cached after the first call.
        from bubbly_chef.domain.normalizer import SIZE_ADJECTIVE_UNITS

        return None if v.lower().strip() in SIZE_ADJECTIVE_UNITS else v


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
    instructions: list[str] = Field(default_factory=list, description="Step-by-step instructions")

    # Metadata
    cuisine: str | None = Field(default=None, description="Cuisine type")
    meal_type: str | None = Field(
        default=None, description="Meal type (breakfast, lunch, dinner, snack)"
    )
    dietary_tags: list[str] = Field(
        default_factory=list, description="Dietary tags (vegan, gluten-free, etc.)"
    )
    difficulty: str | None = Field(
        default=None, description="Difficulty level (easy, medium, hard)"
    )

    # Source metadata
    source_type: str = Field(
        default="chat", description="How the recipe was added: chat | url | video | manual"
    )
    source_title: str | None = Field(default=None, description="Human-readable source label")
    thumbnail_url: str | None = Field(default=None, description="Recipe thumbnail image URL")
    is_draft: bool = Field(default=False, description="Draft — not yet confirmed by user")

    # Notes
    tips: list[str] = Field(default_factory=list, description="Cooking tips")
    notes: str | None = Field(default=None, description="Additional notes")

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class RecipeConstraints(BaseModel):
    """Extracted from user message via small structured LLM call."""

    cuisine: str | None = None
    meal_type: str | None = None  # breakfast, lunch, dinner, snack — defaulted from time of day
    mood: str | None = None
    dietary: list[str] = Field(default_factory=list)
    max_time_minutes: int | None = None
    servings: int | None = None
    skill_level: str | None = None
    excluded_ingredients: list[str] = Field(default_factory=list)
    preferred_ingredients: list[str] = Field(
        default_factory=list,
        description="Ingredients the user would like included (soft preference)",
    )
    must_use_ingredients: list[str] = Field(
        default_factory=list,
        description=(
            "Ingredients the user explicitly wants to use up — e.g. 'what can I make "
            "with my eggs before they go bad'. Stronger than preferred_ingredients: "
            "every suggestion must actually use these."
        ),
    )
    use_pantry: bool | None = Field(
        default=None,
        description=(
            "Whether to ground suggestions in the user's pantry. False when the user "
            "asks us not to look at it ('don't look at my pantry', 'ignore what I "
            "have'); True when they ask us to start using it again. None means they "
            "did not say either way, which is what lets a previous turn's choice "
            "survive instead of being overwritten by every silent turn."
        ),
    )

    @property
    def pantry_grounded(self) -> bool:
        """True unless the user explicitly opted out. None (unstated) means grounded."""
        return self.use_pantry is not False


class IngredientAvailability(BaseModel):
    """Per-ingredient pantry match status for a grounded recipe."""

    name: str
    status: Literal["have", "missing", "substitute", "assumed"]
    pantry_item_name: str | None = None
    substitute_note: str | None = None


class RecipeCardProposal(BaseModel):
    """A proposal containing a recipe card."""

    recipe: RecipeCard = Field(description="The proposed recipe card")
    source_url: str | None = Field(default=None, description="URL the recipe was extracted from")
    source_text: str | None = Field(default=None, description="Original text/transcript used")
    pantry_match_score: float | None = Field(
        default=None, ge=0.0, le=1.0, description="How well recipe ingredients match current pantry"
    )
    missing_ingredients: list[str] = Field(
        default_factory=list, description="Ingredients not found in pantry"
    )
    available_ingredients: list[str] = Field(
        default_factory=list, description="Ingredients available in pantry"
    )
