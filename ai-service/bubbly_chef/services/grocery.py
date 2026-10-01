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

from pydantic import BaseModel, Field

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


class ToBuyItem(BaseModel):
    """One food the meal needs, and which dishes need it (issue #805).

    The list is deduped by food (`normalize_food_name`), so "fresh basil" in one
    dish and "basil" in another are one entry. Each dish card still has to list
    every food its own rows read "To buy" for, and only this side knows the key
    that decided "same food", so it says which dishes the entry covers instead of
    leaving the client to re-match names with a different key.
    """

    name: str = Field(description="The deduped name: how the first dish that needs it wrote it")
    dish_positions: list[int] = Field(
        description="The `position` of every dish with a line for this food, in dish order"
    )
    dish_names: list[str] = Field(
        description="That dish's own wording of the food, parallel to `dish_positions`"
    )


def to_buy_items_for_dishes(dishes: list[dict[str, Any]], pantry: list[Any]) -> list[ToBuyItem]:
    """Foods the dishes need that `pantry` lacks, once each, in first-seen order.

    The same resolution as the ingredient tags (`ingredient_match.missing_line_names`:
    the cook matcher's synonym table, culinary staples assumed on hand, water and
    ice never shopped for), so a food is listed here exactly when its row on the
    meal screen reads "To buy" (issue #805). Two dishes needing the same food (by
    normalised name) list it once, with both dishes in `dish_positions`.
    """
    by_key: dict[str, ToBuyItem] = {}
    for index, dish in enumerate(dishes):
        position = dish.get("position")
        dish_position = position if isinstance(position, int) else index
        recipe = dish.get("recipe") or {}
        ingredients = _matcher_ingredients(recipe.get("ingredients") or [])
        if not ingredients:
            continue
        for name in missing_line_names(ingredients, pantry):
            key = normalize_food_name(name).lower().strip()
            if not key:
                continue
            item = by_key.get(key)
            if item is None:
                by_key[key] = ToBuyItem(name=name, dish_positions=[dish_position], dish_names=[name])
            elif dish_position not in item.dish_positions:
                item.dish_positions.append(dish_position)
                item.dish_names.append(name)
    return list(by_key.values())


def missing_ingredients_for_dishes(dishes: list[dict[str, Any]], pantry: list[Any]) -> list[str]:
    """The names of `to_buy_items_for_dishes`, once each, in first-seen order."""
    return [item.name for item in to_buy_items_for_dishes(dishes, pantry)]


async def meal_to_buy_items(repo: SupabaseRepository, user_id: str, meal_id: str) -> list[ToBuyItem]:
    """A saved meal's missing ingredients against the user's current pantry.

    Raises `MealNotFoundError` when the meal isn't this user's.
    """
    meal = await repo.get_meal_with_dishes(user_id, meal_id)
    if meal is None:
        raise MealNotFoundError(meal_id)
    pantry = filter_usable_pantry_items(await repo.get_all_pantry_items(user_id))
    return to_buy_items_for_dishes(meal["dishes"], pantry)


async def meal_to_buy(repo: SupabaseRepository, user_id: str, meal_id: str) -> list[str]:
    """`meal_to_buy_items`, as names only."""
    return [item.name for item in await meal_to_buy_items(repo, user_id, meal_id)]
