"""The `meal_plan` intent: option stage and pick stage (issue #650).

Two LangGraph nodes, wired in `workflows/router.py`:

- `meal_options_stage` — one structured `AIManager` call returns three meal
  outlines (a main + 1-2 sides each). Coverage, to-buy, and the rescue flag
  are computed deterministically in code (the cook matcher's synonym-table
  path, never the LLM-substitution tier), the to-buy cap is applied, and the
  options are retained in the session next to `brainstorm_ideas` for the
  pick turn.
- `meal_pick_stage` — resolves `context.meal_option_id` against the retained
  options (never fuzzy-matched), then expands every dish concurrently via
  `asyncio.gather`, one grounded, meal-aware recipe generation per dish.

Both stages reuse the brainstorm/grounded-generation building blocks from
`workflows/recipe/nodes.py` (constraint extraction, pantry scoring,
`score_and_rank`, the expiring-items wording, the pantry opt-out) rather
than re-implementing them.
"""

import asyncio
import json
import logging
from collections import Counter
from typing import Any, Literal
from uuid import uuid4

from pydantic import ValidationError

from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.ai.provider import user_message_for_failure
from bubbly_chef.api.deps import get_ai_manager
from bubbly_chef.domain.kitchen_limits import map_kitchen_limits_to_tags
from bubbly_chef.domain.stock import filter_usable_pantry_items, filter_usable_pantry_rows
from bubbly_chef.models.base import Intent, NextAction, WorkflowStatus
from bubbly_chef.models.meal import (
    MealConstraintsEcho,
    MealCoverage,
    MealDish,
    MealDishOutline,
    MealDishOutlineLLM,
    MealOption,
    MealOptionsLLMResult,
    MealOptionsProposal,
    MealPlanSessionState,
    MealProposal,
)
from bubbly_chef.models.pantry import PantryItem
from bubbly_chef.models.recipe import Ingredient, RecipeCard, build_structured_steps
from bubbly_chef.prompts.meal import (
    MEAL_DISH_EXPANSION_SYSTEM_PROMPT,
    MEAL_DISH_PANTRY_BLOCK,
    MEAL_DISH_PANTRY_BLOCK_NO_PANTRY,
    MEAL_OPTIONS_SYSTEM_PROMPT,
    MEAL_OPTIONS_SYSTEM_PROMPT_NO_PANTRY,
)
from bubbly_chef.repository.supabase_repo import get_repository
from bubbly_chef.services.cook_matcher import match_ingredients
from bubbly_chef.workflows.recipe.nodes import (
    _days_until_expiry,
    _format_pantry_item_for_prompt,
    extract_recipe_constraints,
    is_pantry_grounded,
    score_and_rank,
    score_pantry_ingredients,
)
from bubbly_chef.workflows.state import LLMRecipeResult, WorkflowState

logger = logging.getLogger(__name__)

# Options with more to-buy items than this are dropped when at least one
# other option qualifies (issue #650's option stage: "pantry-first, dropped
# when enough others qualify. Otherwise the best are kept.").
_MAX_TO_BUY = 3

# How many of a user's most recent recipes (saved or cooked, whichever came
# last) to sample for the recent-cuisine soft preference (spec Q18). Small
# and cheap: one extra DB read, no LLM call.
_RECENT_CUISINE_SAMPLE = 5


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


async def _pantry_items_for_matching(user_id: str) -> list[PantryItem]:
    """The user's usable pantry rows, for deterministic ingredient matching.

    Always DB-sourced (matches the cook route's own precedent), never the
    client-supplied `pantry_snapshot` -- the option/pick stages need real
    `PantryItem` models for `match_ingredients`, and the DB is the source of
    truth for what's actually on hand. Never raises: any fetch error
    degrades to an empty pantry, which is a safe (if pessimistic) input to
    coverage/missing-ingredient matching rather than a failed turn.
    """
    try:
        repo = await get_repository()
        items = await repo.get_all_pantry_items(user_id)
        return filter_usable_pantry_items(items)
    except Exception as e:
        logger.warning("Could not fetch pantry for meal matching: %s", e)
        return []


