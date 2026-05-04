"""Cook matcher service.

Given a list of recipe ingredients and a user's pantry items, produces a
CookProposal that shows which ingredients can be deducted, which are
insufficient, which have unit conflicts, and which are missing entirely.
"""

from __future__ import annotations

import logging
from typing import Any

from bubbly_chef.domain.catalog import lookup as catalog_lookup
from bubbly_chef.domain.normalizer import normalize_food_name, normalize_to_base_unit
from bubbly_chef.models.cook import CookProposal, IngredientMatch
from bubbly_chef.models.pantry import PantryItem

logger = logging.getLogger(__name__)


def _normalize_ingredient_name(name: str) -> str:
    """Normalize an ingredient name for matching against pantry items."""
    # First try catalog lookup at 80-threshold (task spec)
    entry = catalog_lookup(name, threshold=80)
    if entry:
        return entry.canonical.lower().strip()
    # Fall back to synonym + regex normalizer
    return normalize_food_name(name).lower().strip()


def match_ingredients(
    recipe_id: str,
    recipe_title: str,
    recipe_ingredients: list[dict[str, Any]],
    pantry_items: list[PantryItem],
) -> CookProposal:
    """Match recipe ingredients against pantry items and produce a CookProposal.

    Args:
        recipe_id: UUID string of the recipe.
        recipe_title: Human-readable title for the proposal.
        recipe_ingredients: List of ingredient dicts with keys:
            name (str), quantity (float|None), unit (str|None).
        pantry_items: List of PantryItem objects for the current user.

    Returns:
        CookProposal with matches, missing, and unit_conflicts lists.
    """
    from uuid import UUID

    # Build a lookup: normalized_name -> PantryItem
    pantry_index: dict[str, PantryItem] = {}
    for item in pantry_items:
        key = _normalize_ingredient_name(item.name)
        # Keep the item with the highest quantity if there are duplicates
        if key not in pantry_index or item.quantity > pantry_index[key].quantity:
            pantry_index[key] = item

    matches: list[IngredientMatch] = []
    missing: list[str] = []
    unit_conflicts: list[dict[str, str]] = []

    for ingredient in recipe_ingredients:
        raw_name: str = ingredient.get("name", "")
        if not raw_name:
            continue

        ing_qty: float | None = ingredient.get("quantity")
        ing_unit: str | None = ingredient.get("unit")
        norm_name = _normalize_ingredient_name(raw_name)

        # --- Find pantry match ---
        pantry_item = pantry_index.get(norm_name)

        if pantry_item is None:
            # No match at all
            missing.append(raw_name)
            continue

        # --- No quantity on recipe ingredient → can't deduct, just note as ready ---
        if ing_qty is None or ing_unit is None:
            matches.append(
                IngredientMatch(
                    ingredient_name=raw_name,
                    ingredient_qty=ing_qty,
                    ingredient_unit=ing_unit,
                    pantry_item_id=pantry_item.id,
                    pantry_item_name=pantry_item.name,
                    pantry_qty_available=pantry_item.quantity_base,
                    deduct_qty=None,
                    base_unit=pantry_item.unit_base,
                    status="ready",
                )
            )
            continue

        # --- Convert recipe ingredient to base unit ---
        req_base_qty, req_base_unit = normalize_to_base_unit(
            name=raw_name,
            quantity=ing_qty,
            unit=ing_unit,
        )

        # Also ensure pantry item has a base unit
        pantry_base_qty = pantry_item.quantity_base
        pantry_base_unit = pantry_item.unit_base

        # If pantry item lacks base values, try to derive them
        if pantry_base_qty is None or pantry_base_unit is None:
            pantry_base_qty, pantry_base_unit = normalize_to_base_unit(
                name=pantry_item.name,
                quantity=pantry_item.quantity,
                unit=pantry_item.unit,
            )

        # --- Unit conflict: can't convert either side ---
        if req_base_qty is None or pantry_base_qty is None or req_base_unit != pantry_base_unit:
            conflict_info = {
                "ingredient": raw_name,
                "recipe_unit": ing_unit,
                "pantry_unit": pantry_item.unit,
            }
            unit_conflicts.append(conflict_info)
            matches.append(
                IngredientMatch(
                    ingredient_name=raw_name,
                    ingredient_qty=ing_qty,
                    ingredient_unit=ing_unit,
                    pantry_item_id=pantry_item.id,
                    pantry_item_name=pantry_item.name,
                    pantry_qty_available=pantry_base_qty,
                    deduct_qty=None,
                    base_unit=pantry_base_unit or ing_unit,
                    status="unit_conflict",
                )
            )
            continue

        # --- Quantity comparison ---
        assert req_base_qty is not None
        assert pantry_base_qty is not None
        assert req_base_unit is not None

        if pantry_base_qty >= req_base_qty:
            matches.append(
                IngredientMatch(
                    ingredient_name=raw_name,
                    ingredient_qty=ing_qty,
                    ingredient_unit=ing_unit,
                    pantry_item_id=pantry_item.id,
                    pantry_item_name=pantry_item.name,
                    pantry_qty_available=pantry_base_qty,
                    deduct_qty=req_base_qty,
                    base_unit=req_base_unit,
                    status="ready",
                )
            )
        else:
            shortfall = req_base_qty - pantry_base_qty
            matches.append(
                IngredientMatch(
                    ingredient_name=raw_name,
                    ingredient_qty=ing_qty,
                    ingredient_unit=ing_unit,
                    pantry_item_id=pantry_item.id,
                    pantry_item_name=pantry_item.name,
                    pantry_qty_available=pantry_base_qty,
                    deduct_qty=pantry_base_qty,  # deduct what we have
                    base_unit=req_base_unit,
                    status="shortfall",
                    shortfall=round(shortfall, 4),
                )
            )

    return CookProposal(
        recipe_id=UUID(recipe_id),
        recipe_title=recipe_title,
        matches=matches,
        missing=missing,
        unit_conflicts=unit_conflicts,
    )
