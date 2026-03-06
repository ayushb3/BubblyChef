"""Request and response models for API endpoints."""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class ChatIngestRequest(BaseModel):
    """Request body for chat/voice text ingestion."""
    
    text: str = Field(
        description="Free-form text describing pantry actions",
        min_length=1,
        max_length=5000
    )
    context: dict[str, Any] | None = Field(
        default=None,
        description="Optional context (e.g., previous conversation)"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "text": "I bought 2 gallons of milk, a dozen eggs, and some apples",
                "context": None
            }
        }


class ReceiptIngestRequest(BaseModel):
    """Request body for receipt ingestion."""
    
    ocr_text: str = Field(
        description="OCR-extracted text from receipt (placeholder for image processing)",
        min_length=1,
        max_length=10000
    )
    store_name: str | None = Field(
        default=None,
        description="Store name if known"
    )
    purchase_date: str | None = Field(
        default=None,
        description="Purchase date if known (YYYY-MM-DD)"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "ocr_text": "WHOLE FOODS MARKET\n2% MILK 1GAL  $4.99\nORGANIC EGGS DZ  $6.49\nBANANAS  $1.29\nTOTAL  $12.77",
                "store_name": "Whole Foods",
                "purchase_date": "2026-02-17"
            }
        }


class ProductIngestRequest(BaseModel):
    """Request body for product scan/description ingestion."""
    
    barcode: str | None = Field(
        default=None,
        description="Product barcode (EAN/UPC)"
    )
    description: str | None = Field(
        default=None,
        description="Product description text"
    )
    quantity: float = Field(default=1.0, ge=0, description="Quantity to add")
    unit: str = Field(default="item", description="Unit of measurement")

    class Config:
        json_schema_extra = {
            "example": {
                "barcode": "0012000001086",
                "description": "Coca-Cola Classic 12oz can",
                "quantity": 6,
                "unit": "can"
            }
        }


class RecipeIngestRequest(BaseModel):
    """Request body for recipe link/text ingestion."""
    
    url: str | None = Field(
        default=None,
        description="Recipe URL to fetch and parse"
    )
    text: str | None = Field(
        default=None,
        description="Recipe text/transcript to parse"
    )
    caption: str | None = Field(
        default=None,
        description="Optional caption or title hint"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "url": "https://example.com/recipes/chocolate-cake",
                "text": None,
                "caption": "Grandma's chocolate cake recipe"
            }
        }


class ApplyRequest(BaseModel):
    """Request body to apply a reviewed proposal."""
    
    request_id: UUID = Field(description="Original proposal request ID")
    intent: Literal["pantry_update", "recipe_card"] = Field(
        description="Intent type being applied"
    )
    proposal: dict[str, Any] = Field(
        description="The reviewed (possibly modified) proposal to apply"
    )
    user_modifications: dict[str, Any] | None = Field(
        default=None,
        description="Track what the user changed from original"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "request_id": "550e8400-e29b-41d4-a716-446655440000",
                "intent": "pantry_update",
                "proposal": {
                    "actions": [
                        {
                            "action_type": "add",
                            "item": {
                                "name": "milk",
                                "quantity": 1,
                                "unit": "gallon"
                            },
                            "confidence": 0.95
                        }
                    ]
                },
                "user_modifications": None
            }
        }


class ApplyResponse(BaseModel):
    """Response after applying a proposal."""
    
    request_id: UUID = Field(description="Original request ID")
    success: bool = Field(description="Whether apply succeeded")
    applied_count: int = Field(
        default=0,
        description="Number of actions successfully applied"
    )
    failed_count: int = Field(
        default=0,
        description="Number of actions that failed"
    )
    errors: list[str] = Field(
        default_factory=list,
        description="Error messages for failed actions"
    )
    affected_item_ids: list[UUID] = Field(
        default_factory=list,
        description="IDs of created/updated items"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "request_id": "550e8400-e29b-41d4-a716-446655440000",
                "success": True,
                "applied_count": 3,
                "failed_count": 0,
                "errors": [],
                "affected_item_ids": [
                    "550e8400-e29b-41d4-a716-446655440001",
                    "550e8400-e29b-41d4-a716-446655440002"
                ]
            }
        }


# =============================================================================
# Chat API v2 (AI-first conversational interface)
# =============================================================================

class ChatRequest(BaseModel):
    """
    Request body for the /v1/chat endpoint.
    
    This is the primary conversational interface. Users send natural
    language messages and the system:
    1. Classifies intent (pantry update, receipt scan, general chat, etc.)
    2. Routes to appropriate handler
    3. Returns structured proposal or conversational response
    """
    
    message: str = Field(
        description="The user's message in natural language",
        min_length=1,
        max_length=10000
    )
    conversation_id: UUID | None = Field(
        default=None,
        description="Optional ID to continue an existing conversation"
    )
    mode: Literal["text", "voice"] = Field(
        default="text",
        description="Input mode (voice may have different parsing tolerance)"
    )
    pantry_snapshot: list[dict[str, Any]] | None = Field(
        default=None,
        description="Optional snapshot of current pantry for dedup/context"
    )
    context: dict[str, Any] | None = Field(
        default=None,
        description="Additional context (e.g., user preferences)"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "message": "I bought 2 gallons of milk and a dozen eggs",
                "conversation_id": None,
                "mode": "text",
                "pantry_snapshot": None,
                "context": None
            }
        }


class WorkflowEventRequest(BaseModel):
    """
    Request body for submitting events to a workflow.
    
    Used to resume paused workflows (e.g., after human review).
    """
    
    event_type: Literal["submit_review", "provide_clarification", "cancel"] = Field(
        description="Type of event being submitted"
    )
    decision: Literal["approve", "approve_with_edits", "reject"] | None = Field(
        default=None,
        description="User's decision (for submit_review)"
    )
    edits: dict[str, Any] | None = Field(
        default=None,
        description="Edited proposal (for approve_with_edits)"
    )
    clarification_response: str | None = Field(
        default=None,
        description="User's response to clarifying question"
    )
    feedback: str | None = Field(
        default=None,
        description="Optional user feedback"
    )
    idempotency_key: str | None = Field(
        default=None,
        description="Client key to prevent duplicate submissions"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "event_type": "submit_review",
                "decision": "approve",
                "edits": None,
                "clarification_response": None,
                "feedback": "Looks good!",
                "idempotency_key": "user123-1708168800"
            }
        }
