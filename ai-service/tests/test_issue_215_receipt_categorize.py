"""Regression tests for issue #215: receipt eggs/milk categorize as 'other'.

Covers:
- resolve_category returns correct strings for eggs, milk, unknown
- map_category handles compound LLM labels and 'egg'/'eggs' keys
- normalize_receipt_items produces 'dairy' for both bug scenarios
"""

from unittest.mock import MagicMock, patch

import pytest

from bubbly_chef.domain.normalizer import resolve_category
from bubbly_chef.models.pantry import FoodCategory
from bubbly_chef.workflows.shared_state import map_category


# ---------------------------------------------------------------------------
# resolve_category
# ---------------------------------------------------------------------------


def test_resolve_category_eggs() -> None:
    assert resolve_category("eggs") == "dairy"


def test_resolve_category_egg() -> None:
    assert resolve_category("egg") == "dairy"


def test_resolve_category_milk() -> None:
    result = resolve_category("milk")
    assert result == "dairy"


def test_resolve_category_whole_milk() -> None:
    result = resolve_category("whole milk")
    assert result == "dairy"


def test_resolve_category_greek_yogurt() -> None:
    result = resolve_category("greek yogurt")
    assert result == "dairy"


def test_resolve_category_unknown_returns_none() -> None:
    assert resolve_category("xyzunknownitem99999") is None


# ---------------------------------------------------------------------------
# map_category — compound labels and new egg keys
# ---------------------------------------------------------------------------


def test_map_category_dairy_and_eggs() -> None:
    """LLM compound label 'dairy & eggs' must map to DAIRY, not OTHER."""
    assert map_category("dairy & eggs") == FoodCategory.DAIRY


def test_map_category_egg() -> None:
    assert map_category("egg") == FoodCategory.DAIRY


def test_map_category_eggs() -> None:
    assert map_category("eggs") == FoodCategory.DAIRY


def test_map_category_produce_slash_vegetables() -> None:
    assert map_category("produce/vegetables") == FoodCategory.PRODUCE


def test_map_category_exact_matches_unchanged() -> None:
    """Existing exact matches must still resolve correctly."""
    assert map_category("dairy") == FoodCategory.DAIRY
    assert map_category("produce") == FoodCategory.PRODUCE
    assert map_category("meat") == FoodCategory.MEAT
    assert map_category("seafood") == FoodCategory.SEAFOOD
    assert map_category("bakery") == FoodCategory.BAKERY


def test_map_category_other_for_unknown() -> None:
    assert map_category("unknowncategoryxyz") == FoodCategory.OTHER


def test_map_category_none_returns_other() -> None:
    assert map_category(None) == FoodCategory.OTHER


# ---------------------------------------------------------------------------
# normalize_receipt_items — direct regression for the reported bug
# ---------------------------------------------------------------------------


def _make_normalizer_stub(normalized_name: str) -> MagicMock:
    stub = MagicMock()
    stub.normalize.return_value = normalized_name
    return stub


def _run_normalize(item: dict) -> dict:
    """Run the real normalize_receipt_items node over a single parsed item.

    Builds a WorkflowState dict (the node's actual input) and patches the
    module-level ``get_normalizer``/``get_expiry_heuristics`` seams so the test
    exercises the node's own category-resolution branch — not just the helpers.
    """
    import datetime

    from bubbly_chef.workflows import receipt_ingest

    fake_expiry = MagicMock()
    fake_expiry.get_default_storage.return_value = MagicMock(value="refrigerator")
    fake_expiry.estimate_expiry.return_value = (datetime.date(2026, 8, 14), True)

    # Identity normalizer: the node passes the raw name straight to resolve_category.
    stub_normalizer = _make_normalizer_stub(item["name"])

    with (
        patch.object(receipt_ingest, "get_normalizer", return_value=stub_normalizer),
        patch.object(receipt_ingest, "get_expiry_heuristics", return_value=fake_expiry),
    ):
        state: dict = {"parsed_items": [item]}
        result = receipt_ingest.normalize_receipt_items(state)

    return result["normalized_items"][0]


@pytest.mark.parametrize(
    "item,expected_category",
    [
        # Eggs: LLM returned "other" — keyword/catalog path must catch it
        ({"name": "eggs", "category": "other", "quantity": 1.0, "unit": "dozen"}, "dairy"),
        # Milk: LLM returned compound label that exact-match dropped to OTHER
        ({"name": "milk", "category": "dairy & eggs", "quantity": 1.0, "unit": "gallon"}, "dairy"),
    ],
)
def test_normalize_receipt_items_dairy(item: dict, expected_category: str) -> None:
    """Direct regression: eggs/milk receipt items must resolve to dairy.

    Exercises the real node end-to-end (state in → normalized_items out), so a
    future signature or branch-precedence change is caught here.
    """
    normalized = _run_normalize(item)
    assert normalized["category"] == expected_category
