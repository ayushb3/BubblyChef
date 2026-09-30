"""Meal cook service (issue #654): one combined pantry deduction for a whole
meal cook (a main plus up to two sides), reusing the single-recipe matcher.

`match_meal_with_llm` resolves each dish's ingredient list (either supplied
by the client at meal scale, or read from the recipe row and scaled), makes
ONE alias-resolution model call for whatever no dish's synonym table placed,
matches each dish independently against the full pantry, then folds the
per-dish `CookProposal`s into one set of merged lines with `merge_meal_matches`
-- the only piece that is pure and directly unit-tested.

`correlate_expired` and `apply_collapsed_deductions` are shared with the
single-recipe routes (`api/routes/recipes_ai.py`). `apply_collapsed_deductions`
applies identically to both; `correlate_expired` takes a `dedupe` flag because
the two routes deliberately disagree on whether one expired pantry row can
back more than one banner entry (see its own docstring).
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from bubbly_chef.models.cook import (
    CompoundSuggestion,
    CookProposal,
    DeductionItem,
    ExpiredMatchedItem,
    IngredientMatch,
    IngredientMatchStatus,
    IngredientMatchType,
    MealCookDishRequest,
    MealCookIngredient,
    MealCookProposalDish,
    MealCookSource,
    MealIngredientMatch,
)
from bubbly_chef.models.pantry import PantryItem
from bubbly_chef.services.cook_matcher import (
    ResolvedAlias,
    _normalize_ingredient_name,
    _parse_ingredient_string,
    _unmatched_ingredient_names,
    match_ingredients,
    resolve_aliases_with_llm,
)

logger = logging.getLogger(__name__)

_MeasuredKind = Literal["measured", "unit_conflict", "imprecise", "assumed"]


# ---------------------------------------------------------------------------
# Resolving each dish's ingredient list (contract §2a)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MealCookDishInput:
    """One requested dish, resolved against the meal-with-dishes read.

    `recipe_row` is the raw `recipes` row (`repo.get_recipe`'s shape) --
    used only for the fallback path (`request.ingredients is None`) and for
    `title`/`servings`.
    """

    recipe_id: UUID
    title: str
    role: Literal["main", "side"]
    position: int
    request: MealCookDishRequest
    recipe_row: dict[str, Any]


def resolve_supplied_ingredients(
    elements: Sequence[str | MealCookIngredient],
    string_scale: float = 1.0,
) -> list[Any]:
    """Matcher-ready ingredients from a client-supplied list.

    Objects are used verbatim (a blank `name` is dropped); strings are parsed
    and scaled by `string_scale` (round to 2 dp, only when the scale isn't 1).
    Shared by `POST /v1/meals/cook` (a dish's amended list, #654) and
    `POST /v1/recipes/cook` (a single-recipe cook's amended list, #489).
    """
    resolved: list[Any] = []
    for element in elements:
        if isinstance(element, MealCookIngredient):
            name = element.name.strip()
            if not name:
                continue
            resolved.append({"name": name, "quantity": element.quantity, "unit": element.unit})
        else:
            stripped = element.strip()
            if not stripped:
                continue
            parsed = _parse_ingredient_string(stripped)
            if not parsed.get("name"):
                continue
            qty = parsed.get("quantity")
            if string_scale != 1 and qty is not None:
                parsed = {**parsed, "quantity": round(qty * string_scale, 2)}
            resolved.append(parsed)
    return resolved


def _resolve_dish_ingredients(
    request: MealCookDishRequest,
    recipe_row: dict[str, Any],
    meal_servings: int,
) -> tuple[list[Any], Literal["supplied", "recipe"]]:
    """Return (matcher-ready ingredients, ingredients_source) for one dish.

    Supplied objects are used verbatim, at meal scale -- never rescaled here.
    Supplied strings are parsed and scaled by `request.string_scale` (round
    to 2 dp, only when the scale isn't 1 -- Nit 2). The fallback reads the
    recipe row's own ingredients and scales by servings / recipe servings,
    applying the same string-scaling treatment.
    """
    if request.ingredients is not None:
        return resolve_supplied_ingredients(request.ingredients, request.string_scale), "supplied"

    raw_ingredients: list[Any] = recipe_row.get("ingredients") or []
    recipe_servings = _positive_int_or(recipe_row.get("servings"), meal_servings)
    factor = meal_servings / recipe_servings if recipe_servings else 1.0

    resolved: list[Any] = []
    for element in raw_ingredients:
        if isinstance(element, dict):
            name = str(element.get("name") or "").strip()
            if not name:
                continue
            qty = element.get("quantity")
            item: dict[str, Any] = {"name": name, "quantity": qty, "unit": element.get("unit")}
            if factor != 1 and isinstance(qty, (int, float)) and not isinstance(qty, bool):
                item["quantity"] = round(qty * factor, 2)
            resolved.append(item)
        elif isinstance(element, str):
            stripped = element.strip()
            if not stripped:
                continue
            if factor != 1:
                parsed = _parse_ingredient_string(stripped)
                parsed_qty = parsed.get("quantity")
                if parsed_qty is not None:
                    parsed = {**parsed, "quantity": round(parsed_qty * factor, 2)}
                resolved.append(parsed)
            else:
                # No scaling needed -- let match_ingredients parse the raw
                # string itself, exactly as the single-recipe path does.
                resolved.append(stripped)
    return resolved, "recipe"


def _positive_int_or(value: Any, default: int) -> int:
    """A recipe row's `servings`, coerced to a positive int, or `default`
    when it's missing, non-numeric, or not positive."""
    try:
        as_int = int(value)
    except (TypeError, ValueError):
        return default
    return as_int if as_int > 0 else default


def _apply_notes_and_suggestions(
    proposal: CookProposal,
    notes: dict[str, str],
    raw_compound_suggestions: list[CompoundSuggestion],
) -> CookProposal:
    """Filter `notes`/`raw_compound_suggestions` to this dish's own `missing`
    list -- exactly the post-filter `match_ingredients_with_llm` applies
    (`cook_matcher.py`:1286-1307), duplicated here because the alias
    resolution for a meal is batched across dishes (one call, §2a step 2)
    rather than made per-dish the way `match_ingredients_with_llm` does it.
    """
    still_missing = {name.lower() for name in proposal.missing}

    if notes:
        by_norm = {_normalize_ingredient_name(name): name for name in notes}
        proposal.missing_notes = {
            missing_name: notes[by_norm[key]]
            for missing_name in proposal.missing
            if (key := _normalize_ingredient_name(missing_name)) in by_norm
        }

    if raw_compound_suggestions:
        filtered_suggestions = [
            s for s in raw_compound_suggestions if s.ingredient_name.lower() in still_missing
        ]
        if filtered_suggestions:
            proposal = proposal.model_copy(update={"compound_suggestions": filtered_suggestions})

    return proposal


# ---------------------------------------------------------------------------
# merge_meal_matches (contract §2b) -- pure, deterministic
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MealCookDishMeta:
    """The bit of a dish `merge_meal_matches` needs to attribute a source."""

    recipe_id: UUID
    dish_title: str


@dataclass(frozen=True)
class MergedMealMatches:
    """`merge_meal_matches`'s output -- the merged pieces of a `MealCookProposal`."""

    matches: list[MealIngredientMatch]
    missing: list[str]
    missing_sources: dict[str, list[UUID]]
    missing_notes: dict[str, str]
    unit_conflicts: list[dict[str, str]]
    compound_suggestions: list[CompoundSuggestion]


def _line_kind(match: IngredientMatch) -> _MeasuredKind:
    if match.status in ("ready", "substitute", "shortfall"):
        return "measured"
    if match.status == "unit_conflict":
        return "unit_conflict"
    if match.status == "imprecise":
        return "imprecise"
    # "missing" never appears in `proposal.matches` (match_ingredients only
    # ever appends missing NAMES to `proposal.missing`), so the only other
    # status IngredientMatch can carry here is "assumed".
    return "assumed"


def _required_base_qty(match: IngredientMatch) -> float | None:
    """ready/substitute: deduct_qty; shortfall: deduct_qty + shortfall;
    everything else (including a no-quantity ready/substitute): None."""
    if match.status in ("ready", "substitute"):
        return match.deduct_qty
    if match.status == "shortfall":
        return (match.deduct_qty or 0.0) + (match.shortfall or 0.0)
    return None


def _to_source(dish: MealCookDishMeta, match: IngredientMatch) -> MealCookSource:
    return MealCookSource(
        recipe_id=dish.recipe_id,
        dish_title=dish.dish_title,
        ingredient_name=match.ingredient_name,
        ingredient_qty=match.ingredient_qty,
        ingredient_unit=match.ingredient_unit,
        required_base_qty=_required_base_qty(match),
        status=match.status,
        match_type=match.match_type,
        substitution_note=match.substitution_note,
    )


_Group = list[tuple[MealCookDishMeta, IngredientMatch]]


def _same_unit_sum(group: _Group) -> tuple[float | None, str | None]:
    """Sum `ingredient_qty` across `group` when every member shares a unit
    (case-insensitive, trimmed) and has a quantity; otherwise (None, None)."""
    if not group:
        return None, None
    units = {(m.ingredient_unit or "").strip().lower() for _, m in group}
    if len(units) != 1 or any(m.ingredient_qty is None for _, m in group):
        return None, None
    total = round(sum(m.ingredient_qty for _, m in group if m.ingredient_qty is not None), 4)
    return total, group[0][1].ingredient_unit


def _merge_measured(group: _Group) -> MealIngredientMatch:
    sources_output = [_to_source(dish, m) for dish, m in group]
    first_match = group[0][1]
    q = [(dish, m) for dish, m in group if _required_base_qty(m) is not None]

    if q:
        total = sum(_required_base_qty(m) or 0.0 for _, m in q)
        available = max((m.pantry_qty_available or 0.0) for _, m in q)
    else:
        total = 0.0
        available = max((m.pantry_qty_available or 0.0) for _, m in group)

    status: IngredientMatchStatus
    shortfall: float | None
    if q and total > available + 1e-4:
        status = "shortfall"
        deduct_qty: float | None = available
        shortfall = round(total - available, 4)
    else:
        shortfall = None
        if q:
            deduct_qty = min(total, available)
            substitute_pool = q
        else:
            deduct_qty = None
            substitute_pool = group
        every_substitute = all(m.match_type == "substitute" for _, m in substitute_pool)
        status = "substitute" if every_substitute else "ready"

    match_type: IngredientMatchType = (
        "substitute" if all(m.match_type == "substitute" for _, m in group) else "exact"
    )
    substitution_note = group[0][1].substitution_note if match_type == "substitute" else None

    if q:
        ingredient_qty, ingredient_unit = _same_unit_sum(q)
        base_unit = q[0][1].base_unit
    else:
        ingredient_qty, ingredient_unit = None, None
        base_unit = first_match.base_unit

    return MealIngredientMatch(
        ingredient_name=group[0][1].ingredient_name,
        ingredient_qty=ingredient_qty,
        ingredient_unit=ingredient_unit,
        pantry_item_id=first_match.pantry_item_id,
        pantry_item_name=first_match.pantry_item_name,
        pantry_qty_available=available,
        deduct_qty=deduct_qty,
        base_unit=base_unit,
        status=status,
        shortfall=shortfall,
        match_type=match_type,
        substitution_note=substitution_note,
        sources=sources_output,
    )


def _merge_unit_conflict_or_imprecise(
    kind: Literal["unit_conflict", "imprecise"], group: _Group
) -> MealIngredientMatch:
    sources_output = [_to_source(dish, m) for dish, m in group]
    first_match = group[0][1]
    ingredient_qty, ingredient_unit = _same_unit_sum(group)
    match_type: IngredientMatchType = (
        "substitute" if all(m.match_type == "substitute" for _, m in group) else "exact"
    )
    substitution_note = first_match.substitution_note if match_type == "substitute" else None
    available = max((m.pantry_qty_available or 0.0) for _, m in group)

    return MealIngredientMatch(
        ingredient_name=first_match.ingredient_name,
        ingredient_qty=ingredient_qty,
        ingredient_unit=ingredient_unit,
        pantry_item_id=first_match.pantry_item_id,
        pantry_item_name=first_match.pantry_item_name,
        pantry_qty_available=available,
        deduct_qty=None,
        # The base_unit caveat (contract §2b): the first source's, which can
        # disagree with a later source's own recipe-unit fallback when the
        # pantry row has no base unit -- that row's deduct_pantry_item
        # refuses anyway, so nothing is ever deducted in the wrong unit.
        base_unit=first_match.base_unit,
        status=kind,
        shortfall=None,
        match_type=match_type,
        substitution_note=substitution_note,
        sources=sources_output,
    )


def _merge_assumed(group: _Group) -> MealIngredientMatch:
    sources_output = [_to_source(dish, m) for dish, m in group]
    first_match = group[0][1]
    ingredient_qty, ingredient_unit = _same_unit_sum(group)

    return MealIngredientMatch(
        ingredient_name=first_match.ingredient_name,
        ingredient_qty=ingredient_qty,
        ingredient_unit=ingredient_unit,
        pantry_item_id=None,
        pantry_item_name=None,
        pantry_qty_available=None,
        deduct_qty=None,
        base_unit=None,
        status="assumed",
        shortfall=None,
        match_type="none",
        substitution_note=None,
        sources=sources_output,
    )


def merge_meal_matches(
    dish_proposals: list[tuple[MealCookDishMeta, CookProposal]],
) -> MergedMealMatches:
    """Fold each dish's independent `CookProposal` into one set of merged
    lines (contract §2b). Pure and deterministic: the same input always
    gives the same output.

    `dish_proposals` must already be in position order (main, then side 1,
    then side 2) -- that order decides both the merge key's first-appearance
    position and each merged line's `sources` order.
    """
    groups: dict[tuple[str, Any], _Group] = {}
    kind_by_key: dict[tuple[str, Any], _MeasuredKind] = {}

    for dish, proposal in dish_proposals:
        for match in proposal.matches:
            kind = _line_kind(match)
            key: tuple[str, Any] = (
                ("assumed", _normalize_ingredient_name(match.ingredient_name))
                if kind == "assumed"
                else (kind, match.pantry_item_id)
            )
            groups.setdefault(key, []).append((dish, match))
            kind_by_key[key] = kind

    matches: list[MealIngredientMatch] = []
    for key, group in groups.items():
        kind = kind_by_key[key]
        if kind == "measured":
            matches.append(_merge_measured(group))
        elif kind == "assumed":
            matches.append(_merge_assumed(group))
        else:
            matches.append(_merge_unit_conflict_or_imprecise(kind, group))

    missing: list[str] = []
    missing_norm_to_kept: dict[str, str] = {}
    missing_sources: dict[str, list[UUID]] = {}
    missing_notes: dict[str, str] = {}
    for dish, proposal in dish_proposals:
        for name in proposal.missing:
            norm = _normalize_ingredient_name(name)
            if norm not in missing_norm_to_kept:
                missing_norm_to_kept[norm] = name
                missing.append(name)
            kept = missing_norm_to_kept[norm]
            sources_for_kept = missing_sources.setdefault(kept, [])
            # A single dish's own `missing` list can repeat one normalized
            # name (e.g. two recipe lines spelled "Truffle Oil" and "truffle
            # oil") -- without this guard the same dish.recipe_id would be
            # appended once per repeated line (issue #654, code review N4).
            if dish.recipe_id not in sources_for_kept:
                sources_for_kept.append(dish.recipe_id)
            if kept not in missing_notes:
                note = proposal.missing_notes.get(name)
                if note:
                    missing_notes[kept] = note

    compound_suggestions: list[CompoundSuggestion] = []
    seen_compound: set[str] = set()
    for _dish, proposal in dish_proposals:
        for suggestion in proposal.compound_suggestions:
            norm = _normalize_ingredient_name(suggestion.ingredient_name)
            if norm in seen_compound:
                continue
            seen_compound.add(norm)
            kept_name = missing_norm_to_kept.get(norm, suggestion.ingredient_name)
            compound_suggestions.append(suggestion.model_copy(update={"ingredient_name": kept_name}))

    unit_conflicts: list[dict[str, str]] = []
    seen_conflicts: set[tuple[str, str, str, str]] = set()
    for dish, proposal in dish_proposals:
        for conflict in proposal.unit_conflicts:
            recipe_id_str = str(dish.recipe_id)
            entry = {**conflict, "recipe_id": recipe_id_str}
            dedup_key = (
                conflict.get("ingredient", "").lower(),
                conflict.get("recipe_unit", ""),
                conflict.get("pantry_unit", ""),
                recipe_id_str,
            )
            if dedup_key in seen_conflicts:
                continue
            seen_conflicts.add(dedup_key)
            unit_conflicts.append(entry)

    return MergedMealMatches(
        matches=matches,
        missing=missing,
        missing_sources=missing_sources,
        missing_notes=missing_notes,
        unit_conflicts=unit_conflicts,
        compound_suggestions=compound_suggestions,
    )


# ---------------------------------------------------------------------------
# match_meal_with_llm -- orchestrates resolving, one alias call, per-dish
# matching, and the merge above (contract §2a)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MealMatchResult:
    """Everything `match_meal_with_llm` produces short of the meal-level
    fields (`meal_id`, `meal_title`, `servings`) the route fills in, and the
    expiry correlation (`correlate_expired`), which the route also does --
    matching the single-recipe route's own split of responsibilities."""

    dishes: list[MealCookProposalDish]
    matches: list[MealIngredientMatch]
    missing: list[str]
    missing_sources: dict[str, list[UUID]]
    missing_notes: dict[str, str]
    unit_conflicts: list[dict[str, str]]
    compound_suggestions: list[CompoundSuggestion]


async def match_meal_with_llm(
    dishes: list[MealCookDishInput],
    meal_servings: int,
    pantry_items: list[PantryItem],
    ai_manager: Any,
) -> MealMatchResult:
    """Match every requested dish against the pantry and merge the results.

    One alias-resolution model call for the union of what no dish's synonym
    table could place (deduplicated by normalized name) -- not one call per
    dish, and not a single pass over a concatenated ingredient list, which
    would lose the per-dish attribution the matcher can't carry on its own.
    Each dish is then matched independently (`match_ingredients`, not
    `match_ingredients_with_llm` -- the aliases are already resolved) against
    the FULL pantry; the cross-dish accounting happens in `merge_meal_matches`.
    """
    resolved: list[tuple[MealCookDishInput, list[Any], Literal["supplied", "recipe"]]] = []
    for dish in dishes:
        ingredients, source = _resolve_dish_ingredients(dish.request, dish.recipe_row, meal_servings)
        resolved.append((dish, ingredients, source))

    seen_norm: set[str] = set()
    union_unmatched: list[str] = []
    for _dish, ingredients, _source in resolved:
        for name in _unmatched_ingredient_names(ingredients, pantry_items):
            norm = _normalize_ingredient_name(name)
            if norm in seen_norm:
                continue
            seen_norm.add(norm)
            union_unmatched.append(name)

    aliases: dict[str, ResolvedAlias] = {}
    notes: dict[str, str] = {}
    raw_compound_suggestions: list[CompoundSuggestion] = []
    if union_unmatched:
        aliases, notes, raw_compound_suggestions = await resolve_aliases_with_llm(
            union_unmatched, pantry_items, ai_manager
        )

    dish_proposals: list[tuple[MealCookDishMeta, CookProposal]] = []
    proposal_dishes: list[MealCookProposalDish] = []
    for dish, ingredients, source in resolved:
        proposal = match_ingredients(
            recipe_id=str(dish.recipe_id),
            recipe_title=dish.title,
            recipe_ingredients=ingredients,
            pantry_items=pantry_items,
            aliases=aliases,
        )
        proposal = _apply_notes_and_suggestions(proposal, notes, raw_compound_suggestions)
        dish_proposals.append(
            (MealCookDishMeta(recipe_id=dish.recipe_id, dish_title=dish.title), proposal)
        )
        proposal_dishes.append(
            MealCookProposalDish(
                recipe_id=dish.recipe_id,
                title=dish.title,
                role=dish.role,
                position=dish.position,
                ingredients_source=source,
            )
        )

    merged = merge_meal_matches(dish_proposals)

    return MealMatchResult(
        dishes=proposal_dishes,
        matches=merged.matches,
        missing=merged.missing,
        missing_sources=merged.missing_sources,
        missing_notes=merged.missing_notes,
        unit_conflicts=merged.unit_conflicts,
        compound_suggestions=merged.compound_suggestions,
    )


# ---------------------------------------------------------------------------
# correlate_expired -- shared with /v1/recipes/cook (contract §2a step 6)
# ---------------------------------------------------------------------------


def correlate_expired(
    matches: Sequence[IngredientMatch],
    pantry_items: list[PantryItem],
    *,
    dedupe: bool = False,
) -> list[ExpiredMatchedItem]:
    """Which matched ingredients are backed by an expired pantry row.

    Moved out of `api/routes/recipes_ai.py` (formerly inline, :228-248) so
    both cook routes share it. `/v1/recipes/cook` calls this with
    `dedupe=False` (the default) -- ITS behaviour is unchanged: two recipe
    lines resolving to the same expired pantry row (e.g. "cheddar" and
    "parmesan" both landing on one `cheese` row) each get their own banner
    entry, as on `main`.

    The meal route passes `dedupe=True`: a meal's merged matches emit at
    most one measured, one unit_conflict and one imprecise line per pantry
    item, and this must still report that item exactly once (contract §8,
    "expired_items is emitted once per pantry item") -- de-duplicating by
    `pantry_item_id` there, first occurrence kept.
    """
    expired_by_id: dict[str, PantryItem] = {
        str(item.id): item for item in pantry_items if item.is_expired
    }
    expired_items: list[ExpiredMatchedItem] = []
    seen_ids: set[str] = set()
    for match in matches:
        if match.pantry_item_id is None:
            continue
        item_id = str(match.pantry_item_id)
        if dedupe and item_id in seen_ids:
            continue
        expired_row = expired_by_id.get(item_id)
        if expired_row is None:
            continue
        seen_ids.add(item_id)
        days_expired = abs(expired_row.days_until_expiry or 0)
        expired_items.append(
            ExpiredMatchedItem(
                ingredient_name=match.ingredient_name,
                pantry_item_name=expired_row.name,
                days_expired=max(1, days_expired),
            )
        )
    return expired_items


# ---------------------------------------------------------------------------
# apply_collapsed_deductions -- shared with /v1/recipes/cook/confirm
# ---------------------------------------------------------------------------


async def apply_collapsed_deductions(
    repo: Any, user_id: str, deductions: list[DeductionItem]
) -> tuple[int, int, list[str]]:
    """Collapse `deductions` per pantry item and apply them.

    Moved out of `api/routes/recipes_ai.py` (formerly inline, :346-365) so
    both confirm routes share it -- see that route's docstring for why the
    collapse has to happen before any write.

    Returns `(applied, requested, skipped)`, where `requested` is the count
    of distinct pantry items after collapsing (matching the single-recipe
    route's existing meaning), and `skipped` lists the item ids
    `deduct_pantry_item` refused.

    On an exception partway through, this logs the ids already applied (and
    already skipped) at error level, then re-raises the original exception
    unchanged -- the caller's own 500 handler logs nothing more specific, so
    this line is what actually names what landed.
    """
    totals: dict[str, float] = {}
    for deduction in deductions:
        item_id = str(deduction.pantry_item_id)
        totals[item_id] = totals.get(item_id, 0.0) + deduction.deduct_qty

    applied = 0
    applied_ids: list[str] = []
    skipped: list[str] = []
    try:
        for item_id, deduct_qty in totals.items():
            if await repo.deduct_pantry_item(
                user_id=user_id, item_id=item_id, deduct_qty=deduct_qty
            ):
                applied += 1
                applied_ids.append(item_id)
            else:
                skipped.append(item_id)
    except Exception:
        logger.error(
            "apply_collapsed_deductions: failed partway for user=%s; "
            "already applied=%s, already skipped=%s",
            user_id,
            applied_ids,
            skipped,
        )
        raise

    return applied, len(totals), skipped
