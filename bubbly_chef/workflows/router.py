"""
Chat Router + Pantry Ingest workflow using LangGraph.

This is the main conversational interface for the app. It:
1. Classifies user intent (pantry_update, receipt/product/recipe request, general_chat)
2. Routes to appropriate handler
3. For pantry updates: parses, normalizes, and generates proposals
4. For ingest requests: generates handoff instructions
5. For general chat: generates conversational response

Architecture:
- AI-FIRST but SAFE: Never mutates DB directly, always produces proposals
- Human-in-the-loop: Low confidence triggers review step
- Minimal LLM usage: classify + parse only, rest is deterministic
"""

import logging
from collections.abc import AsyncIterator
from datetime import date
from typing import Any
from uuid import uuid4

from langgraph.graph import END, StateGraph
from langgraph.graph.state import CompiledStateGraph

from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.api.deps import get_ai_manager
from bubbly_chef.models.base import (
    Intent,
    NextAction,
    ProposalEnvelope,
    WorkflowStatus,
)
from bubbly_chef.models.pantry import (
    PantryProposal,
)
from bubbly_chef.models.proposals import HandoffKind
from bubbly_chef.models.recipe import RecipeCardProposal
from bubbly_chef.repository.sqlite import get_repository
from bubbly_chef.workflows.chat.nodes import (
    GENERAL_CHAT_SYSTEM_PROMPT,
    GENERAL_CHAT_USER_PROMPT,
    cooking_help_response,
    detect_mode_suggestion,
    format_history_context,
    general_chat_response,
    get_mode_prefix,
)
from bubbly_chef.workflows.pantry.nodes import (
    apply_expiry_heuristics,
    check_for_duplicates,
    create_actions,
    finalize_pantry_proposal,
    normalize_items,
    parse_pantry_items,
    review_gate,
)
from bubbly_chef.workflows.recipe.nodes import (
    brainstorm_recipe_ideas,
    detect_brainstorm_followup,
    extract_recipe_constraints,
    extract_selected_recipe,
    generate_grounded_recipe,
    is_recipe_generation_request,
    research_recipe,
    score_pantry_ingredients,
)
from bubbly_chef.workflows.state import (
    LLMIntentResult,
    WorkflowState,
    create_general_chat_envelope,
    create_handoff_envelope,
    create_pantry_envelope,
    create_recipe_envelope,
)

logger = logging.getLogger(__name__)


# =============================================================================
# LLM Prompts
# =============================================================================

INTENT_CLASSIFICATION_SYSTEM_PROMPT = (
    "You are an intent classifier for a pantry/grocery management app.\n\n"
    "Classify the user's message into ONE of these intents:\n"
    "- pantry_update: User is telling you about groceries they bought, "
    "consumed, or want to add/remove from their pantry\n"
    "- receipt_ingest_request: User mentions scanning, photographing, "
    "or uploading a receipt\n"
    "- product_ingest_request: User mentions scanning a barcode, "
    "photographing a product, or looking up a specific product\n"
    "- recipe_ingest_request: User wants to SAVE, IMPORT, or STORE a "
    "recipe from a URL or text (must have save/import intent)\n"
    "- cooking_help: User asking about cooking, recipes, meal ideas, "
    "food storage, ingredient substitutions, what they can make, "
    "or ANY food/kitchen-related question\n"
    "- general_chat: ONLY for messages truly unrelated to food, cooking, "
    "or the kitchen (e.g. greetings, app questions, small talk)\n\n"
    "IMPORTANT: When in doubt between cooking_help and general_chat, "
    "prefer cooking_help. Any question about food, ingredients, meals, "
    "or cooking should be cooking_help.\n\n"
    "Be accurate. Look for key indicators:\n"
    '- "bought", "got", "purchased", "used", "consumed", "threw away",'
    ' "add", "remove" -> pantry_update\n'
    '- "scanned a receipt", "here\'s my receipt", "receipt photo",'
    ' "uploaded receipt" -> receipt_ingest_request\n'
    '- "scan barcode", "photo of this product", "look up this",'
    ' "what\'s this product" -> product_ingest_request\n'
    '- "save recipe", "import recipe", "add this recipe",'
    " has URL -> recipe_ingest_request\n"
    '- "what can I make", "recipe for", "dinner ideas", "how to cook",'
    ' "meal ideas", "food storage", "how long does X last",'
    ' "substitute for", "what should I eat" -> cooking_help\n'
    "- Everything else -> general_chat"
)

INTENT_CLASSIFICATION_USER_PROMPT = """Classify this message:

"{text}"

Return the intent, confidence (0-1), brief reasoning, and any key entities you detected."""



