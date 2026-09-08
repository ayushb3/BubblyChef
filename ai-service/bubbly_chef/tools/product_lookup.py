"""Product lookup abstraction backed by the OpenFoodFacts public API."""

import logging
from abc import ABC, abstractmethod
from typing import Any

import httpx
from pydantic import BaseModel, Field

from bubbly_chef.models.pantry import FoodCategory

logger = logging.getLogger(__name__)

OPENFOODFACTS_BASE_URL = "https://world.openfoodfacts.org"
_USER_AGENT = "BubblyChef/1.0 (github.com/ayushb3/BubblyChef)"
_REQUEST_TIMEOUT = 8.0


class ProductInfo(BaseModel):
    """Product information from lookup service."""

    barcode: str | None = None
    name: str | None = None
    brand: str | None = None
    category: str | None = None
    quantity: str | None = Field(default=None, description="e.g., '500g', '1L'")
    ingredients: list[str] = Field(default_factory=list)
    allergens: list[str] = Field(default_factory=list)
    nutrition: dict[str, Any] = Field(default_factory=dict)
    image_url: str | None = None
    found: bool = Field(default=False, description="Whether product was found")


class ProductLookup(ABC):
    """Abstract base class for product lookup services."""

    @abstractmethod
    async def lookup_barcode(self, barcode: str) -> ProductInfo:
        """Look up a product by barcode."""
        pass

    @abstractmethod
    async def search(self, query: str) -> list[ProductInfo]:
        """Search for products by name/description."""
        pass


# -----------------------------------------------------------------------------
# Category mapping
# -----------------------------------------------------------------------------
#
# OpenFoodFacts categories are messy free-text/tag data — e.g. the ``categories``
# field is a comma-separated list of human labels like
# "Breakfast cereals, Cereals and potatoes, Cereals", and ``categories_tags`` is
# a list of ``en:``-prefixed slugs like "en:breakfast-cereals". Rather than try
# to exhaustively map OpenFoodFacts' taxonomy, this does a straightforward
# keyword/substring match against a curated set of common categories onto this
# app's own vocabulary (bubbly_chef.models.pantry.FoodCategory). Anything that
# doesn't match falls back to FoodCategory.OTHER — the raw upstream string is
# never passed through unmapped.
#
# Order matters: the first keyword that matches wins, so more specific terms
# (e.g. "seafood") are listed before broader ones that could otherwise
# shadow them.
_CATEGORY_KEYWORDS: list[tuple[str, FoodCategory]] = [
    ("seafood", FoodCategory.SEAFOOD),
    ("fish", FoodCategory.SEAFOOD),
    ("shellfish", FoodCategory.SEAFOOD),
    ("shrimp", FoodCategory.SEAFOOD),
    ("salmon", FoodCategory.SEAFOOD),
    ("tuna", FoodCategory.SEAFOOD),
    ("meat", FoodCategory.MEAT),
    ("beef", FoodCategory.MEAT),
    ("pork", FoodCategory.MEAT),
    ("poultry", FoodCategory.MEAT),
    ("chicken", FoodCategory.MEAT),
    ("sausage", FoodCategory.MEAT),
    ("ham", FoodCategory.MEAT),
    ("dairy", FoodCategory.DAIRY),
    ("dairies", FoodCategory.DAIRY),
    ("milk", FoodCategory.DAIRY),
    ("cheese", FoodCategory.DAIRY),
    ("yogurt", FoodCategory.DAIRY),
    ("yoghurt", FoodCategory.DAIRY),
    ("butter", FoodCategory.DAIRY),
    ("cream", FoodCategory.DAIRY),
    ("frozen", FoodCategory.FROZEN),
    ("canned", FoodCategory.CANNED),
    ("tinned", FoodCategory.CANNED),
    ("preserve", FoodCategory.CANNED),
    ("preserved", FoodCategory.CANNED),
    ("bakery", FoodCategory.BAKERY),
    ("bread", FoodCategory.BAKERY),
    ("pastry", FoodCategory.BAKERY),
    ("pastries", FoodCategory.BAKERY),
    ("cake", FoodCategory.BAKERY),
    ("condiment", FoodCategory.CONDIMENTS),
    ("sauce", FoodCategory.CONDIMENTS),
    ("spice", FoodCategory.CONDIMENTS),
    ("seasoning", FoodCategory.CONDIMENTS),
    ("dressing", FoodCategory.CONDIMENTS),
    ("ketchup", FoodCategory.CONDIMENTS),
    ("mustard", FoodCategory.CONDIMENTS),
    ("mayonnaise", FoodCategory.CONDIMENTS),
    ("cooking oil", FoodCategory.CONDIMENTS),
    ("beverage", FoodCategory.BEVERAGES),
    ("drink", FoodCategory.BEVERAGES),
    ("juice", FoodCategory.BEVERAGES),
    ("soda", FoodCategory.BEVERAGES),
    ("water", FoodCategory.BEVERAGES),
    ("coffee", FoodCategory.BEVERAGES),
    ("tea", FoodCategory.BEVERAGES),
    ("snack", FoodCategory.SNACKS),
    ("chips", FoodCategory.SNACKS),
    ("candy", FoodCategory.SNACKS),
    ("candies", FoodCategory.SNACKS),
    ("chocolate", FoodCategory.SNACKS),
    ("cookie", FoodCategory.SNACKS),
    ("biscuit", FoodCategory.SNACKS),
    ("cereal", FoodCategory.DRY_GOODS),
    ("pasta", FoodCategory.DRY_GOODS),
    ("rice", FoodCategory.DRY_GOODS),
    ("grain", FoodCategory.DRY_GOODS),
    ("flour", FoodCategory.DRY_GOODS),
    ("legume", FoodCategory.DRY_GOODS),
    ("bean", FoodCategory.DRY_GOODS),
    ("fruit", FoodCategory.PRODUCE),
    ("vegetable", FoodCategory.PRODUCE),
    ("produce", FoodCategory.PRODUCE),
]


