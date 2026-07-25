"""Supabase repository for the AI microservice.

Replaces SQLiteRepository. Uses supabase-py with the service_role key
(bypasses RLS) and takes user_id as a parameter on every method.
"""

import logging
from datetime import UTC, datetime
from typing import Any

from postgrest import CountMethod
from supabase import Client, create_client

from bubbly_chef.config import settings
from bubbly_chef.domain.normalizer import normalize_to_base_unit
from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.models.recipe import RecipeCard
from bubbly_chef.models.session import ConversationSession, SessionMode

logger = logging.getLogger(__name__)


def _as_row(value: Any) -> dict[str, Any]:
    """Narrow a Postgrest JSON value to a plain dict row.

    Postgrest types query results as the recursive ``JSON`` union (``None |
    bool | str | int | float | Sequence[JSON] | Mapping[str, JSON]``), but
    every row returned from a Postgres table select is a JSON object in
    practice. This narrows the type at the repository boundary with a real
    runtime check rather than casting blindly.
    """
    if not isinstance(value, dict):
        raise TypeError(f"Expected a JSON object row from Supabase, got {type(value).__name__}")
    return value


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
            quantity_base=float(row["quantity_base"])
            if row.get("quantity_base") is not None
            else None,
            unit_base=row.get("unit_base"),
            expiry_date=expiry,
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
        return [self._row_to_pantry_item(_as_row(r)) for r in result.data]

    async def get_expiring_items(self, user_id: str, days: int = 3) -> list[PantryItem]:
        from datetime import date, timedelta

        future = (date.today() + timedelta(days=days)).isoformat()
        result = (
            self.client.table("pantry_items")
            .select("*")
            .eq("user_id", user_id)
            .not_.is_("expiry_date", "null")
            .lte("expiry_date", future)
            .order("expiry_date")
            .execute()
        )
        return [self._row_to_pantry_item(_as_row(r)) for r in result.data]

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
            return self._row_to_pantry_item(_as_row(result.data[0]))
        return None

    async def add_pantry_item(self, user_id: str, item: PantryItem) -> PantryItem:
        data: dict[str, Any] = {
            "user_id": user_id,
            "name": item.name,
            "name_normalized": item.name.lower().strip(),
            "category": item.category.value
            if hasattr(item.category, "value")
            else str(item.category),
            "location": item.storage_location.value
            if hasattr(item.storage_location, "value")
            else str(item.storage_location),
            "quantity": float(item.quantity),
            "unit": item.unit,
            "quantity_base": float(item.quantity_base) if item.quantity_base is not None else None,
            "unit_base": item.unit_base,
            "expiry_date": item.expiry_date.isoformat() if item.expiry_date else None,
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

    async def count_pantry_items(self, user_id: str) -> int:
        result = (
            self.client.table("pantry_items")
            .select("id", count=CountMethod.exact)
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
                        item = PantryItem(
                            name=name,
                            category=FoodCategory(action.get("category", "other")),
                            storage_location=StorageLocation(
                                action.get("location", "pantry")
                            ),
                            quantity=float(action.get("quantity", 1)),
                            unit=action.get("unit", "item"),
                            quantity_base=action.get("quantity_base"),
                            unit_base=action.get("unit_base"),
                            expiry_date=None,
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
            "tags": recipe.dietary_tags or [],
            "difficulty": recipe.difficulty,
            "cuisine": recipe.cuisine,
            "meal_type": recipe.meal_type,
            "source_type": recipe.source_type or "chat",
            "is_draft": recipe.is_draft if hasattr(recipe, "is_draft") else False,
        }
        self.client.table("recipes").insert(data).execute()
        return recipe  # Return as-is; ID comes from Supabase

    async def get_recipe(self, user_id: str, recipe_id: str) -> dict[str, Any] | None:
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
        return _as_row(result.data)

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
    ) -> None:
        """Decrement pantry item quantity_base by deduct_qty, flooring at 0.

        Also updates the display quantity proportionally when quantity_base
        is available, so the frontend shows a sensible number.
        """
        result = (
            self.client.table("pantry_items")
            .select("quantity, quantity_base, unit_base")
            .eq("id", item_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        if not result.data:
            logger.warning(f"deduct_pantry_item: item {item_id} not found for user {user_id}")
            return

        row = result.data
        current_base = float(row["quantity_base"]) if row.get("quantity_base") is not None else None
        current_qty = float(row["quantity"])

        if current_base is not None:
            new_base = max(0.0, current_base - deduct_qty)
            # Proportionally scale display quantity
            ratio = new_base / current_base if current_base > 0 else 0.0
            new_qty = round(current_qty * ratio, 4)
            (
                self.client.table("pantry_items")
                .update({"quantity": new_qty, "quantity_base": new_base})
                .eq("id", item_id)
                .eq("user_id", user_id)
                .execute()
            )
        else:
            # No base unit — deduct directly from display quantity
            new_qty = max(0.0, current_qty - deduct_qty)
            (
                self.client.table("pantry_items")
                .update({"quantity": new_qty})
                .eq("id", item_id)
                .eq("user_id", user_id)
                .execute()
            )

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
        return [_as_row(r) for r in result.data]

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
            row = _as_row(result.data[0])
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
            return _as_row(result.data[0])
        return None


# Singleton
_repository: SupabaseRepository | None = None


async def get_repository() -> SupabaseRepository:
    global _repository
    if _repository is None:
        _repository = SupabaseRepository()
        await _repository.initialize()
    return _repository