# =============================================================================
# Graph Nodes
# =============================================================================


def initialize_state(state: WorkflowState) -> WorkflowState:
    """
    Node: Initialize workflow state with IDs and defaults.
    """
    return {
        **state,
        "request_id": state.get("request_id") or str(uuid4()),
        "workflow_id": state.get("workflow_id") or str(uuid4()),
        "warnings": state.get("warnings", []),
        "errors": state.get("errors", []),
        "clarifying_questions": [],
        "parsed_items": [],
        "normalized_items": [],
        "actions": [],
        "confidence": 0.0,
        "field_confidences": {},
        "per_item_confidences": [],
        "requires_review": True,
        "should_interrupt": False,
        "workflow_status": WorkflowStatus.RUNNING.value,
    }


async def classify_intent(state: WorkflowState) -> WorkflowState:
    """
    Node: Use LLM to classify user intent.

    This determines where to route the conversation.
    """
    input_text = state.get("input_text", "")

    if not input_text.strip():
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "intent_confidence": 0.0,
            "errors": state.get("errors", []) + ["Empty input text"],
        }

    # Check for brainstorm follow-up FIRST (before any keyword matching)
    if detect_brainstorm_followup(state):
        selected_name = extract_selected_recipe(
            input_text,
            state.get("conversation_history") or [],
        )
        return {
            **state,
            "intent": Intent.RECIPE_CARD.value,
            "intent_confidence": 0.95,
            "intent_reasoning": "Follow-up to recipe brainstorm",
            "detected_entities": [],
            "selected_recipe_name": selected_name,
        }

    # First try rule-based classification for obvious cases
    text_lower = input_text.lower()

    # Receipt indicators
    receipt_keywords = [
        "receipt",
        "scanned a receipt",
        "uploaded receipt",
        "here's my receipt",
        "receipt photo",
    ]
    if any(kw in text_lower for kw in receipt_keywords):
        return {
            **state,
            "intent": Intent.RECEIPT_INGEST.value,
            "intent_confidence": 0.95,
            "intent_reasoning": "Contains receipt-related keywords",
            "detected_entities": ["receipt"],
        }

    # Product scan indicators
    product_keywords = [
        "barcode",
        "scan this",
        "scanned this product",
        "photo of this",
        "look up this product",
    ]
    if any(kw in text_lower for kw in product_keywords):
        return {
            **state,
            "intent": Intent.PRODUCT_INGEST.value,
            "intent_confidence": 0.95,
            "intent_reasoning": "Contains product scan keywords",
            "detected_entities": ["product"],
        }

    # Check for URL patterns (indicates recipe ingest intent)
    url_patterns = [
        "http://",
        "https://",
        ".com",
        ".org",
        "youtube.com",
        "tiktok.com",
        "instagram.com",
    ]
    has_url = any(p in text_lower for p in url_patterns)

    # Recipe ingest indicators (saving/importing a recipe)
    recipe_ingest_keywords = ["save recipe", "import recipe", "add recipe", "store recipe",
                              "save this recipe", "import this recipe", "save that recipe"]
    if any(kw in text_lower for kw in recipe_ingest_keywords) or has_url:
        return {
            **state,
            "intent": Intent.RECIPE_INGEST.value,
            "intent_confidence": 0.95 if has_url else 0.90,
            "intent_reasoning": "User wants to save/import a recipe",
            "detected_entities": ["recipe"],
        }

    # Cooking help indicators (asking for ideas, not saving)
    cooking_help_keywords = [
        "what can i make",
        "what can i cook",
        "dinner idea",
        "lunch idea",
        "meal idea",
        "recipe for",
        "how to cook",
        "what should i make",
        "suggest a meal",
        "recipes with",
        "use my",
        "with what i have",
        "what's for dinner",
    ]
    if any(kw in text_lower for kw in cooking_help_keywords):
        return {
            **state,
            "intent": Intent.COOKING_HELP.value,
            "intent_confidence": 0.90,
            "intent_reasoning": "User asking for cooking suggestions",
            "detected_entities": [],
        }

    # Generic "recipe" keyword - if no import/save verbs, assume cooking_help
    if "recipe" in text_lower and not any(
        v in text_lower for v in ["save", "import", "add", "store"]
    ):
        return {
            **state,
            "intent": Intent.COOKING_HELP.value,
            "intent_confidence": 0.85,
            "intent_reasoning": "Recipe question without import intent",
            "detected_entities": [],
        }

    # Pantry update indicators (common patterns)
    pantry_keywords = [
        "bought",
        "purchased",
        "got some",
        "picked up",
        "used",
        "consumed",
        "threw away",
        "finished",
        "ran out",
        "add to pantry",
        "remove from pantry",
    ]
    if any(kw in text_lower for kw in pantry_keywords):
        return {
            **state,
            "intent": Intent.PANTRY_UPDATE.value,
            "intent_confidence": 0.90,
            "intent_reasoning": "Contains pantry action keywords",
            "detected_entities": [],  # Will be filled by parse step
        }

    # Fall back to LLM classification for ambiguous cases
    ai_manager = get_ai_manager()
    prompt = (
        INTENT_CLASSIFICATION_SYSTEM_PROMPT
        + "\n\n"
        + INTENT_CLASSIFICATION_USER_PROMPT.format(text=input_text)
    )

    try:
        result = await ai_manager.complete(
            prompt=prompt,
            response_schema=LLMIntentResult,
            temperature=0.1,
        )

        if not isinstance(result, LLMIntentResult):
            return {
                **state,
                "intent": Intent.GENERAL_CHAT.value,
                "intent_confidence": 0.5,
                "intent_reasoning": "Unexpected response type from AI provider",
            }

        # Map LLM intent string to our enum
        intent_mapping = {
            "pantry_update": Intent.PANTRY_UPDATE.value,
            "receipt_ingest_request": Intent.RECEIPT_INGEST.value,
            "product_ingest_request": Intent.PRODUCT_INGEST.value,
            "recipe_ingest_request": Intent.RECIPE_INGEST.value,
            "cooking_help": Intent.COOKING_HELP.value,
            "general_chat": Intent.GENERAL_CHAT.value,
        }

        intent = intent_mapping.get(result.intent.lower(), Intent.GENERAL_CHAT.value)
        logger.info(f"Intent classified: {intent} (confidence: {result.confidence})")

        return {
            **state,
            "intent": intent,
            "intent_confidence": result.confidence,
            "intent_reasoning": result.reasoning,
            "detected_entities": result.entities,
        }

    except NoProviderAvailableError as e:
        logger.error(f"No AI provider available for intent classification: {e}")
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "intent_confidence": 0.0,
            "intent_reasoning": "No AI provider available",
            "errors": state.get("errors", []) + ["no_ai_provider"],
            "warnings": state.get("warnings", []) + [str(e)],
        }
    except Exception as e:
        logger.error(f"Intent classification failed: {e}")
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "intent_confidence": 0.3,
            "intent_reasoning": f"Error: {e}",
            "errors": state.get("errors", []) + [f"Intent classification failed: {e}"],
        }


