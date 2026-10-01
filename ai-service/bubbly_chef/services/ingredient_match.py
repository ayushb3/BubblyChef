"""Have / low / missing for each line of a recipe, for the food tags (issue #784).

The recipe card tags every ingredient with whether the pantry covers it. The
only other thing that matches a recipe against the pantry is the cook flow,
which is LLM-backed and builds a deduction proposal, so it can't be called just
to draw tags. This reuses the cook matcher's deterministic pass (`match_ingredients`
with no LLM aliases): the same synonym table, the same base-unit sum across a
food's lots (#356), and the same running total when two lines draw on one food.
Nothing here calls a model or writes.

Stock set. The matching is the cook matcher's, but the pantry it matches against
is NOT the cook flow's: expired and emptied rows are dropped first
(`filter_usable_pantry_items`), exactly as the meal screen's to-buy list does
(`services/grocery.py`). That is deliberate: the tags and the "N to buy" line on
one screen must agree. The cook flow keeps expired lots (behind fresh ones) in
its stock, so a food whose only stock is expired reads `missing` here and is
listed to buy, where cook would still match it.

Status mapping, from the cook matcher's statuses:

- `missing`  -> missing: nothing usable in the pantry (expired and empty rows
  don't count, see above), and not a culinary staple.
- `shortfall` -> low: the pantry holds less than the line needs after unit
  conversion within the same dimension.
- everything else -> have: enough stock (`ready`), no amount asked for or "to
  taste" (`to_taste`, #756), a unit that can't be compared with the pantry's
  (`unit_conflict`, `imprecise`) when the food is present, and a staple the cook
  flow assumes is on hand (`assumed`, so a tag never contradicts the to-buy list).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from bubbly_chef.domain.stock import filter_usable_pantry_items
from bubbly_chef.models.pantry import PantryItem
from bubbly_chef.services.cook_matcher import _parse_ingredient_string, match_ingredients

LineStatus = Literal["have", "low", "missing"]
# What a `have` rests on: stock in the pantry, a staple the cook flow presumes on
# hand ("assumed", not in the pantry), or a line with no amount ("to_taste").
LineBasis = Literal["pantry", "assumed", "to_taste", "none"]

# The matcher only uses the recipe id as a label on the proposal it builds.
_NO_RECIPE = "00000000-0000-0000-0000-000000000000"


class LineMatch(BaseModel):
    """The pantry status of one ingredient line."""

    name: str = Field(description="The ingredient name as given (empty for a blank line)")
    status: LineStatus
    pantry_food: str | None = Field(
        default=None, description="The pantry food that covers the line, when one was matched"
    )
    basis: LineBasis = Field(
        default="none",
        description="pantry=stocked, assumed=staple presumed on hand, to_taste=no amount, none=missing",
    )
    pantry_qty_available: float | None = Field(
        default=None,
        description="Stock left for this line in the base unit, when it could be measured",
    )
    shortfall: float | None = Field(
        default=None, description="How much is lacking, in the base unit; only set when low"
    )


def _as_line(raw: Any) -> dict[str, Any]:
    """One input line as the matcher's `{name, quantity, unit}` dict (name may be empty)."""
    if isinstance(raw, str):
        parsed = _parse_ingredient_string(raw.strip()) if raw.strip() else {}
        return {
            "name": str(parsed.get("name") or "").strip(),
            "quantity": parsed.get("quantity"),
            "unit": parsed.get("unit"),
        }
    if isinstance(raw, dict):
        return {
            "name": str(raw.get("name") or "").strip(),
            "quantity": raw.get("quantity"),
            "unit": raw.get("unit"),
        }
    return {"name": "", "quantity": None, "unit": None}


def match_ingredient_lines(lines: list[Any], pantry: list[PantryItem]) -> list[LineMatch]:
    """One `LineMatch` per input line, in order.

    `lines` are `{name, quantity, unit}` dicts or free-text lines ("200 g flour").
    A blank line has nothing to look up and comes back `missing` with an empty
    name, so the result always lines up with the input. Expired and emptied
    pantry rows are not stock.
    """
    parsed = [_as_line(raw) for raw in lines]
    stocked = filter_usable_pantry_items(pantry)
    proposal = match_ingredients(
        recipe_id=_NO_RECIPE,
        recipe_title="",
        recipe_ingredients=[line for line in parsed if line["name"]],
        pantry_items=stocked,
    )

    # The matcher reports a line with no pantry match in `missing` (by name) and
    # every other line in `matches`, each list in input order. Whether a name is
    # missing depends only on the name, so it says which list a line came from.
    missing_names = set(proposal.missing)
    matches = iter(proposal.matches)

    out: list[LineMatch] = []
    for line in parsed:
        name = line["name"]
        if not name or name in missing_names:
            out.append(LineMatch(name=name, status="missing"))
            continue
        match = next(matches)
        basis: LineBasis = (
            "assumed"
            if match.status == "assumed"
            else "to_taste"
            if match.status == "to_taste"
            else "pantry"
        )
        low = match.status == "shortfall"
        out.append(
            LineMatch(
                name=name,
                status="low" if low else "have",
                pantry_food=match.pantry_item_name,
                basis=basis,
                pantry_qty_available=match.pantry_qty_available,
                shortfall=match.shortfall if low else None,
            )
        )
    return out
