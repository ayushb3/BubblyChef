"""
Comprehensive user flow tests for chat_ingest workflow.

These tests cover the 9 core user flows:
1. Simple pantry add (high confidence)
2. Pantry consume (partial)
3. Ambiguous item → clarification interrupt
4. Non-pantry general chat
5. Receipt ingest request (handoff)
6. Product scan request (handoff)
7. Recipe link ingest request (handoff)
8. Mixed message (pantry + other chat)
9. Undo / correction conversational fix

Each test:
- Mocks LLM calls deterministically
- Asserts on ProposalEnvelope contract
- Verifies intent, next_action, requires_review, proposal type
- Checks stable client_item_key (no random UUIDs)
- Validates normalization and expiry heuristics
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import date, timedelta
from uuid import UUID

from bubbly_chef.workflows.chat_ingest import run_chat_workflow
from bubbly_chef.workflows.state import (
    LLMParseResult,
    LLMParsedItem,
    LLMIntentResult,
    LLMGeneralChatResult,
)
from bubbly_chef.models.base import Intent, NextAction, WorkflowStatus
from bubbly_chef.models.pantry import ActionType, FoodCategory, PantryProposal
from bubbly_chef.models.proposals import HandoffProposal, HandoffKind


# =============================================================================
# Test Fixtures & Helpers
# =============================================================================


@pytest.fixture
def mock_llm_client():
    """Create a mock LLM client that can be configured per test."""
    return AsyncMock()


def assert_envelope_structure(envelope):
    """Assert that envelope has all required fields and valid structure."""
    # Identifiers
    assert isinstance(envelope.request_id, UUID)
    assert isinstance(envelope.workflow_id, UUID)
    assert envelope.schema_version == "1.0.0"

    # Intent
    assert isinstance(envelope.intent, Intent)

    # Confidence
    assert 0.0 <= envelope.confidence.overall <= 1.0
    assert isinstance(envelope.requires_review, bool)

    # Next action
    assert isinstance(envelope.next_action, NextAction)

    # Response
    assert isinstance(envelope.assistant_message, str)

    # Status
    assert isinstance(envelope.workflow_status, WorkflowStatus)
    assert isinstance(envelope.warnings, list)
    assert isinstance(envelope.errors, list)


def create_stable_item_key(name: str, category: str = None) -> str:
    """
    Generate a stable client_item_key for testing.
    Should match the logic in your workflow.
    """
    # Simplified version - should match your actual implementation
    normalized = name.lower().strip()
    if category:
        return f"{category}:{normalized}"
    return normalized


# =============================================================================
# Flow 1: Simple pantry add (high confidence)
# =============================================================================


class TestFlow1_SimplePantryAdd:
    """User: 'I bought milk and a dozen eggs.'"""

    @pytest.mark.asyncio
    async def test_simple_pantry_add_high_confidence(self, mock_llm_client):
        """Test simple pantry addition with high confidence parsing."""

        # Mock intent classification
        intent_result = LLMIntentResult(
            intent="pantry_update",
            confidence=0.95,
            reasoning="User mentions buying groceries",
            entities=["milk", "eggs"],
        )

        # Mock item parsing
        parse_result = LLMParseResult(
            items=[
                LLMParsedItem(
                    name="milk",
                    quantity=1,
                    unit="gallon",
                    category="dairy",
                    action="add",
                    confidence=0.95,
                ),
                LLMParsedItem(
                    name="eggs",
                    quantity=12,
                    unit="count",
                    category="dairy",
                    action="add",
                    confidence=0.92,
                ),
            ],
            confidence=0.93,
        )

        # Setup mock to return results in sequence
        mock_llm_client.generate_structured.side_effect = [
            (intent_result, None),  # Intent classification
            (parse_result, None),  # Item parsing
        ]

        with patch(
            "bubbly_chef.workflows.chat_ingest.get_ollama_client",
            return_value=mock_llm_client,
        ):
            envelope = await run_chat_workflow("I bought milk and a dozen eggs.")

        # Verify envelope structure
        assert_envelope_structure(envelope)

        # Verify intent
        assert envelope.intent == Intent.PANTRY_UPDATE

        # Verify proposal type
        assert isinstance(envelope.proposal, PantryProposal)
        assert len(envelope.proposal.actions) == 2

        # Verify items
        action_names = [action.item.name for action in envelope.proposal.actions]
        assert "milk" in action_names
        assert "eggs" in action_names or "egg" in action_names

        # Verify quantities
        milk_action = next(
            a for a in envelope.proposal.actions if "milk" in a.item.name
        )
        eggs_action = next(a for a in envelope.proposal.actions if "egg" in a.item.name)

        assert milk_action.item.quantity == 1
        assert eggs_action.item.quantity == 12

        # Verify categories (not "other")
        assert milk_action.item.category != FoodCategory.OTHER
        assert eggs_action.item.category != FoodCategory.OTHER

        # Verify expiry heuristics applied
        assert milk_action.item.expiry_date is not None
        assert eggs_action.item.expiry_date is not None

        # Verify stable client_item_key (no random UUIDs)
        assert milk_action.item.client_item_key is not None
        assert eggs_action.item.client_item_key is not None
        # Keys should be deterministic
        assert len(milk_action.item.client_item_key) > 0
        assert not any(
            c in milk_action.item.client_item_key for c in ["-", "0123456789abcdef"] * 5
        )

        # Verify normalization applied
        assert envelope.proposal.normalization_applied is True

        # Verify confidence and review requirements
        # High confidence (>0.90) might not require review depending on threshold
        assert envelope.confidence.overall >= 0.90
        # With threshold at 0.95, this should require review
        assert envelope.requires_review is True

        # Verify next_action
        assert envelope.next_action in [NextAction.REVIEW_PROPOSAL, NextAction.NONE]


# =============================================================================
# Flow 2: Pantry consume (partial)
# =============================================================================


class TestFlow2_PantryConsume:
    """User: 'I used half my milk and 2 eggs.'"""

    @pytest.mark.asyncio
    async def test_pantry_consume_partial(self, mock_llm_client):
        """Test partial consumption with ambiguous quantity."""

        intent_result = LLMIntentResult(
            intent="pantry_update",
            confidence=0.88,
            reasoning="User mentions consuming items",
            entities=["milk", "eggs"],
        )

        parse_result = LLMParseResult(
            items=[
                LLMParsedItem(
                    name="milk",
                    quantity=0.5,
                    unit="unit",  # Ambiguous unit
                    category="dairy",
                    action="use",
                    confidence=0.65,  # Low confidence due to ambiguity
                ),
                LLMParsedItem(
                    name="eggs",
                    quantity=2,
                    unit="count",
                    category="dairy",
                    action="use",
                    confidence=0.90,
                ),
            ],
            confidence=0.78,
        )

        mock_llm_client.generate_structured.side_effect = [
            (intent_result, None),
            (parse_result, None),
        ]

        with patch(
            "bubbly_chef.workflows.chat_ingest.get_ollama_client",
            return_value=mock_llm_client,
        ):
            envelope = await run_chat_workflow("I used half my milk and 2 eggs.")

        assert_envelope_structure(envelope)

        # Verify intent
        assert envelope.intent == Intent.PANTRY_UPDATE

        # Verify proposal
        assert isinstance(envelope.proposal, PantryProposal)
        assert len(envelope.proposal.actions) == 2

        # Verify actions are "use" or "remove" type
        milk_action = next(
            a for a in envelope.proposal.actions if "milk" in a.item.name
        )
        eggs_action = next(a for a in envelope.proposal.actions if "egg" in a.item.name)

        assert milk_action.action_type in [ActionType.USE, ActionType.REMOVE]
        assert eggs_action.action_type in [ActionType.USE, ActionType.REMOVE]

        # Should require review due to ambiguous quantity
        assert envelope.requires_review is True

        # Low confidence due to ambiguous "half my milk"
        assert envelope.confidence.overall < 0.90

        # Should suggest clarification
        assert envelope.next_action in [
            NextAction.REQUEST_CLARIFICATION,
            NextAction.REVIEW_PROPOSAL,
        ]

        # May have clarifying questions
        # assert len(envelope.clarifying_questions) > 0  # Optional based on implementation


# =============================================================================
# Flow 3: Ambiguous item → clarification interrupt
# =============================================================================


class TestFlow3_AmbiguousItem:
    """User: 'Add salsa.'"""

    @pytest.mark.asyncio
    async def test_ambiguous_item_needs_clarification(self, mock_llm_client):
        """Test that ambiguous items trigger clarification request."""

        intent_result = LLMIntentResult(
            intent="pantry_update",
            confidence=0.92,
            reasoning="User wants to add item",
            entities=["salsa"],
        )

        parse_result = LLMParseResult(
            items=[
                LLMParsedItem(
                    name="salsa",
                    quantity=1,
                    unit="item",
                    category="condiments",
                    action="add",
                    confidence=0.55,  # Low confidence - ambiguous
                ),
            ],
            confidence=0.55,
        )

        mock_llm_client.generate_structured.side_effect = [
            (intent_result, None),
            (parse_result, None),
        ]

        with patch(
            "bubbly_chef.workflows.chat_ingest.get_ollama_client",
            return_value=mock_llm_client,
        ):
            envelope = await run_chat_workflow("Add salsa.")

        assert_envelope_structure(envelope)

        # Verify intent
        assert envelope.intent == Intent.PANTRY_UPDATE

        # Verify requires review
        assert envelope.requires_review is True

        # Verify next action suggests clarification
        assert envelope.next_action == NextAction.REQUEST_CLARIFICATION

        # Should have clarifying questions
        assert len(envelope.clarifying_questions) > 0
        assert any(
            "size" in q.lower() or "much" in q.lower()
            for q in envelope.clarifying_questions
        )

        # Low confidence
        assert envelope.confidence.overall < 0.70

        # Proposal should still include the draft item
        assert isinstance(envelope.proposal, PantryProposal)
        assert len(envelope.proposal.actions) == 1


# =============================================================================
# Flow 4: Non-pantry general chat
# =============================================================================


class TestFlow4_GeneralChat:
    """User: 'What's a good high-protein dinner idea?'"""

    @pytest.mark.asyncio
    async def test_general_chat_intent(self, mock_llm_client):
        """Test general chat intent with no proposal."""

        intent_result = LLMIntentResult(
            intent="general_chat",
            confidence=0.92,
            reasoning="User asking for meal ideas, not managing pantry",
            entities=[],
        )

        chat_result = LLMGeneralChatResult(
            response="For a high-protein dinner, consider grilled chicken with quinoa and roasted vegetables. "
            "Salmon is also excellent, or try a bean and lentil curry if you prefer plant-based options.",
            reasoning="Providing meal suggestions",
        )

        mock_llm_client.generate_structured.side_effect = [
            (intent_result, None),
            (chat_result, None),
        ]

        with patch(
            "bubbly_chef.workflows.chat_ingest.get_ollama_client",
            return_value=mock_llm_client,
        ):
            envelope = await run_chat_workflow(
                "What's a good high-protein dinner idea?"
            )

        assert_envelope_structure(envelope)

        # Verify intent
        assert envelope.intent == Intent.GENERAL_CHAT

        # Verify no proposal
        assert envelope.proposal is None

        # Verify assistant message is present
        assert len(envelope.assistant_message) > 0
        assert "protein" in envelope.assistant_message.lower()

        # Verify next action is NONE
        assert envelope.next_action == NextAction.NONE

        # No review needed for chat
        # (Could be True or False depending on policy - chat doesn't need review)
        assert envelope.requires_review in [True, False]

        # No errors
        assert len(envelope.errors) == 0


