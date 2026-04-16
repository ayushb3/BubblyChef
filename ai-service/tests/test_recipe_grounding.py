"""Tests for unit-aware recipe grounding prompt formatting."""

from bubbly_chef.workflows.recipe.nodes import _format_pantry_item_for_prompt


def test_format_pantry_item_with_base() -> None:
    item = {
        "name": "eggs",
        "quantity": 1.0,
        "unit": "dozen",
        "quantity_base": 12.0,
        "unit_base": "count",
    }
    result = _format_pantry_item_for_prompt(item)
    assert result == "eggs (1.0 dozen = 12.0 count)"


def test_format_pantry_item_without_base() -> None:
    item = {
        "name": "eggs",
        "quantity": 1.0,
        "unit": "item",
        "quantity_base": None,
        "unit_base": None,
    }
    result = _format_pantry_item_for_prompt(item)
    assert result == "eggs (1.0 item)"
