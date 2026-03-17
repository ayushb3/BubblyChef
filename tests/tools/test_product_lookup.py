"""Tests for product lookup service."""

import pytest

from bubbly_chef.tools.product_lookup import OpenFoodFactsStub, get_product_lookup


class TestOpenFoodFactsStub:
    @pytest.mark.asyncio
    async def test_lookup_known_barcode(self):
        stub = OpenFoodFactsStub()
        result = await stub.lookup_barcode("0012000001086")
        assert result.found is True
        assert result.name == "Coca-Cola Classic"
        assert result.brand == "Coca-Cola"

    @pytest.mark.asyncio
    async def test_lookup_unknown_barcode(self):
        stub = OpenFoodFactsStub()
        result = await stub.lookup_barcode("9999999999999")
        assert result.found is False

    @pytest.mark.asyncio
    async def test_search_by_name(self):
        stub = OpenFoodFactsStub()
        results = await stub.search("milk")
        assert len(results) >= 1
        assert any("Milk" in (r.name or "") for r in results)

    @pytest.mark.asyncio
    async def test_search_by_brand(self):
        stub = OpenFoodFactsStub()
        results = await stub.search("organic valley")
        assert len(results) >= 1

    @pytest.mark.asyncio
    async def test_search_no_results(self):
        stub = OpenFoodFactsStub()
        results = await stub.search("unicorn food")
        assert len(results) == 0


class TestGetProductLookup:
    def test_returns_singleton(self):
        import bubbly_chef.tools.product_lookup as mod
        old = mod._product_lookup
        mod._product_lookup = None
        try:
            p1 = get_product_lookup()
            p2 = get_product_lookup()
            assert p1 is p2
        finally:
            mod._product_lookup = old