def route_by_intent(state: WorkflowState) -> str:
    """
    Router: Determine which path to take based on classified intent.

    Returns the name of the next node.
    """
    intent = state.get("intent", Intent.GENERAL_CHAT.value)

    if intent == Intent.PANTRY_UPDATE.value:
        return "parse_pantry_items"
    elif intent == Intent.RECEIPT_INGEST.value:
        return "build_handoff_receipt"
    elif intent == Intent.PRODUCT_INGEST.value:
        return "build_handoff_product"
    elif intent == Intent.RECIPE_INGEST.value:
        return "build_handoff_recipe"
    elif intent == Intent.COOKING_HELP.value:
        if is_recipe_generation_request(state):
            return "extract_recipe_constraints"
        return "cooking_help_response"
    elif intent == Intent.RECIPE_CARD.value:
        if state.get("selected_recipe_name"):
            return "research_recipe"
        return "cooking_help_response"  # fallback
    else:
        return "general_chat_response"




def build_handoff_receipt(state: WorkflowState) -> WorkflowState:
    """
    Node: Build handoff response for receipt ingest request.
    """
    return {
        **state,
        "intent": Intent.RECEIPT_INGEST.value,
        "assistant_message": (
            "I can help you add items from a receipt!"
            " Please upload a photo of your receipt,"
            " or paste the text from it."
        ),
        "next_action": NextAction.REQUEST_RECEIPT_IMAGE.value,
        "proposal": None,  # Will be built in finalize
        "requires_review": False,
        "workflow_status": WorkflowStatus.AWAITING_INPUT.value,
    }


def build_handoff_product(state: WorkflowState) -> WorkflowState:
    """
    Node: Build handoff response for product ingest request.
    """
    return {
        **state,
        "intent": Intent.PRODUCT_INGEST.value,
        "assistant_message": (
            "I can help you add a product!"
            " Please scan the barcode or take a photo of the product."
        ),
        "next_action": NextAction.REQUEST_PRODUCT_BARCODE.value,
        "proposal": None,
        "requires_review": False,
        "workflow_status": WorkflowStatus.AWAITING_INPUT.value,
    }