async def _default_servings(user_id: str) -> int:
    """Explicit-ask servings takes priority (handled by the caller); this is
    the fallback: the mode of the user's last three *cooked* meals, else 2.

    Ties are broken by the earliest occurrence in `recent` (i.e. the most
    recently cooked of the tied values), since `recent` is already newest-
    first from the repository.
    """
    try:
        repo = await get_repository()
        recent = await repo.get_recent_meal_servings(user_id, limit=3)
    except Exception as e:
        logger.warning("Could not fetch recent meal servings: %s", e)
        return 2
    if not recent:
        return 2
    counts = Counter(recent)
    top_count = max(counts.values())
    for value in recent:
        if counts[value] == top_count:
            return value
    return 2  # unreachable -- recent is non-empty and every value is in counts


async def _recent_cuisine_hint(user_id: str) -> str:
    """A soft, non-binding recent-cuisine preference line for the option
    prompt (spec Q18). Best-effort: any failure or empty result yields "".
    """
    try:
        repo = await get_repository()
        rows = await repo.get_user_recipes(user_id, limit=_RECENT_CUISINE_SAMPLE)
    except Exception as e:
        logger.debug("Could not fetch recent recipes for cuisine hint: %s", e)
        return ""
    cuisines = [
        c.strip().lower()
        for r in rows
        if isinstance(c := r.get("cuisine"), str) and c.strip()
    ]
    if not cuisines:
        return ""
    top = [c for c, _ in Counter(cuisines).most_common(2)]
    return (
        "\nThe user has recently cooked or saved recipes in these cuisines: "
        + ", ".join(top)
        + ". Lean gently toward them when an option fits naturally -- never force it, "
        "and don't mention this preference to the user."
    )


def _format_meal_constraints(constraints: dict[str, Any], kitchen_limits: list[str]) -> str:
    parts = ""
    if constraints.get("must_use_ingredients"):
        parts += (
            f"\nMust use: {', '.join(constraints['must_use_ingredients'])}"
            " — every option has to include these"
        )
    if constraints.get("meal_type"):
        parts += f"\nMeal type: {constraints['meal_type']}"
    if constraints.get("cuisine"):
        parts += f"\nCuisine preference: {constraints['cuisine']}"
    if constraints.get("mood"):
        parts += f"\nMood/style: {constraints['mood']}"
    if constraints.get("dietary"):
        parts += f"\nDietary: {', '.join(constraints['dietary'])}"
    if constraints.get("max_time_minutes"):
        parts += f"\nMax time: {constraints['max_time_minutes']} minutes"
    if constraints.get("preferred_ingredients"):
        parts += (
            f"\nPreferred flavors/ingredients: {', '.join(constraints['preferred_ingredients'])}"
        )
    if constraints.get("excluded_ingredients"):
        parts += f"\nExclude: {', '.join(constraints['excluded_ingredients'])}"
    if kitchen_limits:
        parts += f"\nKitchen limits: {', '.join(kitchen_limits)}"
    return parts


def _meal_pantry_context(scored_items: list[dict[str, Any]]) -> str:
    """Mirrors `workflows.recipe.nodes.brainstorm_recipe_ideas`'s pantry block:
    must-use, expiring-soon (gentle wording, issue #288), then the rest."""
    if not scored_items:
        return ""
    usable_items = filter_usable_pantry_rows(scored_items)
    must_use = [i for i in usable_items if i.get("_must_use")]
    rest = [i for i in usable_items if not i.get("_must_use") and not i.get("_expired")]
    expiring = [
        i for i in rest if (d := _days_until_expiry(i)) is not None and 0 <= d <= 7
    ]
    supporting = [i for i in rest if i not in expiring]

    context = ""
    if must_use:
        context += (
            f"\nMust use (the user asked to cook with these): "
            f"{', '.join(i.get('name', '') for i in must_use[:5])}"
        )
    expiring_str = ", ".join(i.get("name", "") for i in expiring[:5]) or "none"
    context += f"\nExpiring soon (weave in where it fits, not mandatory): {expiring_str}"
    supporting_str = ", ".join(i.get("name", "") for i in supporting[:15]) or "none"
    context += f"\nOther available: {supporting_str}"
    return context


