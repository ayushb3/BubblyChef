"""SQLite repository implementation."""

import logging
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import aiosqlite

from bubbly_chef.models.pantry import PantryItem, Category, Location

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
            name_normalized=row["name_normalized"],
            category=Category(row["category"]),
            location=Location(row["location"]),
            quantity=row["quantity"],
            unit=row["unit"],
            expiry_date=(
                date.fromisoformat(row["expiry_date"]) if row["expiry_date"] else None
            ),
            added_at=datetime.fromisoformat(row["added_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

    async def get_pantry_item(self, item_id: str) -> PantryItem | None:
        """Get a single pantry item by ID."""
        conn = self._get_conn()
        async with conn.execute(
            "SELECT * FROM pantry_items WHERE id = ?", (item_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                return self._row_to_pantry_item(row)
        return None

    async def get_all_pantry_items(self) -> list[PantryItem]:
        """Get all pantry items."""
        conn = self._get_conn()
        async with conn.execute(
            "SELECT * FROM pantry_items ORDER BY name"
        ) as cursor:
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
                item.id,
                item.name,
                item.name_normalized,
                item.category.value,
                item.location.value,
                item.quantity,
                item.unit,
                item.expiry_date.isoformat() if item.expiry_date else None,
                item.added_at.isoformat(),
                item.updated_at.isoformat(),
            ),
        )
        await conn.commit()

        logger.debug(f"Added pantry item: {item.name} ({item.id})")
        return item

    async def update_pantry_item(
        self, item_id: str, updates: dict[str, Any]
    ) -> PantryItem:
        """Update an existing pantry item."""
        conn = self._get_conn()

        # Build SET clause
        set_parts = []
        values = []

        for key, value in updates.items():
            if key == "category" and isinstance(value, Category):
                value = value.value
            elif key == "location" and isinstance(value, Location):
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
        cursor = await conn.execute(
            "DELETE FROM pantry_items WHERE id = ?", (item_id,)
        )
        await conn.commit()

        deleted = cursor.rowcount > 0
        if deleted:
            logger.debug(f"Deleted pantry item: {item_id}")
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
