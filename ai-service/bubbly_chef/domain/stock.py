"""Which pantry rows count as cookable stock when grounding a recipe (#443).

A row stays in the pantry table after it expires or is cooked down to zero
(the cook flow decrements quantity rather than deleting the row), so every
"what's in the pantry" read has to decide whether such a row is *stock*.
For recipe generation the answer is no: the model was handing users a dish
built around "fresh spinach from your pantry" when the only spinach row was
two days past its date at quantity 0.

Rules, applied identically to `PantryItem` models and to the plain row
dicts the LangGraph workflows carry:

- ``quantity`` is a number ``<= 0``  -> not stock (there is nothing to cook).
- ``quantity`` is ``None`` / missing  -> *unknown*, kept. The column is
  ``NOT NULL DEFAULT 1.0`` so a DB row never hits this, but a client-side
  ``pantry_snapshot`` may omit it, and hiding real stock silently is worse
  than listing an item of unknown amount.
- ``expiry_date`` is before today       -> not stock (matches
  ``PantryItem.is_expired``: ``days_until_expiry < 0``). A row expiring
  *today* or later is stock — that is exactly the food the grounding
  workflow exists to push, so it must keep flowing through.
- ``expiry_date`` is ``None`` / unparseable -> unknown, kept.

Expired and empty rows are dropped rather than passed through with a label:
the failure being fixed is the model ignoring a signal it was given (the
row's date), so the fix can't rely on it honouring a new one.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from bubbly_chef.models.pantry import PantryItem


def _coerce_quantity(value: Any) -> float | None:
    """Return ``value`` as a float, or None when it is absent or not numeric."""
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_expiry(value: Any) -> date | None:
    """Return ``value`` as a date, or None when it is absent or unparseable."""
    if value is None:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def is_usable_stock(
    quantity: Any,
    expiry_date: Any,
    today: date | None = None,
) -> bool:
    """True when a row with this quantity and expiry counts as cookable stock.

    ``quantity`` and ``expiry_date`` accept the raw shapes a row can carry
    (float, numeric string, ISO date string, ``date``, or None); anything
    that can't be read is treated as unknown and the row is kept.
    """
    qty = _coerce_quantity(quantity)
    if qty is not None and qty <= 0:
        return False
    expiry = _coerce_expiry(expiry_date)
    if expiry is not None and expiry < (today or date.today()):
        return False
    return True


def filter_usable_pantry_items(
    items: list[PantryItem], today: date | None = None
) -> list[PantryItem]:
    """Drop expired and zero-quantity rows from a list of ``PantryItem`` models."""
    return [it for it in items if is_usable_stock(it.quantity, it.expiry_date, today)]


def filter_usable_pantry_rows(
    rows: list[dict[str, Any]], today: date | None = None
) -> list[dict[str, Any]]:
    """Drop expired and zero-quantity rows from a list of pantry row dicts.

    Works on both raw snapshot rows and the ``score_and_rank`` output (which
    spreads the original fields, so ``quantity`` and ``expiry_date`` survive).
    """
    return [
        r for r in rows if is_usable_stock(r.get("quantity"), r.get("expiry_date"), today)
    ]
