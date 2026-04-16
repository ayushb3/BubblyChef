"""One-time migration: SQLite → Supabase.

Usage:
    export SUPABASE_URL=https://xxx.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=eyJ...
    python scripts/migrate_sqlite_to_supabase.py [--db bubbly_chef.db] [--user-email you@email.com]

This script:
1. Creates a Supabase auth user for the given email (or uses existing)
2. Reads all data from the local SQLite database
3. Inserts it into Supabase with the user_id set to the auth user
"""

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime

from supabase import create_client


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate SQLite data to Supabase")
    parser.add_argument("--db", default="bubbly_chef.db", help="Path to SQLite database")
    parser.add_argument("--user-email", required=True, help="Email for the Supabase auth user")
    parser.add_argument("--user-password", default="changeme123!", help="Password for the auth user")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be migrated without writing")
    return parser.parse_args()


def get_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Error: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables")
        sys.exit(1)
    return create_client(url, key)


def get_or_create_user(supabase, email: str, password: str) -> str:
    """Get existing user or create new one. Returns user_id."""
    # Try to find existing user
    try:
        result = supabase.auth.admin.list_users()
        for user in result:
            if hasattr(user, "email") and user.email == email:
                print(f"  Found existing user: {user.id}")
                return user.id
    except Exception:
        pass

    # Create new user
    result = supabase.auth.admin.create_user({
        "email": email,
        "password": password,
        "email_confirm": True,
    })
    user_id = result.user.id
    print(f"  Created user: {user_id}")
    return user_id


