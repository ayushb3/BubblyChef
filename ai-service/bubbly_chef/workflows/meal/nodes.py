"""The `meal_plan` intent: option stage and pick stage (issue #650).
Predicted follow-up pills and the `meal_followup` inheritance turn are
issue #651, and so is "Make it a meal" (PR B): a fixed main that every option
keeps, resolved and validated in `workflows/meal/fixed_main.py`.

Two LangGraph nodes, wired in `workflows/router.py`:

- `meal_options_stage` — one structured `AIManager` call returns three meal
  outlines (a main + 1-2 sides each). Coverage, to-buy, and the rescue flag
  are computed deterministically in code (the cook matcher's synonym-table
  path, never the LLM-substitution tier), the to-buy cap is applied, and the
  options are retained in the session next to `brainstorm_ideas` for the
  pick turn. The same call also returns 2-4 `follow_ups` pills (#651),
  cleaned by `_clean_meal_follow_ups`. With a fixed main (#651 PR B) the model's
  own mains are discarded server-side: every option is the given main plus the
  model's sides (`_fixed_main_option_dishes`).
- `meal_pick_stage` — resolves `context.meal_option_id` against the retained
  options (never fuzzy-matched), then expands every dish concurrently via
  `asyncio.gather`, one grounded, meal-aware recipe generation per dish. The
  main dish's call also carries `follow_ups` (#651), via
  `MealDishLLMResult` -- the pick stage's only pill-carrying schema. With a
  fixed main the main is NOT regenerated (its card comes from
  `load_fixed_main_card`, re-read at this stage), and the pills ride the first
  side's call instead.

Both stages reuse the brainstorm/grounded-generation building blocks from
`workflows/recipe/nodes.py` (constraint extraction, pantry scoring,
`score_and_rank`, the expiring-items wording, the pantry opt-out) rather
than re-implementing them.
"""

import asyncio
import json
import logging
import re
from collections import Counter
from typing import Any, Literal
from uuid import uuid4

from pydantic import Field, ValidationError

from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.ai.provider import user_message_for_failure
from bubbly_chef.api.deps import get_ai_manager
from bubbly_chef.domain.diet_terms import join_fields
from bubbly_chef.domain.kitchen_limits import map_kitchen_limits_to_tags
from bubbly_chef.domain.stock import filter_usable_pantry_items, filter_usable_pantry_rows
from bubbly_chef.models.base import Intent, NextAction, WorkflowStatus
from bubbly_chef.models.meal import (
    MealConstraintsEcho,
    MealCoverage,
    MealDish,
    MealDishOutline,
    MealDishOutlineLLM,
    MealFixedMainEcho,
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
    MEAL_FOLLOW_UPS_NO_PANTRY_RULE,
    MEAL_OPTIONS_FIXED_MAIN_BLOCK,
    MEAL_OPTIONS_FIXED_MAIN_FOLLOW_UPS_RULE,
    MEAL_OPTIONS_FOLLOW_UPS_RULES,
    MEAL_OPTIONS_PREVIOUS_BLOCK,
    MEAL_OPTIONS_SYSTEM_PROMPT,
    MEAL_OPTIONS_SYSTEM_PROMPT_NO_PANTRY,
    MEAL_READY_FOLLOW_UPS_RULES,
)
from bubbly_chef.repository.supabase_repo import get_repository
from bubbly_chef.services.cook_matcher import match_ingredients
from bubbly_chef.workflows.meal.fixed_main import (
    MEAL_FIXED_MAIN_KEY,
    FixedMainRefusal,
    ResolvedFixedMain,
    fixed_main_constraints,
    fixed_main_outline,
    has_fixed_main,
    load_fixed_main_card,
    resolve_fixed_main,
    stored_dietary_preferences,
)
from bubbly_chef.workflows.recipe.nodes import (
    _combine_dietary_preferences,
    _days_until_expiry,
    _dietary_contradicted,
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

# Never on a meal's to-buy list. Water isn't a culinary staple for the cook
# matcher (issue #305 keeps it "missing", since a measured amount may need
# readying), but nobody shops for tap water, so "To buy: water" is noise on
# the option card and meal card. Exact names only: "coconut water" still counts.
_NEVER_TO_BUY = frozenset(
    {"water", "tap water", "cold water", "warm water", "hot water", "boiling water", "ice"}
)


def _shoppable(names: list[str]) -> list[str]:
    """`names` without the ones nobody buys (`_NEVER_TO_BUY`)."""
    return [n for n in names if n.strip().lower() not in _NEVER_TO_BUY]


# How many of a user's most recent recipes (saved or cooked, whichever came
# last) to sample for the recent-cuisine soft preference (spec Q18). Small
# and cheap: one extra DB read, no LLM call.
_RECENT_CUISINE_SAMPLE = 5

# Predicted follow-up pills (issue #651). The non-meal cap,
# `workflows/chat/nodes.py:53 MAX_FOLLOW_UP_SUGGESTIONS = 3`, is unchanged --
# this is a separate cap for the meal stages' own pills.
MAX_MEAL_FOLLOW_UPS = 4

# `_clean_meal_follow_ups`'s drop rules (spec §5d). Case-insensitive; word
# boundaries so "stock" alone (as in "chicken stock") never matches the
# pantry rule -- only "in stock" does.
_MEAL_FOLLOW_UP_APP_ACTION_RE = re.compile(
    r"\b(save|saved|saving|start cooking|grocery|groceries|shopping list|open|scan)\b",
    re.IGNORECASE,
)
_MEAL_FOLLOW_UP_PANTRY_RE = re.compile(
    r"\b(pantry|fridge|in stock|on hand|expir\w*)\b", re.IGNORECASE
)


def _clean_meal_follow_ups(raw: list[str], *, pantry_grounded: bool) -> list[str]:
    """Filter, dedupe and cap a meal stage's raw model `follow_ups` (#651 §5d).

    Kept: strings only, whitespace-collapsed and stripped, 1-60 characters,
    with no app-action wording (save, open, start cooking, a grocery/
    shopping list, scan) and -- only when the pantry opt-out is in effect --
    no pantry/stock/fridge/expiry wording either. Survivors are deduped
    case-insensitively (keeping the first) and capped at
    `MAX_MEAL_FOLLOW_UPS`. Fewer than 2 survivors ship as they are; the
    client tops the row up from its own fixed set.
    """
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, str):
            continue
        text = " ".join(item.split())
        if not (1 <= len(text) <= 60):
            continue
        if _MEAL_FOLLOW_UP_APP_ACTION_RE.search(text):
            continue
        if not pantry_grounded and _MEAL_FOLLOW_UP_PANTRY_RE.search(text):
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(text)
        if len(cleaned) >= MAX_MEAL_FOLLOW_UPS:
            break
    return cleaned


