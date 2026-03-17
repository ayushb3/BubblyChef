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
from datetime import date
from typing import Any
from uuid import uuid4

from langgraph.graph import END, StateGraph
from langgraph.graph.state import CompiledStateGraph

from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.api.deps import get_ai_manager
from bubbly_chef.config import settings
from bubbly_chef.models.base import (
    Intent,
    NextAction,
    ProposalEnvelope,
    WorkflowStatus,
)
from bubbly_chef.models.pantry import (
    ActionType,
    FoodCategory,
    PantryItem,
    PantryProposal,
    PantryUpsertAction,
)
from bubbly_chef.models.proposals import HandoffKind
from bubbly_chef.repository.sqlite import get_repository
from bubbly_chef.tools.expiry import get_expiry_heuristics
from bubbly_chef.tools.normalizer import get_normalizer
from bubbly_chef.workflows.state import (
    LLMIntentResult,
    LLMParseResult,
    WorkflowState,
    create_general_chat_envelope,
    create_handoff_envelope,
    create_pantry_envelope,
    map_action_type,
    map_category,
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


PANTRY_PARSE_SYSTEM_PROMPT = """You are a grocery/pantry item extractor.

Extract ALL grocery items mentioned in the text. For each item:
- name: the item name (e.g., "milk", "eggs", "bread")
- quantity: numeric amount (default 1 if not specified)
- unit: unit of measurement (e.g., "gallon", "dozen", "lb", "item")
- category: food category (produce, dairy, meat, seafood, frozen,
  canned, dry_goods, condiments, beverages, snacks, bakery, other)
- action: "add" for purchases, "remove" for items used/thrown out,
  "use" for partial consumption
- confidence: how confident you are about this item (0-1)

Rules:
1. Be conservative - only extract items you're confident about
2. Default quantity to 1 if unclear
3. Default unit to "item" if not specified
4. Be specific with categories
5. Mark low confidence (< 0.7) for ambiguous items"""

PANTRY_PARSE_USER_PROMPT = """Extract grocery items from:

"{text}"

Return a list of items with name, quantity, unit, category, action, and confidence."""


GENERAL_CHAT_SYSTEM_PROMPT = """\
You are a helpful assistant for a pantry/grocery management \
app called BubblyChef.

You can help users with:
- Questions about food storage
- Cooking tips and advice
- General conversation
- Redirecting them to use pantry features when relevant

Keep responses friendly and concise. If the user seems to want \
to track groceries, gently remind them they can say things like \
"I bought milk" to add items."""

GENERAL_CHAT_USER_PROMPT = """User: {text}

Respond helpfully and concisely. Mention relevant app features if appropriate."""


# ─── Mode-specific system prompt prefixes ────────────────────────────────────

MODE_SYSTEM_PROMPTS: dict[str, str] = {
    "chat": "",  # default — no override
    "text": "",  # legacy alias for chat
    "voice": "",  # legacy alias for chat
    "recipe": (
        "You are in RECIPE MODE. The user wants recipe suggestions.\n"
        "Always respond with a structured recipe when possible — include title, "
        "ingredients with quantities, step-by-step instructions, prep/cook time, "
        "and difficulty level.\n"
        "Prioritize ingredients the user already has in their pantry.\n"
        "If they ask something non-recipe, still help but gently steer back "
        "toward cooking.\n\n"
    ),
    "learn": (
        "You are in LEARN TO COOK MODE. The user wants to learn cooking skills.\n"
        "Explain the 'why' behind techniques, not just the 'how'. Use analogies.\n"
        "Break complex techniques into small, approachable steps.\n"
        "Be encouraging and patient — assume the user is a beginner unless they "
        "show otherwise.\n"
        "Suggest practice exercises when appropriate.\n\n"
    ),
}


def get_mode_prefix(state: WorkflowState) -> str:
    """Return the system prompt prefix for the current chat mode."""
    mode = state.get("input_mode", "chat")
    return MODE_SYSTEM_PROMPTS.get(mode, "")


def format_history_context(state: WorkflowState, max_turns: int = 10) -> str:
    """Format recent conversation history for injection into LLM prompts.

    Returns a compact text block like:
        Previous conversation:
        User: I bought milk
        Assistant: Got it! I've noted 1 gallon of milk.
        ...
    or an empty string if there is no history.
    """
    history: list[dict[str, str]] = state.get("conversation_history") or []
    if not history:
        return ""

    recent = history[-max_turns:]
    lines = ["Previous conversation:"]
    for turn in recent:
        role = turn.get("role", "user").capitalize()
        content = turn.get("content", "").strip()
        if content:
            lines.append(f"{role}: {content}")

    return "\n".join(lines) + "\n\n"
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
    recipe_ingest_keywords = ["save recipe", "import recipe", "add recipe", "store recipe"]
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
        return "cooking_help_response"
    else:
        return "general_chat_response"


async def parse_pantry_items(state: WorkflowState) -> WorkflowState:
    """
    Node: Use LLM to parse free text into structured pantry items.

    This is the second LLM call in the pantry update path.
    """
    input_text = state.get("input_text", "")
    ai_manager = get_ai_manager()
    prompt = PANTRY_PARSE_SYSTEM_PROMPT + "\n\n" + PANTRY_PARSE_USER_PROMPT.format(text=input_text)

    try:
        result = await ai_manager.complete(
            prompt=prompt,
            response_schema=LLMParseResult,
            temperature=0.1,
        )

        if not isinstance(result, LLMParseResult) or len(result.items) == 0:
            return {
                **state,
                "parsed_items": [],
                "parse_error": "No items found",
                "assistant_message": (
                    "I couldn't identify any specific grocery items."
                    " Could you be more specific?"
                    " For example: 'I bought 2 gallons of milk'"
                ),
                "next_action": NextAction.REQUEST_CLARIFICATION.value,
                "clarifying_questions": ["What items would you like to add or update?"],
                "requires_review": True,
            }

        parsed_items = [item.model_dump() for item in result.items]
        per_item_confidences = [item.confidence for item in result.items]
        logger.info(f"Parsed {len(parsed_items)} items with confidence {result.confidence}")

        return {
            **state,
            "parsed_items": parsed_items,
            "parse_error": None,
            "confidence": result.confidence,
            "per_item_confidences": per_item_confidences,
        }

    except NoProviderAvailableError as e:
        logger.error(f"No AI provider available for pantry parsing: {e}")
        return {
            **state,
            "parsed_items": [],
            "parse_error": str(e),
            "errors": state.get("errors", []) + ["no_ai_provider"],
            "confidence": 0.0,
            "requires_review": True,
        }
    except Exception as e:
        logger.error(f"Pantry parse error: {e}")
        return {
            **state,
            "parsed_items": [],
            "parse_error": str(e),
            "errors": state.get("errors", []) + [f"LLM error: {e}"],
            "confidence": 0.0,
            "requires_review": True,
        }


def normalize_items(state: WorkflowState) -> WorkflowState:
    """
    Node: Normalize item names and categories (deterministic).

    No LLM calls here - pure rule-based normalization.
    """
    parsed_items = state.get("parsed_items", [])
    normalizer = get_normalizer()

    normalized = []
    warnings = list(state.get("warnings", []))
    updated_confidences = list(state.get("per_item_confidences", []))

    for idx, item in enumerate(parsed_items):
        name = item.get("name", "")
        original_name = name

        # Normalize name
        normalized_name = normalizer.normalize(name)

        # Track if heavy normalization occurred (may lower confidence)
        heavy_normalization = normalized_name.lower() != original_name.lower()

        # Get category (use normalizer if LLM didn't provide good one)
        llm_category = item.get("category")
        if llm_category and llm_category.lower() != "other":
            category = map_category(llm_category)
        else:
            category = normalizer.get_category(normalized_name)
            if category == FoodCategory.OTHER:
                warnings.append(f"Could not determine category for '{original_name}'")

        # Check for missing/ambiguous data that might lower confidence
        item_confidence = item.get("confidence", 0.8)

        if not item.get("quantity") or item.get("quantity") == 1:
            # Default quantity - might be correct but lower confidence
            item_confidence = min(item_confidence, 0.75)

        if item.get("unit", "item") == "item":
            # Default unit - might need clarification
            pass  # Keep confidence as-is for now

        if heavy_normalization:
            item_confidence = min(item_confidence, 0.70)
            warnings.append(f"Normalized '{original_name}' to '{normalized_name}'")

        if category == FoodCategory.OTHER:
            item_confidence = min(item_confidence, 0.65)

        # Update confidence
        if idx < len(updated_confidences):
            updated_confidences[idx] = item_confidence
        else:
            updated_confidences.append(item_confidence)

        normalized_item = {
            **item,
            "name": normalized_name,
            "original_name": original_name,
            "category": category.value,
            "confidence": item_confidence,
        }
        normalized.append(normalized_item)

        if normalized_name != original_name:
            logger.debug(f"Normalized '{original_name}' -> '{normalized_name}'")

    # Recalculate overall confidence
    if updated_confidences:
        overall_confidence = sum(updated_confidences) / len(updated_confidences)
    else:
        overall_confidence = state.get("confidence", 0.0)

    return {
        **state,
        "normalized_items": normalized,
        "warnings": warnings,
        "per_item_confidences": updated_confidences,
        "confidence": overall_confidence,
    }


def apply_expiry_heuristics(state: WorkflowState) -> WorkflowState:
    """
    Node: Apply expiry date estimates (deterministic).

    Uses category-based heuristics to estimate expiry dates.
    """
    normalized_items = state.get("normalized_items", [])
    expiry = get_expiry_heuristics()

    with_expiry = []

    for item in normalized_items:
        category = map_category(item.get("category", "other"))
        storage = expiry.get_default_storage(category)

        # Estimate expiry
        expiry_date, is_estimated = expiry.estimate_expiry(
            category=category,
            storage=storage,
            name=item.get("name"),
            purchase_date=date.today(),
        )

        updated_item = {
            **item,
            "storage_location": storage.value,
            "expiry_date": expiry_date.isoformat(),
            "estimated_expiry": is_estimated,
            "purchase_date": date.today().isoformat(),
        }
        with_expiry.append(updated_item)

    return {
        **state,
        "normalized_items": with_expiry,
    }


def check_for_duplicates(state: WorkflowState) -> WorkflowState:
    """
    Node: Check for potential duplicates in the proposal.

    If pantry_snapshot is provided, check against it.
    Also check for duplicates within the current batch.
    """
    normalized_items = state.get("normalized_items", [])
    pantry_snapshot = state.get("pantry_snapshot", [])
    warnings = list(state.get("warnings", []))

    # Check for duplicates within batch
    seen_names = set()
    for item in normalized_items:
        name_lower = item.get("name", "").lower()
        if name_lower in seen_names:
            warnings.append(f"Duplicate item detected: '{item.get('name')}'")
        seen_names.add(name_lower)

    # Check against pantry snapshot if provided
    if pantry_snapshot:
        pantry_names = {p.get("name", "").lower() for p in pantry_snapshot}
        for item in normalized_items:
            name_lower = item.get("name", "").lower()
            if name_lower in pantry_names and item.get("action") == "add":
                warnings.append(
                    f"'{item.get('name')}' may already be in your "
                    "pantry. Consider updating quantity instead."
                )

    return {
        **state,
        "warnings": warnings,
    }


def create_actions(state: WorkflowState) -> WorkflowState:
    """
    Node: Convert normalized items to PantryUpsertAction objects.
    """
    normalized_items = state.get("normalized_items", [])
    per_item_confidences = state.get("per_item_confidences", [])

    actions = []
    field_confidences = {}
    seen_keys: dict[str, int] = {}  # Track key counts for dedup

    for idx, item_data in enumerate(normalized_items):
        category = map_category(item_data.get("category"))
        name = item_data.get("name", "unknown")

        # Create deterministic client_item_key
        base_key = f"{category.value}:{name.lower().strip().replace(' ', '_')}"

        # Handle duplicate keys within same batch
        if base_key in seen_keys:
            seen_keys[base_key] += 1
            client_key = f"{base_key}#{seen_keys[base_key]}"
        else:
            seen_keys[base_key] = 1
            client_key = base_key

        # Create PantryItem (without DB ID - that's assigned at apply time)
        pantry_item = PantryItem(
            id=uuid4(),  # Temporary ID for reference in proposal
            client_item_key=client_key,
            name=name,
            original_name=item_data.get("original_name"),
            category=category,
            storage_location=item_data.get("storage_location", "pantry"),
            quantity=item_data.get("quantity", 1.0),
            unit=item_data.get("unit", "item"),
            purchase_date=date.fromisoformat(item_data["purchase_date"])
            if item_data.get("purchase_date")
            else None,
            expiry_date=date.fromisoformat(item_data["expiry_date"])
            if item_data.get("expiry_date")
            else None,
            estimated_expiry=item_data.get("estimated_expiry", True),
        )

        # Create action
        action_type = map_action_type(item_data.get("action", "add"))

        # Get per-item confidence
        item_confidence = per_item_confidences[idx] if idx < len(per_item_confidences) else 0.5

        action = PantryUpsertAction(
            action_type=action_type,
            item=pantry_item,
            confidence=item_confidence,
            reasoning=f"Parsed from text: '{item_data.get('original_name', pantry_item.name)}'",
        )
        actions.append(action)

        # Track field confidence
        field_confidences[f"item_{idx}_name"] = item_confidence
        field_confidences[f"item_{idx}_quantity"] = item_confidence

    return {
        **state,
        "actions": actions,
        "field_confidences": field_confidences,
    }


def review_gate(state: WorkflowState) -> WorkflowState:
    """
    Node: Determine if review is required and build clarifying questions.

    This implements the human-in-the-loop pattern.

    Policy:
    - REQUEST_CLARIFICATION: Cannot proceed safely without user input
      (low confidence, missing fields, ambiguous items)
    - REVIEW_PROPOSAL: Usable proposal but needs user approval
      (medium confidence, normalization applied, dedup warnings)
    - NONE: High confidence, can auto-apply
    """
    actions = state.get("actions", [])
    confidence = state.get("confidence", 0.0)
    errors = state.get("errors", [])
    per_item_confidences = state.get("per_item_confidences", [])

    clarifying_questions = []
    requires_review = False
    needs_clarification = False
    should_interrupt = False

    # Threshold for per-item "we're not sure" flag
    item_clarification_threshold = 0.6

    # Check for low confidence items that need clarification
    low_confidence_items = []
    for idx, conf in enumerate(per_item_confidences):
        if conf < item_clarification_threshold and idx < len(actions):
            low_confidence_items.append(actions[idx].item.name)

    if low_confidence_items:
        # Ask about specific ambiguous items
        if len(low_confidence_items) == 1:
            clarifying_questions.append(
                f"I'm not sure about '{low_confidence_items[0]}'"
                " - what size or quantity did you mean?"
            )
        else:
            clarifying_questions.append(
                f"I'm not sure about: {', '.join(low_confidence_items)}. Could you clarify?"
            )
        needs_clarification = True

    # Check for default quantity + unit (ambiguous amount)
    for action in actions:
        item = action.item
        if item.quantity == 1 and item.unit == "item":
            # Only flag if also low confidence
            if action.confidence < item_clarification_threshold:
                if item.name not in low_confidence_items:
                    clarifying_questions.append(
                        f"How much {item.name} did you mean? (e.g., '1 jar', '2 cans')"
                    )
                    needs_clarification = True
        elif item.quantity > 50:
            clarifying_questions.append(
                f"You mentioned {item.quantity} {item.unit}"
                f" of {item.name}. Did you mean this quantity?"
            )
            needs_clarification = True

    # Determine overall status based on confidence
    if not actions:
        # No actions - definitely need clarification
        next_action = NextAction.REQUEST_CLARIFICATION.value
        requires_review = True
        needs_clarification = True
    elif confidence < settings.review_confidence_threshold:
        # Overall low confidence - need clarification
        next_action = NextAction.REQUEST_CLARIFICATION.value
        requires_review = True
        needs_clarification = True
        should_interrupt = True
        if not clarifying_questions:
            clarifying_questions.append(
                "I'm not confident about this. Could you confirm or provide more details?"
            )
    elif needs_clarification:
        # Some items need clarification
        next_action = NextAction.REQUEST_CLARIFICATION.value
        requires_review = True
        should_interrupt = True
    elif confidence < settings.auto_apply_confidence_threshold:
        # Medium confidence - usable but needs review
        next_action = NextAction.REVIEW_PROPOSAL.value
        requires_review = True
    elif errors:
        # Has errors - needs review
        next_action = NextAction.REVIEW_PROPOSAL.value
        requires_review = True
    else:
        # High confidence - can auto-apply
        next_action = NextAction.NONE.value
        requires_review = False

    # Build assistant message
    num_items = len(actions)
    if num_items == 0:
        assistant_message = "I couldn't identify any pantry items. Could you be more specific?"
    elif num_items == 1:
        item = actions[0].item
        action_verb = "add" if actions[0].action_type == ActionType.ADD else "update"
        assistant_message = (
            f"I found 1 item to {action_verb}: {item.quantity} {item.unit} of {item.name}."
        )
    else:
        assistant_message = f"I found {num_items} items. Please review before updating your pantry."

    if clarifying_questions:
        assistant_message += f" {clarifying_questions[0]}"

    return {
        **state,
        "requires_review": requires_review,
        "should_interrupt": should_interrupt,
        "clarifying_questions": clarifying_questions,
        "next_action": next_action,
        "assistant_message": assistant_message,
        "workflow_status": WorkflowStatus.AWAITING_REVIEW.value
        if requires_review
        else WorkflowStatus.COMPLETED.value,
    }


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


async def general_chat_response(state: WorkflowState) -> WorkflowState:
    """
    Node: Generate general chat response using AI (Gemini → Ollama fallback).
    """
    input_text = state.get("input_text", "")
    no_provider = "no_ai_provider" in state.get("errors", [])

    if no_provider:
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "assistant_message": (
                "⚠️ No AI provider is configured."
                " Please check your API keys in settings."
            ),
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 1.0,
            "workflow_status": WorkflowStatus.COMPLETED.value,
        }

    ai_manager = get_ai_manager()

    # Include pantry summary so the AI can mention items when relevant
    pantry_context = ""
    try:
        repo = await get_repository()
        items = await repo.get_all_pantry_items()
        if items:
            names = [it.name for it in items[:20]]
            pantry_context = (
                f"\n\nThe user has {len(items)} pantry items"
                f" including: {', '.join(names)}."
            )
    except Exception:
        pass  # non-critical for general chat

    mode_prefix = get_mode_prefix(state)
    history_context = format_history_context(state)
    prompt = (
        mode_prefix
        + GENERAL_CHAT_SYSTEM_PROMPT
        + pantry_context
        + "\n\n"
        + history_context
        + GENERAL_CHAT_USER_PROMPT.format(text=input_text)
    )

    try:
        result = await ai_manager.complete(prompt=prompt, temperature=0.7)
        response_text = (
            result if isinstance(result, str) else getattr(result, "response", str(result))
        )

        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "assistant_message": response_text,
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 1.0,
            "workflow_status": WorkflowStatus.COMPLETED.value,
        }

    except NoProviderAvailableError:
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "assistant_message": (
                "⚠️ No AI provider is configured."
                " Please add a Gemini API key or start Ollama."
            ),
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 1.0,
            "workflow_status": WorkflowStatus.COMPLETED.value,
        }
    except Exception as e:
        logger.error(f"General chat error: {e}")
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "assistant_message": "Sorry, I ran into an error. Please try again.",
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 0.5,
            "errors": state.get("errors", []) + [f"Chat response error: {e}"],
            "workflow_status": WorkflowStatus.COMPLETED.value,
        }


