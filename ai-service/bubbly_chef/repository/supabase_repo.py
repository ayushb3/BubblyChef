"""Supabase repository for the AI microservice.

Replaces SQLiteRepository. Uses supabase-py with the service_role key
(bypasses RLS) and takes user_id as a parameter on every method.
"""

import logging
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any, Literal, cast
from uuid import UUID

from postgrest.types import JSON
from supabase import Client, create_client

from bubbly_chef.config import settings
from bubbly_chef.domain.lots import lot_base, lot_food_key, soonest_first_key
from bubbly_chef.domain.normalizer import (
    normalize_food_name,
    normalize_to_base_unit,
    normalize_unit,
)
from bubbly_chef.models.cook import MealCookClaim
from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.models.recipe import RecipeCard
from bubbly_chef.models.session import (
    ConversationSession,
    PendingProposalMemory,
    SessionContext,
    SessionMode,
)
from bubbly_chef.tools.expiry import get_expiry_heuristics

logger = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"[a-z0-9]+")

# #384: how many recent conversation_history messages get_history() returns
# by default. 40 messages is ~20 user/assistant exchanges — enough for a
# real multi-step cooking conversation without summarization, which is a
# separate, later piece of work.
_HISTORY_DEFAULT_LIMIT = 40

# Filler words that carry no dish-identifying signal in a natural-language
# lookup request ("show me my saved butter chicken", "do you have a recipe
# for pasta"). Left in, these spuriously overlap with unrelated recipes'
# descriptions/tags and pad or corrupt the ranked results. Always stripped
# from the query side of search_saved_recipes. For scoring, title/
# description/tags text is tokenized as written (`_tokenize`) — but title,
# description, and tags text is *also* run through this stopword-stripped
# tokenizer (`_tokenize_query`) for the exact-match short-circuit and the
# full-query-coverage cutoff, so a saved "Chicken and Rice" matches a query
# of "chicken rice" there even though "and" still counts toward its title's
# score, and a description/tag can cover a query token its title is missing
# without needing the stopword to line up either.
_QUERY_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "my",
        "me",
        "i",
        "you",
        "your",
        "we",
        "it",
        "that",
        "this",
        "those",
        "these",
        "do",
        "does",
        "did",
        "have",
        "has",
        "had",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "can",
        "could",
        "would",
        "will",
        "should",
        "show",
        "find",
        "get",
        "give",
        "look",
        "up",
        "pull",
        "make",
        "made",
        "want",
        "need",
        "like",
        "please",
        "saved",
        "save",
        "recipe",
        "recipes",
        "for",
        "of",
        "on",
        "in",
        "to",
        "and",
        "or",
        "with",
        "from",
        "again",
        "last",
        "week",
        "month",
        "year",
        "time",
        "what",
        "which",
        # Memory/history phrasing ("find the one we made before", "search
        # your memory for...") names when, not what.
        "before",
        "earlier",
        "ago",
        "previously",
        "remember",
        "memory",
        "history",
        "search",
        "cooked",
        "some",
        "any",
        "one",
        "another",
    }
)


def _tokenize(text: str) -> list[str]:
    """Lowercase and split into alphanumeric tokens for overlap scoring."""
    return _TOKEN_RE.findall(text.lower())


def _tokenize_query(text: str) -> list[str]:
    """Tokenize a free-text lookup query, dropping stopword filler.

    A saved-recipe lookup query is a full sentence ("show me my saved butter
    chicken"), not a keyword. Without stripping filler words, generic tokens
    like "recipe"/"for"/"a"/"do" spuriously overlap against unrelated recipes'
    descriptions and tags, padding or corrupting the ranked match list — see
    issue #533.
    """
    return [tok for tok in _tokenize(text) if tok not in _QUERY_STOPWORDS]


def lookup_query_terms(text: str) -> list[str]:
    """The dish-identifying words in a saved-recipe lookup request.

    Empty when the request names no dish at all ("show me my saved recipes",
    "what recipes do I have saved") — a request to browse the library, which
    `search_saved_recipes` would otherwise answer with zero matches.
    """
    return _tokenize_query(text)


def _as_row(value: JSON) -> dict[str, Any]:
    """Narrow one Supabase result row from the recursive `JSON` union to a dict.

    supabase-py types every row of `result.data` as `JSON` — a
    `bool | str | int | float | Sequence[JSON] | Mapping[str, JSON] | None`
    union — because postgrest can't know our schema. A `.select()` over a
    table can't return a scalar row, so the "not actually a dict" case is
    dead by construction; a runtime `isinstance` guard here would be
    unreachable and untestable. `cast`, unlike `# type: ignore`, keeps every
    downstream `row["..."]` / `row.get(...)` access type-checked.
    """
    return cast("dict[str, Any]", value)


def _as_rows(value: list[JSON]) -> list[dict[str, Any]]:
    """Narrow a Supabase result list (`result.data`) to a list of dict rows.

    Same reasoning as `_as_row`. A per-row `isinstance` guard would also run
    on every pantry fetch for a condition PostgREST can't produce.
    """
    return cast("list[dict[str, Any]]", value)


# A base amount below this (a thousandth of a gram/ml/piece) is rounding residue,
# not stock: the row is treated as used up.
_USED_UP_BASE_EPSILON = 1e-3
# A base-unit remainder below this is float noise, not stock left to carry (#356).
_LOT_EPSILON = 1e-6


@dataclass(frozen=True)
class PantryApplyResult:
    """Outcome of `apply_pantry_proposal_detailed` (#444).

    `failed_indices` are positions in the `actions` list that call received, and
    `failed_errors` maps each of those positions to its error string. The route
    reads these instead of regex-ing the error strings (the generic
    `Error processing {...}` message carries no parseable name).
    """

    applied: int
    failed: int
    errors: list[str]
    affected_item_ids: list[UUID]
    failed_indices: list[int] = field(default_factory=list)
    failed_errors: dict[int, str] = field(default_factory=dict)


class _PantryUsePlan:
    """What one chat `use` action does to a pantry row (#677).

    Exactly one of three shapes: `refusal` set (the row is untouched and the
    action fails with that message), `updates` None with no refusal (the row is
    used up and gets deleted), or `updates` holding the payload to write.
    """

    __slots__ = ("refusal", "updates")

    def __init__(
        self, updates: dict[str, Any] | None = None, refusal: str | None = None
    ) -> None:
        self.updates = updates
        self.refusal = refusal


def _display_subtraction_plan(
    existing: PantryItem, name: str, category: str, used_qty: float
) -> _PantryUsePlan:
    """Subtract `used_qty` from the displayed quantity, in the row's own unit,
    and re-derive the base from what remains (nulls when it can't be)."""
    new_qty = max(0.0, float(existing.quantity) - used_qty)
    if new_qty <= 0:
        return _PantryUsePlan()
    qb, ub = normalize_to_base_unit(
        name=name, quantity=new_qty, unit=existing.unit, category=category
    )
    return _PantryUsePlan(updates={"quantity": new_qty, "quantity_base": qb, "unit_base": ub})


