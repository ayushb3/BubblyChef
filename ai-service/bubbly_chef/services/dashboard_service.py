"""Business logic for GET /v1/dashboard/daily (#225, #168).

Orchestrates: deterministic ranking (`dashboard_ranking.rank_recipes`) → one
`AIManager` call for copy → per-user-per-local-day-per-pantry-revision-per-
recipes-revision cache → static fallback when every AI provider is
unavailable or generation fails. The route stays thin; everything below is
what it calls.
"""

from __future__ import annotations

import hashlib
import logging
from collections import OrderedDict
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from bubbly_chef.ai.manager import AIManager, NoProviderAvailableError
from bubbly_chef.config import settings
from bubbly_chef.models.dashboard import (
    DashboardCopyResult,
    DashboardDailyResponse,
    DashboardSuggestion,
    DashboardTip,
)
from bubbly_chef.models.pantry import PantryItem
from bubbly_chef.repository.supabase_repo import SupabaseRepository
from bubbly_chef.services.dashboard_ranking import RankedRecipe, rank_recipes

logger = logging.getLogger(__name__)

# Static fallback tips — same role as the hardcoded `tips` array #225 replaces
# in `nextjs/src/components/dashboard/HeroHome.tsx` (frontend PR, not this
# one), duplicated here so the *backend* degrades gracefully on its own when
# every AI provider is down, independent of whatever the Next.js side does.
# The frontend keeps its own copy as ITS client-side fallback per the design
# doc — the two lists are intentionally separate and can drift in wording,
# but if one gains/loses tips it's worth checking whether the other should
# too.
_FALLBACK_TIPS: list[tuple[str, str]] = [
    ("Season your pan, not just your food!", "technique"),
    ("Let meat rest after cooking — way more tender.", "technique"),
    ("Freeze herbs in olive oil ice cubes!", "pantry"),
    ("Toast spices in a dry pan for 30 seconds.", "technique"),
    ("Pasta water makes sauces silky.", "technique"),
    ("Green onions regrow in a glass of water.", "pantry"),
    ("Taste as you cook — adjust seasoning throughout.", "technique"),
]

# ---------------------------------------------------------------------------
# In-process cache: user_id + local date + pantry_revision + recipes_revision
# -> response.
#
# A pure per-day key would keep suggesting a recipe built around ingredients
# the user has since used or thrown out (or a newly-saved recipe the ranking
# has never seen), and would ignore a shop they just did. LRU-bounded like the
# alias cache in `services/cook_matcher.py`, for the same reason: this is one
# process, one cache, no TTL needed because a stale key is simply never looked
# up again once the date or either revision moves on.
#
# `local date` uses the client's UTC offset (`tz_offset_minutes`), not the
# server's — Railway runs UTC, so a per-day key on the server's own date would
# roll over at the wrong moment for every non-UTC user and, worse, disagree
# with a meal-time bucket computed from the same offset (the #306-shaped bug
# a review pass caught here: server bucket != browser greeting).
# ---------------------------------------------------------------------------
_CACHE_MAX_SIZE = 2048
_CacheKey = tuple[str, str, str, str]
_cache: OrderedDict[_CacheKey, DashboardDailyResponse] = OrderedDict()


def _cache_get(key: _CacheKey) -> DashboardDailyResponse | None:
    if key not in _cache:
        return None
    _cache.move_to_end(key)
    return _cache[key]


def _cache_put(key: _CacheKey, value: DashboardDailyResponse) -> None:
    _cache[key] = value
    _cache.move_to_end(key)
    while len(_cache) > _CACHE_MAX_SIZE:
        _cache.popitem(last=False)


def clear_dashboard_cache() -> None:
    """Test-only helper to reset the module-level cache between test cases."""
    _cache.clear()


def _id_set_fingerprint(ids: list[str]) -> str:
    """Order-independent digest of a set of row ids, for cache-busting on add/remove.

    A max-`updated_at` alone misses deletions of any row that isn't the
    current newest: delete an older expiring item and the max is untouched,
    so the cache key doesn't change and a stale suggestion built on the
    deleted ingredient keeps being served. Folding in a fingerprint of the
    *set* of ids catches every add/remove, regardless of which row it is.
    """
    digest = hashlib.sha256(",".join(sorted(ids)).encode()).hexdigest()
    return digest[:16]


def _pantry_revision(pantry_items: list[PantryItem]) -> str:
    """Cache-busting signal for "has the pantry changed": count + id set + max updated_at.

    Count and the id-set fingerprint catch adds/removes (including removing a
    row that isn't the newest one — see `_id_set_fingerprint`); max
    `updated_at` additionally catches an in-place edit (e.g. a corrected
    expiry date) that changes neither the count nor which rows exist.
    """
    if not pantry_items:
        return "empty:0:"
    fingerprint = _id_set_fingerprint([str(item.id) for item in pantry_items])
    max_updated = max(item.updated_at for item in pantry_items).isoformat()
    return f"{len(pantry_items)}:{fingerprint}:{max_updated}"


