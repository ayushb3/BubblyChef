"""Supabase repository for the AI microservice.

Replaces SQLiteRepository. Uses supabase-py with the service_role key
(bypasses RLS) and takes user_id as a parameter on every method.
"""

import logging
from datetime import UTC, date, datetime
from typing import Any, cast

from supabase import Client, create_client

from bubbly_chef.config import settings
from bubbly_chef.domain.normalizer import normalize_food_name, normalize_to_base_unit
from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.models.recipe import RecipeCard
from bubbly_chef.models.session import ConversationSession, SessionMode
from bubbly_chef.tools.expiry import get_expiry_heuristics

logger = logging.getLogger(__name__)


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
        return [self._row_to_pantry_item(r) for r in result.data]

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
        return [self._row_to_pantry_item(r) for r in result.data]

    async def find_similar_item(
        self, user_id: str, name: str
    ) -> PantryItem | None:
        normalized = name.lower().strip()
        result = (
            self.client.table("pantry_items")
            .select("*")
            .eq("user_id", user_id)
            .eq("name_normalized", normalized)
            .limit(1)
            .execute()
        )
        if result.data:
            return self._row_to_pantry_item(result.data[0])
        return None

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
        return self._row_to_pantry_item(result.data[0])

    async def update_pantry_item(
        self, user_id: str, item_id: str, updates: dict[str, Any]
    ) -> PantryItem | None:
        # Map storage_location -> location
        if "storage_location" in updates:
            updates["location"] = updates.pop("storage_location")
        if "name" in updates:
            updates["name_normalized"] = updates["name"].lower().strip()

        result = (
            self.client.table("pantry_items")
            .update(updates)
            .eq("id", item_id)
            .eq("user_id", user_id)
            .execute()
        )
        if result.data:
            return self._row_to_pantry_item(result.data[0])
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
    ) -> tuple[int, int, list[str]]:
        applied = 0
        failed = 0
        errors: list[str] = []

        for action in actions:
            try:
                action_type = action.get("action", "add")
                name = action.get("name", "")

                if action_type == "add":
                    existing = await self.find_similar_item(user_id, name)
                    if existing:
                        new_qty = float(existing.quantity) + float(
                            action.get("quantity", 1)
                        )
                        # F2/F7: recalculate base units on merge — don't leave quantity_base stale
                        _qty_base, _unit_base = normalize_to_base_unit(
                            name=name,
                            quantity=new_qty,
                            unit=action.get("unit", existing.unit),
                            category=action.get("category", existing.category.value),
                        )
                        await self.update_pantry_item(
                            user_id,
                            str(existing.id),
                            {
                                "quantity": new_qty,
                                "quantity_base": _qty_base,
                                "unit_base": _unit_base,
                            },
                        )
                    else:
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
                        item = PantryItem(
                            name=name,
                            category=item_category,
                            storage_location=item_location,
                            quantity=float(action.get("quantity", 1)),
                            unit=action.get("unit", "item"),
                            quantity_base=action.get("quantity_base"),
                            unit_base=action.get("unit_base"),
                            expiry_date=item_expiry,
                            estimated_expiry=bool(item_estimated_expiry),
                        )
                        await self.add_pantry_item(user_id, item)
                    applied += 1

                elif action_type in ("update", "use"):
                    existing = await self.find_similar_item(user_id, name)
                    if not existing:
                        errors.append(f"Item not found: {name}")
                        failed += 1
                        continue
                    if action_type == "use":
                        new_qty = max(
                            0,
                            float(existing.quantity)
                            - float(action.get("quantity", 1)),
                        )
                        if new_qty <= 0:
                            await self.delete_pantry_item(user_id, str(existing.id))
                        else:
                            await self.update_pantry_item(
                                user_id, str(existing.id), {"quantity": new_qty}
                            )
                    else:
                        updates = {
                            k: v
                            for k, v in action.items()
                            if k not in ("action", "name") and v is not None
                        }
                        await self.update_pantry_item(
                            user_id, str(existing.id), updates
                        )
                    applied += 1

                elif action_type == "remove":
                    existing = await self.find_similar_item(user_id, name)
                    if existing:
                        await self.delete_pantry_item(user_id, str(existing.id))
                        applied += 1
                    else:
                        errors.append(f"Item not found for removal: {name}")
                        failed += 1

            except Exception as e:
                errors.append(f"Error processing {action}: {e}")
                failed += 1

        return applied, failed, errors

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
        """Return raw rows for all of a user's saved recipes, newest first.

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
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        # supabase-py types row data as list[JSON]; every row from a `.select("*")`
        # on this table is actually an object, matching every other raw-dict
        # accessor in this class (e.g. get_recipe below).
        return cast("list[dict[str, Any]]", result.data or [])

    async def get_recipe(self, user_id: str, recipe_id: str) -> RecipeCard | None:
        result = (
            self.client.table("recipes")
            .select("*")
            .eq("id", recipe_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        if not result.data:
            return None
        # Return raw dict — caller can construct RecipeCard if needed
        return result.data  # type: ignore[return-value]

    async def update_recipe_cooked(self, user_id: str, recipe_id: str) -> None:
        """Increment times_cooked and set last_cooked_at to now."""
        # Read current times_cooked first
        result = (
            self.client.table("recipes")
            .select("times_cooked")
            .eq("id", recipe_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        current = result.data or {}
        times_cooked = int(current.get("times_cooked", 0)) + 1
        (
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

    async def deduct_pantry_item(
        self, user_id: str, item_id: str, deduct_qty: float
    ) -> bool:
        """Decrement pantry item quantity_base by deduct_qty, flooring at 0.

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

        Returns True when the row was updated, False when the deduction was
        refused because no base unit was recorded or derivable. Callers must not
        report a refused deduction as applied — the row is deliberately
        untouched, and telling the user their pantry was updated when it was not
        is the same lie the corruption bug told, just in the other direction.
        """
        result = (
            self.client.table("pantry_items")
            .select("name, quantity, unit, quantity_base, unit_base")
            .eq("id", item_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        if not result.data:
            logger.warning(f"deduct_pantry_item: item {item_id} not found for user {user_id}")
            return False

        row = result.data
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
            (
                self.client.table("pantry_items")
                .update(update)
                .eq("id", item_id)
                .eq("user_id", user_id)
                .execute()
            )
            return True
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
            return False

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
    ) -> None:
        self.client.table("conversation_history").insert(
            {
                "user_id": user_id,
                "conversation_id": conversation_id,
                "role": role,
                "content": content,
                "intent": intent,
            }
        ).execute()

    async def get_history(
        self, user_id: str, conversation_id: str, limit: int = 20
    ) -> list[dict[str, Any]]:
        result = (
            self.client.table("conversation_history")
            .select("*")
            .eq("user_id", user_id)
            .eq("conversation_id", conversation_id)
            .order("created_at")
            .limit(limit)
            .execute()
        )
        return result.data

    # =========================================================================
    # Session operations
    # =========================================================================

    async def get_or_create_session(
        self, user_id: str, conversation_id: str
    ) -> ConversationSession:
        result = (
            self.client.table("conversation_sessions")
            .select("*")
            .eq("conversation_id", conversation_id)
            .eq("user_id", user_id)
            .execute()
        )
        if result.data:
            row = result.data[0]
            return ConversationSession(
                conversation_id=row["conversation_id"],
                active_mode=SessionMode(row.get("active_mode", "default")),
                pinned_recipe_id=row.get("pinned_recipe_id"),
                pending_proposal=row.get("pending_proposal"),
                metadata=row.get("metadata", {}),
            )

        session = ConversationSession(conversation_id=conversation_id)
        self.client.table("conversation_sessions").insert(
            {
                "conversation_id": conversation_id,
                "user_id": user_id,
                "active_mode": session.active_mode.value
                if hasattr(session.active_mode, "value")
                else str(session.active_mode),
                "metadata": session.metadata or {},
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
            "pending_proposal": session.pending_proposal,
            "metadata": session.metadata or {},
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
            return result.data[0]
        return None


# Singleton
_repository: SupabaseRepository | None = None


async def get_repository() -> SupabaseRepository:
    global _repository
    if _repository is None:
        _repository = SupabaseRepository()
        await _repository.initialize()
    return _repository
