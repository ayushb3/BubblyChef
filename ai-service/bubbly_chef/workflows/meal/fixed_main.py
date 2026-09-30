"""The fixed main of a "Make it a meal" flow (issue #651 PR B).

A single-dish recipe card (a chat card, a saved-recipe lookup card, the recipe
page) starts the meal flow with that dish as the *fixed main*: every option
keeps it unchanged and differs only in its sides, and the pick never
regenerates it. See `docs/plans/2026-09-30-issue-651-b-make-it-a-meal-
contract.md` for the wire shape (`context.meal_fixed_main`) and every rule
implemented here.

This module deep-validates the request key, resolves a saved recipe by id
(scoped to the caller -- `repo.get_recipe` is the only ownership check, the
service-role client bypasses RLS), and builds the deterministic pieces the
option and pick stages need: the main as a `RecipeCard`, its dish outline, and
the fresh turn's constraints. It imports only models, the repository and
services (plus the recipe workflow's dietary helpers), never `meal/nodes.py`
at module level, so `nodes.py` and `router.py` can both import it.

Nothing here raises: a bad key, a missing row and a repository error all come
back as a `FixedMainRefusal`.
"""

import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ValidationError

from bubbly_chef.domain.diet_terms import norm_label
from bubbly_chef.models.meal import (
    MealDishOutline,
    MealFixedMain,
    MealFixedMainRecipePayload,
)
from bubbly_chef.models.recipe import (
    Ingredient,
    RecipeCard,
    RecipeConstraints,
    StructuredStep,
    build_structured_steps,
)
from bubbly_chef.repository.supabase_repo import get_repository
from bubbly_chef.services.dietary_preferences import get_stored_dietary_preferences
from bubbly_chef.workflows.recipe.nodes import _combine_dietary_preferences
from bubbly_chef.workflows.state import WorkflowState

logger = logging.getLogger(__name__)

MEAL_FIXED_MAIN_KEY = "meal_fixed_main"
MAX_FIXED_MAIN_PAYLOAD_CHARS = 32_768  # UTF-8 bytes of the serialised payload

# Diet tags a fixed main passes on to its sides. Other tags ("quick",
# "comfort food") are never inherited as dietary constraints.
INHERITABLE_DIETS = frozenset(
    {"vegetarian", "vegan", "pescatarian", "dairy-free", "nut-free", "gluten-free"}
)

_MAX_OUTLINE_NAME_CHARS = 200
_MAX_KEY_INGREDIENT_CHARS = 80


class FixedMainRefusal(BaseModel):
    """Why a fixed main could not be used: `invalid` (malformed key) or
    `not_found` (the id isn't one of the caller's recipes)."""

    kind: Literal["invalid", "not_found"]


@dataclass(frozen=True)
class ResolvedFixedMain:
    fixed: MealFixedMain  # what gets retained in MealPlanSessionState
    card: RecipeCard  # the main, ready for the prompt, the outline and the pick
    linked_recipe_id: str | None  # the canonical id to link, or None (a payload or a draft copy)


def has_fixed_main(context: dict[str, Any] | None) -> bool:
    """True iff `context["meal_fixed_main"]` is a dict -- the routing trigger
    only. Any other type is ignored entirely, as if the key were absent."""
    return isinstance(context, dict) and isinstance(context.get(MEAL_FIXED_MAIN_KEY), dict)


# ---------------------------------------------------------------------------
# Recipe rows and payloads -> RecipeCard
# ---------------------------------------------------------------------------


