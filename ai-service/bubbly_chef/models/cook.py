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
        "ready", "substitute", "shortfall", "imprecise", "unit_conflict", "missing"
    ] = Field(
        description=(
            "ready=have enough, substitute=covered by a suggested stand-in, "
            "shortfall=not enough, imprecise=have it but the recipe's pieces can't be "
            "quantified against a package row, unit_conflict=can't compare, "
            "missing=not in pantry"
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


class CompoundSuggestion(BaseModel):
    """A multi-item substitution the model proposes for a missing ingredient.

    This is advisory only — nothing is deducted, and the ingredient stays in
    CookProposal.missing. Deduction from compound substitutions is a deliberate
    follow-up tracked separately.
    """

    ingredient_name: str = Field(description="The missing ingredient this suggestion covers")
    components: list[str] = Field(
        description="Pantry item names to combine (all must exist in the user's pantry)"
    )
    note: str = Field(
        description="Short instruction for the cook, e.g. 'Melt butter, whisk in flour, add milk'"
    )


class CookProposal(BaseModel):
    """Proposal returned to the user before confirming a cook action."""

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