async def cooking_help_response(state: WorkflowState) -> WorkflowState:
    """
    Node: Generate a cooking help response (techniques, meal ideas, substitutions).
    Routes here when intent == COOKING_HELP.
    Fetches the user's pantry so suggestions are grounded in what they actually have.
    """
    input_text = state.get("input_text", "")

    # Fetch pantry items so the AI can give pantry-grounded suggestions
    pantry_context = ""
    try:
        repo = await get_repository()
        items = await repo.get_all_pantry_items()
        if items:
            expiring = [
                it for it in items
                if it.expiry_date and (it.expiry_date - date.today()).days <= 3
            ]
            pantry_lines = [f"- {it.name} ({it.quantity} {it.unit})" for it in items]
            pantry_context = (
                f"\n\nThe user's pantry currently has {len(items)} items:\n"
                + "\n".join(pantry_lines[:30])  # cap to keep prompt reasonable
            )
            if len(items) > 30:
                pantry_context += f"\n... and {len(items) - 30} more items"
            if expiring:
                exp_names = ", ".join(it.name for it in expiring)
                pantry_context += (
                    f"\n\n⚠️ EXPIRING SOON (use first!): {exp_names}"
                )
    except Exception as e:
        logger.warning(f"Could not fetch pantry for cooking help: {e}")

    cooking_system = """\
You are a friendly cooking assistant for BubblyChef, \
a pantry-aware recipe app.

Help the user with:
- Cooking techniques and how-to questions
- Meal ideas and recipe suggestions based on what they have
- Ingredient substitutions
- Food storage tips
- General culinary advice

When suggesting meals or recipes, prioritize ingredients the user \
already has in their pantry (listed below). If items are expiring soon, \
suggest ways to use them first.

Keep responses friendly, concise, and practical. If the user asks \
what they can make, give concrete suggestions from their pantry and \
mention they can switch to Recipe mode for a full step-by-step recipe."""

    ai_manager = get_ai_manager()
    user_prompt = f"\n\nUser: {input_text}\n\nRespond helpfully and concisely."
    mode_prefix = get_mode_prefix(state)
    history_context = format_history_context(state)
    prompt = mode_prefix + cooking_system + pantry_context + "\n\n" + history_context + user_prompt

    try:
        result = await ai_manager.complete(prompt=prompt, temperature=0.7)
        response_text = (
            result if isinstance(result, str) else getattr(result, "response", str(result))
        )

        return {
            **state,
            "intent": Intent.COOKING_HELP.value,
            "assistant_message": response_text,
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 1.0,
            "workflow_status": WorkflowStatus.COMPLETED.value,
        }

    except NoProviderAvailableError:
        return {
            **state,
            "intent": Intent.COOKING_HELP.value,
            "assistant_message": (
                "⚠️ No AI provider is configured."
                " Please add a Gemini API key or start Ollama."
            ),
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 1.0,
            "workflow_status": WorkflowStatus.COMPLETED.value,
        }
    except Exception as e:
        logger.error(f"Cooking help response error: {e}")
        return {
            **state,
            "intent": Intent.COOKING_HELP.value,
            "assistant_message": "Sorry, I ran into an error answering that. Please try again.",
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 0.5,
            "errors": state.get("errors", []) + [f"Cooking help error: {e}"],
            "workflow_status": WorkflowStatus.COMPLETED.value,
        }


def finalize_pantry_proposal(state: WorkflowState) -> WorkflowState:
    """
    Node: Create final PantryProposal from state.
    """
    actions = state.get("actions", [])
    input_text = state.get("input_text", "")

    proposal = PantryProposal(
        actions=actions,
        source_text=input_text,
        dedup_applied=bool(state.get("pantry_snapshot")),
        normalization_applied=True,
    )

    return {
        **state,
        "proposal": proposal,
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

    else:  # general_chat or cooking_help — both return plain text envelope
        return create_general_chat_envelope(
            assistant_message=final_state.get("assistant_message", "I'm here to help!"),
            intent=Intent(intent),
            request_id=final_state.get("request_id"),
            workflow_id=final_state.get("workflow_id"),
            conversation_id=final_state.get("conversation_id"),
        )


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
