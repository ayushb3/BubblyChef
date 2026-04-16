"""Request and response models for API endpoints."""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ApplyRequest(BaseModel):
    """Request body to apply a reviewed proposal."""

    request_id: UUID = Field(description="Original proposal request ID")
    intent: Literal["pantry_update", "recipe_card"] = Field(description="Intent type being applied")
    proposal: dict[str, Any] = Field(
        description="The reviewed (possibly modified) proposal to apply"
    )
    user_modifications: dict[str, Any] | None = Field(
        default=None, description="Track what the user changed from original"
    )

    model_config = ConfigDict(json_schema_extra={
        "example": {
            "request_id": "550e8400-e29b-41d4-a716-446655440000",
            "intent": "pantry_update",
            "proposal": {
                "actions": [
                    {
                        "action_type": "add",
                        "item": {"name": "milk", "quantity": 1, "unit": "gallon"},
                        "confidence": 0.95,
                    }
                ]
            },
            "user_modifications": None,
        }
    })


class ApplyResponse(BaseModel):
    """Response after applying a proposal."""

    request_id: UUID = Field(description="Original request ID")
    success: bool = Field(description="Whether apply succeeded")
    applied_count: int = Field(default=0, description="Number of actions successfully applied")
    failed_count: int = Field(default=0, description="Number of actions that failed")
    errors: list[str] = Field(default_factory=list, description="Error messages for failed actions")
    affected_item_ids: list[UUID] = Field(
        default_factory=list, description="IDs of created/updated items"
    )

    model_config = ConfigDict(json_schema_extra={
        "example": {
            "request_id": "550e8400-e29b-41d4-a716-446655440000",
            "success": True,
            "applied_count": 3,
            "failed_count": 0,
            "errors": [],
            "affected_item_ids": [
                "550e8400-e29b-41d4-a716-446655440001",
                "550e8400-e29b-41d4-a716-446655440002",
            ],
        }
    })


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
        description="The user's message in natural language", min_length=1, max_length=10000
    )
    conversation_id: UUID | None = Field(
        default=None, description="Optional ID to continue an existing conversation"
    )
    mode: Literal["chat", "recipe", "learn", "text", "voice"] = Field(
        default="chat",
        description="Chat mode: chat, recipe, learn (new), text/voice (legacy)",
    )
    pantry_snapshot: list[dict[str, Any]] | None = Field(
        default=None, description="Optional snapshot of current pantry for dedup/context"
    )
    context: dict[str, Any] | None = Field(
        default=None, description="Additional context (e.g., user preferences)"
    )

    model_config = ConfigDict(json_schema_extra={
        "example": {
            "message": "I bought 2 gallons of milk and a dozen eggs",
            "conversation_id": None,
            "mode": "text",
            "pantry_snapshot": None,
            "context": None,
        }
    })