def _case_insensitive_union(retained: list[str], fresh: list[str]) -> list[str]:
    """`retained` plus any `fresh` entries not already present case-
    insensitively, order preserved (retained first) -- the union rule a
    `meal_followup` turn needs for dietary/excluded_ingredients, where the
    plain `_merge_constraints` "fresh wins when non-empty" rule would drop a
    retained value (#651 §5e)."""
    seen = {s.strip().lower() for s in retained if s.strip()}
    result = list(retained)
    for item in fresh:
        key = item.strip().lower()
        if key and key not in seen:
            seen.add(key)
            result.append(item)
    return result


def _finish_meal_followup_constraints(
    retained: dict[str, Any], merged: dict[str, Any], input_text: str
) -> dict[str, Any]:
    """Post-process `extract_recipe_constraints`'s own inherit+override merge
    (#651 §5e review fix): that merge already ran with `retained` as the
    *prior*, via `_state_with_recipe_constraints` below, so every scalar
    field (including `meal_type`, so a retained "dinner" survives a turn that
    doesn't restate it) and every plain list field is already correct. Only `dietary` and `excluded_ingredients` need fixing
    here, because the plain list rule ("fresh wins when non-empty") is an
    *override*, not the union these two fields need:

    - `dietary` reuses `_combine_dietary_preferences` -- the exact #394
      logic ("a stored preference stays in force unless the message names
      an ingredient it forbids") -- treating `retained` as the stored side
      and `merged`'s already-computed dietary as the requested side. This
      is what makes a retained `vegetarian` get set aside for a reply that
      asks for "chicken in the pasta", rather than the plain union
      re-adding a diet the fresh request just contradicted.
    - `excluded_ingredients` has no such contradiction concept, so it stays
      a plain case-insensitive union.
    """
    result = dict(merged)
    result["dietary"] = _combine_dietary_preferences(
        retained.get("dietary") or [], merged.get("dietary") or [], merged, input_text
    )
    result["excluded_ingredients"] = _case_insensitive_union(
        retained.get("excluded_ingredients") or [], merged.get("excluded_ingredients") or []
    )
    return result


