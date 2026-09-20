"""Tests for the expiry backfill service (#183).

Everything here runs against an in-memory fake repository — no network, no
real Supabase client is ever constructed. See CLAUDE.md: this backfill must
never be executed against the real hosted project from an agent session.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest

from bubbly_chef.models.pantry import FoodCategory, StorageLocation
from bubbly_chef.services.expiry_backfill import (
    backfill_all_users_expiry,
    backfill_user_expiry,
)
from bubbly_chef.tools.expiry import ExpiryHeuristics


class _FakeExpiryBackfillRepo:
    """In-memory stand-in for the `SupabaseRepository` slice this service uses.

    Mutates its own `rows` dict on `update_pantry_item`, and re-filters on
    every call to `get_pantry_rows_missing_expiry` — so a second pass over
    the same instance genuinely proves idempotency rather than assuming it.
    """

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows: dict[str, dict[str, Any]] = {r["id"]: dict(r) for r in rows}
        self.update_calls: list[tuple[str, str, dict[str, Any]]] = []

    def _missing_expiry(self, user_id: str | None = None) -> list[dict[str, Any]]:
        matching = [
            r
            for r in self.rows.values()
            if r.get("expiry_date") is None and (user_id is None or r["user_id"] == user_id)
        ]
        return sorted(matching, key=lambda r: r["id"])

    async def get_pantry_rows_missing_expiry(
        self,
        user_id: str,
        *,
        after_id: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        matching = self._missing_expiry(user_id)
        if after_id is not None:
            matching = [r for r in matching if r["id"] > after_id]
        return matching[:limit]

    async def list_user_ids_missing_pantry_expiry(
        self,
        *,
        after_id: str | None = None,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        matching = self._missing_expiry()
        if after_id is not None:
            matching = [r for r in matching if r["id"] > after_id]
        return [{"id": r["id"], "user_id": r["user_id"]} for r in matching[:limit]]

    async def update_pantry_item(
        self, user_id: str, item_id: str, updates: dict[str, Any]
    ) -> dict[str, Any]:
        self.update_calls.append((user_id, item_id, dict(updates)))
        self.rows[item_id].update(updates)
        return self.rows[item_id]


class _NoMatchHeuristics(ExpiryHeuristics):
    """Simulates a category/storage combo the heuristic genuinely can't score."""

    def estimate_expiry(  # type: ignore[override]
        self,
        category: FoodCategory,
        storage: StorageLocation | None = None,
        name: str | None = None,
        purchase_date: date | None = None,
    ) -> tuple[date | None, bool]:
        return None, False


def _row(
    row_id: str,
    user_id: str = "user-1",
    name: str = "banana",
    category: str = "produce",
    location: str = "fridge",
    expiry_date: str | None = None,
) -> dict[str, Any]:
    return {
        "id": row_id,
        "user_id": user_id,
        "name": name,
        "category": category,
        "location": location,
        "expiry_date": expiry_date,
    }


