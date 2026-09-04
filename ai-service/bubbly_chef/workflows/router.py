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
import re
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta
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
from bubbly_chef.models.session import SessionMode
from bubbly_chef.repository.supabase_repo import SupabaseRepository, get_repository
from bubbly_chef.services.recipe_url_ingestor import ingest_recipe_from_url
from bubbly_chef.workflows.chat.nodes import (
    COOKING_RECIPE_ID_KEY,
    COOKING_RECIPE_KEY,
    GENERAL_CHAT_SYSTEM_PROMPT,
    GENERAL_CHAT_USER_PROMPT,
    cooking_help_response,
    detect_mode_suggestion,
    format_cooking_recipe_context,
    format_history_context,
    general_chat_response,
    get_mode_prefix,
    normalize_cooking_recipe,
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

_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)


def _extract_url(text: str) -> str | None:
    m = _URL_RE.search(text)
    return m.group(0) if m else None


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
    "- recipe_brainstorm: User asks open-ended 'what can I make?' style "
    "questions — brainstorm ideas from pantry, 'recipe suggestions', "
    "'what should I cook tonight?'\n"
    "- recipe_generation: User wants a SPECIFIC recipe MADE for them — "
    "meal ideas, dinner suggestions, 'give me a recipe for X', "
    "'recipe for X', 'what's for dinner'\n"
    "- recipe_card: User is selecting or refining a specific recipe from "
    "a prior brainstorm — 'make me the pasta one', 'no cheese', 'less salt'\n"
    "- cooking_help: User asking HOW-TO questions about cooking — "
    "techniques, food storage, substitutions, temperatures, "
    "cooking times (NOT recipe requests)\n"
    "- general_chat: ONLY for messages truly unrelated to food, cooking, "
    "or the kitchen (e.g. greetings, app questions, small talk)\n\n"
    "IMPORTANT: Distinguish recipe_brainstorm from recipe_generation:\n"
    "- 'what can I make with what I have?' → recipe_brainstorm\n"
    "- 'give me a pasta recipe' → recipe_generation\n"
    "- 'dinner ideas' → recipe_brainstorm\n"
    "- 'recipe for chicken tikka masala' → recipe_generation\n\n"
    "IMPORTANT: Distinguish recipe_generation from cooking_help:\n"
    "- 'give me a pasta recipe' → recipe_generation\n"
    "- 'how do I cook pasta?' → cooking_help\n"
    "- 'how long does chicken last?' → cooking_help\n\n"
    "Be accurate. Look for key indicators:\n"
    '- "bought", "got", "purchased", "used", "consumed", "threw away",'
    ' "add", "remove" -> pantry_update\n'
    '- "scanned a receipt", "here\'s my receipt", "receipt photo",'
    ' "uploaded receipt" -> receipt_ingest_request\n'
    '- "scan barcode", "photo of this product", "look up this",'
    ' "what\'s this product" -> product_ingest_request\n'
    '- "save recipe", "import recipe", "add this recipe",'
    " has URL -> recipe_ingest_request\n"
    '- "what can I make", "recipe ideas", "what should I cook",'
    ' "suggestions" -> recipe_brainstorm\n'
    '- "give me a recipe", "recipe for", "meal ideas",'
    ' "make me something", "suggest a meal" -> recipe_generation\n'
    '- "no X", "less X", "without X", "make it more X"'
    " (in context of prior recipe) -> recipe_card\n"
    '- "how to cook", "how long does X last", "substitute for",'
    ' "food storage", "what temperature" -> cooking_help\n'
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


# Session staleness threshold (reset to default if idle too long)
SESSION_STALE_MINUTES = 30

# Exit phrases that break out of any non-default session mode
EXIT_PHRASES = {
    "exit", "stop", "quit", "cancel", "go back", "never mind", "nevermind",
    "done", "back", "end", "leave",
}


def _merge_dedup_case_insensitive(existing: list[str], new: list[str]) -> list[str]:
    """Append `new` names onto `existing`, skipping case-insensitive repeats.

    Preserves `existing`'s order and casing; a name already present (in any
    case) is not re-added.
    """
    merged = list(existing)
    seen = {name.lower() for name in merged}
    for name in new:
        if name.lower() not in seen:
            merged.append(name)
            seen.add(name.lower())
    return merged


