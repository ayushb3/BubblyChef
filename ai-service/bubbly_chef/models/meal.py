"""Meal-plan models -- the `meal_plan` chat intent's option and pick stages.

See issue #647's "Meal schema" and "API contracts" sections, and issue #650's
wire contract pinned at `docs/plans/2026-09-29-issue-650-meal-contract.md`,
which both halves (ai-service and Next.js) build against. Field names here
are the exact wire shape (snake_case on the wire, matched field-for-field by
these Python names) -- do not rename without updating that doc.

Issue #651 PR B ("Make it a meal", pinned at
`docs/plans/2026-09-30-issue-651-b-make-it-a-meal-contract.md`) adds the
fixed-main shapes: the request payload (`MealFixedMainRecipePayload`), the
retained `MealFixedMain`, and the wire echo (`MealFixedMainEcho`). Every
change to an existing model is additive with a default, so an older retained
session still validates.
"""

from typing import Any, Literal, Self
from uuid import uuid4

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from bubbly_chef.models.recipe import Ingredient, RecipeCard

# ---------------------------------------------------------------------------
# Wire models -- option stage (`proposal_type: "meal_options"`)
# ---------------------------------------------------------------------------


class MealDishOutline(BaseModel):
    """One dish within a meal option -- not yet a full recipe.

    Exactly what the option card needs to render: a name, its role, a
    handful of key ingredients, and estimated times. `key_ingredients` is
    deliberately short (the model is asked for 3-6) -- it drives the
    deterministic pantry-coverage match in code, not a full ingredient list.

    `blurb` (issue #652) is new: a one-sentence description, used by the
    side-alternatives route's mini cards. It's `""` when absent -- the option
    stage's dishes never set it, so existing option-card behavior is
    unchanged.
    """

    role: Literal["main", "side"]
    name: str
    blurb: str = ""
    key_ingredients: list[str] = Field(default_factory=list)
    est_total_minutes: int | None = None
    est_hands_on_minutes: int | None = None


class MealCoverage(BaseModel):
    """Deterministic pantry coverage for one meal option, computed in code
    (never by the model) via the cook matcher's synonym-table path."""

    pantry_items_used: int = 0
    to_buy: list[str] = Field(default_factory=list)


class MealConstraintsEcho(BaseModel):
    """A meal's constraints, carried on both the option and the pick proposal.

    `kitchen_limits` are the phrases as the user stated them (extracted by
    the existing constraint extraction); `exclusive_tags` are those phrases
    mapped through `bubbly_chef.domain.kitchen_limits.map_kitchen_limits_to_tags`.
    `recipe_constraints` is the full `RecipeConstraints` extraction, echoed
    so a later regeneration (e.g. swapping a side, a later ticket) doesn't
    need to re-extract it.
    """

    kitchen_limits: list[str] = Field(default_factory=list)
    exclusive_tags: list[str] = Field(default_factory=list)
    recipe_constraints: dict[str, Any] = Field(default_factory=dict)


class MealOption(BaseModel):
    """One of the three meal outlines shown as a card before the user picks.

    `option_id` is stable only within the conversation -- it is how the pick
    turn's `context.meal_option_id` resolves back to this option (never
    fuzzy-matched from text, unlike a brainstorm re-pick).
    """

    option_id: str
    title: str
    blurb: str | None = None
    dishes: list[MealDishOutline]
    est_total_minutes: int | None = None
    est_hands_on_minutes: int | None = None
    # None when the user opted out of the pantry (#287): nothing was matched,
    # so there's no "uses N of your items" to show and no to-buy cap applied.
    coverage: MealCoverage | None = None
    rescues: list[str] = Field(default_factory=list)


class MealFixedMainEcho(BaseModel):
    """Wire echo of a make-it-a-meal flow's fixed main on the option-stage
    proposal, so the client can adapt its fixed pills (issue #651 PR B).
    `recipe_id` is set only when the main is a saved recipe that gets linked."""

    recipe_id: str | None = None
    title: str


class MealOptionsProposal(BaseModel):
    """Proposal for the meal_plan option stage. `next_action: pick_meal`."""

    proposal_type: Literal["meal_options"] = "meal_options"
    options: list[MealOption]
    servings: int
    constraints: MealConstraintsEcho
    fixed_main: MealFixedMainEcho | None = None


# ---------------------------------------------------------------------------
# Wire models -- pick stage (`proposal_type: "meal"`)
# ---------------------------------------------------------------------------


class MealDish(BaseModel):
    """One dish of an expanded meal: a full recipe with a role and position."""

    role: Literal["main", "side"]
    position: int
    recipe: RecipeCard
    # Set ONLY on a fixed saved main (issue #651 PR B): `recipe` is then filled
    # from that saved row, never regenerated, and `POST /api/meals` links the
    # id without copying the recipe.
    recipe_id: str | None = None