def _normalize_option_dishes(
    raw_dishes: list[MealDishOutlineLLM],
) -> list[MealDishOutline] | None:
    """Coerce a model-proposed dish list into exactly one main + 1-2 sides.

    Returns `None` when the option can't be salvaged into a valid meal (no
    dishes at all, or nothing left to serve as a side after normalization)
    -- the caller drops that option rather than fabricate a side out of
    nothing. Deterministic, matching issue #650's "1 main and 1-2 sides"
    validation requirement without relying on the model to get roles right.
    """
    if not raw_dishes:
        return None

    mains = [d for d in raw_dishes if d.role == "main"]
    sides = [d for d in raw_dishes if d.role == "side"]

    if mains:
        main = mains[0]
        sides = mains[1:] + sides  # demote any extra "main" to a side
    else:
        main = raw_dishes[0]
        sides = list(raw_dishes[1:])

    sides = sides[:2]
    if not sides:
        return None

    def _to_outline(d: MealDishOutlineLLM, role: Literal["main", "side"]) -> MealDishOutline:
        return MealDishOutline(
            role=role,
            name=d.name,
            key_ingredients=list(d.key_ingredients),
            est_total_minutes=d.est_total_minutes,
            est_hands_on_minutes=d.est_hands_on_minutes,
        )

    return [_to_outline(main, "main"), *[_to_outline(d, "side") for d in sides]]


def _meal_level_estimates(dishes: list[MealDishOutline]) -> tuple[int | None, int | None]:
    """Deterministic meal-level time estimate from each dish's own estimate.

    `est_hands_on_minutes` sums across dishes -- one cook is busy for each
    dish's hands-on work in turn. `est_total_minutes` is the longest dish's
    total plus a fixed 5-minute plating/serving buffer when there's more
    than one dish, on the assumption sides mostly cook alongside the main
    rather than strictly after it. This is a cheap estimate for the option
    card only -- the meal's *real* schedule comes from the deterministic
    scheduler (issue #649, Next.js-side); ai-service never computes an exact
    timeline.
    """
    totals = [d.est_total_minutes for d in dishes if d.est_total_minutes is not None]
    hands_on = [d.est_hands_on_minutes for d in dishes if d.est_hands_on_minutes is not None]
    est_total = (max(totals) + (5 if len(dishes) > 1 else 0)) if totals else None
    est_hands_on = sum(hands_on) if hands_on else None
    return est_total, est_hands_on


def _compute_coverage_and_rescues(
    dishes: list[MealDishOutline],
    pantry_items: list[PantryItem],
) -> tuple[MealCoverage, list[str]]:
    """Deterministic pantry coverage + rescue flag for one meal option.

    Uses `match_ingredients` (the cook matcher's synonym-table path) only --
    never `match_ingredients_with_llm`'s substitution tier, per issue #650:
    the option stage must stay a single LLM call, not one plus a matching
    call per option. Culinary staples are handled by `match_ingredients`
    itself (status "assumed") and count toward neither `pantry_items_used`
    nor `to_buy`. Ingredient names repeated across dishes (e.g. butter in
    the main and a side) are counted once, so "uses N of your items" reads
    as distinct ingredients, not ingredient lines.
    """
    seen: set[str] = set()
    unique_names: list[str] = []
    for dish in dishes:
        for name in dish.key_ingredients:
            key = name.strip().lower()
            if key and key not in seen:
                seen.add(key)
                unique_names.append(name)

    if not unique_names:
        return MealCoverage(pantry_items_used=0, to_buy=[]), []

    proposal = match_ingredients(
        recipe_id=str(uuid4()),
        recipe_title="meal option",
        recipe_ingredients=[{"name": name} for name in unique_names],
        pantry_items=pantry_items,
    )

    used_matches = [m for m in proposal.matches if m.status in ("ready", "substitute")]
    expiring_names = {it.name.lower() for it in pantry_items if it.is_expiring_soon}
    rescues: list[str] = []
    rescue_seen: set[str] = set()
    for m in used_matches:
        pname = m.pantry_item_name
        if pname and pname.lower() in expiring_names and pname.lower() not in rescue_seen:
            rescue_seen.add(pname.lower())
            rescues.append(pname)

    return (
        MealCoverage(pantry_items_used=len(used_matches), to_buy=list(proposal.missing)),
        rescues,
    )


