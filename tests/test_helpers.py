"""
Test helpers and utilities for chat workflow testing.

Provides:
- Mock LLM fixtures
- State builders
- Assertion helpers
- Test data factories
"""

from datetime import date, timedelta
from typing import Any
from uuid import uuid4

from bubbly_chef.workflows.state import (
    WorkflowState,
    LLMParseResult,
    LLMParsedItem,
    LLMIntentResult,
    LLMGeneralChatResult,
)
from bubbly_chef.models.base import Intent, NextAction, ProposalEnvelope
from bubbly_chef.models.pantry import (
    ActionType,
    FoodCategory,
    PantryItem,
    PantryProposal,
    PantryUpsertAction,
    StorageLocation,
)
from bubbly_chef.models.proposals import HandoffProposal, HandoffKind


# =============================================================================
# State Builders
# =============================================================================


def build_base_workflow_state(
    input_text: str = "I bought milk",
    input_type: str = "chat",
    conversation_id: str | None = None,
) -> WorkflowState:
    """Build a base workflow state for testing."""
    return {
        "request_id": str(uuid4()),
        "workflow_id": str(uuid4()),
        "conversation_id": conversation_id,
        "input_text": input_text,
        "input_type": input_type,
        "input_mode": "text",
        "warnings": [],
        "errors": [],
        "detected_entities": [],
        "pantry_snapshot": None,
    }


def build_pantry_update_state(
    items: list[dict[str, Any]],
    input_text: str = "I bought groceries",
) -> WorkflowState:
    """Build a workflow state for pantry update testing."""
    state = build_base_workflow_state(input_text)
    state.update(
        {
            "intent": Intent.PANTRY_UPDATE.value,
            "intent_confidence": 0.90,
            "intent_reasoning": "Pantry update detected",
            "parsed_items": items,
        }
    )
    return state


# =============================================================================
# Mock LLM Result Factories
# =============================================================================


def create_mock_intent_result(
    intent: str = "pantry_update",
    confidence: float = 0.90,
    entities: list[str] | None = None,
) -> LLMIntentResult:
    """Create a mock LLM intent classification result."""
    return LLMIntentResult(
        intent=intent,
        confidence=confidence,
        reasoning=f"Detected {intent}",
        entities=entities or [],
    )


def create_mock_parse_result(
    items: list[dict[str, Any]] | None = None,
    confidence: float = 0.85,
) -> LLMParseResult:
    """
    Create a mock LLM parse result.

    Args:
        items: List of item dicts with keys: name, quantity, unit, category, action
        confidence: Overall parsing confidence
    """
    if items is None:
        items = [
            {
                "name": "milk",
                "quantity": 1,
                "unit": "gallon",
                "category": "dairy",
                "action": "add",
                "confidence": 0.90,
            }
        ]

    parsed_items = [
        LLMParsedItem(
            name=item["name"],
            quantity=item.get("quantity", 1),
            unit=item.get("unit", "item"),
            category=item.get("category", "other"),
            action=item.get("action", "add"),
            confidence=item.get("confidence", 0.85),
        )
        for item in items
    ]

    return LLMParseResult(
        items=parsed_items,
        confidence=confidence,
    )


def create_mock_chat_result(
    response: str = "I'm here to help!",
) -> LLMGeneralChatResult:
    """Create a mock LLM general chat result."""
    return LLMGeneralChatResult(
        response=response,
        reasoning="General conversation",
    )


# =============================================================================
# Item Factories
# =============================================================================


def create_test_pantry_item(
    name: str = "milk",
    quantity: float = 1,
    unit: str = "gallon",
    category: FoodCategory = FoodCategory.DAIRY,
    **kwargs,
) -> PantryItem:
    """Create a test PantryItem."""
    return PantryItem(
        name=name,
        original_name=kwargs.get("original_name", name),
        quantity=quantity,
        unit=unit,
        category=category,
        storage_location=kwargs.get("storage_location", StorageLocation.FRIDGE),
        purchase_date=kwargs.get("purchase_date", date.today()),
        expiry_date=kwargs.get("expiry_date", date.today() + timedelta(days=7)),
        estimated_expiry=kwargs.get("estimated_expiry", True),
        client_item_key=kwargs.get("client_item_key", f"{category.value}:{name}"),
    )


def create_test_pantry_action(
    item: PantryItem | None = None,
    action_type: ActionType = ActionType.ADD,
    confidence: float = 0.85,
) -> PantryUpsertAction:
    """Create a test PantryUpsertAction."""
    if item is None:
        item = create_test_pantry_item()

    return PantryUpsertAction(
        action_type=action_type,
        item=item,
        confidence=confidence,
    )


# =============================================================================
# Proposal Factories
# =============================================================================


def create_test_pantry_proposal(
    actions: list[PantryUpsertAction] | None = None,
    **kwargs,
) -> PantryProposal:
    """Create a test PantryProposal."""
    if actions is None:
        actions = [create_test_pantry_action()]

    return PantryProposal(
        actions=actions,
        normalization_applied=kwargs.get("normalization_applied", True),
        expiry_defaults_applied=kwargs.get("expiry_defaults_applied", True),
    )


