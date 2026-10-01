"""Shared workflow state and utilities."""

from typing import Any, TypedDict

from bubbly_chef.models.meal import MealPlanSessionState
from bubbly_chef.models.pantry import PantryUpsertAction
from bubbly_chef.models.proposals import ProposalUnion
from bubbly_chef.models.recipe import RecipeCard

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
    create_cooking_help_envelope,
    create_general_chat_envelope,
    create_handoff_envelope,
    create_meal_options_envelope,
    create_meal_proposal_envelope,
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
    "create_cooking_help_envelope",
    "create_general_chat_envelope",
    "create_handoff_envelope",
    "create_meal_options_envelope",
    "create_meal_proposal_envelope",
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
    # Remaining wall-clock seconds the LLM parse leg may spend (issue #481).
    # None = unbounded (legacy callers); <= 0 = budget already exhausted, skip.
    parse_timeout_seconds: float | None
    input_mode: str  # "text" or "voice"
    pantry_snapshot: list[dict[str, Any]] | None
    context: dict[str, Any] | None  # Client-supplied context, e.g. {"cooking_recipe": {...}}
    conversation_history: list[dict[str, Any]]  # Prior turns [{role, content, intent}]
    # Deterministic intent override from an explicit UI action (chip tap).
    # When present, classify_intent skips the LLM and uses this directly.
    # Extension point for [Edit this recipe] / [Start over] chips (#416).
    forced_intent: str | None

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
    proposal: ProposalUnion | None
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
    # True only when classify_intent resolved a pinned-session turn to a DIFFERENT
    # already-offered idea; dispatch builds a new card instead of refining.
    repick_different_idea: bool
    # Issue #846. True only when classify_intent read a typed message as a change to the
    # meal (or the options) already on screen ("something quicker, no butter"); the meal
    # option stage then inherits the retained constraints and servings, the way a pill
    # tap does, and applies this turn's change on top. Per-turn, never persisted.
    meal_refinement: bool
    # Issue #544. `constraints_extracted` is set by extract_recipe_constraints
    # (the direct card path) so research_recipe knows extract already combined
    # the stored diet with this turn's message; `dietary_set_aside` is the
    # stored diets research_recipe found not covered by the final diet, stamped
    # onto the card as `diets_set_aside`. Both are per-turn, never persisted.
    constraints_extracted: bool
    dietary_set_aside: list[str]
    # Issue #685, all per-turn and never persisted as such. Written by
    # extract_recipe_constraints (research_recipe writes the first and last on
    # the pick path): `session_dietary` is the conversation's diet before this
    # turn's check, `fresh_dietary` the diet this turn's message named, and
    # `stored_dietary` the profile diet read this turn. research_recipe uses them
    # for `diets_set_aside`; `constraints_to_persist` uses them to decide what the
    # session remembers.
    session_dietary: list[str]
    fresh_dietary: list[str]
    stored_dietary: list[str]
    # Issue #500, per-turn and never persisted. Written by extract_recipe_constraints
    # (research_recipe writes them on the pick path): `profile_allergies` is what the
    # post-generation guard enforces, `dislikes_set_aside` the profile dislikes this
    # message explicitly asked for (stamped onto the card as `exclusions_set_aside`),
    # `profile_excluded` the `excluded_ingredients` entries that came from the profile
    # so `constraints_to_persist` doesn't write them into the session.
    profile_allergies: list[str]
    dislikes_set_aside: list[str]
    profile_excluded: list[str]
    # Issue #502, per-turn and never persisted: the profile's expiry priority
    # ("off" | "gentle" | "aggressive"), read once by extract_recipe_constraints
    # (research_recipe on the pick path) and used by scoring, brainstorm and the
    # recipe-card prompt. Unset means "read the profile", and Gentle if that fails.
    expiry_priority: str
    # Issue #687. `diet_change_mentioned` is the classifier's flag that the message
    # talks about dropping a diet; route_by_intent sends a flagged general_chat /
    # cooking_help turn to apply_diet_change. That node sets `diet_change_applied`
    # when the structured extraction really changed something (else the turn falls
    # back to the ordinary chat reply) and hands the session's remaining constraints
    # to update_session_node as `diet_change_constraints` after a conversation-scope
    # removal. All per-turn, never persisted as such.
    diet_change_mentioned: bool
    diet_change_applied: bool
    # The diet sentence of a flagged turn the extraction acted on; the general_chat or
    # cooking_help reply that follows prepends it.
    diet_change_notice: str
    diet_change_constraints: dict[str, Any] | None
    web_search_result: dict[str, Any] | None
    ingredient_availability: list[dict[str, Any]]

    # ==========================================================================
    # Meal plan (issue #650) -- the option stage's output, read by
    # update_session_node to retain it in session.metadata.meal_plan (next to
    # brainstorm_ideas) for the pick turn.
    # ==========================================================================
    meal_plan_session_state: MealPlanSessionState | None
    # Predicted follow-up pills for a meal reply (issue #651) -- 0-4 cleaned
    # strings, set by meal_options_stage/meal_pick_stage on every successful
    # return and read by the envelope builders into
    # metadata["follow_up_suggestions"]. Unset (not just []) on every
    # non-meal turn and on the degraded general_chat fallbacks.
    meal_follow_ups: list[str]

    # ==========================================================================
    # Saved-recipe lookup
    # ==========================================================================
    # Raw match rows from `repo.search_saved_recipes` (source-of-truth dicts,
    # not RecipeCard) — surfaced verbatim to the envelope's
    # metadata["saved_recipe_matches"] and read by update_session_node to pin
    # a single unambiguous match.
    saved_recipe_matches: list[dict[str, Any]]
    # Saved (non-draft) meals the same lookup matched (issue #760), surfaced to
    # metadata["saved_meal_matches"]: {id, title, description, servings,
    # dishes: [{role, position, recipe_id, title}]}.
    saved_meal_matches: list[dict[str, Any]]

    # ==========================================================================
    # Response Fields
    # ==========================================================================
    assistant_message: str
    next_action: str  # NextAction enum value
    # The two one-tap choices for a CONFIRM_CHOICE turn (#416 Q5). Each is
    # {"label": str, "forced_intent": str} so the frontend can render buttons
    # that POST forced_intent back. Empty on every non-confirm turn.
    confirm_options: list[dict[str, str]]

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
    # Set by classify_intent when its own AI call fails with
    # NoProviderAvailableError (issue #514) — lets the "no_ai_provider"
    # shortcut in general_chat_response pick the right user-facing message
    # without re-attempting the AI call.
    ai_failure_kind: str | None
    ai_failure_configured: bool

    # ==========================================================================
    # Workflow Control
    # ==========================================================================
    workflow_status: str  # WorkflowStatus enum value
    should_interrupt: bool
    suggested_mode: str | None  # Mode switch hint for the frontend
    suggested_action: str | None  # Next action hint (e.g. 'pick_recipe')