async def load_session(state: WorkflowState) -> WorkflowState:
    """
    Node: Load or create the conversation session.

    If session is stale (>30 min since last update), reset to default.
    """
    conversation_id = state.get("conversation_id")
    if not conversation_id:
        logger.debug("No conversation_id — skipping session load")
        return {**state, "session": None, "session_mode": None}

    try:
        repo = await get_repository()
        session = await repo.get_or_create_session(state.get("user_id", ""), conversation_id)
        logger.debug(
            f"Session loaded: conversation={conversation_id}, "
            f"mode={session.active_mode.value}, updated_at={session.updated_at}"
        )

        # Staleness check: reset if idle too long
        if not session.is_default():
            age = datetime.now(UTC) - session.updated_at
            if age > timedelta(minutes=SESSION_STALE_MINUTES):
                stale_min = age.total_seconds() / 60
                logger.info(
                    f"Session stale ({stale_min:.0f}m idle), resetting: "
                    f"{session.active_mode.value} → default"
                )
                session = session.reset()
                await repo.update_session(state.get("user_id", ""), session)
        logger.info(
            f"Session loaded: mode={session.active_mode.value}, "
            f"conversation={conversation_id}"
        )
        return {
            **state,
            "session": session.model_dump(mode="json"),
            "session_mode": session.active_mode.value,
        }
    except Exception as e:
        logger.warning(f"Failed to load session: {e}")
        return {**state, "session": None, "session_mode": None}


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

    # ── R2: Mode-aware routing ──
    session_mode = state.get("session_mode")
    logger.debug(
        f"classify_intent: text='{input_text[:80]}', session_mode={session_mode}"
    )
    if session_mode and session_mode != SessionMode.DEFAULT.value:
        text_lower = input_text.strip().lower()

        # Exit phrase breaks out of any active mode
        if text_lower in EXIT_PHRASES:
            logger.info(
                f"Session exit: phrase='{text_lower}', exiting mode={session_mode}"
            )
            return {
                **state,
                "intent": Intent.GENERAL_CHAT.value,
                "intent_confidence": 1.0,
                "intent_reasoning": f"User exited {session_mode} mode",
                "detected_entities": [],
                "_exit_mode": True,
            }

        # Route based on active mode
        mode_intent_map: dict[str, str] = {
            SessionMode.COOKING.value: Intent.COOKING_HELP.value,
            SessionMode.RECIPE_EXPLORING.value: Intent.RECIPE_BRAINSTORM.value,
            SessionMode.INGESTING.value: Intent.PANTRY_UPDATE.value,
            SessionMode.PANTRY_EDITING.value: Intent.PANTRY_UPDATE.value,
        }
        forced_intent = mode_intent_map.get(session_mode)
        if forced_intent:
            logger.info(
                f"Session mode override: {session_mode} → intent={forced_intent}"
            )
            # For recipe_exploring, check if this is a selection or modification
            if session_mode == SessionMode.RECIPE_EXPLORING.value:
                # Detect recipe modification phrases like "no bacon",
                # "less salt", "make it spicier", "without cheese"
                modification_prefixes = (
                    "no ", "less ", "more ", "without ", "add ",
                    "make it ", "swap ", "replace ", "substitute ",
                    "change ", "remove the ", "skip the ", "drop the ",
                )
                is_modification = any(
                    text_lower.startswith(p) for p in modification_prefixes
                )
                if is_modification:
                    logger.info(
                        f"Recipe modification detected in RECIPE_EXPLORING: "
                        f"'{input_text[:60]}'"
                    )
                    return {
                        **state,
                        "intent": Intent.RECIPE_CARD.value,
                        "intent_confidence": 0.95,
                        "intent_reasoning": (
                            "Recipe modification follow-up (session mode)"
                        ),
                        "detected_entities": [],
                        "selected_recipe_name": input_text,
                    }

                selected_name = extract_selected_recipe(
                    input_text,
                    state.get("conversation_history") or [],
                )
                if selected_name:
                    logger.info(
                        f"Recipe selected from session: '{selected_name}'"
                    )
                    return {
                        **state,
                        "intent": Intent.RECIPE_CARD.value,
                        "intent_confidence": 0.95,
                        "intent_reasoning": "Recipe selected from brainstorm (session mode)",
                        "detected_entities": [],
                        "selected_recipe_name": selected_name,
                    }

            return {
                **state,
                "intent": forced_intent,
                "intent_confidence": 0.95,
                "intent_reasoning": f"Continued from active {session_mode} session",
                "detected_entities": [],
            }

    # Check for brainstorm follow-up FIRST (before any keyword matching)
    if detect_brainstorm_followup(state):
        selected_name = extract_selected_recipe(
            input_text,
            state.get("conversation_history") or [],
        )
        if selected_name:
            logger.info(
                f"Intent classified: recipe_card "
                f"(source=brainstorm_followup, selected='{selected_name}')"
            )
            return {
                **state,
                "intent": Intent.RECIPE_CARD.value,
                "intent_confidence": 0.95,
                "intent_reasoning": "Follow-up to recipe brainstorm",
                "detected_entities": [],
                "selected_recipe_name": selected_name,
            }
        # No confident selection — fall through to LLM intent classification
        # so informational questions expand on the brainstorm ideas.

    # URL shortcut: unambiguous recipe ingest signal (no LLM needed)
    text_lower = input_text.lower()
    url_patterns = [
        "http://",
        "https://",
        ".com",
        ".org",
        "youtube.com",
        "tiktok.com",
        "instagram.com",
    ]
    if any(p in text_lower for p in url_patterns):
        logger.info("Intent classified: recipe_ingest (source=url_shortcut)")
        return {
            **state,
            "intent": Intent.RECIPE_INGEST.value,
            "intent_confidence": 0.95,
            "intent_reasoning": "URL detected — recipe ingest shortcut",
            "detected_entities": [],
        }

    # LLM classification for all other cases
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
            "recipe_generation": Intent.RECIPE_GENERATION.value,
            "recipe_brainstorm": Intent.RECIPE_BRAINSTORM.value,
            "recipe_card": Intent.RECIPE_CARD.value,
            "cooking_help": Intent.COOKING_HELP.value,
            "general_chat": Intent.GENERAL_CHAT.value,
        }

        intent = intent_mapping.get(result.intent.lower(), Intent.GENERAL_CHAT.value)
        logger.info(
            f"Intent classified: {intent} "
            f"(source=llm, confidence={result.confidence}, llm_intent={result.intent})"
        )
        logger.debug(f"LLM reasoning: {result.reasoning}, entities: {result.entities}")

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
        return "cooking_help_response"
    elif intent == Intent.RECIPE_GENERATION.value:
        return "extract_recipe_constraints"
    elif intent == Intent.RECIPE_BRAINSTORM.value:
        return "extract_recipe_constraints"
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


