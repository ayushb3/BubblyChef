"""Tests for the pantry category-estimation endpoint helpers.

The endpoint itself requires JWT auth + wires FastAPI, but the interesting
behaviour is the catalog lookup and that known items resolve to the right
category while unknown items return None. These test that layer directly.
"""

from bubbly_chef.api.routes.pantry import (
    EstimateCategoryRequest,
    EstimateCategoryResponse,
)
from bubbly_chef.domain.catalog import categorize


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
