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
from typing import Any, Literal, NamedTuple

from bubbly_chef.ai import AIManager
from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.ai.provider import user_message_for_failure
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
from bubbly_chef.workflows.meal.nodes import (
    _expand_dish,
    _pantry_items_for_matching,
    _score_items_for_dish_prompt,
)
from bubbly_chef.workflows.recipe.nodes import _format_pantry_item_for_prompt, is_pantry_grounded

logger = logging.getLogger(__name__)

ErrorKind = Literal["model_unavailable", "invalid_output"]

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

    `error_kind` mirrors `structured_steps.StructuredStepsUnavailableError`:
    - "model_unavailable": no AI provider could be reached.
    - "invalid_output": the model responded, but nothing usable came back
      (wrong type, or -- for side-alternatives -- no valid alternative).
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
    user_id: str, constraints_echo: MealConstraintsEcho
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
    scored_items = _score_items_for_dish_prompt(pantry_items, constraints_echo.recipe_constraints)
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
    current_names = {_dish_title(d).strip().lower() for d in loaded.dishes if _dish_title(d)}

    constraints_echo = loaded.constraints_echo
    pantry_grounded, scored_items = await _pantry_grounding(user_id, constraints_echo)
    pantry_block = _pantry_block_text(pantry_grounded, scored_items)

    avoid_line = ""
    if replaced_dish is not None:
        replaced_name = _dish_title(replaced_dish)
        avoid_line = f'Suggest alternatives to "{replaced_name}"; don\'t suggest it or a close variant.'

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

    try:
        result = await ai_manager.complete(
            prompt=prompt,
            response_schema=MealSideAlternativesLLMResult,
            temperature=0.7,
        )
    except NoProviderAvailableError as e:
        raise MealGenerationUnavailableError(
            "model_unavailable", user_message_for_failure(e.kind, e.configured)
        ) from e

    if not isinstance(result, MealSideAlternativesLLMResult):
        raise MealGenerationUnavailableError(
            "invalid_output", "The model returned an unexpected response."
        )

    valid: list[MealDishOutline] = []
    seen_names = set(current_names)
    for raw in result.alternatives:
        if raw.role != "side":
            continue
        key = raw.name.strip().lower()
        if not key or key in seen_names:
            continue
        seen_names.add(key)
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

    pantry_grounded, scored_items = await _pantry_grounding(user_id, loaded.constraints_echo)

    try:
        return await _expand_dish(
            ai_manager,
            outline,
            option,
            loaded.servings,
            loaded.constraints_echo,
            scored_items,
            pantry_grounded,
        )
    except NoProviderAvailableError as e:
        raise MealGenerationUnavailableError(
            "model_unavailable", user_message_for_failure(e.kind, e.configured)
        ) from e
    except Exception as e:
        raise MealGenerationUnavailableError("invalid_output", str(e)) from e