class MealProposal(BaseModel):
    """Proposal for the meal_plan pick stage. `next_action: review_proposal`."""

    proposal_type: Literal["meal"] = "meal"
    title: str
    servings: int
    constraints: MealConstraintsEcho
    dishes: list[MealDish]
    missing_ingredients: list[str] = Field(default_factory=list)
    # Stable identity for this proposed meal. It's persisted with the proposal
    # in the conversation history, and `POST /api/meals` is idempotent on it,
    # so an Open or Save tapped again after navigating away and back returns
    # the same meal rather than creating a second one (PR #659 review).
    meal_ref: str = Field(default_factory=lambda: uuid4().hex)


# ---------------------------------------------------------------------------
# Session retention -- kept next to `brainstorm_ideas` (SessionContext.meal_plan)
# ---------------------------------------------------------------------------


class MealFixedMainIngredient(Ingredient):
    """An `Ingredient` with payload limits (issue #651 PR B). An over-long name,
    a negative quantity, or NaN/inf rejects the whole payload (invalid)."""

    name: str = Field(max_length=200)
    quantity: float | None = Field(default=None, ge=0, allow_inf_nan=False)


def _int_in_range_or_none(value: object, low: int, high: int) -> int | None:
    """`value` as an int within [low, high], else None (never an error). An
    integral float is accepted; a bool, a string or anything else is not."""
    if isinstance(value, bool):
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, int) and low <= value <= high:
        return value
    return None


class MealFixedMainRecipePayload(BaseModel):
    """An in-chat recipe sent as `context.meal_fixed_main.recipe` (issue #651 PR B).

    The size gate (32 KB serialised) runs before this model. Extra keys
    (`ingredient_availability`, `id`, ...) are ignored. The card's `steps` are
    rebuilt server-side with `build_structured_steps(steps, instructions)`.
    """

    model_config = ConfigDict(extra="ignore")

    title: str = Field(min_length=1, max_length=200)
    # The fields below the title and ingredients are COERCED, never rejected:
    # a URL-imported recipe can carry a 2880-minute brisket, `servings: 0` or a
    # 5000-character description, and one odd field must not turn the whole tap
    # into "I couldn't read that recipe". Out-of-range numbers become None and
    # over-long text is truncated (the before-validators below); the 32 KB
    # size gate and the title / ingredient checks still reject.
    description: str | None = None
    ingredients: list[MealFixedMainIngredient] = Field(default_factory=list, max_length=60)
    instructions: list[str] = Field(default_factory=list, max_length=60)
    steps: list[dict[str, Any]] | None = None
    prep_time_minutes: int | None = None
    cook_time_minutes: int | None = None
    total_time_minutes: int | None = None
    servings: int | None = None
    cuisine: str | None = None
    meal_type: str | None = None
    difficulty: str | None = None
    dietary_tags: list[str] = Field(default_factory=list)

    @field_validator("prep_time_minutes", "cook_time_minutes", "total_time_minutes", mode="before")
    @classmethod
    def _coerce_minutes(cls, value: object) -> object:
        return _int_in_range_or_none(value, 0, 1440)

    @field_validator("servings", mode="before")
    @classmethod
    def _coerce_servings(cls, value: object) -> object:
        return _int_in_range_or_none(value, 1, 100)

    @field_validator("description", mode="before")
    @classmethod
    def _truncate_description(cls, value: object) -> object:
        return value[:2000] if isinstance(value, str) else value

    @field_validator("cuisine", mode="before")
    @classmethod
    def _truncate_cuisine(cls, value: object) -> object:
        return value[:60] if isinstance(value, str) else value

    @field_validator("meal_type", "difficulty", mode="before")
    @classmethod
    def _truncate_short_labels(cls, value: object) -> object:
        return value[:30] if isinstance(value, str) else value

    @field_validator("instructions", mode="before")
    @classmethod
    def _truncate_instructions(cls, value: object) -> object:
        if isinstance(value, list):
            return [v[:2000] if isinstance(v, str) else v for v in value]
        return value

    @field_validator("dietary_tags", mode="before")
    @classmethod
    def _truncate_tags(cls, value: object) -> object:
        if isinstance(value, list):
            return [v[:40] if isinstance(v, str) else v for v in value[:20]]
        return value

    @field_validator("ingredients", mode="before")
    @classmethod
    def _drop_blank_named_ingredients(cls, value: object) -> object:
        """Drop dict entries whose name is missing or blank after trimming,
        before the ingredient model runs."""
        if not isinstance(value, list):
            return value
        kept: list[object] = []
        for entry in value:
            if isinstance(entry, dict):
                name = entry.get("name")
                if not isinstance(name, str) or not name.strip():
                    continue
            kept.append(entry)
        return kept