def build_handoff_recipe(state: WorkflowState) -> WorkflowState:
    """
    Node: Build handoff response for recipe ingest request.
    """
    return {
        **state,
        "intent": Intent.RECIPE_INGEST.value,
        "assistant_message": (
            "I can help you save a recipe!"
            " Please share the recipe URL or paste the recipe text."
        ),
        "next_action": NextAction.REQUEST_RECIPE_TEXT.value,
        "proposal": None,
        "requires_review": False,
        "workflow_status": WorkflowStatus.AWAITING_INPUT.value,
    }




# =============================================================================
# Graph Construction
# =============================================================================


def build_chat_router_graph() -> StateGraph[WorkflowState]:
    """
    Build the ChatRouterGraph workflow.

    Flow:
    1. initialize_state: Set up IDs and defaults
    2. classify_intent: Determine what the user wants
    3. Route based on intent:
       - pantry_update: parse -> normalize -> expiry -> dedup -> actions -> review_gate -> finalize
       - receipt/product/recipe: build_handoff_*
       - cooking_help (recipe gen): extract_constraints -> score_pantry -> brainstorm -> END
       - recipe_card (brainstorm follow-up): research_recipe -> generate_grounded_recipe -> END
       - general_chat: generate response
    """
    workflow = StateGraph(WorkflowState)

    # Add all nodes
    workflow.add_node("initialize", initialize_state)
    workflow.add_node("classify_intent", classify_intent)

    # Pantry update path
    workflow.add_node("parse_pantry_items", parse_pantry_items)
    workflow.add_node("normalize", normalize_items)
    workflow.add_node("expiry", apply_expiry_heuristics)
    workflow.add_node("dedup_check", check_for_duplicates)
    workflow.add_node("create_actions", create_actions)
    workflow.add_node("review_gate", review_gate)
    workflow.add_node("finalize_pantry", finalize_pantry_proposal)

    # Handoff paths
    workflow.add_node("build_handoff_receipt", build_handoff_receipt)
    workflow.add_node("build_handoff_product", build_handoff_product)
    workflow.add_node("build_handoff_recipe", build_handoff_recipe)

    # General chat path
    workflow.add_node("general_chat_response", general_chat_response)

    # Cooking help path
    workflow.add_node("cooking_help_response", cooking_help_response)

    # Recipe grounding path (brainstorm)
    workflow.add_node("extract_recipe_constraints", extract_recipe_constraints)
    workflow.add_node("score_pantry", score_pantry_ingredients)
    workflow.add_node("brainstorm_recipes", brainstorm_recipe_ideas)

    # Recipe grounding path (grounded generation — brainstorm follow-up)
    workflow.add_node("research_recipe", research_recipe)
    workflow.add_node("generate_grounded_recipe", generate_grounded_recipe)

    # Set entry point
    workflow.set_entry_point("initialize")

    # Define edges
    workflow.add_edge("initialize", "classify_intent")

    # Conditional routing from classify_intent
    workflow.add_conditional_edges(
        "classify_intent",
        route_by_intent,
        {
            "parse_pantry_items": "parse_pantry_items",
            "build_handoff_receipt": "build_handoff_receipt",
            "build_handoff_product": "build_handoff_product",
            "build_handoff_recipe": "build_handoff_recipe",
            "cooking_help_response": "cooking_help_response",
            "general_chat_response": "general_chat_response",
            "extract_recipe_constraints": "extract_recipe_constraints",
            "research_recipe": "research_recipe",
        },
    )

    # Pantry update path edges
    workflow.add_edge("parse_pantry_items", "normalize")
    workflow.add_edge("normalize", "expiry")
    workflow.add_edge("expiry", "dedup_check")
    workflow.add_edge("dedup_check", "create_actions")
    workflow.add_edge("create_actions", "review_gate")
    workflow.add_edge("review_gate", "finalize_pantry")
    workflow.add_edge("finalize_pantry", END)

    # Handoff paths go directly to END
    workflow.add_edge("build_handoff_receipt", END)
    workflow.add_edge("build_handoff_product", END)
    workflow.add_edge("build_handoff_recipe", END)

    # General chat goes to END
    workflow.add_edge("general_chat_response", END)

    # Cooking help goes to END
    workflow.add_edge("cooking_help_response", END)

    # Brainstorm path edges
    workflow.add_edge("extract_recipe_constraints", "score_pantry")
    workflow.add_edge("score_pantry", "brainstorm_recipes")
    workflow.add_edge("brainstorm_recipes", END)

    # Grounded generation path edges
    workflow.add_edge("research_recipe", "generate_grounded_recipe")
    workflow.add_edge("generate_grounded_recipe", END)

    return workflow


