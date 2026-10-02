"""Recipe-related Pydantic models."""

import logging
import re
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import (
    BaseModel,
    Field,
    ValidationError,
    ValidationInfo,
    field_validator,
    model_validator,
)

from bubbly_chef.domain.uncountable import clean_ingredient_amount

logger = logging.getLogger(__name__)


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

    @model_validator(mode="after")
    def _no_count_of_an_uncountable_food(self) -> "Ingredient":
        """A spice, powder or liquid is never "0.25 count" (issue #892).

        The model sometimes writes `unit: "count"` for "1/4 tsp cinnamon" or "a pinch
        of pepper". The real unit is gone, so the amount is dropped (the line reads
        "to taste") rather than shown as a count. Real units ("tsp", "pinch") stay.
        """
        quantity, unit = clean_ingredient_amount(self.name, self.quantity, self.unit)
        if (quantity, unit) != (self.quantity, self.unit):
            self.quantity = quantity
            self.unit = unit
        return self


# =============================================================================
# Structured steps (issue #648)
#
# See issue #647's "Structured steps" section for the field rules and
# validation this implements. The wire/persisted shape is `StructuredStep`;
# `StepMetadata` is the narrower shape a model call supplies (no `text` --
# the caller always fills that in from the matching `instructions` entry, so
# the two can never drift apart). `build_structured_steps` zips the two
# together and is the single place every generation path and the lazy-
# upgrade ensure route (services/structured_steps.py) goes through.
# =============================================================================

_MAX_LABEL_LENGTH = 60

_DURATION_PHRASE_RE = re.compile(
    r"\b(\d+)(?:\s*(?:-|–|—|to)\s*(\d+))?\s*(hours?|hrs?|minutes?|mins?)\b",
    re.IGNORECASE,
)


def _estimate_duration_minutes(text: str) -> int:
    """Best-effort duration estimate from a duration phrase in `text`.

    Used only when the model omits `duration_minutes` for a step. Falls back
    to 3 minutes when no phrase is found, per issue #647's "Structured
    steps" validation rules. Deliberately simple -- the richer duration
    parser that drives the app's regex timer chips lives client-side
    (nextjs/src/lib/timers.ts); this only needs one reasonable number, not
    every accepted phrasing.
    """
    match = _DURATION_PHRASE_RE.search(text)
    if not match:
        return 3
    low = int(match.group(1))
    high = int(match.group(2)) if match.group(2) else low
    minutes = (low + high) / 2
    if match.group(3).lower().startswith(("hour", "hr")):
        minutes *= 60
    return max(1, min(240, round(minutes)))


class StepMetadata(BaseModel):
    """Per-step metadata a model call supplies for structured steps.

    Paired positionally with an `instructions` entry by `build_structured_steps`,
    which supplies the actual step text -- the model is never asked for
    `text` itself, so persisted step text can never drift from `instructions`.
    Every field but `label` may be omitted; `StructuredStep`'s validators
    fill in the rest.
    """

    label: str = Field(description="A short imperative, 2-5 words, e.g. 'Boil the pasta'")
    ongoing_label: str | None = Field(
        default=None,
        description=(
            "A short subject+verb clause for a step in progress, e.g. "
            "'the pasta boils'. Required for hands-off steps, optional for hands-on ones."
        ),
    )
    duration_minutes: int | None = Field(
        default=None, description="Whole minutes, 1-240. Omit if genuinely unknown."
    )
    hands_on: bool | None = Field(
        default=None, description="True if the cook must be actively engaged for this step."
    )
    depends_on: list[int] | None = Field(
        default=None,
        description=(
            "Indices of earlier steps in this recipe that must finish first. "
            "Omit for 'just the previous step'; use [] for 'can start at the beginning'."
        ),
    )
    exclusive: list[str] = Field(
        default_factory=list, description="Kitchen-limit tags this step needs, usually empty."
    )


class StructuredStep(BaseModel):
    """One structured recipe step -- the persisted/wire shape (snake_case).

    Field rules (issue #647's "Structured steps" section):
    - `text` is identical to the matching `instructions` entry.
    - A missing `duration_minutes` is estimated from a duration phrase in
      `text`, or else set to 3, and flagged via `duration_estimated`.
    - A missing `hands_on` becomes True (the conservative choice -- it keeps
      the cook busy rather than letting a step silently start a timer).
    - `depends_on` is always an explicit list after validation: a missing
      (`None`) input means "the previous step" (`[index - 1]`, or `[]` for
      the first step); an index that isn't strictly earlier than this step
      is dropped, which makes a dependency cycle impossible by construction.
    - `label` and `ongoing_label` are trimmed and capped.

    The "previous step" default and the earlier-than-self filter both need
    this step's own position in the list, which isn't a field on the step
    itself -- so `build_structured_steps` passes it in as Pydantic validation
    context (`{"index": i}`). Constructing a `StructuredStep` with no context
    (e.g. reconstructing an already-persisted step read back from the DB,
    where `depends_on` is already an explicit, validated list) skips the
    index-dependent normalization and trusts the stored list as-is.
    """

    text: str
    label: str
    ongoing_label: str | None = None
    duration_minutes: int = Field(ge=1, le=240)
    duration_estimated: bool = False
    hands_on: bool = True
    depends_on: list[int] = Field(default_factory=list)
    exclusive: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _apply_defaults(cls, data: object, info: ValidationInfo) -> object:
        if not isinstance(data, dict):
            return data
        data = dict(data)

        duration = data.get("duration_minutes")
        if duration is None:
            data["duration_minutes"] = _estimate_duration_minutes(str(data.get("text") or ""))
            data["duration_estimated"] = True
        elif isinstance(duration, (int, float)) and not isinstance(duration, bool):
            # Clamp rather than reject: one out-of-range step ("marinate
            # overnight" ~480 min) would otherwise fail the whole set, and on
            # the ensure path re-fire a model call on every cook-mode open
            # (PR #655 review). A clamped value is flagged as estimated.
            clamped = max(1, min(240, round(duration)))
            data["duration_minutes"] = clamped
            data["duration_estimated"] = bool(data.get("duration_estimated")) or clamped != duration
        else:
            data.setdefault("duration_estimated", False)

        if data.get("hands_on") is None:
            data["hands_on"] = True

        index = info.context.get("index") if info.context else None
        depends_on = data.get("depends_on")
        if depends_on is None:
            data["depends_on"] = [index - 1] if index else []
        elif index is not None:
            data["depends_on"] = [d for d in depends_on if isinstance(d, int) and d < index]
        else:
            data["depends_on"] = list(depends_on)

        return data

    @field_validator("label", "ongoing_label", mode="before")
    @classmethod
    def _trim_and_cap_label(cls, v: object) -> object:
        if not isinstance(v, str):
            return v
        return v.strip()[:_MAX_LABEL_LENGTH]


