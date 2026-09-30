"""Deterministic grocery-list derivation (issue #497 / Spec B.5).

Pure functions, no I/O and no LLM: given the user's pantry rows, their recent
`pantry_events`, and the lines already on their list, work out what the list
should hold. The orchestration (reading and writing the DB) lives in
`services/grocery.py`; this module only decides.

**What makes a food a candidate.** Pantry rows are grouped by normalised food
name first (issue #356, Option A: separate rows that sum), so a food is judged
on all its lots together, never one row at a time:

- ``depleted``  -- every lot is at quantity 0, or the food was used/cooked up
  recently and its row is gone (resolving a pantry item deletes the row, so the
  ``pantry_events`` row is the only trace).
- ``expiring``  -- there is stock, but every lot with stock is expired or
  expires within ``EXPIRING_DAYS`` ("replace soon").
- ``low``       -- there is fresh stock, but the total is at or under a fixed
  per-base-unit floor (``LOW_STOCK_FLOOR``). There is deliberately no per-item
  threshold (the issue defers that); this is one conservative constant per
  dimension, and a food whose unit can't be put on a base dimension is never
  "low" -- we'd rather miss a nudge than invent one.

A food with any fresh lot of healthy size is never a candidate, whatever its
other lots look like.

**Merging into the list** (`plan_regeneration`): manual lines and checked lines
are never touched; unchecked generated lines (depleted/expiring/low) are
refreshed or dropped to match the new candidates; unchecked ``meal`` lines stay
until the food is actually in stock. Everything is keyed on ``name_key`` so one
food is one line.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Literal

from bubbly_chef.domain.normalizer import (
    normalize_food_name,
    normalize_to_base_unit,
    resolve_category,
)
from bubbly_chef.domain.staples import NEVER_TO_BUY
from bubbly_chef.models.pantry import PantryItem

GrocerySource = Literal["depleted", "expiring", "low", "meal", "manual"]

# Sources `regenerate` owns. `manual` and `meal` lines are the user's (or a
# meal's) request and are only ever dropped by the user or once stocked.
GENERATED_SOURCES: frozenset[str] = frozenset({"depleted", "expiring", "low"})

# "Replace soon": expired, or expiring today or tomorrow (the issue's rule,
# `days_until_expiry <= 1`).
EXPIRING_DAYS = 1

# How far back a used/cooked event still says "you ran out of this". A month
# covers a normal shop cycle without resurrecting things eaten last season.
DEPLETION_WINDOW_DAYS = 30

# Low stock: total across a food's fresh lots at or under this many base units.
LOW_STOCK_FLOOR: dict[str, float] = {"count": 1.0, "g": 50.0, "ml": 100.0}

_DEPLETION_OUTCOMES = frozenset({"used", "cooked"})  # 'tossed' is waste, not running out


def food_key(name: str) -> str:
    """The dedupe key for a food: its normalised name, lowercased."""
    return normalize_food_name(name or "").lower().strip()


@dataclass(frozen=True)
class Candidate:
    """One line the list should hold, as derived (not yet persisted)."""

    name: str
    name_key: str
    category: str
    quantity: float | None
    unit: str | None
    source: GrocerySource
    source_ref: str | None = None


@dataclass(frozen=True)
class ExistingLine:
    """A line already on the list (the fields the planner needs)."""

    id: str
    name: str
    name_key: str
    quantity: float | None
    unit: str | None
    category: str
    source: str
    checked: bool


@dataclass
class RegenerationPlan:
    inserts: list[Candidate] = field(default_factory=list)
    updates: list[tuple[str, Candidate]] = field(default_factory=list)
    deletes: list[str] = field(default_factory=list)


@dataclass
class MealAdditionPlan:
    inserts: list[Candidate] = field(default_factory=list)
    already_on_list: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Derivation
# ---------------------------------------------------------------------------


def _is_expired(item: PantryItem, today: date) -> bool:
    return item.expiry_date is not None and item.expiry_date < today


def _days_left(item: PantryItem, today: date) -> int | None:
    return None if item.expiry_date is None else (item.expiry_date - today).days


def _is_fresh(item: PantryItem, today: date) -> bool:
    """A lot with stock that is neither expired nor about to be."""
    if item.quantity <= 0:
        return False
    days = _days_left(item, today)
    return days is None or days > EXPIRING_DAYS


def in_stock_keys(items: list[PantryItem], today: date) -> set[str]:
    """Foods with at least one lot that has stock and isn't expired.

    An item expiring tomorrow is still in the kitchen, so it counts; it is the
    ``expiring`` rule (not this one) that nudges the user to replace it.
    """
    return {
        food_key(i.name)
        for i in items
        if i.quantity > 0 and not _is_expired(i, today) and food_key(i.name)
    }


def _base_quantity(item: PantryItem) -> tuple[float, str] | None:
    """(quantity in base units, base unit) for a lot, or None if unknowable."""
    if item.quantity_base is not None and item.unit_base:
        return float(item.quantity_base), item.unit_base
    qty, unit = normalize_to_base_unit(
        name=food_key(item.name),
        quantity=item.quantity,
        unit=item.unit,
        category=item.category.value,
    )
    if qty is None or unit is None:
        return None
    return float(qty), unit


def _is_low(fresh_lots: list[PantryItem]) -> bool:
    bases = [_base_quantity(i) for i in fresh_lots]
    if not bases or any(b is None for b in bases):
        return False
    units = {b[1] for b in bases if b is not None}
    if len(units) != 1:
        return False  # mixed dimensions: can't add them up honestly
    unit = next(iter(units))
    floor = LOW_STOCK_FLOOR.get(unit)
    if floor is None:
        return False
    return sum(b[0] for b in bases if b is not None) <= floor


def _parse_event_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value)).date()
    except (TypeError, ValueError):
        return None


def _float_or_none(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _recent_depletion_events(
    events: list[dict[str, Any]], today: date
) -> dict[str, list[dict[str, Any]]]:
    """Used/cooked events inside the window, newest first, grouped by food."""
    cutoff = today - timedelta(days=DEPLETION_WINDOW_DAYS)
    grouped: dict[str, list[tuple[date, dict[str, Any]]]] = defaultdict(list)
    for ev in events:
        if ev.get("outcome") not in _DEPLETION_OUTCOMES:
            continue
        when = _parse_event_date(ev.get("created_at"))
        key = food_key(str(ev.get("item_name") or ""))
        if when is None or when < cutoff or when > today or not key:
            continue
        grouped[key].append((when, ev))
    return {
        key: [ev for _, ev in sorted(pairs, key=lambda p: p[0], reverse=True)]
        for key, pairs in grouped.items()
    }


def _last_known_amount(
    events: list[dict[str, Any]], fallback_unit: str | None
) -> tuple[float | None, str | None]:
    """Quantity/unit of the newest event that recorded a positive quantity."""
    for ev in events:
        qty = _float_or_none(ev.get("quantity"))
        if qty is not None and qty > 0:
            unit = ev.get("unit")
            return qty, (str(unit) if unit else fallback_unit)
    return None, fallback_unit


def _category_for(name: str, lots: list[PantryItem]) -> str:
    for lot in lots:
        if lot.category.value != "other":
            return lot.category.value
    return resolve_category(name) or "other"


def derive_candidates(
    items: list[PantryItem],
    events: list[dict[str, Any]],
    today: date,
) -> list[Candidate]:
    """What the pantry and recent events say the user should buy, sorted by key."""
    lots_by_key: dict[str, list[PantryItem]] = defaultdict(list)
    for item in items:
        key = food_key(item.name)
        if key:
            lots_by_key[key].append(item)
    events_by_key = _recent_depletion_events(events, today)

    candidates: list[Candidate] = []
    for key in sorted(set(lots_by_key) | set(events_by_key)):
        if key in NEVER_TO_BUY:
            continue
        lots = lots_by_key.get(key, [])
        key_events = events_by_key.get(key, [])
        live = [lot for lot in lots if lot.quantity > 0]
        fresh = [lot for lot in live if _is_fresh(lot, today)]
        display = (lots[0].name if lots else str(key_events[0].get("item_name") or key)).strip()
        category = _category_for(display, lots)

        if fresh:
            if _is_low(fresh):
                biggest = max(fresh, key=lambda lot: lot.quantity)
                candidates.append(
                    Candidate(display, key, category, biggest.quantity, biggest.unit, "low")
                )
            continue

        if live:
            # Only expired / about-to-expire stock. Suggest replacing the
            # latest-dated lot (None dates sort last as "never expires").
            lot = max(live, key=lambda x: x.expiry_date or date.max)
            candidates.append(
                Candidate(display, key, category, lot.quantity, lot.unit, "expiring")
            )
            continue

        if lots:
            qty, unit = _last_known_amount(key_events, lots[0].unit)
            candidates.append(Candidate(display, key, category, qty, unit, "depleted"))
        elif key_events:
            qty, unit = _last_known_amount(key_events, None)
            candidates.append(Candidate(display, key, category, qty, unit, "depleted"))

    return candidates


# ---------------------------------------------------------------------------
# Merging into the list
# ---------------------------------------------------------------------------


def _same_content(line: ExistingLine, cand: Candidate) -> bool:
    return (
        line.quantity == cand.quantity
        and line.unit == cand.unit
        and line.category == cand.category
        and line.source == cand.source
    )


def plan_regeneration(
    existing: list[ExistingLine],
    candidates: list[Candidate],
    stocked_keys: set[str],
) -> RegenerationPlan:
    """Merge fresh `candidates` into the `existing` lines.

    Untouched: manual lines, checked lines, and unchecked meal lines whose food
    is still not in stock. Refreshed in place: unchecked generated lines that
    are still candidates. Removed: unchecked generated lines that no longer are,
    and unchecked meal lines whose food is now in `stocked_keys`.
    """
    by_key = {line.name_key: line for line in existing}
    plan = RegenerationPlan()
    candidate_keys: set[str] = set()

    for cand in candidates:
        if cand.name_key in candidate_keys:
            continue
        candidate_keys.add(cand.name_key)
        line = by_key.get(cand.name_key)
        if line is None:
            plan.inserts.append(cand)
        elif line.source in GENERATED_SOURCES and not line.checked:
            if not _same_content(line, cand):
                plan.updates.append((line.id, cand))
        # else: manual / checked / meal line -- the user's, leave it alone.

    for line in existing:
        if line.checked or line.source == "manual":
            continue
        if line.source in GENERATED_SOURCES and line.name_key not in candidate_keys:
            plan.deletes.append(line.id)
        elif line.source == "meal" and line.name_key in stocked_keys:
            plan.deletes.append(line.id)

    return plan


def plan_meal_additions(
    existing: list[ExistingLine],
    candidates: list[Candidate],
) -> MealAdditionPlan:
    """Which of a meal's to-buy foods go on the list; the rest are reported.

    Adding never disturbs a line that is already there (manual, checked or
    generated): the food is on the list, which is all the user asked for.
    """
    seen = {line.name_key for line in existing}
    plan = MealAdditionPlan()
    for cand in candidates:
        if cand.name_key in seen:
            if cand.name not in plan.already_on_list:
                plan.already_on_list.append(cand.name)
            continue
        seen.add(cand.name_key)
        plan.inserts.append(cand)
    return plan
