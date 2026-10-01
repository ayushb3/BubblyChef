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
    # Emit the UPDATE that sets valid_units (default units, issue #727) on rows that
    # are already seeded, as a NEW migration:
    python -m bubbly_chef.domain.catalog_seed --valid-units

``tests/test_food_catalog_seed.py`` fails when the catalog gains an entry that no
migration under ``supabase/migrations/`` seeds, and points here. It also fails when a
catalog entry has no ``valid_units`` in any migration, or a migration's units differ
from ``domain/catalog_units.py`` (issue #727).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from bubbly_chef.domain.catalog_units import valid_units_for
from bubbly_chef.domain.expiry import CATEGORY_DEFAULTS, CATEGORY_LOCATIONS

CATALOG_PATH = Path(__file__).parent / "pantry_catalog.json"
MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "supabase" / "migrations"

# ``INSERT INTO food_catalog (<columns>) VALUES`` - the column list is read by name so a
# seed is understood whatever order its columns come in.
_INSERT_RE = re.compile(r"INSERT\s+INTO\s+food_catalog\s*\(([^)]*)\)\s*VALUES", re.IGNORECASE)

# ``UPDATE food_catalog AS f SET valid_units = v.units::jsonb FROM (VALUES ...) AS v(...)``
# - the (canonical, units-json) tuples that follow VALUES are read the same way.
_UNITS_UPDATE_RE = re.compile(
    r"UPDATE\s+food_catalog\s+AS\s+\w+\s+SET\s+valid_units\s*=\s*\w+\.\w+(?:::jsonb)?"
    r"\s+FROM\s*\(\s*VALUES",
    re.IGNORECASE,
)


def load_catalog() -> list[dict[str, object]]:
    """Return the raw catalog entries from ``pantry_catalog.json``."""
    raw: list[dict[str, object]] = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return raw


def _quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _units_json(entry: dict[str, object]) -> str:
    return json.dumps(valid_units_for(entry), separators=(",", ":"))


def _row(entry: dict[str, object]) -> str:
    category = str(entry["category"])
    days = CATEGORY_DEFAULTS.get(category, CATEGORY_DEFAULTS["other"])
    location = CATEGORY_LOCATIONS.get(category, "pantry")
    return (
        f"  ({_quote(str(entry['canonical']))}, {_quote(category)}, "
        f"{days}, {_quote(location)}, {_quote(str(entry['emoji']))}, "
        f"{_quote(_units_json(entry))})"
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


def seeded_valid_units(migrations_dir: Path = MIGRATIONS_DIR) -> dict[str, list[str]]:
    """Map canonical -> the ``valid_units`` the migrations leave it with.

    Reads the ``valid_units`` column of any ``INSERT INTO food_catalog`` seed and the
    ``UPDATE food_catalog ... FROM (VALUES ...)`` form that ``render_valid_units_sql``
    emits, in migration order so a later file wins. A canonical no migration gives
    units to is absent.
    """
    units: dict[str, list[str]] = {}
    for path in sorted(migrations_dir.glob("*.sql")):
        sql = path.read_text(encoding="utf-8")
        for match in _INSERT_RE.finditer(sql):
            columns = [c.strip().strip('"').lower() for c in match.group(1).split(",")]
            if "canonical" not in columns or "valid_units" not in columns:
                continue
            ci, ui = columns.index("canonical"), columns.index("valid_units")
            for row in _parse_rows(sql, match.end()):
                if len(row) == len(columns) and row[ci] is not None and row[ui] is not None:
                    units[str(row[ci])] = json.loads(str(row[ui]))
        for match in _UNITS_UPDATE_RE.finditer(sql):
            for row in _parse_rows(sql, match.end()):
                if len(row) != 2 or row[0] is None or row[1] is None:
                    raise ValueError(f"{path.name}: cannot read valid_units row {row!r}")
                units[str(row[0])] = json.loads(str(row[1]))
    return units


def render_valid_units_sql(entries: list[dict[str, object]]) -> str:
    """Render an idempotent UPDATE that sets ``valid_units`` on already-seeded rows."""
    rows = ",\n".join(
        f"  ({_quote(str(e['canonical']))}, {_quote(_units_json(e))})" for e in entries
    )
    return (
        "-- Give every seeded food_catalog row its default units (issue #727).\n"
        "-- Generated by `python -m bubbly_chef.domain.catalog_seed --valid-units` from\n"
        "-- ai-service/bubbly_chef/domain/catalog_units.py. 00016 seeded valid_units as\n"
        "-- the empty default, so picking an autocomplete suggestion never autofilled\n"
        "-- the unit. The first unit in each list is the autofill default.\n"
        "-- A data rewrite of the shared catalog: keyed by canonical (the primary key),\n"
        "-- touches only valid_units, idempotent (re-running sets the same values).\n"
        "UPDATE food_catalog AS f\n"
        "SET valid_units = v.units::jsonb\n"
        f"FROM (VALUES\n{rows}\n"
        ") AS v(canonical, units)\n"
        "WHERE f.canonical = v.canonical;\n"
    )


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
        "-- overlapping an existing row is a no-op. icon_slug stays NULL. expiry_days and\n"
        "-- default_location come from the category defaults in domain/expiry.py;\n"
        "-- valid_units from domain/catalog_units.py.\n"
        "INSERT INTO food_catalog\n"
        "  (canonical, category, expiry_days, default_location, emoji, valid_units)\n"
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
    parser.add_argument(
        "--valid-units",
        action="store_true",
        help="emit the UPDATE that sets valid_units on every already-seeded catalog entry",
    )
    args = parser.parse_args(argv)

    entries = load_catalog()
    if args.valid_units:
        sys.stdout.buffer.write(render_valid_units_sql(entries).encode("utf-8"))
        return 0
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