def read_sqlite(db_path: str) -> dict:
    """Read all tables from SQLite."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    data = {}

    tables = [
        "pantry_items", "recipes", "user_profiles",
        "conversation_history", "conversation_sessions",
        "decorations", "ingestion_logs",
    ]

    for table in tables:
        try:
            cursor = conn.execute(f"SELECT * FROM {table}")  # noqa: S608
            rows = [dict(row) for row in cursor.fetchall()]
            data[table] = rows
            print(f"  {table}: {len(rows)} rows")
        except sqlite3.OperationalError:
            data[table] = []
            print(f"  {table}: table not found, skipping")

    conn.close()
    return data


def parse_json_field(value: str | None) -> list | dict:
    """Safely parse a JSON string field."""
    if not value:
        return []
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return []


def migrate_pantry_items(supabase, rows: list, user_id: str, dry_run: bool) -> int:
    """Migrate pantry_items from SQLite to Supabase."""
    records = []
    for row in rows:
        records.append({
            "user_id": user_id,
            "name": row["name"],
            "name_normalized": row.get("name_normalized", row["name"].lower().strip()),
            "category": row.get("category", "other"),
            "location": row.get("location", "pantry"),
            "quantity": float(row.get("quantity", 1.0)),
            "unit": row.get("unit", "item"),
            "expiry_date": row.get("expiry_date"),  # TEXT date → DATE (ISO format works)
            "slot_index": row.get("slot_index"),
        })

    if dry_run:
        return len(records)

    if records:
        supabase.table("pantry_items").insert(records).execute()
    return len(records)


def migrate_recipes(supabase, rows: list, user_id: str, dry_run: bool) -> int:
    """Migrate recipes from SQLite to Supabase."""
    records = []
    for row in rows:
        records.append({
            "user_id": user_id,
            "title": row["title"],
            "description": row.get("description"),
            "ingredients": parse_json_field(row.get("ingredients", "[]")),
            "instructions": parse_json_field(row.get("instructions", "[]")),
            "prep_time_minutes": row.get("prep_time_minutes"),
            "cook_time_minutes": row.get("cook_time_minutes"),
            "total_time_minutes": row.get("total_time_minutes"),
            "servings": row.get("servings"),
            "source_url": row.get("source_url"),
            "tags": parse_json_field(row.get("tags", "[]")),
            "difficulty": row.get("difficulty"),
            "source_type": row.get("source_type", "chat"),
            "source_title": row.get("source_title"),
            "thumbnail_url": row.get("thumbnail_url"),
            "is_draft": bool(row.get("is_draft", 0)),
            "cuisine": row.get("cuisine"),
            "meal_type": row.get("meal_type"),
        })

    if dry_run:
        return len(records)

    if records:
        supabase.table("recipes").insert(records).execute()
    return len(records)


def migrate_conversation_history(supabase, rows: list, user_id: str, dry_run: bool) -> int:
    """Migrate conversation_history from SQLite to Supabase."""
    records = []
    for row in rows:
        records.append({
            "user_id": user_id,
            "conversation_id": row["conversation_id"],
            "role": row["role"],
            "content": row["content"],
            "intent": row.get("intent"),
        })

    if dry_run:
        return len(records)

    # Insert in batches of 500 (conversation history can be large)
    for i in range(0, len(records), 500):
        batch = records[i : i + 500]
        supabase.table("conversation_history").insert(batch).execute()
    return len(records)


def migrate_conversation_sessions(supabase, rows: list, user_id: str, dry_run: bool) -> int:
    """Migrate conversation_sessions from SQLite to Supabase."""
    records = []
    for row in rows:
        records.append({
            "conversation_id": row["conversation_id"],
            "user_id": user_id,
            "active_mode": row.get("active_mode", "default"),
            "pinned_recipe_id": row.get("pinned_recipe_id"),
            "pending_proposal": parse_json_field(row.get("pending_proposal")),
            "metadata": parse_json_field(row.get("metadata", "{}")),
        })

    if dry_run:
        return len(records)

    if records:
        supabase.table("conversation_sessions").insert(records).execute()
    return len(records)


def migrate_decorations(supabase, rows: list, user_id: str, dry_run: bool) -> int:
    """Migrate decorations from SQLite to Supabase."""
    records = []
    for row in rows:
        records.append({
            "user_id": user_id,
            "name": row["name"],
            "decoration_type": row.get("decoration_type", "plant"),
            "unlocked_at": row.get("unlocked_at"),
            "milestone": row.get("milestone"),
        })

    if dry_run:
        return len(records)

    if records:
        supabase.table("decorations").insert(records).execute()
    return len(records)


def migrate_ingestion_logs(supabase, rows: list, user_id: str, dry_run: bool) -> int:
    """Migrate ingestion_logs from SQLite to Supabase."""
    records = []
    for row in rows:
        records.append({
            "user_id": user_id,
            "request_id": row["request_id"],
            "intent": row["intent"],
            "input_payload": parse_json_field(row.get("input_payload", "{}")),
            "proposal": parse_json_field(row.get("proposal")) if row.get("proposal") else None,
            "errors": parse_json_field(row.get("errors", "[]")),
        })

    if dry_run:
        return len(records)

    if records:
        for i in range(0, len(records), 500):
            batch = records[i : i + 500]
            supabase.table("ingestion_logs").insert(batch).execute()
    return len(records)


def main() -> None:
    args = parse_args()

    print(f"\n=== BubblyChef SQLite → Supabase Migration ===\n")
    if args.dry_run:
        print("  *** DRY RUN — no data will be written ***\n")

    # Connect to Supabase
    print("1. Connecting to Supabase...")
    supabase = get_supabase_client()

    # Get or create user
    print(f"2. Setting up user ({args.user_email})...")
    user_id = get_or_create_user(supabase, args.user_email, args.user_password)

    # Read SQLite data
    print(f"\n3. Reading SQLite database ({args.db})...")
    data = read_sqlite(args.db)

    # Migrate each table
    print("\n4. Migrating data...\n")

    migrators = {
        "pantry_items": migrate_pantry_items,
        "recipes": migrate_recipes,
        "conversation_history": migrate_conversation_history,
        "conversation_sessions": migrate_conversation_sessions,
        "decorations": migrate_decorations,
        "ingestion_logs": migrate_ingestion_logs,
    }

    total = 0
    for table, migrator in migrators.items():
        rows = data.get(table, [])
        if rows:
            count = migrator(supabase, rows, user_id, args.dry_run)
            action = "would migrate" if args.dry_run else "migrated"
            print(f"  {table}: {action} {count} rows")
            total += count
        else:
            print(f"  {table}: no data to migrate")

    # Skip user_profiles — the trigger on auth.users handles this
    print(f"\n  user_profiles: created automatically by signup trigger")

    print(f"\n=== Done! {total} total rows {'would be ' if args.dry_run else ''}migrated ===\n")


if __name__ == "__main__":
    main()
