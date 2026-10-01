"""The meal screen's side-slot flow (issue #652): alternatives for a side,
and expanding one outline into a full recipe.

Two entry points, backing `POST /v1/meals/side-alternatives` and
`POST /v1/meals/expand-dish` (`api/routes/meals_ai.py`):

- `generate_side_alternatives` -- one structured `AIManager` call for up to
  3 alternative sides, naming the main and the *other* side (not the one
  being replaced) as "the rest of the meal", plus a separate "don't suggest
  this" line for the side actually being replaced. Every current dish,
  including the one being replaced, is also excluded afterward by a
  deterministic dedup filter -- the backstop regardless of what the prompt
  says.
- `expand_meal_dish` -- reuses `workflows.meal.nodes._expand_dish` (the pick
  stage's per-dish generation) to turn one outline into a full `RecipeCard`.

Both reuse the pick stage's pantry-opt-out gate (`is_pantry_grounded`) and
scoring helpers rather than re-implementing them, and both load the meal
through `SupabaseRepository.get_meal_with_dishes` -- never re-deriving a
meal's constraints from scratch. Neither writes to the DB: the client
persists an accepted result through `PUT /api/meals/[id]`.
"""

import json
import logging
import re
from typing import Any, Literal, NamedTuple

from bubbly_chef.ai import AIManager
from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.ai.provider import user_message_for_failure
from bubbly_chef.domain.allergens import allergens_named
from bubbly_chef.models.meal import (
    MealConstraintsEcho,
    MealDishOutline,
    MealOption,
    MealSideAlternativesLLMResult,
)
from bubbly_chef.models.recipe import RecipeCard
from bubbly_chef.prompts.meal import (
    MEAL_DISH_PANTRY_BLOCK,
    MEAL_DISH_PANTRY_BLOCK_NO_PANTRY,
    MEAL_SIDE_ALTERNATIVES_SYSTEM_PROMPT,
)
from bubbly_chef.repository.supabase_repo import SupabaseRepository
from bubbly_chef.services.allergen_guard import (
    AllergenViolation,
    allergen_refusal_message,
    generate_allergen_safe,
)
from bubbly_chef.services.food_exclusions import allergy_never_block, get_stored_food_exclusions
from bubbly_chef.workflows.meal.nodes import (
    _expand_dish,
    _pantry_items_for_matching,
    _score_items_for_dish_prompt,
)
from bubbly_chef.workflows.recipe.nodes import _format_pantry_item_for_prompt, is_pantry_grounded

logger = logging.getLogger(__name__)

ErrorKind = Literal["model_unavailable", "invalid_output", "generation_failed"]

# Alternatives asked for per side-alternatives call -- matches the prompt's
# "exactly 3".
_MAX_ALTERNATIVES = 3


class MealNotFoundError(Exception):
    """Raised when `meal_id` doesn't exist or doesn't belong to `user_id`."""

    def __init__(self, meal_id: str) -> None:
        self.meal_id = meal_id
        super().__init__(f"Meal not found: {meal_id}")


class MealGenerationUnavailableError(Exception):
    """Raised when a meal-screen generation call can't be completed.

    `error_kind` mirrors `structured_steps.StructuredStepsUnavailableError`,
    plus one meal-screen-specific kind:
    - "model_unavailable": no AI provider could be reached.
    - "invalid_output": the model responded, but nothing usable came back
      (wrong type, or -- for side-alternatives -- no valid alternative).
    - "generation_failed": the dish-expansion call raised for some other
      reason (a malformed response, a transient provider error, ...). The
      exception is logged; `message` is always the same fixed, user-facing
      string -- never `str(exception)`, which could leak provider internals.
    """

    def __init__(self, error_kind: ErrorKind, message: str) -> None:
        self.error_kind: ErrorKind = error_kind
        self.message = message
        super().__init__(message)


class _LoadedMeal(NamedTuple):
    """One meal's context, as the meal-screen routes need it."""

    title: str
    servings: int
    constraints_echo: MealConstraintsEcho
    dishes: list[dict[str, Any]]  # {"role", "position", "recipe": <recipes row>}


