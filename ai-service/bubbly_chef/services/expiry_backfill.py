"""Backfill expiry estimates for pantry rows with no expiry_date (issue #183).

Existing pantry rows created before default-expiry estimation shipped have
`expiry_date IS NULL`. They never show up in expiring-soon / use-soon
surfaces. This module applies the same heuristic
`apply_pantry_proposal` already uses (`get_expiry_heuristics()`) to those
rows, and — because a backfilled date is by definition a guess, never a
label/receipt/user-entered value — always sets `estimated_expiry=True` on
what it writes (see #182, #363, #439 on why that flag must never be
misrepresented).

Idempotency
-----------
`SupabaseRepository.get_pantry_rows_missing_expiry` filters on
`expiry_date IS NULL`. The moment a row is backfilled it has a non-null
expiry_date, so it no longer matches that filter and can never be selected
by a later run — there is no separate "already processed" marker to
maintain, and a re-run degenerates to an empty result set (a no-op) once
every reachable row has been resolved. A dry run writes nothing, so it
cannot change what the next run (dry or real) sees either.

This module contains only the traversal + estimation logic; it never talks
to Supabase directly (`SupabaseRepository` does), and it never decides
dry-run vs. apply on its own — that's the caller's job (see
`scripts/backfill_expiry_dates.py`), keeping the safe default (dry run)
visible at the call site rather than buried in here.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from bubbly_chef.models.pantry import FoodCategory, StorageLocation
from bubbly_chef.tools.expiry import ExpiryHeuristics, get_expiry_heuristics


class ExpiryBackfillRepo(Protocol):
    """The slice of `SupabaseRepository` this backfill depends on.

    A `Protocol` rather than importing `SupabaseRepository` directly keeps
    this module (and its tests) decoupled from a real Supabase client —
    anything with these three methods works, including a plain in-memory
    fake in tests.
    """

    async def get_pantry_rows_missing_expiry(
        self,
        user_id: str,
        *,
        after_id: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]: ...

    async def list_user_ids_missing_pantry_expiry(
        self,
        *,
        after_id: str | None = None,
        limit: int = 500,
    ) -> list[dict[str, Any]]: ...

    async def update_pantry_item(
        self, user_id: str, item_id: str, updates: dict[str, Any]
    ) -> Any: ...


@dataclass
class BackfillSummary:
    """What happened (or would happen) for one user's backfill pass."""

    user_id: str
    applied: bool
    examined: int = 0
    backfilled: int = 0
    skipped_unestimatable: int = 0

    def describe(self) -> str:
        verb = "backfilled" if self.applied else "would backfill"
        mode = "apply" if self.applied else "dry-run"
        return (
            f"user={self.user_id} [{mode}] examined={self.examined} "
            f"{verb}={self.backfilled} skipped_unestimatable={self.skipped_unestimatable}"
        )


async def backfill_user_expiry(
    repo: ExpiryBackfillRepo,
    user_id: str,
    *,
    apply: bool,
    batch_size: int = 200,
    heuristics: ExpiryHeuristics | None = None,
) -> BackfillSummary:
    """Backfill missing `expiry_date` for one user's pantry rows.

    Pages through `repo.get_pantry_rows_missing_expiry` in batches of
    `batch_size` rather than loading the whole table. For each row:

    - a category/location string that doesn't map to a known
      `FoodCategory`/`StorageLocation` is left untouched and counted under
      `skipped_unestimatable` — writing a null or a made-up date would be
      worse than leaving the row as-is;
    - otherwise the row is scored with the same
      `get_expiry_heuristics().estimate_expiry` call `apply_pantry_proposal`
      uses. If `apply` is True the result is written back with
      `estimated_expiry=True` (a backfilled date is always a guess); if
      `apply` is False nothing is written and the row is only counted.
    """
    heuristics = heuristics or get_expiry_heuristics()
    summary = BackfillSummary(user_id=user_id, applied=apply)
    after_id: str | None = None

    while True:
        rows = await repo.get_pantry_rows_missing_expiry(
            user_id, after_id=after_id, limit=batch_size
        )
        if not rows:
            break

        for row in rows:
            summary.examined += 1
            row_id = str(row["id"])
            after_id = row_id

            try:
                category = FoodCategory(row.get("category") or FoodCategory.OTHER)
                location = StorageLocation(row.get("location") or StorageLocation.PANTRY)
            except ValueError:
                summary.skipped_unestimatable += 1
                continue

            expiry_date, _is_estimated = heuristics.estimate_expiry(
                category=category,
                storage=location,
                name=row.get("name"),
            )
            if expiry_date is None:
                summary.skipped_unestimatable += 1
                continue

            summary.backfilled += 1
            if apply:
                await repo.update_pantry_item(
                    user_id,
                    row_id,
                    {
                        "expiry_date": expiry_date.isoformat(),
                        "estimated_expiry": True,
                    },
                )

        if len(rows) < batch_size:
            break

    return summary


async def backfill_all_users_expiry(
    repo: ExpiryBackfillRepo,
    *,
    apply: bool,
    batch_size: int = 200,
    user_page_size: int = 500,
    heuristics: ExpiryHeuristics | None = None,
) -> list[BackfillSummary]:
    """Backfill every user that has at least one expiry-missing pantry row.

    Every `SupabaseRepository` call in this module still takes `user_id`
    first — this function only adds a discovery step (paging distinct
    `user_id`s off rows missing an expiry) in front of a per-user call to
    `backfill_user_expiry`, it never queries or writes across users in one
    call.
    """
    user_ids: list[str] = []
    seen: set[str] = set()
    after_id: str | None = None

    while True:
        rows = await repo.list_user_ids_missing_pantry_expiry(
            after_id=after_id, limit=user_page_size
        )
        if not rows:
            break
        for row in rows:
            after_id = str(row["id"])
            uid = str(row["user_id"])
            if uid not in seen:
                seen.add(uid)
                user_ids.append(uid)
        if len(rows) < user_page_size:
            break

    summaries = []
    for uid in user_ids:
        summaries.append(
            await backfill_user_expiry(
                repo, uid, apply=apply, batch_size=batch_size, heuristics=heuristics
            )
        )
    return summaries