def _plan_pantry_use(
    existing: PantryItem, name: str, action: dict[str, Any]
) -> _PantryUsePlan:
    """Plan a chat `use` so the row's base stays in step with its display amount.

    Same unit: plain display subtraction. Different units: subtract in the base
    unit and scale the display amount proportionally (as `deduct_pantry_item`
    does), so "used 2 eggs" from "1 dozen" leaves 0.83 dozen, not nothing.
    When no base can be worked out, a default/count-like unit falls back to
    display subtraction and a real unit the user said is refused.
    """
    category = existing.category.value
    used_qty = float(action.get("quantity", 1))
    used_unit = str(action.get("unit") or existing.unit)

    if normalize_unit(used_unit) == normalize_unit(existing.unit):
        return _display_subtraction_plan(existing, name, category, used_qty)

    # An empty row (a cook deducts to 0.0 without deleting) has nothing to subtract
    # from and no base to scale by. Using it up is a delete, as it always was.
    quantity = float(existing.quantity)
    if quantity <= 0:
        return _PantryUsePlan()

    # The row's base comes from the displayed amount first: stored bases can be
    # stale from the old `use` path, and the display amount is what the user sees.
    row_base, row_unit = normalize_to_base_unit(
        name=name, quantity=quantity, unit=existing.unit, category=category
    )
    # Base units per one displayed unit (12 for a dozen of eggs), exact and
    # independent of how the display amount was rounded.
    unit_factor = row_base / quantity if row_base is not None and row_base > 0 else None
    stored_base = float(existing.quantity_base) if existing.quantity_base is not None else None
    if row_base is not None and stored_base is not None and existing.unit_base == row_unit:
        # `pantry_items.quantity` is NUMERIC(10,2), so the displayed amount is off by up
        # to 0.005 display units and re-deriving the base from it drifts a little on
        # every use (a dozen used 2 at a time reads 0.83 dozen, so the next "used 2"
        # would leave 7.96). A stored base that agrees with the display within that
        # rounding is the exact one -- keep it. One that disagrees by more is stale
        # drift from the old `use` path, and the display (what the user sees) wins.
        rel_tol = max(1e-3, 0.0051 / quantity)
        if abs(stored_base - row_base) <= row_base * rel_tol:
            row_base = stored_base
    elif row_base is None and stored_base is not None and existing.unit_base:
        row_base, row_unit = stored_base, existing.unit_base
    used_base: float | None = None
    if row_unit:
        used_base, _ = normalize_to_base_unit(
            name=name, quantity=used_qty, unit=used_unit, category=category, target_unit=row_unit
        )

    if row_base is not None and row_base > 0 and row_unit and used_base is not None:
        new_base = max(0.0, row_base - used_base)
        # Scale the display from the exact unit factor when there is one, so the
        # rounded display amount doesn't compound its error; otherwise proportionally.
        # Rounded to 2 places, as the column stores it.
        new_qty = round(
            new_base / unit_factor if unit_factor else quantity * new_base / row_base, 2
        )
        # Used up: nothing left in the base, a sliver below any real amount, or a
        # display quantity that rounds to zero.
        if new_base < _USED_UP_BASE_EPSILON or new_qty <= 0:
            return _PantryUsePlan()
        return _PantryUsePlan(
            updates={"quantity": new_qty, "quantity_base": new_base, "unit_base": row_unit}
        )

    if normalize_unit(str(action.get("unit") or "")) in {"item", "count"}:
        return _display_subtraction_plan(existing, name, category, used_qty)
    return _PantryUsePlan(
        refusal=f"Units don't match ({used_unit} vs {existing.unit}), edit the unit for: {name}"
    )


def _parse_meal_cook_timestamp(value: Any) -> datetime | None:
    """Parse a `meals.last_cooked_at` TIMESTAMPTZ value, or `None`.

    `None` when `value` is `None`, not a string, or not ISO-8601 -- the
    30-second `claim_meal_cook` window then falls back to "now" (§2c),
    which classifies a row with no timestamp as freshly claimed rather than
    raising on a shape a real Postgres row should never produce.
    """
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


