"""Tests for the pantry category-estimation endpoint helpers.

The endpoint itself requires JWT auth + wires FastAPI, but the interesting
behaviour is the catalog lookup and that known items resolve to the right
category while unknown items return None. These test that layer directly.

Updated in #177: the endpoint now uses detect_category (keyword-first) before
falling back to catalog.categorize, matching the receipt-parser path.
"""

import pytest

from bubbly_chef.api.routes.pantry import (
    EstimateCategoryRequest,
    EstimateCategoryResponse,
)
from bubbly_chef.domain.catalog import categorize
from bubbly_chef.domain.normalizer import detect_category


def test_request_model_accepts_name() -> None:
    req = EstimateCategoryRequest(name="greek yogurt")
    assert req.name == "greek yogurt"


def test_response_model_allows_null_category() -> None:
    resp = EstimateCategoryResponse(category=None)
    assert resp.category is None


def test_response_model_allows_string_category() -> None:
    resp = EstimateCategoryResponse(category="dairy")
    assert resp.category == "dairy"


def test_greek_yogurt_resolves_to_dairy() -> None:
    """Catalog entry for yogurt should return 'dairy' at threshold=95."""
    result = categorize("greek yogurt")
    assert result == "dairy"


def test_banana_resolves_to_produce() -> None:
    result = categorize("banana")
    assert result == "produce"


def test_unknown_item_returns_none() -> None:
    """No catalog match for a nonsense name — caller falls back to 'other'."""
    result = categorize("xyzunknownitem123")
    assert result is None


def test_empty_string_returns_none() -> None:
    result = categorize("")
    assert result is None


# ---------------------------------------------------------------------------
# detect_category (keyword-first path — the same stage the receipt parser uses)
# These cover the #177 fix: items matched by keyword before catalog is tried.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name,expected",
    [
        ("yogurt", "dairy"),
        ("greek yogurt", "dairy"),
        ("plain yogurt", "dairy"),
        ("milk", "dairy"),
        ("cheddar cheese", "dairy"),
        ("butter", "dairy"),
        ("sour cream", "dairy"),
    ],
)
def test_detect_category_dairy(name: str, expected: str) -> None:
    """Keyword matching should resolve all common dairy names to 'dairy' (#177)."""
    assert detect_category(name) == expected


@pytest.mark.parametrize(
    "name,expected",
    [
        ("banana", "produce"),
        ("apple", "produce"),
        ("tomato", "produce"),
        ("spinach", "produce"),
    ],
)
def test_detect_category_produce(name: str, expected: str) -> None:
    assert detect_category(name) == expected


@pytest.mark.parametrize(
    "name,expected",
    [
        ("chicken breast", "meat"),
        ("ground beef", "meat"),
        ("bacon", "meat"),
        ("salmon", "seafood"),
        ("tuna", "seafood"),
    ],
)
def test_detect_category_protein(name: str, expected: str) -> None:
    assert detect_category(name) == expected


def test_detect_category_unknown_returns_none() -> None:
    """Unknown items return None from detect_category so callers can fall back."""
    result = detect_category("xyzunknownitem123")
    assert result is None


# ---------------------------------------------------------------------------
# Combined path (detect_category or catalog) — mirrors what the endpoint does
# ---------------------------------------------------------------------------


def test_combined_yogurt_resolves_dairy() -> None:
    """The core bug from #177: 'yogurt' must resolve to 'dairy', not 'other'."""
    result = detect_category("yogurt") or categorize("yogurt")
    assert result == "dairy"


def test_combined_unknown_returns_none() -> None:
    """When neither stage matches, callers should fall back to 'other'."""
    result = detect_category("xyzunknownitem123") or categorize("xyzunknownitem123")
    assert result is None

