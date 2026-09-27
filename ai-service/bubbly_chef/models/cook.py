"""Pydantic models for the cook-a-recipe / pantry-deduction workflow."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


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

    status: Literal[
        "ready", "substitute", "shortfall", "imprecise", "unit_conflict", "missing", "assumed"
    ] = Field(
        description=(
            "ready=have enough, substitute=covered by a suggested stand-in, "
            "shortfall=not enough, imprecise=have it but can't quantify how much "
            "the recipe uses (recipe pieces against a package row, or a unit "
            "outside the recognised vocabulary) — nothing is auto-deducted, "
            "deduct_qty is None, unit_conflict=can't compare, "
            "missing=not in pantry, "
            "assumed=a culinary staple presumed on hand even though it's not in the pantry"
        )
    )
    shortfall: float | None = Field(
        default=None, description="How much is missing (base unit), only set when status==shortfall"
    )

    # How the pantry item was found, recorded separately from status. A substitute
    # with too little stock is status="shortfall" but still match_type="substitute",
    # so the UI can show the stand-in note alongside the shortfall.
    match_type: Literal["exact", "substitute", "none"] = Field(
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
    when the model gave no quantity, or one that failed validation (missing,
    non-numeric, non-positive, or absurdly large) — the input then starts
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
            "input for this component. None when the model gave no usable amount — "
            "the input then starts blank, same as before Option B."
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
            "e.g. heavy cream ← butter + milk + flour. "
            "Nothing is deducted; the ingredient remains in missing."
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