def _int_or_none(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value == value and abs(value) != float("inf"):
        return round(value)
    return None


def _str_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _ingredient_from_row_entry(entry: object) -> Ingredient | None:
    """One `recipes.ingredients` JSONB entry (a plain string or an object) as
    an `Ingredient`; `None` for a blank name or an unreadable entry."""
    if isinstance(entry, str):
        name = entry.strip()
        return Ingredient(name=name) if name else None
    if not isinstance(entry, dict):
        return None
    raw_name = entry.get("name") or entry.get("ingredient")
    name = raw_name.strip() if isinstance(raw_name, str) else ""
    if not name:
        return None
    quantity: float | None = None
    raw_qty = entry.get("quantity")
    if raw_qty is not None and not isinstance(raw_qty, bool):
        try:
            quantity = float(raw_qty)
        except (TypeError, ValueError):
            quantity = None
    substitutes = entry.get("substitutes")
    try:
        return Ingredient(
            name=name,
            quantity=quantity,
            unit=_str_or_none(entry.get("unit")),
            preparation=_str_or_none(entry.get("preparation")),
            optional=entry.get("optional") is True,
            substitutes=(
                [s for s in substitutes if isinstance(s, str)]
                if isinstance(substitutes, list)
                else []
            ),
        )
    except ValidationError:
        return None


def recipe_card_from_row(row: dict[str, Any]) -> RecipeCard:
    """A `recipes` row as a `RecipeCard`.

    `id` is the row's id; `dietary_tags` comes from the row's `tags` column
    (strings only); ingredients come from string or object entries (blank names
    dropped, unreadable entries skipped); `steps` are the row's structured steps
    only when they're a list with the same length as `instructions` and all
    validate, else `None`; `tips` is empty.
    """
    raw_instructions = row.get("instructions")
    instructions = (
        [s for s in raw_instructions if isinstance(s, str)]
        if isinstance(raw_instructions, list)
        else []
    )

    steps: list[StructuredStep] | None = None
    raw_steps = row.get("steps")
    if isinstance(raw_steps, list) and len(raw_steps) == len(instructions):
        try:
            steps = [StructuredStep.model_validate(s) for s in raw_steps]
        except ValidationError:
            steps = None

    raw_ingredients = row.get("ingredients")
    ingredients: list[Ingredient] = []
    if isinstance(raw_ingredients, list):
        for entry in raw_ingredients:
            ingredient = _ingredient_from_row_entry(entry)
            if ingredient is not None:
                ingredients.append(ingredient)

    raw_tags = row.get("tags")
    dietary_tags = [t for t in raw_tags if isinstance(t, str)] if isinstance(raw_tags, list) else []

    return RecipeCard(
        id=uuid.UUID(str(row["id"])),
        title=str(row.get("title") or "").strip(),
        description=_str_or_none(row.get("description")),
        source_url=_str_or_none(row.get("source_url")),
        image_url=_str_or_none(row.get("image_url")),
        prep_time_minutes=_int_or_none(row.get("prep_time_minutes")),
        cook_time_minutes=_int_or_none(row.get("cook_time_minutes")),
        total_time_minutes=_int_or_none(row.get("total_time_minutes")),
        servings=_int_or_none(row.get("servings")),
        ingredients=ingredients,
        instructions=instructions,
        steps=steps,
        cuisine=_str_or_none(row.get("cuisine")),
        meal_type=_str_or_none(row.get("meal_type")),
        dietary_tags=dietary_tags,
        difficulty=_str_or_none(row.get("difficulty")),
        tips=[],
    )


def _card_from_payload(payload: MealFixedMainRecipePayload) -> RecipeCard:
    """The in-chat payload as a `RecipeCard` with a FRESH id. The steps are
    rebuilt from the instructions (text always comes from `instructions`); a
    count mismatch or any invalid step gives `None`, never a rejected payload."""
    steps = (
        build_structured_steps(payload.steps, payload.instructions)
        if payload.steps is not None
        else None
    )
    return RecipeCard(
        title=payload.title.strip(),
        description=payload.description,
        ingredients=[Ingredient.model_validate(i.model_dump()) for i in payload.ingredients],
        instructions=list(payload.instructions),
        steps=steps,
        prep_time_minutes=payload.prep_time_minutes,
        cook_time_minutes=payload.cook_time_minutes,
        total_time_minutes=payload.total_time_minutes,
        servings=payload.servings,
        cuisine=payload.cuisine,
        meal_type=payload.meal_type,
        difficulty=payload.difficulty,
        dietary_tags=list(payload.dietary_tags),
        tips=[],
    )


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------


def _is_zero_rows_error(error: Exception) -> bool:
    """True when `error` is what `.single()` raises for zero matching rows
    (PostgREST code PGRST116, "JSON object requested, multiple (or no) rows
    returned" / "The result contains 0 rows") -- i.e. a plain miss."""
    if getattr(error, "code", None) == "PGRST116":
        return True
    text = str(error).lower()
    return "0 rows" in text or "(or no) rows" in text or "no rows" in text


async def stored_dietary_preferences(user_id: str) -> list[str]:
    """The user's stored diet, or `[]`. Never raises."""
    try:
        return await get_stored_dietary_preferences(user_id)
    except Exception as e:  # noqa: BLE001 -- must degrade to "no stored diet", never raise
        logger.warning("meal fixed main: stored dietary preferences unreadable: %s", e)
        return []


async def _read_saved_recipe(
    user_id: str, recipe_id: str
) -> tuple[RecipeCard, bool] | FixedMainRefusal:
    """Read the caller's own recipe row (`get_recipe` filters on user_id -- the
    only ownership check) as `(card, is_draft)`. A miss (including someone else's
    id and the zero-row error `.single()` raises) is `not_found`. Any OTHER
    repository failure is logged at warning and is `invalid` ("try again"): it
    says nothing about whether the recipe exists, so it must not read as deleted."""
    try:
        repo = await get_repository()
        row = await repo.get_recipe(user_id, recipe_id)
    except Exception as e:  # noqa: BLE001 -- a read failure must never raise out of the stage
        if _is_zero_rows_error(e):
            logger.info(
                "meal fixed main: recipe not found (recipe_id=%s user_id=%s)", recipe_id, user_id
            )
            return FixedMainRefusal(kind="not_found")
        logger.warning(
            "meal fixed main: recipe read failed (recipe_id=%s user_id=%s): %s: %s",
            recipe_id,
            user_id,
            type(e).__name__,
            e,
        )
        return FixedMainRefusal(kind="invalid")
    if not row:
        logger.info("meal fixed main: recipe not found (recipe_id=%s user_id=%s)", recipe_id, user_id)
        return FixedMainRefusal(kind="not_found")
    try:
        card = recipe_card_from_row(row)
    except (ValueError, TypeError, ValidationError) as e:
        logger.warning(
            "meal fixed main: unreadable recipe row (recipe_id=%s user_id=%s): %s",
            recipe_id,
            user_id,
            type(e).__name__,
        )
        return FixedMainRefusal(kind="invalid")
    if not card.title:
        card = card.model_copy(update={"title": "Untitled recipe"})
    if row.get("is_draft") is True:
        # A draft is never linked (the meal's DELETE would remove it and Save
        # would silently promote it): use it as a payload copy, fresh id.
        logger.info("meal fixed main: draft recipe used as a copy (recipe_id=%s)", recipe_id)
        return card.model_copy(update={"id": uuid.uuid4()}), True
    return card, False


async def resolve_fixed_main(user_id: str, raw: object) -> ResolvedFixedMain | FixedMainRefusal:
    """Deep validation of `context["meal_fixed_main"]` for a FRESH fixed-main
    turn, returning the card too so the row is read ONCE on that turn. A draft
    row by id comes back as source "chat" with a fresh-id card and
    `linked_recipe_id` None. Never raises."""
    if not isinstance(raw, dict):
        return FixedMainRefusal(kind="invalid")

    has_id = "recipe_id" in raw
    has_recipe = "recipe" in raw
    if has_id == has_recipe:  # both, or neither
        return FixedMainRefusal(kind="invalid")

    if has_id:
        raw_id = raw["recipe_id"]
        if not isinstance(raw_id, str):
            return FixedMainRefusal(kind="invalid")
        try:
            canonical = str(uuid.UUID(raw_id))
        except ValueError:
            return FixedMainRefusal(kind="invalid")
        return await _resolve_saved(user_id, canonical)

    raw_recipe = raw["recipe"]
    if not isinstance(raw_recipe, dict):
        return FixedMainRefusal(kind="invalid")
    try:
        # Measured in UTF-8 bytes of the un-escaped JSON, so a non-ASCII recipe
        # isn't counted as \uXXXX escapes (6 bytes a character) nor under-counted.
        size = len(json.dumps(raw_recipe, ensure_ascii=False).encode("utf-8"))
        if size > MAX_FIXED_MAIN_PAYLOAD_CHARS:
            return FixedMainRefusal(kind="invalid")
        payload = MealFixedMainRecipePayload.model_validate(raw_recipe)
        if not payload.title.strip():
            return FixedMainRefusal(kind="invalid")
        card = _card_from_payload(payload)
    except (TypeError, ValueError, RecursionError, ValidationError):
        return FixedMainRefusal(kind="invalid")
    fixed = MealFixedMain(source="chat", title=card.title, recipe=card)
    return ResolvedFixedMain(fixed=fixed, card=card, linked_recipe_id=None)


async def _resolve_saved(user_id: str, canonical_id: str) -> ResolvedFixedMain | FixedMainRefusal:
    read = await _read_saved_recipe(user_id, canonical_id)
    if isinstance(read, FixedMainRefusal):
        return read
    card, is_draft = read
    if is_draft:
        # A draft: retain the fresh-id copy as a chat main, link nothing.
        fixed = MealFixedMain(source="chat", title=card.title, recipe=card)
        return ResolvedFixedMain(fixed=fixed, card=card, linked_recipe_id=None)
    fixed = MealFixedMain(source="saved", recipe_id=canonical_id, title=card.title)
    return ResolvedFixedMain(fixed=fixed, card=card, linked_recipe_id=canonical_id)


async def load_fixed_main_card(
    user_id: str, fixed: MealFixedMain
) -> ResolvedFixedMain | FixedMainRefusal:
    """For a RETAINED fixed main (a `meal_followup` option turn, or the pick).

    source "saved": re-reads the row, so a deletion between turns is caught
    before any model call. Gone -> `not_found`; now a draft -> a fresh-id card
    and `linked_recipe_id` None (a copy). source "chat": `fixed.recipe` as is.
    Never raises."""
    if fixed.source == "chat":
        if fixed.recipe is None:  # unreachable: the model validator forbids it
            return FixedMainRefusal(kind="invalid")
        return ResolvedFixedMain(fixed=fixed, card=fixed.recipe, linked_recipe_id=None)
    if fixed.recipe_id is None:  # unreachable: the model validator forbids it
        return FixedMainRefusal(kind="invalid")
    return await _resolve_saved(user_id, fixed.recipe_id)


# ---------------------------------------------------------------------------
# Constraints, outline
# ---------------------------------------------------------------------------


def _constraints_from(container: object) -> dict[str, Any]:
    """`recipe_constraints` from a session-metadata-shaped dict, or `{}`."""
    return container if isinstance(container, dict) else {}


async def fixed_main_constraints(state: WorkflowState, card: RecipeCard) -> dict[str, Any]:
    """The fresh fixed-main turn's `recipe_constraints`, with no model call.

    - `dietary`: the user's stored diet combined with the main's own diet tags
      (only `INHERITABLE_DIETS`), with a stored diet the main contradicts set
      aside (#394's rule, the main as the haystack).
    - `servings`: the recipe's own when it's 1-20, else unset.
    - `meal_type`: breakfast/lunch/dinner from the recipe, else unset.
    - `excluded_ingredients`: NEVER dropped -- the case-insensitive union of the
      session's and the retained meal's lists.
    - `use_pantry`: False wins across the session's constraints and the
      retained meal's; else True if either says True; else unset.
    Never raises: a failed stored-preference read counts as no stored diet.
    """
    # Lazy: nodes.py imports this module, so a top-level import would be a cycle.
    from bubbly_chef.workflows.meal.nodes import _case_insensitive_union

    user_id = state.get("user_id") or ""
    stored = await stored_dietary_preferences(user_id)

    inherited = [t for t in card.dietary_tags if norm_label(t) in INHERITABLE_DIETS]
    dietary = _combine_dietary_preferences(
        stored,
        inherited,
        {"preferred_ingredients": [i.name for i in card.ingredients]},
        card.title,
    )

    servings = (
        card.servings
        if isinstance(card.servings, int)
        and not isinstance(card.servings, bool)
        and 1 <= card.servings <= 20
        else None
    )
    meal_type = (card.meal_type or "").strip().lower()

    session = state.get("session") or {}
    metadata = _constraints_from(session.get("metadata") if isinstance(session, dict) else None)
    session_rc = _constraints_from(metadata.get("recipe_constraints"))
    meal_plan = _constraints_from(metadata.get("meal_plan"))
    meal_rc = _constraints_from(
        _constraints_from(meal_plan.get("constraints")).get("recipe_constraints")
    )

    def _names(rc: dict[str, Any]) -> list[str]:
        raw = rc.get("excluded_ingredients")
        return [s for s in raw if isinstance(s, str)] if isinstance(raw, list) else []

    excluded = _case_insensitive_union(_names(session_rc), _names(meal_rc))

    pantry_flags = [session_rc.get("use_pantry"), meal_rc.get("use_pantry")]
    use_pantry: bool | None
    if any(flag is False for flag in pantry_flags):
        use_pantry = False
    elif any(flag is True for flag in pantry_flags):
        use_pantry = True
    else:
        use_pantry = None

    return RecipeConstraints(
        dietary=dietary,
        servings=servings,
        meal_type=meal_type if meal_type in ("breakfast", "lunch", "dinner") else None,
        excluded_ingredients=excluded,
        use_pantry=use_pantry,
    ).model_dump()


def fixed_main_outline(card: RecipeCard) -> MealDishOutline:
    """The fixed main as a dish outline: role "main", name = the whitespace-
    collapsed title capped at 200. `key_ingredients` is every non-blank
    ingredient name (collapsed, capped at 80, deduped case-insensitively), so
    the pantry-coverage match sees the main's REAL ingredients.

    `est_total_minutes`: `total_time_minutes`, else prep + cook when either is
    set, else the sum of the step durations when there are steps, else None.
    `est_hands_on_minutes`: the sum of the hands-on step durations when there
    are steps, else `prep_time_minutes`, else None.
    """
    key_ingredients: list[str] = []
    seen: set[str] = set()
    for ingredient in card.ingredients:
        name = " ".join(ingredient.name.split())[:_MAX_KEY_INGREDIENT_CHARS]
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        key_ingredients.append(name)

    steps = card.steps or []
    est_total: int | None
    if card.total_time_minutes is not None:
        est_total = card.total_time_minutes
    elif card.prep_time_minutes is not None or card.cook_time_minutes is not None:
        est_total = (card.prep_time_minutes or 0) + (card.cook_time_minutes or 0)
    elif steps:
        est_total = sum(s.duration_minutes for s in steps)
    else:
        est_total = None

    est_hands_on: int | None
    if steps:
        est_hands_on = sum(s.duration_minutes for s in steps if s.hands_on)
    else:
        est_hands_on = card.prep_time_minutes

    return MealDishOutline(
        role="main",
        name=" ".join(card.title.split())[:_MAX_OUTLINE_NAME_CHARS],
        key_ingredients=key_ingredients,
        est_total_minutes=est_total,
        est_hands_on_minutes=est_hands_on,
    )