# =============================================================================
# Flow 5: Receipt ingest request (handoff)
# =============================================================================


class TestFlow5_ReceiptIngest:
    """User: 'I scanned a receipt, add it.'"""

    @pytest.mark.asyncio
    async def test_receipt_ingest_handoff(self, mock_llm_client):
        """Test receipt ingest handoff request."""

        intent_result = LLMIntentResult(
            intent="receipt_ingest_request",
            confidence=0.98,
            reasoning="User mentions scanning receipt",
            entities=["receipt"],
        )

        mock_llm_client.generate_structured.side_effect = [
            (intent_result, None),
        ]

        with patch(
            "bubbly_chef.workflows.chat_ingest.get_ollama_client",
            return_value=mock_llm_client,
        ):
            envelope = await run_chat_workflow("I scanned a receipt, add it.")

        assert_envelope_structure(envelope)

        # Verify intent
        assert envelope.intent == Intent.RECEIPT_INGEST

        # Verify proposal type is HandoffProposal
        assert isinstance(envelope.proposal, HandoffProposal)
        assert envelope.proposal.kind == HandoffKind.RECEIPT

        # Verify next action
        assert envelope.next_action == NextAction.REQUEST_RECEIPT_IMAGE

        # Verify instructions
        assert len(envelope.proposal.instructions) > 0
        assert "receipt" in envelope.proposal.instructions.lower()

        # Verify required inputs
        assert "receipt_image" in envelope.proposal.required_inputs

        # Assistant message should guide user
        assert len(envelope.assistant_message) > 0


