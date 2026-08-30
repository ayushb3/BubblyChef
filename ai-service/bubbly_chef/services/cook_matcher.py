"""Cook matcher service.

Given a list of recipe ingredients and a user's pantry items, produces a
CookProposal that shows which ingredients can be deducted, which are
insufficient, which have unit conflicts, and which are missing entirely.
"""

from __future__ import annotations

import logging
import re
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, Field

from bubbly_chef.domain.normalizer import normalize_food_name, normalize_to_base_unit
from bubbly_chef.models.cook import CompoundSuggestion, CookProposal, IngredientMatch
from bubbly_chef.models.pantry import PantryItem

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
# DB — the caller (match_ingredients_with_llm) passes only that user's items,
# so the name-fingerprint is inherently user-scoped.  No explicit user_id
# thread-through is needed.

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


def _alias_cache_key(
    unmatched_names: list[str],
    pantry_items: list[PantryItem],
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Build a stable, user-scoped cache key for alias resolution."""
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
    # Store a copy: the caller keeps using the collections it passed in, and a
    # mutation there must not reach into the shared entry.
    _alias_cache[key] = (_copy_alias_result(result), now)
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


class _LLMMatchBatch(BaseModel):
    """Envelope so the whole unmatched set resolves in a single call."""

    results: list[_LLMIngredientMatch] = Field(default_factory=list)


_SUBSTITUTION_PROMPT = """You are helping a home cook decide whether anything in their \
pantry can stand in for recipe ingredients they appear to be missing.

Recipe ingredients with no pantry match:
{unmatched}

Everything currently in their pantry:
{pantry}

For each unmatched ingredient:

1. PREFER a single pantry item when one genuinely works:
   - Use match_type "exact" when it is the same ingredient under a different name \
(scallion and green onion are the same; pecorino romano and parmesan are NOT).
   - Use match_type "substitute" when a different ingredient would still work; note \
briefly what changes — flavour, texture, sweetness.
   - Set best_match to the pantry item name. Leave compound_components null.

2. If NO single item works but 2-3 pantry items COMBINED can approximate the missing \
ingredient, set match_type "none", best_match null, and populate compound_components \
with the pantry item names AND compound_note with a short instruction (under 20 words).
   Example: heavy cream is missing, pantry has butter, milk, and flour →
     compound_components: ["butter", "milk", "flour"]
     compound_note: "Melt butter, whisk in flour, stir in milk until thickened"
   ONLY list items the user actually has. Do not invent ingredients.

3. If nothing works, set match_type "none", best_match null, compound_components null.

Do not suggest a swap that would change the dish into something else, and do not treat \
derivatives as interchangeable: lemon juice cannot replace lemon zest, and vice versa. \
Set confidence below {threshold} for anything you are unsure about.

Always fill substitution_note, including when match_type is "none" — there, say what the \
cook should do about it: whether the dish works without it, what it costs them, or what \
they would need to buy. "No good stand-in; the sauce will be thinner" is more use than \
silence.

Keep substitution_note and compound_note under 20 words each. Return one result per \
unmatched ingredient."""

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

    # Build a lookup: normalized_name -> PantryItem
    pantry_index: dict[str, PantryItem] = {}
    for item in pantry_items:
        key = _normalize_ingredient_name(item.name)
        # Keep the item with the highest quantity if there are duplicates.
        # NOTE: this discards the other rows' quantities, so a pantry holding
        # 2 onions + 3 onions as separate rows reports 3 available rather than 5.
        # Fixing that needs a match to span multiple rows (and a deduction plan
        # per row), which is a contract change reaching the frontend — tracked
        # separately rather than bolted on here.
        if key not in pantry_index or item.quantity > pantry_index[key].quantity:
            pantry_index[key] = item

    matches: list[IngredientMatch] = []
    missing: list[str] = []
    unit_conflicts: list[dict[str, str]] = []

    # Base-unit quantity already claimed from each pantry row by earlier ingredients
    # in THIS recipe, keyed by pantry item id.
    #
    # Two recipe lines can resolve to the same pantry row — either as literal
    # duplicates ("onion" twice) or because normalize_food_name() collapses
    # synonyms (cheddar and parmesan both become "cheese"). Without this running
    # total each line compares against the row's untouched quantity, so both are
    # reported "ready" even when the row only covers one of them, and the confirm
    # step then deducts twice.
    consumed: dict[Any, float] = {}

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

        # --- Find pantry match ---
        pantry_item = pantry_index.get(norm_name)
        alias: ResolvedAlias | None = None

        if pantry_item is None and aliases:
            alias = aliases.get(norm_name)
            if alias is not None:
                pantry_item = pantry_index.get(alias.pantry_name)
                if pantry_item is None:
                    # Alias named an item that is not actually in the pantry.
                    alias = None

        if pantry_item is None:
            # No match at all
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

        # What this row still has after earlier ingredients in this recipe took
        # their share.
        already_claimed = consumed.get(pantry_item.id, 0.0)

        # --- No quantity on recipe ingredient → can't deduct, just note as ready ---
        if ing_qty is None or ing_unit is None:
            unclaimed = pantry_item.quantity_base
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
                    base_unit=pantry_item.unit_base,
                    status=ok_status,
                    match_type=match_type,
                    substitution_note=note,
                )
            )
            continue

        # --- Resolve the pantry side first ---
        # The recipe line is then converted toward whatever unit the pantry row
        # actually uses, which is the only unit the deduction can be expressed in.
        pantry_base_qty = pantry_item.quantity_base
        pantry_base_unit = pantry_item.unit_base

        # If pantry item lacks base values, try to derive them. Normalized name
        # here, since the registry is keyed by canonical names.
        if pantry_base_qty is None or pantry_base_unit is None:
            pantry_base_qty, pantry_base_unit = normalize_to_base_unit(
                name=_normalize_ingredient_name(pantry_item.name),
                quantity=pantry_item.quantity,
                unit=pantry_item.unit,
            )

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
            unit=ing_unit,
            target_unit=pantry_base_unit,
        )

        # --- Unit conflict: can't convert either side ---
        if req_base_qty is None or pantry_base_qty is None or req_base_unit != pantry_base_unit:
            conflict_info = {
                "ingredient": raw_name,
                "recipe_unit": ing_unit,
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
                    base_unit=pantry_base_unit or ing_unit,
                    status="unit_conflict",
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

        if available_base_qty >= req_base_qty:
            consumed[pantry_item.id] = already_claimed + req_base_qty
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
        else:
            shortfall = req_base_qty - available_base_qty
            consumed[pantry_item.id] = already_claimed + available_base_qty
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
    cache_key = _alias_cache_key(unmatched_names, pantry_items)
    cached = _alias_cache_get(cache_key, now)
    if cached is not None:
        logger.debug("resolve_aliases_with_llm: cache hit, skipping LLM call")
        return cached

    pantry_by_norm = {_normalize_ingredient_name(i.name): i for i in pantry_items}

    prompt = _SUBSTITUTION_PROMPT.format(
        unmatched="\n".join(f"- {n}" for n in unmatched_names),
        pantry="\n".join(f"- {i.name}" for i in pantry_items),
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
                    resolved_components.append(pantry_by_norm[comp_norm].name)

                if all_present and resolved_components:
                    compound_suggestions.append(
                        CompoundSuggestion(
                            ingredient_name=entry.ingredient_name,
                            components=resolved_components,
                            note=entry.compound_note,
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
