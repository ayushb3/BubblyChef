"""Shared workflow state and utilities."""

from typing import Any, TypedDict

from bubbly_chef.models.pantry import (
    PantryProposal,
    PantryUpsertAction,
)
from bubbly_chef.models.proposals import (
    HandoffProposal,
)
from bubbly_chef.models.recipe import RecipeCard, RecipeCardProposal

# ---------------------------------------------------------------------------
# Re-exports from shared_state for backward compatibility.
# All new code should import directly from shared_state.
# ---------------------------------------------------------------------------
from bubbly_chef.workflows.shared_state import (  # noqa: F401
    ChatSubState,
    LLMClarificationResult,
    LLMGeneralChatResult,
    LLMIntentResult,
    LLMParsedItem,
    LLMParseResult,
    LLMRecipeResult,
    PantrySubState,
    PendingProposalMemory,
    RecipeSubState,
    TermSuggestion,
    create_general_chat_envelope,
    create_handoff_envelope,
    create_pantry_envelope,
    create_recipe_envelope,
    map_action_type,
    map_category,
)

__all__ = [
    "ChatSubState",
    "LLMClarificationResult",
    "LLMGeneralChatResult",
    "LLMIntentResult",
    "LLMParsedItem",
    "LLMParseResult",
    "LLMRecipeResult",
    "PantrySubState",
    "PendingProposalMemory",
    "RecipeSubState",
    "TermSuggestion",
    "WorkflowState",
    "create_general_chat_envelope",
    "create_handoff_envelope",
    "create_pantry_envelope",
    "create_recipe_envelope",
    "map_action_type",
    "map_category",
]


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
    user_id: str | None  # Supabase auth user ID, needed for repo calls

    # ==========================================================================
    # Session (R2)
    # ==========================================================================
    session: dict[str, Any] | None
    session_mode: str | None
    _exit_mode: bool  # Signal to reset session on exit phrase

    # ==========================================================================
    # Input
    # ==========================================================================
    input_text: str
    input_type: str  # "chat", "receipt", "product", "recipe"
    input_mode: str  # "text" or "voice"
    pantry_snapshot: list[dict[str, Any]] | None
    context: dict[str, Any] | None  # Client-supplied context, e.g. {"cooking_recipe": {...}}
    conversation_history: list[dict[str, Any]]  # Prior turns [{role, content, intent}]

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
    proposal: PantryProposal | HandoffProposal | RecipeCardProposal | None
    # Category-level words ("veggies", "dairy stuff") the user mentioned that
    # were deliberately excluded from `actions` — too vague to write to the
    # pantry as a literal item name. Surfaced as a clarifying question instead.
    generic_pantry_terms: list[str]
    # Per-term concrete suggestions ({"term": "veggies", "suggestions": [...]})
    # for the clarification card — populated only when generic_pantry_terms
    # is non-empty. See pantry.nodes.suggest_specifics.
    clarification_suggestions: list[dict[str, Any]]

    # ==========================================================================
    # Recipe-specific
    # ==========================================================================
    recipe: RecipeCard | None

    # ==========================================================================
    # Recipe Grounding (brainstorm + grounded generation)
    # ==========================================================================
    recipe_constraints: dict[str, Any] | None
    scored_pantry_items: list[dict[str, Any]]
    brainstorm_ideas: list[str]
    selected_recipe_name: str | None
    web_search_result: dict[str, Any] | None
    ingredient_availability: list[dict[str, Any]]

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
    suggested_mode: str | None  # Mode switch hint for the frontend
    suggested_action: str | None  # Next action hint (e.g. 'pick_recipe')
