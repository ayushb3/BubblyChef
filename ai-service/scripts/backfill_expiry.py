#!/usr/bin/env python
"""Backfill estimated expiry dates for pantry rows that have none (#183).

Run from ai-service/ with the service-role credentials in the environment
(BUBBLY_SUPABASE_URL, BUBBLY_SUPABASE_SECRET_KEY), exactly as the service itself
reads them.

    python scripts/backfill_expiry.py                  # DRY RUN: counts + samples, writes nothing
    python scripts/backfill_expiry.py --apply          # write, saving an undo log
    python scripts/backfill_expiry.py --undo FILE      # reverse a previous --apply

Safe to re-run: only rows whose expiry_date is NULL are candidates, so a second
--apply finds nothing new. Rows that already carry a date are never touched.
Every row it writes is flagged estimated_expiry = true. No model is called.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections.abc import Callable
from datetime import date
from pathlib import Path

# Running `python scripts/backfill_expiry.py` puts scripts/ (not ai-service/) on
# sys.path; make the checkout's own package win over any other installed copy.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bubbly_chef.services.expiry_backfill import (  # noqa: E402
    BackfillRepo,
    default_undo_log_path,
    format_report,
    run_backfill,
    undo_backfill,
)


def _real_repo() -> BackfillRepo:
    from bubbly_chef.repository.supabase_repo import SupabaseRepository

    return SupabaseRepository()


def main(
    argv: list[str] | None = None,
    repo_factory: Callable[[], BackfillRepo] = _real_repo,
) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write the estimates (default is a dry run that writes nothing)",
    )
    parser.add_argument(
        "--undo",
        type=Path,
        metavar="FILE",
        help="reverse the run recorded in this undo log instead of backfilling",
    )
    parser.add_argument(
        "--undo-log",
        type=Path,
        metavar="FILE",
        help="where --apply saves its undo log (default: ./backfill_expiry_undo_<utc>.jsonl)",
    )
    parser.add_argument(
        "--anchor",
        choices=("added", "today"),
        default="added",
        help="count shelf life from each row's added_at (default) or from today",
    )
    args = parser.parse_args(argv)

    repo = repo_factory()

    if args.undo is not None:
        undo = asyncio.run(undo_backfill(repo, args.undo))
        print(f"Undo: reverted {undo.reverted} row(s); left {undo.left_alone} alone (edited since).")
        return 0

    undo_log = (args.undo_log or default_undo_log_path()) if args.apply else None
    report = asyncio.run(
        run_backfill(
            repo,
            apply=args.apply,
            anchor=args.anchor,
            today=date.today(),
            undo_log=undo_log,
        )
    )
    print(format_report(report))
    if args.apply:
        print(f"undo log: {undo_log}")
        print(f"reverse with: python scripts/backfill_expiry.py --undo {undo_log}")
    else:
        print("re-run with --apply to write these estimates.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