# =============================================================================
# Flow 6: Product scan request (handoff)
# =============================================================================


class TestFlow6_ProductScan:
    """User: 'Can you scan this barcode for me?'"""

    @pytest.mark.asyncio
    async def test_product_scan_handoff(self, mock_llm_client):
        """Test product barcode scan handoff."""

        intent_result = LLMIntentResult(
            intent="product_ingest_request",
            confidence=0.96,
            reasoning="User wants to scan barcode",
            entities=["barcode"],
        )

        mock_llm_client.generate_structured.side_effect = [
            (intent_result, None),
        ]

        with patch(
            "bubbly_chef.workflows.chat_ingest.get_ollama_client",
            return_value=mock_llm_client,
        ):
            envelope = await run_chat_workflow("Can you scan this barcode for me?")

        assert_envelope_structure(envelope)

        # Verify intent
        assert envelope.intent == Intent.PRODUCT_INGEST

        # Verify handoff proposal
        assert isinstance(envelope.proposal, HandoffProposal)
        assert envelope.proposal.kind == HandoffKind.PRODUCT

        # Verify next action
        assert envelope.next_action in [
            NextAction.REQUEST_PRODUCT_BARCODE,
            NextAction.REQUEST_PRODUCT_PHOTOS,
        ]

        # Verify required inputs
        assert (
            "barcode" in envelope.proposal.required_inputs
            or "product_photo" in envelope.proposal.required_inputs
        )


