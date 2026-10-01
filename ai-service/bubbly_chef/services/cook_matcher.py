"""Cook matcher service.

Given a list of recipe ingredients and a user's pantry items, produces a
CookProposal that shows which ingredients can be deducted, which are
insufficient, which have unit conflicts, and which are missing entirely.
"""

from __future__ import annotations

import logging
import math
import re
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Callable, Literal, TypeVar

from pydantic import BaseModel, Field

from bubbly_chef.domain.lots import fresh_first_key, lot_base
from bubbly_chef.domain.normalizer import (
    SIZE_ADJECTIVE_UNITS,  # noqa: F401  re-export: single source of truth
    get_unit_dimension,
    is_package_unit,
    is_piece_unit,
    normalize_food_name,
    normalize_to_base_unit,
)
from bubbly_chef.domain.staples import is_staple
from bubbly_chef.models.cook import (
    CompoundComponent,
    CompoundSuggestion,
    CookProposal,
    IngredientMatch,
)
from bubbly_chef.models.pantry import PantryItem
from bubbly_chef.prompts.cook import _SUBSTITUTION_PROMPT

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Alias resolution cache
# ---------------------------------------------------------------------------
# Only the name→pantry-item mapping is stable between preview and confirm.
# Quantities, shortfalls, and unit-conflicts are recomputed from live pantry
# data every time match_ingredients() runs, so those must never be cached.
#
# Cache key design
# ----------------
# The key is (sorted_unmatched_names_tuple, sorted_pantry_names_tuple).
#
# Why item *names*, not item *ids*, for the pantry fingerprint?
# IDs uniquely identify rows but are opaque — two rows named "onions" and
# "scallions" with different ids both constrain the alias mapping (the model
# must know they exist), whereas quantity changes on an existing row do NOT
# change which aliases are valid (aliases only care about *existence* of an
# item, not how much of it there is).  Using names rather than ids means a
# deduction that reduces a pantry quantity but doesn't add or remove a row
# correctly reuses the cache, while adding a new item or deleting one
# (different name set) correctly busts it.
#
# Per-user isolation: `pantry_items` is always the calling user's slice of the
# DB — the caller (match_ingredients_with_llm) passes only that user's items —
# but the cache KEY is names only, not ids or user_id. Two different users (or
# the same user across a delete+re-add) can share a normalized name-set and
# therefore a cache key. Display names and notes are safe to reuse across such
# a collision; pantry row ids are NOT, so `component_items` is deliberately
# excluded from what gets cached and is instead re-resolved against the
# current request's `pantry_items` on every call — see `resolve_aliases_with_llm`.

_ALIAS_CACHE_TTL: float = 180.0  # seconds; preview→confirm is < 30 s in practice
_ALIAS_CACHE_MAX_SIZE: int = 256  # LRU eviction above this; one entry ≈ a small dict

# OrderedDict used as an LRU: newest entries move to the end on access; the
# oldest entry is evicted from the front when the size limit is reached.
# Value: (result, inserted_at_monotonic), where result is the full 3-tuple
# resolve_aliases_with_llm returns — aliases, notes, and compound suggestions.
# All three are derived from the same LLM call, so caching only the aliases
# would silently drop the notes and suggestions on a cache hit.
_AliasResult = tuple[
    dict[str, "ResolvedAlias"],
    dict[str, str],
    list[CompoundSuggestion],
]
_alias_cache: OrderedDict[
    tuple[tuple[str, ...], tuple[str, ...]],
    tuple[_AliasResult, float],
] = OrderedDict()


def _copy_alias_result(result: _AliasResult) -> _AliasResult:
    """Copy a cached result so callers cannot mutate the shared entry.

    ResolvedAlias is a frozen dataclass and notes are plain strings, so shallow
    copies suffice for those two. CompoundSuggestion is a (mutable) pydantic
    model, so each one is copied individually rather than shared by reference.
    """
    aliases, notes, suggestions = result
    return (dict(aliases), dict(notes), [s.model_copy() for s in suggestions])


_T = TypeVar("_T")


def _dedupe_keep_first(items: list[_T], key_fn: Callable[[_T], Any]) -> list[_T]:
    """Keep the first occurrence of each `key_fn(item)`, drop later ones.

    Shared by every "collapse duplicates from an untrusted LLM/cache response"
    site in this module (compound components by `pantry_item_id`, compound
    suggestions by normalized `ingredient_name`) so the same seen-set loop
    isn't hand-rolled at each call site — a review round found three near-
    identical copies of this shape before this helper existed (PR #616).
    """
    seen: set[Any] = set()
    result: list[_T] = []
    for item in items:
        key = key_fn(item)
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _strip_component_items(
    suggestions: list[CompoundSuggestion],
) -> list[CompoundSuggestion]:
    """Return copies of `suggestions` with `component_items` cleared.

    `component_items` carries pantry row ids (`pantry_item_id`), which are only
    valid for the pantry they were resolved against. The cache key is names-only
    (see `_alias_cache_key`), so caching ids risks handing one pantry's row ids
    to a request whose pantry merely has the same normalized name-set. `components`
    (display names) and `note` are unaffected — they don't identify a specific row.
    """
    return [s.model_copy(update={"component_items": []}) for s in suggestions]


def _resolve_component_items(
    component_names: list[str],
    pantry_by_norm: dict[str, PantryItem],
    component_quantities: dict[str, float] | None = None,
    component_quantity_units: dict[str, str] | None = None,
) -> list[CompoundComponent] | None:
    """Resolve display names to CURRENT pantry rows for one compound suggestion.

    Returns None if any named component is no longer present in `pantry_by_norm`
    (the whole suggestion must then be dropped — we must not invent stock).
    Deduplicates by `pantry_item_id` (first occurrence wins), matching the
    dedup applied when a suggestion is first built from the LLM's response.

    `component_quantities` (#284 Option B) is the suggestion's cached, already-
    validated name->quantity map. `component_quantity_units` (#284 round 7) is
    the base unit each of those quantities was originally validated against.
    The cache key is names-only (see `_alias_cache_key`) — a colliding
    normalized name-set can resolve `component_name` to a DIFFERENT pantry
    row than the one the quantity was validated against (e.g. one user tracks
    butter in grams, another in whole sticks/count). Before re-attaching a
    cached quantity as `suggested_quantity`, this re-checks that the FRESHLY
    resolved row's own base_unit still matches the unit the quantity was
    validated for; a mismatch drops the quantity back to blank rather than
    pre-filling a number under a row it was never checked against. This is
    the exact same "a model/cached number must be reconciled with the actual
    pantry unit before pre-filling" contract as the fresh-build path — round 7
    closes it at this boundary too, not just at generation time.

    This is the cache-hit twin of the inline build loop in
    `resolve_aliases_with_llm` (the `all_present`/`resolved_component_items`
    block) — that loop builds and validates `component_quantities` fresh from
    the LLM response; this one re-verifies and re-attaches an already-validated
    map to a freshly re-resolved pantry row. Keep the two shapes in sync.
    """
    quantities_by_key = component_quantities or {}
    units_by_key = component_quantity_units or {}
    resolved: list[CompoundComponent] = []
    for component_name in component_names:
        comp_norm = _normalize_ingredient_name(component_name)
        pantry_item = pantry_by_norm.get(comp_norm)
        if pantry_item is None:
            return None
        quantity_key = _norm_component_key(component_name)
        current_base_unit = _component_base_unit(pantry_item)
        cached_qty = quantities_by_key.get(quantity_key)
        cached_unit = units_by_key.get(quantity_key)
        # Only re-attach the cached quantity when the unit it was validated
        # against still matches this (possibly different, on a name collision)
        # row's own current base unit.
        suggested_quantity = (
            cached_qty
            if cached_qty is not None and cached_unit is not None and cached_unit == current_base_unit
            else None
        )
        resolved.append(
            CompoundComponent(
                pantry_item_id=pantry_item.id,
                name=pantry_item.name,
                base_unit=current_base_unit,
                suggested_quantity=suggested_quantity,
            )
        )
    return _dedupe_keep_first(resolved, lambda c: c.pantry_item_id)


