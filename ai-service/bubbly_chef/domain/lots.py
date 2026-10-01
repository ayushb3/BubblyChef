"""The same food held as several pantry rows ("lots"), issue #356.

Each add of a food inserts its own row with its own expiry date, so a pantry
can hold 2 onions bought last week and 3 bought today as two rows. Everything
that asks "how much do I have" sums the rows, and everything that uses some
up takes the lot that will go off first. This module is the one place that
says which lot that is and what a lot is worth in the base unit, so the cook
matcher and the repository's deduction can't disagree.
"""

from __future__ import annotations

from datetime import date

from bubbly_chef.domain.normalizer import normalize_food_name, normalize_to_base_unit
from bubbly_chef.models.pantry import PantryItem


def lot_food_key(name: str) -> str:
    """The key that makes two rows "the same food": the synonym-normalised name.

    Matches how the cook matcher indexes the pantry, so a row the matcher sums
    into one food is also a row a deduction may carry over into.
    """
    return normalize_food_name(name).lower().strip()


def soonest_first_key(item: PantryItem) -> tuple[bool, bool, date, float, str]:
    """Sort key putting the lot to use first, first.

    Stocked lots before empty ones (an empty row is never the one to draw
    from), then the soonest expiry, undated lots last, then the older purchase,
    then the id so the order is stable.
    """
    return (
        item.quantity <= 0,
        item.expiry_date is None,
        item.expiry_date or date.max,
        item.created_at.timestamp(),
        str(item.id),
    )


def lot_base(item: PantryItem) -> tuple[float | None, str | None]:
    """A lot's quantity in its base unit, derived when the row carries none.

    Rows written through the Next.js CRUD routes before #224 have no base
    values, so they are derived from the row's own name/quantity/unit the way
    `deduct_pantry_item` does. `(None, None)` when no base can be worked out
    (a "bag" of spinach): such a lot can't be summed or deducted from.
    """
    if item.quantity_base is not None and item.unit_base is not None:
        return float(item.quantity_base), item.unit_base
    return normalize_to_base_unit(
        name=lot_food_key(item.name), quantity=item.quantity, unit=item.unit
    )