class SupabaseRepository:
    """Supabase-backed repository for the AI microservice."""

    def __init__(self) -> None:
        self.client: Client = create_client(
            settings.supabase_url,
            settings.supabase_secret_key,
        )

    async def initialize(self) -> None:
        """No-op for Supabase — schema managed via migrations."""
        logger.info("SupabaseRepository initialized (schema managed externally)")

    async def close(self) -> None:
        """No-op for Supabase — HTTP client, no persistent connection."""
        pass

    # =========================================================================
    # Pantry operations (read-only for recipe grounding)
    # =========================================================================

    def _row_to_pantry_item(self, row: dict[str, Any]) -> PantryItem:
        from datetime import date

        expiry = None
        if row.get("expiry_date"):
            expiry = date.fromisoformat(row["expiry_date"])

        return PantryItem(
            id=row["id"],
            name=row["name"],
            category=FoodCategory(row.get("category", "other")),
            storage_location=StorageLocation(row.get("location", "pantry")),
            quantity=float(row.get("quantity", 1.0)),
            unit=row.get("unit", "item"),
            quantity_base=float(row["quantity_base"]) if row.get("quantity_base") is not None else None,
            unit_base=row.get("unit_base"),
            expiry_date=expiry,
            estimated_expiry=bool(row.get("estimated_expiry") or False),
            slot_index=row.get("slot_index"),
            created_at=datetime.fromisoformat(row["added_at"])
            if row.get("added_at")
            else datetime.now(UTC),
            updated_at=datetime.fromisoformat(row["updated_at"])
            if row.get("updated_at")
            else datetime.now(UTC),
        )

    async def get_all_pantry_items(self, user_id: str) -> list[PantryItem]:
        result = (
            self.client.table("pantry_items")
            .select("*")
            .eq("user_id", user_id)
            .order("name")
            .execute()
        )
        return [self._row_to_pantry_item(r) for r in _as_rows(result.data)]

    async def get_expiring_items(self, user_id: str, days: int = 3) -> list[PantryItem]:
        from datetime import date, timedelta

        future = (date.today() + timedelta(days=days)).isoformat()
        result = (
            self.client.table("pantry_items")
            .select("*")
            .eq("user_id", user_id)
            .not_("expiry_date", "is", "null")
            .lte("expiry_date", future)
            .order("expiry_date")
            .execute()
        )
        return [self._row_to_pantry_item(r) for r in _as_rows(result.data)]

    async def find_similar_item(
        self, user_id: str, name: str
    ) -> PantryItem | None:
        """The row a by-name action (chat use/update/remove) should act on.

        Several rows can hold the same food as separate lots (#356), so this
        picks deterministically: a lot with stock before an empty one, then the
        soonest expiry (undated last), then the older purchase.
        """
        normalized = name.lower().strip()
        result = (
            self.client.table("pantry_items")
            .select("*")
            .eq("user_id", user_id)
            .eq("name_normalized", normalized)
            .execute()
        )
        lots = [self._row_to_pantry_item(r) for r in _as_rows(result.data)]
        if not lots:
            return None
        return min(lots, key=soonest_first_key)

    async def add_pantry_item(self, user_id: str, item: PantryItem) -> PantryItem:
        data = {
            "user_id": user_id,
            "name": item.name,
            "name_normalized": item.name.lower().strip(),
            "category": item.category.value if hasattr(item.category, "value") else str(item.category),
            "location": item.storage_location.value
            if hasattr(item.storage_location, "value")
            else str(item.storage_location),
            "quantity": float(item.quantity),
            "unit": item.unit,
            "quantity_base": float(item.quantity_base) if item.quantity_base is not None else None,
            "unit_base": item.unit_base,
            "expiry_date": item.expiry_date.isoformat() if item.expiry_date else None,
            "estimated_expiry": bool(item.estimated_expiry),
            "slot_index": item.slot_index,
        }
        result = self.client.table("pantry_items").insert(data).execute()
        return self._row_to_pantry_item(_as_row(result.data[0]))

    async def update_pantry_item(
        self, user_id: str, item_id: str, updates: dict[str, Any]
    ) -> PantryItem | None:
        # Map storage_location -> location
        if "storage_location" in updates:
            updates["location"] = updates.pop("storage_location")
        if "name" in updates:
            updates["name_normalized"] = updates["name"].lower().strip()
        # A caller-supplied expiry_date is a real date, not a heuristic guess —
        # clear the estimated_expiry flag unless the caller explicitly set it
        # themselves in this same update (see #182 follow-up).
        if "expiry_date" in updates and "estimated_expiry" not in updates:
            updates["estimated_expiry"] = False

        result = (
            self.client.table("pantry_items")
            .update(updates)
            .eq("id", item_id)
            .eq("user_id", user_id)
            .execute()
        )
        if result.data:
            return self._row_to_pantry_item(_as_row(result.data[0]))
        return None

    async def delete_pantry_item(self, user_id: str, item_id: str) -> bool:
        result = (
            self.client.table("pantry_items")
            .delete()
            .eq("id", item_id)
            .eq("user_id", user_id)
            .execute()
        )
        return len(result.data) > 0

    # -------------------------------------------------------------------------
    # Expiry backfill (#183). One-off maintenance, so unlike every other method
    # here these are NOT scoped to a single user_id: the script walks all users'
    # rows with the service role. Each write is conditional on the row's current
    # state so a user edit that lands mid-run is never overwritten.
    # -------------------------------------------------------------------------

    async def list_pantry_missing_expiry(
        self, after_id: str | None, limit: int
    ) -> list[dict[str, Any]]:
        """One keyset page (ordered by id) of rows whose expiry_date is NULL.

        Returns only the columns the estimator needs. `user_id` is deliberately
        not selected so nothing downstream can log it.
        """
        query = (
            self.client.table("pantry_items")
            .select("id,name,category,location,added_at")
            .is_("expiry_date", "null")
            .order("id")
            .limit(limit)
        )
        if after_id is not None:
            query = query.gt("id", after_id)
        return _as_rows(query.execute().data)

    async def set_backfilled_expiry(self, row_id: str, expiry: date) -> bool:
        """Set an estimated expiry on a row, only if it still has none.

        Returns False when the row gained a date in the meantime (or vanished).
        """
        result = (
            self.client.table("pantry_items")
            .update({"expiry_date": expiry.isoformat(), "estimated_expiry": True})
            .eq("id", row_id)
            .is_("expiry_date", "null")
            .execute()
        )
        return len(result.data) > 0

    async def revert_backfilled_expiry(self, row_id: str, expected: date) -> bool:
        """Undo `set_backfilled_expiry`, only while the row still holds it.

        Matches on the exact date AND `estimated_expiry = true`: a row the user
        has since edited (which clears the flag) is left alone.
        """
        result = (
            self.client.table("pantry_items")
            .update({"expiry_date": None, "estimated_expiry": False})
            .eq("id", row_id)
            .eq("expiry_date", expected.isoformat())
            .eq("estimated_expiry", True)
            .execute()
        )
        return len(result.data) > 0

    async def count_pantry_items(self, user_id: str) -> int:
        result = (
            self.client.table("pantry_items")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .execute()
        )
        return result.count or 0

    # =========================================================================
    # apply_pantry_proposal (complex write logic)
    # =========================================================================

    async def apply_pantry_proposal(
        self, user_id: str, actions: list[dict[str, Any]]
    ) -> tuple[int, int, list[str], list[UUID]]:
        """Apply reviewed pantry actions; returns (applied, failed, errors,
        affected_item_ids). #541: affected_item_ids is every pantry row this
        call created, updated, or deleted -- ApplyResponse was always
        dropping this on the floor, so a caller (the bubbles ledger) had no
        way to award credit for items that did apply on a partial failure.

        Thin wrapper over `apply_pantry_proposal_detailed` that keeps the
        4-tuple signature the scan confirm and several tests depend on.
        """
        result = await self.apply_pantry_proposal_detailed(user_id, actions)
        return result.applied, result.failed, result.errors, result.affected_item_ids

    async def apply_pantry_proposal_detailed(
        self, user_id: str, actions: list[dict[str, Any]]
    ) -> PantryApplyResult:
        """`apply_pantry_proposal`, plus which action positions failed (#444)."""
        applied = 0
        failed = 0
        errors: list[str] = []
        affected_item_ids: list[UUID] = []
        failed_indices: list[int] = []
        failed_errors: dict[int, str] = {}

        def _record_failure(index: int, message: str) -> None:
            nonlocal failed
            errors.append(message)
            failed += 1
            failed_indices.append(index)
            failed_errors[index] = message

        for index, action in enumerate(actions):
            try:
                action_type = action.get("action", "add")
                name = action.get("name", "")

                if action_type == "add":
                    # #356 (Option A): every add is its own lot. A food already in the
                    # pantry is NOT merged into: merging overwrote nothing but silently
                    # gave the new purchase the old lot's expiry, and summed quantities
                    # across units without converting (#683, "1 dozen" onto "6 item" was
                    # 7). Separate rows keep each lot's own date and unit, and the cook
                    # matcher sums them through the base unit.
                    # F5: pass quantity_base and unit_base to PantryItem constructor
                    item_category = FoodCategory(action.get("category", "other"))
                    item_location = StorageLocation(action.get("location", "pantry"))
                    # #158: an item added via scan-confirm or chat lands here with
                    # no expiry unless we set one. Honour an explicit date from the
                    # action; otherwise estimate from category/location/name so the
                    # expiry→cook loop actually lights up (previously hardcoded None).
                    raw_expiry = action.get("expiry_date")
                    # #182: track whether expiry_date was heuristically guessed
                    # vs. explicit (from label/receipt or user entry) so the UI
                    # can distinguish the two. An explicit "estimated_expiry" on
                    # the action always wins (the caller — e.g. receipt/product
                    # ingest — already knows); otherwise it follows raw_expiry:
                    # a caller-supplied date is not estimated, a heuristically
                    # computed one is.
                    if raw_expiry:
                        item_expiry = (
                            date.fromisoformat(raw_expiry)
                            if isinstance(raw_expiry, str)
                            else raw_expiry
                        )
                        item_estimated_expiry = action.get("estimated_expiry", False)
                    else:
                        item_expiry, heuristic_estimated = (
                            get_expiry_heuristics().estimate_expiry(
                                category=item_category,
                                storage=item_location,
                                name=name,
                            )
                        )
                        item_estimated_expiry = action.get(
                            "estimated_expiry", heuristic_estimated
                        )
                    item_qty = float(action.get("quantity", 1))
                    item_unit = action.get("unit", "item")
                    item_qty_base = action.get("quantity_base")
                    item_unit_base = action.get("unit_base")
                    if item_qty_base is None or item_unit_base is None:
                        # The lot needs a base of its own: availability and the cook
                        # deduction sum lots through it, and a dozen next to loose
                        # items only adds up in "count".
                        item_qty_base, item_unit_base = normalize_to_base_unit(
                            name=lot_food_key(name),
                            quantity=item_qty,
                            unit=item_unit,
                            category=item_category.value,
                        )
                    item = PantryItem(
                        name=name,
                        category=item_category,
                        storage_location=item_location,
                        quantity=item_qty,
                        unit=item_unit,
                        quantity_base=item_qty_base,
                        unit_base=item_unit_base,
                        expiry_date=item_expiry,
                        estimated_expiry=bool(item_estimated_expiry),
                    )
                    created = await self.add_pantry_item(user_id, item)
                    affected_item_ids.append(created.id)
                    applied += 1

                elif action_type in ("update", "use"):
                    existing = await self.find_similar_item(user_id, name)
                    if not existing:
                        _record_failure(index, f"Item not found: {name}")
                        continue
                    if action_type == "use":
                        plan = _plan_pantry_use(existing, name, action)
                        if plan.refusal is not None:
                            _record_failure(index, plan.refusal)
                            continue
                        if plan.updates is None:
                            await self.delete_pantry_item(user_id, str(existing.id))
                            affected_item_ids.append(existing.id)
                        else:
                            updated = await self.update_pantry_item(
                                user_id, str(existing.id), plan.updates
                            )
                            affected_item_ids.append(updated.id if updated else existing.id)
                    else:
                        updates = {
                            k: v
                            for k, v in action.items()
                            if k not in ("action", "name") and v is not None
                        }
                        # #677: a new amount or unit must carry a current base, or the
                        # next cook deducts from the stale one. An update with neither
                        # key (a location-only edit) stays base-neutral. None is written
                        # explicitly when the base can't be derived.
                        if "quantity" in updates or "unit" in updates:
                            qb, ub = normalize_to_base_unit(
                                name=str(updates.get("name", name)),
                                quantity=float(updates.get("quantity", existing.quantity)),
                                unit=str(updates.get("unit", existing.unit)),
                                category=str(updates.get("category", existing.category.value)),
                            )
                            updates["quantity_base"] = qb
                            updates["unit_base"] = ub
                        updated = await self.update_pantry_item(
                            user_id, str(existing.id), updates
                        )
                        affected_item_ids.append(updated.id if updated else existing.id)
                    applied += 1

                elif action_type == "remove":
                    existing = await self.find_similar_item(user_id, name)
                    if existing:
                        await self.delete_pantry_item(user_id, str(existing.id))
                        affected_item_ids.append(existing.id)
                        applied += 1
                    else:
                        _record_failure(index, f"Item not found for removal: {name}")

            except Exception as e:
                _record_failure(index, f"Error processing {action}: {e}")

        return PantryApplyResult(
            applied=applied,
            failed=failed,
            errors=errors,
            affected_item_ids=affected_item_ids,
            failed_indices=failed_indices,
            failed_errors=failed_errors,
        )

    # =========================================================================
    # Recipe operations
    # =========================================================================

    async def add_recipe(self, user_id: str, recipe: RecipeCard) -> RecipeCard:
        data = {
            "user_id": user_id,
            "title": recipe.title,
            "description": recipe.description,
            "ingredients": [i.model_dump() for i in recipe.ingredients]
            if recipe.ingredients
            else [],
            "instructions": recipe.instructions or [],
            "steps": [s.model_dump(mode="json") for s in recipe.steps] if recipe.steps else None,
            "prep_time_minutes": recipe.prep_time_minutes,
            "cook_time_minutes": recipe.cook_time_minutes,
            "total_time_minutes": recipe.total_time_minutes,
            "servings": recipe.servings,
            "tags": recipe.tags or [],
            "difficulty": recipe.difficulty,
            "cuisine": recipe.cuisine,
            "meal_type": recipe.meal_type,
            "source_type": recipe.source_type or "chat",
            "is_draft": recipe.is_draft if hasattr(recipe, "is_draft") else False,
        }
        self.client.table("recipes").insert(data).execute()
        return recipe  # Return as-is; ID comes from Supabase

    async def get_user_recipes(
        self, user_id: str, limit: int = 100
    ) -> list[dict[str, Any]]:
        """Return raw rows for a user's non-draft (saved) recipes, newest first.

        The same set the recipe library shows: `is_draft = false` rows only, so
        a generated-but-never-saved recipe can't surface in the saved lookup or
        the dashboard suggestion (#662).

        Raw dicts, like `get_recipe` — callers that need `RecipeCard` shape
        construct it themselves. Used by the dashboard daily endpoint
        (#225, #168) to rank the user's own saved recipes; a candidate list
        that never leaves this table is what keeps the suggestion from ever
        naming a recipe the user doesn't actually have.
        """
        result = (
            self.client.table("recipes")
            .select("*")
            .eq("user_id", user_id)
            .eq("is_draft", False)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        # supabase-py types row data as list[JSON]; every row from a `.select("*")`
        # on this table is actually an object, matching every other raw-dict
        # accessor in this class (e.g. get_recipe below).
        return _as_rows(result.data or [])

    async def get_recent_cuisines(self, user_id: str, sample: int = 5) -> list[str]:
        """The user's top-2 recent cuisines, lower-cased, most-cooked first
        (issue #651 spec §6) -- a soft, non-binding preference for meal/recipe
        prompts, never surfaced to the user as a profile.

        Non-draft recipes only, ranked by `coalesce(last_cooked_at,
        created_at)` desc. PostgREST can't order by a `coalesce` expression,
        so this runs two limited queries -- top `sample` by `last_cooked_at`
        desc (non-null only) and top `sample` by `created_at` desc -- merges
        them by id, and re-sorts by the coalesced key in Python. That's exact
        because a recipe's `last_cooked_at` is never earlier than its
        `created_at`, so the true top-`sample` set is always covered by the
        union of the two.

        Ties in cuisine count are broken toward the most recent, matching
        `Counter.most_common` over a newest-first list (ties resolve in
        first-encountered order). Returns `[]` on any error or when nothing
        qualifies. Never raises.
        """
        try:
            cooked_result = (
                self.client.table("recipes")
                .select("id,cuisine,last_cooked_at,created_at")
                .eq("user_id", user_id)
                .eq("is_draft", False)
                .not_.is_("last_cooked_at", "null")
                .order("last_cooked_at", desc=True)
                .limit(sample)
                .execute()
            )
            created_result = (
                self.client.table("recipes")
                .select("id,cuisine,last_cooked_at,created_at")
                .eq("user_id", user_id)
                .eq("is_draft", False)
                .order("created_at", desc=True)
                .limit(sample)
                .execute()
            )
        except Exception as e:
            logger.warning(f"Could not fetch recent cuisines for user {user_id}: {e}")
            return []

        rows_by_id: dict[Any, dict[str, Any]] = {}
        for row in _as_rows(cooked_result.data or []) + _as_rows(created_result.data or []):
            row_id = row.get("id")
            if row_id is not None:
                rows_by_id[row_id] = row

        def _coalesced_key(row: dict[str, Any]) -> str:
            return str(row.get("last_cooked_at") or row.get("created_at") or "")

        top_rows = sorted(rows_by_id.values(), key=_coalesced_key, reverse=True)[:sample]

        cuisines = [
            c.strip().lower()
            for row in top_rows
            if isinstance(c := row.get("cuisine"), str) and c.strip()
        ]
        if not cuisines:
            return []
        return [c for c, _ in Counter(cuisines).most_common(2)]

    async def search_saved_recipes(
        self, user_id: str, query: str, limit: int = 5
    ) -> list[dict[str, Any]]:
        """Rank a user's saved recipes against a free-text query.

        Full-text search (`text_search`) is deliberately not used: `tags` is a
        JSONB array, not a text column, so a single Postgres FTS query can't
        rank across title/description/tags together without a migration.
        Instead this reuses `get_user_recipes` for the candidate pool — already
        scoped `.eq("user_id", user_id)`, so another user's rows can never
        appear here — and tokenizes the query and each row's title,
        description, and tags in Python.

        Scored by token-overlap ratio *against the title length*, not raw
        match count: "chicken" against "Butter Chicken" (2 title tokens, 1
        match = 50%) must outrank "Chicken Stock Notes" (3 title tokens, 1
        match = 33%) — a raw-count score would tie them. Description and tag
        overlap contribute a smaller secondary score so a term that only
        appears there still surfaces the recipe, just ranked below a title
        match.

        Returns raw dicts, same shape convention as `get_recipe` /
        `get_user_recipes`, sorted by score descending and capped at `limit`.

        Exact-title short-circuit (issue #542 re-review): compares the
        *tokenized* query (`_tokenize_query` — lower-cased, punctuation
        stripped, stopwords removed) against each candidate's *tokenized
        title, also run through `_tokenize_query`* so both sides fold
        stopwords the same way — a saved "Chicken and Rice" must equal a
        query of "chicken rice", not silently miss because "and" survived
        on one side only. This resolves "butter chicken", "show me my saved
        butter chicken", "butter chicken?", and "chicken and rice" all to
        the token sets a bare title comparison would expect, and any of them
        short-circuits. The short-circuit only fires when exactly one
        *distinct* title token set equals the query's: if another
        candidate's title is a strict superset of the query tokens (e.g.
        querying "chicken" when both "Chicken" and "Roast Chicken" are
        saved), that other title is just as plausible a match, so the ranked
        list is returned instead — with the exact match still sorted first,
        since it scores highest.

        Full-query-coverage cutoff (issue #542 re-review, scope item 2):
        real saved titles are 2-5 tokens, so a multi-word query matching
        several titles on only one shared word — #542's actual padded-list
        complaint — needs a cutoff keyed to coverage, not a fixed score
        floor. Whenever at least one candidate's title contains *every*
        query token (a superset, same stopword-stripped tokenization as the
        short-circuit above — e.g. "Butter Chicken Curry" for query "butter
        chicken"), any other candidate that's missing at least one query
        token is dropped as padding, the same way the short-circuit above
        drops it when the coverage is an exact match rather than a
        superset.

        A row is protected from this cutoff only when its *combined*
        tokens — title, description, and tags, all run through
        `_tokenize_query` so they fold stopwords the same way the query
        does — cover every query token between them (PR #605 5th
        re-review: a description or tag that merely repeats a word the
        title already matched, e.g. "Chicken Tikka Masala Bowl" whose
        description says "a creamy chicken curry", is not independent
        signal and must not save the row; only a description or tag that
        supplies the token the title is *missing*, e.g. "Chicken Tikka"
        whose description mentions "butter", counts). For a single-token
        query, every containing title trivially has full coverage, so
        nothing is dropped for that case — anything containing the single
        token is just as plausible a match as any other.

        When this cutoff (or the short-circuit above) leaves exactly one
        candidate, the caller (`saved_recipe_lookup_response`) auto-picks it
        and announces it directly rather than asking "which one?" — Ayush's
        call on PR #605's 4th re-review, since every row this drops already
        scores strictly weaker on word overlap than the one it keeps.
        """
        query_tokens = set(_tokenize_query(query))
        if not query_tokens:
            return []

        candidates = await self.get_user_recipes(user_id, limit=500)
        title_token_sets = [
            (row, set(_tokenize_query(str(row.get("title") or "")))) for row in candidates
        ]

        exact_matches = [row for row, tset in title_token_sets if tset == query_tokens]
        other_full_match_exists = any(
            tset != query_tokens and tset >= query_tokens for _row, tset in title_token_sets
        )
        if exact_matches and not other_full_match_exists:
            return exact_matches[:limit]

        any_full_coverage = any(tset >= query_tokens for _row, tset in title_token_sets)

        scored: list[tuple[float, dict[str, Any]]] = []
        for row, query_title_tokens in title_token_sets:
            title_tokens = _tokenize(str(row.get("title") or ""))
            desc_tokens = _tokenize(str(row.get("description") or ""))
            raw_tags = row.get("tags")
            tags_text = " ".join(str(t) for t in raw_tags) if isinstance(raw_tags, list) else ""
            tags_tokens = _tokenize(tags_text)

            title_score = (
                len(query_tokens & set(title_tokens)) / len(title_tokens)
                if title_tokens
                else 0.0
            )
            desc_score = (
                len(query_tokens & set(desc_tokens)) / len(desc_tokens)
                if desc_tokens
                else 0.0
            )
            tags_score = (
                len(query_tokens & set(tags_tokens)) / len(tags_tokens)
                if tags_tokens
                else 0.0
            )

            total = title_score * 1.0 + desc_score * 0.4 + tags_score * 0.4
            if total <= 0:
                continue

            # Coverage for cutoff purposes is combined across title,
            # description, and tags — a description/tag token only counts
            # as independent signal if it covers a query token the title
            # itself is missing, not just any nonzero overlap (PR #605 5th
            # re-review). `query_title_tokens` (from `title_token_sets`
            # above) is already the title run through `_tokenize_query`.
            combined_query_tokens = (
                query_title_tokens
                | set(_tokenize_query(str(row.get("description") or "")))
                | set(_tokenize_query(tags_text))
            )
            row_has_full_coverage = combined_query_tokens >= query_tokens
            partial_coverage_noise = any_full_coverage and not row_has_full_coverage
            if partial_coverage_noise:
                continue
            scored.append((total, row))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [row for _score, row in scored[:limit]]

    async def get_recipe(self, user_id: str, recipe_id: str) -> dict[str, Any] | None:
        """Return the raw `recipes` row for `recipe_id`, or None if absent.

        Raw dict, like `get_user_recipes` — the declared type is the shape
        that actually comes back from `.select("*")`, not a `RecipeCard`
        (issue #376 / #417). Callers that need a model construct it
        themselves; the JSONB `ingredients` column can hold objects or plain
        strings, so `normalize_cooking_recipe` handles both.

        A miss is a zero-row read that returns `None`; it never raises. (The
        read is `.limit(1)`, not `.single()`: PostgREST answers zero rows to a
        `.single()` with a 406 that supabase-py raises as `APIError` PGRST116,
        so a missing recipe used to surface as a 500 instead of a 404. #676.)
        """
        result = (
            self.client.table("recipes")
            .select("*")
            .eq("id", recipe_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = _as_rows(result.data)
        return rows[0] if rows else None

    async def update_recipe_steps(
        self, user_id: str, recipe_id: str, steps: list[dict[str, Any]]
    ) -> None:
        """Persist derived structured steps for one recipe (issue #648).

        Used only by the lazy-upgrade ensure workflow — steps are already
        validated by the time they reach here, so this is a plain write.
        """
        (
            self.client.table("recipes")
            .update({"steps": steps})
            .eq("id", recipe_id)
            .eq("user_id", user_id)
            .execute()
        )

    async def update_recipe_cooked(self, user_id: str, recipe_id: str) -> bool:
        """Increment times_cooked and set last_cooked_at to now.

        Returns True when the recipe was marked, False when it no longer exists
        for this user (at the read: nothing is written; or at the write: the
        update matched no row). A miss never raises: a dish recipe
        deleted after the deductions landed must not strand the meal claim (#676).
        """
        # Read current times_cooked first
        result = (
            self.client.table("recipes")
            .select("times_cooked")
            .eq("id", recipe_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = _as_rows(result.data)
        if not rows:
            logger.info(
                "update_recipe_cooked: recipe %s not found for user %s; nothing to mark",
                recipe_id,
                user_id,
            )
            return False
        current = rows[0]
        times_cooked = int(current.get("times_cooked", 0)) + 1
        update_result = (
            self.client.table("recipes")
            .update(
                {
                    "times_cooked": times_cooked,
                    "last_cooked_at": datetime.now(UTC).isoformat(),
                }
            )
            .eq("id", recipe_id)
            .eq("user_id", user_id)
            .execute()
        )
        # An update that matched no row (the recipe was deleted between the read
        # and the write) marked nothing.
        return bool(_as_rows(update_result.data))

    async def deduct_pantry_item(
        self, user_id: str, item_id: str, deduct_qty: float
    ) -> bool:
        """Deduct from one lot of a food, carrying any excess into its other lots.

        Takes from the named row first. When `deduct_qty` is more than that row
        holds, the remainder goes to the food's other lots (same synonym-normalised
        name, same base unit, with stock), soonest expiry first and undated last
        (#356). The cook matcher names the soonest lot and reports the total
        across all of them, so one confirmed deduction consumes lots in expiry
        order. Returns whether the named row was updated; see
        `_deduct_from_row` for what that means.
        """
        applied, overflow, food, base_unit = await self._deduct_from_row(
            user_id, item_id, deduct_qty
        )
        if applied and overflow > _LOT_EPSILON and base_unit is not None:
            await self._carry_deduction_to_lots(user_id, item_id, food, base_unit, overflow)
        return applied

    async def _carry_deduction_to_lots(
        self, user_id: str, item_id: str, food: str, base_unit: str, remainder: float
    ) -> None:
        """Spend `remainder` (in `base_unit`) on the other lots of `food`, soonest first."""
        result = self.client.table("pantry_items").select("*").eq("user_id", user_id).execute()
        lots: list[tuple[PantryItem, float]] = []
        for row in _as_rows(result.data):
            if not row.get("id") or str(row["id"]) == item_id:
                continue
            item = self._row_to_pantry_item(row)
            if item.quantity <= 0 or lot_food_key(item.name) != food:
                continue
            qty, unit = lot_base(item)
            if qty is None or qty <= 0 or unit != base_unit:
                continue
            lots.append((item, qty))
        lots.sort(key=lambda lot: soonest_first_key(lot[0]))
        for item, qty in lots:
            if remainder <= _LOT_EPSILON:
                return
            take = min(remainder, qty)
            applied, _overflow, _food, _unit = await self._deduct_from_row(
                user_id, str(item.id), take
            )
            if applied:
                remainder -= take
        if remainder > _LOT_EPSILON:
            logger.info(
                f"deduct_pantry_item: {remainder:g} {base_unit} of {food!r} asked for "
                "beyond what all its lots hold; floored at zero"
            )

    async def _deduct_from_row(
        self, user_id: str, item_id: str, deduct_qty: float
    ) -> tuple[bool, float, str, str | None]:
        """Decrement pantry item quantity_base by deduct_qty, flooring at 0.

        Returns `(applied, overflow, food_key, base_unit)`: `applied` as described
        below, `overflow` the part of `deduct_qty` this row could not cover (0.0
        unless it was floored), and the row's food key and base unit so a caller
        can carry the overflow to the food's other lots.

        Also updates the display quantity proportionally when quantity_base
        is available, so the frontend shows a sensible number.

        `deduct_qty` is always in the item's *base* unit, because that is the only
        unit the matcher can express a deduction in. Rows written through the
        Next.js CRUD routes carry no base values at all, so when they are absent
        they are derived here the same way the matcher derives them — via
        normalize_to_base_unit on the row's own name/quantity/unit. Subtracting a
        base-unit amount straight from the display quantity instead would be wrong
        by the whole conversion factor whenever the two units differ: deducting
        100 g from a "2 kg" row would compute 2 - 100 and floor the row to zero.

        `applied` is True when the row was updated, False when the row is gone (at the
        read or at the write) or the deduction was refused because no base unit
        was recorded or derivable. Callers must not
        report a refused deduction as applied — the row is deliberately
        untouched, and telling the user their pantry was updated when it was not
        is the same lie the corruption bug told, just in the other direction.
        """
        result = (
            self.client.table("pantry_items")
            .select("name, quantity, unit, quantity_base, unit_base")
            .eq("id", item_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = _as_rows(result.data)
        if not rows:
            logger.warning(f"deduct_pantry_item: item {item_id} not found for user {user_id}")
            return False, 0.0, "", None

        row = rows[0]
        current_base = float(row["quantity_base"]) if row.get("quantity_base") is not None else None
        current_qty = float(row["quantity"])

        derived_unit_base: str | None = None
        if current_base is None:
            derived_base, derived_unit = normalize_to_base_unit(
                # Normalized the same way cook_matcher normalizes a pantry name
                # before calling this function. A raw name resolves to a
                # different density than its normalized form, so deducting on
                # the raw name would apply deduct_qty against a different base
                # than the one it was computed from.
                name=normalize_food_name(str(row.get("name") or "")).lower().strip(),
                quantity=current_qty,
                unit=str(row.get("unit") or ""),
            )
            if derived_base is not None and derived_unit is not None:
                # Persist the derived values alongside the deduction so the row
                # stops needing this fallback on every subsequent cook.
                current_base = derived_base
                derived_unit_base = derived_unit

        if current_base is not None:
            new_base = max(0.0, current_base - deduct_qty)
            # Proportionally scale display quantity
            ratio = new_base / current_base if current_base > 0 else 0.0
            new_qty = round(current_qty * ratio, 4)
            update: dict[str, Any] = {"quantity": new_qty, "quantity_base": new_base}
            if derived_unit_base is not None:
                update["unit_base"] = derived_unit_base
            update_result = (
                self.client.table("pantry_items")
                .update(update)
                .eq("id", item_id)
                .eq("user_id", user_id)
                .execute()
            )
            # An update that matched no row (the row was deleted between the
            # read and the write) is a skip, not an applied deduction (#676).
            return (
                bool(_as_rows(update_result.data)),
                max(0.0, deduct_qty - current_base),
                lot_food_key(str(row.get("name") or "")),
                derived_unit_base or row.get("unit_base"),
            )
        else:
            # Base units are neither recorded nor derivable for this row, so the
            # unit `deduct_qty` is expressed in is unknown. Deducting it from the
            # display quantity would only be correct if the two units happened to
            # coincide; when they do not it silently destroys stock. Refuse
            # instead — an unchanged row is recoverable, a zeroed one is not.
            logger.warning(
                f"deduct_pantry_item: skipping item {item_id} "
                f"({row.get('name')!r} {current_qty} {row.get('unit')!r}) — "
                "no base unit recorded and none derivable, so the deduction unit is ambiguous"
            )
            return False, 0.0, "", None

    # =========================================================================
    # Conversation history
    # =========================================================================

    async def save_message(
        self,
        user_id: str,
        conversation_id: str,
        role: str,
        content: str,
        intent: str | None = None,
        proposal: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Insert one history row.

        Issue #444: `metadata` on an assistant `pantry_update` turn carries two
        reserved keys, `request_id` (stamped at save time) and `proposal_review`
        (written later by `set_turn_metadata`). Nothing else may rewrite a saved
        row's `metadata` -- pantry-proposal turns get no follow-up chips, so no
        later writer exists today. Keep it that way, or an outcome gets clobbered.
        """
        self.client.table("conversation_history").insert(
            {
                "user_id": user_id,
                "conversation_id": conversation_id,
                "role": role,
                "content": content,
                "intent": intent,
                "proposal": proposal,
                "metadata": metadata,
            }
        ).execute()

    async def get_history(
        self, user_id: str, conversation_id: str, limit: int = _HISTORY_DEFAULT_LIMIT
    ) -> list[dict[str, Any]]:
        """Return the most recent `limit` messages, oldest-first.

        #384: the query used to order ascending and apply `.limit()` in the
        same call. PostgREST applies `.limit()` after `.order()`, so that
        always returned the *oldest* `limit` rows, not the most recent ones
        -- for any conversation longer than `limit`, callers could never see
        anything newer than the very start of the conversation. Ordering
        descending and limiting at the DB fetches exactly the most recent
        `limit` rows regardless of how long the conversation is (no
        over-fetch); reversing in Python restores the ascending order every
        caller expects.

        `limit` must be positive -- a non-positive value returns `[]` rather
        than inverting into "return everything" or a negative slice.
        """
        if limit < 1:
            return []
        result = (
            self.client.table("conversation_history")
            .select("*")
            .eq("user_id", user_id)
            .eq("conversation_id", conversation_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        rows = _as_rows(result.data)
        rows.reverse()
        return rows

    async def get_turns_by_request_ids(
        self, user_id: str, conversation_id: str, request_ids: list[str]
    ) -> list[dict[str, Any]]:
        """Assistant turns of this user's conversation stamped with any of
        `request_ids` (`metadata.request_id`, #444). Returns `id`, `proposal`
        and `metadata`. Another user's rows never match: `user_id` is filtered.
        """
        if not request_ids:
            return []
        result = (
            self.client.table("conversation_history")
            .select("id,proposal,metadata")
            .eq("user_id", user_id)
            .eq("conversation_id", conversation_id)
            .eq("role", "assistant")
            .in_("metadata->>request_id", request_ids)
            .execute()
        )
        return _as_rows(result.data)

    async def set_turn_metadata(
        self, user_id: str, turn_id: str, metadata: dict[str, Any]
    ) -> bool:
        """Replace one history row's `metadata` (#444). Filters on `id` AND
        `user_id`; returns whether a row matched."""
        result = (
            self.client.table("conversation_history")
            .update({"metadata": metadata})
            .eq("id", turn_id)
            .eq("user_id", user_id)
            .execute()
        )
        return len(result.data) > 0

    # =========================================================================
    # Session operations
    # =========================================================================

    async def get_session(
        self, user_id: str, conversation_id: str
    ) -> ConversationSession | None:
        """The conversation's session, or None. Read-only: never creates a row."""
        result = (
            self.client.table("conversation_sessions")
            .select("*")
            .eq("conversation_id", conversation_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not result.data:
            return None
        row = _as_row(result.data[0])
        raw_pending = row.get("pending_proposal")
        raw_metadata = row.get("metadata") or {}
        return ConversationSession(
            conversation_id=row["conversation_id"],
            active_mode=SessionMode(row.get("active_mode", "default")),
            pinned_recipe_id=row.get("pinned_recipe_id"),
            pending_proposal=PendingProposalMemory.model_validate(raw_pending)
            if isinstance(raw_pending, dict)
            else None,
            metadata=SessionContext.model_validate(raw_metadata),
        )

    async def get_or_create_session(
        self, user_id: str, conversation_id: str
    ) -> ConversationSession:
        existing = await self.get_session(user_id, conversation_id)
        if existing is not None:
            return existing

        session = ConversationSession(conversation_id=conversation_id)
        self.client.table("conversation_sessions").insert(
            {
                "conversation_id": conversation_id,
                "user_id": user_id,
                "active_mode": session.active_mode.value
                if hasattr(session.active_mode, "value")
                else str(session.active_mode),
                "metadata": session.metadata.model_dump(mode="json"),
            }
        ).execute()
        return session

    async def update_session(
        self, user_id: str, session: ConversationSession
    ) -> ConversationSession:
        data: dict[str, Any] = {
            "active_mode": session.active_mode.value
            if hasattr(session.active_mode, "value")
            else str(session.active_mode),
            "pinned_recipe_id": session.pinned_recipe_id,
            "pending_proposal": session.pending_proposal.model_dump(mode="json")
            if session.pending_proposal is not None
            else None,
            "metadata": session.metadata.model_dump(mode="json"),
        }
        self.client.table("conversation_sessions").update(data).eq(
            "conversation_id", session.conversation_id
        ).eq("user_id", user_id).execute()
        return session

    # =========================================================================
    # Ingestion logs
    # =========================================================================

    async def log_ingestion(
        self,
        user_id: str,
        request_id: str,
        intent: str,
        input_payload: dict[str, Any],
        proposal: dict[str, Any] | None,
        errors: list[str],
    ) -> None:
        self.client.table("ingestion_logs").insert(
            {
                "user_id": user_id,
                "request_id": request_id,
                "intent": intent,
                "input_payload": input_payload,
                "proposal": proposal,
                "errors": errors,
            }
        ).execute()

    # =========================================================================
    # User profile (for dietary preferences in recipe grounding)
    # =========================================================================

    async def get_profile(self, user_id: str) -> dict[str, Any] | None:
        result = (
            self.client.table("user_profiles")
            .select("*")
            .eq("user_id", user_id)
            .execute()
        )
        if result.data:
            return _as_row(result.data[0])
        return None

    # =========================================================================
    # Meals (issue #650) -- read-only from ai-service. Full meal CRUD lives
    # in the Next.js API layer (contract: docs/plans/2026-09-29-issue-650-meal-
    # contract.md); these are the reads the ai-service meal generation and
    # meal-screen (issue #652) workflows need.
    # =========================================================================

    async def get_recent_meal_servings(self, user_id: str, limit: int = 3) -> list[int]:
        """Servings from the user's most recently *cooked* meals, newest first.

        Reads the `meals` table's `servings`/`last_cooked_at` columns
        (migration 00013, issue #650) -- rows with no `last_cooked_at` (never
        cooked) are excluded, since "default servings" should reflect what the
        user actually cooks, not every draft they opened. Used only to pick a
        default servings for meal generation when the ask has no explicit
        number.

        Returns `[]` on any query error -- including "relation does not
        exist" before migration 00013 lands, which this ticket ships ahead
        of -- so the caller degrades to a fixed default (2) rather than
        failing the turn. Never raises.
        """
        try:
            # `nullsfirst=False` (rather than a `.not_(..., "is", "null")`
            # filter) pushes never-cooked rows to the end of the DESC order
            # instead of excluding them at the query level -- Postgres's
            # default for DESC is NULLS FIRST, which would otherwise put
            # every never-cooked meal ahead of the ones we actually want.
            result = (
                self.client.table("meals")
                .select("servings,last_cooked_at")
                .eq("user_id", user_id)
                .order("last_cooked_at", desc=True, nullsfirst=False)
                .limit(limit)
                .execute()
            )
        except Exception as e:
            logger.warning(f"Could not fetch recent meal servings for user {user_id}: {e}")
            return []
        return [
            int(row["servings"])
            for row in _as_rows(result.data or [])
            if row.get("servings") is not None and row.get("last_cooked_at") is not None
        ]

    async def get_meal_with_dishes(self, user_id: str, meal_id: str) -> dict[str, Any] | None:
        """Return `{"meal": <meals row>, "dishes": [...]}` for one meal, or
        `None` when it doesn't exist or isn't this user's.

        Each dish dict is `{"role", "position", "recipe_id", "recipe": <recipes
        row>}`, ordered by `position` (0 = main, 1-2 = sides) -- `recipe` is the
        same raw-dict shape `get_recipe` returns. `recipe_id` (issue #654 N1) is
        the str form of `meal_dishes.recipe_id`, additive alongside `recipe` --
        it's the only reliable way to test dish membership when `recipe` came
        back `{}` because the recipe was deleted between the two reads. Scoped
        to `user_id` on both the `meals` row and its `meal_dishes` rows, so a
        meal (or a dish inside it) belonging to someone else is
        indistinguishable from one that doesn't exist at all. Feeds the
        meal-screen AI routes (issue #652: side-alternatives, expand-dish) and
        the meal cook routes (issue #654) -- full meal CRUD itself lives in the
        Next.js API layer.
        """
        meal_result = (
            self.client.table("meals")
            .select("*")
            .eq("id", meal_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not meal_result.data:
            return None
        meal_row = _as_row(meal_result.data[0])

        dishes_result = (
            self.client.table("meal_dishes")
            .select("role,position,recipe_id")
            .eq("meal_id", meal_id)
            .eq("user_id", user_id)
            .order("position")
            .execute()
        )
        dishes: list[dict[str, Any]] = []
        for raw in _as_rows(dishes_result.data or []):
            recipe_id = str(raw["recipe_id"])
            recipe_row = await self.get_recipe(user_id, recipe_id)
            dishes.append(
                {
                    "role": raw["role"],
                    "position": raw["position"],
                    "recipe_id": recipe_id,
                    "recipe": recipe_row or {},
                }
            )

        return {"meal": meal_row, "dishes": dishes}

    # =========================================================================
    # Meal cook (issue #654) -- server-side idempotency for
    # POST /v1/meals/cook/confirm. See migration 00015_meals_last_cook_ref.sql
    # and docs/plans/2026-09-29-issue-654-a-meal-deduction-contract.md §2c.
    # =========================================================================

    async def claim_meal_cook(
        self, user_id: str, meal_id: str, cook_ref: str
    ) -> MealCookClaim | None:
        """Claim `cook_ref` as the meal's current cook, or classify a replay.

        Claim first, write second (contract §2c) -- this never lets a lost
        response or a second tab double-deduct. Returns `None` when the meal
        row doesn't exist (or isn't this user's), which the route turns into
        a 404.

        Outcomes:
        - `claimed`: this ref just became the meal's `last_cook_ref`.
          `times_cooked` incremented, `last_cooked_at` set to `now(UTC)`,
          `last_cook_status` set to `'claimed'`. `cooked_on` is that moment's
          UTC date.
        - `replay_applied`: `last_cook_ref == cook_ref` and the meal's
          `last_cook_status` is already `'applied'` -- this cook fully
          landed already. No write.
        - `replay_in_progress`: `last_cook_ref == cook_ref`, status
          `'claimed'`, and `last_cooked_at` is under 30s old -- the first
          POST for this ref is probably still writing. No write.
        - `replay_claimed`: same as above but `last_cooked_at` is 30s or
          older -- a confirm that claimed but never finished. No write.

        A null `last_cook_status` with a matching `last_cook_ref` is treated
        as `'claimed'` (a row written by an older, pre-#654 code path could
        have a ref with no status at all -- never happens once this ships,
        but it's a cheap, safe default rather than an unhandled case).
        """
        read_result = (
            self.client.table("meals")
            .select("times_cooked,last_cook_ref,last_cook_status,last_cooked_at")
            .eq("id", meal_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not read_result.data:
            return None
        row = _as_row(read_result.data[0])

        existing_ref = row.get("last_cook_ref")
        if existing_ref == cook_ref:
            return self._classify_meal_cook_replay(row)

        now = datetime.now(UTC)
        update_result = (
            self.client.table("meals")
            .update(
                {
                    "times_cooked": int(row.get("times_cooked") or 0) + 1,
                    "last_cooked_at": now.isoformat(),
                    "last_cook_ref": cook_ref,
                    "last_cook_status": "claimed",
                }
            )
            .eq("id", meal_id)
            .eq("user_id", user_id)
            .or_(f"last_cook_ref.is.null,last_cook_ref.neq.{cook_ref}")
            .execute()
        )
        if update_result.data:
            updated = _as_row(update_result.data[0])
            return MealCookClaim(
                outcome="claimed",
                times_cooked=int(updated.get("times_cooked") or 0),
                cooked_on=now.date(),
                cooked_at=now,
            )

        # Zero rows updated: either a racing post with the SAME ref just won
        # the update (re-read and classify the replay), or the meal is gone.
        reread_result = (
            self.client.table("meals")
            .select("times_cooked,last_cook_ref,last_cook_status,last_cooked_at")
            .eq("id", meal_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not reread_result.data:
            return None
        return self._classify_meal_cook_replay(_as_row(reread_result.data[0]))

    def _classify_meal_cook_replay(self, row: dict[str, Any]) -> MealCookClaim:
        """Classify a meal row whose `last_cook_ref` already matches the
        confirm's `cook_ref` -- shared by both the fast path and the
        zero-rows-updated re-read in `claim_meal_cook`."""
        status = row.get("last_cook_status") or "claimed"
        times_cooked = int(row.get("times_cooked") or 0)
        last_cooked_at = _parse_meal_cook_timestamp(row.get("last_cooked_at")) or datetime.now(UTC)
        cooked_on = last_cooked_at.date()

        if status == "applied":
            return MealCookClaim(
                outcome="replay_applied",
                times_cooked=times_cooked,
                cooked_on=cooked_on,
                cooked_at=last_cooked_at,
            )

        age = (datetime.now(UTC) - last_cooked_at).total_seconds()
        outcome: Literal["replay_in_progress", "replay_claimed"] = (
            "replay_in_progress" if age < 30 else "replay_claimed"
        )
        return MealCookClaim(
            outcome=outcome,
            times_cooked=times_cooked,
            cooked_on=cooked_on,
            cooked_at=last_cooked_at,
        )

    async def mark_meal_cook_applied(self, user_id: str, meal_id: str, cook_ref: str) -> None:
        """Stamp `last_cook_status = 'applied'` after a claimed cook's
        deductions and recipe marks finish.

        Filtered on `last_cook_ref == cook_ref` (not just `id`/`user_id`) so
        this can never stamp a NEWER cook's claim -- if a second cook of this
        meal claimed a different ref between this confirm's claim and this
        call, that ref's own row stays `'claimed'` until its own confirm
        stamps it.
        """
        (
            self.client.table("meals")
            .update({"last_cook_status": "applied"})
            .eq("id", meal_id)
            .eq("user_id", user_id)
            .eq("last_cook_ref", cook_ref)
            .execute()
        )


# Singleton
_repository: SupabaseRepository | None = None


async def get_repository() -> SupabaseRepository:
    global _repository
    if _repository is None:
        _repository = SupabaseRepository()
        await _repository.initialize()
    return _repository
