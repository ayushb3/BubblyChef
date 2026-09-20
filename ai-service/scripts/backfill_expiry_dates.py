"""One-off backfill: estimate expiry_date for pantry rows missing one (#183).

DO NOT run this against a real database casually. It talks to whatever
Supabase project `ai-service/.env` points at (BUBBLY_SUPABASE_URL /
BUBBLY_SUPABASE_SECRET_KEY) via the normal service-role `SupabaseRepository`.

Safe by default: with no flags this is a DRY RUN. It reports what it would
change and writes nothing. Pass --apply to actually write.

Idempotent: rows are only selected while `expiry_date IS NULL`. Once a row
is backfilled it has a date and drops out of that filter, so re-running
(with or without --apply) can never touch it a second time. See
`bubbly_chef/services/expiry_backfill.py` for the full argument.

Usage:
    # Dry run for one user
    python scripts/backfill_expiry_dates.py --user-id <uuid>

    # Actually write, one user
    python scripts/backfill_expiry_dates.py --user-id <uuid> --apply

    # Dry run across every user with at least one expiry-missing row
    python scripts/backfill_expiry_dates.py --all-users

    # Actually write, every user
    python scripts/backfill_expiry_dates.py --all-users --apply
"""

from __future__ import annotations

import argparse
import asyncio

from bubbly_chef.repository.supabase_repo import SupabaseRepository
from bubbly_chef.services.expiry_backfill import (
    backfill_all_users_expiry,
    backfill_user_expiry,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--user-id", help="Backfill a single user's pantry rows.")
    target.add_argument(
        "--all-users",
        action="store_true",
        help="Backfill every user that has at least one expiry-missing pantry row.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually write changes. Without this flag, nothing is written — "
        "the script only reports what it would do.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=200,
        help="Rows fetched per page per user (default: 200).",
    )
    return parser.parse_args()


async def _run(args: argparse.Namespace) -> None:
    repo = SupabaseRepository()

    if not args.apply:
        print("*** DRY RUN — no rows will be written. Pass --apply to write. ***\n")

    if args.user_id:
        summary = await backfill_user_expiry(
            repo, args.user_id, apply=args.apply, batch_size=args.batch_size
        )
        print(summary.describe())
        return

    summaries = await backfill_all_users_expiry(
        repo, apply=args.apply, batch_size=args.batch_size
    )
    if not summaries:
        print("No users have pantry rows missing an expiry date. Nothing to do.")
        return

    for summary in summaries:
        print(summary.describe())

    total_examined = sum(s.examined for s in summaries)
    total_backfilled = sum(s.backfilled for s in summaries)
    total_skipped = sum(s.skipped_unestimatable for s in summaries)
    verb = "backfilled" if args.apply else "would backfill"
    print(
        f"\nTotal across {len(summaries)} user(s): examined={total_examined} "
        f"{verb}={total_backfilled} skipped_unestimatable={total_skipped}"
    )


def main() -> None:
    args = _parse_args()
    asyncio.run(_run(args))


if __name__ == "__main__":
    main()