def _recipes_revision(recipes: list[dict[str, Any]]) -> str:
    """Cache-busting signal for "has the saved-recipe set changed".

    Same shape as `_pantry_revision` and for the same reason (#5): saving a
    recipe is plausibly the single most common thing a user does right before
    looking at the dashboard, and a pure per-day cache would leave the
    suggestion stale for the rest of the day.
    """
    if not recipes:
        return "empty:0:"
    ids = [str(r.get("id")) for r in recipes]
    fingerprint = _id_set_fingerprint(ids)
    timestamps = [
        str(r.get("updated_at") or r.get("created_at"))
        for r in recipes
        if r.get("updated_at") or r.get("created_at")
    ]
    # Supabase timestamps are consistently-formatted ISO 8601 strings, so a
    # lexical max is a correct (if not human-meaningful) monotonic revision
    # signal without needing to parse every row's timestamp.
    max_ts = max(timestamps) if timestamps else ""
    return f"{len(recipes)}:{fingerprint}:{max_ts}"


def _fallback_tip(now: datetime) -> DashboardTip:
    text, category = _FALLBACK_TIPS[now.toordinal() % len(_FALLBACK_TIPS)]
    return DashboardTip(text=text, category=category)


def _fallback_suggestion_copy(top: RankedRecipe) -> str:
    if top.total_time_minutes:
        return f"{top.title} — ready in {top.total_time_minutes} min."
    return f"{top.title} is ready to make."


def _safe_uuid(value: str) -> UUID | None:
    """Parse a recipe id, returning None instead of raising on a bad one.

    `top.recipe_id` always comes from a DB row and should be a real UUID, but
    the fallback path is the one path that must never raise (both this
    module's and the route's docstrings promise it) — a malformed id must
    degrade the suggestion to null, not propagate. Bug found in review: the
    original fallback called `UUID(top.recipe_id)` directly, so a malformed
    id would raise *inside* the fallback itself, with nothing left to catch it.
    """
    try:
        return UUID(value)
    except ValueError:
        logger.warning("Dashboard: recipe_id %r is not a valid UUID; omitting suggestion", value)
        return None


def _fallback_response(top: RankedRecipe | None, now: datetime) -> DashboardDailyResponse:
    suggestion = None
    if top is not None:
        recipe_uuid = _safe_uuid(top.recipe_id)
        if recipe_uuid is not None:
            suggestion = DashboardSuggestion(
                recipe_id=recipe_uuid,
                title=top.title,
                total_time_minutes=top.total_time_minutes,
                copy=_fallback_suggestion_copy(top),
                reason="fallback",
            )
    return DashboardDailyResponse(
        tip=_fallback_tip(now),
        suggestion=suggestion,
        generated_at=now,
        source="fallback",
    )


_COPY_PROMPT = """\
Write copy for a home cooking app's dashboard. Two short pieces of text:

1. A cooking tip — one or two sentences, useful and specific, not generic \
platitudes. Vary it day to day and ground it in THIS user's own pantry below \
whenever it fits naturally — different pantries should get different tips, \
not the same tip reworded.

2. A one-sentence line about why the suggested recipe makes sense right now \
(only if a recipe is given below) — appealing, specific, grounded in the \
ingredients that made it win. Do not invent ingredients or facts not given \
here. Leave suggestion_copy null if no recipe is given.

Dietary preferences: {dietary}

{pantry_section}

{recipe_section}
"""


def _build_pantry_section(pantry_items: list[PantryItem]) -> str:
    """Independent of any recipe suggestion — the tip must be pantry-grounded
    even when there is no suggestion (e.g. no saved recipes), and even the
    matched-recipe section only ever surfaced the ingredients of a *single*
    winning recipe, not the pantry as a whole. Two different pantries with no
    saved recipes and no dietary preferences were previously producing a
    byte-identical prompt — the exact defect #225 exists to fix.
    """
    if not pantry_items:
        return "Pantry: empty."

    expiring_with_days: list[tuple[int, PantryItem]] = [
        (item.days_until_expiry, item)
        for item in pantry_items
        if item.days_until_expiry is not None and 0 <= item.days_until_expiry <= 7
    ]
    expiring_with_days.sort(key=lambda pair: pair[0])
    expiring = [item for _days, item in expiring_with_days]
    names = sorted({item.name for item in pantry_items})

    lines = [
        "Pantry contains: "
        + ", ".join(names[:20])
        + (", and more" if len(names) > 20 else "")
    ]
    if expiring:
        lines.append(
            "Expiring within a week: "
            + ", ".join(f"{item.name} ({item.days_until_expiry}d)" for item in expiring[:10])
        )
    return "\n".join(lines)


def _build_recipe_section(top: RankedRecipe | None) -> str:
    if top is None:
        return "No suggested recipe today (the user has no saved recipes)."

    lines = [f"Suggested recipe: {top.title}"]
    if top.total_time_minutes:
        lines.append(f"Total time: {top.total_time_minutes} minutes")
    if top.expiring_pantry_names:
        lines.append(
            "Expiring soon, used by this recipe: " + ", ".join(top.expiring_pantry_names)
        )
    if top.matched_pantry_names:
        lines.append(
            "Other pantry ingredients this recipe uses: " + ", ".join(top.matched_pantry_names)
        )
    lines.append(f"Why it was picked (do not repeat verbatim): {top.reason}")
    return "\n".join(lines)