def _role(value: Any) -> Literal["main", "side"]:
    return "main" if value == "main" else "side"


def _dish_title(dish: dict[str, Any]) -> str:
    return str(dish["recipe"].get("title") or "")


# ---------------------------------------------------------------------------
# Fuzzy dish-name dedup (review fix on issue #652's PR)
#
# An exact-lowercase compare missed the common case: a stored recipe title
# ("Garlicky Roasted Broccoli with Lemon") is almost always longer and more
# specific than a short outline name for the same dish ("Roasted broccoli").
# `_same_dish` normalises both to a stopword-stripped token set and treats
# them as the same dish when one set is a subset of the other, or their
# overlap (Jaccard) is at least 0.6 -- deterministic, no model call.
# ---------------------------------------------------------------------------

_PUNCT_RE = re.compile(r"[^\w\s]")
_DISH_NAME_STOPWORDS = frozenset({"with", "and", "the", "a", "an", "of", "in", "on", "to", "for"})
_JACCARD_SAME_DISH_THRESHOLD = 0.6


def _dish_name_tokens(name: str) -> frozenset[str]:
    cleaned = _PUNCT_RE.sub(" ", name.lower())
    return frozenset(t for t in cleaned.split() if t and t not in _DISH_NAME_STOPWORDS)


def _same_dish(name_a: str, name_b: str) -> bool:
    """Whether `name_a` and `name_b` are close enough to count as one dish."""
    tokens_a = _dish_name_tokens(name_a)
    tokens_b = _dish_name_tokens(name_b)
    if not tokens_a or not tokens_b:
        # Nothing but stopwords/punctuation survived normalization on one
        # side -- fall back to a plain exact compare rather than treating
        # every such name as identical.
        return name_a.strip().lower() == name_b.strip().lower()
    if tokens_a <= tokens_b or tokens_b <= tokens_a:
        return True
    overlap = len(tokens_a & tokens_b) / len(tokens_a | tokens_b)
    return overlap >= _JACCARD_SAME_DISH_THRESHOLD


async def _load_meal(user_id: str, meal_id: str, repo: SupabaseRepository) -> _LoadedMeal | None:
    row = await repo.get_meal_with_dishes(user_id, meal_id)
    if row is None:
        return None
    meal_row = row["meal"]
    constraints_echo = MealConstraintsEcho.model_validate(meal_row.get("constraints") or {})
    return _LoadedMeal(
        title=str(meal_row.get("title") or ""),
        servings=int(meal_row.get("servings") or 2),
        constraints_echo=constraints_echo,
        dishes=list(row["dishes"]),
    )


def _constraints_json(constraints_echo: MealConstraintsEcho) -> str:
    return json.dumps(
        {
            k: v
            for k, v in constraints_echo.recipe_constraints.items()
            if v and k not in ("use_pantry", "servings", "kitchen_limits")
        }
    )


async def _pantry_grounding(
    user_id: str,
    constraints_echo: MealConstraintsEcho,
    allergies: list[str] | None = None,
) -> tuple[bool, list[dict[str, Any]]]:
    """`(pantry_grounded, scored_items)` for one dish prompt.

    The same opt-out gate the pick stage applies (issue #287): with
    `use_pantry: false` on the meal's echoed constraints, the pantry is
    never read.
    """
    pantry_grounded = is_pantry_grounded(constraints_echo.recipe_constraints)
    if not pantry_grounded:
        return False, []
    pantry_items = await _pantry_items_for_matching(user_id)
    scored_items = _score_items_for_dish_prompt(
        pantry_items, constraints_echo.recipe_constraints, allergies
    )
    return True, scored_items


