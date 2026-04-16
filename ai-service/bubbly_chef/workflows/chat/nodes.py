"""
Chat and cooking-help graph nodes.

Contains the node functions (and their helpers/prompts) for:
- general_chat_response: general conversational AI responses
- cooking_help_response: pantry-aware cooking suggestions
"""

import logging
from datetime import date

from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.api.deps import get_ai_manager
from bubbly_chef.models.base import Intent, NextAction, WorkflowStatus
from bubbly_chef.repository.supabase_repo import get_repository
from bubbly_chef.workflows.state import WorkflowState

logger = logging.getLogger(__name__)


# =============================================================================
# LLM Prompts
# =============================================================================

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
# Graph Node Functions
# =============================================================================


async def general_chat_response(state: WorkflowState) -> WorkflowState:
    """
    Node: Generate general chat response using AI (Gemini -> Ollama fallback).
    """
    input_text = state.get("input_text", "")
    no_provider = "no_ai_provider" in state.get("errors", [])

    if no_provider:
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "assistant_message": (
                "No AI provider is configured."
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
        items = await repo.get_all_pantry_items(state.get("user_id", ""))
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
                "No AI provider is configured."
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
        items = await repo.get_all_pantry_items(state.get("user_id", ""))
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
                    f"\n\nEXPIRING SOON (use first!): {exp_names}"
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
                "No AI provider is configured."
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
