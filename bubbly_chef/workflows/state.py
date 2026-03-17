"""Shared workflow state and utilities."""

from typing import Any, TypedDict
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from bubbly_chef.config import settings
from bubbly_chef.models.base import (
    ConfidenceScore,
    Intent,
    NextAction,
    ProposalEnvelope,
    WorkflowStatus,
)
from bubbly_chef.models.pantry import (
    ActionType,
    FoodCategory,
    PantryProposal,
    PantryUpsertAction,
)
from bubbly_chef.models.proposals import (
    HandoffKind,
    HandoffProposal,
)
from bubbly_chef.models.recipe import RecipeCard, RecipeCardProposal


class WorkflowState(TypedDict, total=False):
    """
    Shared state for LangGraph workflows.

    Each node reads from and writes to this state.
    This state object flows through the entire graph.
    """

    # ==========================================================================
    # Identifiers
    # ==========================================================================
    request_id: str  # UUID as string for serialization
    workflow_id: str  # UUID as string
    conversation_id: str | None

    # ==========================================================================
    # Input
    # ==========================================================================
    input_text: str
    input_type: str  # "chat", "receipt", "product", "recipe"
    input_mode: str  # "text" or "voice"
    pantry_snapshot: list[dict[str, Any]] | None

    # ==========================================================================
    # Intent Classification
    # ==========================================================================
    intent: str  # Intent enum value
    intent_confidence: float
    intent_reasoning: str | None
    detected_entities: list[str]

    # ==========================================================================
    # Parsed Items (from LLM)
    # ==========================================================================
    raw_llm_output: str
    parsed_items: list[dict[str, Any]]
    parse_error: str | None

    # ==========================================================================
    # Normalized Items
    # ==========================================================================
    normalized_items: list[dict[str, Any]]

    # ==========================================================================
    # Final Actions & Proposals
    # ==========================================================================
    actions: list[PantryUpsertAction]
    proposal: PantryProposal | HandoffProposal | None

    # ==========================================================================
    # Recipe-specific
    # ==========================================================================
    recipe: RecipeCard | None

    # ==========================================================================
    # Response Fields
    # ==========================================================================
    assistant_message: str
    next_action: str  # NextAction enum value

    # ==========================================================================
    # Clarification & Review
    # ==========================================================================
    clarifying_questions: list[str]
    requires_review: bool
    interrupt_payload: dict[str, Any] | None

    # ==========================================================================
    # Confidence & Quality
    # ==========================================================================
    confidence: float
    field_confidences: dict[str, float]
    per_item_confidences: list[float]

    # ==========================================================================
    # Warnings & Errors
    # ==========================================================================
    warnings: list[str]
    errors: list[str]

    # ==========================================================================
    # Workflow Control
    # ==========================================================================
    workflow_status: str  # WorkflowStatus enum value
    should_interrupt: bool


class LLMParsedItem(BaseModel):
    """Schema for LLM-parsed pantry items."""

    name: str = Field(description="Item name")
    quantity: float = Field(default=1.0, description="Quantity")
    unit: str = Field(default="item", description="Unit of measurement")
    category: str | None = Field(default=None, description="Food category guess")
    action: str = Field(default="add", description="Action: add, remove, or use")
    confidence: float = Field(default=0.8, ge=0.0, le=1.0, description="Per-item confidence")


class LLMParseResult(BaseModel):
    """Schema for LLM parse response."""

    items: list[LLMParsedItem] = Field(default_factory=list)
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)


class LLMIntentResult(BaseModel):
    """Schema for LLM intent classification response."""

    intent: str = Field(
        description=(
            "One of: pantry_update, receipt_ingest_request,"
            " product_ingest_request, recipe_ingest_request,"
            " general_chat"
        )
    )
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    reasoning: str | None = Field(default=None, description="Why this intent was chosen")
    entities: list[str] = Field(default_factory=list, description="Key entities detected")


class LLMGeneralChatResult(BaseModel):
    """Schema for LLM general chat response."""

    response: str = Field(description="The assistant's response to the user")
    topics: list[str] = Field(default_factory=list, description="Detected topics")
    follow_ups: list[str] = Field(default_factory=list, description="Suggested follow-up topics")