# Compiled graph (singleton)
_chat_router_graph = None


def get_chat_router_graph() -> CompiledStateGraph[Any, Any, Any, Any]:
    """Get or create the compiled chat router graph."""
    global _chat_router_graph
    if _chat_router_graph is None:
        _chat_router_graph = build_chat_router_graph().compile()
    return _chat_router_graph


# =============================================================================
# Public API
# =============================================================================


async def run_chat_workflow(
    message: str,
    conversation_id: str | None = None,
    mode: str = "text",
    pantry_snapshot: list[dict[str, Any]] | None = None,
    history: list[dict[str, Any]] | None = None,
) -> ProposalEnvelope[Any]:
    """
    Run the chat router workflow and return a ProposalEnvelope.

    This is the main entry point for the /v1/chat endpoint.

    Args:
        message: User's message text
        conversation_id: Optional conversation thread ID
        mode: "text" or "voice"
        pantry_snapshot: Optional current pantry for dedup
        history: Prior conversation turns [{role, content, intent, created_at}]

    Returns:
        ProposalEnvelope with appropriate proposal type based on intent
    """
    graph = get_chat_router_graph()

    # Initialize state
    initial_state: WorkflowState = {
        "request_id": str(uuid4()),
        "workflow_id": str(uuid4()),
        "conversation_id": conversation_id,
        "input_text": message,
        "input_type": "chat",
        "input_mode": mode,
        "pantry_snapshot": pantry_snapshot,
        "conversation_history": history or [],
        "warnings": [],
        "errors": [],
    }

    # Run the graph
    final_state = await graph.ainvoke(initial_state)

    # Build appropriate envelope based on intent
    intent = final_state.get("intent", Intent.GENERAL_CHAT.value)

    if intent == Intent.PANTRY_UPDATE.value:
        proposal = final_state.get("proposal")
        if proposal is None:
            proposal = PantryProposal(actions=[], source_text=message)

        return create_pantry_envelope(
            proposal=proposal,
            confidence=final_state.get("confidence", 0.0),
            field_confidences=final_state.get("field_confidences", {}),
            warnings=final_state.get("warnings", []),
            errors=final_state.get("errors", []),
            assistant_message=final_state.get("assistant_message", ""),
            next_action=NextAction(final_state.get("next_action", NextAction.NONE.value)),
            request_id=final_state.get("request_id"),
            workflow_id=final_state.get("workflow_id"),
            conversation_id=final_state.get("conversation_id"),
            clarifying_questions=final_state.get("clarifying_questions", []),
            per_item_confidences=final_state.get("per_item_confidences", []),
        )

    elif intent == Intent.RECEIPT_INGEST.value:
        return create_handoff_envelope(
            handoff_kind=HandoffKind.RECEIPT,
            assistant_message=final_state.get("assistant_message", ""),
            next_action=NextAction.REQUEST_RECEIPT_IMAGE,
            instructions="Upload a photo of your receipt or paste the text.",
            required_inputs=["receipt_image"],
            optional_inputs=["store_name", "purchase_date"],
            request_id=final_state.get("request_id"),
            workflow_id=final_state.get("workflow_id"),
            conversation_id=final_state.get("conversation_id"),
        )

    elif intent == Intent.PRODUCT_INGEST.value:
        return create_handoff_envelope(
            handoff_kind=HandoffKind.PRODUCT,
            assistant_message=final_state.get("assistant_message", ""),
            next_action=NextAction.REQUEST_PRODUCT_BARCODE,
            instructions="Scan the product barcode or take a photo.",
            required_inputs=["barcode"],
            optional_inputs=["product_photo", "description"],
            request_id=final_state.get("request_id"),
            workflow_id=final_state.get("workflow_id"),
            conversation_id=final_state.get("conversation_id"),
        )

    elif intent == Intent.RECIPE_INGEST.value:
        return create_handoff_envelope(
            handoff_kind=HandoffKind.RECIPE,
            assistant_message=final_state.get("assistant_message", ""),
            next_action=NextAction.REQUEST_RECIPE_TEXT,
            instructions="Share the recipe URL or paste the recipe text.",
            required_inputs=["recipe_url", "recipe_text"],
            optional_inputs=["title"],
            request_id=final_state.get("request_id"),
            workflow_id=final_state.get("workflow_id"),
            conversation_id=final_state.get("conversation_id"),
        )

    elif intent == Intent.RECIPE_CARD.value:
        proposal = final_state.get("proposal")
        if isinstance(proposal, RecipeCardProposal):
            recipe_env = create_recipe_envelope(
                proposal=proposal,
                confidence=final_state.get("confidence", 0.5),
                field_confidences=final_state.get("field_confidences", {}),
                warnings=final_state.get("warnings", []),
                errors=final_state.get("errors", []),
                assistant_message=final_state.get("assistant_message", ""),
                request_id=final_state.get("request_id"),
                workflow_id=final_state.get("workflow_id"),
            )
            recipe_env.metadata["ingredient_availability"] = final_state.get(
                "ingredient_availability", []
            )
            recipe_env.suggested_mode = final_state.get("suggested_mode")
            return recipe_env
        # Fallback if proposal wasn't built
        return create_general_chat_envelope(
            assistant_message=final_state.get("assistant_message", "I'm here to help!"),
            intent=Intent.GENERAL_CHAT,
            request_id=final_state.get("request_id"),
            workflow_id=final_state.get("workflow_id"),
            conversation_id=final_state.get("conversation_id"),
        )

    else:  # general_chat, cooking_help, recipe_brainstorm — all return plain text envelope
        envelope = create_general_chat_envelope(
            assistant_message=final_state.get("assistant_message", "I'm here to help!"),
            intent=Intent(intent),
            request_id=final_state.get("request_id"),
            workflow_id=final_state.get("workflow_id"),
            conversation_id=final_state.get("conversation_id"),
        )
        envelope.suggested_mode = final_state.get("suggested_mode")
        envelope.suggested_action = final_state.get("suggested_action")
        return envelope