def _pantry_block_text(pantry_grounded: bool, scored_items: list[dict[str, Any]]) -> str:
    """The `{pantry_block}` text for a dish prompt -- mirrors `_expand_dish`'s
    own pantry-block construction, for the side-alternatives prompt, which
    doesn't go through `_expand_dish` itself."""
    if not pantry_grounded:
        return MEAL_DISH_PANTRY_BLOCK_NO_PANTRY
    priority_items = [
        _format_pantry_item_for_prompt(i) for i in scored_items if i.get("_score", 0) >= 5
    ]
    supporting_items = [
        _format_pantry_item_for_prompt(i) for i in scored_items if 0 <= i.get("_score", 0) < 5
    ]
    return MEAL_DISH_PANTRY_BLOCK.format(
        priority_items=", ".join(priority_items[:8]) or "none specified",
        supporting_items=", ".join(supporting_items[:10]) or "none",
    )


# ---------------------------------------------------------------------------
# Side alternatives
# ---------------------------------------------------------------------------


async def generate_side_alternatives(
    *,
    user_id: str,
    meal_id: str,
    position: int | None,
    repo: SupabaseRepository,
    ai_manager: AIManager,
) -> list[MealDishOutline]:
    """1-3 alternative sides for one slot in an existing meal.

    `position` is the side being replaced (1 or 2), or `None` when adding a
    new side. The prompt names the main and the *other* side (not the one at
    `position`) as "the rest of the meal" -- but, for a swap, the side being
    replaced is named separately in an explicit "don't suggest this" line
    (`avoid_line`), because leaving it out of the prompt entirely made the
    model re-propose it often enough to shrink the row below 3 cards once
    the dedup filter (below) dropped the duplicate. That filter is still the
    backstop: it excludes every current dish, including the one being
    replaced, regardless of whether the model honors `avoid_line`.
    """
    loaded = await _load_meal(user_id, meal_id, repo)
    if loaded is None:
        raise MealNotFoundError(meal_id)

    main_dish = next((d for d in loaded.dishes if d["role"] == "main"), None)
    other_side = next(
        (d for d in loaded.dishes if d["role"] == "side" and d["position"] != position),
        None,
    )
    replaced_dish = next((d for d in loaded.dishes if d["position"] == position), None)
    current_titles = [_dish_title(d) for d in loaded.dishes if _dish_title(d)]

    constraints_echo = loaded.constraints_echo
    # Read from the profile on every call (#500), never from the meal's stored echo.
    allergies = list((await get_stored_food_exclusions(user_id)).allergies)
    pantry_grounded, scored_items = await _pantry_grounding(user_id, constraints_echo, allergies)
    pantry_block = _pantry_block_text(pantry_grounded, scored_items)

    avoid_line = ""
    if replaced_dish is not None:
        replaced_name = _dish_title(replaced_dish)
        avoid_line = (
            f'Suggest alternatives to "{replaced_name}"; don\'t suggest it or a close variant.'
        )

    prompt = MEAL_SIDE_ALTERNATIVES_SYSTEM_PROMPT.format(
        meal_title=loaded.title,
        servings=loaded.servings,
        main_name=_dish_title(main_dish) if main_dish else "unknown",
        other_side=_dish_title(other_side) if other_side else "none -- this is the only side",
        avoid_line=avoid_line,
        kitchen_limits=", ".join(constraints_echo.kitchen_limits) or "none",
        exclusive_tags=", ".join(constraints_echo.exclusive_tags) or "none",
        constraints_json=_constraints_json(constraints_echo),
        pantry_block=pantry_block,
    )
    prompt += allergy_never_block(allergies)

    async def _propose(extra: str) -> Any:
        return await ai_manager.complete(
            prompt=prompt + extra,
            response_schema=MealSideAlternativesLLMResult,
            temperature=0.7,
        )

    def _alternative_allergens(alt: Any) -> list[str]:
        return allergens_named(allergies, alt.name, *alt.key_ingredients)

    def _named_allergens(candidate: Any) -> list[str]:
        if not isinstance(candidate, MealSideAlternativesLLMResult):
            return []
        return list(
            dict.fromkeys(a for alt in candidate.alternatives for a in _alternative_allergens(alt))
        )

    def _without_allergen_alternatives(candidate: Any) -> Any:
        # Still dirty after one regeneration: keep the clean alternatives, refuse when none is.
        clean = [alt for alt in candidate.alternatives if not _alternative_allergens(alt)]
        return candidate.model_copy(update={"alternatives": clean}) if clean else None

    try:
        # The model is not the only line of defence against an allergen (#500).
        result = await generate_allergen_safe(
            _propose, _named_allergens, allergies, salvage=_without_allergen_alternatives
        )
    except AllergenViolation as e:
        raise MealGenerationUnavailableError(
            "invalid_output", allergen_refusal_message(e.allergens, "a side for that")
        ) from e
    except NoProviderAvailableError as e:
        raise MealGenerationUnavailableError(
            "model_unavailable", user_message_for_failure(e.kind, e.configured)
        ) from e

    if not isinstance(result, MealSideAlternativesLLMResult):
        raise MealGenerationUnavailableError(
            "invalid_output", "The model returned an unexpected response."
        )

    valid: list[MealDishOutline] = []
    for raw in result.alternatives:
        if raw.role != "side":
            continue
        name = raw.name.strip()
        if not name:
            continue
        # Fuzzy dedup, against every current dish (including the one being
        # replaced) and against the alternatives already accepted this call
        # -- `_same_dish` catches a stored title ("Garlicky Roasted Broccoli
        # with Lemon") matching a shorter outline name ("Roasted broccoli"),
        # which an exact compare missed.
        if any(_same_dish(name, title) for title in current_titles):
            continue
        if any(_same_dish(name, v.name) for v in valid):
            continue
        valid.append(
            MealDishOutline(
                role="side",
                name=raw.name,
                blurb=raw.blurb or "",
                key_ingredients=list(raw.key_ingredients),
                est_total_minutes=raw.est_total_minutes,
                est_hands_on_minutes=raw.est_hands_on_minutes,
            )
        )
        if len(valid) == _MAX_ALTERNATIVES:
            break

    if not valid:
        raise MealGenerationUnavailableError(
            "invalid_output", "The model didn't return any valid alternative sides."
        )

    return valid