async def build_handoff_recipe(state: WorkflowState) -> WorkflowState:
    """
    Node: Build response for recipe ingest.

    If a URL is present in the message, run the extractor directly and
    return a RecipeCardProposal. If no URL is present, ask the user to share one.
    """
    url = _extract_url(state.get("input_text", ""))
    if url:
        try:
            recipe_card = await ingest_recipe_from_url(url)
            proposal = RecipeCardProposal(recipe=recipe_card, source_url=url)
            return {
                **state,
                "intent": Intent.RECIPE_INGEST.value,
                "assistant_message": f"Here's the recipe I found: {recipe_card.title}. Please review.",
                "next_action": NextAction.REVIEW_PROPOSAL.value,
                "proposal": proposal,
                "requires_review": True,
                "workflow_status": WorkflowStatus.AWAITING_REVIEW.value,
            }
        except Exception as e:
            logger.warning(f"Recipe URL extraction failed for {url!r}: {e}")
            return {
                **state,
                "intent": Intent.RECIPE_INGEST.value,
                "assistant_message": (
                    "I wasn't able to extract the recipe from that URL."
                    " You can try pasting the recipe text instead."
                ),
                "next_action": NextAction.REQUEST_RECIPE_TEXT.value,
                "proposal": None,
                "requires_review": False,
                "workflow_status": WorkflowStatus.AWAITING_INPUT.value,
                "errors": state.get("errors", []) + [f"URL extraction failed: {e}"],
            }
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


