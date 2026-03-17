"""Tests for domain defaults module."""

from bubbly_chef.domain.defaults import get_default_quantity_and_unit


class TestGetDefaultQuantityAndUnit:
    """Test default quantity/unit inference."""

    def test_known_item_milk(self):
        qty, unit = get_default_quantity_and_unit("milk", "dairy")
        assert qty == 1
        assert unit == "gallon"

    def test_known_item_eggs(self):
        qty, unit = get_default_quantity_and_unit("eggs", "dairy")
        assert qty == 1
        assert unit == "dozen"

    def test_known_item_bread(self):
        qty, unit = get_default_quantity_and_unit("bread", "bakery")
        assert qty == 1
        assert unit == "loaf"

    def test_known_item_chicken(self):
        qty, unit = get_default_quantity_and_unit("chicken", "meat")
        assert qty == 1
        assert unit == "lb"

    def test_known_item_juice(self):
        qty, unit = get_default_quantity_and_unit("orange juice", "beverages")
        assert qty == 1
        assert unit == "bottle"

    def test_known_item_ketchup(self):
        qty, unit = get_default_quantity_and_unit("ketchup", "condiments")
        assert qty == 1
        assert unit == "bottle"

    def test_known_item_chips(self):
        qty, unit = get_default_quantity_and_unit("chips", "snacks")
        assert qty == 1
        assert unit == "bag"

    def test_known_item_ice_cream(self):
        qty, unit = get_default_quantity_and_unit("ice cream", "frozen")
        assert qty == 1
        assert unit == "pint"

    def test_known_item_tuna(self):
        qty, unit = get_default_quantity_and_unit("tuna", "canned")
        assert qty == 1
        assert unit == "can"

    def test_category_fallback_dairy(self):
        qty, unit = get_default_quantity_and_unit("gouda", "dairy")
        assert qty == 1
        assert unit == "container"

    def test_category_fallback_produce(self):
        qty, unit = get_default_quantity_and_unit("kale", "produce")
        assert qty == 1
        assert unit == "lb"

    def test_category_fallback_meat(self):
        qty, unit = get_default_quantity_and_unit("lamb", "meat")
        assert qty == 1
        assert unit == "lb"

    def test_category_fallback_seafood(self):
        qty, unit = get_default_quantity_and_unit("lobster", "seafood")
        assert qty == 1
        assert unit == "lb"

    def test_category_fallback_bakery(self):
        qty, unit = get_default_quantity_and_unit("croissant", "bakery")
        assert qty == 1
        assert unit == "loaf"

    def test_category_fallback_beverages(self):
        qty, unit = get_default_quantity_and_unit("kombucha", "beverages")
        assert qty == 1
        assert unit == "bottle"

    def test_category_fallback_condiments(self):
        qty, unit = get_default_quantity_and_unit("relish", "condiments")
        assert qty == 1
        assert unit == "jar"

    def test_category_fallback_frozen(self):
        qty, unit = get_default_quantity_and_unit("frozen waffles", "frozen")
        # "frozen" is a known key, so it matches first
        assert qty == 1
        assert unit == "package"

    def test_category_fallback_snacks(self):
        qty, unit = get_default_quantity_and_unit("trail mix", "snacks")
        assert qty == 1
        assert unit == "package"

    def test_ultimate_fallback(self):
        qty, unit = get_default_quantity_and_unit("mystery item", "other")
        assert qty == 1
        assert unit == "item"

    def test_case_insensitive(self):
        qty, unit = get_default_quantity_and_unit("MILK", "dairy")
        assert unit == "gallon"

    def test_substring_match(self):
        qty, unit = get_default_quantity_and_unit("organic whole milk", "dairy")
        assert unit == "gallon"