def _apply_to_buy_cap(options: list[MealOption]) -> list[MealOption]:
    """Drop options over `_MAX_TO_BUY` to-buy items when others qualify.

    "The count is shown honestly" (issue #647): this can leave fewer than 3
    options when the cap genuinely filters some out, rather than padding
    back up to 3 with an option that needs a bigger shop.
    """
    within_cap = [o for o in options if o.coverage is None or len(o.coverage.to_buy) <= _MAX_TO_BUY]
    return within_cap if within_cap else options


def _missing_ingredients_for_recipe(recipe: RecipeCard, pantry_items: list[PantryItem]) -> list[str]:
    """Deterministic missing-ingredient list for one expanded dish, via the
    same synonym-table matcher used for option-stage coverage."""
    ingredient_dicts = [
        {"name": ing.name, "quantity": ing.quantity, "unit": ing.unit}
        for ing in recipe.ingredients
    ]
    proposal = match_ingredients(
        recipe_id=str(recipe.id),
        recipe_title=recipe.title,
        recipe_ingredients=ingredient_dicts,
        pantry_items=pantry_items,
    )
    return list(proposal.missing)


def _recipe_card_from_llm_result(llm_result: LLMRecipeResult, servings: int) -> RecipeCard:
    """Build a `RecipeCard` from a dish-expansion structured result.

    Mirrors `workflows.recipe.nodes.generate_grounded_recipe`'s ingredient-
    building loop (duplicated rather than imported: that logic is inlined in
    a single-purpose node there, not a standalone helper).
    """
    ingredients_list: list[Ingredient] = []
    for ing_dict in llm_result.ingredients:
        if isinstance(ing_dict, str):
            ingredients_list.append(Ingredient(name=ing_dict))
            continue
        if isinstance(ing_dict, dict):
            raw_qty = ing_dict.get("quantity")
            qty: float | None = None
            extra_note: str | None = None
            if raw_qty is not None:
                try:
                    qty = float(raw_qty)
                except (ValueError, TypeError):
                    extra_note = str(raw_qty)

            prep = ing_dict.get("preparation") or ""
            if extra_note:
                prep = f"{extra_note}, {prep}" if prep else extra_note

            name = ing_dict.get("name") or ing_dict.get("ingredient") or ""
            ingredients_list.append(
                Ingredient(
                    name=name,
                    quantity=qty,
                    unit=ing_dict.get("unit"),
                    preparation=prep or None,
                    optional=ing_dict.get("optional", False),
                    substitutes=ing_dict.get("substitutes", []),
                )
            )

    return RecipeCard(
        title=llm_result.title,
        description=llm_result.description,
        prep_time_minutes=llm_result.prep_time_minutes,
        cook_time_minutes=llm_result.cook_time_minutes,
        total_time_minutes=llm_result.total_time_minutes,
        servings=llm_result.servings or servings,
        ingredients=ingredients_list,
        instructions=llm_result.instructions,
        steps=build_structured_steps(llm_result.steps, llm_result.instructions),
        cuisine=llm_result.cuisine,
        meal_type=llm_result.meal_type,
        dietary_tags=llm_result.dietary_tags,
        difficulty=llm_result.difficulty,
        tips=llm_result.tips,
    )


