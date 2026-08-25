"""Regression tests for PR #252: LLM category should win over resolve_category.

This is the third instance of the substring-matching bug in this PR (after the
"bag"->baguette filter and the bidirectional normalizer). `resolve_category`
uses keyword substring matching and can override a correct LLM answer with a
wrong one (e.g. "italian bomba hot pepper" -> "produce" via "pepper").

Covers:
- LLMParsedItem.category is constrained to the FoodCategory enum (schema)
- normalize_receipt_items prefers the LLM's category when present and not "other"
- normalize_receipt_items falls back to resolve_category when the LLM
  returns "other" or no category at all
"""

import datetime
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from bubbly_chef.models.pantry import FoodCategory
from bubbly_chef.workflows import receipt_ingest
from bubbly_chef.workflows.shared_state import LLMParsedItem


# ---------------------------------------------------------------------------
# Schema constraint
# ---------------------------------------------------------------------------


def test_llm_parsed_item_accepts_valid_enum_value() -> None:
    item = LLMParsedItem(name="Baguette", category="bakery")
    assert item.category == FoodCategory.BAKERY


def test_llm_parsed_item_rejects_free_form_category() -> None:
    """A free-form label the model might have emitted before the schema
    constraint (e.g. "Baked Goods") is no longer a valid value."""
    with pytest.raises(ValidationError):
        LLMParsedItem(name="Baguette", category="Baked Goods")


def test_llm_parsed_item_defaults_category_to_none() -> None:
    item = LLMParsedItem(name="Mystery Item")
    assert item.category is None


# ---------------------------------------------------------------------------
# normalize_receipt_items precedence
# ---------------------------------------------------------------------------


def _run_normalize(item: dict) -> dict:
    """Run the real normalize_receipt_items node over a single parsed item."""

    fake_expiry = MagicMock()
    fake_expiry.get_default_storage.return_value = MagicMock(value="pantry")
    fake_expiry.estimate_expiry.return_value = (datetime.date(2026, 12, 31), True)

    with (
        patch.object(receipt_ingest, "normalize_food_name", side_effect=lambda name: name),
        patch.object(receipt_ingest, "get_expiry_heuristics", return_value=fake_expiry),
    ):
        state: dict = {"parsed_items": [item]}
        result = receipt_ingest.normalize_receipt_items(state)

    return result["normalized_items"][0]


def test_llm_category_wins_over_wrong_resolve_category() -> None:
    """resolve_category would say "produce" (substring match on "pepper"),
    but the LLM's "condiments" answer must win."""
    item = {
        "name": "italian bomba hot pepper",
        "category": "condiments",
        "quantity": 1.0,
        "unit": "item",
    }
    normalized = _run_normalize(item)
    assert normalized["category"] == "condiments"


def test_llm_category_wins_when_resolve_category_has_no_answer() -> None:
    """resolve_category returns None for "sea salt fine crystals"; the LLM's
    answer must be used directly instead of falling back to OTHER."""
    item = {
        "name": "sea salt fine crystals",
        "category": "condiments",
        "quantity": 1.0,
        "unit": "item",
    }
    normalized = _run_normalize(item)
    assert normalized["category"] == "condiments"


def test_fallback_to_resolve_category_when_llm_returns_other() -> None:
    """When the LLM gives up and says "other", resolve_category's deterministic
    answer is used as a fallback rather than shipping "other"."""
    item = {
        "name": "eggs",
        "category": "other",
        "quantity": 1.0,
        "unit": "dozen",
    }
    normalized = _run_normalize(item)
    assert normalized["category"] == "dairy"


def test_fallback_to_resolve_category_when_llm_returns_none() -> None:
    """When the LLM omits category entirely, resolve_category is used."""
    item = {
        "name": "eggs",
        "category": None,
        "quantity": 1.0,
        "unit": "dozen",
    }
    normalized = _run_normalize(item)
    assert normalized["category"] == "dairy"


def test_fallback_to_other_when_neither_llm_nor_resolve_category_know() -> None:
    """When both the LLM and resolve_category come up empty, OTHER is the
    final result (not a crash)."""
    item = {
        "name": "xyzunknownitem99999",
        "category": None,
        "quantity": 1.0,
        "unit": "item",
    }
    normalized = _run_normalize(item)
    assert normalized["category"] == "other"