class LLMRecipeResult(BaseModel):
    """Schema for LLM recipe parse response."""

    title: str
    description: str | None = None
    prep_time_minutes: int | None = None
    cook_time_minutes: int | None = None
    total_time_minutes: int | None = None
    servings: int | None = None
    ingredients: list[dict[str, Any]] = Field(default_factory=list)
    instructions: list[str] = Field(default_factory=list)
    cuisine: str | None = None
    meal_type: str | None = None
    dietary_tags: list[str] = Field(default_factory=list)
    difficulty: str | None = None
    tips: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)


def create_pantry_envelope(
    proposal: PantryProposal,
    confidence: float,
    field_confidences: dict[str, float],
    warnings: list[str],
    errors: list[str],
    assistant_message: str = "",
    next_action: NextAction = NextAction.REVIEW_PROPOSAL,
    request_id: str | None = None,
    workflow_id: str | None = None,
    conversation_id: str | None = None,
    clarifying_questions: list[str] | None = None,
    per_item_confidences: list[float] | None = None,
) -> ProposalEnvelope[PantryProposal]:
    """Create a proposal envelope for pantry proposals."""

    requires_review = confidence < settings.auto_apply_confidence_threshold or len(errors) > 0

    # Determine workflow status
    if errors:
        status = WorkflowStatus.FAILED
    elif requires_review:
        status = WorkflowStatus.AWAITING_REVIEW
    else:
        status = WorkflowStatus.COMPLETED

    # Generate assistant message if not provided
    if not assistant_message:
        num_actions = len(proposal.actions)
        if num_actions == 0:
            assistant_message = "I couldn't identify any pantry items from your message."
        elif num_actions == 1:
            item = proposal.actions[0].item
            assistant_message = f"I found 1 item: {item.name}. Please review before adding."
        else:
            assistant_message = f"I found {num_actions} items to add to your pantry. Please review."

    return ProposalEnvelope[PantryProposal](
        request_id=UUID(request_id) if request_id else uuid4(),
        workflow_id=UUID(workflow_id) if workflow_id else uuid4(),
        conversation_id=UUID(conversation_id) if conversation_id else None,
        schema_version=settings.schema_version,
        intent=Intent.PANTRY_UPDATE,
        proposal=proposal,
        assistant_message=assistant_message,
        confidence=ConfidenceScore(
            overall=confidence,
            field_scores=field_confidences,
            per_item=per_item_confidences or [],
        ),
        warnings=warnings,
        errors=errors,
        requires_review=requires_review,
        next_action=next_action,
        clarifying_questions=clarifying_questions or [],
        workflow_status=status,
    )


def create_recipe_envelope(
    proposal: RecipeCardProposal,
    confidence: float,
    field_confidences: dict[str, float],
    warnings: list[str],
    errors: list[str],
    assistant_message: str = "",
    request_id: str | None = None,
    workflow_id: str | None = None,
) -> ProposalEnvelope[RecipeCardProposal]:
    """Create a proposal envelope for recipe proposals."""

    requires_review = confidence < settings.auto_apply_confidence_threshold or len(errors) > 0

    if not assistant_message:
        assistant_message = f"I've parsed the recipe: {proposal.recipe.title}. Please review."

    return ProposalEnvelope[RecipeCardProposal](
        request_id=UUID(request_id) if request_id else uuid4(),
        workflow_id=UUID(workflow_id) if workflow_id else uuid4(),
        schema_version=settings.schema_version,
        intent=Intent.RECIPE_CARD,
        proposal=proposal,
        assistant_message=assistant_message,
        confidence=ConfidenceScore(
            overall=confidence,
            field_scores=field_confidences,
        ),
        warnings=warnings,
        errors=errors,
        requires_review=requires_review,
        next_action=NextAction.REVIEW_PROPOSAL if requires_review else NextAction.NONE,
        workflow_status=WorkflowStatus.AWAITING_REVIEW
        if requires_review
        else WorkflowStatus.COMPLETED,
    )


