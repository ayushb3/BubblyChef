"""Pydantic models for request/response contracts."""

from bubbly_chef.models.base import (
    ProposalEnvelope,
    Intent,
    NextAction,
    WorkflowStatus,
    ConfidenceScore,
)
from bubbly_chef.models.pantry import (
    PantryItem,
    PantryAction,
    ActionType,
    PantryProposal,
    PantryUpsertAction,
    FoodCategory,
    StorageLocation,
)
from bubbly_chef.models.proposals import (
    HandoffProposal,
    HandoffKind,
    ChatMessage,
    ChatRole,
    ReviewEvent,
    ReviewDecision,
    IntentClassification,
    ClarificationRequest,
    ParsedPantryItem,
    GeneralChatResponse,
)
from bubbly_chef.models.recipe import (
    Ingredient,
    RecipeCard,
    RecipeCardProposal,
)
from bubbly_chef.models.requests import (
    ChatIngestRequest,
    ReceiptIngestRequest,
    ProductIngestRequest,
    RecipeIngestRequest,
    ApplyRequest,
    ApplyResponse,
    ChatRequest,
    WorkflowEventRequest,
)

__all__ = [
    # Base
    "ProposalEnvelope",
    "Intent",
    "NextAction",
    "WorkflowStatus",
    "ConfidenceScore",
    # Pantry
    "PantryItem",
    "PantryAction",
    "ActionType",
    "PantryProposal",
    "PantryUpsertAction",
    "FoodCategory",
    "StorageLocation",
    # Proposals
    "HandoffProposal",
    "HandoffKind",
    "ChatMessage",
    "ChatRole",
    "ReviewEvent",
    "ReviewDecision",
    "IntentClassification",
    "ClarificationRequest",
    "ParsedPantryItem",
    "GeneralChatResponse",
    # Recipe
    "Ingredient",
    "RecipeCard",
    "RecipeCardProposal",
    # Requests
    "ChatIngestRequest",
    "ReceiptIngestRequest",
    "ProductIngestRequest",
    "RecipeIngestRequest",
    "ApplyRequest",
    "ApplyResponse",
    "ChatRequest",
    "WorkflowEventRequest",
]
