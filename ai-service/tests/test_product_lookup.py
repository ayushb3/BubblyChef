"""Tests for OpenFoodFactsClient (tools/product_lookup.py).

Every test mocks the HTTP layer with httpx.MockTransport — no live network
calls, following the pattern established in test_provider_tool_calling.py.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from bubbly_chef.tools.product_lookup import (
    OpenFoodFactsClient,
    ProductInfo,
    _map_off_category,
    get_product_lookup,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _client_with_handler(handler: Any) -> OpenFoodFactsClient:
    """Return an OpenFoodFactsClient wired to a MockTransport.

    Exercises the client's real ``_get_json`` (and its exception handling) —
    only the transport is swapped out, following the pattern used in
    test_provider_tool_calling.py.
    """
    return OpenFoodFactsClient(
        base_url="http://off.test",
        transport=httpx.MockTransport(handler),
    )


FOUND_PRODUCT_BODY = {
    "code": "0038000138416",
    "status": 1,
    "status_verbose": "product found",
    "product": {
        "product_name": "Frosted Flakes",
        "brands": "Kellogg's, Kellogg Company",
        "categories": "Breakfast cereals, Cereals and potatoes, Cereals",
        "quantity": "13.5 oz (383 g)",
        "ingredients_text": "milled corn, sugar, malt flavoring, salt",
        "allergens": "en:gluten",
        "nutriments": {"energy-kcal_100g": 375},
        "image_url": "https://images.openfoodfacts.org/frosted-flakes.jpg",
    },
}

NOT_FOUND_BODY = {
    "code": "0000000000000",
    "status": 0,
    "status_verbose": "product not found",
}


# ---------------------------------------------------------------------------
# Found
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_lookup_barcode_found_maps_fields() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert "product/0038000138416.json" in str(request.url)
        assert request.headers["user-agent"].startswith("BubblyChef/")
        return httpx.Response(200, json=FOUND_PRODUCT_BODY)

    client = _client_with_handler(handler)
    result = await client.lookup_barcode("0038000138416")

    assert result.found is True
    assert result.name == "Frosted Flakes"
    assert result.brand == "Kellogg's"
    assert result.category == "dry_goods"
    assert result.quantity == "13.5 oz (383 g)"
    assert "milled corn" in result.ingredients
    assert "en:gluten" in result.allergens
    assert result.nutrition == {"energy-kcal_100g": 375}
    assert result.barcode == "0038000138416"


# ---------------------------------------------------------------------------
# Not found (OpenFoodFacts v2 returns HTTP 200 with status: 0)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_lookup_barcode_not_found_status_zero() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=NOT_FOUND_BODY)

    client = _client_with_handler(handler)
    result = await client.lookup_barcode("0000000000000")

    assert result == ProductInfo(barcode="0000000000000", found=False)


@pytest.mark.asyncio
async def test_lookup_barcode_not_found_http_404() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"status": 0})

    client = _client_with_handler(handler)
    result = await client.lookup_barcode("9999999999999")

    assert result.found is False
    assert result.barcode == "9999999999999"


# ---------------------------------------------------------------------------
# Timeout
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_lookup_barcode_timeout_degrades_gracefully() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timed out", request=request)

    client = _client_with_handler(handler)
    result = await client.lookup_barcode("0038000138416")

    assert result.found is False
    assert result.barcode == "0038000138416"


# ---------------------------------------------------------------------------
# Malformed response
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_lookup_barcode_malformed_json_degrades_gracefully() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not json{{{")

    client = _client_with_handler(handler)
    result = await client.lookup_barcode("0038000138416")

    assert result.found is False


@pytest.mark.asyncio
async def test_lookup_barcode_unexpected_shape_degrades_gracefully() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        # `product` is a string instead of an object — unexpected shape.
        return httpx.Response(200, json={"status": 1, "product": "oops"})

    client = _client_with_handler(handler)
    result = await client.lookup_barcode("0038000138416")

    assert result.found is False


@pytest.mark.asyncio
async def test_lookup_barcode_missing_name_treated_as_not_found() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": 1, "product": {"brands": "Acme"}})

    client = _client_with_handler(handler)
    result = await client.lookup_barcode("123")

    assert result.found is False


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_maps_multiple_results() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert "cgi/search.pl" in str(request.url)
        return httpx.Response(
            200,
            json={
                "products": [
                    {
                        "code": "1",
                        "product_name": "Whole Milk",
                        "brands": "Organic Valley",
                        "categories": "Dairies, Milks",
                    },
                    {
                        "code": "2",
                        "product_name": "Coca-Cola Classic",
                        "brands": "Coca-Cola",
                        "categories": "Beverages, Sodas",
                    },
                ]
            },
        )

    client = _client_with_handler(handler)
    results = await client.search("milk")

    assert len(results) == 2
    assert results[0].name == "Whole Milk"
    assert results[0].category == "dairy"
    assert results[1].category == "beverages"


@pytest.mark.asyncio
async def test_search_skips_malformed_entries() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"products": ["not-a-dict", {"code": "1", "product_name": "Eggs"}]},
        )

    client = _client_with_handler(handler)
    results = await client.search("eggs")

    assert len(results) == 1
    assert results[0].name == "Eggs"


@pytest.mark.asyncio
async def test_search_timeout_returns_empty_list() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timed out", request=request)

    client = _client_with_handler(handler)
    results = await client.search("anything")

    assert results == []


# ---------------------------------------------------------------------------
# Category mapping
# ---------------------------------------------------------------------------


def test_category_mapping_known_category() -> None:
    assert _map_off_category("Breakfast cereals, Cereals and potatoes") == "dry_goods"
    assert _map_off_category("Dairies, Milks, Fermented milk products") == "dairy"


def test_category_mapping_unrecognized_falls_back_to_other() -> None:
    assert _map_off_category("Some Completely Unknown Upstream Tag") == "other"
    assert _map_off_category(None) == "other"


# ---------------------------------------------------------------------------
# Singleton getter
# ---------------------------------------------------------------------------


def test_get_product_lookup_returns_singleton() -> None:
    first = get_product_lookup()
    second = get_product_lookup()
    assert first is second
    assert isinstance(first, OpenFoodFactsClient)