def _map_off_category(off_category: str | None) -> str:
    """Map an OpenFoodFacts category string onto this app's FoodCategory vocabulary.

    Falls back to ``FoodCategory.OTHER`` when nothing recognized matches or
    no category text was supplied.
    """
    if not off_category:
        return FoodCategory.OTHER.value

    text = off_category.lower()
    for keyword, category in _CATEGORY_KEYWORDS:
        if keyword in text:
            return category.value
    return FoodCategory.OTHER.value


class OpenFoodFactsClient(ProductLookup):
    """
    Real OpenFoodFacts API-backed product lookup.

    Public API, no API key required:
      - barcode lookup: GET {base_url}/api/v2/product/{barcode}.json
      - search:         GET {base_url}/cgi/search.pl?search_terms=...&search_simple=1
                             &action=process&json=1

    Upstream failures (timeout, non-2xx status, malformed JSON, or an
    unexpected response shape) never raise — they degrade to a "not found"
    ``ProductInfo`` and are logged, never a fabricated/guessed product.
    """

    def __init__(
        self,
        base_url: str = OPENFOODFACTS_BASE_URL,
        timeout: float = _REQUEST_TIMEOUT,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url
        self._timeout = timeout
        self._headers = {"User-Agent": _USER_AGENT}
        # Only ever set in tests, via httpx.MockTransport, so the HTTP layer
        # can be mocked without touching the real network.
        self._transport = transport

    async def lookup_barcode(self, barcode: str) -> ProductInfo:
        """
        Look up a product by barcode via OpenFoodFacts.

        Returns ``ProductInfo(found=False)`` for both "no such product" and
        any recoverable upstream failure — never raises.
        """
        url = f"{self._base_url}/api/v2/product/{barcode}.json"

        data = await self._get_json(url, context=f"barcode {barcode}")
        if data is None:
            return ProductInfo(barcode=barcode, found=False)

        try:
            if not isinstance(data, dict):
                return ProductInfo(barcode=barcode, found=False)

            status = data.get("status")
            product = data.get("product")
            if status != 1 or not isinstance(product, dict):
                return ProductInfo(barcode=barcode, found=False)

            return self._to_product_info(barcode, product)
        except (KeyError, TypeError, AttributeError) as e:
            logger.warning(
                f"OpenFoodFacts returned an unexpected shape for barcode {barcode}: {e}"
            )
            return ProductInfo(barcode=barcode, found=False)

    async def search(self, query: str) -> list[ProductInfo]:
        """
        Search for products by name/description via OpenFoodFacts.

        Returns an empty list on any recoverable upstream failure — never
        raises.
        """
        url = f"{self._base_url}/cgi/search.pl"
        params = {
            "search_terms": query,
            "search_simple": "1",
            "action": "process",
            "json": "1",
            "page_size": "10",
        }

        data = await self._get_json(url, context=f"query {query!r}", params=params)
        if data is None or not isinstance(data, dict):
            return []

        products = data.get("products")
        if not isinstance(products, list):
            return []

        results: list[ProductInfo] = []
        for raw_product in products:
            if not isinstance(raw_product, dict):
                continue
            try:
                info = self._to_product_info(raw_product.get("code"), raw_product)
            except (KeyError, TypeError, AttributeError) as e:
                logger.warning(f"Skipping malformed OpenFoodFacts search result: {e}")
                continue
            if info.found:
                results.append(info)
        return results

    async def _get_json(
        self,
        url: str,
        context: str,
        params: dict[str, str] | None = None,
    ) -> Any:  # noqa: ANN401
        """Issue a GET request and return decoded JSON, or None on any failure."""
        try:
            async with httpx.AsyncClient(
                timeout=self._timeout, transport=self._transport
            ) as client:
                response = await client.get(url, headers=self._headers, params=params)
                response.raise_for_status()
                return response.json()
        except httpx.TimeoutException as e:
            logger.warning(f"OpenFoodFacts request timed out for {context}: {e}")
        except httpx.HTTPStatusError as e:
            logger.warning(
                f"OpenFoodFacts returned {e.response.status_code} for {context}"
            )
        except httpx.RequestError as e:
            logger.warning(f"OpenFoodFacts request failed for {context}: {e}")
        except ValueError as e:
            # response.json() raises a ValueError subclass on malformed JSON
            logger.warning(f"OpenFoodFacts returned malformed JSON for {context}: {e}")
        return None

    def _to_product_info(self, barcode: str | None, product: dict[str, Any]) -> ProductInfo:
        """Map a raw OpenFoodFacts ``product`` object onto ``ProductInfo``."""
        name = product.get("product_name") or product.get("generic_name") or None
        if not name:
            return ProductInfo(barcode=barcode, found=False)

        brand_raw = product.get("brands")
        brand = brand_raw.split(",")[0].strip() if isinstance(brand_raw, str) and brand_raw else None

        off_category = product.get("categories")
        if not isinstance(off_category, str) or not off_category:
            tags = product.get("categories_tags")
            if isinstance(tags, list) and tags:
                off_category = ", ".join(str(t) for t in tags)
            else:
                off_category = None
        category = _map_off_category(off_category)

        ingredients_text = product.get("ingredients_text")
        ingredients: list[str] = []
        if isinstance(ingredients_text, str) and ingredients_text.strip():
            ingredients = [i.strip() for i in ingredients_text.split(",") if i.strip()]

        allergens_raw = product.get("allergens")
        allergens: list[str] = []
        if isinstance(allergens_raw, str) and allergens_raw.strip():
            allergens = [a.strip() for a in allergens_raw.split(",") if a.strip()]

        nutrition = product.get("nutriments")
        if not isinstance(nutrition, dict):
            nutrition = {}

        quantity = product.get("quantity")

        return ProductInfo(
            barcode=barcode or product.get("code"),
            name=name,
            brand=brand,
            category=category,
            quantity=quantity if isinstance(quantity, str) else None,
            ingredients=ingredients,
            allergens=allergens,
            nutrition=nutrition,
            image_url=product.get("image_url"),
            found=True,
        )


# Singleton instance
_product_lookup: ProductLookup | None = None


def get_product_lookup() -> ProductLookup:
    """Get the singleton product lookup instance."""
    global _product_lookup
    if _product_lookup is None:
        _product_lookup = OpenFoodFactsClient()
    return _product_lookup