def _meal_unavailable_state(state: WorkflowState, error: NoProviderAvailableError) -> WorkflowState:
    """Model unavailable at either stage -- the existing recipe error_kind
    handling (mirrors `generate_grounded_recipe`'s `NoProviderAvailableError`
    branch): a clear, kind-specific message and a retry, no proposal."""
    logger.error("Meal generation: no AI provider available: %s", error)
    return {
        **state,
        "intent": Intent.GENERAL_CHAT.value,
        "assistant_message": user_message_for_failure(error.kind, error.configured),
        "next_action": NextAction.NONE.value,
        "proposal": None,
        "requires_review": False,
        "confidence": 0.5,
        "errors": state.get("errors", []) + [f"Meal generation error: {error}"],
        "workflow_status": WorkflowStatus.COMPLETED.value,
    }


def _meal_generation_failed_state(state: WorkflowState, reason: str) -> WorkflowState:
    """A non-provider failure (bad/empty structured output) at either stage."""
    logger.error("Meal generation failed: %s", reason)
    return {
        **state,
        "intent": Intent.GENERAL_CHAT.value,
        "assistant_message": "Sorry, I couldn't put together meal options. Please try again.",
        "next_action": NextAction.NONE.value,
        "proposal": None,
        "requires_review": False,
        "confidence": 0.5,
        "errors": state.get("errors", []) + [f"Meal generation error: {reason}"],
        "workflow_status": WorkflowStatus.COMPLETED.value,
    }


def _unknown_option_state(state: WorkflowState, option_id: Any) -> WorkflowState:
    """`context.meal_option_id` didn't resolve against the retained options."""
    logger.info("meal_pick_stage: unresolved option id=%r", option_id)
    return {
        **state,
        "intent": Intent.GENERAL_CHAT.value,
        "assistant_message": (
            "I couldn't find that meal option anymore — ask me for meal ideas "
            "again and pick one of the cards."
        ),
        "next_action": NextAction.NONE.value,
        "proposal": None,
        "requires_review": False,
        "confidence": 0.5,
        "workflow_status": WorkflowStatus.COMPLETED.value,
    }


# ---------------------------------------------------------------------------
# Option stage
# ---------------------------------------------------------------------------


