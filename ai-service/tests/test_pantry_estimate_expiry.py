"""Tests for the pantry expiry-estimation endpoint helpers (#158).

The endpoint itself requires JWT auth + wires FastAPI, but the interesting
behaviour is the category/location coercion and that a real heuristic date comes
back. These test that layer directly.
"""

from datetime import date

from bubbly_chef.api.routes.pantry import (
    EstimateExpiryRequest,
    _coerce_category,
    _coerce_location,
)
from bubbly_chef.models.pantry import FoodCategory, StorageLocation
from bubbly_chef.tools.expiry import get_expiry_heuristics


def test_coerce_category_valid():
    assert _coerce_category("dairy") == FoodCategory.DAIRY
    assert _coerce_category("produce") == FoodCategory.PRODUCE


def test_coerce_category_unknown_falls_back_to_other():
    assert _coerce_category("not-a-category") == FoodCategory.OTHER
    assert _coerce_category("") == FoodCategory.OTHER


def test_coerce_location_valid():
    assert _coerce_location("fridge") == StorageLocation.FRIDGE
    assert _coerce_location("freezer") == StorageLocation.FREEZER


def test_coerce_location_unknown_falls_back_to_pantry():
    assert _coerce_location("garage") == StorageLocation.PANTRY


def test_request_defaults():
    req = EstimateExpiryRequest(name="milk")
    assert req.category == "other"
    assert req.location == "pantry"


def test_heuristic_returns_future_date_for_known_item():
    """The estimator the endpoint wraps returns a plausible future expiry."""
    expiry, is_estimated = get_expiry_heuristics().estimate_expiry(
        category=FoodCategory.DAIRY,
        storage=StorageLocation.FRIDGE,
        name="milk",
    )
    assert isinstance(expiry, date)
    assert expiry > date.today()
    assert is_estimated is True