class MealFixedMain(BaseModel):
    """The fixed main of a make-it-a-meal flow, retained in `MealPlanSessionState`.

    `source == "saved"`: `recipe_id` is a NON-draft row the user owns, and no
    card is kept (it is re-read at every stage). `source == "chat"`: `recipe`
    is the payload (or a draft row's contents) as a `RecipeCard` with a FRESH id.
    """

    source: Literal["saved", "chat"]
    recipe_id: str | None = None
    title: str
    recipe: RecipeCard | None = None

    @model_validator(mode="after")
    def _source_matches_fields(self) -> Self:
        # recipe_id iff saved, recipe iff chat. A retained state that breaks
        # this fails validation, which `_retained_meal_plan_state` already
        # treats as absent.
        if (self.source == "saved") != (self.recipe_id is not None):
            raise ValueError("recipe_id must be set exactly when source == 'saved'")
        if (self.source == "chat") != (self.recipe is not None):
            raise ValueError("recipe must be set exactly when source == 'chat'")
        return self


class MealPlanSessionState(BaseModel):
    """The option stage's output, retained in the session for the pick turn.

    `context.meal_option_id` on the pick request resolves against `options`
    by `option_id` -- never fuzzy-matched. `servings` and `constraints` ride
    along so the pick turn doesn't need to re-extract or re-default them.
    `fixed_main` (issue #651 PR B) is set when every option keeps one given
    main; `None` (the default, so an old retained session still validates)
    for an ordinary meal.
    """

    options: list[MealOption] = Field(default_factory=list)
    servings: int = 2
    constraints: MealConstraintsEcho = Field(default_factory=MealConstraintsEcho)
    fixed_main: MealFixedMain | None = None
    # Every option shown in this conversation's meal flow, oldest first, as
    # `Title (Dish, Dish)`, capped at 9 (issue #667). `options` holds only the
    # latest three, so without this a third "Different ideas" tap could bring
    # back the first set. Defaults empty so an old retained session validates.
    shown_options: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# LLM response schemas -- internal to the option-stage model call
# ---------------------------------------------------------------------------


class MealDishOutlineLLM(BaseModel):
    """One dish, as the option-stage structured call returns it."""

    role: Literal["main", "side"] = Field(
        description="'main' for the entree, 'side' for a side dish"
    )
    name: str = Field(description="Dish name, 2-5 words")
    blurb: str | None = Field(
        default=None, description="Optional one-sentence description of the dish"
    )
    key_ingredients: list[str] = Field(
        default_factory=list,
        description="3-6 ingredients that matter for whether the user has what they need",
    )
    est_total_minutes: int | None = Field(default=None, description="Estimated total minutes")
    est_hands_on_minutes: int | None = Field(
        default=None, description="Estimated hands-on minutes"
    )


class MealOptionLLM(BaseModel):
    """One meal option, as the option-stage structured call returns it."""

    title: str = Field(description="Short, appetizing meal title")
    blurb: str | None = Field(default=None, description="One-sentence description")
    dishes: list[MealDishOutlineLLM] = Field(
        default_factory=list, description="One main first, then 0-2 sides fitted to the main"
    )


class MealOptionsLLMResult(BaseModel):
    """Envelope for the option-stage structured call -- 3 options requested.

    The schema accepts 1-3 (issue #758): 3 is the target, fewer is allowed when
    the pantry or constraints leave room for no more. It does not force exactly
    3, or even 2: a floor turned a thin-pantry answer of one option into a
    validation-retry loop and then a generation error, where showing that one
    option is the better outcome. The prompt, not the schema, carries the 3.
    """

    options: list[MealOptionLLM] = Field(
        default_factory=list,
        min_length=1,
        max_length=3,
        description="3 meal options; fewer only when a thin pantry or tight constraints allow",
    )
    follow_ups: list[str] = Field(
        default_factory=list,
        description="2-4 short next asks in the user's voice, each under 60 characters, no emoji",
    )


# ---------------------------------------------------------------------------
# LLM response schema -- internal to the meal-screen side-alternatives call
# (issue #652, `workflows/meal/sides.py`)
# ---------------------------------------------------------------------------


class MealSideAlternativesLLMResult(BaseModel):
    """Envelope for the side-alternatives structured call -- 3 alternatives
    requested. Route-level validation (role, dedup against the current meal's
    dishes) happens after this in `workflows/meal/sides.py`, not here."""

    alternatives: list[MealDishOutlineLLM] = Field(default_factory=list)
