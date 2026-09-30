"""Issue #497: the grocery migration keeps every new table behind per-user RLS.

A static check of `supabase/migrations/00018_grocery_list.sql` -- the policies
themselves are exercised against the hosted database in the PR's Verify step.
What this pins is the shape that makes "another user can't read or modify a
list" true for the Next.js (RLS-governed) path, and that the migration stays
additive.
"""

from __future__ import annotations

import re
from pathlib import Path

MIGRATION = (
    Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "00018_grocery_list.sql"
)
SQL = MIGRATION.read_text(encoding="utf-8")
TABLES = ("grocery_lists", "grocery_items")


def _policy_blocks(table: str) -> list[str]:
    return re.findall(
        rf"CREATE POLICY\s+\"[^\"]+\"\s+ON\s+{table}\b.*?;", SQL, flags=re.DOTALL | re.IGNORECASE
    )


def test_every_new_table_enables_rls() -> None:
    for table in TABLES:
        assert re.search(
            rf"ALTER TABLE\s+{table}\s+ENABLE ROW LEVEL SECURITY", SQL, re.IGNORECASE
        ), table


def test_every_new_table_has_an_own_rows_policy_for_reads_and_writes() -> None:
    for table in TABLES:
        blocks = _policy_blocks(table)
        assert blocks, f"no policy on {table}"
        joined = " ".join(blocks)
        assert "auth.uid() = user_id" in joined
        assert "FOR ALL" in joined
        assert "WITH CHECK" in joined  # writes are checked, not just reads
        # Never a blanket policy that would let everyone in.
        assert not re.search(r"USING\s*\(\s*true\s*\)", joined, re.IGNORECASE)


def test_items_cannot_be_attached_to_someone_elses_list() -> None:
    (items_policy,) = _policy_blocks("grocery_items")
    with_check = items_policy.split("WITH CHECK", 1)[1]
    assert "grocery_lists" in with_check and "l.user_id = auth.uid()" in with_check


def test_rows_die_with_their_owner_and_their_list() -> None:
    assert len(re.findall(r"REFERENCES auth\.users\(id\) ON DELETE CASCADE", SQL)) == 2
    assert "REFERENCES grocery_lists(id) ON DELETE CASCADE" in SQL


def test_one_list_per_user_and_one_line_per_food() -> None:
    assert re.search(r"UNIQUE \(user_id\)", SQL)
    assert re.search(r"UNIQUE \(list_id, name_key\)", SQL)


def test_share_is_a_read_only_token_function_not_a_table_grant() -> None:
    assert "CREATE OR REPLACE FUNCTION get_shared_grocery_list" in SQL
    assert "SECURITY DEFINER" in SQL
    assert "SET search_path" in SQL  # definer functions must pin the search path
    assert "REVOKE ALL ON FUNCTION get_shared_grocery_list(TEXT) FROM PUBLIC" in SQL
    assert "TO anon, authenticated" in SQL
    # The function exposes no ids and never a checked line.
    body = SQL.split("CREATE OR REPLACE FUNCTION get_shared_grocery_list", 1)[1]
    assert "NOT i.checked" in body and "length(p_token) >= 16" in body
    assert "GRANT SELECT" not in SQL.upper().replace("GRANT EXECUTE", "")


def test_migration_is_additive_only() -> None:
    upper = SQL.upper()
    for forbidden in ("DROP TABLE", "DROP COLUMN", "TRUNCATE", "DELETE FROM", "ALTER COLUMN"):
        assert forbidden not in upper, forbidden
    # The only ALTER TABLEs are the new tables' own RLS switches.
    for stmt in re.findall(r"ALTER TABLE\s+(\w+)", SQL, re.IGNORECASE):
        assert stmt in TABLES
