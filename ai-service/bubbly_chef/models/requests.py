"""Request and response models for API endpoints."""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    conversation_id: str | None = Field(
        default=None,
        description=(
            "Issue #444: the conversation whose persisted turns this apply resolves. "
            "Required when turn_request_ids is non-empty."
        ),
    )
    turn_request_ids: list[UUID] = Field(
        default_factory=list,
        max_length=200,
        description=(
            "Issue #444: request ids of every chat turn the applied card spans, oldest "
            "first. Empty (scan confirm, older clients) means no history is read or "
            "written. 200 matches the history route's own read cap."
        ),
    )

    @model_validator(mode="after")
    def _turn_ids_need_a_conversation(self) -> "ApplyRequest":
        if self.turn_request_ids and not self.conversation_id:
            raise ValueError("turn_request_ids requires conversation_id")
        return self

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
    failed_names: list[str] = Field(
        default_factory=list,
        description=(
            "Issue #444: proposal_action_key of each SENT action that failed, from the "
            "repository's failure indices (no error-string parsing needed)"
        ),
    )
    already_applied_names: list[str] = Field(
        default_factory=list,
        description="Issue #444: keys the server-side guard dropped as already applied",
    )
    recorded_turn_request_ids: list[UUID] = Field(
        default_factory=list,
        description="Issue #444: turns whose proposal_review was written by this apply",
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


class RejectRequest(BaseModel):
    """Request body to record that a pantry proposal card was dismissed (#444)."""

    conversation_id: str = Field(description="Conversation the turns belong to")
    turn_request_ids: list[UUID] = Field(
        min_length=1, max_length=200, description="Every chat turn the card spans, oldest first"
    )


class RejectResponse(BaseModel):
    """Response after recording a rejection."""

    recorded_turn_request_ids: list[UUID] = Field(default_factory=list)


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
        default=None,
        description=(
            "Additional context forwarded to the workflow. Recognised keys: "
            '"cooking_recipe_id" (<str>) — the recipe the user just started '
            "cooking; the recipe is resolved server-side from this id and the "
            "conversation is pinned to it. Legacy: \"cooking_recipe\" "
            "({id, title, ingredients}) — still accepted, same effect. "
            '"meal_option_id" (<str>) — a tap on one of the meal_plan option '
            "cards; resolves against the retained option set and routes to "
            "the pick stage, never fuzzy-matched. "
            '"meal_followup" (<bool>, must be exactly `true`) — a tap on a '
            "predicted pill under a meal reply (issue #651); routes straight "
            "to the option stage with the retained meal's constraints, "
            "servings and previously-offered titles carried forward. Ignored "
            "when \"meal_option_id\" is also present — that always wins. "
            '"meal_fixed_main" (<object>) — "Make it a meal" (issue #651 PR B): '
            "starts the meal flow with one dish as the fixed main. Exactly one of "
            '{"recipe_id": <uuid str>} (a saved recipe, resolved server-side and '
            "scoped to the caller -- another user's id is \"not found\") or "
            '{"recipe": {title, ingredients, instructions, ...}} (an in-chat '
            "recipe; the serialised payload is capped at 32 KB). Any object routes "
            "to the meal option stage, a malformed one gets a friendly refusal; "
            "any non-object value is ignored. Every option then keeps that main and "
            "differs only in its sides. \"meal_option_id\" wins when both are "
            "present, and it beats \"meal_followup\" (a fresh fixed-main turn never "
            "inherits a retained meal)."
        ),
    )
    # TODO(#416 chips): when [Edit this recipe] / [Start over] chips are wired in
    # the frontend, they should POST with forced_intent set to the appropriate
    # Intent value.  The backend honours it as a deterministic override before
    # the classifier runs.  Values: "recipe_card" (edit) or "recipe_brainstorm"
    # (start over / invalidate set).  recipe_generation is deliberately excluded
    # (no chip emits it; it would bypass the COOKING gate).
    # Constrained to the two chips that actually exist: [Edit this recipe]
    # (recipe_card) and [Start over] (recipe_brainstorm). recipe_generation is
    # intentionally NOT accepted — no chip emits it, and honouring it would let a
    # client bypass the COOKING-mode amendment gate (#416 Q3 safety fix).
    forced_intent: Literal["recipe_card", "recipe_brainstorm"] | None = Field(
        default=None,
        description=(
            "Deterministic intent override from an explicit UI action (e.g. chip tap). "
            "When set, the classifier is bypassed entirely and this intent is used. "
            "Accepted values: 'recipe_card' ([Edit this recipe]), "
            "'recipe_brainstorm' ([Start over], invalidates the brainstorm set). "
            "Chip UI is not yet live — this is the extension point (#416)."
        ),
    )
    forced_intent_source: str | None = Field(
        default=None,
        max_length=10000,
        description=(
            "With forced_intent: the user's message that raised the confirm band. "
            "The band posts its button label as `message`, so without this the "
            "workflow would refine or brainstorm against 'Tweak this recipe' and "
            "lose the actual request. Ignored when forced_intent is unset."
        ),
    )
    follow_up_chips: bool = Field(
        default=True,
        description=(
            "Whether this caller renders context-aware follow-up chips (issue "
            "#498). False skips the extra model call that produces them — the "
            "guided-cook overlay streams chat but shows no chips."
        ),
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
