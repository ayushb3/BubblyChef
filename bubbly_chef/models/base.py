"""Base models for the proposal envelope and common types."""

from datetime import datetime
from enum import StrEnum
from typing import Any, Generic, TypeVar
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class Intent(StrEnum):
    """Intent types detected from user input."""

    PANTRY_UPDATE = "pantry_update"
    RECEIPT_INGEST = "receipt_ingest_request"
    PRODUCT_INGEST = "product_ingest_request"
    RECIPE_INGEST = "recipe_ingest_request"
    RECIPE_CARD = "recipe_card"
    COOKING_HELP = "cooking_help"  # Questions about cooking, meal ideas (not ingest)
    GENERAL_CHAT = "general_chat"


class NextAction(StrEnum):
    """
    Next action hint for the UI to know what to render or prompt.

    The UI uses this to determine what to show the user next.
    """

    NONE = "none"  # No action needed, show message only
    REQUEST_RECEIPT_IMAGE = "request_receipt_image"  # Prompt user to upload receipt
    REQUEST_PRODUCT_BARCODE = "request_product_barcode"  # Prompt for barcode scan
    REQUEST_PRODUCT_PHOTOS = "request_product_photos"  # Prompt for product photos
    REQUEST_RECIPE_TEXT = "request_recipe_text"  # Prompt for recipe URL/text
    REQUEST_CLARIFICATION = "request_clarification"  # Need user to clarify something
    REVIEW_PROPOSAL = "review_proposal"  # Show proposal for user review/edit


class WorkflowStatus(StrEnum):
    """Status of a workflow execution."""

    PENDING = "pending"
    RUNNING = "running"
    AWAITING_REVIEW = "awaiting_review"
    AWAITING_INPUT = "awaiting_input"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


T = TypeVar("T")


class ConfidenceScore(BaseModel):
    """Confidence score with optional per-field breakdown."""

    overall: float = Field(ge=0.0, le=1.0, description="Overall confidence 0-1")
    field_scores: dict[str, float] = Field(
        default_factory=dict, description="Per-field confidence scores"
    )
    per_item: list[float] = Field(
        default_factory=list, description="Per-item confidence scores for list proposals"
    )
    reasoning: str | None = Field(
        default=None, description="Optional reasoning for the confidence score"
    )


class ProposalEnvelope(BaseModel, Generic[T]):
    """
    Uniform envelope for all workflow responses.

    Every workflow returns this structure so the UI has a consistent contract.
    This is the OUTPUT CONTRACT mentioned in the architectural requirements.
    """

    # Identifiers
    request_id: UUID = Field(default_factory=uuid4, description="Unique request identifier")
    workflow_id: UUID = Field(
        default_factory=uuid4, description="Workflow instance identifier for resumption"
    )
    conversation_id: UUID | None = Field(
        default=None, description="Optional conversation thread ID"
    )

    # Schema & Intent
    schema_version: str = Field(description="Schema version for this envelope")
    intent: Intent = Field(description="Detected intent type")

    # Response payload
    proposal: T | None = Field(
        default=None, description="The structured proposal payload (null for general chat)"
    )
    assistant_message: str = Field(
        default="", description="Short text message the UI should display to the user"
    )

    # Confidence & Review
    confidence: ConfidenceScore = Field(description="Confidence scores")
    requires_review: bool = Field(
        default=True, description="Whether this proposal requires human review before applying"
    )

    # UI Hints
    next_action: NextAction = Field(
        default=NextAction.NONE, description="Hint for UI about what action to prompt next"
    )
    clarifying_questions: list[str] = Field(
        default_factory=list, description="Questions to ask user if clarification needed"
    )

    # Status & Errors
    warnings: list[str] = Field(default_factory=list, description="Non-fatal warnings")
    errors: list[str] = Field(default_factory=list, description="Validation errors")
    workflow_status: WorkflowStatus = Field(
        default=WorkflowStatus.COMPLETED, description="Current workflow status"
    )

    # Metadata
    created_at: datetime = Field(
        default_factory=datetime.utcnow, description="Timestamp when proposal was created"
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="Additional metadata for debugging/logging"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "request_id": "550e8400-e29b-41d4-a716-446655440000",
                "workflow_id": "660e8400-e29b-41d4-a716-446655440001",
                "conversation_id": None,
                "schema_version": "1.0.0",
                "intent": "pantry_update",
                "proposal": {},
                "assistant_message": "I found 3 items to add to your pantry.",
                "confidence": {
                    "overall": 0.85,
                    "field_scores": {},
                    "per_item": [],
                    "reasoning": None,
                },
                "requires_review": True,
                "next_action": "review_proposal",
                "clarifying_questions": [],
                "warnings": [],
                "errors": [],
                "workflow_status": "awaiting_review",
                "created_at": "2026-02-17T10:00:00Z",
                "metadata": {},
            }
        }
