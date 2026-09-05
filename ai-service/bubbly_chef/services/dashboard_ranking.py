"""Deterministic recipe ranking for the dashboard daily endpoint (#225, #168).

The LLM writes copy. It never picks the recipe — see the design doc at
`docs/plans/2026-09-04-dashboard-daily-endpoint.md`. Selection lives entirely
in this module, is synchronous, and never calls an AI provider, so it is
unit-testable with fixed inputs and no mocking of `AIManager`.

Mirrors the existing Recipe Grounding Workflow's `score_and_rank` split
(`bubbly_chef/workflows/recipe/nodes.py`): deterministic scoring in code,
LLM only for the words on top.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from bubbly_chef.domain.mealtime import meal_time_bucket
from bubbly_chef.models.dashboard import DashboardSuggestionReason
from bubbly_chef.models.pantry import PantryItem
from bubbly_chef.services.cook_matcher import match_ingredients

# Default expiry-urgency thresholds. Overridable via Settings
# (dashboard_expiry_urgent_days / dashboard_expiry_soon_days) — kept as
# defaults here too so callers that ranking directly (as the tests do) don't
# need to thread config through.
_DEFAULT_EXPIRY_URGENT_DAYS = 3
_DEFAULT_EXPIRY_SOON_DAYS = 7


def dashboard_meal_time_bucket(now: datetime | None = None) -> str:
    """Return breakfast | lunch | dinner | snack for the given (or current) time.

    Delegates to `domain/mealtime.py` — the same rule
    `workflows/recipe/nodes.py::_default_meal_type` uses to default a recipe's
    `meal_type` — folding its "late-night snack" output into "snack" to match
    the vocabulary `models/recipe.py` documents (breakfast|lunch|dinner|snack).
    This is a *matching* rule (compared against a stored tag), not a wording
    rule, so it deliberately does NOT follow `HeroHome.tsx`'s greeting clock;
    see `domain/mealtime.py` for why.
    """
    hour = (now or datetime.now()).hour
    bucket = meal_time_bucket(hour)
    return "snack" if bucket == "late-night snack" else bucket


# Priority order used to break weighted ties when picking `reason`: an expiring
# ingredient is the most legible "why" to show a user, then pantry coverage,
# then meal-time fit.
_REASON_PRIORITY: list[DashboardSuggestionReason] = ["expiring", "pantry_match", "meal_time"]


def _dominant_reason(
    *,
    weighted_expiry: float,
    weighted_pantry: float,
    weighted_mealtime: float,
) -> DashboardSuggestionReason:
    weighted: dict[DashboardSuggestionReason, float] = {
        "expiring": weighted_expiry,
        "pantry_match": weighted_pantry,
        "meal_time": weighted_mealtime,
    }
    if max(weighted.values()) <= 0:
        # No signal at all (e.g. zero pantry overlap and no meal_type match) —
        # the pick came entirely from the recency tie-break, not from anything
        # about this recipe. "pantry_match" would misreport a coincidence as a
        # real match; "fallback" is the honest label for "we had nothing to go
        # on, so this was just the best available candidate."
        return "fallback"
    return max(
        _REASON_PRIORITY,
        key=lambda reason: (weighted[reason], -_REASON_PRIORITY.index(reason)),
    )


def _parse_dt(value: Any) -> datetime:
    """Parse a recipe row's created_at/updated_at for the tie-break sort.

    Anything unparseable sorts as the oldest possible value rather than
    raising, so a malformed timestamp demotes a recipe instead of crashing
    the whole ranking. Tzinfo is stripped — this value is only ever compared
    to other values from this same function, never to wall-clock time, and
    `datetime.min` (used as the "unparseable" sentinel) cannot carry tzinfo
    without erroring on `.timestamp()`-free ordinal math anyway.
    """
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            pass
    return datetime.min


def _sortable_seconds(dt: datetime) -> float:
    """Ordinal seconds since `datetime.min`, for a descending sort key.

    `datetime.timestamp()` converts through the local Unix epoch and raises
    on `datetime.min` (year 1). Subtracting two naive datetimes is plain
    ordinal arithmetic and never does that conversion.
    """
    return (dt - datetime.min).total_seconds()


@dataclass(frozen=True)
class RankedRecipe:
    """The winning candidate plus enough of its scoring trace to write copy."""

    recipe_id: str
    title: str
    total_time_minutes: int | None
    score: float
    reason: DashboardSuggestionReason
    matched_pantry_names: list[str] = field(default_factory=list)
    expiring_pantry_names: list[str] = field(default_factory=list)


def rank_recipes(
    recipes: list[dict[str, Any]],
    pantry_items: list[PantryItem],
    *,
    now: datetime | None = None,
    weight_expiry: float,
    weight_pantry: float,
    weight_mealtime: float,
    expiry_urgent_days: int = _DEFAULT_EXPIRY_URGENT_DAYS,
    expiry_soon_days: int = _DEFAULT_EXPIRY_SOON_DAYS,
) -> RankedRecipe | None:
    """Deterministically score and rank the user's saved recipes.

    Returns the single top candidate, or None when `recipes` is empty. Never
    invents a recipe — every candidate comes from `recipes`, which callers
    populate from the user's saved recipes only.

    Reuses `cook_matcher.match_ingredients` for pantry matching rather than a
    second matching rule; that function already handles both ingredient
    shapes (str and dict) and unit/synonym resolution.

    `expiry_urgent_days`/`expiry_soon_days` default to 3/7 for callers (like
    the tests) that rank directly; `dashboard_service.py` passes the
    `Settings`-backed values instead so they're tunable without a deploy, the
    same rationale as the score weights.
    """
    if not recipes:
        return None

    now = now or datetime.now()
    bucket = dashboard_meal_time_bucket(now)
    pantry_by_id = {item.id: item for item in pantry_items}

    ranked: list[tuple[RankedRecipe, datetime]] = []

    for recipe in recipes:
        recipe_id = recipe.get("id")
        if recipe_id is None:
            continue
        title = str(recipe.get("title") or "")
        ingredients: list[dict[str, Any]] = recipe.get("ingredients") or []

        proposal = match_ingredients(
            recipe_id=str(recipe_id),
            recipe_title=title,
            recipe_ingredients=ingredients,
            pantry_items=pantry_items,
        )

        matched = proposal.matches
        missing = proposal.missing
        total_ingredients = len(matched) + len(missing)
        pantry_coverage = (len(matched) / total_ingredients) if total_ingredients else 0.0

        expiry_urgency = 0.0
        matched_names: list[str] = []
        expiring_names: list[str] = []
        for m in matched:
            if m.pantry_item_name:
                matched_names.append(m.pantry_item_name)
            pantry_item = pantry_by_id.get(m.pantry_item_id) if m.pantry_item_id else None
            if pantry_item is None:
                continue
            days = pantry_item.days_until_expiry
            if days is None or days < 0:
                continue
            if days <= expiry_urgent_days:
                expiry_urgency = max(expiry_urgency, 1.0)
                expiring_names.append(pantry_item.name)
            elif days <= expiry_soon_days:
                expiry_urgency = max(expiry_urgency, 0.5)

        meal_type = str(recipe.get("meal_type") or "").lower().strip()
        meal_type_match = 1.0 if meal_type and meal_type == bucket else 0.0

        weighted_expiry = weight_expiry * expiry_urgency
        weighted_pantry = weight_pantry * pantry_coverage
        weighted_mealtime = weight_mealtime * meal_type_match
        score = weighted_expiry + weighted_pantry + weighted_mealtime

        reason = _dominant_reason(
            weighted_expiry=weighted_expiry,
            weighted_pantry=weighted_pantry,
            weighted_mealtime=weighted_mealtime,
        )

        created_at = _parse_dt(recipe.get("created_at") or recipe.get("updated_at"))

        ranked.append(
            (
                RankedRecipe(
                    recipe_id=str(recipe_id),
                    title=title,
                    total_time_minutes=recipe.get("total_time_minutes"),
                    score=score,
                    reason=reason,
                    matched_pantry_names=matched_names,
                    expiring_pantry_names=expiring_names,
                ),
                created_at,
            )
        )

    if not ranked:
        return None

    # Highest score first; ties broken by most-recently-saved, then recipe_id
    # for full determinism when even created_at collides.
    ranked.sort(key=lambda pair: (-pair[0].score, -_sortable_seconds(pair[1]), pair[0].recipe_id))
    return ranked[0][0]
