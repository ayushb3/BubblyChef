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
from bubbly_chef.models.recipe import (
    Ingredient,
    IngredientAvailability,
    RecipeCard,
    RecipeCardProposal,
    RecipeConstraints,
)
from bubbly_chef.repository.sqlite import get_repository
from bubbly_chef.tools.expiry import get_expiry_heuristics
from bubbly_chef.tools.normalizer import get_normalizer
from bubbly_chef.tools.web_search import search_recipe
from bubbly_chef.workflows.state import (
    LLMIntentResult,
    LLMParseResult,
    LLMRecipeResult,
    WorkflowState,
    create_general_chat_envelope,
    create_handoff_envelope,
    create_pantry_envelope,
    create_recipe_envelope,
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


# ─── Mode-switch detection ────────────────────────────────────────────────────

MODE_SWITCH_PATTERNS: dict[str, list[str]] = {
    "recipe": ["switch to recipe mode", "recipe mode", "try recipe mode"],
    "learn": ["switch to learn mode", "learn mode", "learning mode", "try learn mode"],
    "chat": ["switch to chat mode", "chat mode", "general chat"],
}


def detect_mode_suggestion(text: str, current_mode: str) -> str | None:
    """Detect if the assistant message suggests switching to a different chat mode."""
    text_lower = text.lower()
    for mode, patterns in MODE_SWITCH_PATTERNS.items():
        if mode == current_mode:
            continue
        if any(p in text_lower for p in patterns):
            return mode
    return None


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


# =============================================================================
# Recipe Grounding — Cuisine Keyword Table
# =============================================================================

CUISINE_INGREDIENTS: dict[str, set[str]] = {
    "chinese": {
        "soy sauce", "ginger", "garlic", "rice", "sesame oil", "tofu",
        "bok choy", "hoisin sauce", "oyster sauce", "five spice", "scallion",
        "rice vinegar", "chili oil", "star anise", "wonton wrappers",
    },
    "italian": {
        "pasta", "olive oil", "garlic", "tomato", "basil", "parmesan",
        "mozzarella", "oregano", "prosciutto", "ricotta", "pancetta",
        "sun-dried tomato", "capers", "anchovies", "white wine",
    },
    "mexican": {
        "tortilla", "beans", "rice", "cilantro", "lime", "avocado",
        "jalapeño", "cumin", "chili powder", "salsa", "sour cream",
        "cotija cheese", "epazote", "ancho chili", "tomatillo",
    },
    "indian": {
        "cumin", "turmeric", "garam masala", "coriander", "ginger",
        "cardamom", "cloves", "mustard seeds", "curry leaves", "ghee",
        "lentils", "chickpeas", "basmati rice", "yogurt", "paneer",
    },
    "japanese": {
        "soy sauce", "mirin", "sake", "dashi", "miso", "tofu",
        "sesame", "nori", "rice vinegar", "wasabi", "panko",
        "edamame", "shiitake mushroom", "green tea",
    },
    "thai": {
        "fish sauce", "coconut milk", "lemongrass", "galangal",
        "thai basil", "kaffir lime", "chili", "shrimp paste",
        "pad thai sauce", "tamarind", "jasmine rice",
    },
    "mediterranean": {
        "olive oil", "feta", "olives", "lemon", "garlic", "hummus",
        "tahini", "chickpeas", "cucumber", "tomato", "oregano",
        "mint", "za'atar", "couscous", "pita",
    },
    "american": {
        "bacon", "cheddar", "bbq sauce", "ketchup", "mustard",
        "hot dogs", "burger", "bun", "ranch dressing", "buffalo sauce",
        "sweet potato", "cornbread", "maple syrup",
    },
    "french": {
        "butter", "cream", "dijon mustard", "thyme", "rosemary",
        "tarragon", "shallot", "white wine", "brie", "gruyere",
        "baguette", "cognac", "herbes de provence",
    },
    "korean": {
        "gochujang", "kimchi", "sesame oil", "soy sauce", "doenjang",
        "rice wine", "scallion", "garlic", "ginger", "napa cabbage",
        "rice", "sesame seeds", "daikon", "perilla",
    },
}


# =============================================================================
# Recipe Grounding — LLM Prompts
# =============================================================================

RECIPE_CONSTRAINTS_SYSTEM_PROMPT = (
    "Extract cooking constraints from the user's message. "
    "Return structured data: cuisine preference, mood/style, dietary restrictions, "
    "time limit, servings, skill level, and any ingredients they specifically want "
    "to include or exclude. If a field is not mentioned, leave it as null/empty."
)

BRAINSTORM_SYSTEM_PROMPT = """\
You are a creative cooking assistant. Given the user's available ingredients \
and constraints, suggest 3-4 recipe ideas.

Rules:
- Each idea should be a recipe name (2-5 words), not a full recipe
- Prioritize ingredients marked as expiring soon
- Match the cuisine/mood if specified
- Only suggest recipes that can realistically be made with 60%+ of the listed ingredients
- Format: conversational text with **bold** recipe names in a numbered list
- End with a prompt like "Which one sounds good?" or "Want me to make any of these?"\
"""

GROUNDED_RECIPE_SYSTEM_PROMPT = """\
Generate a complete recipe card for "{recipe_name}".

Constraints: {constraints_json}
Priority ingredients (expiring soon — use first): {priority_items}
Supporting ingredients available: {supporting_items}
Context: {context}

Generate a full recipe with:
- title, description
- ingredients list with quantities/units
- step-by-step instructions
- prep_time_minutes, cook_time_minutes, total_time_minutes
- difficulty (easy/medium/hard)
- servings
- cuisine, meal_type, dietary_tags
- tips

Prioritize using the listed available ingredients. \
For any missing ingredients, suggest pantry substitutes where possible.\
"""


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

        suggested_mode = detect_mode_suggestion(response_text, state.get("input_mode", "chat"))

        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "assistant_message": response_text,
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 1.0,
            "workflow_status": WorkflowStatus.COMPLETED.value,
            "suggested_mode": suggested_mode,
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

        suggested_mode = detect_mode_suggestion(response_text, state.get("input_mode", "chat"))

        return {
            **state,
            "intent": Intent.COOKING_HELP.value,
            "assistant_message": response_text,
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 1.0,
            "workflow_status": WorkflowStatus.COMPLETED.value,
            "suggested_mode": suggested_mode,
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
# Recipe Grounding — Helpers
# =============================================================================


def is_recipe_generation_request(state: WorkflowState) -> bool:
    """Distinguish 'what can I make?' from 'how long do I bake chicken?'"""
    # In recipe mode, always generate a recipe
    if state.get("input_mode") == "recipe":
        return True

    text_lower = state.get("input_text", "").lower()
    generation_keywords = [
        "what can i make",
        "what can i cook",
        "what should i make",
        "dinner idea",
        "lunch idea",
        "meal idea",
        "recipe for",
        "suggest a meal",
        "recipes with",
        "with what i have",
        "what's for dinner",
        "i'm feeling",
        "in the mood for",
        "surprise me",
        "what to cook",
        "make for dinner",
        "make for lunch",
        "under 30",
        "under 20",
        "under 15",
        "quick dinner",
        "quick lunch",
        "quick meal",
        "fast dinner",
        "fast meal",
        "easy dinner",
        "easy meal",
        "simple dinner",
        "simple meal",
        "healthy dinner",
        "healthy meal",
        "make me",
        "cook me",
        "something to eat",
        "what to make",
    ]
    return any(kw in text_lower for kw in generation_keywords)


def detect_brainstorm_followup(state: WorkflowState) -> bool:
    """Return True if the last assistant message had intent=recipe_brainstorm."""
    history: list[dict[str, Any]] = state.get("conversation_history") or []
    if not history:
        return False
    for turn in reversed(history):
        if turn.get("role") == "assistant":
            return turn.get("intent") == Intent.RECIPE_BRAINSTORM.value
    return False


def extract_selected_recipe(
    user_text: str,
    history: list[dict[str, Any]],
) -> str:
    """Extract which recipe the user selected from the last brainstorm response."""
    from rapidfuzz import fuzz  # local import — optional dep already in pyproject.toml

    brainstorm_text = ""
    for turn in reversed(history):
        if turn.get("role") == "assistant" and turn.get("intent") == Intent.RECIPE_BRAINSTORM.value:
            brainstorm_text = turn.get("content", "")
            break

    # Extract **bold** recipe names from brainstorm
    ideas: list[str] = re.findall(r"\*\*(.+?)\*\*", brainstorm_text)

    if not ideas:
        return user_text  # fallback: use raw user text as recipe name

    ordinal_map = {
        "first": 0, "second": 1, "third": 2, "fourth": 3,
        "1st": 0, "2nd": 1, "3rd": 2, "4th": 3,
        "one": 0, "two": 1, "three": 2, "four": 3,
    }
    text_lower = user_text.lower()

    for word, idx in ordinal_map.items():
        if word in text_lower and idx < len(ideas):
            return ideas[idx]

    if any(kw in text_lower for kw in ["surprise", "any", "random", "you pick", "all of them"]):
        return ideas[0]

    # Fuzzy match against idea names
    best_match = max(ideas, key=lambda idea: fuzz.partial_ratio(text_lower, idea.lower()))
    if fuzz.partial_ratio(text_lower, best_match.lower()) > 50:
        return best_match

    return user_text


def score_and_rank(
    pantry_items: list[dict[str, Any]],
    constraints: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    Deterministically score and rank pantry items for recipe grounding.

    Scoring:
    - days_until_expiry <= 3: +10
    - days_until_expiry <= 7: +5
    - item name matches cuisine keywords: +3
    - item in preferred_ingredients: +5
    - item in excluded_ingredients: -100
    """
    cuisine = (constraints.get("cuisine") or "").lower()
    preferred = {p.lower() for p in (constraints.get("preferred_ingredients") or [])}
    excluded = {e.lower() for e in (constraints.get("excluded_ingredients") or [])}
    cuisine_keywords = CUISINE_INGREDIENTS.get(cuisine, set())

    today = date.today()
    scored = []

    for item in pantry_items:
        name_lower = (item.get("name") or "").lower()
        score = 0.0

        # Expiry urgency
        expiry_str = item.get("expiry_date")
        if expiry_str:
            try:
                expiry = date.fromisoformat(str(expiry_str))
                days_left = (expiry - today).days
                if days_left <= 3:
                    score += 10
                elif days_left <= 7:
                    score += 5
            except (ValueError, TypeError):
                pass

        # Cuisine match
        if cuisine_keywords and any(kw in name_lower for kw in cuisine_keywords):
            score += 3

        # User preference
        if any(p in name_lower or name_lower in p for p in preferred):
            score += 5

        # Exclusion
        if any(e in name_lower or name_lower in e for e in excluded):
            score -= 100

        scored.append({**item, "_score": score})

    scored.sort(key=lambda x: x.get("_score", 0), reverse=True)
    return scored[:15]


# =============================================================================
# Recipe Grounding — Workflow Nodes
# =============================================================================


async def extract_recipe_constraints(state: WorkflowState) -> WorkflowState:
    """Node: Extract recipe constraints from user message via structured LLM call."""
    input_text = state.get("input_text", "")
    ai_manager = get_ai_manager()
    logger.info("Extracting recipe constraints", extra={"message_preview": input_text[:80]})

    try:
        result = await ai_manager.complete(
            prompt=RECIPE_CONSTRAINTS_SYSTEM_PROMPT + "\n\nUser message: " + input_text,
            response_schema=RecipeConstraints,
            temperature=0.1,
        )
        if isinstance(result, RecipeConstraints):
            constraints = result.model_dump()
        else:
            constraints = {}
    except Exception as e:
        logger.warning("Constraint extraction failed (using empty constraints): %s", e)
        constraints = {}

    return {
        **state,
        "recipe_constraints": constraints,
    }


async def score_pantry_ingredients(state: WorkflowState) -> WorkflowState:
    """Node: Score and rank pantry items by expiry urgency + constraint match."""
    pantry_items: list[dict[str, Any]] = state.get("pantry_snapshot") or []
    constraints: dict[str, Any] = state.get("recipe_constraints") or {}
    logger.info("Scoring pantry ingredients", extra={"constraints": constraints})

    # Fetch from DB if no snapshot was passed in
    if not pantry_items:
        try:
            repo = await get_repository()
            db_items = await repo.get_all_pantry_items()
            pantry_items = [it.model_dump(mode="json") for it in db_items]
        except Exception as e:
            logger.warning("Could not fetch pantry for scoring: %s", e)

    scored = score_and_rank(pantry_items, constraints)

    return {
        **state,
        "scored_pantry_items": scored,
    }


async def brainstorm_recipe_ideas(state: WorkflowState) -> WorkflowState:
    """Node: Generate 3-4 recipe ideas based on pantry + constraints."""
    input_text = state.get("input_text", "")
    scored_items: list[dict[str, Any]] = state.get("scored_pantry_items") or []
    constraints: dict[str, Any] = state.get("recipe_constraints") or {}

    # Build ingredient summary for the prompt
    if scored_items:
        expiring = [i for i in scored_items if i.get("_score", 0) >= 10]
        supporting = [
            i for i in scored_items
            if i.get("_score", 0) < 10 and i.get("_score", 0) >= 0
        ]
        expiring_str = ", ".join(i.get("name", "") for i in expiring[:5])
        supporting_str = ", ".join(i.get("name", "") for i in supporting[:10])
        pantry_context = f"\nExpiring soon (prioritize): {expiring_str or 'none'}"
        pantry_context += f"\nOther available: {supporting_str or 'none'}"
    else:
        pantry_context = "\nNo pantry items available — suggest general recipes."

    constraints_str = ""
    if constraints.get("cuisine"):
        constraints_str += f"\nCuisine preference: {constraints['cuisine']}"
    if constraints.get("mood"):
        constraints_str += f"\nMood/style: {constraints['mood']}"
    if constraints.get("dietary"):
        constraints_str += f"\nDietary: {', '.join(constraints['dietary'])}"
    if constraints.get("max_time_minutes"):
        constraints_str += f"\nMax time: {constraints['max_time_minutes']} minutes"
    if constraints.get("excluded_ingredients"):
        constraints_str += f"\nExclude: {', '.join(constraints['excluded_ingredients'])}"

    history_context = format_history_context(state)
    mode_prefix = get_mode_prefix(state)
    prompt = (
        mode_prefix
        + BRAINSTORM_SYSTEM_PROMPT
        + pantry_context
        + constraints_str
        + "\n\n"
        + history_context
        + f"User: {input_text}\n\nSuggest 3-4 recipes:"
    )

    ai_manager = get_ai_manager()
    try:
        result = await ai_manager.complete(prompt=prompt, temperature=0.7)
        response_text = (
            result if isinstance(result, str) else getattr(result, "response", str(result))
        )
    except NoProviderAvailableError:
        response_text = (
            "I'd love to suggest some recipes, but no AI provider is configured. "
            "Please add a Gemini API key or start Ollama."
        )
    except Exception as e:
        logger.error("Brainstorm error: %s", e)
        response_text = "Sorry, I ran into an error generating recipe ideas. Please try again."

    # Extract recipe names from bold text for state
    ideas = re.findall(r"\*\*(.+?)\*\*", response_text)

    return {
        **state,
        "intent": Intent.RECIPE_BRAINSTORM.value,
        "assistant_message": response_text,
        "brainstorm_ideas": ideas,
        "next_action": NextAction.PICK_RECIPE.value,
        "proposal": None,
        "requires_review": False,
        "confidence": 1.0,
        "workflow_status": WorkflowStatus.COMPLETED.value,
        "suggested_action": NextAction.PICK_RECIPE.value,
    }


async def research_recipe(state: WorkflowState) -> WorkflowState:
    """Node: Search DuckDuckGo for the selected recipe, store grounding context."""
    recipe_name: str = state.get("selected_recipe_name") or state.get("input_text", "")
    constraints: dict[str, Any] = state.get("recipe_constraints") or {}
    cuisine_tag = constraints.get("cuisine")

    search_result = await search_recipe(recipe_name, cuisine_tag=cuisine_tag)

    return {
        **state,
        "web_search_result": search_result.model_dump() if search_result else None,
    }


async def generate_grounded_recipe(state: WorkflowState) -> WorkflowState:
    """Node: Generate full structured recipe using research + pantry context."""
    import json as _json

    recipe_name: str = state.get("selected_recipe_name") or state.get("input_text", "recipe")
    logger.info("Generating grounded recipe", extra={"recipe_name": recipe_name})
    constraints: dict[str, Any] = state.get("recipe_constraints") or {}
    scored_items: list[dict[str, Any]] = state.get("scored_pantry_items") or []
    web_result: dict[str, Any] | None = state.get("web_search_result")

    # If pantry wasn't scored yet (direct recipe_card path), try to load & score now
    if not scored_items:
        pantry_snapshot: list[dict[str, Any]] = state.get("pantry_snapshot") or []
        if not pantry_snapshot:
            try:
                repo = await get_repository()
                items = await repo.get_all_pantry_items()
                pantry_snapshot = [i.model_dump(mode="json") for i in items]
            except Exception as e:
                logger.warning("Could not fetch pantry for recipe generation: %s", e)
        if pantry_snapshot:
            scored_items = score_and_rank(pantry_snapshot, constraints)

    priority_items = [i.get("name", "") for i in scored_items if i.get("_score", 0) >= 5]
    supporting_items = [
        i.get("name", "") for i in scored_items
        if 0 <= i.get("_score", 0) < 5
    ]

    context = ""
    if web_result and web_result.get("snippet"):
        context = web_result["snippet"][:400]
    else:
        context = "Use your culinary knowledge to create an authentic recipe."

    constraints_json = _json.dumps({k: v for k, v in constraints.items() if v})
    prompt = GROUNDED_RECIPE_SYSTEM_PROMPT.format(
        recipe_name=recipe_name,
        constraints_json=constraints_json,
        priority_items=", ".join(priority_items[:8]) or "none specified",
        supporting_items=", ".join(supporting_items[:10]) or "none",
        context=context,
    )

    ai_manager = get_ai_manager()
    try:
        result = await ai_manager.complete(
            prompt=prompt,
            response_schema=LLMRecipeResult,
            temperature=0.5,
        )
        if not isinstance(result, LLMRecipeResult):
            raise ValueError("Unexpected response type from AI provider")
        llm_result = result
    except Exception as e:
        logger.error("Grounded recipe generation failed: %s", e)
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "assistant_message": (
                f"Sorry, I couldn't generate a recipe for '{recipe_name}'. "
                "Please try again."
            ),
            "next_action": NextAction.NONE.value,
            "proposal": None,
            "requires_review": False,
            "confidence": 0.5,
            "errors": state.get("errors", []) + [f"Recipe generation error: {e}"],
            "workflow_status": WorkflowStatus.COMPLETED.value,
        }

    # Build RecipeCard from LLM result
    ingredients_list: list[Ingredient] = []
    for ing_dict in llm_result.ingredients:
        if isinstance(ing_dict, dict):
            ingredients_list.append(
                Ingredient(
                    name=ing_dict.get("name", ""),
                    quantity=ing_dict.get("quantity"),
                    unit=ing_dict.get("unit"),
                    preparation=ing_dict.get("preparation"),
                    optional=ing_dict.get("optional", False),
                    substitutes=ing_dict.get("substitutes", []),
                )
            )

    recipe_card = RecipeCard(
        title=llm_result.title,
        description=llm_result.description,
        prep_time_minutes=llm_result.prep_time_minutes,
        cook_time_minutes=llm_result.cook_time_minutes,
        total_time_minutes=llm_result.total_time_minutes,
        servings=llm_result.servings,
        ingredients=ingredients_list,
        instructions=llm_result.instructions,
        cuisine=llm_result.cuisine,
        meal_type=llm_result.meal_type,
        dietary_tags=llm_result.dietary_tags,
        difficulty=llm_result.difficulty,
        tips=llm_result.tips,
    )
    logger.info(
        "Recipe card generated",
        extra={
            "title": recipe_card.title,
            "ingredient_count": len(ingredients_list),
            "step_count": len(llm_result.instructions),
            "confidence": llm_result.confidence,
        },
    )

    # Compute ingredient_availability against pantry
    pantry_names = {i.get("name", "").lower() for i in scored_items}
    availability: list[IngredientAvailability] = []
    missing: list[str] = []
    available: list[str] = []

    for ing in ingredients_list:
        ing_lower = ing.name.lower()
        if any(p in ing_lower or ing_lower in p for p in pantry_names):
            matched = next(
                (
                    i.get("name") for i in scored_items
                    if i.get("name", "").lower() in ing_lower
                    or ing_lower in i.get("name", "").lower()
                ),
                None,
            )
            availability.append(IngredientAvailability(
                name=ing.name,
                status="have",
                pantry_item_name=matched,
            ))
            available.append(ing.name)
        elif ing.substitutes:
            # Check if any substitute is in pantry
            sub_match = next(
                (
                    s for s in ing.substitutes
                    if any(p in s.lower() or s.lower() in p for p in pantry_names)
                ),
                None,
            )
            if sub_match:
                availability.append(IngredientAvailability(
                    name=ing.name,
                    status="substitute",
                    pantry_item_name=sub_match,
                    substitute_note=f"use {sub_match} instead",
                ))
            else:
                availability.append(IngredientAvailability(name=ing.name, status="missing"))
                missing.append(ing.name)
        else:
            availability.append(IngredientAvailability(name=ing.name, status="missing"))
            missing.append(ing.name)

    pantry_match_score = len(available) / len(ingredients_list) if ingredients_list else 0.0

    proposal = RecipeCardProposal(
        recipe=recipe_card,
        pantry_match_score=pantry_match_score,
        missing_ingredients=missing,
        available_ingredients=available,
    )

    avail_dicts = [a.model_dump() for a in availability]

    envelope = create_recipe_envelope(
        proposal=proposal,
        confidence=llm_result.confidence,
        field_confidences={},
        warnings=state.get("warnings", []),
        errors=state.get("errors", []),
        assistant_message=f"Here's a recipe for {recipe_card.title}!",
        request_id=state.get("request_id"),
        workflow_id=state.get("workflow_id"),
    )

    return {
        **state,
        "intent": Intent.RECIPE_CARD.value,
        "assistant_message": envelope.assistant_message,
        "next_action": NextAction.REVIEW_PROPOSAL.value,
        "proposal": proposal,
        "requires_review": True,
        "confidence": llm_result.confidence,
        "ingredient_availability": avail_dicts,
        "workflow_status": WorkflowStatus.AWAITING_REVIEW.value,
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
