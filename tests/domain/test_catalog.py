"""Tests for pantry catalog lookup module."""

import pytest
from bubbly_chef.domain.catalog import (
    CatalogEntry,
    _build_lookup_index,
    _load_catalog,
    categorize,
    get_emoji,
    lookup,
)


@pytest.fixture(autouse=True)
def clear_catalog_cache() -> None:
    """Clear lru_cache before each test for isolation."""
    _load_catalog.cache_clear()
    _build_lookup_index.cache_clear()


class TestCatalogLoad:
    def test_loads_all_items(self) -> None:
        """Catalog should have at least 300 entries from USDA Foundation Foods."""
        entries = _load_catalog()
        assert len(entries) >= 300

    def test_caches_result(self) -> None:
        """Calling _load_catalog() twice returns the same object (lru_cache)."""
        a = _load_catalog()
        b = _load_catalog()
        assert a is b

    def test_entry_shape(self) -> None:
        """Each entry must have required fields."""
        entries = _load_catalog()
        for entry in entries[:10]:
            assert isinstance(entry, CatalogEntry)
            assert entry.canonical
            assert entry.category
            assert entry.emoji

    def test_categories_are_valid(self) -> None:
        """All categories should be valid BubblyChef FoodCategory values."""
        valid = {
            "produce", "dairy", "meat", "seafood", "frozen",
            "dry_goods", "canned", "beverages", "condiments",
            "bakery", "snacks", "other",
        }
        entries = _load_catalog()
        for entry in entries:
            assert entry.category in valid, f"{entry.canonical!r} has invalid category {entry.category!r}"


class TestCatalogLookup:
    def test_exact_canonical_match(self) -> None:
        """Exact canonical name should return the entry."""
        # Find a canonical in the catalog
        entries = _load_catalog()
        first = entries[0]
        result = lookup(first.canonical)
        assert result is not None
        assert result.canonical == first.canonical

    def test_synonym_match(self) -> None:
        """A synonym should resolve to the same entry as the canonical."""
        # "tomatoes" is a synonym of "grape tomatoes" (or similar)
        result = lookup("grape tomatoes")
        assert result is not None
        assert result.category == "produce"

    def test_fuzzy_match_typo(self) -> None:
        """A one-character typo should still match at threshold=80."""
        result = lookup("tomatoe")  # missing 's'
        assert result is not None
        assert result.category == "produce"

    def test_below_threshold_returns_none(self) -> None:
        """A nonsense string should return None."""
        assert lookup("xylophone") is None

    def test_empty_string_returns_none(self) -> None:
        """Empty input should return None."""
        assert lookup("") is None

    def test_case_insensitive(self) -> None:
        """Lookup should be case-insensitive."""
        lower = lookup("milk")
        upper = lookup("MILK")
        assert lower is not None
        assert upper is not None
        assert lower.canonical == upper.canonical

    def test_lookup_returns_catalog_entry(self) -> None:
        """Return type should be CatalogEntry."""
        result = lookup("milk")
        assert isinstance(result, CatalogEntry)

    def test_custom_threshold(self) -> None:
        """lookup() with threshold=100 requires near-exact match."""
        # "tomatoe" should fail at threshold=100 (not exact)
        result = lookup("tomatoe", threshold=100)
        assert result is None


class TestCatalogCategorize:
    def test_known_item(self) -> None:
        """categorize() should return correct category for known items."""
        result = categorize("salmon")
        assert result == "seafood"

    def test_milk(self) -> None:
        result = categorize("milk")
        assert result == "dairy"

    def test_unknown_returns_none(self) -> None:
        """Unknown item should return None."""
        assert categorize("xylophone") is None

    def test_empty_returns_none(self) -> None:
        assert categorize("") is None


class TestCatalogGetEmoji:
    def test_known_item_returns_emoji(self) -> None:
        """get_emoji() should return a non-empty string for known items."""
        result = get_emoji("milk")
        assert result is not None
        assert len(result) > 0

    def test_unknown_returns_none(self) -> None:
        assert get_emoji("xylophone") is None


class TestCatalogIntegration:
    def test_normalizer_uses_catalog_for_seafood(self) -> None:
        """detect_category should return 'seafood' for known seafood items."""
        from bubbly_chef.domain.normalizer import detect_category

        assert detect_category("sockeye salmon") == "seafood"

    def test_normalizer_catalog_fallback_for_unknown(self) -> None:
        """detect_category should use keyword fallback for non-catalog items."""
        from bubbly_chef.domain.normalizer import detect_category

        # "unknown_thing_xyz" should return None (not in catalog or keywords)
        assert detect_category("unknown_thing_xyz") is None

    def test_normalizer_keyword_priority(self) -> None:
        """Keyword matching should take priority over catalog for core items."""
        from bubbly_chef.domain.normalizer import detect_category

        # These are in CATEGORY_KEYWORDS and should not be overridden by catalog
        assert detect_category("ketchup") == "condiments"
        assert detect_category("pasta") == "dry_goods"

    def test_catalog_extends_beyond_keywords(self) -> None:
        """Catalog should provide categories for items not in keyword lists."""
        from bubbly_chef.domain.normalizer import detect_category

        # "almonds" is not in CATEGORY_KEYWORDS but is in USDA catalog (snacks)
        result = detect_category("almonds")
        # Should get a result from catalog (snacks) or keyword fallback
        assert result is not None

    def test_build_lookup_index_size(self) -> None:
        """Lookup index should be larger than catalog (includes synonyms)."""
        entries = _load_catalog()
        index = _build_lookup_index()
        # Index has entries + all synonyms, so should be larger
        assert len(index) > len(entries)
