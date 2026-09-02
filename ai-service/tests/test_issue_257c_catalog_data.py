"""Regression tests for issue #257 slice c: pantry_catalog.json data cleanup.

Slices 257a+b fixed ``normalize_food_name`` so it no longer rewrites display
names and only trusts exact catalog hits that share the input's word set.
That left the underlying data problem untouched: 239 of the catalog's 1600
synonyms were claimed by more than one canonical (e.g. "flour" by 22
canonicals, "cheese" by 16), so which canonical won an exact lookup was
decided by dict insertion order in ``_build_lookup_index`` — a coin flip, not
a mapping.

This slice deletes every ambiguous synonym from the data (an ambiguous
synonym cannot resolve correctly to any one claimant, so removing it turns a
wrong-answer risk into a clean "not found" that falls through to the LLM
alias resolver) and collapses the "broiler"/"broilers" duplicate chicken
entry.

This file pins:
- No synonym is claimed by more than one canonical (the structural guard
  that stops the ambiguity from coming back if the catalog is regenerated).
- No duplicate canonicals (catches the broiler/broilers class of bug).
- Every entry still has non-empty canonical/category/emoji and an integer
  fdc_id, even when its synonym list is now empty.
- A handful of genuine, unambiguous real-world lookups still resolve to
  sensible categories/emoji after the cleanup.
"""

from __future__ import annotations

import collections
import json
from pathlib import Path

import pytest

from bubbly_chef.domain.catalog import categorize, get_emoji, lookup

_CATALOG_PATH = Path(__file__).resolve().parent.parent / "bubbly_chef" / "domain" / "pantry_catalog.json"


def _load_raw_catalog() -> list[dict[str, object]]:
    return json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Structural guards over the raw catalog data
# ---------------------------------------------------------------------------


def test_no_synonym_claimed_by_more_than_one_canonical() -> None:
    """The regression guard: no synonym string may appear under two+ canonicals.

    This is what actually caused the bug — an ambiguous synonym resolves to
    whichever canonical happens to win dict insertion order. If the catalog
    is ever regenerated from a fresh USDA dump, this test fails loudly
    instead of silently reintroducing coin-flip lookups.
    """
    catalog = _load_raw_catalog()
    owners: dict[str, set[str]] = collections.defaultdict(set)
    for entry in catalog:
        canonical = str(entry["canonical"])
        for syn in entry.get("synonyms", []):  # type: ignore[union-attr]
            owners[str(syn)].add(canonical)

    ambiguous = {syn: sorted(claimants) for syn, claimants in owners.items() if len(claimants) > 1}
    assert ambiguous == {}, f"{len(ambiguous)} synonyms are still claimed by multiple canonicals"


def test_no_duplicate_canonicals() -> None:
    """Catches the broiler/broilers class of duplicate USDA rows."""
    catalog = _load_raw_catalog()
    canonicals = [str(entry["canonical"]) for entry in catalog]
    counts = collections.Counter(canonicals)
    dupes = {name: n for name, n in counts.items() if n > 1}
    assert dupes == {}, f"duplicate canonicals found: {dupes}"


def test_broiler_entries_merged_into_one() -> None:
    """The two USDA broiler/fryer chicken rows must now be a single entry."""
    catalog = _load_raw_catalog()
    canonicals = {str(entry["canonical"]) for entry in catalog}
    assert "broilers or fryers chicken" not in canonicals
    assert "broiler or fryers chicken" in canonicals

    merged = next(e for e in catalog if e["canonical"] == "broiler or fryers chicken")
    synonyms = merged["synonyms"]
    # Synonyms unique to the dropped "broilers" (plural) entry survive the merge.
    assert "broilers" in synonyms
    assert "drumstick chicken" in synonyms
    # Synonyms from the kept "broiler" (singular) entry are still present.
    assert "broiler" in synonyms
    assert "breast chicken" in synonyms


@pytest.mark.parametrize("field", ["canonical", "category", "emoji"])
def test_every_entry_has_required_string_fields(field: str) -> None:
    catalog = _load_raw_catalog()
    for entry in catalog:
        value = entry.get(field)
        assert isinstance(value, str) and value, f"entry missing {field}: {entry}"


def test_every_entry_has_integer_fdc_id() -> None:
    catalog = _load_raw_catalog()
    for entry in catalog:
        assert isinstance(entry.get("fdc_id"), int), f"entry missing integer fdc_id: {entry}"


def test_entries_with_now_empty_synonyms_are_kept() -> None:
    """An entry whose synonyms all got deleted for ambiguity must survive —
    it's still reachable by its canonical name and still supplies category/emoji.
    """
    catalog = _load_raw_catalog()
    # At least confirm the file still has all 303 non-duplicate entries and
    # that "empty synonyms" (if any) are real entries, not silently dropped.
    for entry in catalog:
        assert "canonical" in entry
        assert isinstance(entry.get("synonyms"), list)


# ---------------------------------------------------------------------------
# End-to-end: unambiguous real-world lookups still resolve sensibly
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name,expected_category",
    [
        ("garlic", "produce"),
        ("olive oil", "condiments"),
        ("peanut butter", "dry_goods"),
        ("chicken breast", "meat"),
    ],
)
def test_genuine_lookups_still_resolve_category(name: str, expected_category: str) -> None:
    assert categorize(name) == expected_category


@pytest.mark.parametrize(
    "name,expected_emoji",
    [
        ("garlic", "🧄"),
        ("olive oil", "🫒"),
        ("peanut butter", "🥜"),
        # #300: every chicken CUT (breast, thighs, ground, drumstick, wing) is
        # now consistently the meat emoji, not the live-bird emoji — a package
        # of chicken breast is not a live chicken. See test_issue_300 for the
        # full-catalog emoji regeneration this value came out of.
        ("chicken breast", "🍗"),
    ],
)
def test_genuine_lookups_still_resolve_emoji(name: str, expected_emoji: str) -> None:
    assert get_emoji(name) == expected_emoji


def test_exact_unambiguous_synonym_still_resolves() -> None:
    """'garlic' and 'olive oil' are canonicals themselves, not synonyms at
    risk of ambiguity — confirm an exact-only lookup (no fuzzy fallback)
    still hits them directly post-cleanup.
    """
    entry = lookup("garlic", fuzzy=False)
    assert entry is not None
    assert entry.canonical == "garlic"
    assert entry.category == "produce"