async def _resolve_cook_context(
    context: dict[str, Any],
    user_id: str,
    repo: SupabaseRepository,
) -> dict[str, Any] | None:
    """Return the raw cooking-recipe dict to pin, resolving by id when needed.

    Three accepted shapes, in priority order:
    1. `cooking_recipe_id`: <str> — the preferred payload. Resolved server-side
       via the repository so pinning never depends on a client-side fetch (#155).
    2. `cooking_recipe`: {id, title, ingredients, ...} — legacy full dict; used
       as-is (non-breaking).
    3. `cooking_recipe`: {id} — a thin dict carrying only an id; also resolved
       server-side.

    Returns None when there is no cook context, or when the id resolves to no
    recipe (deleted / wrong user) — the caller then leaves the session un-pinned
    rather than crashing the turn.
    """
    recipe_id = context.get(COOKING_RECIPE_ID_KEY)

    raw = context.get(COOKING_RECIPE_KEY)
    if recipe_id is None and isinstance(raw, dict):
        # Legacy full dict already carries what we need.
        if str(raw.get("title") or "").strip() or raw.get("ingredients"):
            return raw
        # Thin dict with only an id → resolve like the id-only payload.
        recipe_id = raw.get("id")

    if recipe_id is None:
        return None

    resolved = await repo.get_recipe(user_id, str(recipe_id))
    if not resolved:
        logger.warning(
            f"Cook handoff: recipe {recipe_id!r} not found for user "
            f"{user_id!r}; leaving session un-pinned"
        )
        return None
    return dict(resolved)


