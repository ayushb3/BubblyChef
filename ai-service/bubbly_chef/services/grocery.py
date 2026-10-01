"""A saved meal's to-buy list, for the grocery list (issue #497 / Spec B.5).

The grocery list itself is generated client-side from pantry rows (issue #497
settles that: regenerate on demand, no schema). This is the one piece that
can't be: a saved meal doesn't store its missing ingredients (only the chat
`meal` proposal carries them), so the meal screen's "Add missing to grocery
list" action has to compute them at that point, with the cook matcher's synonym
path against the *current* pantry. The matcher, the staples list and
`PantryItem` are Python-only, hence ai-service.

Deterministic (no LLM) and read-only: it reads the meal and the pantry and
returns names. It writes nothing -- the client puts them on the user's list
after the user confirms.
"""

from __future__ import annotations

import logging
from typing import Any

from bubbly_chef.domain.normalizer import normalize_food_name
from bubbly_chef.domain.stock import filter_usable_pantry_items
from bubbly_chef.repository.supabase_repo import SupabaseRepository
from bubbly_chef.services.ingredient_match import missing_line_names

logger = logging.getLogger(__name__)


class MealNotFoundError(LookupError):
    """The meal doesn't exist or isn't this user's (indistinguishable by design)."""


def _matcher_ingredients(raw: list[Any]) -> list[Any]:
    out: list[Any] = []
    for element in raw:
        if isinstance(element, dict):
            name = str(element.get("name") or "").strip()
            if name:
                out.append(
                    {"name": name, "quantity": element.get("quantity"), "unit": element.get("unit")}
                )
        elif isinstance(element, str) and element.strip():
            out.append(element.strip())
    return out


def missing_ingredients_for_dishes(dishes: list[dict[str, Any]], pantry: list[Any]) -> list[str]:
    """Foods the dishes need that `pantry` lacks, once each, in first-seen order.

    The same resolution as the ingredient tags (`ingredient_match.missing_line_names`:
    the cook matcher's synonym table, culinary staples assumed on hand, water and
    ice never shopped for), so a food is listed here exactly when its row on the
    meal screen reads "To buy" (issue #805). Two dishes needing the same food (by
    normalised name) list it once.
    """
    seen: set[str] = set()
    out: list[str] = []
    for dish in dishes:
        recipe = dish.get("recipe") or {}
        ingredients = _matcher_ingredients(recipe.get("ingredients") or [])
        if not ingredients:
            continue
        for name in missing_line_names(ingredients, pantry):
            key = normalize_food_name(name).lower().strip()
            if key and key not in seen:
                seen.add(key)
                out.append(name)
    return out


async def meal_to_buy(repo: SupabaseRepository, user_id: str, meal_id: str) -> list[str]:
    """A saved meal's missing ingredients against the user's current pantry.

    Raises `MealNotFoundError` when the meal isn't this user's.
    """
    meal = await repo.get_meal_with_dishes(user_id, meal_id)
    if meal is None:
        raise MealNotFoundError(meal_id)
    pantry = filter_usable_pantry_items(await repo.get_all_pantry_items(user_id))
    return missing_ingredients_for_dishes(meal["dishes"], pantry)
