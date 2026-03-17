"""Tests for receipt, product, and recipe ingest workflow nodes."""

from datetime import date
from unittest.mock import AsyncMock, patch

import pytest

from bubbly_chef.workflows.receipt_ingest import (
    clean_receipt_items,
    create_receipt_actions,
    normalize_receipt_items,
    parse_receipt_llm,
    run_receipt_ingest,
)
from bubbly_chef.workflows.state import LLMParsedItem, LLMParseResult


# ---------------------------------------------------------------------------
# Receipt workflow node tests
# ---------------------------------------------------------------------------

class TestParseReceiptLLM:
    @pytest.mark.asyncio
    async def test_empty_text_returns_zero_confidence(self):
        state = {"input_text": "", "errors": [], "warnings": []}
        result = await parse_receipt_llm(state)
        assert result["parsed_items"] == []
        assert result["confidence"] == 0.0
        assert result["parse_error"] == "Empty receipt text"

    @pytest.mark.asyncio
    async def test_successful_parse(self):
        llm_result = LLMParseResult(
            items=[
                LLMParsedItem(name="milk", quantity=1, unit="gallon", category="dairy", action="add"),
            ],
            confidence=0.8,
        )
        mock_llm = AsyncMock()
        mock_llm.generate_structured.return_value = (llm_result, None)

        with patch("bubbly_chef.workflows.receipt_ingest.get_ollama_client", return_value=mock_llm):
            state = {"input_text": "MILK 1GAL $4.99", "errors": [], "warnings": []}
            result = await parse_receipt_llm(state)

        assert len(result["parsed_items"]) == 1
        assert result["parsed_items"][0]["action"] == "add"
        assert result["confidence"] == pytest.approx(0.72)  # 0.8 * 0.9

    @pytest.mark.asyncio
    async def test_llm_error_returns_empty(self):
        mock_llm = AsyncMock()
        mock_llm.generate_structured.return_value = (None, "Connection failed")

        with patch("bubbly_chef.workflows.receipt_ingest.get_ollama_client", return_value=mock_llm):
            state = {"input_text": "EGGS $3.99", "errors": [], "warnings": []}
            result = await parse_receipt_llm(state)

        assert result["parsed_items"] == []
        assert result["confidence"] == 0.0
        assert "LLM parse failed" in result["errors"][0]

    @pytest.mark.asyncio
    async def test_llm_none_result(self):
        mock_llm = AsyncMock()
        mock_llm.generate_structured.return_value = (None, None)

        with patch("bubbly_chef.workflows.receipt_ingest.get_ollama_client", return_value=mock_llm):
            state = {"input_text": "EGGS $3.99", "errors": [], "warnings": []}
            result = await parse_receipt_llm(state)

        assert result["parsed_items"] == []
        assert "No result from LLM" in result["errors"][0]

    @pytest.mark.asyncio
    async def test_llm_exception(self):
        from bubbly_chef.tools.llm_client import LLMError

        mock_llm = AsyncMock()
        mock_llm.generate_structured.side_effect = LLMError("timeout")

        with patch("bubbly_chef.workflows.receipt_ingest.get_ollama_client", return_value=mock_llm):
            state = {"input_text": "stuff", "errors": [], "warnings": []}
            result = await parse_receipt_llm(state)

        assert result["confidence"] == 0.0
        assert result["requires_review"] is True


class TestCleanReceiptItems:
    def test_filters_tax_lines(self):
        state = {
            "parsed_items": [
                {"name": "milk", "quantity": 1},
                {"name": "TAX", "quantity": 0},
                {"name": "TOTAL", "quantity": 0},
            ],
            "warnings": [],
        }
        result = clean_receipt_items(state)
        assert len(result["parsed_items"]) == 1
        assert result["parsed_items"][0]["name"] == "milk"
        assert len(result["warnings"]) == 2

    def test_filters_short_names(self):
        state = {
            "parsed_items": [{"name": "x"}],
            "warnings": [],
        }
        result = clean_receipt_items(state)
        assert len(result["parsed_items"]) == 0

    def test_filters_long_names(self):
        state = {
            "parsed_items": [{"name": "a" * 150}],
            "warnings": [],
        }
        result = clean_receipt_items(state)
        assert len(result["parsed_items"]) == 0

    def test_keeps_valid_items(self):
        state = {
            "parsed_items": [
                {"name": "organic milk"},
                {"name": "eggs"},
                {"name": "bread"},
            ],
            "warnings": [],
        }
        result = clean_receipt_items(state)
        assert len(result["parsed_items"]) == 3


class TestNormalizeReceiptItems:
    def test_normalizes_names_and_adds_metadata(self):
        state = {
            "parsed_items": [
                {"name": "WHOLE MILK", "quantity": 1, "unit": "gal", "category": "dairy", "action": "add"},
            ],
        }
        result = normalize_receipt_items(state)
        items = result["normalized_items"]
        assert len(items) == 1
        item = items[0]
        assert item["original_name"] == "WHOLE MILK"
        assert "storage_location" in item
        assert "expiry_date" in item
        assert "purchase_date" in item
        assert item["estimated_expiry"] is True


class TestCreateReceiptActions:
    def test_creates_add_actions(self):
        state = {
            "normalized_items": [
                {
                    "name": "milk",
                    "original_name": "WHOLE MILK",
                    "quantity": 1,
                    "unit": "gallon",
                    "category": "dairy",
                    "storage_location": "fridge",
                    "expiry_date": date.today().isoformat(),
                    "estimated_expiry": True,
                    "purchase_date": date.today().isoformat(),
                },
            ],
            "confidence": 0.72,
            "errors": [],
        }
        result = create_receipt_actions(state)
        assert len(result["actions"]) == 1
        assert result["actions"][0].action_type.value == "add"
        assert result["actions"][0].confidence == 0.72

    def test_empty_items_requires_review(self):
        state = {
            "normalized_items": [],
            "confidence": 0.0,
            "errors": [],
        }
        result = create_receipt_actions(state)
        assert result["requires_review"] is True


class TestRunReceiptIngest:
    @pytest.mark.asyncio
    async def test_full_receipt_workflow(self):
        llm_result = LLMParseResult(
            items=[
                LLMParsedItem(name="bananas", quantity=1, unit="bunch", category="produce", action="add"),
                LLMParsedItem(name="eggs", quantity=1, unit="dozen", category="dairy", action="add"),
            ],
            confidence=0.85,
        )
        mock_llm = AsyncMock()
        mock_llm.generate_structured.return_value = (llm_result, None)

        with patch("bubbly_chef.workflows.receipt_ingest.get_ollama_client", return_value=mock_llm):
            envelope = await run_receipt_ingest("BANANAS $1.29\nEGGS DZ $6.49")

        assert len(envelope.proposal.actions) == 2
        assert envelope.proposal.normalization_applied is True
        assert envelope.confidence.overall > 0

    @pytest.mark.asyncio
    async def test_receipt_with_store_name(self):
        mock_llm = AsyncMock()
        mock_llm.generate_structured.return_value = (
            LLMParseResult(items=[], confidence=0.5),
            None,
        )

        with patch("bubbly_chef.workflows.receipt_ingest.get_ollama_client", return_value=mock_llm):
            envelope = await run_receipt_ingest("MILK $3.99", store_name="Whole Foods")

        # Verify store name was passed via prompt (check the call args)
        call_args = mock_llm.generate_structured.call_args
        assert "Whole Foods" in call_args.kwargs.get("prompt", call_args[1].get("prompt", ""))
