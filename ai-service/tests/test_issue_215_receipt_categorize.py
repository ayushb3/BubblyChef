"""Regression tests for issue #215: receipt eggs/milk categorize as 'other'.

Covers:
- resolve_category returns correct strings for eggs, milk, unknown
- map_category handles compound LLM labels and 'egg'/'eggs' keys
- normalize_receipt_items produces 'dairy' for both bug scenarios
"""

from unittest.mock import MagicMock, patch

import pytest

from bubbly_chef.domain.normalizer import normalize_food_name, resolve_category
from bubbly_chef.models.pantry import FoodCategory
from bubbly_chef.workflows.shared_state import map_category


# ---------------------------------------------------------------------------
# resolve_category
# ---------------------------------------------------------------------------


def test_resolve_category_eggs() -> None:
    assert resolve_category("eggs") == "dairy"


def test_resolve_category_egg() -> None:
    """Bare "egg" reaches dairy through normalization, not the catalog (#257c).

    "egg" was an ambiguous catalog synonym — claimed by whole egg, egg white,
    egg yolk, grade a eggs and others — so it was deleted rather than left to
    resolve to whichever canonical dict ordering happened to favour. Called
    directly on the raw string, resolve_category therefore returns None.

    That is not the path any caller uses. All three ingest nodes
    (receipt_ingest, product_ingest, pantry/nodes) pass ``normalized_name``,
    and normalize_food_name maps "egg" -> "eggs" via the hand-curated SYNONYMS
    table, which is unambiguous and untouched by the catalog cleanup. This
    test pins both halves so the capability cannot regress unnoticed: if
    someone makes the ingest nodes pass a raw name, the second assertion still
    holds but the first stops describing reality.
    """
    assert resolve_category("egg") is None
    assert resolve_category(normalize_food_name("egg")) == "dairy"


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


def _run_normalize(item: dict) -> dict:
    """Run the real normalize_receipt_items node over a single parsed item.

    Builds a WorkflowState dict (the node's actual input) and patches the
    module-level ``normalize_food_name``/``get_expiry_heuristics`` seams so the
    test exercises the node's own category-resolution branch — not just the helpers.

    Since Slice 2 routes receipt normalization through domain/normalizer.py's
    ``normalize_food_name`` (head-noun matcher), the identity stub just returns
    the raw name unchanged so that resolve_category sees the exact input.
    """
    import datetime

    from bubbly_chef.workflows import receipt_ingest

    fake_expiry = MagicMock()
    fake_expiry.get_default_storage.return_value = MagicMock(value="refrigerator")
    fake_expiry.estimate_expiry.return_value = (datetime.date(2026, 8, 14), True)

    with (
        patch.object(receipt_ingest, "normalize_food_name", side_effect=lambda name: name),
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