# ---------------------------------------------------------------------------
# Expand dish
# ---------------------------------------------------------------------------


async def expand_meal_dish(
    *,
    user_id: str,
    meal_id: str,
    position: int,
    outline: MealDishOutline,
    repo: SupabaseRepository,
    ai_manager: AIManager,
) -> RecipeCard:
    """Expand one dish outline into a full recipe for an existing meal.

    Reuses the pick stage's `_expand_dish`: the prompt names every other
    dish in the meal (all dishes except the one at `position` -- the side
    being replaced for a swap, or the next free position for an add) and
    tags steps with the meal's `exclusive_tags`, at the meal's own servings.
    Writes nothing -- the caller persists through `PUT /api/meals/[id]`.
    """
    loaded = await _load_meal(user_id, meal_id, repo)
    if loaded is None:
        raise MealNotFoundError(meal_id)

    other_outlines = [
        MealDishOutline(role=_role(d["role"]), name=_dish_title(d))
        for d in loaded.dishes
        if d["position"] != position
    ]
    option = MealOption(
        option_id="meal-screen",
        title=loaded.title,
        dishes=[outline, *other_outlines],
    )

    allergies = list((await get_stored_food_exclusions(user_id)).allergies)
    pantry_grounded, scored_items = await _pantry_grounding(
        user_id, loaded.constraints_echo, allergies
    )

    try:
        return await _expand_dish(
            ai_manager,
            outline,
            option,
            loaded.servings,
            loaded.constraints_echo,
            scored_items,
            pantry_grounded,
            allergies,
        )
    except AllergenViolation as e:
        raise MealGenerationUnavailableError(
            "invalid_output", allergen_refusal_message(e.allergens, f"'{outline.name}'")
        ) from e
    except NoProviderAvailableError as e:
        raise MealGenerationUnavailableError(
            "model_unavailable", user_message_for_failure(e.kind, e.configured)
        ) from e
    except Exception as e:
        logger.exception(
            "expand_meal_dish: dish expansion failed for meal=%s position=%s", meal_id, position
        )
        raise MealGenerationUnavailableError(
            "generation_failed", "Couldn't put that dish together right now — try again."
        ) from e