def _resolve_compound_suggestions_for_request(
    suggestions: list[CompoundSuggestion],
    pantry_by_norm: dict[str, PantryItem],
) -> list[CompoundSuggestion]:
    """Re-resolve `component_items` for each suggestion against THIS request's pantry.

    Must run on every call — cache hit or miss — since the cache never stores
    component_items (see `_strip_component_items`). A suggestion whose components
    are no longer all present in `pantry_by_norm` is dropped entirely.
    `component_quantities` and `component_quantity_units` ARE cached (neither
    carries a pantry row id — see `CompoundSuggestion.component_quantities`),
    so both are threaded through to re-verify and re-attach each component's
    `suggested_quantity` on a hit.
    """
    resolved: list[CompoundSuggestion] = []
    for suggestion in suggestions:
        component_items = _resolve_component_items(
            suggestion.components,
            pantry_by_norm,
            suggestion.component_quantities,
            suggestion.component_quantity_units,
        )
        if component_items is None:
            continue
        resolved.append(suggestion.model_copy(update={"component_items": component_items}))
    return resolved


def _alias_cache_key(
    unmatched_names: list[str],
    pantry_items: list[PantryItem],
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Build a stable cache key for alias resolution, fingerprinted by name only.

    NOT user-scoped: the key is (sorted unmatched names, sorted pantry names), so
    two different users whose normalized pantry name-sets happen to be identical —
    or the same user who deletes and re-adds a row under the same name within the
    TTL — collide on the same key. That's safe for the cached `components` display
    names and `notes`, which only depend on *what* is in the pantry. It is NOT safe
    for pantry row ids, so `component_items` (which carries `pantry_item_id`) is
    never cached — see `_strip_component_items` / the resolution step in
    `resolve_aliases_with_llm`, which rebuilds it from the *current* request's
    `pantry_items` on every call, cache hit or miss.
    """
    norm_unmatched = tuple(sorted(_normalize_ingredient_name(n) for n in unmatched_names))
    # Sort by normalized name so ordering differences in pantry list don't bust the cache.
    norm_pantry = tuple(sorted(_normalize_ingredient_name(i.name) for i in pantry_items))
    return (norm_unmatched, norm_pantry)


def _alias_cache_get(
    key: tuple[tuple[str, ...], tuple[str, ...]],
    now: float,
) -> _AliasResult | None:
    """Return the cached result if present and not expired; None otherwise."""
    if key not in _alias_cache:
        return None
    result, inserted_at = _alias_cache[key]
    if now - inserted_at > _ALIAS_CACHE_TTL:
        del _alias_cache[key]
        return None
    # Move to end (most-recently-used position).
    _alias_cache.move_to_end(key)
    # Copy so a caller mutating its result cannot corrupt the shared entry for
    # every later cook.
    return _copy_alias_result(result)


def _alias_cache_put(
    key: tuple[tuple[str, ...], tuple[str, ...]],
    result: _AliasResult,
    now: float,
) -> None:
    """Insert into cache, evicting the LRU entry when full."""
    if key in _alias_cache:
        _alias_cache.move_to_end(key)
    aliases, notes, suggestions = result
    # Store a copy: the caller keeps using the collections it passed in, and a
    # mutation there must not reach into the shared entry. component_items is
    # deliberately stripped before caching — see _strip_component_items — since
    # the cache key is names-only and pantry row ids are not safe to share
    # across requests that merely collide on the same normalized name-set.
    cacheable = (aliases, notes, _strip_component_items(suggestions))
    _alias_cache[key] = (_copy_alias_result(cacheable), now)
    while len(_alias_cache) > _ALIAS_CACHE_MAX_SIZE:
        _alias_cache.popitem(last=False)  # evict oldest

# Below this, a suggested stand-in is discarded and the ingredient stays missing.
# Substituting an ingredient changes what the user actually cooks, so the bar is
# higher than for a plain lookup.
SUBSTITUTION_CONFIDENCE_THRESHOLD = 0.7


@dataclass(frozen=True)
class ResolvedAlias:
    """A pantry item the LLM proposes for an ingredient the synonym table missed."""

    pantry_name: str
    """Normalized name of the pantry item to match against."""
    match_type: Literal["exact", "substitute"]
    note: str | None = None


class _LLMIngredientMatch(BaseModel):
    """One ingredient's resolution, as returned by the model."""

    ingredient_name: str = Field(description="The unmatched ingredient this refers to")
    best_match: str | None = Field(
        default=None, description="Name of the pantry item to use, or null if none works"
    )
    match_type: Literal["exact", "substitute", "none"] = Field(
        description="exact=same thing by another name, substitute=workable stand-in, none=no option"
    )
    confidence: float = Field(default=0.0, description="0.0-1.0 confidence in this resolution")
    substitution_note: str | None = Field(
        default=None, description="One short sentence explaining the swap, for the user"
    )
    # Compound substitution — only set when no single pantry item works but a
    # combination of 2–3 items would. best_match must be null when this is set.
    compound_components: list[str] | None = Field(
        default=None,
        description=(
            "Ordered list of 2–3 pantry item names to combine when no single item works. "
            "Only set when best_match is null and match_type is 'none'."
        ),
    )
    compound_note: str | None = Field(
        default=None,
        description="Short instruction under ~20 words, e.g. 'Melt butter, whisk in flour, add milk'",
    )
    # Per-component suggested amounts (#284 Option B, 2026-09-27) — only set
    # alongside compound_components. Typed loosely (not dict[str, float]) so a
    # malformed or non-numeric value from the model is validated and dropped
    # by _validate_compound_quantity() rather than rejected by pydantic before
    # this matcher ever sees it — the same "degrade, never crash" contract
    # this whole batch call already has for a bad best_match or confidence.
    compound_quantities: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Suggested quantity for each name in compound_components, in a common "
            "kitchen unit for that ingredient (grams, ml, or a whole count), keyed "
            "by the exact same spelling used in compound_components. Omit a key "
            "rather than guess when unsure of the amount."
        ),
    )
    # Paired with compound_quantities (#284 round 7) — the unit each quantity is in,
    # keyed the same way. Required to trust a quantity: the prompt lists each pantry
    # item's own unit and instructs the model to copy it exactly, so a mismatch here
    # means the model either ignored that instruction or the quantity is for a
    # different unit than the pantry row actually uses. Either way the quantity is
    # not safe to pre-fill under the pantry row's real base_unit label. Typed loosely
    # (not a fixed Literal) for the same "validate, don't reject at the schema
    # boundary" reason compound_quantities is — see _validate_compound_quantity.
    compound_units: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Unit for each entry in compound_quantities, keyed by the exact same "
            "spelling used in compound_components. MUST be copied exactly from that "
            "item's bracketed unit in the pantry list above (e.g. 'g', 'ml', 'count') "
            "— a quantity whose unit does not match that item's own recorded unit "
            "will be discarded rather than used. Omit an item's unit (and quantity) "
            "entirely rather than guess."
        ),
    )


