"""Tests for receipt scanning."""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient

from bubbly_chef.services.ocr import MockOCR, set_ocr_service
from bubbly_chef.services.receipt_parser import (
    parse_receipt,
    ParsedReceiptItem,
    is_likely_food,
)


class TestIsLikelyFood:
    """Tests for food detection."""

    def test_detects_food_items(self):
        assert is_likely_food("Milk") is True
        assert is_likely_food("Chicken Breast") is True
        assert is_likely_food("Organic Eggs") is True

    def test_rejects_non_food(self):
        assert is_likely_food("TAX") is False
        assert is_likely_food("TOTAL") is False
        assert is_likely_food("SUBTOTAL") is False
        assert is_likely_food("PLASTIC BAG") is False
        assert is_likely_food("COUPON SAVINGS") is False

    def test_rejects_short_strings(self):
        assert is_likely_food("A") is False
        assert is_likely_food("") is False


class TestReceiptParser:
    """Tests for receipt parsing with AI."""

    @pytest.mark.asyncio
    async def test_empty_text_returns_warning(self):
        """Test that empty receipt text returns appropriate warning."""
        mock_ai = MagicMock()

        result = await parse_receipt("", mock_ai)

        assert len(result.items) == 0
        assert any("empty" in w.lower() for w in result.warnings)

    @pytest.mark.asyncio
    async def test_ai_failure_returns_warning(self):
        """Test that AI failure is handled gracefully."""
        mock_ai = MagicMock()
        mock_ai.complete = AsyncMock(side_effect=Exception("AI failed"))

        result = await parse_receipt("Some receipt text", mock_ai)

        assert len(result.items) == 0
        assert any("failed" in w.lower() for w in result.warnings)

    @pytest.mark.asyncio
    async def test_parses_items_from_ai_response(self):
        """Test successful parsing of AI response."""
        mock_ai = MagicMock()

        # Mock LLM response
        class MockResponse:
            items = [
                {"name": "Milk", "quantity": 1, "unit": "gallon", "confidence": 0.95},
                {"name": "Eggs", "quantity": 12, "unit": "count", "confidence": 0.90},
            ]

        mock_ai.complete = AsyncMock(return_value=MockResponse())

        result = await parse_receipt("MILK 1 GAL\nEGGS DZ", mock_ai)

        assert len(result.items) == 2
        assert result.items[0].name == "Milk"
        assert result.items[0].category.value == "dairy"
        assert result.items[1].name == "Eggs"

    @pytest.mark.asyncio
    async def test_filters_non_food_items(self):
        """Test that non-food items are filtered out."""
        mock_ai = MagicMock()

        class MockResponse:
            items = [
                {"name": "Milk", "quantity": 1, "unit": "gallon", "confidence": 0.95},
                {"name": "TAX", "quantity": None, "unit": None, "confidence": 0.5},
                {"name": "TOTAL", "quantity": None, "unit": None, "confidence": 0.5},
            ]

        mock_ai.complete = AsyncMock(return_value=MockResponse())

        result = await parse_receipt("Receipt text", mock_ai)

        assert len(result.items) == 1
        assert result.items[0].name == "Milk"
        assert any("Filtered" in w for w in result.warnings)


class TestScanEndpoints:
    """Tests for scan API endpoints."""

    @pytest.mark.asyncio
    async def test_ocr_status_endpoint(self, client: AsyncClient):
        """Test OCR status endpoint."""
        response = await client.get("/scan/ocr-status")
        assert response.status_code == 200
        data = response.json()
        assert "available" in data

    @pytest.mark.asyncio
    async def test_scan_receipt_invalid_content_type(self, client: AsyncClient):
        """Test that non-image files are rejected."""
        response = await client.post(
            "/scan/receipt",
            files={"image": ("test.txt", b"not an image", "text/plain")},
        )
        assert response.status_code == 400
        assert "Invalid image type" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_scan_receipt_empty_file(self, client: AsyncClient):
        """Test that empty files are rejected."""
        response = await client.post(
            "/scan/receipt",
            files={"image": ("test.png", b"", "image/png")},
        )
        assert response.status_code == 400
        assert "Empty" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_confirm_items(self, client: AsyncClient):
        """Test confirming reviewed items."""
        response = await client.post(
            "/scan/confirm",
            json={
                "request_id": "test-123",
                "items": [
                    {
                        "temp_id": "item-1",
                        "name": "Apples",
                        "quantity": 6,
                        "unit": "count",
                        "category": "produce",
                        "location": "counter",
                    }
                ],
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["added"]) == 1
        assert data["added"][0]["name"] == "Apples"

    @pytest.mark.asyncio
    async def test_undo_nonexistent_session(self, client: AsyncClient):
        """Test undoing a non-existent scan session."""
        response = await client.post("/scan/undo/nonexistent-id")
        assert response.status_code == 404
