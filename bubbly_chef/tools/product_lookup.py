"""Product lookup abstraction with OpenFoodFacts stub."""

from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel, Field


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


class OpenFoodFactsStub(ProductLookup):
    """
    Stub implementation for OpenFoodFacts API.

    TODO: Replace with real OpenFoodFacts API integration.
    For now, returns mock data for testing.
    """

    # Mock database of products for testing
    MOCK_PRODUCTS: dict[str, ProductInfo] = {
        "0012000001086": ProductInfo(
            barcode="0012000001086",
            name="Coca-Cola Classic",
            brand="Coca-Cola",
            category="beverages",
            quantity="12 fl oz",
            ingredients=[
                "carbonated water",
                "high fructose corn syrup",
                "caramel color",
            ],
            found=True,
        ),
        "0041130006006": ProductInfo(
            barcode="0041130006006",
            name="Whole Milk",
            brand="Organic Valley",
            category="dairy",
            quantity="1 gallon",
            found=True,
        ),
        "0038000138416": ProductInfo(
            barcode="0038000138416",
            name="Frosted Flakes",
            brand="Kellogg's",
            category="cereal",
            quantity="13.5 oz",
            found=True,
        ),
        "0021130043064": ProductInfo(
            barcode="0021130043064",
            name="Large Eggs",
            brand="Organic Valley",
            category="dairy",
            quantity="1 dozen",
            found=True,
        ),
    }

    async def lookup_barcode(self, barcode: str) -> ProductInfo:
        """
        Look up a product by barcode.

        Currently returns mock data; will integrate with OpenFoodFacts API.
        """
        # Check mock database
        if barcode in self.MOCK_PRODUCTS:
            return self.MOCK_PRODUCTS[barcode]

        # Return not found
        return ProductInfo(barcode=barcode, found=False)

    async def search(self, query: str) -> list[ProductInfo]:
        """
        Search for products by name/description.

        Currently returns mock results; will integrate with OpenFoodFacts API.
        """
        results = []
        query_lower = query.lower()

        for product in self.MOCK_PRODUCTS.values():
            if product.name and query_lower in product.name.lower():
                results.append(product)
            elif product.brand and query_lower in product.brand.lower():
                results.append(product)

        return results


# Singleton instance
_product_lookup: OpenFoodFactsStub | None = None


def get_product_lookup() -> ProductLookup:
    """Get the singleton product lookup instance."""
    global _product_lookup
    if _product_lookup is None:
        _product_lookup = OpenFoodFactsStub()
    return _product_lookup
