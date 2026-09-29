"""Meal-plan models -- the `meal_plan` chat intent's option and pick stages.

See issue #647's "Meal schema" and "API contracts" sections, and issue #650's
wire contract pinned at `docs/plans/2026-09-29-issue-650-meal-contract.md`,
which both halves (ai-service and Next.js) build against. Field names here
are the exact wire shape (snake_case on the wire, matched field-for-field by
these Python names) -- do not rename without updating that doc.
"""

from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field

from bubbly_chef.models.recipe import RecipeCard

# ---------------------------------------------------------------------------
# Wire models -- option stage (`proposal_type: "meal_options"`)
# ---------------------------------------------------------------------------


class MealDishOutline(BaseModel):
    """One dish within a meal option -- not yet a full recipe.

    Exactly what the option card needs to render: a name, its role, a
    handful of key ingredients, and estimated times. `key_ingredients` is
    deliberately short (the model is asked for 3-6) -- it drives the
    deterministic pantry-coverage match in code, not a full ingredient list.
    """

    role: Literal["main", "side"]
    name: str
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


class MealOptionsProposal(BaseModel):
    """Proposal for the meal_plan option stage. `next_action: pick_meal`."""

    proposal_type: Literal["meal_options"] = "meal_options"
    options: list[MealOption]
    servings: int
    constraints: MealConstraintsEcho


# ---------------------------------------------------------------------------
# Wire models -- pick stage (`proposal_type: "meal"`)
# ---------------------------------------------------------------------------


class MealDish(BaseModel):
    """One dish of an expanded meal: a full recipe with a role and position."""

    role: Literal["main", "side"]
    position: int
    recipe: RecipeCard


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


class MealPlanSessionState(BaseModel):
    """The option stage's output, retained in the session for the pick turn.

    `context.meal_option_id` on the pick request resolves against `options`
    by `option_id` -- never fuzzy-matched. `servings` and `constraints` ride
    along so the pick turn doesn't need to re-extract or re-default them.
    """

    options: list[MealOption] = Field(default_factory=list)
    servings: int = 2
    constraints: MealConstraintsEcho = Field(default_factory=MealConstraintsEcho)


# ---------------------------------------------------------------------------
# LLM response schemas -- internal to the option-stage model call
# ---------------------------------------------------------------------------


class MealDishOutlineLLM(BaseModel):
    """One dish, as the option-stage structured call returns it."""

    role: Literal["main", "side"] = Field(
        description="'main' for the entree, 'side' for a side dish"
    )
    name: str = Field(description="Dish name, 2-5 words")
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
        default_factory=list, description="One main first, then 1-2 sides"
    )


class MealOptionsLLMResult(BaseModel):
    """Envelope for the option-stage structured call -- 3 options requested."""

    options: list[MealOptionLLM] = Field(default_factory=list)