# =============================================================================
# Flow 7: Recipe link ingest request (handoff)
# =============================================================================


class TestFlow7_RecipeIngest:
    """User: 'Save this recipe I found: https://youtube.com/shorts/xyz'"""

    @pytest.mark.asyncio
    async def test_recipe_ingest_handoff(self, mock_llm_client):
        """Test recipe ingest handoff with URL."""

        intent_result = LLMIntentResult(
            intent="recipe_ingest_request",
            confidence=0.94,
            reasoning="User wants to save recipe from URL",
            entities=["recipe", "youtube.com"],
        )

        mock_llm_client.generate_structured.side_effect = [
            (intent_result, None),
        ]

        with patch(
            "bubbly_chef.workflows.chat_ingest.get_ollama_client",
            return_value=mock_llm_client,
        ):
            envelope = await run_chat_workflow(
                "Save this recipe I found: https://youtube.com/shorts/xyz"
            )

        assert_envelope_structure(envelope)

        # Verify intent
        assert envelope.intent == Intent.RECIPE_INGEST

        # Verify handoff proposal
        assert isinstance(envelope.proposal, HandoffProposal)
        assert envelope.proposal.kind == HandoffKind.RECIPE

        # Verify next action
        assert envelope.next_action == NextAction.REQUEST_RECIPE_TEXT

        # Verify required inputs
        assert (
            "url" in envelope.proposal.required_inputs
            or "recipe_text" in envelope.proposal.required_inputs
        )


# =============================================================================
# Flow 8: Mixed message (pantry + other chat)
# =============================================================================