def _drop_diets_the_main_contradicts(
    constraints: dict[str, Any],
    card: RecipeCard,
    *,
    carried: list[str],
    input_text: str,
) -> dict[str, Any]:
    """On a `meal_followup` turn under a fixed main (#651 PR B): drop a `dietary`
    label the main itself contradicts, unless the main carries that tag.

    Only labels that were CARRIED IN (`carried`: the user's stored diet and the
    retained meal's own) are candidates, and only when this turn's own text
    doesn't ask for them. `_finish_meal_followup_constraints` re-runs the #394
    check against the pill text alone, so without this pass a stored
    "vegetarian" that the fresh turn set aside for a chicken main would return
    on the first "Something quicker" tap. A label this turn's extraction
    produced (a pill like "Make the sides vegetarian") is an explicit ask and
    always stays, even beside a chicken main: the ask beats the main's tags.
    """
    haystack = join_fields(card.title, *(i.name for i in card.ingredients)).lower()
    tags = {t.strip().lower() for t in card.dietary_tags}
    carried_keys = {c.strip().lower() for c in carried}
    asked = input_text.lower()

    def _keep(label: str) -> bool:
        key = label.strip().lower()
        if key not in carried_keys:
            return True  # this turn's extraction, not an inherited label
        if key in tags or key in asked:
            return True
        return not _dietary_contradicted(label, haystack)

    return {**constraints, "dietary": [x for x in constraints.get("dietary") or [] if _keep(x)]}


MAX_SHOWN_OPTIONS = 9


def _option_descriptor(option: MealOption) -> str:
    """`Title (Dish, Dish)` -- how an option is named in the "already
    suggested" prompt block and in `MealPlanSessionState.shown_options`."""
    return f"{option.title} ({', '.join(d.name for d in option.dishes)})"


def _descriptor_key(descriptor: str) -> str:
    """The whole descriptor, case-folded with whitespace collapsed. Not just
    the title: under a fixed main every title is near-identical ("Lemon Pasta
    with ..."), so only the sides tell two options apart (#667)."""
    return " ".join(descriptor.casefold().split())


def _roll_shown_options(
    prior: list[str], new: list[str], cap: int = MAX_SHOWN_OPTIONS
) -> list[str]:
    """`new` appended after `prior`, oldest first. A repeated descriptor (by
    `_descriptor_key`) keeps the newer entry in the newer position; the last
    `cap` entries are returned (#667)."""
    rolled: list[str] = []
    for descriptor in [*prior, *new]:
        key = _descriptor_key(descriptor)
        rolled = [d for d in rolled if _descriptor_key(d) != key]
        rolled.append(descriptor)
    return rolled[-cap:]


def _retained_meal_plan_state(state: WorkflowState) -> MealPlanSessionState | None:
    """The option stage's retained state from `session.metadata.meal_plan`,
    or `None` when absent or invalid. Shared by the option stage's
    `meal_followup` inheritance (#651) and (inline) the pick stage's option
    resolution."""
    session = state.get("session") or {}
    meal_plan_raw = (session.get("metadata") or {}).get("meal_plan")
    if not isinstance(meal_plan_raw, dict):
        return None
    try:
        return MealPlanSessionState.model_validate(meal_plan_raw)
    except ValidationError:
        return None


def _state_with_recipe_constraints(state: WorkflowState, constraints: dict[str, Any]) -> WorkflowState:
    """A state copy whose `session.metadata.recipe_constraints` is set to
    `constraints` (#651 §5e review fix).

    `extract_recipe_constraints` merges its fresh extraction with whatever
    that key holds (`_prior_constraints_from_state` + `_merge_constraints`)
    -- so pointing it at the retained meal's own constraints, rather than
    clearing it, is what lets a retained `meal_type: "dinner"` survive a
    followup turn that doesn't restate it: a pure fresh extraction has no
    meal_type of its own, and the retained value is inherited through the
    merge (a meal type is only ever one the user named, #408). The meal branch
    of `update_session_node` never writes this key itself, so on a
    `meal_followup` turn it could otherwise still hold leftovers from an
    earlier, unrelated recipe conversation.
    """
    session = state.get("session") or {}
    metadata = session.get("metadata") if isinstance(session, dict) else None
    new_metadata = {**metadata, "recipe_constraints": constraints} if isinstance(metadata, dict) else {
        "recipe_constraints": constraints
    }
    return {**state, "session": {**session, "metadata": new_metadata}}


