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
    render_valid_units_sql,
    seeded_canonicals,
    seeded_valid_units,
)
from bubbly_chef.domain.catalog_units import CANONICAL_UNITS, valid_units_for
from bubbly_chef.domain.expiry import CATEGORY_DEFAULTS, CATEGORY_LOCATIONS
from bubbly_chef.domain.normalizer import get_unit_dimension, is_unit_word


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
    sql = render_seed_sql(
        [{"canonical": "lion's mane mushroom", "category": "produce", "emoji": "🍄"}]
    )
    row = "('lion''s mane mushroom', 'produce', 7, 'fridge', '🍄', '[\"oz\",\"lb\",\"package\"]')"
    assert row in sql
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


# -- valid_units (#727) -------------------------------------------------------
# The seed in 00016 left valid_units at its '[]' default, so picking a suggestion
# never autofilled the unit. These guard that every catalog food has a default unit
# list in the migrations, that it matches the code, and that it only uses units the
# rest of the app understands.


def test_every_catalog_entry_has_valid_units_in_a_migration() -> None:
    declared = seeded_valid_units()
    missing = [
        str(e["canonical"]) for e in load_catalog() if not declared.get(str(e["canonical"]))
    ]
    assert not missing, (
        f"{len(missing)} catalog entries have no valid_units in any migration under "
        f"{MIGRATIONS_DIR}: {missing[:5]}... Add a NEW migration with "
        "`cd ai-service && python -m bubbly_chef.domain.catalog_seed --valid-units` "
        "(never edit a migration that has been pushed)."
    )


def test_migration_valid_units_match_the_code() -> None:
    declared = seeded_valid_units()
    stale = {
        str(e["canonical"]): (declared.get(str(e["canonical"])), valid_units_for(e))
        for e in load_catalog()
        if declared.get(str(e["canonical"])) != valid_units_for(e)
    }
    assert not stale, (
        "migration valid_units differ from domain/catalog_units.py (migration, code): "
        f"{dict(list(stale.items())[:3])}. Emit a NEW migration with "
        "`python -m bubbly_chef.domain.catalog_seed --valid-units`."
    )


def test_catalog_units_only_use_units_the_app_recognises() -> None:
    unknown = {
        str(e["canonical"]): u
        for e in load_catalog()
        for u in valid_units_for(e)
        if not (is_unit_word(u) or get_unit_dimension(u) is not None)
    }
    assert not unknown, f"units the normaliser does not know: {unknown}"


def test_every_unit_override_names_a_real_catalog_food() -> None:
    known = {str(e["canonical"]) for e in load_catalog()}
    assert not set(CANONICAL_UNITS) - known, "override for a food that is not in the catalog"


def test_catalog_unit_lists_are_non_empty_and_free_of_duplicates() -> None:
    for e in load_catalog():
        units = valid_units_for(e)
        assert units, f"{e['canonical']} has no default unit"
        assert len(units) == len({u.lower() for u in units}), f"{e['canonical']}: {units}"


@pytest.mark.parametrize(
    ("canonical", "first"),
    [
        ("whole milk", "gallon"),
        ("whole egg", "dozen"),
        ("stick butter", "stick"),
        ("white bread", "loaf"),
        ("garlic", "head"),
        ("olive oil", "bottle"),
        ("ground beef", "lb"),
        ("yellow onions", "lb"),
    ],
)
def test_obvious_foods_default_to_the_unit_people_buy_them_in(canonical: str, first: str) -> None:
    entry = next(e for e in load_catalog() if e["canonical"] == canonical)
    assert valid_units_for(entry)[0] == first


def test_rendered_seed_carries_valid_units_and_round_trips(tmp_path: Path) -> None:
    entries = load_catalog()
    (tmp_path / "00001_seed.sql").write_text(render_seed_sql(entries), encoding="utf-8")
    assert seeded_valid_units(tmp_path) == {str(e["canonical"]): valid_units_for(e) for e in entries}


def test_valid_units_update_is_keyed_by_canonical_and_reads_back(tmp_path: Path) -> None:
    sql = render_valid_units_sql(
        [
            {"canonical": "whole milk", "category": "dairy", "emoji": "x"},
            {"canonical": "lion's mane mushroom", "category": "produce", "emoji": "y"},
        ]
    )
    assert sql.startswith("--")
    assert "UPDATE food_catalog" in sql and "f.canonical = v.canonical" in sql
    assert "INSERT" not in sql and "DELETE" not in sql
    (tmp_path / "00019_units.sql").write_text(sql, encoding="utf-8")
    assert seeded_valid_units(tmp_path) == {
        "whole milk": ["gallon", "L", "cup"],
        "lion's mane mushroom": ["oz", "lb", "package"],
    }