async def update_session_node(state: WorkflowState) -> WorkflowState:
    """
    Node: Update session mode based on workflow outcome.

    Runs before END on every path. Implements mode transition logic.
    """
    conversation_id = state.get("conversation_id")
    if not conversation_id:
        return state

    try:
        repo = await get_repository()
        session = await repo.get_or_create_session(state.get("user_id", ""), conversation_id)
        intent = state.get("intent", Intent.GENERAL_CHAT.value)
        old_mode = session.active_mode.value

        # Handle explicit exit — checked before the cook handoff so "stop" still
        # breaks out of COOKING even if the client keeps resending the recipe.
        if state.get("_exit_mode"):
            session = session.reset()
            await repo.update_session(state.get("user_id", ""), session)
            logger.info(f"Session reset (exit phrase): {old_mode} → default")
            return state

        # Cook handoff: the client pins the recipe the user just started cooking.
        # Only the request context triggers this (not the pinned copy in session
        # metadata), so a later brainstorm can still move the session on.
        #
        # Preferred payload is just the recipe id, which we resolve from the DB
        # here — this removes the client fetch/send race that could otherwise pin
        # an empty context (#155). The legacy full `cooking_recipe` dict is still
        # accepted for non-breaking rollout; a dict carrying only an `id` is also
        # routed through the server-side resolve.
        context = state.get("context") or {}
        user_id = state.get("user_id") or ""
        raw_cooking_recipe = await _resolve_cook_context(context, user_id, repo)
        if isinstance(raw_cooking_recipe, dict):
            cooking_recipe = normalize_cooking_recipe(raw_cooking_recipe)
            session.active_mode = SessionMode.COOKING
            session.pinned_recipe_id = cooking_recipe["id"]
            session.metadata[COOKING_RECIPE_KEY] = cooking_recipe
            await repo.update_session(user_id, session)
            logger.info(
                f"Session pinned to cooking recipe: {old_mode} → cooking "
                f"(recipe_id={cooking_recipe['id']})"
            )
            return state

        # Mode transition rules
        if intent in (Intent.RECIPE_BRAINSTORM.value, Intent.RECIPE_GENERATION.value):
            session.active_mode = SessionMode.RECIPE_EXPLORING
            session.metadata["brainstorm_ideas"] = state.get("brainstorm_ideas", [])
            # Persist constraints so the follow-up turn (research_recipe) can inherit
            # them even though it bypasses extract_recipe_constraints (#144).
            constraints = state.get("recipe_constraints")
            if constraints:
                session.metadata["recipe_constraints"] = constraints
                logger.debug(
                    "Session: persisted recipe_constraints for follow-up inheritance"
                )

        elif intent == Intent.RECIPE_CARD.value:
            proposal = state.get("proposal")
            if proposal is not None:
                # Stay in RECIPE_EXPLORING so follow-ups like "no bacon"
                # or "make it spicier" are treated as recipe refinements
                # rather than falling through to LLM (which misclassifies
                # them as pantry_update).
                session.active_mode = SessionMode.RECIPE_EXPLORING
                session.pinned_recipe_id = None
                session.metadata["last_recipe_title"] = getattr(
                    getattr(proposal, "recipe", None), "title", None
                )
                # Keep constraints alive across further refinement turns.
                constraints = state.get("recipe_constraints")
                if constraints:
                    session.metadata["recipe_constraints"] = constraints
            # else: stay in current mode

        elif intent == Intent.PANTRY_UPDATE.value:
            if state.get("requires_review"):
                session.active_mode = SessionMode.INGESTING
                # Remember what's still unresolved so the next turn's
                # review_gate can acknowledge it instead of reading like a
                # fresh conversation (#307-followup) — `pending_proposal`
                # was declared on the session model for exactly this but was
                # never actually written before now.
                item_names = [a.item.name for a in state.get("actions", [])]
                unclear_terms = state.get("generic_pantry_terms", [])
                existing = session.pending_proposal or {}
                merged_items = _merge_dedup_case_insensitive(
                    existing.get("item_names", []), item_names
                )
                merged_terms = _merge_dedup_case_insensitive(
                    existing.get("unclear_terms", []), unclear_terms
                )
                if merged_items or merged_terms:
                    session.pending_proposal = {
                        "item_names": merged_items[-20:],
                        "unclear_terms": merged_terms[-20:],
                    }
            else:
                session.active_mode = SessionMode.DEFAULT
                session.pending_proposal = None

        elif intent == Intent.COOKING_HELP.value:
            # Belt-and-suspenders: if brainstorm_ideas exist in state, the brainstorm
            # pipeline ran. BUT only flip to RECIPE_EXPLORING when the session is NOT
            # already COOKING — in COOKING mode the intent is forced at classify_intent,
            # so brainstorm_ideas appearing does not mean the user left the recipe.
            if state.get("brainstorm_ideas") and old_mode != SessionMode.COOKING.value:
                session.active_mode = SessionMode.RECIPE_EXPLORING
                session.metadata["brainstorm_ideas"] = state.get("brainstorm_ideas", [])
                constraints = state.get("recipe_constraints")
                if constraints:
                    session.metadata["recipe_constraints"] = constraints
                logger.info(
                    f"Session transition (brainstorm fallback): "
                    f"{old_mode} → recipe_exploring "
                    "(intent=cooking_help but brainstorm_ideas present)"
                )

        # general_chat / cooking_help (without brainstorm) don't change mode

        new_mode = session.active_mode.value
        if new_mode != old_mode:
            logger.info(
                f"Session transition: {old_mode} → {new_mode} (intent={intent})"
            )
        else:
            logger.debug(
                f"Session unchanged: mode={old_mode}, intent={intent}"
            )

        await repo.update_session(state.get("user_id", ""), session)
    except Exception as e:
        logger.warning(f"Failed to update session: {e}")

    return state


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
    workflow.add_node("load_session", load_session)
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

    # Session update (converge point before END)
    workflow.add_node("update_session", update_session_node)

    # Set entry point
    workflow.set_entry_point("initialize")

    # Define edges: initialize → load_session → classify_intent
    workflow.add_edge("initialize", "load_session")
    workflow.add_edge("load_session", "classify_intent")

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
    workflow.add_edge("finalize_pantry", "update_session")

    # Handoff paths → update_session → END
    workflow.add_edge("build_handoff_receipt", "update_session")
    workflow.add_edge("build_handoff_product", "update_session")
    workflow.add_edge("build_handoff_recipe", "update_session")

    # General chat → update_session → END
    workflow.add_edge("general_chat_response", "update_session")

    # Cooking help → update_session → END
    workflow.add_edge("cooking_help_response", "update_session")

    # Brainstorm path → update_session → END
    workflow.add_edge("extract_recipe_constraints", "score_pantry")
    workflow.add_edge("score_pantry", "brainstorm_recipes")
    workflow.add_edge("brainstorm_recipes", "update_session")

    # Grounded generation path → update_session → END
    workflow.add_edge("research_recipe", "generate_grounded_recipe")
    workflow.add_edge("generate_grounded_recipe", "update_session")

    # Single converge point
    workflow.add_edge("update_session", END)

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
    user_id: str | None = None,
    context: dict[str, Any] | None = None,
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
        user_id: Supabase auth user ID
        context: Client-supplied context, e.g. {"cooking_recipe": {...}}

    Returns:
        ProposalEnvelope with appropriate proposal type based on intent
    """
    graph = get_chat_router_graph()

    # Initialize state
    initial_state: WorkflowState = {
        "request_id": str(uuid4()),
        "workflow_id": str(uuid4()),
        "conversation_id": conversation_id,
        "user_id": user_id,
        "input_text": message,
        "input_type": "chat",
        "input_mode": mode,
        "pantry_snapshot": pantry_snapshot,
        "conversation_history": history or [],
        "context": context,
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
        proposal = final_state.get("proposal")
        if isinstance(proposal, RecipeCardProposal):
            return create_recipe_envelope(
                proposal=proposal,
                confidence=final_state.get("confidence", 0.9),
                field_confidences=final_state.get("field_confidences", {}),
                warnings=final_state.get("warnings", []),
                errors=final_state.get("errors", []),
                assistant_message=final_state.get("assistant_message", ""),
                request_id=final_state.get("request_id"),
                workflow_id=final_state.get("workflow_id"),
            )
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
        envelope.metadata["brainstorm_ideas"] = final_state.get("brainstorm_ideas", [])
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
        proposal = final_state.get("proposal")
        if isinstance(proposal, RecipeCardProposal):
            envelope = create_recipe_envelope(
                proposal=proposal,
                confidence=final_state.get("confidence", 0.9),
                field_confidences=final_state.get("field_confidences", {}),
                warnings=final_state.get("warnings", []),
                errors=final_state.get("errors", []),
                assistant_message=final_state.get("assistant_message", ""),
                request_id=final_state.get("request_id"),
                workflow_id=final_state.get("workflow_id"),
            )
        else:
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
    if intent in (
        Intent.GENERAL_CHAT.value,
        Intent.COOKING_HELP.value,
        Intent.RECIPE_BRAINSTORM.value,
    ):
        envelope.metadata["brainstorm_ideas"] = final_state.get("brainstorm_ideas", [])
    return envelope


async def run_chat_workflow_streaming(
    message: str,
    conversation_id: str | None = None,
    mode: str = "text",
    pantry_snapshot: list[dict[str, Any]] | None = None,
    history: list[dict[str, Any]] | None = None,
    user_id: str | None = None,
    context: dict[str, Any] | None = None,
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
        "user_id": user_id,
        "input_text": message,
        "input_type": "chat",
        "input_mode": mode,
        "pantry_snapshot": pantry_snapshot,
        "conversation_history": history or [],
        "context": context,
        "warnings": [],
        "errors": [],
    }

    # Run initialization + session load + intent classification
    init_state = initialize_state(initial_state)
    session_state = await load_session(init_state)
    classified_state = await classify_intent(session_state)
    intent = classified_state.get("intent", Intent.GENERAL_CHAT.value)
    input_mode = mode  # alias used below

    logger.info(
        f"Stream: intent={intent}, confidence={classified_state.get('intent_confidence')}, "
        f"reasoning={classified_state.get('intent_reasoning')}, mode={input_mode}"
    )
    logger.debug(
        f"Stream context: session_mode={classified_state.get('session_mode')}, "
        f"message='{message[:80]}'"
    )

    # Only stream for free-text intents.
    # RECIPE_BRAINSTORM must NOT be streamed — it needs the full pipeline
    # (constraint extraction → pantry scoring → brainstorm generation)
    # to produce structured brainstorm_ideas and transition to RECIPE_EXPLORING.
    streamable_intents = {
        Intent.GENERAL_CHAT.value,
        Intent.COOKING_HELP.value,
    }
    if intent == Intent.COOKING_HELP.value and input_mode == "recipe":
        intent = Intent.RECIPE_GENERATION.value
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
        items = await repo.get_all_pantry_items(classified_state.get("user_id", ""))
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
    # Cook handoff — empty string unless a recipe is pinned for this conversation.
    recipe_context = format_cooking_recipe_context(classified_state)

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

    prompt = (
        mode_prefix
        + system
        + pantry_context
        + recipe_context
        + "\n\n"
        + history_context
        + user_prompt
    )

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

    # Update session state after streaming
    stream_final_state = WorkflowState(
        **{
            **classified_state,
            "intent": intent,
            "assistant_message": collected_text,
        }
    )
    await update_session_node(stream_final_state)
    logger.debug(
        f"Stream session updated: intent={intent}, "
        f"response_length={len(collected_text)}"
    )

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
