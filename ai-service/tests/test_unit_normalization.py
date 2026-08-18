"""Tests for pantry unit normalization logic."""

from unittest.mock import MagicMock, patch

import pytest

from bubbly_chef.domain.normalizer import normalize_to_base_unit
from bubbly_chef.models.pantry import PantryItem


def test_normalize_dozen_eggs() -> None:
    result = normalize_to_base_unit("eggs", 1.0, "dozen")
    assert result == (12.0, "count")


def test_normalize_stick_butter() -> None:
    result = normalize_to_base_unit("butter", 2.0, "stick")
    assert result == (226.0, "g")


def test_normalize_cup_milk() -> None:
    result = normalize_to_base_unit("milk", 1.0, "cup")
    assert result == (240.0, "ml")


def test_normalize_tbsp_sugar() -> None:
    # tbsp is a volume unit (_TO_ML) and sugar's target is "g", so this crosses
    # dimensions. It resolves through sugar's density: 3 tbsp = 45 ml at
    # 0.85 g/ml = 38.25 g. See tests/test_density_conversion.py.
    result = normalize_to_base_unit("sugar", 3.0, "tbsp")
    assert result == (38.25, "g")


def test_normalize_tbsp_without_density_is_refused() -> None:
    # Same cross-dimension shape, but no published density for matcha, so the
    # conversion is refused rather than guessed at.
    result = normalize_to_base_unit("matcha", 3.0, "tbsp")
    assert result == (None, None)


def test_normalize_same_unit() -> None:
    # Already in base unit — no-op
    result = normalize_to_base_unit("matcha", 30.0, "g")
    assert result == (30.0, "g")


def test_normalize_unknown_unit() -> None:
    # "pinch" is a volume, and eggs are registered as a counted ingredient, so
    # there is no sensible way to express a pinch of them.
    result = normalize_to_base_unit("eggs", 1.0, "pinch")
    assert result == (None, None)


def test_normalize_items_node() -> None:
    """normalize_items() should attach quantity_base and unit_base to items."""
    from bubbly_chef.workflows.pantry.nodes import normalize_items

    state = {
        "parsed_items": [
            {
                "name": "eggs",
                "quantity": 1.0,
                "unit": "dozen",
                "category": "dairy",
                "confidence": 0.9,
            }
        ],
        "warnings": [],
        "per_item_confidences": [],
        "confidence": 0.9,
    }

    result = normalize_items(state)
    items = result.get("normalized_items", [])

    assert len(items) == 1
    item = items[0]
    assert item["quantity_base"] == 12.0
    assert item["unit_base"] == "count"


def test_pantry_item_nullable_base() -> None:
    """PantryItem should default quantity_base and unit_base to None."""
    item = PantryItem(name="eggs", quantity=1.0, unit="dozen")
    assert item.quantity_base is None
    assert item.unit_base is None
