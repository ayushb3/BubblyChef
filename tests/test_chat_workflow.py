"""Tests for chat ingest workflow with mocked LLM."""

from unittest.mock import AsyncMock, patch
import pytest

from bubbly_chef.workflows.chat_ingest import (
    run_chat_ingest,
    normalize_items,
    apply_expiry_heuristics,
    create_actions,
)
from bubbly_chef.workflows.state import LLMParseResult, LLMParsedItem


@pytest.fixture(autouse=True)
def mock_repository():
    """Prevent workflow nodes from hitting the real DB."""
    repo_mock = AsyncMock()
    repo_mock.get_all_pantry_items.return_value = []
    with patch("bubbly_chef.workflows.chat_ingest.get_repository", return_value=repo_mock):
        yield repo_mock


class TestChatIngestWorkflow:
    """Test suite for chat ingest workflow."""
    
    @pytest.fixture
    def mock_llm_result(self):
        """Create a mock LLM parse result."""
        return LLMParseResult(
            items=[
                LLMParsedItem(
                    name="milk",
                    quantity=2,
                    unit="gallon",
                    category="dairy",
                    action="add",
                ),
                LLMParsedItem(
                    name="eggs",
                    quantity=12,
                    unit="item",
                    category="dairy",
                    action="add",
                ),
                LLMParsedItem(
                    name="apples",
                    quantity=6,
                    unit="item",
                    category="produce",
                    action="add",
                ),
            ],
            confidence=0.85,
        )
    
    @pytest.mark.asyncio
    async def test_chat_ingest_full_workflow(self, mock_llm_result):
        """Test the complete chat ingest workflow with mocked LLM."""
        
        with patch("bubbly_chef.workflows.chat_ingest.get_ai_manager") as mock_get_mgr:
            # Setup mock
            mock_manager = AsyncMock()
            mock_manager.complete.return_value = mock_llm_result
            mock_get_mgr.return_value = mock_manager
            
            # Run workflow
            envelope = await run_chat_ingest(
                "I bought 2 gallons of milk, a dozen eggs, and some apples"
            )
            
            # Verify envelope structure
            assert envelope.schema_version == "1.0.0"
            assert envelope.intent.value == "pantry_update"
            assert envelope.requires_review is True  # 0.85 < 0.95
            
            # Verify proposal
            assert len(envelope.proposal.actions) == 3
            assert envelope.proposal.normalization_applied is True
            
            # Verify items
            action_names = [a.item.name for a in envelope.proposal.actions]
            assert "milk" in action_names
            assert "eggs" in action_names
            assert "apple" in action_names or "apples" in action_names
            
            # Verify confidence
            assert 0.0 <= envelope.confidence.overall <= 1.0
    
    @pytest.mark.asyncio
    async def test_chat_ingest_llm_error(self):
        """Test workflow handles LLM errors gracefully."""
        
        with patch("bubbly_chef.workflows.chat_ingest.get_ai_manager") as mock_get_mgr:
            # Setup mock to raise error
            mock_manager = AsyncMock()
            mock_manager.complete.side_effect = Exception("Connection failed")
            mock_get_mgr.return_value = mock_manager
            
            # Run workflow
            envelope = await run_chat_ingest("I bought some groceries")
            
            # Should return envelope with errors
            assert envelope.requires_review is True
            assert len(envelope.errors) > 0
            assert envelope.confidence.overall == 0.0
            assert len(envelope.proposal.actions) == 0
    
    @pytest.mark.asyncio
    async def test_chat_ingest_empty_input(self):
        """Test workflow handles empty input."""
        
        with patch("bubbly_chef.workflows.chat_ingest.get_ai_manager") as mock_get_mgr:
            mock_manager = AsyncMock()
            # general_chat_response node will call complete() with no schema → returns str
            mock_manager.complete.return_value = "I can help with your pantry!"
            mock_get_mgr.return_value = mock_manager

            envelope = await run_chat_ingest("")

            # Empty input goes to general_chat, then legacy wrapper returns empty pantry proposal
            assert len(envelope.proposal.actions) == 0
    
    # ==========================================================================
    # Node Unit Tests
    # ==========================================================================
    
    def test_normalize_items_node(self):
        """Test normalize_items node transforms data correctly."""
        state = {
            "parsed_items": [
                {"name": "WHOLE MILK", "quantity": 1, "unit": "gallon", "category": "dairy", "action": "add"},
                {"name": "organic bananas", "quantity": 6, "unit": "item", "category": "produce", "action": "add"},
            ],
            "warnings": [],
        }
        
        result = normalize_items(state)
        
        assert len(result["normalized_items"]) == 2
        
        # Check normalization happened
        names = [item["name"] for item in result["normalized_items"]]
        # Should normalize "WHOLE MILK" to "milk" and "organic bananas" to "banana"
        assert "milk" in names or "whole milk" in names
    
    def test_apply_expiry_heuristics_node(self):
        """Test expiry heuristics node adds expiry dates."""
        state = {
            "normalized_items": [
                {"name": "milk", "quantity": 1, "unit": "gallon", "category": "dairy", "action": "add"},
            ],
        }
        
        result = apply_expiry_heuristics(state)
        
        assert len(result["normalized_items"]) == 1
        item = result["normalized_items"][0]
        
        assert "expiry_date" in item
        assert "storage_location" in item
        assert "purchase_date" in item
        assert item["estimated_expiry"] is True
    
    def test_create_actions_node(self):
        """Test create_actions node produces PantryUpsertAction objects."""
        from datetime import date
        
        state = {
            "normalized_items": [
                {
                    "name": "milk",
                    "original_name": "whole milk",
                    "quantity": 1,
                    "unit": "gallon",
                    "category": "dairy",
                    "action": "add",
                    "storage_location": "fridge",
                    "expiry_date": date.today().isoformat(),
                    "estimated_expiry": True,
                    "purchase_date": date.today().isoformat(),
                },
            ],
            "confidence": 0.85,
        }
        
        result = create_actions(state)
        
        assert len(result["actions"]) == 1
        action = result["actions"][0]
        
        assert action.action_type.value == "add"
        assert action.item.name == "milk"
        assert action.item.quantity == 1
        assert action.item.unit == "gallon"
        assert 0.0 <= action.confidence <= 1.0


class TestChatIngestDedup:
    """Test deduplication logic."""
    
    @pytest.mark.asyncio
    async def test_similar_items_detected(self):
        """Test that similar items can be detected for dedup."""
        # This would test repository-level dedup when applying
        # For now, just verify normalization helps with dedup
        from bubbly_chef.tools.normalizer import get_normalizer
        
        normalizer = get_normalizer()
        
        # These should normalize to the same thing
        assert normalizer.are_similar("2% milk", "whole milk")
        assert normalizer.are_similar("eggs", "dozen eggs")
        assert normalizer.are_similar("chicken breast", "boneless chicken")