class MealDishLLMResult(LLMRecipeResult):
    """The pick stage's one pill-carrying dish call (issue #651).

    Used only for the main dish's `_expand_dish_result(..., with_follow_ups=
    True)` call -- internal to this module: never on `RecipeCard`, `MealDish`
    or the saved recipe. Subclassing `LLMRecipeResult` (rather than a
    standalone model) means the pick stage's dish-generation prompt and
    ingredient/step parsing need no branching between the two schemas.
    """

    follow_ups: list[str] = Field(
        default_factory=list,
        description="2-4 short next asks in the user's voice, each under 60 characters, no emoji",
    )


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
    prompt (spec Q18; issue #651 §6 moves the ranking itself into
    `repo.get_recent_cuisines`, shared with the Next.js starter-pill ranker).
    Best-effort: any failure or empty/non-list result yields "".

    `repo.get_recent_cuisines` never raises, but this keeps its own broad
    try/except anyway: the #650 test suite's repo mock is a bare `MagicMock`
    with no `get_recent_cuisines` configured, so calling (and awaiting) the
    auto-created attribute raises `TypeError` there -- caught here the same
    as any other failure, degrading to no hint rather than breaking those
    tests.
    """
    try:
        repo = await get_repository()
        cuisines = await repo.get_recent_cuisines(user_id, sample=_RECENT_CUISINE_SAMPLE)
    except Exception as e:
        logger.debug("Could not fetch recent cuisines for hint: %s", e)
        return ""
    if not isinstance(cuisines, list):
        cuisines = []
    top = [c for c in cuisines if isinstance(c, str) and c.strip()][:2]
    if not top:
        return ""
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
    card only. The total is never less than the summed hands-on time: with
    one cook, the meal can't finish before all the hands-on work is done.
    The meal's *real* schedule comes from the deterministic
    scheduler (issue #649, Next.js-side); ai-service never computes an exact
    timeline.
    """
    totals = [d.est_total_minutes for d in dishes if d.est_total_minutes is not None]
    hands_on = [d.est_hands_on_minutes for d in dishes if d.est_hands_on_minutes is not None]
    est_total = (max(totals) + (5 if len(dishes) > 1 else 0)) if totals else None
    est_hands_on = sum(hands_on) if hands_on else None
    if est_total is not None and est_hands_on is not None:
        est_total = max(est_total, est_hands_on)
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
        MealCoverage(pantry_items_used=len(used_matches), to_buy=_shoppable(list(proposal.missing))),
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
    return _shoppable(list(proposal.missing))


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


_FIXED_MAIN_NOT_FOUND_TEXT = (
    "I couldn't find that recipe in your library — it may have been deleted. "
    "Pick another recipe, or ask me to plan a meal."
)
_FIXED_MAIN_INVALID_TEXT = (
    "I couldn't read that recipe. Try again from the recipe card, or ask me to plan a meal."
)


def _fixed_main_refused_state(state: WorkflowState, kind: Literal["invalid", "not_found"]) -> WorkflowState:
    """A fixed main that is malformed (`invalid`) or isn't one of the caller's
    recipes (`not_found`, which also covers a deleted or another user's id).

    A friendly `general_chat` reply with no proposal, returned before any model
    call in the stage. `meal_plan_session_state` is deliberately not set, so
    `update_session_node` leaves `session.metadata.meal_plan` untouched."""
    logger.info("meal fixed main refused: %s", kind)
    return {
        **state,
        "intent": Intent.GENERAL_CHAT.value,
        "assistant_message": (
            _FIXED_MAIN_NOT_FOUND_TEXT if kind == "not_found" else _FIXED_MAIN_INVALID_TEXT
        ),
        "next_action": NextAction.NONE.value,
        "proposal": None,
        "requires_review": False,
        "confidence": 0.5,
        "workflow_status": WorkflowStatus.COMPLETED.value,
    }


def _dish_name_key(name: str) -> str:
    """A name reduced to its words: casefolded, with punctuation and hyphens
    treated as spaces, and whitespace collapsed."""
    return " ".join(re.sub(r"[\W_]+", " ", name.casefold()).split())


def _same_dish_name(a: str, b: str) -> bool:
    """Names are equal ignoring case, punctuation, hyphens and spacing, so a
    model's "Lemon-Butter Pasta" or "Lemon Butter Pasta." is the fixed main."""
    return _dish_name_key(a) == _dish_name_key(b)