class _LLMMatchBatch(BaseModel):
    """Envelope so the whole unmatched set resolves in a single call."""

    results: list[_LLMIngredientMatch] = Field(default_factory=list)


# Matches leading quantity+unit in a raw ingredient string, e.g.:
#   "2 large eggs"       → qty=2,  unit=None,   rest="large eggs"
#   "1/2 cup flour"      → qty=0.5, unit="cup",  rest="flour"
#   "1 teaspoon lemon zest" → qty=1, unit="tsp", rest="lemon zest"
_LEADING_QTY_RE = re.compile(
    r"^\s*"
    r"(?P<qty>\d+\s*/\s*\d+|\d+(?:\.\d+)?)"   # fraction or decimal
    r"(?:\s+(?P<unit>cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons"
    r"|oz|ounce|ounces|lb|lbs|pound|pounds|g|gram|grams|kg|ml|l|liter|liters"
    r"|pint|quart|gallon|fl\s+oz|fluid\s+ounce|stick|sticks|clove|cloves"
    r"|bunch|bunches|slice|slices|piece|pieces|can|cans|package|packages"
    r"|head|heads|sprig|sprigs|leaf|leaves|pinch|pinches|dash|dashes"
    r"|handful|handfuls|item|count|dozen))?"
    r"\s+",
    re.IGNORECASE,
)

# Adjectives that appear between quantity and the actual food noun
_ADJECTIVE_RE = re.compile(
    r"^(?:large|small|medium|extra-large|xl|fresh|dried|whole|finely|coarsely"
    r"|roughly|thinly|thickly|grated|sliced|diced|chopped|minced|crushed"
    r"|peeled|seeded|boneless|skinless|lean|ground|frozen|canned|organic"
    r"|plus|more|additional|extra)\s+",
    re.IGNORECASE,
)

# Conjunctions that split multi-ingredient strings, e.g. "2 eggs and 1 yolk"
_CONJUNCTION_RE = re.compile(r"\s*(?:,\s*|\s+and\s+|\s+or\s+|\s+plus\s+).*$", re.IGNORECASE)


def _parse_ingredient_string(raw: str) -> dict[str, Any]:
    """Parse a raw ingredient string into {name, quantity, unit}.

    Handles strings like:
      "2 large eggs" → {name: "eggs", quantity: 2.0, unit: None}
      "1/2 cup finely grated Parmesan" → {name: "parmesan", quantity: 0.5, unit: "cup"}
      "1 teaspoon lemon zest" → {name: "lemon zest", quantity: 1.0, unit: "teaspoon"}
      "1/2 cup plus 2 tbsp Parmesan" → {name: "parmesan", quantity: 0.5, unit: "cup"}
    """
    stripped = raw.strip()

    # Split on first conjunction — use the first segment for qty/unit, last for the food noun
    conj_m = _CONJUNCTION_RE.search(stripped)
    first_segment = _CONJUNCTION_RE.sub("", stripped)
    last_segment = stripped[conj_m.start():].lstrip(" ,").strip() if conj_m else first_segment

    qty: float | None = None
    unit: str | None = None
    text = first_segment

    m = _LEADING_QTY_RE.match(text)
    if m:
        qty_str = m.group("qty").replace(" ", "")
        if "/" in qty_str:
            num, den = qty_str.split("/")
            qty = float(num) / float(den)
        else:
            qty = float(qty_str)
        unit = m.group("unit")
        text = text[m.end():]

    # Strip leading adjectives to reach the food noun
    for _ in range(5):
        stripped_adj = _ADJECTIVE_RE.sub("", text)
        if stripped_adj == text:
            break
        text = stripped_adj

    name = text.strip().lower()

    # Food unit words appearing as the sole "name" mean the parse consumed too much.
    # In that case fall back to the last conjunction segment for the actual food noun.
    _UNIT_WORDS = {"cup", "cups", "tbsp", "tablespoon", "tablespoons", "tsp",
                   "teaspoon", "teaspoons", "oz", "lb", "lbs", "g", "kg", "ml",
                   "l", "item", "count", "piece", "pieces", "slice", "slices",
                   "bunch", "can", "cans", "package", "packages", "clove", "cloves",
                   "sprig", "sprigs", "head", "heads", "stick", "sticks"}
    if not name or name in _UNIT_WORDS:
        last = last_segment
        # Strip leading adjectives/conjunction words before the qty match
        for _ in range(5):
            stripped_adj = _ADJECTIVE_RE.sub("", last)
            if stripped_adj == last:
                break
            last = stripped_adj
        last_m = _LEADING_QTY_RE.match(last)
        if last_m:
            last = last[last_m.end():]
        for _ in range(5):
            stripped_adj = _ADJECTIVE_RE.sub("", last)
            if stripped_adj == last:
                break
            last = stripped_adj
        name = last.strip().lower() or name

    return {"name": name, "quantity": qty, "unit": unit}


def _normalize_ingredient_name(name: str) -> str:
    """Normalize an ingredient name for matching against pantry items.

    Skips catalog fuzzy-lookup intentionally — WRatio at any reasonable threshold
    produces cross-food false positives (e.g. "pecorino romano" → "roma tomato").
    Synonym normalization in normalize_food_name() is sufficient for pantry matching.
    """
    return normalize_food_name(name).lower().strip()


def _component_base_unit(item: PantryItem) -> str | None:
    """Base unit for a compound-substitution component's typed quantity.

    Mirrors the fallback match_ingredients() uses for the pantry side of a
    normal match: prefer the row's own unit_base, and derive one from the
    registry when the row predates base-unit tracking. Returning the wrong
    unit here would have the deduction misinterpret whatever the user types,
    so this stays a pure lookup — never a guess beyond what normalize_to_base_unit
    already does elsewhere in this module.
    """
    if item.unit_base is not None:
        return item.unit_base
    _, base_unit = normalize_to_base_unit(
        name=_normalize_ingredient_name(item.name),
        quantity=item.quantity,
        unit=item.unit,
    )
    return base_unit


# A component quantity above this (in whatever unit the model chose — typically
# grams, ml, or a small count) is far outside anything a real kitchen swap would
# need, and is far more likely a model slip (an extra zero, a unit mix-up) than a
# genuine amount. Dropping it back to blank is safer than pre-filling a number a
# user might confirm without a second look (#284 Option B, 2026-09-27).
_MAX_COMPOUND_QUANTITY = 10_000.0


def _norm_component_key(name: str) -> str:
    """Case/whitespace-insensitive key for matching a compound_quantities entry
    to its compound_components name.

    The model echoes a component name into both fields from the same
    generation, but nothing enforces identical casing between them — the same
    class of mismatch fixed for `ingredient_name` vs `proposal.missing` on PR
    #616 round 2 (CookModal.tsx key casing).
    """
    return name.strip().lower()


