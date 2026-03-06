"""Tests for domain expiry logic."""

import pytest
from datetime import date, timedelta
from bubbly_chef.domain.expiry import (
    estimate_expiry_days,
    get_default_location,
    calculate_expiry_date,
)


class TestEstimateExpiryDays:
    """Tests for expiry estimation."""

    def test_dairy_defaults(self):
        """Test dairy category defaults."""
        # Cheese has a specific override of 21 days
        days = estimate_expiry_days("cheese", "dairy", "fridge")
        assert days == 21  # Specific item override

    def test_generic_dairy_default(self):
        """Test generic dairy item uses category default."""
        # Something not matching any override keywords
        days = estimate_expiry_days("half and half", "dairy", "fridge")
        assert days == 14  # Category default

    def test_specific_item_overrides(self):
        """Test specific item overrides."""
        # Milk has specific override
        days = estimate_expiry_days("milk", "dairy", "fridge")
        assert days == 10

        # Eggs have specific override
        days = estimate_expiry_days("eggs", "dairy", "fridge")
        assert days == 21

    def test_produce_defaults(self):
        """Test produce category defaults."""
        days = estimate_expiry_days("vegetable", "produce", "fridge")
        assert days == 7  # Category default

    def test_produce_specific_items(self):
        """Test specific produce items."""
        assert estimate_expiry_days("banana", "produce", "fridge") == 5
        assert estimate_expiry_days("apple", "produce", "fridge") == 21
        assert estimate_expiry_days("lettuce", "produce", "fridge") == 5

    def test_meat_defaults(self):
        """Test meat category defaults."""
        days = estimate_expiry_days("pork", "meat", "fridge")
        assert days == 3

    def test_meat_specific_items(self):
        """Test specific meat items."""
        assert estimate_expiry_days("chicken", "meat", "fridge") == 2
        assert estimate_expiry_days("bacon", "meat", "fridge") == 7

    def test_freezer_multiplier(self):
        """Test that freezer extends shelf life."""
        fridge_days = estimate_expiry_days("chicken", "meat", "fridge")
        freezer_days = estimate_expiry_days("chicken", "meat", "freezer")
        assert freezer_days == fridge_days * 6

    def test_counter_multiplier(self):
        """Test that counter reduces shelf life."""
        fridge_days = estimate_expiry_days("bread", "bakery", "fridge")
        counter_days = estimate_expiry_days("bread", "bakery", "counter")
        # Counter is 0.7x, but bread has specific 7-day override
        assert counter_days < fridge_days

    def test_pantry_staples_long_shelf_life(self):
        """Test that pantry staples have long shelf life."""
        days = estimate_expiry_days("rice", "pantry", "pantry")
        assert days == 365


class TestGetDefaultLocation:
    """Tests for default location by category."""

    def test_dairy_goes_to_fridge(self):
        assert get_default_location("dairy") == "fridge"

    def test_meat_goes_to_fridge(self):
        assert get_default_location("meat") == "fridge"

    def test_frozen_goes_to_freezer(self):
        assert get_default_location("frozen") == "freezer"

    def test_pantry_staples_go_to_pantry(self):
        assert get_default_location("pantry") == "pantry"

    def test_bakery_goes_to_counter(self):
        assert get_default_location("bakery") == "counter"

    def test_unknown_defaults_to_pantry(self):
        assert get_default_location("unknown") == "pantry"


class TestCalculateExpiryDate:
    """Tests for expiry date calculation."""

    def test_returns_date_object(self):
        result = calculate_expiry_date("milk", "dairy", "fridge")
        assert isinstance(result, date)

    def test_date_is_in_future(self):
        result = calculate_expiry_date("milk", "dairy", "fridge")
        assert result > date.today()

    def test_correct_days_offset(self):
        result = calculate_expiry_date("milk", "dairy", "fridge")
        expected = date.today() + timedelta(days=10)
        assert result == expected