def _fixed_main_option_dishes(
    raw_dishes: list[MealDishOutlineLLM], outline: MealDishOutline
) -> tuple[list[MealDishOutline], bool] | None:
    """Every option keeps the given main: `[outline, *sides]`.

    The model's own `main` is ALWAYS discarded, whatever it's called, and so is a
    side that repeats the main's name; only `side`-role dishes are kept, up to 2.
    Returns `None` (the caller drops the option) when no side is left. The bool
    is True when the option was built around a *different* main the model named
    -- the caller retitles it, since its title and blurb describe a dish that is
    no longer there.
    """
    sides = [
        MealDishOutline(
            role="side",
            name=d.name,
            key_ingredients=list(d.key_ingredients),
            est_total_minutes=d.est_total_minutes,
            est_hands_on_minutes=d.est_hands_on_minutes,
        )
        for d in raw_dishes
        if d.role == "side" and not _same_dish_name(d.name, outline.name)
    ][:2]
    if not sides:
        return None
    discarded_other_main = any(
        d.role == "main" and not _same_dish_name(d.name, outline.name) for d in raw_dishes
    )
    return [outline, *sides], discarded_other_main


# ---------------------------------------------------------------------------
# Option stage
# ---------------------------------------------------------------------------


async def meal_options_stage(state: WorkflowState) -> WorkflowState:
    """Node: propose 3 meal options and compute their pantry coverage.

    One structured `AIManager` call for the outlines; coverage/to-buy/rescue
    are computed in code afterward, never by the model. The same call also
    returns `follow_ups` (issue #651).

    On a `context.meal_followup` turn (a tap on a predicted pill under a
    meal reply) with a valid retained option set, the fresh extraction is
    merged with that meal's own constraints and servings rather than
    whatever an unrelated earlier recipe conversation left in the session,
    and the prompt names the options already offered (#651 §5e).

    "Make it a meal" (#651 PR B): `context.meal_fixed_main` on a fresh turn, or
    a retained fixed main on a `meal_followup` turn, fixes the main dish -- see
    `_fixed_main_option_dishes`. A fresh fixed-main turn never runs constraint
    extraction (the message is client-canned); its constraints come from the
    recipe itself (`fixed_main_constraints`). Any other turn clears a retained
    fixed main, since it writes a new session state without one.
    """
    input_text = state.get("input_text", "")
    user_id = state.get("user_id") or ""
    context = state.get("context") or {}
    is_followup = context.get("meal_followup") is True
    fresh_fixed = has_fixed_main(context)
    # A fresh fixed-main turn never inherits a retained meal, even with
    # meal_followup also set.
    retained_state = _retained_meal_plan_state(state) if is_followup and not fresh_fixed else None

    fixed_resolved: ResolvedFixedMain | None = None
    if fresh_fixed:
        fixed_or_refusal = await resolve_fixed_main(user_id, context[MEAL_FIXED_MAIN_KEY])
        if isinstance(fixed_or_refusal, FixedMainRefusal):
            return _fixed_main_refused_state(state, fixed_or_refusal.kind)
        fixed_resolved = fixed_or_refusal
    elif retained_state is not None and retained_state.fixed_main is not None:
        # Re-read at every stage: a deletion between turns is caught here,
        # before any constraint extraction or model call.
        fixed_or_refusal = await load_fixed_main_card(user_id, retained_state.fixed_main)
        if isinstance(fixed_or_refusal, FixedMainRefusal):
            return _fixed_main_refused_state(state, fixed_or_refusal.kind)
        fixed_resolved = fixed_or_refusal

    if fixed_resolved is not None and fresh_fixed:
        # No extraction call: extraction over "Make Lemon Butter Pasta into a
        # meal" would turn the dish title into must_use_ingredients.
        constraints = await fixed_main_constraints(state, fixed_resolved.card)
        constraints_state: WorkflowState = {**state, "recipe_constraints": constraints}
    elif retained_state is not None:
        retained_constraints = retained_state.constraints.recipe_constraints
        # Pointing session.metadata.recipe_constraints at the retained meal's
        # own constraints (rather than clearing it) makes extract_recipe_
        # constraints run its own prior-merge against them, so a retained
        # meal_type survives -- see _state_with_recipe_constraints.
        # dietary/excluded_ingredients are blanked in that prior: the plain
        # merge's list rule ("fresh wins when non-empty, else inherit prior")
        # would otherwise make merged["dietary"] just echo the retained value
        # back whenever this turn doesn't restate a diet -- indistinguishable
        # from a genuine fresh request for the same diet, which would defeat
        # _finish_meal_followup_constraints's contradiction check below by
        # having it "re-request" a diet it just dropped. Blanking them here
        # means merged["dietary"]/["excluded_ingredients"] are exactly what
        # *this turn* asked for, nothing inherited.
        constraints_state = await extract_recipe_constraints(
            _state_with_recipe_constraints(
                state, {**retained_constraints, "dietary": [], "excluded_ingredients": []}
            )
        )
        merged_constraints: dict[str, Any] = constraints_state.get("recipe_constraints") or {}
        constraints = _finish_meal_followup_constraints(
            retained_constraints, merged_constraints, input_text
        )
        if fixed_resolved is not None:
            constraints = _drop_diets_the_main_contradicts(
                constraints,
                fixed_resolved.card,
                carried=[
                    *(retained_constraints.get("dietary") or []),
                    *await stored_dietary_preferences(user_id),
                ],
                input_text=input_text,
            )
        # score_pantry_ingredients (next) reads state["recipe_constraints"] --
        # overwrite it with the fixed-up dict so dietary/exclusion filtering
        # sees the union/contradiction-checked result, not the plain merge.
        constraints_state = {**constraints_state, "recipe_constraints": constraints}
    else:
        constraints_state = await extract_recipe_constraints(state)
        constraints = constraints_state.get("recipe_constraints") or {}
    kitchen_limit_phrases = [str(p) for p in (constraints.get("kitchen_limits") or [])]
    exclusive_tags = map_kitchen_limits_to_tags(kitchen_limit_phrases)

    pantry_grounded = is_pantry_grounded(constraints)
    scored_state = await score_pantry_ingredients(constraints_state)
    scored_items: list[dict[str, Any]] = scored_state.get("scored_pantry_items") or []

    explicit_servings = constraints.get("servings")
    if explicit_servings:
        servings = int(explicit_servings)
    elif retained_state is not None:
        servings = retained_state.servings
    else:
        servings = await _default_servings(user_id)

    # The fixed main has already decided the cuisine, so the recent-cuisine
    # weighting is skipped (the one exception to PR A's cuisine-hint behaviour).
    cuisine_hint = (
        await _recent_cuisine_hint(user_id) if user_id and fixed_resolved is None else ""
    )
    constraints_str = _format_meal_constraints(constraints, kitchen_limit_phrases)
    pantry_context = _meal_pantry_context(scored_items) if pantry_grounded else ""
    system_prompt = (
        MEAL_OPTIONS_SYSTEM_PROMPT if pantry_grounded else MEAL_OPTIONS_SYSTEM_PROMPT_NO_PANTRY
    )

    previous_block = ""
    shown: list[str] = []
    if retained_state is not None:
        latest = [_option_descriptor(o) for o in retained_state.options]
        # A session saved before `shown_options` existed falls back to the
        # last set alone.
        shown = retained_state.shown_options or latest
        if latest:
            latest_keys = {_descriptor_key(d) for d in latest}
            earlier = [d for d in shown if _descriptor_key(d) not in latest_keys]
            options_text = "Just shown: " + "; ".join(latest)
            if earlier:
                options_text += ". Earlier: " + "; ".join(earlier)
            previous_block = MEAL_OPTIONS_PREVIOUS_BLOCK.format(options=options_text)

    outline: MealDishOutline | None = None
    fixed_block = ""
    user_line = input_text
    if fixed_resolved is not None:
        outline = fixed_main_outline(fixed_resolved.card)
        # A title can't close the prompt's quotes.
        prompt_title = outline.name.replace('"', "'")
        cuisine = " ".join((fixed_resolved.card.cuisine or "").split())[:60].replace('"', "'")
        fixed_block = MEAL_OPTIONS_FIXED_MAIN_BLOCK.format(
            title=prompt_title,
            cuisine_part=f" ({cuisine})" if cuisine else "",
            ingredients=", ".join(outline.key_ingredients[:20]) or "not listed",
        )
        if fresh_fixed:
            # Built from the card, never from input_text: a deep link's
            # ?title= controls that text.
            user_line = f"Make {prompt_title} into a meal"

    follow_ups_rules = (
        MEAL_OPTIONS_FOLLOW_UPS_RULES
        + (MEAL_OPTIONS_FIXED_MAIN_FOLLOW_UPS_RULE if fixed_resolved is not None else "")
        + ("" if pantry_grounded else MEAL_FOLLOW_UPS_NO_PANTRY_RULE)
    )

    prompt = (
        system_prompt
        + pantry_context
        + constraints_str
        + cuisine_hint
        + previous_block
        + fixed_block
        + follow_ups_rules
        + f"\n\nUser: {user_line}\n\nPropose 3 meal options:"
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
        option_title: str = raw_option.title
        option_blurb: str | None = raw_option.blurb
        dishes: list[MealDishOutline] | None
        if outline is not None:
            fixed_dishes = _fixed_main_option_dishes(raw_option.dishes, outline)
            dishes = fixed_dishes[0] if fixed_dishes is not None else None
            if fixed_dishes is not None and fixed_dishes[1]:
                # Built around a main the card no longer has: its title and
                # blurb would describe a dish that isn't there.
                side_names = " & ".join(d.name for d in fixed_dishes[0][1:])
                option_title = f"{outline.name} with {side_names}"
                option_blurb = None
        else:
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
                title=option_title,
                blurb=option_blurb,
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
    fixed_echo: MealFixedMainEcho | None = None
    assistant_message = "Here are three meal ideas!"
    if fixed_resolved is not None and outline is not None:
        fixed_echo = MealFixedMainEcho(
            recipe_id=fixed_resolved.linked_recipe_id, title=outline.name
        )
        assistant_message = f"Here's how I'd make {outline.name} a meal — pick your sides!"
    proposal = MealOptionsProposal(
        options=options, servings=servings, constraints=constraints_echo, fixed_main=fixed_echo
    )
    session_state = MealPlanSessionState(
        options=options,
        servings=servings,
        constraints=constraints_echo,
        fixed_main=fixed_resolved.fixed if fixed_resolved is not None else None,
        shown_options=_roll_shown_options(shown, [_option_descriptor(o) for o in options]),
    )
    meal_follow_ups = _clean_meal_follow_ups(result.follow_ups, pantry_grounded=pantry_grounded)

    return {
        **state,
        "intent": Intent.MEAL_PLAN.value,
        "assistant_message": assistant_message,
        "next_action": NextAction.PICK_MEAL.value,
        "proposal": proposal,
        "requires_review": True,
        "confidence": 1.0,
        "recipe_constraints": constraints,
        "meal_plan_session_state": session_state,
        "meal_follow_ups": meal_follow_ups,
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


async def _expand_dish_result(
    ai_manager: Any,
    dish: MealDishOutline,
    option: MealOption,
    servings: int,
    constraints_echo: MealConstraintsEcho,
    scored_items: list[dict[str, Any]],
    pantry_grounded: bool = True,
    *,
    with_follow_ups: bool = False,
) -> LLMRecipeResult:
    """One grounded, meal-aware recipe generation for a single dish.

    The prompt names the meal's other dishes (so sides complement rather
    than duplicate the main) and the exclusive-equipment tags in play, and
    asks for the meal's servings exactly. With `pantry_grounded` false (the
    user opted out, issue #287) no pantry item reaches the prompt.

    `with_follow_ups=True` (issue #651) uses `MealDishLLMResult` instead of
    plain `LLMRecipeResult` and appends `MEAL_READY_FOLLOW_UPS_RULES` (plus
    the no-pantry rule when `pantry_grounded` is false) so this one call also
    returns 2-4 predicted pills -- no extra model call. The caller uses this
    on exactly one dish per pick turn (the main).
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

    response_schema: type[LLMRecipeResult] = LLMRecipeResult
    if with_follow_ups:
        response_schema = MealDishLLMResult
        prompt += MEAL_READY_FOLLOW_UPS_RULES
        if not pantry_grounded:
            prompt += MEAL_FOLLOW_UPS_NO_PANTRY_RULE

    result = await ai_manager.complete(prompt=prompt, response_schema=response_schema, temperature=0.5)
    if not isinstance(result, LLMRecipeResult):
        raise ValueError(f"Unexpected response type expanding dish {dish.name!r}")

    return result


async def _expand_dish(
    ai_manager: Any,
    dish: MealDishOutline,
    option: MealOption,
    servings: int,
    constraints_echo: MealConstraintsEcho,
    scored_items: list[dict[str, Any]],
    pantry_grounded: bool = True,
) -> RecipeCard:
    """`_expand_dish_result`, built into a `RecipeCard` (issue #650's original
    signature -- `workflows/meal/sides.py` needs a `RecipeCard`, never a
    `follow_ups`-carrying result, so it keeps calling this rather than
    `_expand_dish_result` directly)."""
    result = await _expand_dish_result(
        ai_manager, dish, option, servings, constraints_echo, scored_items, pantry_grounded
    )
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

    # A fixed main (#651 PR B) is never regenerated: a saved one is re-read here,
    # so a deletion between the option and pick turns is caught before any model
    # call (or pantry read). A draft by now becomes a copy with no recipe id.
    fixed_resolved: ResolvedFixedMain | None = None
    if session_state.fixed_main is not None:
        fixed_or_refusal = await load_fixed_main_card(user_id, session_state.fixed_main)
        if isinstance(fixed_or_refusal, FixedMainRefusal):
            return _fixed_main_refused_state(state, fixed_or_refusal.kind)
        fixed_resolved = fixed_or_refusal

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

    first_generated = 1 if fixed_resolved is not None else 0
    pill_position = first_generated

    ai_manager = get_ai_manager()
    try:
        # `with_follow_ups=True` on exactly one dish per turn -- the main, at
        # position 0, or the first side (position 1) when the main is fixed and
        # so isn't generated at all -- so issue #651's predicted pills ride that
        # one dish's own structured call rather than a separate model call.
        expanded = await asyncio.gather(
            *(
                _expand_dish_result(
                    ai_manager,
                    dish,
                    option,
                    servings,
                    constraints_echo,
                    scored_items,
                    pantry_grounded,
                    with_follow_ups=(position == pill_position),
                )
                for position, dish in enumerate(option.dishes)
                if position >= first_generated
            )
        )
    except NoProviderAvailableError as e:
        return _meal_unavailable_state(state, e)
    except Exception as e:
        return _meal_generation_failed_state(state, str(e))

    meal_dishes: list[MealDish] = []
    dish_titles: list[str] = []
    missing_all: list[str] = []
    meal_follow_ups: list[str] = []
    if fixed_resolved is not None:
        # The fixed main: the recipe's own card (its own servings -- the meal
        # screen scales each dish to the meal's), and its id only when it's a
        # saved, non-draft row that `POST /api/meals` links without copying.
        main_card = fixed_resolved.card
        meal_dishes.append(
            MealDish(
                role="main",
                position=0,
                recipe=main_card,
                recipe_id=fixed_resolved.linked_recipe_id,
            )
        )
        dish_titles.append(main_card.title)
        if pantry_grounded:
            missing_all.extend(_missing_ingredients_for_recipe(main_card, pantry_items))
    for position, (dish_outline, llm_result) in enumerate(
        zip(option.dishes[first_generated:], expanded), start=first_generated
    ):
        recipe_card = _recipe_card_from_llm_result(llm_result, servings)
        meal_dishes.append(MealDish(role=dish_outline.role, position=position, recipe=recipe_card))
        dish_titles.append(recipe_card.title)
        if pantry_grounded:
            missing_all.extend(_missing_ingredients_for_recipe(recipe_card, pantry_items))
        # A stub or non-complying provider returns plain LLMRecipeResult even
        # for the pill-carrying dish -- degrades to no pills, and the meal
        # still builds.
        if position == pill_position and isinstance(llm_result, MealDishLLMResult):
            meal_follow_ups = _clean_meal_follow_ups(
                llm_result.follow_ups, pantry_grounded=pantry_grounded
            )

    missing = list(dict.fromkeys(missing_all))  # dedupe, preserve order

    proposal = MealProposal(
        title=option.title,
        servings=servings,
        constraints=constraints_echo,
        dishes=meal_dishes,
        missing_ingredients=missing,
    )

    # Names the dishes so the meal-ready pills have something concrete to
    # answer against (#651 §5b) -- replaces the old "Here's your {title}!".
    main_title = dish_titles[0] if dish_titles else option.title
    side_titles = dish_titles[1:]
    assistant_message = (
        f"Here's your {option.title}: {main_title} with {' and '.join(side_titles)}!"
        if side_titles
        else f"Here's your {option.title}: {main_title}!"
    )

    return {
        **state,
        "intent": Intent.MEAL_PLAN.value,
        "assistant_message": assistant_message,
        "next_action": NextAction.REVIEW_PROPOSAL.value,
        "proposal": proposal,
        "requires_review": True,
        "confidence": 0.9,
        "meal_follow_ups": meal_follow_ups,
        "workflow_status": WorkflowStatus.AWAITING_REVIEW.value,
    }
