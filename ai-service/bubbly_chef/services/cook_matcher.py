"""Cook matcher service.

Given a list of recipe ingredients and a user's pantry items, produces a
CookProposal that shows which ingredients can be deducted, which are
insufficient, which have unit conflicts, and which are missing entirely.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from bubbly_chef.domain.normalizer import normalize_food_name, normalize_to_base_unit
from bubbly_chef.models.cook import CookProposal, IngredientMatch
from bubbly_chef.models.pantry import PantryItem

logger = logging.getLogger(__name__)

# Matches leading quantity+unit in a raw ingredient string, e.g.:
#   "2 large eggs"       → qty=2,  unit=None,   rest="large eggs"
#   "1/2 cup flour"      → qty=0.5, unit="cup",  rest="flour"
#   "1 teaspoon lemon zest" → qty=1, unit="tsp", rest="lemon zest"
_LEADING_QTY_RE = re.compile(
    r"^\s*"
    r"(?P<qty>\d+\s*/\s*\d+|\d+(?:\.\d+)?)"   # fraction or decimal
    r"(?:\s+(?P<unit>cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons"
    r"|oz|ounce|ounces|lb|lbs|pound|pounds|g|gram|grams|kg|ml|l|liter|liters"
    r"|pint|quart|gallon|fl\s+oz|fluid\s+ounce|stick|sticks|clove|cloves"
    r"|bunch|bunches|slice|slices|piece|pieces|can|cans|package|packages"
    r"|head|heads|sprig|sprigs|pinch|dash|handful|item|count|dozen))?"
    r"\s+",
    re.IGNORECASE,
)

# Adjectives that appear between quantity and the actual food noun
_ADJECTIVE_RE = re.compile(
    r"^(?:large|small|medium|extra-large|xl|fresh|dried|whole|finely|coarsely"
    r"|roughly|thinly|thickly|grated|sliced|diced|chopped|minced|crushed"
    r"|peeled|seeded|boneless|skinless|lean|ground|frozen|canned|organic"
    r"|plus|more|additional|extra)\s+",
    re.IGNORECASE,
)

# Conjunctions that split multi-ingredient strings, e.g. "2 eggs and 1 yolk"
_CONJUNCTION_RE = re.compile(r"\s*(?:,\s*|\s+and\s+|\s+or\s+|\s+plus\s+).*$", re.IGNORECASE)

# Food unit words that, appearing as the sole parsed "name", mean the parse
# consumed too much and we should fall back to the last conjunction segment.
_UNIT_WORDS = frozenset({
    "cup", "cups", "tbsp", "tablespoon", "tablespoons", "tsp", "teaspoon",
    "teaspoons", "oz", "lb", "lbs", "g", "kg", "ml", "l", "item", "count",
    "piece", "pieces", "slice", "slices", "bunch", "can", "cans", "package",
    "packages", "clove", "cloves", "sprig", "sprigs", "head", "heads",
    "stick", "sticks",
})


def _parse_ingredient_string(raw: str) -> dict[str, Any]:
    """Parse a raw ingredient string into {name, quantity, unit}.

    Handles strings like:
      "2 large eggs" → {name: "eggs", quantity: 2.0, unit: None}
      "1/2 cup finely grated Parmesan" → {name: "parmesan", quantity: 0.5, unit: "cup"}
      "1 teaspoon lemon zest" → {name: "lemon zest", quantity: 1.0, unit: "teaspoon"}
      "1/2 cup plus 2 tbsp Parmesan" → {name: "parmesan", quantity: 0.5, unit: "cup"}
    """
    stripped = raw.strip()

    # Split on first conjunction — use the first segment for qty/unit, last for the food noun
    conj_m = _CONJUNCTION_RE.search(stripped)
    first_segment = _CONJUNCTION_RE.sub("", stripped)
    last_segment = stripped[conj_m.start():].lstrip(" ,").strip() if conj_m else first_segment

    qty: float | None = None
    unit: str | None = None
    text = first_segment

    m = _LEADING_QTY_RE.match(text)
    if m:
        qty_str = m.group("qty").replace(" ", "")
        if "/" in qty_str:
            num, den = qty_str.split("/")
            qty = float(num) / float(den)
        else:
            qty = float(qty_str)
        unit = m.group("unit")
        text = text[m.end():]

    # Strip leading adjectives to reach the food noun
    for _ in range(5):
        stripped_adj = _ADJECTIVE_RE.sub("", text)
        if stripped_adj == text:
            break
        text = stripped_adj

    name = text.strip().lower()

    # Food unit words appearing as the sole "name" mean the parse consumed too much.
    # In that case fall back to the last conjunction segment for the actual food noun.
    if not name or name in _UNIT_WORDS:
        last = last_segment
        # Strip leading adjectives/conjunction words before the qty match
        for _ in range(5):
            stripped_adj = _ADJECTIVE_RE.sub("", last)
            if stripped_adj == last:
                break
            last = stripped_adj
        last_m = _LEADING_QTY_RE.match(last)
        if last_m:
            last = last[last_m.end():]
        for _ in range(5):
            stripped_adj = _ADJECTIVE_RE.sub("", last)
            if stripped_adj == last:
                break
            last = stripped_adj
        name = last.strip().lower() or name

    return {"name": name, "quantity": qty, "unit": unit}


def _normalize_ingredient_name(name: str) -> str:
    """Normalize an ingredient name for matching against pantry items.

    Skips catalog fuzzy-lookup intentionally — WRatio at any reasonable threshold
    produces cross-food false positives (e.g. "pecorino romano" → "roma tomato").
    Synonym normalization in normalize_food_name() is sufficient for pantry matching.
    """
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
        # Ingredients may be stored as plain strings (e.g. "1 cup flour") or dicts.
        # Parse the string to extract name, quantity, and unit before any dict access.
        if isinstance(ingredient, str):
            ingredient = _parse_ingredient_string(ingredient)

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