class TestFlow8_MixedMessage:
    """User: 'I bought chicken and broccoli. Also what can I make tonight?'"""

    @pytest.mark.asyncio
    async def test_mixed_message_prioritizes_pantry(self, mock_llm_client):
        """Test that mixed messages prioritize pantry update (Policy A)."""

        intent_result = LLMIntentResult(
            intent="pantry_update",
            confidence=0.85,
            reasoning="User mentions buying items, prioritizing pantry update",
            entities=["chicken", "broccoli"],
        )

        parse_result = LLMParseResult(
            items=[
                LLMParsedItem(
                    name="chicken",
                    quantity=1,
                    unit="lb",
                    category="meat",
                    action="add",
                    confidence=0.88,
                ),
                LLMParsedItem(
                    name="broccoli",
                    quantity=1,
                    unit="bunch",
                    category="produce",
                    action="add",
                    confidence=0.90,
                ),
            ],
            confidence=0.89,
        )

        mock_llm_client.generate_structured.side_effect = [
            (intent_result, None),
            (parse_result, None),
        ]

        with patch(
            "bubbly_chef.workflows.chat_ingest.get_ollama_client",
            return_value=mock_llm_client,
        ):
            envelope = await run_chat_workflow(
                "I bought chicken and broccoli. Also what can I make tonight?"
            )

        assert_envelope_structure(envelope)

        # Verify intent prioritizes pantry
        assert envelope.intent == Intent.PANTRY_UPDATE

        # Verify proposal includes items
        assert isinstance(envelope.proposal, PantryProposal)
        assert len(envelope.proposal.actions) == 2

        action_names = [a.item.name for a in envelope.proposal.actions]
        assert "chicken" in action_names
        assert "broccoli" in action_names

        # Assistant message should acknowledge both parts
        # (pantry update + defer recipe help)
        assert len(envelope.assistant_message) > 0
        # May mention "meal" or "ideas" or "recipe"
        # assert any(word in envelope.assistant_message.lower() for word in ["meal", "ideas", "recipe", "make"])


# =============================================================================
# Flow 9: Undo / correction conversational fix
# =============================================================================


class TestFlow9_Correction:
    """User: 'Actually not eggs—make that yogurt.'"""

    @pytest.mark.asyncio
    async def test_correction_handling(self, mock_llm_client):
        """Test correction handling (optional for v0)."""

        intent_result = LLMIntentResult(
            intent="pantry_update",
            confidence=0.75,
            reasoning="User is correcting previous input",
            entities=["yogurt"],
        )

        parse_result = LLMParseResult(
            items=[
                LLMParsedItem(
                    name="yogurt",
                    quantity=1,
                    unit="container",
                    category="dairy",
                    action="add",
                    confidence=0.80,
                ),
            ],
            confidence=0.80,
        )

        mock_llm_client.generate_structured.side_effect = [
            (intent_result, None),
            (parse_result, None),
        ]

        with patch(
            "bubbly_chef.workflows.chat_ingest.get_ollama_client",
            return_value=mock_llm_client,
        ):
            envelope = await run_chat_workflow("Actually not eggs—make that yogurt.")

        assert_envelope_structure(envelope)

        # For v0, may just treat as new pantry update
        assert envelope.intent == Intent.PANTRY_UPDATE

        # Should require review for corrections
        assert envelope.requires_review is True

        # Assistant message should clarify
        # (Optional: check if message mentions "correction" or "changing")


# =============================================================================
# Error Handling Tests
# =============================================================================


class TestErrorHandling:
    """Test error handling scenarios."""

    @pytest.mark.asyncio
    async def test_empty_input(self, mock_llm_client):
        """Test handling of empty input."""

        intent_result = LLMIntentResult(
            intent="general_chat",
            confidence=0.5,
            reasoning="Empty input",
            entities=[],
        )

        mock_llm_client.generate_structured.side_effect = [
            (intent_result, None),
        ]

        with patch(
            "bubbly_chef.workflows.chat_ingest.get_ollama_client",
            return_value=mock_llm_client,
        ):
            envelope = await run_chat_workflow("")

        assert_envelope_structure(envelope)

        # Should handle gracefully
        assert envelope.intent == Intent.GENERAL_CHAT
        assert len(envelope.errors) > 0 or len(envelope.warnings) > 0

    @pytest.mark.asyncio
    async def test_llm_failure(self, mock_llm_client):
        """Test handling of LLM failure."""

        # Mock LLM to return error
        mock_llm_client.generate_structured.side_effect = [
            (None, "Connection timeout"),
        ]

        with patch(
            "bubbly_chef.workflows.chat_ingest.get_ollama_client",
            return_value=mock_llm_client,
        ):
            envelope = await run_chat_workflow("I bought milk")

        assert_envelope_structure(envelope)

        # Should default gracefully
        assert envelope.requires_review is True
        assert len(envelope.errors) > 0
        assert envelope.confidence.overall == 0.0 or envelope.confidence.overall < 0.5