def create_test_handoff_proposal(
    kind: HandoffKind = HandoffKind.RECEIPT,
    **kwargs,
) -> HandoffProposal:
    """Create a test HandoffProposal."""
    instructions_map = {
        HandoffKind.RECEIPT: "Please upload a photo of your receipt.",
        HandoffKind.PRODUCT: "Please scan the product barcode.",
        HandoffKind.RECIPE: "Please provide the recipe URL or text.",
    }

    required_inputs_map = {
        HandoffKind.RECEIPT: ["receipt_image"],
        HandoffKind.PRODUCT: ["barcode"],
        HandoffKind.RECIPE: ["url"],
    }

    return HandoffProposal(
        kind=kind,
        instructions=kwargs.get("instructions", instructions_map[kind]),
        required_inputs=kwargs.get("required_inputs", required_inputs_map[kind]),
        optional_inputs=kwargs.get("optional_inputs", []),
        example_prompt=kwargs.get("example_prompt"),
    )


# =============================================================================
# Assertion Helpers
# =============================================================================


def assert_valid_envelope_structure(envelope: ProposalEnvelope):
    """Assert that envelope has all required fields and valid structure."""
    # Identifiers
    assert envelope.request_id is not None
    assert envelope.workflow_id is not None
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

    # Lists
    assert isinstance(envelope.warnings, list)
    assert isinstance(envelope.errors, list)
    assert isinstance(envelope.clarifying_questions, list)


def assert_pantry_proposal_valid(proposal: PantryProposal):
    """Assert that a pantry proposal is valid."""
    assert isinstance(proposal, PantryProposal)
    assert isinstance(proposal.actions, list)
    assert len(proposal.actions) > 0

    for action in proposal.actions:
        assert isinstance(action, PantryUpsertAction)
        assert isinstance(action.item, PantryItem)
        assert action.item.name is not None
        assert action.item.quantity > 0
        assert action.item.client_item_key is not None


def assert_handoff_proposal_valid(
    proposal: HandoffProposal, expected_kind: HandoffKind
):
    """Assert that a handoff proposal is valid."""
    assert isinstance(proposal, HandoffProposal)
    assert proposal.kind == expected_kind
    assert len(proposal.instructions) > 0
    assert len(proposal.required_inputs) > 0


def assert_no_random_uuids_in_keys(actions: list[PantryUpsertAction]):
    """
    Assert that client_item_keys are deterministic, not random UUIDs.

    UUIDs have format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    We want keys like: 'dairy:milk' or 'milk'
    """
    for action in actions:
        key = action.item.client_item_key
        # UUID has multiple hyphens and hex digits
        # Our keys should be semantic
        assert key is not None
        assert len(key) > 0
        # If it has hyphens, it shouldn't have UUID pattern (8-4-4-4-12)
        if "-" in key:
            parts = key.split("-")
            # UUID has 5 parts
            assert len(parts) != 5, f"Key looks like UUID: {key}"


def assert_stable_keys(envelope1: ProposalEnvelope, envelope2: ProposalEnvelope):
    """
    Assert that two envelopes from the same input have the same keys.

    This verifies deterministic key generation.
    """
    assert isinstance(envelope1.proposal, PantryProposal)
    assert isinstance(envelope2.proposal, PantryProposal)

    keys1 = [a.item.client_item_key for a in envelope1.proposal.actions]
    keys2 = [a.item.client_item_key for a in envelope2.proposal.actions]

    assert keys1 == keys2, "Keys should be deterministic"


# =============================================================================
# Test Data Sets
# =============================================================================

PANTRY_ADD_EXAMPLES = [
    "I bought milk and eggs",
    "Picked up some apples and bread",
    "Got 2 gallons of milk and a dozen eggs",
    "Purchased chicken, broccoli, and rice",
]

PANTRY_CONSUME_EXAMPLES = [
    "I used half the milk",
    "Finished the eggs",
    "Threw away old yogurt",
    "Consumed 2 apples",
]

RECEIPT_EXAMPLES = [
    "I scanned a receipt",
    "Here's my receipt from Costco",
    "Upload this receipt photo",
]

PRODUCT_EXAMPLES = [
    "Scan this barcode",
    "What is this product?",
    "Look up this item",
]

RECIPE_EXAMPLES = [
    "Save this recipe: https://example.com/recipe",
    "Import recipe from YouTube",
    "Add this cooking video",
]

GENERAL_CHAT_EXAMPLES = [
    "What's a good dinner idea?",
    "How do I store avocados?",
    "Tell me about meal prep",
]


# =============================================================================
# Mock Configuration Helpers
# =============================================================================


def configure_mock_for_pantry_update(
    mock_llm_client,
    items: list[dict[str, Any]] | None = None,
    intent_confidence: float = 0.90,
    parse_confidence: float = 0.85,
):
    """Configure a mock LLM client for pantry update flow."""
    intent_result = create_mock_intent_result(
        intent="pantry_update",
        confidence=intent_confidence,
        entities=[item["name"] for item in items] if items else ["milk"],
    )

    parse_result = create_mock_parse_result(
        items=items,
        confidence=parse_confidence,
    )

    mock_llm_client.generate_structured.side_effect = [
        (intent_result, None),
        (parse_result, None),
    ]


def configure_mock_for_handoff(
    mock_llm_client,
    intent: str = "receipt_ingest_request",
    confidence: float = 0.95,
):
    """Configure a mock LLM client for handoff flow."""
    intent_result = create_mock_intent_result(
        intent=intent,
        confidence=confidence,
    )

    mock_llm_client.generate_structured.side_effect = [
        (intent_result, None),
    ]


def configure_mock_for_general_chat(
    mock_llm_client,
    response: str = "I'm here to help!",
    confidence: float = 0.90,
):
    """Configure a mock LLM client for general chat flow."""
    intent_result = create_mock_intent_result(
        intent="general_chat",
        confidence=confidence,
    )

    chat_result = create_mock_chat_result(response=response)

    mock_llm_client.generate_structured.side_effect = [
        (intent_result, None),
        (chat_result, None),
    ]