# =============================================================================
# Streaming API
# =============================================================================


def _build_envelope_from_state(
    final_state: dict[str, Any],
    message: str,
    conversation_id: str | None,
) -> "ProposalEnvelope[Any]":
    """Build the appropriate ProposalEnvelope from final workflow state."""
    intent = final_state.get("intent", Intent.GENERAL_CHAT.value)

    if intent == Intent.PANTRY_UPDATE.value:
        proposal = final_state.get("proposal")
        if proposal is None:
            proposal = PantryProposal(actions=[], source_text=message)
        envelope: ProposalEnvelope[Any] = create_pantry_envelope(
            proposal=proposal,
            confidence=final_state.get("confidence", 0.0),
            field_confidences=final_state.get("field_confidences", {}),
            warnings=final_state.get("warnings", []),
            errors=final_state.get("errors", []),
            assistant_message=final_state.get("assistant_message", ""),
            next_action=NextAction(final_state.get("next_action", NextAction.NONE.value)),
            request_id=final_state.get("request_id"),
            workflow_id=final_state.get("workflow_id"),
            conversation_id=final_state.get("conversation_id"),
            clarifying_questions=final_state.get("clarifying_questions", []),
            per_item_confidences=final_state.get("per_item_confidences", []),
        )
    elif intent == Intent.RECEIPT_INGEST.value:
        envelope = create_handoff_envelope(
            handoff_kind=HandoffKind.RECEIPT,
            assistant_message=final_state.get("assistant_message", ""),
            next_action=NextAction.REQUEST_RECEIPT_IMAGE,
            instructions="Upload a photo of your receipt or paste the text.",
            required_inputs=["receipt_image"],
            optional_inputs=["store_name", "purchase_date"],
            request_id=final_state.get("request_id"),
            workflow_id=final_state.get("workflow_id"),
            conversation_id=final_state.get("conversation_id"),
        )
    elif intent == Intent.PRODUCT_INGEST.value:
        envelope = create_handoff_envelope(
            handoff_kind=HandoffKind.PRODUCT,
            assistant_message=final_state.get("assistant_message", ""),
            next_action=NextAction.REQUEST_PRODUCT_BARCODE,
            instructions="Scan the product barcode or take a photo.",
            required_inputs=["barcode"],
            optional_inputs=["product_photo", "description"],
            request_id=final_state.get("request_id"),
            workflow_id=final_state.get("workflow_id"),
            conversation_id=final_state.get("conversation_id"),
        )
    elif intent == Intent.RECIPE_INGEST.value:
        envelope = create_handoff_envelope(
            handoff_kind=HandoffKind.RECIPE,
            assistant_message=final_state.get("assistant_message", ""),
            next_action=NextAction.REQUEST_RECIPE_TEXT,
            instructions="Share the recipe URL or paste the recipe text.",
            required_inputs=["recipe_url", "recipe_text"],
            optional_inputs=["title"],
            request_id=final_state.get("request_id"),
            workflow_id=final_state.get("workflow_id"),
            conversation_id=final_state.get("conversation_id"),
        )
    elif intent == Intent.RECIPE_CARD.value:
        proposal = final_state.get("proposal")
        if isinstance(proposal, RecipeCardProposal):
            env: ProposalEnvelope[Any] = create_recipe_envelope(
                proposal=proposal,
                confidence=final_state.get("confidence", 0.5),
                field_confidences=final_state.get("field_confidences", {}),
                warnings=final_state.get("warnings", []),
                errors=final_state.get("errors", []),
                assistant_message=final_state.get("assistant_message", ""),
                request_id=final_state.get("request_id"),
                workflow_id=final_state.get("workflow_id"),
            )
            env.metadata["ingredient_availability"] = final_state.get(
                "ingredient_availability", []
            )
            env.suggested_mode = final_state.get("suggested_mode")
            return env
        envelope_fallback: ProposalEnvelope[Any] = create_general_chat_envelope(
            assistant_message=final_state.get("assistant_message", "I'm here to help!"),
            intent=Intent.GENERAL_CHAT,
            request_id=final_state.get("request_id"),
            workflow_id=final_state.get("workflow_id"),
            conversation_id=final_state.get("conversation_id"),
        )
        envelope_fallback.suggested_mode = final_state.get("suggested_mode")
        return envelope_fallback
    else:
        envelope = create_general_chat_envelope(
            assistant_message=final_state.get("assistant_message", "I'm here to help!"),
            intent=Intent(intent),
            request_id=final_state.get("request_id"),
            workflow_id=final_state.get("workflow_id"),
            conversation_id=final_state.get("conversation_id"),
        )

    envelope.suggested_mode = final_state.get("suggested_mode")
    return envelope


