"""Tests for product ingest workflow nodes."""

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.workflows.product_ingest import (
    create_product_action,
    lookup_barcode,
    normalize_product,
    parse_description_llm,
    run_product_ingest,
)
from bubbly_chef.workflows.state import LLMParsedItem


# ---------------------------------------------------------------------------
# lookup_barcode node
# ---------------------------------------------------------------------------

class TestLookupBarcode:
    @pytest.mark.asyncio
    async def test_no_barcode(self):
        state = {"barcode": None, "warnings": []}
        result = await lookup_barcode(state)
        assert result["product_found"] is False

    @pytest.mark.asyncio
    async def test_barcode_found(self):
        mock_lookup = AsyncMock()
        mock_product = MagicMock()
        mock_product.found = True
        mock_product.name = "Coca-Cola Classic"
        mock_product.category = "beverages"
        mock_product.brand = "Coca-Cola"
        mock_lookup.lookup_barcode.return_value = mock_product

        with patch("bubbly_chef.workflows.product_ingest.get_product_lookup", return_value=mock_lookup):
            state = {"barcode": "0012000001086", "quantity_override": 6, "unit_override": "can", "warnings": []}
            result = await lookup_barcode(state)

        assert result["product_found"] is True
        assert len(result["parsed_items"]) == 1
        assert result["parsed_items"][0]["name"] == "Coca-Cola Classic"
        assert result["confidence"] == 0.95

    @pytest.mark.asyncio
    async def test_barcode_not_found(self):
        mock_lookup = AsyncMock()
        mock_product = MagicMock()
        mock_product.found = False
        mock_lookup.lookup_barcode.return_value = mock_product

        with patch("bubbly_chef.workflows.product_ingest.get_product_lookup", return_value=mock_lookup):
            state = {"barcode": "9999999999999", "warnings": []}
            result = await lookup_barcode(state)

        assert result["product_found"] is False
        assert "not found" in result["warnings"][0]


# ---------------------------------------------------------------------------
# parse_description_llm node
# ---------------------------------------------------------------------------

class TestParseDescriptionLLM:
    @pytest.mark.asyncio
    async def test_skip_if_product_found(self):
        state = {"product_found": True, "parsed_items": [{"name": "cola"}]}
        result = await parse_description_llm(state)
        assert result is state  # no changes

    @pytest.mark.asyncio
    async def test_empty_description(self):
        state = {"product_found": False, "description": "", "input_text": "", "errors": []}
        result = await parse_description_llm(state)
        assert result["confidence"] == 0.0
        assert "No product description" in result["errors"][0]

    @pytest.mark.asyncio
    async def test_successful_parse(self):
        llm_item = LLMParsedItem(name="Greek Yogurt", quantity=1, unit="container", category="dairy")
        mock_llm = AsyncMock()
        mock_llm.generate_structured.return_value = (llm_item, None)

        with patch("bubbly_chef.workflows.product_ingest.get_ollama_client", return_value=mock_llm):
            state = {
                "product_found": False,
                "description": "Chobani Greek Yogurt",
                "input_text": "Chobani Greek Yogurt",
                "quantity_override": 2,
                "unit_override": "container",
                "errors": [],
                "barcode": None,
            }
            result = await parse_description_llm(state)

        assert len(result["parsed_items"]) == 1
        assert result["parsed_items"][0]["name"] == "Greek Yogurt"
        assert result["parsed_items"][0]["quantity"] == 2  # override applied
        assert result["confidence"] == 0.7

    @pytest.mark.asyncio
    async def test_llm_error(self):
        mock_llm = AsyncMock()
        mock_llm.generate_structured.return_value = (None, "Connection failed")

        with patch("bubbly_chef.workflows.product_ingest.get_ollama_client", return_value=mock_llm):
            state = {
                "product_found": False,
                "description": "something",
                "input_text": "something",
                "errors": [],
            }
            result = await parse_description_llm(state)

        assert result["confidence"] == 0.3
        assert "Could not parse" in result["errors"][0]

    @pytest.mark.asyncio
    async def test_llm_exception(self):
        from bubbly_chef.tools.llm_client import LLMError

        mock_llm = AsyncMock()
        mock_llm.generate_structured.side_effect = LLMError("timeout")

        with patch("bubbly_chef.workflows.product_ingest.get_ollama_client", return_value=mock_llm):
            state = {
                "product_found": False,
                "description": "stuff",
                "input_text": "stuff",
                "errors": [],
            }
            result = await parse_description_llm(state)

        assert result["confidence"] == 0.0


# ---------------------------------------------------------------------------
# normalize_product node
# ---------------------------------------------------------------------------

class TestNormalizeProduct:
    def test_empty_items(self):
        state = {"parsed_items": []}
        result = normalize_product(state)
        assert result["normalized_items"] == []

    def test_normalizes_item(self):
        state = {
            "parsed_items": [{
                "name": "Greek Yogurt",
                "quantity": 1,
                "unit": "container",
                "category": "dairy",
                "action": "add",
            }]
        }
        result = normalize_product(state)
        items = result["normalized_items"]
        assert len(items) == 1
        assert "storage_location" in items[0]
        assert "expiry_date" in items[0]
        assert items[0]["original_name"] == "Greek Yogurt"


# ---------------------------------------------------------------------------
# create_product_action node
# ---------------------------------------------------------------------------

class TestCreateProductAction:
    def test_empty_items(self):
        state = {"normalized_items": [], "errors": []}
        result = create_product_action(state)
        assert result["actions"] == []
        assert result["requires_review"] is True

    def test_creates_action(self):
        state = {
            "normalized_items": [{
                "name": "yogurt",
                "original_name": "Greek Yogurt",
                "quantity": 1,
                "unit": "container",
                "category": "dairy",
                "storage_location": "fridge",
                "expiry_date": date.today().isoformat(),
                "estimated_expiry": True,
                "purchase_date": date.today().isoformat(),
                "barcode": "123",
            }],
            "confidence": 0.95,
            "errors": [],
        }
        result = create_product_action(state)
        assert len(result["actions"]) == 1
        assert result["actions"][0].action_type.value == "add"


# ---------------------------------------------------------------------------
# Full workflow
# ---------------------------------------------------------------------------

class TestRunProductIngest:
    @pytest.mark.asyncio
    async def test_with_description(self):
        llm_item = LLMParsedItem(name="almond milk", quantity=1, unit="carton", category="dairy")
        mock_llm = AsyncMock()
        mock_llm.generate_structured.return_value = (llm_item, None)

        mock_lookup = AsyncMock()
        mock_product = MagicMock()
        mock_product.found = False
        mock_lookup.lookup_barcode.return_value = mock_product

        with (
            patch("bubbly_chef.workflows.product_ingest.get_ollama_client", return_value=mock_llm),
            patch("bubbly_chef.workflows.product_ingest.get_product_lookup", return_value=mock_lookup),
        ):
            envelope = await run_product_ingest(description="Almond Breeze almond milk")

        assert len(envelope.proposal.actions) == 1
        assert envelope.proposal.normalization_applied is True