# Tolerated spellings for a reported compound_units value, mapped to the three
# canonical base units this app ever uses (see normalize_to_base_unit). The
# prompt asks the model to copy a unit string verbatim from the pantry list,
# but "grams"/"gram" for "g" is a cheap, safe normalization to accept — it
# costs nothing in precision (both sides still mean the same physical unit)
# while catching the genuine failure mode: a model reporting a unit from a
# DIFFERENT dimension than the pantry row's own (#284 round 7).
_UNIT_REPORT_SYNONYMS: dict[str, str] = {
    "g": "g", "gram": "g", "grams": "g", "gr": "g",
    "ml": "ml", "milliliter": "ml", "milliliters": "ml",
    "millilitre": "ml", "millilitres": "ml",
    "count": "count", "counts": "count", "ct": "count", "whole": "count",
    "item": "count", "items": "count", "piece": "count", "pieces": "count",
}


def _normalize_reported_unit(raw: Any) -> str | None:
    """Fold a model-reported compound_units value onto a canonical base unit.

    Returns None for anything not a recognised spelling of "g", "ml", or
    "count" — including non-string values — so an unrecognised or missing
    unit never silently passes the equality check in _validate_compound_quantity.
    """
    if not isinstance(raw, str):
        return None
    return _UNIT_REPORT_SYNONYMS.get(raw.strip().lower())


def _validate_compound_quantity(
    raw_qty: Any,
    raw_unit: Any,
    expected_unit: str | None,
) -> float | None:
    """Validate one model-suggested per-component quantity (#284 Option B/round 7).

    Mirrors the defensiveness already applied to compound_components: each
    component *name* is checked against the live pantry before being trusted,
    so each *quantity* gets the equivalent treatment before it is allowed to
    pre-fill an editable input the user might confirm without a second look.
    `bool` is rejected explicitly even though Python would happily coerce it
    to 0.0/1.0 — True/False is never a real quantity.

    `expected_unit` is this component's own base_unit (from _component_base_unit),
    i.e. the unit the value would actually be deducted in if pre-filled and
    confirmed unchanged. round 7: the model previously chose a unit for
    compound_quantities ("grams for solids, ml for liquids, ...") without ever
    seeing what unit the matching pantry ROW actually tracks its quantity in —
    a "2 sticks" (count) butter row plus a model value of 80 rendered and
    deducted 80 *of the row's unit*, silently wiping a row nothing checked. The
    prompt now lists each pantry item's own unit and asks the model to echo it
    back in compound_units; this function only accepts the quantity when that
    echoed unit (after light spelling normalization — see
    _normalize_reported_unit) agrees with expected_unit. `expected_unit` itself
    being None (no derivable base unit for this row at all) always fails closed,
    matching every other place a null base_unit already blocks a deduction.

    Returns None (falls back to a blank input) unless `raw_qty` is a finite,
    positive number at or under `_MAX_COMPOUND_QUANTITY` AND `raw_unit` names
    the same base unit as `expected_unit`.
    """
    if expected_unit is None:
        return None
    if _normalize_reported_unit(raw_unit) != expected_unit:
        return None
    if raw_qty is None or isinstance(raw_qty, bool):
        return None
    try:
        qty = float(raw_qty)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(qty) or qty <= 0 or qty > _MAX_COMPOUND_QUANTITY:
        return None
    return qty


@dataclass(frozen=True)
class _FoodLots:
    """Every pantry row of one food, summed through the base unit (#356).

    Each add of a food is its own row with its own expiry, so a pantry can
    hold 2 onions and 3 onions as two rows. `primary` is the lot to use first
    (among lots that have stock and a base unit: fresh before expired, then
    soonest expiry, undated last; see `fresh_first_key`, #756): it is the row a
    match names, and the one a deduction starts from.
    `total_base` is the stock across every lot whose base unit agrees with
    `base_unit` (the soonest lot's). `uncounted` are lots that hold stock but
    are not in that total: no base unit could be worked out ("1 bag"), or a
    different one (eggs by count next to eggs by weight). They are never
    summed, deducted from, or guessed at.
    """

    key: str
    primary: PantryItem
    base_unit: str | None
    total_base: float | None
    uncounted: tuple[PantryItem, ...]


def _group_lots(key: str, rows: list[PantryItem]) -> _FoodLots:
    ordered = sorted(rows, key=fresh_first_key)
    measured = [(item, *lot_base(item)) for item in ordered if item.quantity > 0]
    basis = next(((i, q, u) for i, q, u in measured if q is not None and u is not None), None)

    if basis is None:
        # Nothing with stock can be measured (or nothing has stock): the row the
        # old single-row matching used, so a lone row behaves exactly as before.
        primary = ordered[0]
        qty, unit = lot_base(primary)
        others = tuple(i for i, _q, _u in measured if i is not primary)
        return _FoodLots(key, primary, unit, qty, others)

    primary, _basis_qty, base_unit = basis
    total = 0.0
    uncounted: list[PantryItem] = []
    for item, qty, unit in measured:
        if qty is not None and unit == base_unit:
            total += qty
        else:
            uncounted.append(item)
    if uncounted:
        logger.info(
            "cook_matcher: %d %r lot(s) left out of the %s total (no comparable base unit): %s",
            len(uncounted),
            key,
            base_unit,
            [f"{i.quantity:g} {i.unit}" for i in uncounted],
        )
    return _FoodLots(key, primary, base_unit, total, tuple(uncounted))


def _index_pantry_lots(pantry_items: list[PantryItem]) -> dict[str, _FoodLots]:
    """Group `pantry_items` by food (synonym-normalised name), one `_FoodLots` each."""
    by_key: dict[str, list[PantryItem]] = {}
    for item in pantry_items:
        by_key.setdefault(_normalize_ingredient_name(item.name), []).append(item)
    return {key: _group_lots(key, rows) for key, rows in by_key.items()}


# Differences below this are float noise, not a missing amount: 0.1 g + 0.7 g sums to
# 0.7999999999999999, which a strict compare calls short of 0.8 g. Matches the
# tolerance `meal_cook._merge_measured` already applies to the merged total (#756).
_QTY_TOLERANCE = 1e-4

# A unit field that says "no amount" rather than naming a measure.
_TO_TASTE_UNITS = frozenset({"to taste", "as needed", "to season", "as desired", "for seasoning"})

# "salt and pepper", "salt, pepper", "salt & pepper", "salt/pepper".
_COMPONENT_SPLIT_RE = re.compile(r"\s*(?:,|&|/|\+|\band\b|\bor\b)\s*", re.IGNORECASE)
_SEASONING_DESCRIPTOR_RE = re.compile(r"^(?:freshly|fresh)\s+", re.IGNORECASE)


def _is_compound_seasoning(norm_name: str) -> bool:
    """True for "salt and pepper": two or more parts, every one a culinary staple (#756).

    `is_staple` alone calls the compound unknown, so it was sent to the model for
    a stand-in and matched to `salt`. A compound is a line of seasonings, not a
    food: it is never matched to one of its parts. A single staple is not a
    compound and keeps the #305 handling.
    """
    parts = [p.strip() for p in _COMPONENT_SPLIT_RE.split(norm_name) if p.strip()]
    if len(parts) < 2:
        return False
    for part in parts:
        text = _SEASONING_DESCRIPTOR_RE.sub("", part)
        for _ in range(5):
            stripped = _ADJECTIVE_RE.sub("", text)
            if stripped == text:
                break
            text = stripped
        if not is_staple(_normalize_ingredient_name(text)):
            return False
    return True


def _has_no_amount(quantity: float | None, unit: str | None) -> bool:
    """True for a line with no quantity, or whose unit just says "to taste"."""
    return quantity is None or (unit or "").strip().lower() in _TO_TASTE_UNITS


