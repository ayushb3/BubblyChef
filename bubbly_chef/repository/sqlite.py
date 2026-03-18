"""SQLite repository implementation."""

import json
import logging
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import aiosqlite

from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.models.recipe import Ingredient, RecipeCard
from bubbly_chef.models.user import UserProfile

logger = logging.getLogger(__name__)


class SQLiteRepository:
    """SQLite-based repository for pantry data."""

    def __init__(self, db_path: str = "bubbly_chef.db"):
        self.db_path = db_path
        self._connection: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        """Initialize database and create tables."""
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)

        self._connection = await aiosqlite.connect(self.db_path)
        self._connection.row_factory = aiosqlite.Row

        await self._connection.execute("PRAGMA foreign_keys = ON")

        await self._connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS pantry_items (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                name_normalized TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'other',
                location TEXT NOT NULL DEFAULT 'pantry',
                quantity REAL NOT NULL DEFAULT 1.0,
                unit TEXT NOT NULL DEFAULT 'item',
                expiry_date TEXT,
                slot_index INTEGER,
                added_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_pantry_name ON pantry_items(name_normalized);
            CREATE INDEX IF NOT EXISTS idx_pantry_category ON pantry_items(category);
            CREATE INDEX IF NOT EXISTS idx_pantry_expiry ON pantry_items(expiry_date);

            CREATE TABLE IF NOT EXISTS recipes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                ingredients TEXT NOT NULL DEFAULT '[]',
                instructions TEXT NOT NULL DEFAULT '[]',
                prep_time_minutes INTEGER,
                cook_time_minutes INTEGER,
                servings INTEGER,
                source_url TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_profiles (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                display_name TEXT,
                avatar_url TEXT,
                dietary_preferences TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_user_email ON user_profiles(email);
            CREATE INDEX IF NOT EXISTS idx_user_username ON user_profiles(username);

            CREATE TABLE IF NOT EXISTS ingestion_logs (
                id TEXT PRIMARY KEY,
                request_id TEXT NOT NULL UNIQUE,
                intent TEXT NOT NULL,
                input_payload TEXT NOT NULL DEFAULT '{}',
                proposal TEXT,
                errors TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_ingestion_request
                ON ingestion_logs(request_id);

            CREATE TABLE IF NOT EXISTS conversation_history (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                intent TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_conv_history_conversation
                ON conversation_history(conversation_id, created_at);

            CREATE TABLE IF NOT EXISTS decorations (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                decoration_type TEXT NOT NULL DEFAULT 'plant',
                unlocked_at TEXT,
                milestone TEXT
            );
        """
        )

        # Migrations for existing databases
        try:
            await self._connection.execute(
                "ALTER TABLE pantry_items ADD COLUMN slot_index INTEGER"
            )
            await self._connection.commit()
            logger.info("Migration: added slot_index column to pantry_items")
        except Exception:
            pass  # Column already exists (new DBs have it from CREATE TABLE above)

        await self._connection.commit()
        logger.info(f"Database initialized at {self.db_path}")

    async def close(self) -> None:
        """Close database connection."""
        if self._connection:
            await self._connection.close()
            self._connection = None

    def _get_conn(self) -> aiosqlite.Connection:
        """Get the database connection."""
        if self._connection is None:
            raise RuntimeError("Repository not initialized")
        return self._connection

    # =========================================================================
    # Pantry operations
    # =========================================================================

    def _row_to_pantry_item(self, row: aiosqlite.Row) -> PantryItem:
        """Convert database row to PantryItem."""
        return PantryItem(
            id=row["id"],
            name=row["name"],
            category=FoodCategory(row["category"]),
            storage_location=StorageLocation(row["location"]),
            quantity=row["quantity"],
            unit=row["unit"],
            expiry_date=(date.fromisoformat(row["expiry_date"]) if row["expiry_date"] else None),
            slot_index=row["slot_index"] if "slot_index" in row.keys() else None,
            created_at=datetime.fromisoformat(row["added_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

    async def get_pantry_item(self, item_id: str) -> PantryItem | None:
        """Get a single pantry item by ID."""
        conn = self._get_conn()
        async with conn.execute("SELECT * FROM pantry_items WHERE id = ?", (item_id,)) as cursor:
            row = await cursor.fetchone()
            if row:
                return self._row_to_pantry_item(row)
        return None

    async def get_all_pantry_items(self) -> list[PantryItem]:
        """Get all pantry items."""
        conn = self._get_conn()
        async with conn.execute("SELECT * FROM pantry_items ORDER BY name") as cursor:
            rows = await cursor.fetchall()
            return [self._row_to_pantry_item(row) for row in rows]

    async def get_pantry_items(
        self,
        category: str | None = None,
        location: str | None = None,
    ) -> list[PantryItem]:
        """Get pantry items with optional filters."""
        conn = self._get_conn()

        conditions = []
        params = []

        if category:
            conditions.append("category = ?")
            params.append(category)
        if location:
            conditions.append("location = ?")
            params.append(location)

        query = "SELECT * FROM pantry_items"
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY name"

        async with conn.execute(query, params) as cursor:
            rows = await cursor.fetchall()
            return [self._row_to_pantry_item(row) for row in rows]

    async def search_pantry_items(self, query: str) -> list[PantryItem]:
        """Search pantry items by name."""
        conn = self._get_conn()
        async with conn.execute(
            "SELECT * FROM pantry_items WHERE name LIKE ? OR name_normalized LIKE ? ORDER BY name",
            (f"%{query}%", f"%{query}%"),
        ) as cursor:
            rows = await cursor.fetchall()
            return [self._row_to_pantry_item(row) for row in rows]

    async def get_expiring_items(self, days: int = 3) -> list[PantryItem]:
        """Get items expiring within the specified days."""
        conn = self._get_conn()
        cutoff = (date.today() + timedelta(days=days)).isoformat()

        async with conn.execute(
            """SELECT * FROM pantry_items
               WHERE expiry_date IS NOT NULL AND expiry_date <= ?
               ORDER BY expiry_date""",
            (cutoff,),
        ) as cursor:
            rows = await cursor.fetchall()
            return [self._row_to_pantry_item(row) for row in rows]

    async def add_pantry_item(self, item: PantryItem) -> PantryItem:
        """Add a new pantry item."""
        conn = self._get_conn()

        await conn.execute(
            """INSERT INTO pantry_items
               (id, name, name_normalized, category, location, quantity, unit,
                expiry_date, slot_index, added_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(item.id),
                item.name,
                item.name.lower().strip(),
                item.category.value,
                item.storage_location.value,
                item.quantity,
                item.unit,
                item.expiry_date.isoformat() if item.expiry_date else None,
                item.slot_index,
                item.created_at.isoformat(),
                item.updated_at.isoformat(),
            ),
        )
        await conn.commit()

        logger.debug(f"Added pantry item: {item.name} ({item.id})")
        return item

    async def update_pantry_item(
        self,
        item_or_id: str | PantryItem,
        updates: dict[str, Any] | None = None,
    ) -> PantryItem:
        """Update an existing pantry item.

        Accepts either:
        - A PantryItem object (full replacement)
        - An item_id string + updates dict (partial update)
        """
        conn = self._get_conn()

        if isinstance(item_or_id, PantryItem):
            item = item_or_id
            item_id = str(item.id)
            await conn.execute(
                """UPDATE pantry_items SET
                   name = ?, name_normalized = ?, category = ?,
                   location = ?, quantity = ?, unit = ?,
                   expiry_date = ?, updated_at = ?, slot_index = ?
                   WHERE id = ?""",
                (
                    item.name,
                    item.name.lower().strip(),
                    item.category.value,
                    item.storage_location.value,
                    item.quantity,
                    item.unit,
                    item.expiry_date.isoformat() if item.expiry_date else None,
                    item.updated_at.isoformat(),
                    item.slot_index,
                    item_id,
                ),
            )
            await conn.commit()
            return item

        # Legacy path: item_id + updates dict
        item_id = item_or_id
        if updates is None:
            updates = {}

        set_parts = []
        values: list[Any] = []

        for key, value in updates.items():
            if key == "category" and isinstance(value, FoodCategory):
                value = value.value
            elif key == "storage_location" and isinstance(value, StorageLocation):
                key = "location"
                value = value.value
            elif key == "expiry_date" and isinstance(value, date):
                value = value.isoformat()
            elif key == "updated_at" and isinstance(value, datetime):
                value = value.isoformat()

            set_parts.append(f"{key} = ?")
            values.append(value)

        values.append(item_id)

        await conn.execute(
            f"UPDATE pantry_items SET {', '.join(set_parts)} WHERE id = ?",
            values,
        )
        await conn.commit()

        result = await self.get_pantry_item(item_id)
        if result is None:
            raise ValueError(f"Item not found: {item_id}")
        return result

    async def delete_pantry_item(self, item_id: str) -> bool:
        """Delete a pantry item."""
        conn = self._get_conn()
        cursor = await conn.execute("DELETE FROM pantry_items WHERE id = ?", (item_id,))
        await conn.commit()

        deleted = cursor.rowcount > 0
        if deleted:
            logger.debug(f"Deleted pantry item: {item_id}")
        return deleted

    async def count_pantry_items(self) -> int:
        """Return total number of pantry items."""
        conn = self._get_conn()
        async with conn.execute("SELECT COUNT(*) FROM pantry_items") as cursor:
            row = await cursor.fetchone()
            return int(row[0]) if row else 0

    # =========================================================================
    # Decoration operations
    # =========================================================================

    async def get_all_decorations(self) -> list[dict[str, object]]:
        """Return all decorations with unlock status."""
        conn = self._get_conn()
        async with conn.execute(
            "SELECT id, name, decoration_type, unlocked_at, milestone"
            " FROM decorations ORDER BY name"
        ) as cursor:
            rows = await cursor.fetchall()
            return [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "decoration_type": row["decoration_type"],
                    "unlocked_at": row["unlocked_at"],
                    "milestone": row["milestone"],
                    "unlocked": row["unlocked_at"] is not None,
                }
                for row in rows
            ]

    async def unlock_decoration(self, name: str) -> bool:
        """Unlock a decoration by name. Returns True if newly unlocked."""
        conn = self._get_conn()
        # Insert if not exists
        await conn.execute(
            """INSERT OR IGNORE INTO decorations (id, name, decoration_type, milestone)
               VALUES (?, ?, 'plant', NULL)""",
            (str(uuid4()), name),
        )
        # Only update if not already unlocked
        cursor = await conn.execute(
            "UPDATE decorations SET unlocked_at = ? WHERE name = ? AND unlocked_at IS NULL",
            (datetime.now(UTC).isoformat(), name),
        )
        await conn.commit()
        return cursor.rowcount > 0

    async def is_decoration_unlocked(self, name: str) -> bool:
        """Check if a decoration is already unlocked."""
        conn = self._get_conn()
        async with conn.execute(
            "SELECT unlocked_at FROM decorations WHERE name = ?", (name,)
        ) as cursor:
            row = await cursor.fetchone()
            return row is not None and row["unlocked_at"] is not None

    async def find_similar_item(self, name: str) -> PantryItem | None:
        """Find a pantry item with similar name (for dedup)."""
        conn = self._get_conn()
        normalized = name.lower().strip()
        async with conn.execute(
            "SELECT * FROM pantry_items WHERE name_normalized = ? LIMIT 1",
            (normalized,),
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                return self._row_to_pantry_item(row)
        return None

    # =========================================================================
    # Recipe operations
    # =========================================================================

    def _row_to_recipe(self, row: aiosqlite.Row) -> RecipeCard:
        """Convert database row to RecipeCard."""
        ingredients_data = json.loads(row["ingredients"]) if row["ingredients"] else []
        ingredients = [Ingredient(**ing) for ing in ingredients_data]
        instructions = json.loads(row["instructions"]) if row["instructions"] else []
        tags = json.loads(row["tags"]) if row["tags"] else []

        return RecipeCard(
            id=UUID(row["id"]),
            title=row["title"],
            description=row["description"],
            ingredients=ingredients,
            instructions=instructions,
            prep_time_minutes=row["prep_time_minutes"],
            cook_time_minutes=row["cook_time_minutes"],
            servings=row["servings"],
            source_url=row["source_url"],
            dietary_tags=tags,
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

    async def get_recipe(self, recipe_id: UUID) -> RecipeCard | None:
        """Get a single recipe by ID."""
        conn = self._get_conn()
        async with conn.execute(
            "SELECT * FROM recipes WHERE id = ?", (str(recipe_id),)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                return self._row_to_recipe(row)
        return None

    async def get_all_recipes(self) -> list[RecipeCard]:
        """Get all recipes."""
        conn = self._get_conn()
        async with conn.execute(
            "SELECT * FROM recipes ORDER BY created_at DESC"
        ) as cursor:
            rows = await cursor.fetchall()
            return [self._row_to_recipe(row) for row in rows]

    async def add_recipe(self, recipe: RecipeCard) -> RecipeCard:
        """Add a new recipe."""
        conn = self._get_conn()
        ingredients_json = json.dumps(
            [ing.model_dump() for ing in recipe.ingredients]
        )
        instructions_json = json.dumps(recipe.instructions)
        tags_json = json.dumps(recipe.dietary_tags)

        await conn.execute(
            """INSERT INTO recipes
               (id, title, description, ingredients, instructions,
                prep_time_minutes, cook_time_minutes, servings,
                source_url, tags, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(recipe.id),
                recipe.title,
                recipe.description,
                ingredients_json,
                instructions_json,
                recipe.prep_time_minutes,
                recipe.cook_time_minutes,
                recipe.servings,
                recipe.source_url,
                tags_json,
                recipe.created_at.isoformat(),
                recipe.updated_at.isoformat(),
            ),
        )
        await conn.commit()
        logger.debug(f"Added recipe: {recipe.title} ({recipe.id})")
        return recipe

    async def update_recipe(self, recipe: RecipeCard) -> RecipeCard:
        """Update an existing recipe."""
        conn = self._get_conn()
        ingredients_json = json.dumps(
            [ing.model_dump() for ing in recipe.ingredients]
        )
        instructions_json = json.dumps(recipe.instructions)
        tags_json = json.dumps(recipe.dietary_tags)

        await conn.execute(
            """UPDATE recipes SET
               title = ?, description = ?, ingredients = ?,
               instructions = ?, prep_time_minutes = ?,
               cook_time_minutes = ?, servings = ?,
               source_url = ?, tags = ?, updated_at = ?
               WHERE id = ?""",
            (
                recipe.title,
                recipe.description,
                ingredients_json,
                instructions_json,
                recipe.prep_time_minutes,
                recipe.cook_time_minutes,
                recipe.servings,
                recipe.source_url,
                tags_json,
                recipe.updated_at.isoformat(),
                str(recipe.id),
            ),
        )
        await conn.commit()
        logger.debug(f"Updated recipe: {recipe.title} ({recipe.id})")
        return recipe

    async def delete_recipe(self, recipe_id: UUID) -> bool:
        """Delete a recipe."""
        conn = self._get_conn()
        cursor = await conn.execute(
            "DELETE FROM recipes WHERE id = ?", (str(recipe_id),)
        )
        await conn.commit()
        deleted = cursor.rowcount > 0
        if deleted:
            logger.debug(f"Deleted recipe: {recipe_id}")
        return deleted

    # =========================================================================
    # Ingestion log operations
    # =========================================================================

    async def log_ingestion(
        self,
        request_id: UUID,
        intent: str,
        input_payload: dict[str, Any],
        proposal: dict[str, Any] | None,
        errors: list[str],
    ) -> None:
        """Log an ingestion request and its result."""
        conn = self._get_conn()
        await conn.execute(
            """INSERT INTO ingestion_logs
               (id, request_id, intent, input_payload, proposal,
                errors, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                str(uuid4()),
                str(request_id),
                intent,
                json.dumps(input_payload, default=str),
                json.dumps(proposal, default=str) if proposal else None,
                json.dumps(errors),
                datetime.now(UTC).isoformat(),
            ),
        )
        await conn.commit()
        logger.debug(f"Logged ingestion: {request_id} ({intent})")

    async def get_ingestion_log(
        self, request_id: UUID
    ) -> dict[str, Any] | None:
        """Get an ingestion log by request ID."""
        conn = self._get_conn()
        async with conn.execute(
            "SELECT * FROM ingestion_logs WHERE request_id = ?",
            (str(request_id),),
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                return {
                    "id": row["id"],
                    "request_id": row["request_id"],
                    "intent": row["intent"],
                    "input_payload": json.loads(row["input_payload"]),
                    "proposal": (
                        json.loads(row["proposal"])
                        if row["proposal"]
                        else None
                    ),
                    "errors": json.loads(row["errors"]),
                    "created_at": row["created_at"],
                }
        return None

    # =========================================================================
    # User profile operations
    # =========================================================================

    def _row_to_user_profile(self, row: aiosqlite.Row) -> UserProfile:
        """Convert database row to UserProfile."""
        import json

        dietary_preferences = (
            json.loads(row["dietary_preferences"]) if row["dietary_preferences"] else []
        )

        return UserProfile(
            id=row["id"],
            username=row["username"],
            email=row["email"],
            display_name=row["display_name"],
            avatar_url=row["avatar_url"],
            dietary_preferences=dietary_preferences,
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

    async def get_profile_by_id(self, profile_id: str) -> UserProfile | None:
        """Get a user profile by ID."""
        conn = self._get_conn()
        async with conn.execute(
            "SELECT * FROM user_profiles WHERE id = ?", (profile_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                return self._row_to_user_profile(row)
        return None

    async def get_profile_by_email(self, email: str) -> UserProfile | None:
        """Get a user profile by email."""
        conn = self._get_conn()
        async with conn.execute("SELECT * FROM user_profiles WHERE email = ?", (email,)) as cursor:
            row = await cursor.fetchone()
            if row:
                return self._row_to_user_profile(row)
        return None

    async def get_profile_by_username(self, username: str) -> UserProfile | None:
        """Get a user profile by username."""
        conn = self._get_conn()
        async with conn.execute(
            "SELECT * FROM user_profiles WHERE username = ?", (username,)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                return self._row_to_user_profile(row)
        return None

    async def create_profile(self, profile: UserProfile) -> UserProfile:
        """Create a new user profile."""
        import json

        conn = self._get_conn()

        try:
            await conn.execute(
                """INSERT INTO user_profiles
                   (id, username, email, display_name, avatar_url, dietary_preferences,
                    created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(profile.id),
                    profile.username,
                    profile.email,
                    profile.display_name,
                    profile.avatar_url,
                    json.dumps(profile.dietary_preferences),
                    profile.created_at.isoformat(),
                    profile.updated_at.isoformat(),
                ),
            )
            await conn.commit()
            logger.debug(f"Created user profile: {profile.username} ({profile.id})")
            return profile
        except aiosqlite.IntegrityError as e:
            logger.error(f"Failed to create profile: {e}")
            raise ValueError("Username or email already exists") from e

    async def update_profile(self, profile_id: str, updates: dict[str, Any]) -> UserProfile:
        """Update an existing user profile."""
        import json

        conn = self._get_conn()

        # Build SET clause
        set_parts = []
        values = []

        for key, value in updates.items():
            if key == "dietary_preferences" and isinstance(value, list):
                value = json.dumps(value)
            elif key == "updated_at" and isinstance(value, datetime):
                value = value.isoformat()

            set_parts.append(f"{key} = ?")
            values.append(value)

        # Always update updated_at
        if "updated_at" not in updates:
            set_parts.append("updated_at = ?")
            values.append(datetime.now(UTC).isoformat())

        values.append(profile_id)

        try:
            await conn.execute(
                f"UPDATE user_profiles SET {', '.join(set_parts)} WHERE id = ?",
                values,
            )
            await conn.commit()
        except aiosqlite.IntegrityError as e:
            logger.error(f"Failed to update profile: {e}")
            raise ValueError("Username or email already exists") from e

        # Return updated profile
        profile = await self.get_profile_by_id(profile_id)
        if profile is None:
            raise ValueError(f"Profile not found: {profile_id}")
        return profile

    async def delete_profile(self, profile_id: str) -> bool:
        """Delete a user profile."""
        conn = self._get_conn()
        cursor = await conn.execute("DELETE FROM user_profiles WHERE id = ?", (profile_id,))
        await conn.commit()

        deleted = cursor.rowcount > 0
        if deleted:
            logger.debug(f"Deleted user profile: {profile_id}")
        return deleted

    # =========================================================================
    # Conversation history operations
    # =========================================================================

    async def save_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        intent: str | None = None,
    ) -> None:
        """Persist a single message turn to conversation history."""
        conn = self._get_conn()
        await conn.execute(
            """INSERT INTO conversation_history
               (id, conversation_id, role, content, intent, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                str(uuid4()),
                conversation_id,
                role,
                content,
                intent,
                datetime.now(UTC).isoformat(),
            ),
        )
        await conn.commit()
        logger.debug(f"Saved {role} message for conversation {conversation_id}")

    async def get_history(
        self,
        conversation_id: str,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Retrieve recent messages for a conversation, oldest-first."""
        conn = self._get_conn()
        async with conn.execute(
            """SELECT role, content, intent, created_at
               FROM conversation_history
               WHERE conversation_id = ?
               ORDER BY created_at ASC
               LIMIT ?""",
            (conversation_id, limit),
        ) as cursor:
            rows = await cursor.fetchall()
            return [
                {
                    "role": row["role"],
                    "content": row["content"],
                    "intent": row["intent"],
                    "created_at": row["created_at"],
                }
                for row in rows
            ]

    # =========================================================================
    # Proposal application
    # =========================================================================

    async def apply_pantry_proposal(
        self,
        actions: list[dict[str, Any]],
    ) -> tuple[int, int, list[str]]:
        """Apply a list of PantryUpsertAction dicts to the database.

        Returns (applied_count, failed_count, error_messages).
        """
        applied = 0
        failed = 0
        errors: list[str] = []

        for raw_action in actions:
            try:
                action_type = raw_action.get("action_type", "add")
                item_data = raw_action.get("item", {})

                if not item_data:
                    errors.append("Action missing item data")
                    failed += 1
                    continue

                name = item_data.get("name", "").strip()
                if not name:
                    errors.append("Item missing name")
                    failed += 1
                    continue

                if action_type in ("add", "update"):
                    # Try to find existing item by normalized name
                    existing = await self.find_similar_item(name)

                    # Build a PantryItem from the action data
                    category_str = item_data.get("category", "other")
                    try:
                        category = FoodCategory(category_str)
                    except ValueError:
                        category = FoodCategory.OTHER

                    location_str = (
                        item_data.get("storage_location")
                        or item_data.get("location", "pantry")
                    )
                    try:
                        location = StorageLocation(location_str)
                    except ValueError:
                        location = StorageLocation.PANTRY

                    quantity = float(item_data.get("quantity") or 1.0)
                    unit = item_data.get("unit") or "item"
                    expiry_date: date | None = None
                    if item_data.get("expiry_date"):
                        try:
                            expiry_date = date.fromisoformat(item_data["expiry_date"])
                        except (ValueError, TypeError):
                            pass

                    now = datetime.now(UTC)

                    if existing and action_type == "update":
                        await self.update_pantry_item(
                            str(existing.id),
                            {
                                "quantity": quantity,
                                "unit": unit,
                                "category": category,
                                "storage_location": location,
                                "expiry_date": expiry_date,
                                "updated_at": now,
                            },
                        )
                    elif existing:
                        # ADD to existing quantity
                        await self.update_pantry_item(
                            str(existing.id),
                            {
                                "quantity": existing.quantity + quantity,
                                "updated_at": now.isoformat(),
                            },
                        )
                    else:
                        new_item = PantryItem(
                            name=name,
                            category=category,
                            storage_location=location,
                            quantity=quantity,
                            unit=unit,
                            expiry_date=expiry_date,
                            created_at=now,
                            updated_at=now,
                        )
                        await self.add_pantry_item(new_item)

                    applied += 1

                elif action_type in ("remove", "use"):
                    existing = await self.find_similar_item(name)
                    if existing is None:
                        errors.append(f"Item not found for {action_type}: {name}")
                        failed += 1
                        continue

                    if action_type == "remove":
                        await self.delete_pantry_item(str(existing.id))
                    else:  # use — deduct quantity
                        use_qty = float(item_data.get("quantity") or existing.quantity)
                        new_qty = max(0.0, existing.quantity - use_qty)
                        if new_qty == 0.0:
                            await self.delete_pantry_item(str(existing.id))
                        else:
                            await self.update_pantry_item(
                                str(existing.id),
                                {
                                    "quantity": new_qty,
                                    "updated_at": datetime.now(UTC).isoformat(),
                                },
                            )
                    applied += 1

                else:
                    errors.append(f"Unknown action_type: {action_type}")
                    failed += 1

            except Exception as exc:
                item_name = raw_action.get("item", {}).get("name", "?")
                errors.append(f"Failed to apply action for '{item_name}': {exc}")
                failed += 1
                logger.warning(f"Error applying pantry action: {exc}", exc_info=True)

        logger.info(f"Applied pantry proposal: {applied} succeeded, {failed} failed")
        return applied, failed, errors


# Singleton instance
_repository: SQLiteRepository | None = None


async def get_repository() -> SQLiteRepository:
    """Get the singleton repository instance."""
    global _repository
    if _repository is None:
        _repository = SQLiteRepository()
        await _repository.initialize()
    return _repository
