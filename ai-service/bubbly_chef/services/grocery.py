"""Grocery-list orchestration (issue #497 / Spec B.5).

Reads the pantry, recent pantry events and (for a meal) its dishes through the
repository, hands them to the pure planners in `domain/grocery.py`, and applies
the resulting plan. No LLM anywhere: the meal's missing ingredients come from
the same deterministic synonym-table matcher the cook flow uses
(`match_ingredients`), which is also why this lives here rather than in the
Next.js routes -- the matcher, the staples list and `PantryItem` are Python-only.

Nothing here runs unprompted: regenerate is the user's button, add-from-meal is
the user's confirmed action.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from bubbly_chef.domain.grocery import (
    DEPLETION_WINDOW_DAYS,
    Candidate,
    ExistingLine,
    derive_candidates,
    food_key,
    in_stock_keys,
    plan_meal_additions,
    plan_regeneration,
)
from bubbly_chef.domain.normalizer import resolve_category
from bubbly_chef.domain.staples import shoppable
from bubbly_chef.domain.stock import filter_usable_pantry_items
from bubbly_chef.repository.supabase_repo import SupabaseRepository
from bubbly_chef.services.cook_matcher import match_ingredients

logger = logging.getLogger(__name__)


class MealNotFoundError(LookupError):
    """The meal doesn't exist or isn't this user's (indistinguishable by design)."""


@dataclass
class RegenerationResult:
    added: int
    updated: int
    removed: int
    items: list[dict[str, Any]]


@dataclass
class MealAdditionResult:
    to_buy: list[str]
    added: list[str]
    already_on_list: list[str]
    items: list[dict[str, Any]]


def _existing_lines(rows: list[dict[str, Any]]) -> list[ExistingLine]:
    return [
        ExistingLine(
            id=str(r["id"]),
            name=str(r["name"]),
            # Recomputed, not the stored key: a line added through the Next.js
            # CRUD routes carries a plain lowercased key, and matching on the
            # normalised name is what stops "spaghetti" and "pasta" doubling up.
            name_key=food_key(str(r["name"])),
            quantity=None if r.get("quantity") is None else float(r["quantity"]),
            unit=r.get("unit"),
            category=str(r.get("category") or "other"),
            source=str(r.get("source") or "manual"),
            checked=bool(r.get("checked")),
        )
        for r in rows
    ]


def _row_for(cand: Candidate) -> dict[str, Any]:
    return {
        "name": cand.name,
        "name_key": cand.name_key,
        "quantity": cand.quantity,
        "unit": cand.unit,
        "category": cand.category,
        "source": cand.source,
        "source_ref": cand.source_ref,
    }


async def regenerate_grocery_list(
    repo: SupabaseRepository, user_id: str, today: date | None = None
) -> RegenerationResult:
    """Refresh the user's list from their pantry and recent depletions.

    Manual and checked lines are kept as they are; unchecked generated lines are
    refreshed or dropped; new needs are added. Idempotent: running it twice in a
    row changes nothing the second time.
    """
    today = today or datetime.now(UTC).date()
    grocery_list = await repo.get_or_create_grocery_list(user_id)
    list_id = str(grocery_list["id"])

    pantry = await repo.get_all_pantry_items(user_id)
    since = datetime.combine(
        today - timedelta(days=DEPLETION_WINDOW_DAYS), datetime.min.time(), tzinfo=UTC
    ).isoformat()
    events = await repo.get_pantry_depletion_events(user_id, since)
    existing = _existing_lines(await repo.get_grocery_items(user_id, list_id))

    plan = plan_regeneration(
        existing,
        derive_candidates(pantry, events, today),
        in_stock_keys(pantry, today),
    )

    if plan.inserts:
        await repo.insert_grocery_items(user_id, list_id, [_row_for(c) for c in plan.inserts])
    for line_id, cand in plan.updates:
        await repo.update_grocery_item(
            user_id,
            line_id,
            {
                "quantity": cand.quantity,
                "unit": cand.unit,
                "category": cand.category,
                "source": cand.source,
            },
        )
    await repo.delete_grocery_items(user_id, plan.deletes)
    await repo.mark_grocery_list_regenerated(user_id, list_id)

    items = await repo.get_grocery_items(user_id, list_id)
    return RegenerationResult(
        added=len(plan.inserts), updated=len(plan.updates), removed=len(plan.deletes), items=items
    )


def _uuid_str(value: Any) -> str:
    """`value` as a UUID string; the matcher needs one but only uses it as a label."""
    try:
        return str(UUID(str(value)))
    except ValueError:
        return str(uuid4())


def _meal_to_buy(dishes: list[dict[str, Any]], pantry: list[Any]) -> list[str]:
    """Foods the meal's dishes need that the pantry lacks, once each, in order.

    Same matcher as the cook flow (synonym table, culinary staples assumed on
    hand), so "to buy" never disagrees with what the cook screen will call
    missing. Water and ice are never shopped for.
    """
    seen: set[str] = set()
    out: list[str] = []
    for dish in dishes:
        recipe = dish.get("recipe") or {}
        raw = recipe.get("ingredients") or []
        ingredients: list[Any] = []
        for element in raw:
            if isinstance(element, dict):
                name = str(element.get("name") or "").strip()
                if name:
                    ingredients.append(
                        {
                            "name": name,
                            "quantity": element.get("quantity"),
                            "unit": element.get("unit"),
                        }
                    )
            elif isinstance(element, str) and element.strip():
                ingredients.append(element.strip())
        if not ingredients:
            continue
        proposal = match_ingredients(
            recipe_id=_uuid_str(recipe.get("id") or dish.get("recipe_id")),
            recipe_title=str(recipe.get("title") or ""),
            recipe_ingredients=ingredients,
            pantry_items=pantry,
        )
        for name in shoppable(list(proposal.missing)):
            key = food_key(name)
            if key and key not in seen:
                seen.add(key)
                out.append(name)
    return out


async def add_meal_missing_to_list(
    repo: SupabaseRepository, user_id: str, meal_id: str
) -> MealAdditionResult:
    """Put a saved meal's to-buy items on the user's list (the user confirmed).

    Computed now, against the current pantry -- a saved meal doesn't store its
    to-buy list. A food already on the list (manual, checked or generated) is
    left as it is and reported in `already_on_list`.

    Raises `MealNotFoundError` when the meal isn't this user's.
    """
    meal = await repo.get_meal_with_dishes(user_id, meal_id)
    if meal is None:
        raise MealNotFoundError(meal_id)

    pantry = filter_usable_pantry_items(await repo.get_all_pantry_items(user_id))
    to_buy = _meal_to_buy(meal["dishes"], pantry)

    grocery_list = await repo.get_or_create_grocery_list(user_id)
    list_id = str(grocery_list["id"])
    existing = _existing_lines(await repo.get_grocery_items(user_id, list_id))

    candidates = [
        Candidate(
            name=name,
            name_key=food_key(name),
            category=resolve_category(name) or "other",
            quantity=None,
            unit=None,
            source="meal",
            source_ref=meal_id,
        )
        for name in to_buy
    ]
    plan = plan_meal_additions(existing, candidates)
    if plan.inserts:
        await repo.insert_grocery_items(user_id, list_id, [_row_for(c) for c in plan.inserts])

    items = await repo.get_grocery_items(user_id, list_id)
    return MealAdditionResult(
        to_buy=to_buy,
        added=[c.name for c in plan.inserts],
        already_on_list=plan.already_on_list,
        items=items,
    )