def match_ingredients(
    recipe_id: str,
    recipe_title: str,
    recipe_ingredients: list[dict[str, Any]],
    pantry_items: list[PantryItem],
    aliases: dict[str, ResolvedAlias] | None = None,
) -> CookProposal:
    """Match recipe ingredients against pantry items and produce a CookProposal.

    Args:
        recipe_id: UUID string of the recipe.
        recipe_title: Human-readable title for the proposal.
        recipe_ingredients: List of ingredient dicts with keys:
            name (str), quantity (float|None), unit (str|None).
        pantry_items: List of PantryItem objects for the current user.
        aliases: Optional map of normalized ingredient name -> ResolvedAlias, used to
            match ingredients the synonym table misses. Applied inside this single
            pass, not as a second pass, so aliased ingredients draw on the same
            consumption accounting as everything else — a substitute must not be
            able to claim stock an earlier ingredient already took.

    Returns:
        CookProposal with matches, missing, and unit_conflicts lists.

    Several recipe ingredients may resolve to the same pantry row. Each one is
    matched against what the row has left after the earlier ones, so a recipe
    asking for more than a row holds reports a shortfall rather than claiming
    every line is ready.
    """
    from uuid import UUID

    # normalized_name -> every row of that food, summed. Rows of one food are
    # separate lots with their own expiry (#356), not duplicates to pick between.
    pantry_index = _index_pantry_lots(pantry_items)

    matches: list[IngredientMatch] = []
    missing: list[str] = []
    unit_conflicts: list[dict[str, str]] = []

    # Base-unit quantity already claimed from each food's lots by earlier ingredients
    # in THIS recipe, keyed by the food's normalised name.
    #
    # Two recipe lines can resolve to the same pantry row — either as literal
    # duplicates ("onion" twice) or because normalize_food_name() collapses
    # synonyms (cheddar and parmesan both become "cheese"). Without this running
    # total each line compares against the row's untouched quantity, so both are
    # reported "ready" even when the row only covers one of them, and the confirm
    # step then deducts twice.
    consumed: dict[str, float] = {}

    for ingredient in recipe_ingredients:
        # Ingredients may be stored as plain strings (e.g. "1 cup flour") or dicts.
        # Parse the string to extract name, quantity, and unit before any dict access.
        if isinstance(ingredient, str):
            ingredient = _parse_ingredient_string(ingredient)

        raw_name: str = ingredient.get("name", "")
        if not raw_name:
            continue

        ing_qty: float | None = ingredient.get("quantity")
        ing_unit: str | None = ingredient.get("unit")
        norm_name = _normalize_ingredient_name(raw_name)

        # --- Compound seasoning with no amount: "salt and pepper" (#756) ---
        # Nothing to deduct and nothing to ask for, so it is neither matched to a
        # pantry row (a compound is never a stand-in for one of its parts) nor
        # allowed to become a unit conflict. The review shows it as one quiet line.
        compound_seasoning = _is_compound_seasoning(norm_name)
        if compound_seasoning and _has_no_amount(ing_qty, ing_unit):
            matches.append(
                IngredientMatch(
                    ingredient_name=raw_name,
                    ingredient_qty=ing_qty,
                    ingredient_unit=ing_unit,
                    pantry_item_id=None,
                    pantry_item_name=None,
                    pantry_qty_available=None,
                    deduct_qty=None,
                    base_unit=None,
                    status="to_taste",
                    match_type="none",
                    substitution_note=None,
                )
            )
            continue

        # --- Find pantry match ---
        lots = pantry_index.get(norm_name)
        alias: ResolvedAlias | None = None

        if lots is None and aliases and not compound_seasoning:
            alias = aliases.get(norm_name)
            if alias is not None:
                lots = pantry_index.get(alias.pantry_name)
                if lots is None:
                    # Alias named an item that is not actually in the pantry.
                    alias = None

        if lots is None:
            # No match at all — but a culinary staple (salt, pepper, oil, …)
            # is presumed on hand even when not in the pantry (#305). So is a
            # compound of them ("salt and pepper") when it carries an amount.
            if is_staple(norm_name) or compound_seasoning:
                matches.append(
                    IngredientMatch(
                        ingredient_name=raw_name,
                        ingredient_qty=ing_qty,
                        ingredient_unit=ing_unit,
                        pantry_item_id=None,
                        pantry_item_name=None,
                        pantry_qty_available=None,
                        deduct_qty=None,
                        base_unit=None,
                        status="assumed",
                        match_type="none",
                        substitution_note=None,
                    )
                )
            else:
                missing.append(raw_name)
            continue

        # A stand-in is surfaced as its own status so the user can see the swap,
        # but only when stock is sufficient — a short substitute is more useful
        # reported as a shortfall, with match_type still recording the swap.
        is_substitute = alias is not None and alias.match_type == "substitute"
        match_type: Literal["exact", "substitute", "none"] = (
            "substitute" if is_substitute else "exact"
        )
        note = alias.note if is_substitute and alias is not None else None
        ok_status: Literal["ready", "substitute"] = "substitute" if is_substitute else "ready"

        # The lot to use first. A match names this one row; its amounts cover
        # every lot of the food.
        pantry_item = lots.primary

        # What the food's lots still hold after earlier ingredients in this
        # recipe took their share.
        already_claimed = consumed.get(lots.key, 0.0)

        # A bare number ("1 lemon") counts that many of the food. Against a row
        # counted in units it is deducted by count (#756); against a weighed or
        # measured row it stays unconvertible and is left as before.
        calc_unit = ing_unit
        if ing_qty is not None and ing_unit is None and lots.base_unit == "count":
            calc_unit = "count"

        # --- No quantity on recipe ingredient → can't deduct, just note as ready ---
        if ing_qty is None or calc_unit is None:
            unclaimed = lots.total_base
            if unclaimed is not None:
                unclaimed = max(0.0, unclaimed - already_claimed)
            matches.append(
                IngredientMatch(
                    ingredient_name=raw_name,
                    ingredient_qty=ing_qty,
                    ingredient_unit=ing_unit,
                    pantry_item_id=pantry_item.id,
                    pantry_item_name=pantry_item.name,
                    pantry_qty_available=unclaimed,
                    deduct_qty=None,
                    base_unit=lots.base_unit,
                    status=ok_status,
                    match_type=match_type,
                    substitution_note=note,
                )
            )
            continue

        # --- Resolve the pantry side first ---
        # The recipe line is then converted toward whatever unit the pantry row
        # actually uses, which is the only unit the deduction can be expressed in.
        # Summed across every lot of the food through the base unit (#356); a lot
        # with no base values of its own is derived from its name/quantity/unit.
        pantry_base_qty = lots.total_base
        pantry_base_unit = lots.base_unit

        # --- Convert recipe ingredient into the pantry row's unit ---
        # Target the pantry's base unit when it is known, rather than looking the
        # recipe's ingredient name up in INGREDIENT_CANONICAL_UNIT. That registry
        # only covers the names it lists: "cheese" resolves to grams, but
        # "cheddar", "sour cream" and "greek yogurt" all miss and fall back to the
        # category default of "count" — turning a perfectly ordinary gram quantity
        # into a spurious unit_conflict. It matters most for substitutes (#123),
        # where the recipe name and the pantry name are different words by design.
        req_base_qty, req_base_unit = normalize_to_base_unit(
            name=norm_name,
            quantity=ing_qty,
            unit=calc_unit,
            target_unit=pantry_base_unit,
        )

        # --- Imprecise: pieces of an ingredient against a package of it ---
        # "4 slices bread" against "1 item bread" converts — both sides reach
        # "count" — but they are counting different things, so the comparison
        # produces a shortfall and the confirm step deducts the whole loaf.
        # Report it as its own status instead: the user has the ingredient, we
        # just cannot say how much of it the recipe uses. Nothing is deducted.
        #
        # A genuine conversion always wins: "2 slices cheese" against a 500 g
        # row resolves through the conventional piece weight to grams, so
        # req_base_unit is "g" and this branch never sees it. Only a pair that
        # landed on "count" (or failed to convert at all) can be imprecise.
        if (
            is_piece_unit(calc_unit)
            and is_package_unit(pantry_item.unit)
            and req_base_unit in (None, "count")
        ):
            # Report what the row has left after earlier lines took their share,
            # as every other branch does — an imprecise line claims nothing, but
            # it should not display stock a previous line already spoke for.
            unclaimed = (
                None if pantry_base_qty is None else max(0.0, pantry_base_qty - already_claimed)
            )
            matches.append(
                IngredientMatch(
                    ingredient_name=raw_name,
                    ingredient_qty=ing_qty,
                    ingredient_unit=ing_unit,
                    pantry_item_id=pantry_item.id,
                    pantry_item_name=pantry_item.name,
                    pantry_qty_available=unclaimed,
                    deduct_qty=None,
                    base_unit=pantry_base_unit or pantry_item.unit,
                    status="imprecise",
                    match_type=match_type,
                    substitution_note=note,
                )
            )
            continue

        # --- Unit conflict or soft fallback: can't convert either side ---
        #
        # Two distinct situations both land here after normalize_to_base_unit
        # returns (None, None) or produces mismatched base units:
        #
        # 1. GENUINE DIMENSION MISMATCH — both sides have a known unit dimension
        #    (g vs ml, g vs count, …) but those dimensions are different.
        #    No conversion is possible even in principle; keep this as a hard
        #    unit_conflict so the user knows something is structurally wrong.
        #
        # 2. UNRESOLVABLE UNIT — at least one side uses a unit not in the
        #    recognised vocabulary (e.g. "handful" on the recipe side, or an
        #    unregistered pantry label).  The ingredient IS matched to a pantry
        #    row; we just can't express the quantity precisely.  Blocking the
        #    whole flow on this is worse UX than surfacing a soft "imprecise"
        #    line — but we must NOT invent a deduction.  `imprecise` is a
        #    never-auto-deduct status everywhere in the stack (the frontend
        #    summary shows an "left as it is" notice and skips the deduction),
        #    so the line carries deduct_qty=None and claims nothing in the
        #    consumption ledger.  A pre-filled deduct_qty here would (a) be
        #    silently applied by confirm despite the "left as it is" copy, and
        #    (b) be interpreted by deduct_pantry_item as a BASE-unit quantity
        #    while it was expressed in the display unit — corrupting stock when
        #    display != base (1 "dozen" != 1 egg, 1 "kg" != 1 g).
        if req_base_qty is None or pantry_base_qty is None or req_base_unit != pantry_base_unit:
            req_dim = get_unit_dimension(calc_unit)
            pantry_dim = get_unit_dimension(pantry_item.unit)

            genuine_conflict = (
                req_dim is not None
                and pantry_dim is not None
                and req_dim != pantry_dim
            )

            if genuine_conflict:
                conflict_info = {
                    "ingredient": raw_name,
                    "recipe_unit": calc_unit,
                    "pantry_unit": pantry_item.unit,
                }
                unit_conflicts.append(conflict_info)
                matches.append(
                    IngredientMatch(
                        ingredient_name=raw_name,
                        ingredient_qty=ing_qty,
                        ingredient_unit=ing_unit,
                        pantry_item_id=pantry_item.id,
                        pantry_item_name=pantry_item.name,
                        pantry_qty_available=pantry_base_qty,
                        deduct_qty=None,
                        base_unit=pantry_base_unit or calc_unit,
                        status="unit_conflict",
                        match_type=match_type,
                        substitution_note=note,
                    )
                )
            else:
                # Soft fallback: the ingredient is matched but the quantity is
                # not expressible in a shared unit.  Surface it as an editable,
                # non-blocking "imprecise" line that deducts nothing on its own
                # (deduct_qty=None) — the user has the item; we just can't say
                # how much the recipe uses.  Claim nothing in the ledger so a
                # later recipe line sees the full remaining stock (an imprecise
                # line makes no reservation, matching the pieces-vs-package
                # branch above).  base_unit reports the pantry row's base unit
                # so if the user does fill in a deduction, confirm interprets it
                # in the same unit deduct_pantry_item expects.
                unclaimed = (
                    None
                    if pantry_base_qty is None
                    else max(0.0, pantry_base_qty - already_claimed)
                )
                matches.append(
                    IngredientMatch(
                        ingredient_name=raw_name,
                        ingredient_qty=ing_qty,
                        ingredient_unit=ing_unit,
                        pantry_item_id=pantry_item.id,
                        pantry_item_name=pantry_item.name,
                        pantry_qty_available=unclaimed,
                        deduct_qty=None,
                        base_unit=pantry_base_unit or pantry_item.unit,
                        status="imprecise",
                        match_type=match_type,
                        substitution_note=note,
                    )
                )
            continue

        # --- Quantity comparison ---
        assert req_base_qty is not None
        assert pantry_base_qty is not None
        assert req_base_unit is not None

        # Compare against what is left, not the row's original quantity.
        available_base_qty = max(0.0, pantry_base_qty - already_claimed)

        if available_base_qty + _QTY_TOLERANCE >= req_base_qty:
            consumed[lots.key] = already_claimed + req_base_qty
            matches.append(
                IngredientMatch(
                    ingredient_name=raw_name,
                    ingredient_qty=ing_qty,
                    ingredient_unit=ing_unit,
                    pantry_item_id=pantry_item.id,
                    pantry_item_name=pantry_item.name,
                    pantry_qty_available=available_base_qty,
                    deduct_qty=req_base_qty,
                    base_unit=req_base_unit,
                    status=ok_status,
                    match_type=match_type,
                    substitution_note=note,
                )
            )
        elif lots.uncounted:
            # Short on what can be measured, but other lots of this food hold stock
            # that can't be converted to the same unit ("1 bag" next to grams).
            # Calling that a shortfall would tell the user they lack something they
            # have, and the uncountable lot can't be deducted from, so report the
            # line as imprecise: nothing is auto-deducted and no stock is claimed.
            matches.append(
                IngredientMatch(
                    ingredient_name=raw_name,
                    ingredient_qty=ing_qty,
                    ingredient_unit=ing_unit,
                    pantry_item_id=pantry_item.id,
                    pantry_item_name=pantry_item.name,
                    pantry_qty_available=available_base_qty,
                    deduct_qty=None,
                    base_unit=pantry_base_unit or pantry_item.unit,
                    status="imprecise",
                    match_type=match_type,
                    substitution_note=note,
                )
            )
        else:
            shortfall = req_base_qty - available_base_qty
            consumed[lots.key] = already_claimed + available_base_qty
            matches.append(
                IngredientMatch(
                    ingredient_name=raw_name,
                    ingredient_qty=ing_qty,
                    ingredient_unit=ing_unit,
                    pantry_item_id=pantry_item.id,
                    pantry_item_name=pantry_item.name,
                    pantry_qty_available=available_base_qty,
                    deduct_qty=available_base_qty,  # deduct what is left
                    base_unit=req_base_unit,
                    status="shortfall",
                    shortfall=round(shortfall, 4),
                    match_type=match_type,
                    substitution_note=note,
                )
            )

    return CookProposal(
        recipe_id=UUID(recipe_id),
        recipe_title=recipe_title,
        matches=matches,
        missing=missing,
        unit_conflicts=unit_conflicts,
    )