async def meal_options_stage(state: WorkflowState) -> WorkflowState:
    """Node: propose 3 meal options and compute their pantry coverage.

    One structured `AIManager` call for the outlines; coverage/to-buy/rescue
    are computed in code afterward, never by the model.
    """
    input_text = state.get("input_text", "")
    user_id = state.get("user_id") or ""

    constraints_state = await extract_recipe_constraints(state)
    constraints: dict[str, Any] = constraints_state.get("recipe_constraints") or {}
    kitchen_limit_phrases = [str(p) for p in (constraints.get("kitchen_limits") or [])]
    exclusive_tags = map_kitchen_limits_to_tags(kitchen_limit_phrases)

    pantry_grounded = is_pantry_grounded(constraints)
    scored_state = await score_pantry_ingredients(constraints_state)
    scored_items: list[dict[str, Any]] = scored_state.get("scored_pantry_items") or []

    explicit_servings = constraints.get("servings")
    servings = int(explicit_servings) if explicit_servings else await _default_servings(user_id)

    cuisine_hint = await _recent_cuisine_hint(user_id) if user_id else ""
    constraints_str = _format_meal_constraints(constraints, kitchen_limit_phrases)
    pantry_context = _meal_pantry_context(scored_items) if pantry_grounded else ""
    system_prompt = (
        MEAL_OPTIONS_SYSTEM_PROMPT if pantry_grounded else MEAL_OPTIONS_SYSTEM_PROMPT_NO_PANTRY
    )

    prompt = (
        system_prompt
        + pantry_context
        + constraints_str
        + cuisine_hint
        + f"\n\nUser: {input_text}\n\nPropose 3 meal options:"
    )

    ai_manager = get_ai_manager()
    try:
        result = await ai_manager.complete(
            prompt=prompt,
            response_schema=MealOptionsLLMResult,
            temperature=0.7,
        )
    except NoProviderAvailableError as e:
        return _meal_unavailable_state(state, e)
    except Exception as e:
        return _meal_generation_failed_state(state, str(e))

    if not isinstance(result, MealOptionsLLMResult) or not result.options:
        return _meal_generation_failed_state(state, "no options returned")

    # Pantry opt-out (#287): match nothing, so the cards claim no pantry use,
    # flag no rescues, and no option is dropped for its to-buy count.
    pantry_items = await _pantry_items_for_matching(user_id) if pantry_grounded else []

    options: list[MealOption] = []
    for idx, raw_option in enumerate(result.options[:3], start=1):
        dishes = _normalize_option_dishes(raw_option.dishes)
        if dishes is None:
            logger.info("meal_options_stage: dropping option %r -- no valid side", raw_option.title)
            continue
        coverage: MealCoverage | None = None
        rescues: list[str] = []
        if pantry_grounded:
            coverage, rescues = _compute_coverage_and_rescues(dishes, pantry_items)
        est_total, est_hands_on = _meal_level_estimates(dishes)
        options.append(
            MealOption(
                option_id=f"opt_{idx}",
                title=raw_option.title,
                blurb=raw_option.blurb,
                dishes=dishes,
                est_total_minutes=est_total,
                est_hands_on_minutes=est_hands_on,
                coverage=coverage,
                rescues=rescues,
            )
        )

    if not options:
        return _meal_generation_failed_state(state, "no valid options after normalization")

    if pantry_grounded:
        options = _apply_to_buy_cap(options)

    constraints_echo = MealConstraintsEcho(
        kitchen_limits=kitchen_limit_phrases,
        exclusive_tags=exclusive_tags,
        recipe_constraints=constraints,
    )
    proposal = MealOptionsProposal(options=options, servings=servings, constraints=constraints_echo)
    session_state = MealPlanSessionState(
        options=options, servings=servings, constraints=constraints_echo
    )

    return {
        **state,
        "intent": Intent.MEAL_PLAN.value,
        "assistant_message": "Here are three meal ideas!",
        "next_action": NextAction.PICK_MEAL.value,
        "proposal": proposal,
        "requires_review": True,
        "confidence": 1.0,
        "recipe_constraints": constraints,
        "meal_plan_session_state": session_state,
        "workflow_status": WorkflowStatus.AWAITING_REVIEW.value,
    }


# ---------------------------------------------------------------------------
# Pick stage
# ---------------------------------------------------------------------------


def _score_items_for_dish_prompt(
    pantry_items: list[PantryItem], constraints: dict[str, Any]
) -> list[dict[str, Any]]:
    rows = [it.model_dump(mode="json") for it in pantry_items]
    return score_and_rank(rows, constraints)


async def _expand_dish(
    ai_manager: Any,
    dish: MealDishOutline,
    option: MealOption,
    servings: int,
    constraints_echo: MealConstraintsEcho,
    scored_items: list[dict[str, Any]],
    pantry_grounded: bool = True,
) -> RecipeCard:
    """One grounded, meal-aware recipe generation for a single dish.

    The prompt names the meal's other dishes (so sides complement rather
    than duplicate the main) and the exclusive-equipment tags in play, and
    asks for the meal's servings exactly. With `pantry_grounded` false (the
    user opted out, issue #287) no pantry item reaches the prompt.
    """
    other_dishes = [d for d in option.dishes if d is not dish]
    other_dishes_str = (
        "; ".join(f"{d.role}: {d.name}" for d in other_dishes)
        if other_dishes
        else "none — this is the only dish"
    )

    priority_items = [
        _format_pantry_item_for_prompt(i) for i in scored_items if i.get("_score", 0) >= 5
    ]
    supporting_items = [
        _format_pantry_item_for_prompt(i) for i in scored_items if 0 <= i.get("_score", 0) < 5
    ]

    constraints_json = json.dumps(
        {
            k: v
            for k, v in constraints_echo.recipe_constraints.items()
            if v and k not in ("use_pantry", "servings", "kitchen_limits")
        }
    )

    pantry_block = (
        MEAL_DISH_PANTRY_BLOCK.format(
            priority_items=", ".join(priority_items[:8]) or "none specified",
            supporting_items=", ".join(supporting_items[:10]) or "none",
        )
        if pantry_grounded
        else MEAL_DISH_PANTRY_BLOCK_NO_PANTRY
    )

    prompt = MEAL_DISH_EXPANSION_SYSTEM_PROMPT.format(
        dish_name=dish.name,
        role=dish.role,
        meal_title=option.title,
        other_dishes=other_dishes_str,
        servings=servings,
        kitchen_limits=", ".join(constraints_echo.kitchen_limits) or "none",
        exclusive_tags=", ".join(constraints_echo.exclusive_tags) or "none",
        constraints_json=constraints_json,
        pantry_block=pantry_block,
    )

    result = await ai_manager.complete(prompt=prompt, response_schema=LLMRecipeResult, temperature=0.5)
    if not isinstance(result, LLMRecipeResult):
        raise ValueError(f"Unexpected response type expanding dish {dish.name!r}")

    return _recipe_card_from_llm_result(result, servings)


