"""Tests for the one-off expiry backfill (#183).

The backfill gives every pantry row with NO expiry date an estimated one, marks
it `estimated_expiry = true`, and never touches a row that already has a date
(user-entered or previously estimated). These tests run the real selection /
estimation / undo logic against an in-memory fake of the three repository
methods the script needs, so no database or model is involved.
"""

from __future__ import annotations

import importlib.util
import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest

from bubbly_chef.services.expiry_backfill import (
    plan_row,
    run_backfill,
    undo_backfill,
)
from bubbly_chef.models.pantry import FoodCategory, StorageLocation
from bubbly_chef.tools.expiry import get_expiry_heuristics

TODAY = date(2026, 9, 30)


def _row(
    row_id: str,
    *,
    name: str = "thing",
    category: str = "produce",
    location: str = "fridge",
    added_at: str = "2026-09-20T10:00:00+00:00",
    expiry_date: str | None = None,
    estimated_expiry: bool = False,
) -> dict[str, Any]:
    return {
        "id": row_id,
        "user_id": "user-" + row_id,
        "name": name,
        "category": category,
        "location": location,
        "added_at": added_at,
        "expiry_date": expiry_date,
        "estimated_expiry": estimated_expiry,
    }


class FakeRepo:
    """In-memory stand-in for the backfill methods of SupabaseRepository."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = {r["id"]: dict(r) for r in rows}
        self.writes: list[tuple[str, str, Any]] = []

    async def list_pantry_missing_expiry(
        self, after_id: str | None, limit: int
    ) -> list[dict[str, Any]]:
        ids = sorted(i for i, r in self.rows.items() if r["expiry_date"] is None)
        if after_id is not None:
            ids = [i for i in ids if i > after_id]
        return [dict(self.rows[i]) for i in ids[:limit]]

    async def set_backfilled_expiry(self, row_id: str, expiry: date) -> bool:
        row = self.rows[row_id]
        if row["expiry_date"] is not None:  # guard: never overwrite a real date
            return False
        row["expiry_date"] = expiry.isoformat()
        row["estimated_expiry"] = True
        self.writes.append(("set", row_id, expiry))
        return True

    async def revert_backfilled_expiry(self, row_id: str, expected: date) -> bool:
        row = self.rows.get(row_id)
        if (
            row is None
            or row["expiry_date"] != expected.isoformat()
            or not row["estimated_expiry"]
        ):
            return False
        row["expiry_date"] = None
        row["estimated_expiry"] = False
        self.writes.append(("revert", row_id, expected))
        return True


# --------------------------------------------------------------------------- plan_row


def test_plan_row_anchors_on_added_at_by_default() -> None:
    row = _row("a", category="produce", location="fridge", added_at="2026-09-01T23:30:00+00:00")
    plan = plan_row(row, anchor="added", today=TODAY)
    expected, _ = get_expiry_heuristics().estimate_expiry(
        category=FoodCategory.PRODUCE,
        storage=StorageLocation.FRIDGE,
        name="thing",
        purchase_date=date(2026, 9, 1),
    )
    assert plan.expiry == expected == date(2026, 9, 8)


def test_plan_row_anchor_today_ignores_added_at() -> None:
    row = _row("a", added_at="2025-01-01T00:00:00+00:00")
    plan = plan_row(row, anchor="today", today=TODAY)
    assert plan.expiry == TODAY + timedelta(days=7)


def test_plan_row_uses_name_overrides() -> None:
    row = _row("a", name="Whole Milk", category="dairy", added_at="2026-09-20T00:00:00+00:00")
    assert plan_row(row, anchor="added", today=TODAY).expiry == date(2026, 9, 30)  # +10d


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"category": "not-a-category"}, "unknown_category"),
        ({"category": None}, "unknown_category"),
        ({"location": "garage"}, "unknown_location"),
        ({"added_at": None}, "no_added_at"),
        ({"added_at": "garbage"}, "no_added_at"),
    ],
)
def test_plan_row_unestimatable_rows_are_reported_not_guessed(
    overrides: dict[str, Any], reason: str
) -> None:
    plan = plan_row(_row("a", **overrides), anchor="added", today=TODAY)
    assert plan.expiry is None
    assert plan.skip_reason == reason


# ------------------------------------------------------------------------- run_backfill


@pytest.mark.asyncio
async def test_dry_run_writes_nothing_and_reports_counts() -> None:
    repo = FakeRepo(
        [
            _row("a", category="produce"),
            _row("b", category="produce"),
            _row("c", category="dairy"),
        ]
    )
    report = await run_backfill(repo, apply=False, anchor="added", today=TODAY, undo_log=None)

    assert repo.writes == []
    assert all(r["expiry_date"] is None for r in repo.rows.values())
    assert report.applied is False
    assert report.scanned == 3
    assert report.estimated == 3  # would-be count in a dry run
    assert report.by_category == {"produce": 2, "dairy": 1}


@pytest.mark.asyncio
async def test_apply_marks_every_touched_row_estimated(tmp_path: Path) -> None:
    repo = FakeRepo([_row("a"), _row("b", category="dairy")])
    report = await run_backfill(
        repo, apply=True, anchor="added", today=TODAY, undo_log=tmp_path / "undo1.jsonl"
    )

    assert report.estimated == 2
    for row in repo.rows.values():
        assert row["expiry_date"] is not None
        assert row["estimated_expiry"] is True


@pytest.mark.asyncio
async def test_rows_with_user_entered_expiry_are_never_touched(tmp_path: Path) -> None:
    repo = FakeRepo(
        [
            _row("a", expiry_date="2026-12-25", estimated_expiry=False),  # user-entered
            _row("b", expiry_date="2026-10-01", estimated_expiry=True),  # earlier estimate
            _row("c"),  # the only candidate
        ]
    )
    before = {i: dict(r) for i, r in repo.rows.items() if i in ("a", "b")}
    report = await run_backfill(
        repo, apply=True, anchor="added", today=TODAY, undo_log=tmp_path / "undo1.jsonl"
    )

    assert report.scanned == 1
    assert [w[1] for w in repo.writes] == ["c"]
    assert {i: repo.rows[i] for i in ("a", "b")} == before


@pytest.mark.asyncio
async def test_row_that_gains_a_real_expiry_mid_run_is_not_overwritten(tmp_path: Path) -> None:
    class RacyRepo(FakeRepo):
        async def set_backfilled_expiry(self, row_id: str, expiry: date) -> bool:
            # the user edits the row between our read and our write
            self.rows[row_id]["expiry_date"] = "2027-01-01"
            return await super().set_backfilled_expiry(row_id, expiry)

    repo = RacyRepo([_row("a")])
    report = await run_backfill(
        repo, apply=True, anchor="added", today=TODAY, undo_log=tmp_path / "undo1.jsonl"
    )

    assert repo.rows["a"]["expiry_date"] == "2027-01-01"
    assert repo.rows["a"]["estimated_expiry"] is False
    assert report.estimated == 0
    assert report.skipped_changed_underfoot == 1


@pytest.mark.asyncio
async def test_second_run_touches_zero_rows(tmp_path: Path) -> None:
    repo = FakeRepo([_row(str(n)) for n in range(7)])
    first = await run_backfill(repo, apply=True, anchor="added", today=TODAY, undo_log=tmp_path / "undo1.jsonl")
    writes_after_first = list(repo.writes)
    second = await run_backfill(repo, apply=True, anchor="added", today=TODAY, undo_log=tmp_path / "undo2.jsonl")

    assert first.estimated == 7
    assert second.scanned == 0
    assert second.estimated == 0
    assert repo.writes == writes_after_first


@pytest.mark.asyncio
async def test_unestimatable_rows_stay_null_are_counted_and_do_not_loop(tmp_path: Path) -> None:
    repo = FakeRepo([_row("a", category="mystery"), _row("b")])
    report = await run_backfill(
        repo, apply=True, anchor="added", today=TODAY, undo_log=tmp_path / "undo1.jsonl", page_size=1
    )

    assert repo.rows["a"]["expiry_date"] is None
    assert repo.rows["b"]["expiry_date"] is not None
    assert report.unestimatable == {"unknown_category": 1}
    assert report.estimated == 1


@pytest.mark.asyncio
async def test_pagination_covers_every_row(tmp_path: Path) -> None:
    repo = FakeRepo([_row(f"{n:03d}") for n in range(25)])
    report = await run_backfill(
        repo, apply=True, anchor="added", today=TODAY, undo_log=tmp_path / "undo1.jsonl", page_size=4
    )
    assert report.scanned == 25
    assert report.estimated == 25


@pytest.mark.asyncio
async def test_report_counts_rows_that_land_already_expired() -> None:
    repo = FakeRepo(
        [
            _row("old", added_at="2026-01-01T00:00:00+00:00"),  # +7d => long gone
            _row("new", added_at="2026-09-29T00:00:00+00:00"),  # still fresh
        ]
    )
    report = await run_backfill(repo, apply=False, anchor="added", today=TODAY, undo_log=None)
    assert report.already_expired == 1


@pytest.mark.asyncio
async def test_samples_carry_the_row_id_but_no_user_identifier() -> None:
    repo = FakeRepo([_row("a"), _row("b")])
    report = await run_backfill(
        repo, apply=False, anchor="added", today=TODAY, undo_log=None, sample_size=1
    )
    assert len(report.samples) == 1
    assert report.samples[0]["id"] == "a"
    assert "user_id" not in report.samples[0]
    assert "user-a" not in json.dumps(report.samples, default=str)


# --------------------------------------------------------------------------- undo log


@pytest.mark.asyncio
async def test_apply_writes_undo_log_and_undo_restores_the_rows(tmp_path: Path) -> None:
    repo = FakeRepo([_row("a"), _row("b", category="dairy"), _row("keep", expiry_date="2026-12-25")])
    log = tmp_path / "undo.jsonl"

    await run_backfill(repo, apply=True, anchor="added", today=TODAY, undo_log=log)

    lines = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
    assert sorted(entry["id"] for entry in lines) == ["a", "b"]
    assert all("user_id" not in entry for entry in lines)

    undo = await undo_backfill(repo, log)

    assert undo.reverted == 2
    assert repo.rows["a"]["expiry_date"] is None and repo.rows["a"]["estimated_expiry"] is False
    assert repo.rows["b"]["expiry_date"] is None
    assert repo.rows["keep"]["expiry_date"] == "2026-12-25"  # untouched throughout


@pytest.mark.asyncio
async def test_undo_leaves_a_row_the_user_has_since_edited(tmp_path: Path) -> None:
    repo = FakeRepo([_row("a")])
    log = tmp_path / "undo.jsonl"
    await run_backfill(repo, apply=True, anchor="added", today=TODAY, undo_log=log)
    # user types their own date afterwards (flag cleared, as the edit path does)
    repo.rows["a"]["expiry_date"] = "2027-02-02"
    repo.rows["a"]["estimated_expiry"] = False

    undo = await undo_backfill(repo, log)

    assert undo.reverted == 0
    assert undo.left_alone == 1
    assert repo.rows["a"]["expiry_date"] == "2027-02-02"


@pytest.mark.asyncio
async def test_undo_log_is_written_before_each_row_update(tmp_path: Path) -> None:
    """A crash mid-run must still leave a log covering every row already written."""
    log = tmp_path / "undo.jsonl"
    seen_in_log_at_write: list[int] = []

    class CrashyRepo(FakeRepo):
        async def set_backfilled_expiry(self, row_id: str, expiry: date) -> bool:
            seen_in_log_at_write.append(len(log.read_text(encoding="utf-8").splitlines()))
            if row_id == "c":
                raise RuntimeError("network died")
            return await super().set_backfilled_expiry(row_id, expiry)

    repo = CrashyRepo([_row("a"), _row("b"), _row("c")])
    with pytest.raises(RuntimeError):
        await run_backfill(repo, apply=True, anchor="added", today=TODAY, undo_log=log)

    assert seen_in_log_at_write == [1, 2, 3]  # the line precedes its own write


@pytest.mark.asyncio
async def test_apply_refuses_to_overwrite_an_existing_undo_log(tmp_path: Path) -> None:
    log = tmp_path / "undo.jsonl"
    log.write_text("precious\n", encoding="utf-8")
    repo = FakeRepo([_row("a")])
    with pytest.raises(FileExistsError):
        await run_backfill(repo, apply=True, anchor="added", today=TODAY, undo_log=log)
    assert log.read_text(encoding="utf-8") == "precious\n"
    assert repo.writes == []


@pytest.mark.asyncio
async def test_apply_without_an_undo_log_is_refused() -> None:
    repo = FakeRepo([_row("a")])
    with pytest.raises(ValueError, match="undo"):
        await run_backfill(repo, apply=True, anchor="added", today=TODAY, undo_log=None)
    assert repo.writes == []


# ------------------------------------------------------------------------------ CLI


def _load_script() -> Any:
    path = Path(__file__).resolve().parents[1] / "scripts" / "backfill_expiry.py"
    spec = importlib.util.spec_from_file_location("backfill_expiry_script", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_cli_defaults_to_dry_run(capsys: pytest.CaptureFixture[str]) -> None:
    script = _load_script()
    repo = FakeRepo([_row("a")])

    code = script.main([], repo_factory=lambda: repo)

    assert code == 0
    assert repo.writes == []
    out = capsys.readouterr().out
    assert "DRY RUN" in out
    assert "produce" in out


def test_cli_apply_writes_and_reports_the_undo_path(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    script = _load_script()
    repo = FakeRepo([_row("a")])
    log = tmp_path / "u.jsonl"

    code = script.main(["--apply", "--undo-log", str(log)], repo_factory=lambda: repo)

    assert code == 0
    assert repo.rows["a"]["estimated_expiry"] is True
    assert str(log) in capsys.readouterr().out
    assert log.exists()


def test_cli_undo_reverses_a_previous_run(tmp_path: Path) -> None:
    script = _load_script()
    repo = FakeRepo([_row("a")])
    log = tmp_path / "u.jsonl"
    script.main(["--apply", "--undo-log", str(log)], repo_factory=lambda: repo)

    code = script.main(["--undo", str(log)], repo_factory=lambda: repo)

    assert code == 0
    assert repo.rows["a"]["expiry_date"] is None


# ------------------------------------------------------- SupabaseRepository queries


class _RecordingQuery:
    """Fake postgrest builder: records every call, returns canned rows."""

    def __init__(self, calls: list[tuple[str, tuple[Any, ...]]], data: list[Any]) -> None:
        self._calls = calls
        self._data = data

    def __getattr__(self, name: str) -> Any:
        def method(*args: Any) -> _RecordingQuery:
            self._calls.append((name, args))
            return self

        return method

    def execute(self) -> Any:
        return type("Result", (), {"data": self._data})()


class _RecordingClient:
    def __init__(self, data: list[Any]) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self._data = data

    def table(self, name: str) -> _RecordingQuery:
        self.calls.append(("table", (name,)))
        return _RecordingQuery(self.calls, self._data)


def _repo_with(data: list[Any]) -> tuple[Any, _RecordingClient]:
    from bubbly_chef.repository.supabase_repo import SupabaseRepository

    repo = SupabaseRepository.__new__(SupabaseRepository)
    client = _RecordingClient(data)
    repo.client = client  # type: ignore[assignment]
    return repo, client


@pytest.mark.asyncio
async def test_repo_listing_selects_only_null_expiry_rows_and_no_user_id() -> None:
    repo, client = _repo_with([{"id": "a"}])
    rows = await repo.list_pantry_missing_expiry("prev-id", 50)

    assert rows == [{"id": "a"}]
    assert ("is_", ("expiry_date", "null")) in client.calls
    assert ("gt", ("id", "prev-id")) in client.calls
    assert ("limit", (50,)) in client.calls
    select_cols = next(a[0] for n, a in client.calls if n == "select")
    assert "user_id" not in select_cols


@pytest.mark.asyncio
async def test_repo_set_is_conditional_on_expiry_still_null_and_flags_estimated() -> None:
    repo, client = _repo_with([{"id": "a"}])
    assert await repo.set_backfilled_expiry("a", date(2026, 10, 5)) is True

    assert ("update", ({"expiry_date": "2026-10-05", "estimated_expiry": True},)) in client.calls
    assert ("is_", ("expiry_date", "null")) in client.calls


@pytest.mark.asyncio
async def test_repo_set_reports_false_when_no_row_matched() -> None:
    repo, _ = _repo_with([])
    assert await repo.set_backfilled_expiry("a", date(2026, 10, 5)) is False


@pytest.mark.asyncio
async def test_repo_revert_requires_same_date_and_estimated_flag() -> None:
    repo, client = _repo_with([{"id": "a"}])
    assert await repo.revert_backfilled_expiry("a", date(2026, 10, 5)) is True

    assert ("eq", ("expiry_date", "2026-10-05")) in client.calls
    assert ("eq", ("estimated_expiry", True)) in client.calls
    assert ("update", ({"expiry_date": None, "estimated_expiry": False},)) in client.calls
