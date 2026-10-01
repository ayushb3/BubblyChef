"""Guard: pantry_catalog.json and the food_catalog seed migrations must not drift (#548).

The hosted food_catalog table was empty because nothing seeded it, so pantry
autocomplete returned nothing. Migrations are immutable once pushed, so this does
not diff against one frozen file. It asserts that *some* migration seeds every
catalog entry, which fails the moment the catalog grows without a seed, and the
failure message says how to emit the delta migration.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from bubbly_chef.domain.catalog_seed import (
    MIGRATIONS_DIR,
    load_catalog,
    render_seed_sql,
    seeded_canonicals,
)
from bubbly_chef.domain.expiry import CATEGORY_DEFAULTS, CATEGORY_LOCATIONS


def test_every_catalog_entry_is_seeded_by_a_migration() -> None:
    seeded = seeded_canonicals()
    missing = [str(e["canonical"]) for e in load_catalog() if str(e["canonical"]) not in seeded]
    assert not missing, (
        f"{len(missing)} catalog entries are not seeded into food_catalog by any "
        f"migration in {MIGRATIONS_DIR}: {missing[:5]}... Add a NEW migration with "
        "`cd ai-service && python -m bubbly_chef.domain.catalog_seed --only-missing` "
        "(never edit a migration that has been pushed)."
    )


def test_seeded_categories_match_the_catalog() -> None:
    seeded = seeded_canonicals()
    wrong = {
        str(e["canonical"]): (seeded[str(e["canonical"])], str(e["category"]))
        for e in load_catalog()
        if str(e["canonical"]) in seeded and seeded[str(e["canonical"])] != str(e["category"])
    }
    assert not wrong, f"seeded category differs from catalog (seed, catalog): {wrong}"


def test_catalog_canonicals_are_unique_and_categories_known() -> None:
    entries = load_catalog()
    canonicals = [str(e["canonical"]) for e in entries]
    assert len(canonicals) == len(set(canonicals)), "canonical is the food_catalog primary key"
    unknown = {str(e["category"]) for e in entries} - CATEGORY_DEFAULTS.keys()
    assert not unknown, f"categories without an expiry default: {unknown}"
    assert {str(e["category"]) for e in entries} <= CATEGORY_LOCATIONS.keys()


def test_rendered_seed_is_idempotent_and_escapes_quotes() -> None:
    sql = render_seed_sql([{"canonical": "lion's mane", "category": "produce", "emoji": "🍄"}])
    assert "('lion''s mane', 'produce', 7, 'fridge', '🍄')" in sql
    assert sql.rstrip().endswith("ON CONFLICT (canonical) DO NOTHING;")


def _seeded_from(tmp_path: Path, sql: str) -> dict[str, str]:
    (tmp_path / "00001_seed.sql").write_text(sql, encoding="utf-8")
    return seeded_canonicals(tmp_path)


def test_seed_parsing_is_by_column_name_not_position(tmp_path: Path) -> None:
    seeded = _seeded_from(
        tmp_path,
        "INSERT INTO food_catalog (emoji, expiry_days, category, canonical)\n"
        "VALUES ('🥛', 14, 'dairy', 'milk'), ('🍄', 7, 'produce', 'lion''s mane');",
    )
    assert seeded == {"milk": "dairy", "lion's mane": "produce"}


def test_seed_parsing_does_not_depend_on_the_conflict_clause(tmp_path: Path) -> None:
    seeded = _seeded_from(
        tmp_path,
        "insert into food_catalog (canonical, category)\nvalues\n  ('kale', 'produce')\n"
        "ON CONFLICT (canonical) DO UPDATE SET category = EXCLUDED.category;",
    )
    assert seeded == {"kale": "produce"}


def test_generated_seed_round_trips_through_the_parser(tmp_path: Path) -> None:
    entries = load_catalog()
    seeded = _seeded_from(tmp_path, render_seed_sql(entries))
    assert seeded == {str(e["canonical"]): str(e["category"]) for e in entries}


def test_unreadable_seed_fails_loudly_instead_of_counting_as_empty(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="canonical and category"):
        _seeded_from(tmp_path, "INSERT INTO food_catalog (canonical, emoji) VALUES ('a', 'b');")