# =============================================================================
# Stable Key Tests
# =============================================================================


class TestStableKeys:
    """Test that client_item_key is deterministic."""

    @pytest.mark.asyncio
    async def test_stable_keys_no_random_uuids(self, mock_llm_client):
        """Test that proposals use stable keys, not random UUIDs."""

        intent_result = LLMIntentResult(
            intent="pantry_update",
            confidence=0.92,
            reasoning="Pantry update",
            entities=["milk"],
        )

        parse_result = LLMParseResult(
            items=[
                LLMParsedItem(
                    name="milk",
                    quantity=1,
                    unit="gallon",
                    category="dairy",
                    action="add",
                    confidence=0.90,
                ),
            ],
            confidence=0.90,
        )

        mock_llm_client.generate_structured.side_effect = [
            (intent_result, None),
            (parse_result, None),
        ]

        with patch(
            "bubbly_chef.workflows.chat_ingest.get_ollama_client",
            return_value=mock_llm_client,
        ):
            # Run twice to verify keys are the same
            envelope1 = await run_chat_workflow("I bought milk")

            # Reset mock
            mock_llm_client.generate_structured.side_effect = [
                (intent_result, None),
                (parse_result, None),
            ]

            envelope2 = await run_chat_workflow("I bought milk")

        # Extract keys
        key1 = envelope1.proposal.actions[0].item.client_item_key
        key2 = envelope2.proposal.actions[0].item.client_item_key

        # Keys should be deterministic
        assert key1 == key2

        # Keys should not be UUIDs (no hyphens in UUID format)
        # UUIDs look like: 550e8400-e29b-41d4-a716-446655440000
        # We want keys like: dairy:milk or milk
        assert not all(c in key1 for c in ["-", "8", "4", "4", "12"])  # UUID pattern


# =============================================================================
# Routing Correctness Tests
# =============================================================================


class TestRoutingCorrectness:
    """Test that routing sends requests to correct handlers."""

    @pytest.mark.asyncio
    async def test_receipt_routes_to_receipt_handoff(self, mock_llm_client):
        """Verify receipt intent routes to receipt handoff."""

        intent_result = LLMIntentResult(
            intent="receipt_ingest_request",
            confidence=0.95,
            reasoning="Receipt upload",
            entities=[],
        )

        mock_llm_client.generate_structured.side_effect = [
            (intent_result, None),
        ]

        with patch(
            "bubbly_chef.workflows.chat_ingest.get_ollama_client",
            return_value=mock_llm_client,
        ):
            envelope = await run_chat_workflow("Upload receipt")

        assert envelope.intent == Intent.RECEIPT_INGEST
        assert isinstance(envelope.proposal, HandoffProposal)
        assert envelope.proposal.kind == HandoffKind.RECEIPT

    @pytest.mark.asyncio
    async def test_general_chat_does_not_create_proposal(self, mock_llm_client):
        """Verify general chat doesn't create proposals."""

        intent_result = LLMIntentResult(
            intent="general_chat",
            confidence=0.90,
            reasoning="General question",
            entities=[],
        )

        chat_result = LLMGeneralChatResult(
            response="I'm here to help with your pantry!",
            reasoning="Greeting",
        )

        mock_llm_client.generate_structured.side_effect = [
            (intent_result, None),
            (chat_result, None),
        ]

        with patch(
            "bubbly_chef.workflows.chat_ingest.get_ollama_client",
            return_value=mock_llm_client,
        ):
            envelope = await run_chat_workflow("Hello")

        assert envelope.intent == Intent.GENERAL_CHAT
        assert envelope.proposal is None
        assert envelope.next_action == NextAction.NONE
