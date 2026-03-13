"""Tests for PantryItem model computed properties."""

import pytest
from datetime import date, timedelta

from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation


class TestPantryItemProperties:
    """Test computed properties on PantryItem."""

    def test_location_alias(self):
        """Test that .location returns storage_location value."""
        item = PantryItem(
            name="Milk",
            storage_location=StorageLocation.FRIDGE,
        )
        assert item.location == StorageLocation.FRIDGE
        assert item.location.value == "fridge"

    def test_location_alias_all_locations(self):
        """Test location alias works for all storage locations."""
        for location in StorageLocation:
            item = PantryItem(name="Test", storage_location=location)
            assert item.location == location

    def test_name_normalized(self):
        """Test normalized name property."""
        item = PantryItem(name="  Organic MILK  ")
        assert item.name_normalized == "organic milk"

    def test_name_normalized_preserves_inner_spaces(self):
        """Test that inner spaces are preserved."""
        item = PantryItem(name="Chicken Breast")
        assert item.name_normalized == "chicken breast"

    def test_name_normalized_empty_becomes_empty(self):
        """Test edge case with minimal name."""
        item = PantryItem(name="A")
        assert item.name_normalized == "a"

    def test_days_until_expiry_future(self):
        """Test days_until_expiry with future date."""
        item = PantryItem(
            name="Milk",
            expiry_date=date.today() + timedelta(days=5),
        )
        assert item.days_until_expiry == 5

    def test_days_until_expiry_today(self):
        """Test days_until_expiry when expiring today."""
        item = PantryItem(
            name="Milk",
            expiry_date=date.today(),
        )
        assert item.days_until_expiry == 0

    def test_days_until_expiry_past(self):
        """Test days_until_expiry with past date (expired)."""
        item = PantryItem(
            name="Milk",
            expiry_date=date.today() - timedelta(days=2),
        )
        assert item.days_until_expiry == -2

    def test_days_until_expiry_none(self):
        """Test days_until_expiry when no expiry set."""
        item = PantryItem(name="Rice")
        assert item.days_until_expiry is None

    def test_is_expiring_soon_true_today(self):
        """Test is_expiring_soon returns True for today."""
        item = PantryItem(
            name="Chicken",
            expiry_date=date.today(),
        )
        assert item.is_expiring_soon is True

    def test_is_expiring_soon_true_within_3_days(self):
        """Test is_expiring_soon returns True within 3 days."""
        for days in [0, 1, 2, 3]:
            item = PantryItem(
                name="Chicken",
                expiry_date=date.today() + timedelta(days=days),
            )
            assert item.is_expiring_soon is True, f"Failed for {days} days"

    def test_is_expiring_soon_false_beyond_3_days(self):
        """Test is_expiring_soon returns False beyond 3 days."""
        item = PantryItem(
            name="Canned Beans",
            expiry_date=date.today() + timedelta(days=4),
        )
        assert item.is_expiring_soon is False

    def test_is_expiring_soon_false_30_days(self):
        """Test is_expiring_soon returns False for items with long shelf life."""
        item = PantryItem(
            name="Canned Beans",
            expiry_date=date.today() + timedelta(days=30),
        )
        assert item.is_expiring_soon is False

    def test_is_expiring_soon_no_expiry(self):
        """Test is_expiring_soon returns False when no expiry."""
        item = PantryItem(name="Salt")
        assert item.is_expiring_soon is False

    def test_is_expiring_soon_false_for_expired(self):
        """Test is_expiring_soon returns False for already expired items."""
        item = PantryItem(
            name="Milk",
            expiry_date=date.today() - timedelta(days=1),
        )
        assert item.is_expiring_soon is False

    def test_is_expired_true(self):
        """Test is_expired returns True for past dates."""
        item = PantryItem(
            name="Milk",
            expiry_date=date.today() - timedelta(days=1),
        )
        assert item.is_expired is True

    def test_is_expired_true_multiple_days(self):
        """Test is_expired returns True for items expired multiple days ago."""
        item = PantryItem(
            name="Milk",
            expiry_date=date.today() - timedelta(days=7),
        )
        assert item.is_expired is True

    def test_is_expired_false(self):
        """Test is_expired returns False for future dates."""
        item = PantryItem(
            name="Milk",
            expiry_date=date.today() + timedelta(days=1),
        )
        assert item.is_expired is False

    def test_is_expired_today(self):
        """Test is_expired returns False for today (still valid)."""
        item = PantryItem(
            name="Milk",
            expiry_date=date.today(),
        )
        assert item.is_expired is False

    def test_is_expired_no_expiry(self):
        """Test is_expired returns False when no expiry date."""
        item = PantryItem(name="Salt")
        assert item.is_expired is False


class TestPantryItemClientKey:
    """Tests for generate_client_key method."""

    def test_generate_client_key_basic(self):
        """Test basic client key generation."""
        item = PantryItem(
            name="Milk",
            category=FoodCategory.DAIRY,
        )
        assert item.generate_client_key() == "dairy:milk"

    def test_generate_client_key_with_spaces(self):
        """Test client key generation with spaces in name."""
        item = PantryItem(
            name="Chicken Breast",
            category=FoodCategory.MEAT,
        )
        assert item.generate_client_key() == "meat:chicken_breast"

    def test_generate_client_key_uppercase(self):
        """Test client key generation normalizes case."""
        item = PantryItem(
            name="ORGANIC EGGS",
            category=FoodCategory.DAIRY,
        )
        assert item.generate_client_key() == "dairy:organic_eggs"


class TestPantryItemDefaults:
    """Tests for default values."""

    def test_default_quantity(self):
        """Test default quantity is 1.0."""
        item = PantryItem(name="Test")
        assert item.quantity == 1.0

    def test_default_unit(self):
        """Test default unit is 'item'."""
        item = PantryItem(name="Test")
        assert item.unit == "item"

    def test_default_category(self):
        """Test default category is OTHER."""
        item = PantryItem(name="Test")
        assert item.category == FoodCategory.OTHER

    def test_default_storage_location(self):
        """Test default storage location is PANTRY."""
        item = PantryItem(name="Test")
        assert item.storage_location == StorageLocation.PANTRY

    def test_uuid_generated(self):
        """Test that UUID is auto-generated."""
        item = PantryItem(name="Test")
        assert item.id is not None

    def test_timestamps_generated(self):
        """Test that timestamps are auto-generated."""
        item = PantryItem(name="Test")
        assert item.created_at is not None
        assert item.updated_at is not None
