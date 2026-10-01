"""Generate the ``food_catalog`` seed SQL from the AI-service pantry catalog.

The hosted ``food_catalog`` table backs pantry autocomplete (``/api/foods/search``).
Migrations 00001/00002 create it but nothing filled it, so autocomplete returned
nothing in production (issue #548). ``pantry_catalog.json`` is the source of truth
for what a known food is; this module turns it into an idempotent seed migration so
the repo describes the live data.

Usage (from ``ai-service/``)::

    python -m bubbly_chef.domain.catalog_seed > ../supabase/migrations/000NN_seed.sql
    # After adding entries to pantry_catalog.json, emit only the ones no seed
    # migration has inserted yet, as a NEW migration (never edit a pushed one):
    python -m bubbly_chef.domain.catalog_seed --only-missing

``tests/test_food_catalog_seed.py`` fails when the catalog gains an entry that no
migration under ``supabase/migrations/`` seeds, and points here.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from bubbly_chef.domain.expiry import CATEGORY_DEFAULTS, CATEGORY_LOCATIONS

CATALOG_PATH = Path(__file__).parent / "pantry_catalog.json"
MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "supabase" / "migrations"

# ``INSERT INTO food_catalog (<columns>) VALUES`` - the column list is read by name so a
# seed is understood whatever order its columns come in.
_INSERT_RE = re.compile(r"INSERT\s+INTO\s+food_catalog\s*\(([^)]*)\)\s*VALUES", re.IGNORECASE)


def load_catalog() -> list[dict[str, object]]:
    """Return the raw catalog entries from ``pantry_catalog.json``."""
    raw: list[dict[str, object]] = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return raw


def _quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _row(entry: dict[str, object]) -> str:
    category = str(entry["category"])
    days = CATEGORY_DEFAULTS.get(category, CATEGORY_DEFAULTS["other"])
    location = CATEGORY_LOCATIONS.get(category, "pantry")
    return (
        f"  ({_quote(str(entry['canonical']))}, {_quote(category)}, "
        f"{days}, {_quote(location)}, {_quote(str(entry['emoji']))})"
    )


def _parse_rows(sql: str, pos: int) -> list[list[str | None]]:
    """Parse the parenthesised VALUES tuples starting at ``pos``.

    Returns one list of fields per row: the unquoted text of a string literal
    (``''`` unescaped), or ``None`` for anything else (numbers, NULL, expressions).
    Stops at the first thing that is not another tuple (``ON CONFLICT``, ``;``).
    """
    rows: list[list[str | None]] = []
    n = len(sql)
    while pos < n:
        while pos < n and (sql[pos].isspace() or sql[pos] == ","):
            pos += 1
        if pos >= n or sql[pos] != "(":
            break
        pos += 1
        fields: list[str | None] = []
        buf: list[str] = []
        literal: str | None = None
        while pos < n:
            ch = sql[pos]
            if ch == "'":
                chars: list[str] = []
                pos += 1
                while pos < n:
                    if sql[pos] == "'":
                        if pos + 1 < n and sql[pos + 1] == "'":
                            chars.append("'")
                            pos += 2
                            continue
                        break
                    chars.append(sql[pos])
                    pos += 1
                literal = "".join(chars)
                pos += 1
                continue
            if ch in ",)":
                fields.append(literal if literal is not None and not "".join(buf).strip() else None)
                buf, literal = [], None
                pos += 1
                if ch == ")":
                    break
                continue
            buf.append(ch)
            pos += 1
        rows.append(fields)
    return rows


def seeded_canonicals(migrations_dir: Path = MIGRATIONS_DIR) -> dict[str, str]:
    """Map canonical -> category for every row a migration already seeds.

    Rows are read by column name from each ``INSERT INTO food_catalog (cols) VALUES``
    list, so column order and the trailing conflict clause do not matter. A seed this
    cannot read (no VALUES list, or no canonical/category column) raises rather than
    silently counting as zero rows, which would make the guard demand duplicates.
    """
    seeded: dict[str, str] = {}
    for path in sorted(migrations_dir.glob("*.sql")):
        sql = path.read_text(encoding="utf-8")
        for match in _INSERT_RE.finditer(sql):
            columns = [c.strip().strip('"').lower() for c in match.group(1).split(",")]
            if "canonical" not in columns or "category" not in columns:
                raise ValueError(
                    f"{path.name}: INSERT INTO food_catalog must list canonical and "
                    f"category columns to be recognised as a seed (got {columns})"
                )
            ci, ki = columns.index("canonical"), columns.index("category")
            for row in _parse_rows(sql, match.end()):
                if len(row) != len(columns) or row[ci] is None or row[ki] is None:
                    raise ValueError(
                        f"{path.name}: cannot read canonical/category from seed row {row!r}"
                    )
                seeded[str(row[ci])] = str(row[ki])
    return seeded


def render_seed_sql(
    entries: list[dict[str, object]], header: str = "Seed the shared food_catalog."
) -> str:
    """Render an additive, idempotent INSERT for ``entries``."""
    rows = ",\n".join(_row(e) for e in entries)
    return (
        f"-- {header}\n"
        "-- Generated by `python -m bubbly_chef.domain.catalog_seed` from\n"
        "-- ai-service/bubbly_chef/domain/pantry_catalog.json (issue #548).\n"
        "-- Additive and idempotent: canonical is the primary key, so re-running or\n"
        "-- overlapping an existing row is a no-op. icon_slug stays NULL and\n"
        "-- valid_units keeps its column default. expiry_days and default_location come\n"
        "-- from the category defaults in domain/expiry.py.\n"
        "INSERT INTO food_catalog (canonical, category, expiry_days, default_location, emoji)\n"
        f"VALUES\n{rows}\n"
        "ON CONFLICT (canonical) DO NOTHING;\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0] if __doc__ else None)
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="emit only catalog entries no existing migration seeds",
    )
    args = parser.parse_args(argv)

    entries = load_catalog()
    header = "Seed the shared food_catalog."
    if args.only_missing:
        done = seeded_canonicals()
        entries = [e for e in entries if str(e["canonical"]) not in done]
        header = "Seed food_catalog entries added to the catalog since the last seed."
        if not entries:
            print("food_catalog is already fully seeded; nothing to emit.", file=sys.stderr)
            return 0
    # Bytes, not text: keeps LF newlines and UTF-8 emoji on Windows consoles.
    sys.stdout.buffer.write(render_seed_sql(entries, header).encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