def build_structured_steps(
    steps_meta: Sequence[StepMetadata | dict[str, Any]],
    instructions: Sequence[str],
) -> list[StructuredStep] | None:
    """Zip model-supplied step metadata with instruction text into validated steps.

    Returns `None` -- "not yet structured" -- when the count doesn't match
    `instructions` (issue #647's "reject as a whole" rule) or any step fails
    validation. Callers persist `None` rather than raising: malformed
    structured output from a step-metadata call must never fail the whole
    recipe generation or the ensure route (issue #648).
    """
    if len(steps_meta) != len(instructions):
        logger.warning(
            "Structured steps count (%d) does not match instructions count (%d); "
            "discarding structured steps",
            len(steps_meta),
            len(instructions),
        )
        return None

    built: list[StructuredStep] = []
    try:
        for index, (meta, text) in enumerate(zip(steps_meta, instructions, strict=True)):
            raw: dict[str, Any] = meta.model_dump() if isinstance(meta, StepMetadata) else dict(meta)
            raw["text"] = text
            built.append(StructuredStep.model_validate(raw, context={"index": index}))
    except ValidationError as e:
        logger.warning("Structured steps failed validation; discarding: %s", e)
        return None

    return built


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
    steps: list[StructuredStep] | None = Field(
        default=None,
        description=(
            "Structured steps alongside `instructions` (issue #648). `None` means "
            "not yet structured -- derived lazily via POST /v1/recipes/{id}/steps/ensure."
        ),
    )

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
    diets_set_aside: list[str] = Field(
        default_factory=list,
        description=(
            "Stored diets this card was made without (issue #544); "
            "internal, never saved to the recipes table"
        ),
    )
    exclusions_set_aside: list[str] = Field(
        default_factory=list,
        description=(
            "Exclusions a later tweak deliberately added back (issue #544); "
            "internal, never saved to the recipes table"
        ),
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


class DietChanges(BaseModel):
    """A diet the user asked chat to stop applying, as the extractor reports it (#687).

    The only thing that ever clears a remembered diet. Code acts on this field and
    never on the message text: pattern-matching "not vegetarian" misfired on "I'm not
    a vegetarian but my partner is", "we're not vegan tonight", "no longer vegan?" and
    "that's not vegetarian!". Filled only by an explicit, first-person, declarative
    removal; left empty for everything else, because keeping a diet is the safe
    direction. Never applied to the profile's dietary preferences.
    """

    remove: list[str] = Field(
        default_factory=list,
        description=(
            "Diet labels the user says they no longer follow, worded as the user said "
            "them or as the remembered diets below name them"
        ),
    )
    scope: Literal["conversation", "this_request"] = Field(
        default="this_request",
        description=(
            "'conversation' for a lasting change ('I'm not vegetarian any more'); "
            "'this_request' for a one-off ('just tonight', 'this once')"
        ),
    )

    @field_validator("scope", mode="before")
    @classmethod
    def _unknown_scope_is_this_request(cls, value: Any) -> Any:
        """An unknown scope is read as the narrow one, not as a failed extraction.

        A failed validation would throw away every other constraint the model
        extracted for the turn, and would fall back to the wider reading.
        """
        return value if value in ("conversation", "this_request") else "this_request"


class RecipeConstraints(BaseModel):
    """Extracted from user message via small structured LLM call."""

    cuisine: str | None = None
    meal_type: str | None = None  # breakfast, lunch, dinner, snack — None means any dish (#408)
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
    kitchen_limits: list[str] = Field(
        default_factory=list,
        description=(
            "Short phrases naming equipment the user says is limited or shared, "
            "e.g. 'one pan', 'one pot', 'no oven' (issue #650). Mapped to exclusive "
            "resource tags by bubbly_chef.domain.kitchen_limits.map_kitchen_limits_to_tags "
            "and carried on a meal's constraints so the scheduler can keep steps "
            "that share equipment from overlapping. Not an equipment model -- only "
            "what the user actually stated."
        ),
    )

    diet_changes: DietChanges | None = Field(
        default=None,
        description=(
            "Set ONLY when the user plainly says, about themselves, that they no longer "
            "follow a diet (issue #687). Null for everything else, including someone "
            "else's diet, questions, complaints about a dish, and one-off dish choices "
            "that name no diet change. A per-turn instruction: it is read once by "
            "extract_recipe_constraints and never persisted in the session."
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

    proposal_type: Literal["recipe_card"] = "recipe_card"
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
