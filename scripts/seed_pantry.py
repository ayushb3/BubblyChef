#!/usr/bin/env python3
"""Seed a realistic pantry for a test user.

Populates a believable weekly-shop kitchen (~30 items) with quantities, storage
locations, categories, and expiry dates computed *relative to today* — so the
expiring-soon / "cook this before it goes bad" features always have live data
to work against, no matter when the script is run.

Usage:
    cd ai-service && ./.venv/bin/python ../scripts/seed_pantry.py --email bubbly@test.local
    ./.venv/bin/python ../scripts/seed_pantry.py --user-id <uuid>
    ./.venv/bin/python ../scripts/seed_pantry.py --email bubbly@test.local --keep  # add on top

By default the target user's existing pantry_items are WIPED before seeding
(pass --keep to add alongside instead).

Reads Supabase creds from ai-service/.env via bubbly_chef.config.settings — run
it with the ai-service venv so those settings resolve. Uses the service_role
key, so it can look up auth users by email and bypass RLS to write rows.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import date, timedelta

from supabase import Client, create_client

from bubbly_chef.config import settings


@dataclass(frozen=True)
class SeedItem:
    """One pantry line. `days` is an offset from today for expiry_date.

    days > 0  → expires in the future
    days == 0 → expires today
    days < 0  → already expired
    days is None → no expiry (shelf-stable staples)
    """

    name: str
    category: str
    location: str
    quantity: float
    unit: str
    days: int | None


# A realistic weekly-shop kitchen. Expiry offsets are spread deliberately:
# a few items expiring in 0-3 days (lights up expiring-soon + R3 check_pantry),
# a band of fresh produce/dairy over the week, proteins in the fridge/freezer,
# and shelf-stable staples with far-off or no expiry.
SEED_ITEMS: list[SeedItem] = [
    # ─── Expiring very soon (0-3 days) — drives the "use it first" features ───
    SeedItem("baby spinach", "produce", "fridge", 1, "bag", 1),
    SeedItem("strawberries", "produce", "fridge", 1, "punnet", 2),
    SeedItem("ground beef", "meat", "fridge", 500, "g", 1),
    SeedItem("fresh basil", "produce", "fridge", 1, "bunch", 0),
    SeedItem("greek yogurt", "dairy", "fridge", 500, "g", 3),
    # ─── Fresh, this week (4-10 days) ─────────────────────────────────────────
    SeedItem("whole milk", "dairy", "fridge", 2, "L", 6),
    SeedItem("large free-range eggs", "dairy", "fridge", 12, "count", 18),
    SeedItem("chicken breast", "meat", "fridge", 600, "g", 4),
    SeedItem("cheddar cheese", "dairy", "fridge", 250, "g", 21),
    SeedItem("carrots", "produce", "fridge", 1, "kg", 14),
    SeedItem("broccoli", "produce", "fridge", 2, "head", 5),
    SeedItem("red bell peppers", "produce", "fridge", 3, "count", 8),
    SeedItem("bananas", "produce", "counter", 6, "count", 4),
    SeedItem("avocados", "produce", "counter", 3, "count", 3),
    SeedItem("sourdough bread", "bakery", "counter", 1, "loaf", 4),
    SeedItem("salmon fillet", "seafood", "fridge", 400, "g", 2),
    SeedItem("butter", "dairy", "fridge", 250, "g", 45),
    # ─── Freezer ──────────────────────────────────────────────────────────────
    SeedItem("frozen peas", "frozen", "freezer", 1, "kg", 180),
    SeedItem("frozen berries", "frozen", "freezer", 500, "g", 200),
    # ─── Dry goods & shelf-stable staples (far-off or no expiry) ──────────────
    SeedItem("spaghetti", "dry_goods", "pantry", 500, "g", 400),
    SeedItem("basmati rice", "dry_goods", "pantry", 2, "kg", 500),
    SeedItem("all-purpose flour", "dry_goods", "pantry", 1, "kg", 300),
    SeedItem("rolled oats", "dry_goods", "pantry", 1, "kg", 250),
    SeedItem("canned chopped tomatoes", "canned", "pantry", 4, "can", 600),
    SeedItem("chickpeas", "canned", "pantry", 2, "can", 550),
    SeedItem("olive oil", "condiments", "pantry", 750, "ml", 400),
    SeedItem("soy sauce", "condiments", "pantry", 500, "ml", 500),
    SeedItem("honey", "condiments", "pantry", 340, "g", None),
    SeedItem("salt", "condiments", "pantry", 1, "kg", None),
    SeedItem("garlic", "produce", "pantry", 2, "bulb", 30),
    SeedItem("yellow onions", "produce", "pantry", 5, "count", 25),
    SeedItem("ground coffee", "beverages", "pantry", 500, "g", 120),
]


def _client() -> Client:
    if not settings.supabase_url or not settings.supabase_secret_key:
        sys.exit(
            "Missing Supabase creds. Run this with the ai-service venv so "
            "BUBBLY_SUPABASE_URL / BUBBLY_SUPABASE_SECRET_KEY resolve from .env."
        )
    return create_client(settings.supabase_url, settings.supabase_secret_key)


def resolve_user_id(client: Client, email: str) -> str:
    """Look up an auth user's id by email via the admin API (paginated)."""
    page = 1
    while True:
        resp = client.auth.admin.list_users(page=page, per_page=200)
        users = resp if isinstance(resp, list) else getattr(resp, "users", resp)
        if not users:
            break
        for user in users:
            if (getattr(user, "email", "") or "").lower() == email.lower():
                return str(user.id)
        if len(users) < 200:
            break
        page += 1
    sys.exit(f"No auth user found with email {email!r}.")


def wipe_pantry(client: Client, user_id: str) -> int:
    existing = (
        client.table("pantry_items").select("id").eq("user_id", user_id).execute()
    )
    count = len(existing.data)
    if count:
        client.table("pantry_items").delete().eq("user_id", user_id).execute()
    return count


def _row(item: SeedItem, user_id: str, today: date, slot: int) -> dict[str, object]:
    expiry = None if item.days is None else (today + timedelta(days=item.days)).isoformat()
    return {
        "user_id": user_id,
        "name": item.name,
        "name_normalized": item.name.lower().strip(),
        "category": item.category,
        "location": item.location,
        "quantity": float(item.quantity),
        "unit": item.unit,
        "expiry_date": expiry,
        "slot_index": slot,
    }


def seed(client: Client, user_id: str, today: date) -> int:
    rows = [_row(item, user_id, today, i) for i, item in enumerate(SEED_ITEMS)]
    client.table("pantry_items").insert(rows).execute()
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed a realistic test pantry.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--email", help="Auth user email to resolve to a user_id.")
    group.add_argument("--user-id", help="Auth user UUID to seed directly.")
    parser.add_argument(
        "--keep",
        action="store_true",
        help="Add items alongside existing pantry rows instead of wiping first.",
    )
    args = parser.parse_args()

    client = _client()
    user_id = args.user_id or resolve_user_id(client, args.email)
    today = date.today()

    if not args.keep:
        wiped = wipe_pantry(client, user_id)
        print(f"Wiped {wiped} existing pantry item(s) for user {user_id}.")

    added = seed(client, user_id, today)
    expiring = sum(1 for it in SEED_ITEMS if it.days is not None and it.days <= 3)
    print(f"Seeded {added} realistic pantry items ({expiring} expiring within 3 days).")
    print(f"Expiry dates are relative to {today.isoformat()}.")


if __name__ == "__main__":
    main()