def _unmatched_ingredient_names(
    recipe_ingredients: list[dict[str, Any]],
    pantry_items: list[PantryItem],
) -> list[str]:
    """Names the deterministic synonym table cannot place in the pantry.

    Name resolution only — no quantity or unit logic — so this can run before the
    real matching pass without disturbing its consumption accounting.

    Culinary staples (#305) are excluded: they are classified ``assumed`` rather
    than sent to the LLM substitution tier, and advertising them to the model
    as "missing" would invite unnecessary substitution notes.
    """
    pantry_names = {_normalize_ingredient_name(item.name) for item in pantry_items}

    unmatched: list[str] = []
    seen: set[str] = set()
    for ingredient in recipe_ingredients:
        if isinstance(ingredient, str):
            ingredient = _parse_ingredient_string(ingredient)
        raw_name = ingredient.get("name", "")
        if not raw_name:
            continue
        norm = _normalize_ingredient_name(raw_name)
        if norm in pantry_names or norm in seen:
            continue
        if is_staple(norm) or _is_compound_seasoning(norm):
            continue  # assumed on hand or to taste — never send to the LLM
        seen.add(norm)
        unmatched.append(raw_name)
    return unmatched


async def resolve_aliases_with_llm(
    unmatched_names: list[str],
    pantry_items: list[PantryItem],
    ai_manager: Any,
    *,
    _clock: Any = None,
) -> tuple[dict[str, ResolvedAlias], dict[str, str], list[CompoundSuggestion]]:
    """Ask the model which pantry items could stand in for unmatched ingredients.

    One batched call for the whole set, not one per ingredient. Returns a 3-tuple:
    - aliases: map keyed by normalized ingredient name; anything the model declines,
      scores below SUBSTITUTION_CONFIDENCE_THRESHOLD, or names a pantry item that does
      not exist is dropped, so the caller simply sees fewer aliases.
    - notes: map keyed by ORIGINAL ingredient name explaining why anything that did
      not resolve was left unmatched. Every path that drops a candidate records a
      reason, so the caller can show the user a useful message instead of a bare
      "not in pantry" chip.
    - compound_suggestions: advisory multi-item suggestions for ingredients that have
      no single-item match. Every component must exist in the user's pantry; if any
      component is missing the whole suggestion is dropped. These never enter the
      alias/deduction path.

    All three are cached together by (sorted unmatched names, sorted pantry names)
    for _ALIAS_CACHE_TTL seconds with LRU eviction at _ALIAS_CACHE_MAX_SIZE entries.
    Failures are never cached — a transient outage must not poison the cache.

    Never raises. Any provider failure returns empty collections, which leaves the
    ingredients missing exactly as they were before this tier existed.

    Args:
        _clock: Optional callable returning a monotonic float, injectable for
            testing TTL expiry without real sleeps. Defaults to time.monotonic.
    """
    if not unmatched_names or not pantry_items:
        return {}, {}, []

    now = (_clock or time.monotonic)()
    # Built before the cache check: needed on both the hit and miss paths, since
    # component_items is never cached and must be resolved against THIS request's
    # pantry every time (see _alias_cache_key's docstring).
    # One row per food for compound components: the lot to use first (#356). A
    # deduction against it carries over into the food's later lots.
    pantry_by_norm = {k: v.primary for k, v in _index_pantry_lots(pantry_items).items()}
    cache_key = _alias_cache_key(unmatched_names, pantry_items)
    cached = _alias_cache_get(cache_key, now)
    if cached is not None:
        logger.debug("resolve_aliases_with_llm: cache hit, skipping LLM call")
        cached_aliases, cached_notes, cached_suggestions = cached
        return (
            cached_aliases,
            cached_notes,
            _resolve_compound_suggestions_for_request(cached_suggestions, pantry_by_norm),
        )

    # Each pantry line carries its own base unit (#284 round 7) so the model
    # can echo the RIGHT unit back in compound_units instead of guessing one
    # from the ingredient's nature — see _validate_compound_quantity for why
    # a guessed unit that disagrees with the row's real unit is unsafe to
    # pre-fill. "[unit unknown]" for a row _component_base_unit can't derive
    # anything for at all, same as every other unit-unknown branch in this
    # module — the model is told a quantity for it can never be used.
    def _pantry_prompt_line(item: PantryItem) -> str:
        unit = _component_base_unit(item)
        return f"- {item.name} [{unit}]" if unit else f"- {item.name} [unit unknown]"

    prompt = _SUBSTITUTION_PROMPT.format(
        unmatched="\n".join(f"- {n}" for n in unmatched_names),
        pantry="\n".join(_pantry_prompt_line(i) for i in pantry_items),
        threshold=SUBSTITUTION_CONFIDENCE_THRESHOLD,
    )

    try:
        result = await ai_manager.complete(
            prompt=prompt,
            response_schema=_LLMMatchBatch,
            temperature=0.1,
        )
    except Exception as e:  # noqa: BLE001 - degrading to "missing" is the contract
        logger.warning(f"Substitution matching unavailable, leaving ingredients missing: {e}")
        # Do NOT cache failures — a retry must hit the provider.
        return {}, {}, []

    if not isinstance(result, _LLMMatchBatch):
        logger.warning("Substitution matching returned an unexpected shape; ignoring")
        return {}, {}, []

    aliases: dict[str, ResolvedAlias] = {}
    # Why an ingredient stayed unmatched, keyed by the ORIGINAL name so the
    # caller can line it up with CookProposal.missing. Every path that drops a
    # candidate records one: previously all three dropped silently, leaving the
    # user a bare "not in pantry" chip and no idea what to do (#282).
    notes: dict[str, str] = {}
    compound_suggestions: list[CompoundSuggestion] = []

    def _note(entry: _LLMIngredientMatch, text: str | None) -> None:
        if text:
            notes[entry.ingredient_name] = text

    for entry in result.results:
        # --- Single-item path ---
        if entry.best_match and entry.match_type != "none":
            if entry.confidence < SUBSTITUTION_CONFIDENCE_THRESHOLD:
                logger.debug(
                    f"Dropping low-confidence match {entry.ingredient_name} -> "
                    f"{entry.best_match} ({entry.confidence})"
                )
                # Deliberately not surfacing the model's note here: it describes a
                # swap we are refusing to make, so showing it would advertise a
                # substitution the user cannot actually get.
                _note(entry, f"No confident match — {entry.best_match} was too uncertain.")
                continue

            pantry_norm = _normalize_ingredient_name(entry.best_match)
            if pantry_norm not in pantry_by_norm:
                # Model named something the user does not have.
                logger.debug(f"Dropping match to absent pantry item: {entry.best_match}")
                _note(entry, f"Closest option was {entry.best_match}, which isn't in your pantry.")
                continue

            aliases[_normalize_ingredient_name(entry.ingredient_name)] = ResolvedAlias(
                pantry_name=pantry_norm,
                match_type=entry.match_type,
                note=entry.substitution_note,
            )
            continue

        # --- match_type "none" or no best_match ---
        # Attempt compound path first: only when the model provided components and a note.
        if (
            entry.match_type == "none"
            and entry.compound_components
            and entry.compound_note
        ):
            if entry.confidence < SUBSTITUTION_CONFIDENCE_THRESHOLD:
                logger.debug(
                    f"Dropping low-confidence compound suggestion for "
                    f"{entry.ingredient_name} ({entry.confidence})"
                )
                # Fall through to record a note below rather than silently discarding.
            else:
                # Validate every component exists in the pantry; drop the whole
                # suggestion if any is absent — we must not invent stock.
                all_present = True
                resolved_components: list[str] = []
                resolved_component_items: list[CompoundComponent] = []
                # This is the cache-MISS build path — its cache-HIT twin is
                # `_resolve_component_items`, which re-attaches this same
                # (already-validated) component_quantities map to a freshly
                # re-resolved pantry row instead of rebuilding it from the LLM
                # response. Keep the two shapes in sync.
                #
                # Model-suggested quantities (#284 Option B), keyed the same
                # normalized way as the components loop below so a casing
                # mismatch between compound_quantities and compound_components
                # (the model echoes a name into both, with no guarantee of
                # identical casing) still resolves. Each raw value is validated
                # before it is trusted to pre-fill anything.
                raw_quantities_by_key: dict[str, Any] = (
                    {
                        _norm_component_key(name): raw
                        for name, raw in entry.compound_quantities.items()
                    }
                    if entry.compound_quantities
                    else {}
                )
                # Paired unit for each raw quantity above (#284 round 7) — must
                # agree with the component's own base_unit before the quantity
                # is trusted; see _validate_compound_quantity.
                raw_units_by_key: dict[str, Any] = (
                    {
                        _norm_component_key(name): raw
                        for name, raw in entry.compound_units.items()
                    }
                    if entry.compound_units
                    else {}
                )
                component_quantities: dict[str, float] = {}
                component_quantity_units: dict[str, str] = {}
                for component_name in entry.compound_components:
                    comp_norm = _normalize_ingredient_name(component_name)
                    if comp_norm not in pantry_by_norm:
                        logger.debug(
                            f"Dropping compound suggestion for {entry.ingredient_name}: "
                            f"component '{component_name}' not in pantry"
                        )
                        all_present = False
                        break
                    # Use the pantry's display name so the UI can show something consistent.
                    component_item = pantry_by_norm[comp_norm]
                    resolved_components.append(component_item.name)
                    quantity_key = _norm_component_key(component_name)
                    expected_unit = _component_base_unit(component_item)
                    validated_qty = _validate_compound_quantity(
                        raw_quantities_by_key.get(quantity_key),
                        raw_units_by_key.get(quantity_key),
                        expected_unit,
                    )
                    if validated_qty is not None:
                        component_quantities[quantity_key] = validated_qty
                        # expected_unit is guaranteed non-None here — see the
                        # expected_unit is None -> return None branch of
                        # _validate_compound_quantity.
                        assert expected_unit is not None
                        component_quantity_units[quantity_key] = expected_unit
                    resolved_component_items.append(
                        CompoundComponent(
                            pantry_item_id=component_item.id,
                            name=component_item.name,
                            base_unit=expected_unit,
                            suggested_quantity=validated_qty,
                        )
                    )
                # Two model-supplied names (e.g. "milk" and "whole milk") can
                # normalize onto the same pantry row. Keep the prose list
                # (resolved_components) echoing the model verbatim, but dedupe
                # the structured items by pantry_item_id, first one wins — a
                # duplicate here would double-deduct what the user types.
                resolved_component_items = _dedupe_keep_first(
                    resolved_component_items, lambda c: c.pantry_item_id
                )

                if all_present and resolved_components:
                    compound_suggestions.append(
                        CompoundSuggestion(
                            ingredient_name=entry.ingredient_name,
                            components=resolved_components,
                            note=entry.compound_note,
                            component_items=resolved_component_items,
                            component_quantities=component_quantities or None,
                            component_quantity_units=component_quantity_units or None,
                        )
                    )
                    # When a compound suggestion was accepted, do NOT also record a
                    # "no match" note: the suggestion already tells the cook what to
                    # do, and a contradictory note alongside it would be confusing.
                    # If the compound validation failed (all_present=False) we fall
                    # through to record whatever substitution_note the model gave.
                    continue

        # The model's own verdict on an ingredient it could not place — the most
        # useful note of the three, previously thrown away despite the prompt asking
        # for it. Also reached when a compound suggestion was low-confidence or had
        # a missing component.
        _note(entry, entry.substitution_note)

    # Dedupe by normalized ingredient_name, keeping the first. The LLM batch
    # call can return two result entries for the same ingredient (a genuinely
    # anomalous but observed response shape), and this loop appends one
    # CompoundSuggestion per entry with no key of its own. The frontend
    # renders inputs from only the first matching suggestion but keys its
    # deduction merge by (ingredient_name, pantry_item_id) across the WHOLE
    # list — so an undeduped second suggestion here would double-deduct
    # whatever quantity the user types, even though they only ever see one
    # input (round-4 review on PR #616).
    compound_suggestions = _dedupe_keep_first(
        compound_suggestions, lambda s: _normalize_ingredient_name(s.ingredient_name)
    )

    _alias_cache_put(cache_key, (aliases, notes, compound_suggestions), now)
    return aliases, notes, compound_suggestions


