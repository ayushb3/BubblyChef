"""SQLite repository implementation."""

import logging
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import aiosqlite

from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
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
        """
        )

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
                expiry_date, added_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(item.id),
                item.name,
                item.name.lower().strip(),
                item.category.value,
                item.storage_location.value,
                item.quantity,
                item.unit,
                item.expiry_date.isoformat() if item.expiry_date else None,
                item.created_at.isoformat(),
                item.updated_at.isoformat(),
            ),
        )
        await conn.commit()

        logger.debug(f"Added pantry item: {item.name} ({item.id})")
        return item

    async def update_pantry_item(self, item_id: str, updates: dict[str, Any]) -> PantryItem:
        """Update an existing pantry item."""
        conn = self._get_conn()

        # Build SET clause
        set_parts = []
        values = []

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

        # Return updated item
        item = await self.get_pantry_item(item_id)
        if item is None:
            raise ValueError(f"Item not found: {item_id}")
        return item

    async def delete_pantry_item(self, item_id: str) -> bool:
        """Delete a pantry item."""
        conn = self._get_conn()
        cursor = await conn.execute("DELETE FROM pantry_items WHERE id = ?", (item_id,))
        await conn.commit()

        deleted = cursor.rowcount > 0
        if deleted:
            logger.debug(f"Deleted pantry item: {item_id}")
        return deleted

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
            values.append(datetime.utcnow().isoformat())

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


# Singleton instance
_repository: SQLiteRepository | None = None


async def get_repository() -> SQLiteRepository:
    """Get the singleton repository instance."""
    global _repository
    if _repository is None:
        _repository = SQLiteRepository()
        await _repository.initialize()
    return _repository
