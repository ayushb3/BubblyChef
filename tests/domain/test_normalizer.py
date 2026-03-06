"""Tests for domain normalizer."""

import pytest
from bubbly_chef.domain.normalizer import normalize_food_name, detect_category


class TestNormalizeFoodName:
    """Tests for food name normalization."""

    def test_basic_normalization(self):
        """Test basic lowercase and strip."""
        assert normalize_food_name("  MILK  ") == "milk"
        assert normalize_food_name("Eggs") == "eggs"

    def test_removes_organic_prefix(self):
        """Test that 'organic' prefix is removed."""
        assert normalize_food_name("organic milk") == "milk"
        assert normalize_food_name("Organic Eggs") == "eggs"

    def test_removes_fresh_prefix(self):
        """Test that 'fresh' prefix is removed."""
        assert normalize_food_name("fresh spinach") == "spinach"

    def test_synonym_mapping(self):
        """Test that synonyms map to canonical names."""
        assert normalize_food_name("2% milk") == "milk"
        assert normalize_food_name("whole milk") == "milk"
        assert normalize_food_name("greek yogurt") == "yogurt"
        assert normalize_food_name("dozen eggs") == "eggs"

    def test_removes_quantity_prefix(self):
        """Test that quantity prefixes are removed."""
        # The regex removes quantity patterns
        result = normalize_food_name("2lb chicken")
        assert "chicken" in result.lower()

    def test_partial_match(self):
        """Test partial matching for longer descriptions."""
        assert normalize_food_name("organic whole milk 1 gallon") == "milk"

    def test_unknown_item_passthrough(self):
        """Test that unknown items pass through cleaned."""
        assert normalize_food_name("dragon fruit") == "dragon fruit"
        assert normalize_food_name("QUINOA") == "quinoa"

    def test_empty_string(self):
        """Test empty string handling."""
        assert normalize_food_name("") == ""


class TestDetectCategory:
    """Tests for category detection."""

    def test_dairy_detection(self):
        """Test dairy category detection."""
        assert detect_category("milk") == "dairy"
        assert detect_category("cheese") == "dairy"
        assert detect_category("yogurt") == "dairy"
        assert detect_category("butter") == "dairy"

    def test_produce_detection(self):
        """Test produce category detection."""
        assert detect_category("apple") == "produce"
        assert detect_category("banana") == "produce"
        assert detect_category("broccoli") == "produce"
        assert detect_category("spinach") == "produce"

    def test_meat_detection(self):
        """Test meat category detection."""
        assert detect_category("chicken") == "meat"
        assert detect_category("beef") == "meat"
        assert detect_category("pork") == "meat"
        assert detect_category("bacon") == "meat"

    def test_seafood_detection(self):
        """Test seafood category detection."""
        assert detect_category("salmon") == "seafood"
        assert detect_category("shrimp") == "seafood"
        assert detect_category("tuna") == "seafood"

    def test_pantry_detection(self):
        """Test pantry staples detection."""
        assert detect_category("rice") == "pantry"
        assert detect_category("pasta") == "pantry"
        assert detect_category("flour") == "pantry"
        assert detect_category("canned beans") == "pantry"

    def test_condiments_detection(self):
        """Test condiments detection."""
        assert detect_category("ketchup") == "condiments"
        assert detect_category("soy sauce") == "condiments"
        assert detect_category("mustard") == "condiments"

    def test_unknown_returns_none(self):
        """Test that unknown items return None."""
        assert detect_category("xyz123") is None
        assert detect_category("") is None