async def _generate_ai_copy(
    ai_manager: AIManager,
    top: RankedRecipe | None,
    dietary: list[str],
    pantry_items: list[PantryItem],
) -> DashboardCopyResult:
    prompt = _COPY_PROMPT.format(
        dietary=", ".join(dietary) if dietary else "none specified",
        pantry_section=_build_pantry_section(pantry_items),
        recipe_section=_build_recipe_section(top),
    )
    result = await ai_manager.complete(
        prompt=prompt,
        response_schema=DashboardCopyResult,
        temperature=0.6,
    )
    if not isinstance(result, DashboardCopyResult):
        raise ValueError("Unexpected response type from AI provider")
    return result


async def _ai_response(
    ai_manager: AIManager,
    top: RankedRecipe | None,
    dietary: list[str],
    pantry_items: list[PantryItem],
    now: datetime,
) -> DashboardDailyResponse:
    copy_result = await _generate_ai_copy(ai_manager, top, dietary, pantry_items)

    suggestion = None
    if top is not None:
        recipe_uuid = _safe_uuid(top.recipe_id)
        if recipe_uuid is not None:
            # The model may leave suggestion_copy null even when a recipe was
            # given (bad output, not a provider failure) — degrade that one
            # field rather than the whole response, so a tip that generated
            # fine isn't thrown away over one missing sentence.
            copy_text = copy_result.suggestion_copy or _fallback_suggestion_copy(top)
            suggestion = DashboardSuggestion(
                recipe_id=recipe_uuid,
                title=top.title,
                total_time_minutes=top.total_time_minutes,
                copy=copy_text,
                reason=top.reason,
            )

    return DashboardDailyResponse(
        tip=DashboardTip(text=copy_result.tip_text, category=copy_result.tip_category),
        suggestion=suggestion,
        generated_at=now,
        source="ai",
    )


async def get_dashboard_daily(
    user_id: str,
    *,
    ai_manager: AIManager,
    repo: SupabaseRepository,
    now: datetime | None = None,
    tz_offset_minutes: int = 0,
) -> DashboardDailyResponse:
    """Build (or return a cached) dashboard tip + suggestion for this user.

    `tz_offset_minutes` is the client's UTC offset — minutes to ADD to UTC to
    reach local time (see the route's docstring for the exact sign
    convention). It is used for two things, both local-clock-dependent: the
    meal-time bucket ranking compares against, and the cache key's "local
    date" component. Using the server's own UTC clock for either would
    reintroduce #306's exact complaint (a card disagreeing with a
    client-rendered greeting) on the server side.

    `now`, by contrast, stays a real UTC instant — it's only used for
    `generated_at` and for computing local time by applying the offset, never
    reported to the client as if it were local.

    Never raises for AI unavailability — degrades to `source: "fallback"`.
    A repository failure fetching pantry/recipes/profile does propagate;
    those are the same reads the rest of the dashboard already depends on,
    so there is no sensible way to render this endpoint without them.
    """
    now = now or datetime.now(UTC)
    local_now = now + timedelta(minutes=tz_offset_minutes)

    pantry_items = await repo.get_all_pantry_items(user_id)
    recipes = await repo.get_user_recipes(user_id)

    cache_key: _CacheKey = (
        user_id,
        local_now.date().isoformat(),
        _pantry_revision(pantry_items),
        _recipes_revision(recipes),
    )
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    top = rank_recipes(
        recipes,
        pantry_items,
        now=local_now,
        weight_expiry=settings.dashboard_weight_expiry,
        weight_pantry=settings.dashboard_weight_pantry,
        weight_mealtime=settings.dashboard_weight_mealtime,
        expiry_urgent_days=settings.dashboard_expiry_urgent_days,
        expiry_soon_days=settings.dashboard_expiry_soon_days,
    )

    dietary: list[str] = []
    try:
        profile = await repo.get_profile(user_id)
        dietary = list((profile or {}).get("dietary_preferences") or [])
    except Exception as e:  # noqa: BLE001 — a missing profile must not break the dashboard
        logger.warning("Dashboard: could not fetch profile for %s: %s", user_id, e)

    response: DashboardDailyResponse
    try:
        response = await _ai_response(ai_manager, top, dietary, pantry_items, now)
    except NoProviderAvailableError:
        logger.info("Dashboard: no AI provider available, using fallback")
        response = _fallback_response(top, now)
    except Exception:  # noqa: BLE001 — any generation failure degrades, never errors
        # exception (not warning): anything other than NoProviderAvailableError
        # here is an unexpected failure — a real bug, not the ordinary "no
        # provider configured" case — and should leave a stack trace rather
        # than silently degrading with no trail to debug from.
        logger.exception("Dashboard: AI copy generation failed, using fallback")
        response = _fallback_response(top, now)

    _cache_put(cache_key, response)
    return response