async def match_ingredients_with_llm(
    recipe_id: str,
    recipe_title: str,
    recipe_ingredients: list[dict[str, Any]],
    pantry_items: list[PantryItem],
    ai_manager: Any,
) -> CookProposal:
    """match_ingredients() with an LLM tier for whatever the synonym table misses.

    Deterministic matching stays the fast path: ingredients it resolves never reach
    the model, so a fully-matched recipe adds no latency and no API call. Only the
    leftovers are sent, in one batch.

    The aliases are fed into a single match_ingredients() pass rather than being
    matched separately afterwards, so substitutes share the same per-pantry-item
    consumption accounting as direct matches.

    Compound suggestions and missing notes are both threaded onto the returned
    proposal, but only for ingredients that actually ended up in proposal.missing —
    an ingredient resolved deterministically must not carry contradictory output.
    """
    unmatched = _unmatched_ingredient_names(recipe_ingredients, pantry_items)

    aliases: dict[str, ResolvedAlias] = {}
    notes: dict[str, str] = {}
    raw_compound_suggestions: list[CompoundSuggestion] = []
    if unmatched:
        aliases, notes, raw_compound_suggestions = await resolve_aliases_with_llm(
            unmatched, pantry_items, ai_manager
        )

    proposal = match_ingredients(
        recipe_id=recipe_id,
        recipe_title=recipe_title,
        recipe_ingredients=recipe_ingredients,
        pantry_items=pantry_items,
        aliases=aliases,
    )

    # Both notes and compound suggestions are filtered against the final missing list:
    # an ingredient the model declined may still have been resolved deterministically,
    # and a note or suggestion about it would contradict the match shown.
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
            s for s in raw_compound_suggestions
            if s.ingredient_name.lower() in still_missing
        ]
        if filtered_suggestions:
            proposal = proposal.model_copy(
                update={"compound_suggestions": filtered_suggestions}
            )

    return proposal
