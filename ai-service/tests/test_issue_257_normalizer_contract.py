"""Regression tests for issue #257 slices a+b.

``normalize_food_name`` was doing two incompatible jobs: producing the *match
key* used for internal lookups (category, expiry heuristics, unit/density
resolution — collapsing synonyms is desirable there) AND rewriting the
*display name* written into the user's pantry on ingest (destructive — e.g.
"chicken" permanently became "chicken breast").

Three stacked loose-matching mechanisms caused nonsense rewrites like
tea -> steak, ice -> lettuce, ham -> ground beef, chicken -> "broilers or
fryers chicken":

1. A substring fallback in ``_REVERSE_SYNONYMS`` that returned the first
   synonym merely *containing* the cleaned input (deleted).
2. ``catalog_lookup``'s rapidfuzz WRatio fuzzy fallback, which scores a short
   string contained in a longer one very highly — substring matching under
   another name (restricted to exact-only for ``normalize_food_name``).
3. An exact catalog synonym hit alone, which can still inject descriptive
   words the input never had (bare "ham" is a synonym of only one catalog
   row, "sliced ham") — guarded by requiring the canonical share the same
   word set as the input.

This file pins the corrected ``normalize_food_name`` contract, plus the
"name is a match key, not a display-name rewriter" contract for the three
ingest nodes that write to the pantry.
"""

from __future__ import annotations

import datetime
from unittest.mock import MagicMock, patch

import pytest

from bubbly_chef.domain.normalizer import normalize_food_name

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fake_expiry() -> MagicMock:
    ex = MagicMock()
    ex.get_default_storage.return_value = MagicMock(value="pantry")
    ex.estimate_expiry.return_value = (datetime.date(2026, 12, 31), True)
    return ex


# ---------------------------------------------------------------------------
# 1. normalize_food_name — no cross-food rewrites
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("name", ["tea", "ice", "ham", "oil", "corn"])
def test_normalize_food_name_no_cross_food_rewrite(name: str) -> None:
    assert normalize_food_name(name) == name


def test_normalize_food_name_chicken_stays_chicken() -> None:
    assert normalize_food_name("chicken") == "chicken"


def test_normalize_food_name_chicken_thighs_keeps_thigh_identity() -> None:
    """May legitimately read "thigh chicken" via catalog DATA (slice 257c) —
    not this slice's problem. Only assert "thigh" survives."""
    result = normalize_food_name("chicken thighs")
    assert "thigh" in result.lower()


def test_normalize_food_name_percent_milk() -> None:
    """'2% milk' must not lose its leading digit to the quantity-strip regex."""
    assert normalize_food_name("2% milk") == "milk"


@pytest.mark.parametrize(
    "name,expected",
    [
        ("organic whole milk", "milk"),
        ("whole milk", "milk"),
        ("cheddar", "cheese"),
    ],
)
def test_normalize_food_name_genuine_synonyms_still_collapse(name: str, expected: str) -> None:
    assert normalize_food_name(name) == expected


# ---------------------------------------------------------------------------
# 2. Ingest nodes write the LLM's name through unchanged
# ---------------------------------------------------------------------------


def _run_normalize_receipt_items(items: list[dict]) -> list[dict]:
    from bubbly_chef.workflows import receipt_ingest

    with patch.object(receipt_ingest, "get_expiry_heuristics", return_value=_fake_expiry()):
        state: dict = {"parsed_items": items}
        result = receipt_ingest.normalize_receipt_items(state)  # type: ignore[arg-type]
    return result["normalized_items"]


def _run_normalize_product(items: list[dict]) -> list[dict]:
    from bubbly_chef.workflows import product_ingest

    with patch.object(product_ingest, "get_expiry_heuristics", return_value=_fake_expiry()):
        state: dict = {"parsed_items": items}
        result = product_ingest.normalize_product(state)  # type: ignore[arg-type]
    return result["normalized_items"]


def _run_normalize_pantry_items(items: list[dict]) -> list[dict]:
    from bubbly_chef.workflows.pantry import nodes

    state: dict = {
        "parsed_items": items,
        "warnings": [],
        "per_item_confidences": [item.get("confidence", 0.8) for item in items],
    }
    result = nodes.normalize_items(state)  # type: ignore[arg-type]
    return result["normalized_items"]


SPECIALTY_ITEM = {
    "name": "ITALIAN BOMBA HOT PEPPER",
    "category": "other",
    "quantity": 1.0,
    "unit": "item",
    "confidence": 0.8,
}
GENERIC_ITEM = {
    "name": "chicken",
    "category": "other",
    "quantity": 1.0,
    "unit": "item",
    "confidence": 0.8,
}


@pytest.mark.parametrize("item", [SPECIALTY_ITEM, GENERIC_ITEM])
def test_normalize_receipt_items_preserves_llm_name(item: dict) -> None:
    result = _run_normalize_receipt_items([dict(item)])
    assert result[0]["name"] == item["name"]
    assert result[0]["category"]


@pytest.mark.parametrize("item", [SPECIALTY_ITEM, GENERIC_ITEM])
def test_normalize_product_preserves_llm_name(item: dict) -> None:
    result = _run_normalize_product([dict(item)])
    assert result[0]["name"] == item["name"]
    assert result[0]["category"]


@pytest.mark.parametrize("item", [SPECIALTY_ITEM, GENERIC_ITEM])
def test_normalize_pantry_items_preserves_llm_name(item: dict) -> None:
    result = _run_normalize_pantry_items([dict(item)])
    assert result[0]["name"] == item["name"]
    assert result[0]["category"]
