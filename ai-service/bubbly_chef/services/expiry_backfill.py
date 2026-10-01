"""One-off backfill of estimated expiry dates for pantry rows with none (#183).

Selection, estimation, write and undo logic for `scripts/backfill_expiry.py`.
Kept out of the script so it can be tested against an in-memory fake.

Contract (from the issue):
- only rows whose `expiry_date` IS NULL are candidates; a row that already has
  a date, user-entered or previously estimated, is never read as a candidate
  and is additionally protected at write time (the update is conditional on the
  date still being null, so a user edit that lands mid-run wins);
- every row it writes is marked `estimated_expiry = true`;
- deterministic only: the same `ExpiryHeuristics` the live write paths use
  (POST /v1/pantry/estimate-expiry, receipt/product ingest). No model call;
- idempotent: a second run finds no candidates except rows the estimator
  cannot handle, which stay null and are counted.

Anchor date. By default the estimate runs from the row's own `added_at`, i.e.
what the row would have got had it been estimated when it was created. The
alternative (`anchor="today"`) restarts the clock now, which never produces an
already-expired date but understates how stale an old row really is. The report
always says how many rows land already expired so the choice is visible.
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Literal, Protocol

from bubbly_chef.models.pantry import FoodCategory, StorageLocation
from bubbly_chef.tools.expiry import get_expiry_heuristics

logger = logging.getLogger(__name__)

Anchor = Literal["added", "today"]

DEFAULT_PAGE_SIZE = 500
DEFAULT_SAMPLE_SIZE = 10


class BackfillRepo(Protocol):
    """The slice of SupabaseRepository the backfill needs."""

    async def list_pantry_missing_expiry(
        self, after_id: str | None, limit: int
    ) -> list[dict[str, Any]]: ...

    async def set_backfilled_expiry(self, row_id: str, expiry: date) -> bool: ...

    async def revert_backfilled_expiry(self, row_id: str, expected: date) -> bool: ...


@dataclass(frozen=True)
class RowPlan:
    """What to do with one candidate row: an expiry, or a reason to skip it."""

    expiry: date | None
    skip_reason: str | None = None


def _parse_added_at(value: Any) -> date | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        return None


def plan_row(row: dict[str, Any], *, anchor: Anchor, today: date) -> RowPlan:
    """Compute the estimated expiry for one candidate row (pure, no I/O).

    A row whose category/location is not a recognised value, or whose anchor
    date is unusable, is reported rather than guessed at: the live write path
    coerces those to a default, but a bulk rewrite should not invent data for
    rows it cannot classify.
    """
    try:
        category = FoodCategory(str(row.get("category")))
    except ValueError:
        return RowPlan(None, "unknown_category")
    try:
        location = StorageLocation(str(row.get("location")))
    except ValueError:
        return RowPlan(None, "unknown_location")

    if anchor == "today":
        anchor_date = today
    else:
        parsed = _parse_added_at(row.get("added_at"))
        if parsed is None:
            return RowPlan(None, "no_added_at")
        anchor_date = parsed

    expiry, _is_estimated = get_expiry_heuristics().estimate_expiry(
        category=category,
        storage=location,
        name=row.get("name"),
        purchase_date=anchor_date,
    )
    return RowPlan(expiry)


@dataclass
class BackfillReport:
    applied: bool
    anchor: Anchor
    scanned: int = 0
    estimated: int = 0  # rows written (apply) or that would be written (dry run)
    already_expired: int = 0
    skipped_changed_underfoot: int = 0
    by_category: dict[str, int] = field(default_factory=dict)
    unestimatable: dict[str, int] = field(default_factory=dict)
    samples: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class UndoReport:
    reverted: int = 0
    left_alone: int = 0


def _open_undo_log(path: Path) -> Any:
    # "x" fails rather than truncating an earlier run's log.
    return path.open("x", encoding="utf-8")


async def run_backfill(
    repo: BackfillRepo,
    *,
    apply: bool,
    anchor: Anchor,
    today: date,
    undo_log: Path | None,
    page_size: int = DEFAULT_PAGE_SIZE,
    sample_size: int = DEFAULT_SAMPLE_SIZE,
) -> BackfillReport:
    """Walk every null-expiry row; estimate it; write it only when `apply`."""
    if apply and undo_log is None:
        raise ValueError("--apply needs an undo log path so the run can be reversed")

    report = BackfillReport(applied=apply, anchor=anchor)
    by_category: Counter[str] = Counter()
    unestimatable: Counter[str] = Counter()

    log_fh = _open_undo_log(undo_log) if apply and undo_log is not None else None
    try:
        after_id: str | None = None
        while True:
            page = await repo.list_pantry_missing_expiry(after_id, page_size)
            if not page:
                break
            for row in page:
                report.scanned += 1
                plan = plan_row(row, anchor=anchor, today=today)
                if plan.expiry is None:
                    unestimatable[plan.skip_reason or "unknown"] += 1
                    continue

                row_id = str(row["id"])
                if apply:
                    assert log_fh is not None  # guaranteed by the guard above
                    # Write-ahead: the log line lands before its update, so a
                    # crash can never leave a written row missing from the log.
                    log_fh.write(
                        json.dumps({"id": row_id, "expiry_date": plan.expiry.isoformat()}) + "\n"
                    )
                    log_fh.flush()
                    if not await repo.set_backfilled_expiry(row_id, plan.expiry):
                        report.skipped_changed_underfoot += 1
                        continue

                report.estimated += 1
                by_category[str(row.get("category"))] += 1
                if plan.expiry < today:
                    report.already_expired += 1
                if len(report.samples) < sample_size:
                    report.samples.append(
                        {
                            "id": row_id,
                            "name": row.get("name"),
                            "category": row.get("category"),
                            "location": row.get("location"),
                            "added_at": str(row.get("added_at"))[:10],
                            "proposed_expiry": plan.expiry.isoformat(),
                        }
                    )
            after_id = str(page[-1]["id"])
    finally:
        if log_fh is not None:
            log_fh.close()

    report.by_category = dict(by_category)
    report.unestimatable = dict(unestimatable)
    return report


async def undo_backfill(repo: BackfillRepo, undo_log: Path) -> UndoReport:
    """Reverse a previous `--apply` run using its undo log.

    A row is reverted only while it still holds exactly the date the backfill
    wrote AND is still flagged estimated. If the user has since edited it (the
    edit path clears the flag) it is left alone.
    """
    report = UndoReport()
    for line in undo_log.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        entry = json.loads(line)
        expected = date.fromisoformat(entry["expiry_date"])
        if await repo.revert_backfilled_expiry(str(entry["id"]), expected):
            report.reverted += 1
        else:
            report.left_alone += 1
    return report


def format_report(report: BackfillReport, *, total_label: str = "") -> str:
    """Human-readable summary. Carries row ids only, never user identifiers."""
    mode = "APPLIED" if report.applied else "DRY RUN (nothing written)"
    verb = "written" if report.applied else "would be written"
    lines = [
        f"Expiry backfill: {mode}",
        f"anchor: {report.anchor} (estimate counted from "
        + ("the row's added_at" if report.anchor == "added" else "today")
        + ")",
        f"rows with no expiry scanned: {report.scanned}",
        f"estimates {verb}: {report.estimated}",
        f"  of which already expired on arrival: {report.already_expired}",
    ]
    if report.skipped_changed_underfoot:
        lines.append(
            f"skipped (row gained an expiry mid-run, left as the user set it): "
            f"{report.skipped_changed_underfoot}"
        )
    lines.append("by category:")
    for cat, n in sorted(report.by_category.items(), key=lambda kv: (-kv[1], kv[0])):
        lines.append(f"  {cat}: {n}")
    if not report.by_category:
        lines.append("  (none)")
    unest_total = sum(report.unestimatable.values())
    lines.append(f"left null, could not be estimated: {unest_total}")
    for reason, n in sorted(report.unestimatable.items()):
        lines.append(f"  {reason}: {n}")
    if report.samples:
        lines.append(f"sample rows ({len(report.samples)}):")
        for s in report.samples:
            lines.append(
                f"  {s['id']}  {s['name']!r}  {s['category']}/{s['location']}  "
                f"added {s['added_at']} -> {s['proposed_expiry']}"
            )
    if total_label:
        lines.append(total_label)
    return "\n".join(lines)


def default_undo_log_path(now: datetime | None = None) -> Path:
    stamp = (now or datetime.now(UTC)).strftime("%Y%m%dT%H%M%SZ")
    return Path(f"backfill_expiry_undo_{stamp}.jsonl")
