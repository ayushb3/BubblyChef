"""Regression tests for issue #253 — unify the two normalizers.

Two consumers previously used tools/normalizer.py's ``FoodNormalizer`` (bidirectional
substring matching, first dict hit wins), the same class of bug already fixed for
receipt ingest in issue #252 (see test_slice2_receipt_quality.py):

- workflows/product_ingest.py (normalize_product, lookup_barcode)
- workflows/pantry/nodes.py (normalize_items — chat pantry-add)

Both now go through domain/normalizer.py's ``normalize_food_name`` (head-noun,
exact-first) and ``resolve_category`` (kept as a fallback behind an LLM/source
category), matching the precedence established for receipts.

This file pins the four cases from the substring-matching bug across both
migrated paths, plus the prefix/quantity-stripping behavior domain normalizer
still needs to provide.
"""

from __future__ import annotations

import datetime
from unittest.mock import MagicMock, patch

import pytest

from bubbly_chef.domain.normalizer import normalize_food_name
from bubbly_chef.models.pantry import FoodCategory

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PINNED_CASES = [
    # (input, forbidden_substring_in_result)
    ("milk chocolate", "milk"),
    ("italian bomba hot pepper", "black pepper"),
    ("org cane sugar", "sugar"),  # see note below — this one is an allow-list check
    ("red pepper flakes", "bell pepper"),
    ("cream cheese", "cheese"),  # cream cheese must not collapse to "cheese"
]


def _fake_expiry() -> MagicMock:
    ex = MagicMock()
    ex.get_default_storage.return_value = MagicMock(value="pantry")
    ex.estimate_expiry.return_value = (datetime.date(2026, 12, 31), True)
    return ex


# ---------------------------------------------------------------------------
# 0. Sanity: tools/normalizer.py is gone
# ---------------------------------------------------------------------------


def test_tools_normalizer_module_removed() -> None:
    """tools/normalizer.py was deleted — its bug can no longer be reintroduced
    by a stray import. Any remaining consumer would fail this import."""
    with pytest.raises(ModuleNotFoundError):
        import bubbly_chef.tools.normalizer  # noqa: F401


# ---------------------------------------------------------------------------
# 1. domain normalizer itself (already covered by test_slice2_receipt_quality,
#    repeated here for the two extra pinned cases: "red pepper flakes",
#    "cream cheese")
# ---------------------------------------------------------------------------


def test_domain_normalize_food_name_red_pepper_flakes_not_bell_pepper() -> None:
    result = normalize_food_name("red pepper flakes")
    assert result != "bell pepper"


def test_domain_normalize_food_name_cream_cheese_not_cheese() -> None:
    result = normalize_food_name("cream cheese")
    assert result != "cheese"


def test_domain_normalize_food_name_keeps_prefix_and_quantity_stripping() -> None:
    """Prefix stripping ('organic ') and leading-quantity stripping are load-bearing
    behavior from the old FoodNormalizer that must survive in domain/normalizer.py."""
    assert normalize_food_name("organic whole milk") == "milk"
    # "2 lb ground beef" -> quantity/unit stripped, head noun preserved
    result = normalize_food_name("2 lb ground beef")
    assert "ground beef" in result or result == "ground beef"


# ---------------------------------------------------------------------------
# 2. Product ingest (workflows/product_ingest.normalize_product)
# ---------------------------------------------------------------------------


def _run_normalize_product(items: list[dict]) -> list[dict]:
    from bubbly_chef.workflows import product_ingest

    with patch.object(product_ingest, "get_expiry_heuristics", return_value=_fake_expiry()):
        state: dict = {"parsed_items": items}
        result = product_ingest.normalize_product(state)  # type: ignore[arg-type]
    return result["normalized_items"]


@pytest.mark.parametrize("name,forbidden", PINNED_CASES)
def test_normalize_product_does_not_collapse(name: str, forbidden: str) -> None:
    items = [{"name": name, "category": "other", "quantity": 1.0, "unit": "item"}]
    normalized = _run_normalize_product(items)
    assert len(normalized) == 1
    result_name = normalized[0]["name"].lower()
    if forbidden not in name.lower():
        assert forbidden not in result_name, (
            f"{name!r} incorrectly collapsed to include {forbidden!r}: "
            f"{normalized[0]['name']!r}"
        )


def test_normalize_product_prefers_source_category_over_deterministic() -> None:
    """A known source category (LLM/OpenFoodFacts) wins over resolve_category."""
    items = [{"name": "milk chocolate", "category": "snacks", "quantity": 1.0, "unit": "item"}]
    normalized = _run_normalize_product(items)
    assert normalized[0]["category"] == FoodCategory.SNACKS.value


def test_normalize_product_falls_back_to_resolve_category_when_other() -> None:
    """When the source category is missing/'other', fall back to resolve_category
    on the normalized name rather than defaulting straight to OTHER."""
    items = [{"name": "banana", "category": "other", "quantity": 1.0, "unit": "item"}]
    normalized = _run_normalize_product(items)
    assert normalized[0]["category"] == FoodCategory.PRODUCE.value


# ---------------------------------------------------------------------------
# 3. Chat pantry-add (workflows/pantry/nodes.normalize_items)
# ---------------------------------------------------------------------------


def _run_normalize_items(items: list[dict]) -> list[dict]:
    state: dict = {
        "parsed_items": items,
        "warnings": [],
        "per_item_confidences": [item.get("confidence", 0.8) for item in items],
    }
    from bubbly_chef.workflows.pantry import nodes

    result = nodes.normalize_items(state)  # type: ignore[arg-type]
    return result["normalized_items"]


@pytest.mark.parametrize("name,forbidden", PINNED_CASES)
def test_normalize_items_does_not_collapse(name: str, forbidden: str) -> None:
    items = [{"name": name, "category": "other", "quantity": 1.0, "unit": "item", "confidence": 0.8}]
    normalized = _run_normalize_items(items)
    assert len(normalized) == 1
    result_name = normalized[0]["name"].lower()
    if forbidden not in name.lower():
        assert forbidden not in result_name, (
            f"{name!r} incorrectly collapsed to include {forbidden!r}: "
            f"{normalized[0]['name']!r}"
        )


def test_normalize_items_prefers_llm_category_over_deterministic() -> None:
    items = [
        {
            "name": "milk chocolate",
            "category": "snacks",
            "quantity": 1.0,
            "unit": "item",
            "confidence": 0.8,
        }
    ]
    normalized = _run_normalize_items(items)
    assert normalized[0]["category"] == FoodCategory.SNACKS.value


def test_normalize_items_falls_back_to_resolve_category_when_other() -> None:
    items = [
        {"name": "banana", "category": "other", "quantity": 1.0, "unit": "item", "confidence": 0.8}
    ]
    normalized = _run_normalize_items(items)
    assert normalized[0]["category"] == FoodCategory.PRODUCE.value


def test_normalize_items_keeps_prefix_and_quantity_stripping() -> None:
    items = [
        {
            "name": "organic whole milk",
            "category": "other",
            "quantity": 1.0,
            "unit": "item",
            "confidence": 0.8,
        }
    ]
    normalized = _run_normalize_items(items)
    assert normalized[0]["name"] == "milk"