async def meal_pick_stage(state: WorkflowState) -> WorkflowState:
    """Node: resolve the picked option and expand every dish concurrently.

    `context.meal_option_id` resolves the retained option by id -- never
    fuzzy-matched. An unknown id gets a clear message and falls back to
    `general_chat` (`next_action: none`).
    """
    context = state.get("context") or {}
    option_id = context.get("meal_option_id")
    session = state.get("session") or {}
    meal_plan_raw = (session.get("metadata") or {}).get("meal_plan")

    if not option_id or not isinstance(meal_plan_raw, dict):
        return _unknown_option_state(state, option_id)

    try:
        session_state = MealPlanSessionState.model_validate(meal_plan_raw)
    except ValidationError:
        return _unknown_option_state(state, option_id)

    option = next((o for o in session_state.options if o.option_id == option_id), None)
    if option is None:
        return _unknown_option_state(state, option_id)

    servings = session_state.servings
    constraints_echo = session_state.constraints
    user_id = state.get("user_id") or ""

    # The same opt-out gate the option stage applies (PR #659 review): after
    # "don't use my pantry" the pantry is neither read, nor fed to the dish
    # prompts, nor used for missing_ingredients (which is [] then -- there is
    # no stock to be missing from).
    pantry_grounded = is_pantry_grounded(constraints_echo.recipe_constraints)
    pantry_items = await _pantry_items_for_matching(user_id) if pantry_grounded else []
    scored_items = (
        _score_items_for_dish_prompt(pantry_items, constraints_echo.recipe_constraints)
        if pantry_grounded
        else []
    )

    ai_manager = get_ai_manager()
    try:
        expanded = await asyncio.gather(
            *(
                _expand_dish(
                    ai_manager,
                    dish,
                    option,
                    servings,
                    constraints_echo,
                    scored_items,
                    pantry_grounded,
                )
                for dish in option.dishes
            )
        )
    except NoProviderAvailableError as e:
        return _meal_unavailable_state(state, e)
    except Exception as e:
        return _meal_generation_failed_state(state, str(e))

    meal_dishes: list[MealDish] = []
    missing_all: list[str] = []
    for position, (dish_outline, recipe_card) in enumerate(zip(option.dishes, expanded)):
        meal_dishes.append(MealDish(role=dish_outline.role, position=position, recipe=recipe_card))
        if pantry_grounded:
            missing_all.extend(_missing_ingredients_for_recipe(recipe_card, pantry_items))

    missing = list(dict.fromkeys(missing_all))  # dedupe, preserve order

    proposal = MealProposal(
        title=option.title,
        servings=servings,
        constraints=constraints_echo,
        dishes=meal_dishes,
        missing_ingredients=missing,
    )

    return {
        **state,
        "intent": Intent.MEAL_PLAN.value,
        "assistant_message": f"Here's your {option.title}!",
        "next_action": NextAction.REVIEW_PROPOSAL.value,
        "proposal": proposal,
        "requires_review": True,
        "confidence": 0.9,
        "workflow_status": WorkflowStatus.AWAITING_REVIEW.value,
    }