async def run_chat_workflow_streaming(
    message: str,
    conversation_id: str | None = None,
    mode: str = "text",
    pantry_snapshot: list[dict[str, Any]] | None = None,
    history: list[dict[str, Any]] | None = None,
) -> AsyncIterator[str]:
    """
    Streaming variant of run_chat_workflow.

    For streamable intents (general_chat, cooking_help): streams tokens then
    yields a final envelope JSON.  For all other intents: runs the full
    LangGraph workflow and yields the envelope as a single chunk.

    Yields JSON-encoded strings, each representing an SSE event payload:
      {"type": "token", "content": "..."}
      {"type": "done"}
      {"type": "envelope", "data": {...}}
    """
    import json as _json

    graph = get_chat_router_graph()

    initial_state: WorkflowState = {
        "request_id": str(uuid4()),
        "workflow_id": str(uuid4()),
        "conversation_id": conversation_id,
        "input_text": message,
        "input_type": "chat",
        "input_mode": mode,
        "pantry_snapshot": pantry_snapshot,
        "conversation_history": history or [],
        "warnings": [],
        "errors": [],
    }

    # Run initialization + intent classification (fast, deterministic)
    init_state = initialize_state(initial_state)
    classified_state = await classify_intent(init_state)
    intent = classified_state.get("intent", Intent.GENERAL_CHAT.value)
    input_mode = mode  # alias used below

    logger.info(
        "Stream: intent classified",
        extra={
            "intent": intent,
            "confidence": classified_state.get("intent_confidence"),
            "reasoning": classified_state.get("intent_reasoning"),
            "mode": input_mode,
            "message_preview": message[:80],
        },
    )

    # Only stream for free-text intents
    streamable_intents = {
        Intent.GENERAL_CHAT.value,
        Intent.COOKING_HELP.value,
        Intent.RECIPE_BRAINSTORM.value,
    }
    if intent == Intent.COOKING_HELP.value and input_mode == "recipe":
        intent = Intent.COOKING_HELP.value  # keep intent but force non-streamable path
        logger.info("Recipe mode: routing cooking_help through grounded recipe generation")
        final_state = await graph.ainvoke(initial_state)
        env = _build_envelope_from_state(final_state, message, conversation_id)
        yield _json.dumps({"type": "envelope", "data": env.model_dump(mode="json")})
        return

    if intent not in streamable_intents:
        # Non-streamable: run full workflow, yield single envelope
        final_state = await graph.ainvoke(initial_state)
        env = _build_envelope_from_state(final_state, message, conversation_id)
        yield _json.dumps({"type": "envelope", "data": env.model_dump(mode="json")})
        return

    # ── Streamable intent: build prompt and stream tokens ──
    ai_manager = get_ai_manager()

    # Build the same prompt the node functions would use
    pantry_context = ""
    try:
        repo = await get_repository()
        items = await repo.get_all_pantry_items()
        if items:
            if intent == Intent.COOKING_HELP.value:
                expiring = [
                    it for it in items
                    if it.expiry_date and (it.expiry_date - date.today()).days <= 3
                ]
                pantry_lines = [f"- {it.name} ({it.quantity} {it.unit})" for it in items]
                pantry_context = (
                    f"\n\nThe user's pantry currently has {len(items)} items:\n"
                    + "\n".join(pantry_lines[:30])
                )
                if len(items) > 30:
                    pantry_context += f"\n... and {len(items) - 30} more items"
                if expiring:
                    exp_names = ", ".join(it.name for it in expiring)
                    pantry_context += f"\n\nEXPIRING SOON (use first!): {exp_names}"
            else:
                names = [it.name for it in items[:20]]
                pantry_context = (
                    f"\n\nThe user has {len(items)} pantry items"
                    f" including: {', '.join(names)}."
                )
    except Exception:
        pass  # non-critical

    mode_prefix = get_mode_prefix(classified_state)
    history_context = format_history_context(classified_state)

    if intent == Intent.COOKING_HELP.value:
        system = (
            "You are a friendly cooking assistant for BubblyChef, "
            "a pantry-aware recipe app.\n\n"
            "Help the user with:\n"
            "- Cooking techniques and how-to questions\n"
            "- Meal ideas and recipe suggestions based on what they have\n"
            "- Ingredient substitutions\n"
            "- Food storage tips\n"
            "- General culinary advice\n\n"
            "When suggesting meals or recipes, prioritize ingredients the user "
            "already has in their pantry (listed below). If items are expiring soon, "
            "suggest ways to use them first.\n\n"
            "Keep responses friendly, concise, and practical."
        )
        user_prompt = f"\n\nUser: {message}\n\nRespond helpfully and concisely."
    else:
        system = GENERAL_CHAT_SYSTEM_PROMPT
        user_prompt = GENERAL_CHAT_USER_PROMPT.format(text=message)

    prompt = mode_prefix + system + pantry_context + "\n\n" + history_context + user_prompt

    # Stream tokens
    collected_text = ""

    try:
        async for token in ai_manager.stream_complete(prompt=prompt, temperature=0.7):
            collected_text += token
            yield _json.dumps({"type": "token", "content": token})
    except NoProviderAvailableError:
        collected_text = (
            "No AI provider is configured. "
            "Please add a Gemini API key or start Ollama."
        )
        yield _json.dumps({"type": "token", "content": collected_text})
    except Exception as e:
        logger.error(f"Streaming error: {e}")
        collected_text = "Sorry, I ran into an error. Please try again."
        yield _json.dumps({"type": "token", "content": collected_text})

    # Detect mode suggestion from collected text
    suggested_mode = detect_mode_suggestion(collected_text, mode)

    # Build final envelope
    envelope = create_general_chat_envelope(
        assistant_message=collected_text,
        intent=Intent(intent) if intent in (
            Intent.GENERAL_CHAT.value, Intent.COOKING_HELP.value, Intent.RECIPE_BRAINSTORM.value
        ) else Intent.GENERAL_CHAT,
        request_id=classified_state.get("request_id"),
        workflow_id=classified_state.get("workflow_id"),
        conversation_id=conversation_id,
    )
    envelope.suggested_mode = suggested_mode

    yield _json.dumps({"type": "done"})
    yield _json.dumps({"type": "envelope", "data": envelope.model_dump(mode="json")})


# =============================================================================
# Legacy API (backward compatibility)
# =============================================================================


async def run_chat_ingest(text: str) -> ProposalEnvelope[PantryProposal]:
    """
    Legacy API for chat ingest.

    This maintains backward compatibility with the old ingest endpoint.
    For new code, use run_chat_workflow() instead.
    """
    envelope = await run_chat_workflow(message=text)

    # For legacy API, always return PantryProposal envelope
    if envelope.intent == Intent.PANTRY_UPDATE:
        return envelope

    # For other intents, return empty proposal
    return create_pantry_envelope(
        proposal=PantryProposal(actions=[], source_text=text),
        confidence=0.0,
        field_confidences={},
        warnings=[f"Non-pantry intent detected: {envelope.intent}"],
        errors=[],
        assistant_message=envelope.assistant_message,
    )