def create_handoff_envelope(
    handoff_kind: HandoffKind,
    assistant_message: str,
    next_action: NextAction,
    instructions: str,
    required_inputs: list[str],
    optional_inputs: list[str] | None = None,
    request_id: str | None = None,
    workflow_id: str | None = None,
    conversation_id: str | None = None,
) -> ProposalEnvelope[HandoffProposal]:
    """Create a proposal envelope for handoff to another workflow."""

    proposal = HandoffProposal(
        kind=handoff_kind,
        instructions=instructions,
        required_inputs=required_inputs,
        optional_inputs=optional_inputs or [],
    )

    return ProposalEnvelope[HandoffProposal](
        request_id=UUID(request_id) if request_id else uuid4(),
        workflow_id=UUID(workflow_id) if workflow_id else uuid4(),
        conversation_id=UUID(conversation_id) if conversation_id else None,
        schema_version=settings.schema_version,
        intent=Intent.RECEIPT_INGEST
        if handoff_kind == HandoffKind.RECEIPT
        else Intent.PRODUCT_INGEST
        if handoff_kind == HandoffKind.PRODUCT
        else Intent.RECIPE_INGEST,
        proposal=proposal,
        assistant_message=assistant_message,
        confidence=ConfidenceScore(overall=1.0),  # High confidence for handoff
        warnings=[],
        errors=[],
        requires_review=False,  # No review needed, just UI action
        next_action=next_action,
        workflow_status=WorkflowStatus.AWAITING_INPUT,
    )


def create_general_chat_envelope(
    assistant_message: str,
    request_id: str | None = None,
    workflow_id: str | None = None,
    conversation_id: str | None = None,
) -> ProposalEnvelope[None]:
    """Create a proposal envelope for general chat responses."""

    return ProposalEnvelope[None](
        request_id=UUID(request_id) if request_id else uuid4(),
        workflow_id=UUID(workflow_id) if workflow_id else uuid4(),
        conversation_id=UUID(conversation_id) if conversation_id else None,
        schema_version=settings.schema_version,
        intent=Intent.GENERAL_CHAT,
        proposal=None,
        assistant_message=assistant_message,
        confidence=ConfidenceScore(overall=1.0),
        warnings=[],
        errors=[],
        requires_review=False,
        next_action=NextAction.NONE,
        workflow_status=WorkflowStatus.COMPLETED,
    )


def map_category(category_str: str | None) -> FoodCategory:
    """Map a string category to FoodCategory enum."""
    if not category_str:
        return FoodCategory.OTHER

    category_lower = category_str.lower()

    # Direct mapping
    mapping = {
        "produce": FoodCategory.PRODUCE,
        "fruit": FoodCategory.PRODUCE,
        "vegetable": FoodCategory.PRODUCE,
        "vegetables": FoodCategory.PRODUCE,
        "fruits": FoodCategory.PRODUCE,
        "dairy": FoodCategory.DAIRY,
        "milk": FoodCategory.DAIRY,
        "cheese": FoodCategory.DAIRY,
        "meat": FoodCategory.MEAT,
        "poultry": FoodCategory.MEAT,
        "beef": FoodCategory.MEAT,
        "pork": FoodCategory.MEAT,
        "chicken": FoodCategory.MEAT,
        "seafood": FoodCategory.SEAFOOD,
        "fish": FoodCategory.SEAFOOD,
        "frozen": FoodCategory.FROZEN,
        "canned": FoodCategory.CANNED,
        "dry": FoodCategory.DRY_GOODS,
        "dry_goods": FoodCategory.DRY_GOODS,
        "pantry": FoodCategory.DRY_GOODS,
        "condiment": FoodCategory.CONDIMENTS,
        "condiments": FoodCategory.CONDIMENTS,
        "sauce": FoodCategory.CONDIMENTS,
        "beverage": FoodCategory.BEVERAGES,
        "beverages": FoodCategory.BEVERAGES,
        "drink": FoodCategory.BEVERAGES,
        "drinks": FoodCategory.BEVERAGES,
        "snack": FoodCategory.SNACKS,
        "snacks": FoodCategory.SNACKS,
        "bakery": FoodCategory.BAKERY,
        "bread": FoodCategory.BAKERY,
    }

    return mapping.get(category_lower, FoodCategory.OTHER)


def map_action_type(action_str: str) -> ActionType:
    """Map a string action to ActionType enum."""
    action_lower = action_str.lower()

    mapping = {
        "add": ActionType.ADD,
        "update": ActionType.UPDATE,
        "remove": ActionType.REMOVE,
        "delete": ActionType.REMOVE,
        "use": ActionType.USE,
        "consume": ActionType.USE,
    }

    return mapping.get(action_lower, ActionType.ADD)
