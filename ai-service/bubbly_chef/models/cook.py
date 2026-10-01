"""Pydantic models for the cook-a-recipe / pantry-deduction workflow."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# Shared with IngredientMatch below and MealCookSource (issue #654) so both
# sides of a merge speak the exact same vocabulary.
IngredientMatchStatus = Literal[
    "ready",
    "substitute",
    "shortfall",
    "imprecise",
    "unit_conflict",
    "missing",
    "assumed",
    "to_taste",
]
IngredientMatchType = Literal["exact", "substitute", "none"]


class IngredientMatch(BaseModel):
    """Per-ingredient match result from the cook matcher."""

    ingredient_name: str = Field(description="Ingredient name from the recipe")
    ingredient_qty: float | None = Field(default=None, description="Quantity required by the recipe")
    ingredient_unit: str | None = Field(default=None, description="Unit required by the recipe")

    # Pantry side (None when status == "missing")
    pantry_item_id: UUID | None = Field(default=None, description="Matched pantry item UUID")
    pantry_item_name: str | None = Field(default=None, description="Matched pantry item name")
    pantry_qty_available: float | None = Field(
        default=None, description="Current quantity in pantry (base unit)"
    )
    deduct_qty: float | None = Field(
        default=None, description="Amount to deduct (base unit)"
    )
    base_unit: str | None = Field(default=None, description="Base unit used for comparison")

    status: IngredientMatchStatus = Field(
        description=(
            "ready=have enough, substitute=covered by a suggested stand-in, "
            "shortfall=not enough, imprecise=have it but can't quantify how much "
            "the recipe uses (recipe pieces against a package row, or a unit "
            "outside the recognised vocabulary) — nothing is auto-deducted, "
            "deduct_qty is None, unit_conflict=can't compare, "
            "missing=not in pantry, "
            "assumed=a culinary staple presumed on hand even though it's not in the pantry, "
            "to_taste=a seasoning line with no amount (\"salt and pepper\", \"to taste\") "
            "or a trace one (\"a pinch of salt\", \"a dash of hot sauce\") — "
            "never matched to a pantry row, nothing is deducted or asked for (#756)"
        )
    )
    shortfall: float | None = Field(
        default=None, description="How much is missing (base unit), only set when status==shortfall"
    )
    approximate: bool = Field(
        default=False,
        description=(
            "True when deduct_qty rests on a typical figure rather than an exact "
            "conversion: a piece weight (an onion is ~150 g), a density (a cup of "
            "flour is ~127 g) or a typical container size (a can of tomatoes is "
            "14.5 oz). It is still deducted; the review shows it as \"about\". "
            "False for exact conversions and for every status that deducts nothing."
        ),
    )

    # How the pantry item was found, recorded separately from status. A substitute
    # with too little stock is status="shortfall" but still match_type="substitute",
    # so the UI can show the stand-in note alongside the shortfall.
    match_type: IngredientMatchType = Field(
        default="exact",
        description="exact=name/synonym match, substitute=LLM-suggested stand-in, none=no match",
    )
    substitution_note: str | None = Field(
        default=None,
        description="Short explanation shown to the user, only set when match_type==substitute",
    )


class CompoundComponent(BaseModel):
    """One pantry item backing a compound substitution, ready to deduct.

    `suggested_quantity` (#284 Option B, 2026-09-27) is the model's best guess
    at how much of this component stands in for the missing ingredient, in
    `base_unit`. It only ever PRE-FILLS an editable input in the cook modal —
    nothing is deducted until the user confirms, and the user can edit or
    clear it first, exactly like an existing unit_conflict row. It is None
    when the model gave no quantity, one that failed validation (missing,
    non-numeric, non-positive, or absurdly large), or one whose unit did not
    match this component's own `base_unit` (#284 round 7 — the model sees each
    candidate's real unit and must echo it back; a mismatch means the number
    cannot be trusted to mean what `base_unit` says it means, so it is dropped
    rather than pre-filled under the wrong label) — the input then starts
    blank, the same always-unresolved behaviour this carried before Option B.
    """

    pantry_item_id: UUID = Field(description="Pantry item this component would deduct from")
    name: str = Field(description="Pantry item display name, matching the entry in `components`")
    base_unit: str | None = Field(
        default=None,
        description="Base unit the user's typed quantity is interpreted in (count | ml | g)",
    )
    suggested_quantity: float | None = Field(
        default=None,
        description=(
            "Model-suggested quantity in base_unit, pre-filling the modal's editable "
            "input for this component. None when the model gave no usable amount, or "
            "one whose reported unit didn't match base_unit (#284 round 7) — the "
            "input then starts blank, same as before Option B."
        ),
    )


class CompoundSuggestion(BaseModel):
    """A multi-item substitution the model proposes for a missing ingredient.

    The suggestion itself is advisory — the ingredient stays in
    CookProposal.missing. Deduction is opt-in (#284): component_items carries
    enough to target a deduction, and since Option B (2026-09-27) each
    component's input starts pre-filled with the model's suggested_quantity
    where one validated. Nothing is deducted until the user confirms — they
    can edit or clear a pre-filled value first, reusing the same editable-qty
    path as unit_conflict.
    """

    ingredient_name: str = Field(description="The missing ingredient this suggestion covers")
    components: list[str] = Field(
        description="Pantry item names to combine (all must exist in the user's pantry)"
    )
    note: str = Field(
        description="Short instruction for the cook, e.g. 'Melt butter, whisk in flour, add milk'"
    )
    component_items: list[CompoundComponent] = Field(
        default_factory=list,
        description=(
            "Same items as `components`, resolved to pantry rows so the modal can "
            "let the user type a per-component quantity and deduct it on confirm. "
            "Empty only if resolution somehow fails after `components` was already "
            "validated against the pantry — treated as always-unresolved in that case."
        ),
    )
    component_quantities: dict[str, float] | None = Field(
        default=None,
        description=(
            "Validated model-suggested quantity per component, keyed by normalized "
            "(stripped, lowercased) component name — the source component_items' "
            "suggested_quantity is resolved from. Unlike component_items this never "
            "carries a pantry row id, so — same as `components` and `note` — it is "
            "safe to cache and reuse across an alias-cache hit on a colliding "
            "normalized pantry name-set (#616)."
        ),
    )
    component_quantity_units: dict[str, str] | None = Field(
        default=None,
        description=(
            "The base unit (count | ml | g) each entry in component_quantities was "
            "validated against, keyed the same normalized way. A pantry-name collision "
            "at cache-hit time (#616) can resolve the same key to a row with a "
            "DIFFERENT base unit than the one the quantity was originally checked "
            "against — e.g. one user tracks butter in grams, another in whole sticks. "
            "This lets a cache-hit re-verify unit agreement before re-attaching a "
            "cached quantity, instead of trusting it still applies (#284 round 7)."
        ),
    )


class ExpiredMatchedItem(BaseModel):
    """A matched ingredient whose backing pantry row is expired."""

    ingredient_name: str = Field(description="Ingredient name from the recipe")
    pantry_item_name: str = Field(description="Name of the expired pantry row")
    days_expired: int = Field(description="How many days past expiry (always >= 1)")


class CookProposal(BaseModel):
    """Proposal returned to the user before confirming a cook action."""

    proposal_type: Literal["cook"] = "cook"
    recipe_id: UUID = Field(description="ID of the recipe being cooked")
    recipe_title: str = Field(description="Human-readable recipe title")
    matches: list[IngredientMatch] = Field(
        description="All matched ingredients (ready, shortfall, imprecise, unit_conflict)"
    )
    missing: list[str] = Field(
        default_factory=list,
        description="Ingredient names that have no pantry match at all",
    )
    missing_notes: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "Ingredient name -> short explanation of why nothing in the pantry works. "
            "Sparse: only present for ingredients the model had something to say about."
        ),
    )
    unit_conflicts: list[dict[str, str]] = Field(
        default_factory=list,
        description="Ingredient names where unit conversion is not possible",
    )
    compound_suggestions: list[CompoundSuggestion] = Field(
        default_factory=list,
        description=(
            "Advisory compound substitutions for missing ingredients — "
            "e.g. heavy cream ← butter + milk + flour. The ingredient itself "
            "always remains in missing; deducting the components is opt-in "
            "(#284) via each suggestion's component_items, not automatic."
        ),
    )
    expired_items: list[ExpiredMatchedItem] = Field(
        default_factory=list,
        description=(
            "Matched ingredients whose backing pantry row is expired. "
            "Non-blocking — the user may still proceed. "
            "Empty when no matched ingredient comes from an expired row."
        ),
    )


class DeductionItem(BaseModel):
    """A single pantry deduction as confirmed by the user."""

    pantry_item_id: UUID = Field(description="Pantry item to deduct from")
    deduct_qty: float = Field(description="Amount to deduct (in base_unit)")
    base_unit: str = Field(description="Unit of deduct_qty")


class CookConfirmRequest(BaseModel):
    """Request body for POST /v1/recipes/cook/confirm."""

    recipe_id: UUID = Field(description="Recipe that was cooked")
    deductions: list[DeductionItem] = Field(
        description="Pantry deductions the user approved"
    )


# ---------------------------------------------------------------------------
# Meal cook (issue #654): one combined deduction sheet for a whole meal cook.
# ---------------------------------------------------------------------------


def _reject_duplicates(values: list[UUID], field_name: str) -> list[UUID]:
    """Shared field_validator body for `MealCookRequest.dishes` /
    `MealCookConfirmRequest.recipe_ids` -- both must name each recipe once."""
    seen: set[UUID] = set()
    for value in values:
        if value in seen:
            raise ValueError(f"Duplicate recipe id in {field_name}: {value}")
        seen.add(value)
    return values


class MealCookIngredient(BaseModel):
    """One ingredient object on a meal cook request.

    RecipeIngredient's fields as the frontend's `cookedIngredientsForDish`
    sends them, minus `preparation` (dropped -- pydantic ignores extra keys),
    plus `notes`, which an amendment's objects carry (PR B). A blank `name`
    is dropped server-side, not here -- an empty string is still a valid str.
    """

    name: str = Field(description="Ingredient name, as sent by the client")
    quantity: float | None = Field(default=None)
    quantity_max: float | None = Field(
        default=None,
        description=(
            "Upper bound when the line is a range (\"1-2 cloves\"): `quantity` is then the "
            "midpoint, deducted; this is what the pantry is checked against. Ignored "
            "unless greater than `quantity`."
        ),
    )
    unit: str | None = Field(default=None)
    optional: bool = Field(default=False)
    notes: str | None = Field(default=None)


class MealCookDishRequest(BaseModel):
    """One dish's contribution to POST /v1/meals/cook."""

    recipe_id: UUID
    # The list as cooked (contract §3). Objects are at MEAL scale and used
    # verbatim. Strings are at RECIPE scale: the server parses each and
    # scales it by `string_scale`. None means "read the recipe row and scale
    # everything by servings / recipe servings" -- the server derives its
    # own factor in that case, and `string_scale` is ignored.
    ingredients: list[str | MealCookIngredient] | None = Field(
        default=None, max_length=100
    )
    # meal servings / recipe servings, set by the client. Applied to string
    # elements only -- see MealCookIngredient's docstring for why objects
    # never get this treatment.
    string_scale: float = Field(default=1.0, gt=0, le=100)


class MealCookRequest(BaseModel):
    """Request body for POST /v1/meals/cook (no writes)."""

    meal_id: UUID
    servings: int = Field(ge=1, le=100)
    dishes: list[MealCookDishRequest] = Field(min_length=1, max_length=3)

    @field_validator("dishes")
    @classmethod
    def _unique_recipe_ids(
        cls, dishes: list[MealCookDishRequest]
    ) -> list[MealCookDishRequest]:
        _reject_duplicates([d.recipe_id for d in dishes], "dishes")
        return dishes


class MealCookSource(BaseModel):
    """One dish's contribution to a merged meal-cook line."""

    recipe_id: UUID
    dish_title: str
    ingredient_name: str = Field(description="That dish's own spelling")
    ingredient_qty: float | None = None
    ingredient_unit: str | None = None
    # ready/substitute: deduct_qty; shortfall: deduct_qty + shortfall;
    # everything else (unit_conflict, imprecise, assumed, no-quantity
    # ready/substitute): None.
    required_base_qty: float | None = None
    status: IngredientMatchStatus = Field(description="This dish's own status, before merging")
    approximate: bool = Field(
        default=False, description="This dish's own required_base_qty is an estimate"
    )
    match_type: IngredientMatchType = "exact"
    substitution_note: str | None = None


class MealIngredientMatch(IngredientMatch):
    """A merged line: every `IngredientMatch` field keeps its meaning, plus
    the per-dish sources that were merged into it (contract §2b)."""

    sources: list[MealCookSource] = Field(min_length=1)


class MealCookProposalDish(BaseModel):
    """One requested dish, echoed back on the proposal."""

    recipe_id: UUID
    title: str
    role: Literal["main", "side"]
    position: int
    ingredients_source: Literal["supplied", "recipe"]


class MealCookProposal(BaseModel):
    """Proposal returned to the user before confirming a whole-meal cook.

    Deliberately NOT added to `models.proposals.ProposalUnion`/`AnyProposal`
    (contract §1) -- it never travels in a chat envelope.
    """

    proposal_type: Literal["meal_cook"] = "meal_cook"
    meal_id: UUID
    meal_title: str
    servings: int
    dishes: list[MealCookProposalDish] = Field(description="Only the requested dishes, by position")
    matches: list[MealIngredientMatch]
    missing: list[str] = Field(default_factory=list)
    missing_sources: dict[str, list[UUID]] = Field(
        default_factory=dict, description="Key: the exact string in `missing`"
    )
    missing_notes: dict[str, str] = Field(default_factory=dict)
    unit_conflicts: list[dict[str, str]] = Field(
        default_factory=list, description="The existing keys, plus `recipe_id`"
    )
    compound_suggestions: list[CompoundSuggestion] = Field(default_factory=list)
    expired_items: list[ExpiredMatchedItem] = Field(default_factory=list)


class MealCookConfirmRequest(BaseModel):
    """Request body for POST /v1/meals/cook/confirm (the writes)."""

    meal_id: UUID
    # MealCookSession.cook_id (frontend). A safe charset, because it goes
    # into a PostgREST filter (repo.claim_meal_cook's `.or_`).
    cook_ref: str = Field(pattern=r"^[A-Za-z0-9-]{1,64}$")
    recipe_ids: list[UUID] = Field(
        min_length=1, max_length=3, description="The dishes actually cooked"
    )
    deductions: list[DeductionItem]

    @field_validator("recipe_ids")
    @classmethod
    def _unique_recipe_ids(cls, recipe_ids: list[UUID]) -> list[UUID]:
        _reject_duplicates(recipe_ids, "recipe_ids")
        return recipe_ids


class MealCookClaim(BaseModel):
    """What `SupabaseRepository.claim_meal_cook` returns (contract §2c)."""

    outcome: Literal["claimed", "replay_applied", "replay_in_progress", "replay_claimed"]
    times_cooked: int
    cooked_on: date = Field(description="The UTC date of the claim's last_cooked_at")
    cooked_at: datetime | None = Field(
        default=None,
        description=(
            "The claim's last_cooked_at instant (issue #550). A UTC date alone can't say which "
            "LOCAL day a cook fell on, so the Next.js proxy keys bubble awards on this instant "
            "in the account's zone. Identical on every replay of the same claim."
        ),
    )