@pytest.mark.asyncio
class TestBackfillUserExpiry:
    async def test_row_with_no_expiry_gets_heuristic_date_and_estimated_flag(self) -> None:
        repo = _FakeExpiryBackfillRepo([_row("r1")])

        summary = await backfill_user_expiry(repo, "user-1", apply=True)

        assert summary.examined == 1
        assert summary.backfilled == 1
        assert summary.skipped_unestimatable == 0
        assert len(repo.update_calls) == 1
        _, item_id, updates = repo.update_calls[0]
        assert item_id == "r1"
        assert updates["estimated_expiry"] is True
        assert updates["expiry_date"] is not None
        # Written straight to the fake's store too.
        assert repo.rows["r1"]["expiry_date"] == updates["expiry_date"]

    async def test_row_with_existing_expiry_is_left_completely_untouched(self) -> None:
        """The idempotency guarantee: rows the query never returns are never seen."""
        repo = _FakeExpiryBackfillRepo(
            [_row("r1", expiry_date="2026-01-01"), _row("r2", expiry_date=None)]
        )

        summary = await backfill_user_expiry(repo, "user-1", apply=True)

        # Only r2 (missing expiry) was examined at all.
        assert summary.examined == 1
        assert [c[1] for c in repo.update_calls] == ["r2"]
        assert repo.rows["r1"]["expiry_date"] == "2026-01-01"

    async def test_second_run_over_already_backfilled_data_writes_nothing(self) -> None:
        repo = _FakeExpiryBackfillRepo([_row("r1")])

        first = await backfill_user_expiry(repo, "user-1", apply=True)
        assert first.backfilled == 1
        assert len(repo.update_calls) == 1

        second = await backfill_user_expiry(repo, "user-1", apply=True)

        assert second.examined == 0
        assert second.backfilled == 0
        # No new write call — still exactly the one from the first run.
        assert len(repo.update_calls) == 1

    async def test_item_the_heuristic_cannot_estimate_is_skipped_not_nulled(self) -> None:
        repo = _FakeExpiryBackfillRepo([_row("r1")])

        summary = await backfill_user_expiry(
            repo, "user-1", apply=True, heuristics=_NoMatchHeuristics()
        )

        assert summary.examined == 1
        assert summary.backfilled == 0
        assert summary.skipped_unestimatable == 1
        assert repo.update_calls == []
        assert repo.rows["r1"]["expiry_date"] is None

    async def test_unknown_category_string_is_skipped_not_nulled(self) -> None:
        repo = _FakeExpiryBackfillRepo([_row("r1", category="not-a-real-category")])

        summary = await backfill_user_expiry(repo, "user-1", apply=True)

        assert summary.examined == 1
        assert summary.backfilled == 0
        assert summary.skipped_unestimatable == 1
        assert repo.update_calls == []

    async def test_dry_run_writes_nothing(self) -> None:
        repo = _FakeExpiryBackfillRepo([_row("r1")])

        summary = await backfill_user_expiry(repo, "user-1", apply=False)

        assert summary.examined == 1
        assert summary.backfilled == 1  # "would backfill" count
        assert repo.update_calls == []
        assert repo.rows["r1"]["expiry_date"] is None

        # And a second dry run reports the exact same thing — still a no-op.
        again = await backfill_user_expiry(repo, "user-1", apply=False)
        assert again.examined == 1
        assert again.backfilled == 1
        assert repo.update_calls == []

    async def test_pagination_walks_multiple_batches(self) -> None:
        rows = [_row(f"r{i}") for i in range(5)]
        repo = _FakeExpiryBackfillRepo(rows)

        summary = await backfill_user_expiry(repo, "user-1", apply=True, batch_size=2)

        assert summary.examined == 5
        assert summary.backfilled == 5
        assert len(repo.update_calls) == 5

    async def test_only_scopes_to_the_requested_user(self) -> None:
        repo = _FakeExpiryBackfillRepo(
            [_row("r1", user_id="user-1"), _row("r2", user_id="user-2")]
        )

        summary = await backfill_user_expiry(repo, "user-1", apply=True)

        assert summary.examined == 1
        assert repo.update_calls[0][0] == "user-1"
        assert repo.rows["r2"]["expiry_date"] is None


@pytest.mark.asyncio
class TestBackfillAllUsersExpiry:
    async def test_discovers_and_backfills_every_user_with_a_missing_row(self) -> None:
        repo = _FakeExpiryBackfillRepo(
            [
                _row("r1", user_id="user-1"),
                _row("r2", user_id="user-2"),
                _row("r3", user_id="user-1", expiry_date="2026-01-01"),
            ]
        )

        summaries = await backfill_all_users_expiry(repo, apply=True)

        assert {s.user_id for s in summaries} == {"user-1", "user-2"}
        assert sum(s.backfilled for s in summaries) == 2
        assert len(repo.update_calls) == 2

    async def test_no_users_missing_expiry_returns_empty_list(self) -> None:
        repo = _FakeExpiryBackfillRepo([_row("r1", expiry_date="2026-01-01")])

        summaries = await backfill_all_users_expiry(repo, apply=True)

        assert summaries == []
        assert repo.update_calls == []

    async def test_dry_run_across_all_users_writes_nothing(self) -> None:
        repo = _FakeExpiryBackfillRepo(
            [_row("r1", user_id="user-1"), _row("r2", user_id="user-2")]
        )

        summaries = await backfill_all_users_expiry(repo, apply=False)

        assert sum(s.backfilled for s in summaries) == 2
        assert repo.update_calls == []
