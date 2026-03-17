"""Proposal types and related models for chat workflow."""

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class HandoffKind(StrEnum):
    """Types of handoff requests to other workflows."""

    RECEIPT = "receipt"
    PRODUCT = "product"
    RECIPE = "recipe"


class HandoffProposal(BaseModel):
    """
    Proposal for handing off to a specialized ingest workflow.

    Generated when the user mentions wanting to scan a receipt,
    product barcode, or import a recipe - but hasn't provided
    the actual data yet.
    """

    kind: HandoffKind = Field(description="Type of handoff (receipt, product, recipe)")
    instructions: str = Field(description="User-friendly instructions for what to do next")
    required_inputs: list[str] = Field(
        description="List of required inputs (e.g., 'receipt_image', 'barcode')"
    )
    optional_inputs: list[str] = Field(default_factory=list, description="List of optional inputs")
    example_prompt: str | None = Field(
        default=None, description="Example of what the user could say/upload"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "kind": "receipt",
                "instructions": "Please upload a photo of your receipt, or paste the text.",
                "required_inputs": ["receipt_image"],
                "optional_inputs": ["store_name", "purchase_date"],
                "example_prompt": "Take a photo of your receipt and send it here.",
            }
        }


class ChatRole(StrEnum):
    """Roles in a conversation."""

    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class ChatMessage(BaseModel):
    """
    A single message in a conversation thread.

    Used to track conversation context for multi-turn interactions.
    """

    id: UUID = Field(default_factory=uuid4, description="Message ID")
    role: ChatRole = Field(description="Who sent this message")
    content: str = Field(description="Message content")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="Additional metadata (e.g., intent detected, tokens used)"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "role": "user",
                "content": "I bought milk and eggs",
                "timestamp": "2026-02-17T10:00:00Z",
                "metadata": {},
            }
        }


class ReviewDecision(StrEnum):
    """Types of review decisions."""

    APPROVE = "approve"
    APPROVE_WITH_EDITS = "approve_with_edits"
    REJECT = "reject"
    REQUEST_CHANGES = "request_changes"


class ReviewEvent(BaseModel):
    """
    Event for resuming a paused workflow after human review.

    Sent when a user approves, edits, or rejects a proposal
    that was awaiting review.
    """

    workflow_id: UUID = Field(description="ID of the workflow to resume")
    decision: ReviewDecision = Field(description="User's decision")
    edits: dict[str, Any] | None = Field(
        default=None, description="Edited proposal data (for approve_with_edits)"
    )
    feedback: str | None = Field(
        default=None, description="Optional user feedback or reason for rejection"
    )
    idempotency_key: str | None = Field(
        default=None, description="Client-provided key to prevent duplicate submissions"
    )
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        json_schema_extra = {
            "example": {
                "workflow_id": "660e8400-e29b-41d4-a716-446655440001",
                "decision": "approve_with_edits",
                "edits": {"actions": [{"item": {"name": "whole milk"}}]},
                "feedback": None,
                "idempotency_key": "user123-1708168800",
                "timestamp": "2026-02-17T10:00:00Z",
            }
        }


class IntentClassification(BaseModel):
    """
    Result of LLM intent classification.

    Used internally by the workflow to determine routing.
    """

    intent: str = Field(description="Detected intent type")
    confidence: float = Field(ge=0.0, le=1.0, description="Classification confidence")
    reasoning: str | None = Field(
        default=None, description="LLM's reasoning for the classification"
    )
    detected_entities: list[str] = Field(
        default_factory=list, description="Key entities detected in the input"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "intent": "pantry_update",
                "confidence": 0.92,
                "reasoning": "User mentions buying specific grocery items",
                "detected_entities": ["milk", "eggs"],
            }
        }


class ClarificationRequest(BaseModel):
    """
    Request for clarification from the user.

    Generated when the workflow encounters ambiguity that
    requires human input to resolve.
    """

    question: str = Field(description="The clarifying question to ask")
    context: str | None = Field(default=None, description="Context explaining why we're asking")
    options: list[str] = Field(default_factory=list, description="Suggested options if applicable")
    field_reference: str | None = Field(
        default=None, description="Which field this question relates to"
    )
    item_index: int | None = Field(
        default=None, description="Index of the item in question if applicable"
    )


class ParsedPantryItem(BaseModel):
    """
    A parsed pantry item from LLM output.

    Intermediate representation before normalization.
    """

    name: str = Field(description="Item name as parsed")
    quantity: float = Field(default=1.0, ge=0, description="Quantity")
    unit: str = Field(default="item", description="Unit of measurement")
    category: str | None = Field(default=None, description="Food category guess")
    action: str = Field(default="add", description="Action: add, remove, use, set")
    confidence: float = Field(
        default=0.8, ge=0.0, le=1.0, description="Per-item confidence from LLM"
    )
    notes: str | None = Field(default=None, description="Additional notes/context")


class GeneralChatResponse(BaseModel):
    """
    Response for general chat (non-pantry) queries.

    When the user asks something unrelated to grocery/pantry
    management, we return a conversational response.
    """

    response_text: str = Field(description="The assistant's response")
    detected_topics: list[str] = Field(
        default_factory=list, description="Topics detected in the conversation"
    )
    follow_up_suggestions: list[str] = Field(
        default_factory=list, description="Suggested follow-up topics or actions"
    )
