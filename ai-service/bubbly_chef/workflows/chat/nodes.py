"""
Chat and cooking-help graph nodes.

Contains the node functions (and their helpers/prompts) for:
- general_chat_response: general conversational AI responses
- cooking_help_response: pantry-aware cooking suggestions (ReAct loop)
"""

import logging
from datetime import date
from typing import Any

import bubbly_chef.tools.cooking  # noqa: F401 — registers check_pantry on import
from bubbly_chef.ai.manager import AIManager, NoProviderAvailableError
from bubbly_chef.api.deps import get_ai_manager
from bubbly_chef.models.base import Intent, NextAction, WorkflowStatus
from bubbly_chef.models.proposals import RecipeAmendmentDetection
from bubbly_chef.repository.supabase_repo import get_repository
from bubbly_chef.tools.registry import get_tool, get_tool_schemas
from bubbly_chef.workflows.state import WorkflowState
from pydantic import ValidationError

logger = logging.getLogger(__name__)

# Maximum ReAct loop iterations (hard safety valve — prevents runaway cost/latency).
MAX_ITERATIONS = 5

# Names of tools available in the cooking_help ReAct loop (v1: check_pantry only).
_COOKING_TOOL_NAMES = ["check_pantry"]


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


# ─── Cook handoff: recipe the user is actively cooking ───────────────────────

COOKING_RECIPE_KEY = "cooking_recipe"
# Preferred cook-handoff payload: just the recipe id, resolved server-side from
# the DB. Avoids the client fetch/send race that could pin an empty context.
COOKING_RECIPE_ID_KEY = "cooking_recipe_id"

# Ingredient lines kept out of the prompt beyond this — long imported recipes
# would otherwise crowd out the pantry and history context.
MAX_PROMPT_INGREDIENTS = 25


def get_cooking_recipe(state: WorkflowState) -> dict[str, Any] | None:
    """Return the recipe the user is currently cooking, if any.

    Two sources, in priority order:
    1. The request `context` — the client sends this on the first message after
       the Cook flow hands off to chat.
    2. The session metadata — where `update_session_node` pins it so later
       turns in the same conversation keep the recipe without resending it.
    """
    context = state.get("context") or {}
    recipe = context.get(COOKING_RECIPE_KEY)
    if not isinstance(recipe, dict):
        session = state.get("session") or {}
        metadata = session.get("metadata") or {}
        recipe = metadata.get(COOKING_RECIPE_KEY)
    return recipe if isinstance(recipe, dict) else None


def _flatten_ingredient(raw: Any) -> str:
    """Render one ingredient as a display string.

    Client payloads send ingredients already flattened to strings, but a
    server-resolved DB recipe stores them as objects
    ({name, quantity, unit, ...}). Mirror the frontend's `ingredientLines`
    ("<quantity> <unit> <name>", skipping empty parts) so both shapes yield the
    same prompt text.
    """
    if isinstance(raw, dict):
        parts = [raw.get("quantity"), raw.get("unit"), raw.get("name")]
        return " ".join(str(part).strip() for part in parts if str(part or "").strip())
    return str(raw).strip()


def normalize_cooking_recipe(raw: dict[str, Any]) -> dict[str, Any]:
    """Trim a client-supplied cooking recipe down to what prompts/sessions need."""
    raw_ingredients = raw.get("ingredients")
    ingredients: list[str] = []
    if isinstance(raw_ingredients, list):
        ingredients = [
            line
            for item in raw_ingredients[: MAX_PROMPT_INGREDIENTS * 2]
            if (line := _flatten_ingredient(item))
        ]
    recipe_id = raw.get("id")
    return {
        "id": str(recipe_id) if recipe_id is not None else None,
        "title": str(raw.get("title") or "").strip(),
        "ingredients": ingredients,
    }


def format_cooking_recipe_context(state: WorkflowState) -> str:
    """Format the actively-cooked recipe as a compact prompt block.

    Returns an empty string when nothing is pinned, so callers can concatenate
    it unconditionally.
    """
    raw = get_cooking_recipe(state)
    if not raw:
        return ""

    recipe = normalize_cooking_recipe(raw)
    title = recipe["title"]
    if not title:
        return ""

    block = f'\n\nThe user is cooking "{title}" right now.'
    ingredients: list[str] = recipe["ingredients"]
    if ingredients:
        shown = ingredients[:MAX_PROMPT_INGREDIENTS]
        block += " Its ingredients: " + ", ".join(shown)
        if len(ingredients) > len(shown):
            block += f", plus {len(ingredients) - len(shown)} more"
        block += "."
    block += (
        " Assume their questions are about this dish — technique, timing,"
        " substitutions — unless they clearly change the subject."
    )
    return block


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
    recipe_context = format_cooking_recipe_context(state)
    prompt = (
        mode_prefix
        + GENERAL_CHAT_SYSTEM_PROMPT
        + pantry_context
        + recipe_context
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

    If a tool-calling-capable provider is available, runs a hand-rolled ReAct
    loop (reason → act → observe → repeat, up to MAX_ITERATIONS).  Otherwise
    degrades gracefully to the original single-shot completion path so cooking
    help never breaks.
    """
    ai_manager = get_ai_manager()

    # Decide which path to take: ReAct loop or single-shot fallback.
    has_tool_calling = any(p.supports_tool_calling for p in ai_manager.providers)

    if has_tool_calling:
        return await _cooking_help_react(state, ai_manager)
    return await _cooking_help_single_shot(state, ai_manager)


# =============================================================================
# Single-shot (fallback) path — preserved exactly as the pre-R3 implementation
# =============================================================================


def _build_cooking_prompt(
    state: WorkflowState,
    cooking_system: str,
    pantry_context: str,
) -> str:
    """Assemble the full cooking-help prompt from shared context helpers."""
    input_text = state.get("input_text", "")
    user_prompt = f"\n\nUser: {input_text}\n\nRespond helpfully and concisely."
    mode_prefix = get_mode_prefix(state)
    history_context = format_history_context(state)
    recipe_context = format_cooking_recipe_context(state)
    return (
        mode_prefix
        + cooking_system
        + pantry_context
        + recipe_context
        + "\n\n"
        + history_context
        + user_prompt
    )


async def _fetch_pantry_context(state: WorkflowState) -> str:
    """Fetch the user's pantry and return a formatted context block.

    Returns an empty string on any error (non-critical — callers proceed
    without pantry context rather than surfacing an error to the user).
    """
    try:
        repo = await get_repository()
        items = await repo.get_all_pantry_items(state.get("user_id") or "")
        if not items:
            return ""
        expiring = [
            it for it in items
            if it.expiry_date and (it.expiry_date - date.today()).days <= 3
        ]
        pantry_lines = [f"- {it.name} ({it.quantity} {it.unit})" for it in items]
        context = (
            f"\n\nThe user's pantry currently has {len(items)} items:\n"
            + "\n".join(pantry_lines[:30])
        )
        if len(items) > 30:
            context += f"\n... and {len(items) - 30} more items"
        if expiring:
            exp_names = ", ".join(it.name for it in expiring)
            context += f"\n\nEXPIRING SOON (use first!): {exp_names}"
        return context
    except Exception as e:
        logger.warning(f"Could not fetch pantry for cooking help: {e}")
        return ""


_COOKING_SYSTEM_PROMPT = """\
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


_AMENDMENT_DETECTION_PROMPT = """\
You are a structured-output classifier. Given the conversation context below,
determine whether the user's message requests a change to the recipe ingredients.

Pinned recipe ingredients:
{ingredient_list}

User message: {user_message}

Assistant prose reply (already produced): {prose_reply}

If the user requested an ingredient substitution, addition, or removal,
set is_amendment=True and return the FULL amended ingredient list reflecting
that change. If it was a general technique or timing question, set
is_amendment=False.

Return ONLY the JSON fields defined in the schema — no extra text."""


async def _detect_amendment(
    state: WorkflowState,
    ai_manager: AIManager,
    prose_reply: str,
) -> RecipeAmendmentDetection | None:
    """Run a second structured-output pass to detect recipe ingredient amendments.

    Called after the prose reply is produced so there is no added latency to the
    user-visible response. Returns None on any failure so the caller can degrade
    gracefully to prose-only behavior.
    """
    raw_recipe = get_cooking_recipe(state)
    if not raw_recipe:
        # No pinned recipe — amendment detection is not applicable.
        return None

    recipe = normalize_cooking_recipe(raw_recipe)
    ingredients = recipe.get("ingredients") or []
    if not ingredients:
        return None

    ingredient_list = "\n".join(f"- {ing}" for ing in ingredients)
    user_message = state.get("input_text", "")

    prompt = _AMENDMENT_DETECTION_PROMPT.format(
        ingredient_list=ingredient_list,
        user_message=user_message,
        prose_reply=prose_reply,
    )

    try:
        result = await ai_manager.complete(
            prompt=prompt,
            response_schema=RecipeAmendmentDetection,
            temperature=0.0,
        )
        if isinstance(result, RecipeAmendmentDetection):
            return result
        # Some providers return a dict; coerce it.
        if isinstance(result, dict):
            return RecipeAmendmentDetection(**result)
        logger.warning("_detect_amendment: unexpected result type %s", type(result))
        return None
    except (ValueError, TypeError, ValidationError) as exc:
        logger.warning("_detect_amendment failed (degrading to prose-only): %s", exc)
        return None


async def _cooking_help_single_shot(
    state: WorkflowState,
    ai_manager: Any,
) -> WorkflowState:
    """Original single-shot cooking help path (pre-R3 behavior).

    Used as the graceful fallback when no tool-calling-capable provider is
    available.
    """
    pantry_context = await _fetch_pantry_context(state)
    prompt = _build_cooking_prompt(state, _COOKING_SYSTEM_PROMPT, pantry_context)

    try:
        result = await ai_manager.complete(prompt=prompt, temperature=0.7)
        response_text = (
            result if isinstance(result, str) else getattr(result, "response", str(result))
        )
        suggested_mode = detect_mode_suggestion(response_text, state.get("input_mode", "chat"))

        amendment = await _detect_amendment(state, ai_manager, response_text)
        if (
            amendment is not None
            and amendment.is_amendment
            and amendment.amended_ingredients is not None
            and len(amendment.amended_ingredients) > 0
        ):
            return {
                **state,
                "intent": Intent.COOKING_HELP.value,
                "assistant_message": response_text,
                "next_action": NextAction.REVIEW_PROPOSAL.value,
                "proposal": amendment.model_dump(),
                "requires_review": True,
                "confidence": 1.0,
                "workflow_status": WorkflowStatus.AWAITING_REVIEW.value,
                "suggested_mode": suggested_mode,
            }

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


# =============================================================================
# ReAct loop path
# =============================================================================

_COOKING_REACT_SYSTEM_PROMPT = """\
You are a friendly cooking assistant for BubblyChef, a pantry-aware recipe app.

You have access to a tool to check the user's live pantry. Use it when the user
asks about substitutions, whether they have an ingredient, or what they can cook
from their current supplies. For general techniques, timing, and culinary knowledge
you already know — answer directly without calling a tool.

Help the user with:
- Cooking techniques and how-to questions
- Meal ideas and recipe suggestions based on what they have
- Ingredient substitutions (check pantry first, then suggest based on availability)
- Food storage tips
- General culinary advice

Keep responses friendly, concise, and practical. If the user asks what they can
make, prioritize ingredients in the pantry and mention they can switch to Recipe
mode for a full step-by-step recipe."""


def _build_react_initial_message(state: WorkflowState) -> str:
    """Build the initial user message text for the ReAct loop."""
    input_text = state.get("input_text", "")
    mode_prefix = get_mode_prefix(state)
    history_context = format_history_context(state)
    recipe_context = format_cooking_recipe_context(state)
    system_block = mode_prefix + _COOKING_REACT_SYSTEM_PROMPT + recipe_context
    user_block = f"User: {input_text}\n\nRespond helpfully and concisely."
    return system_block + "\n\n" + history_context + user_block


async def _invoke_tool(
    tool_name: str,
    arguments: dict[str, Any],
    user_id: str,
) -> str:
    """Look up a registered tool by name and invoke it, injecting user_id."""
    fn, _ = get_tool(tool_name)
    raw = fn(**arguments, user_id=user_id)
    # Support both sync and async tool functions
    if hasattr(raw, "__await__"):
        result = await raw
    else:
        result = raw
    return str(result)


async def _cooking_help_react(
    state: WorkflowState,
    ai_manager: Any,
) -> WorkflowState:
    """Hand-rolled ReAct loop for cooking-help.

    Loop shape:
        1. Build initial user message.
        2. Call complete_with_tools.
        3. If tool calls returned: invoke each tool, append observations, loop.
        4. If final text returned (or MAX_ITERATIONS hit): break, return answer.

    Safety valve: MAX_ITERATIONS caps the loop so a misbehaving model can't run
    forever and burn tokens/time.
    """
    user_id: str = state.get("user_id") or ""
    tool_schemas = get_tool_schemas(_COOKING_TOOL_NAMES)
    initial_text = _build_react_initial_message(state)

    # Provider-neutral message history.  Anthropic and Gemini require different
    # raw formats for tool-use/result turns, so we store pre-built blocks keyed
    # to the active provider in the loop and let each provider's
    # _messages_to_* do the final translation.
    messages: list[dict[str, Any]] = [{"role": "user", "content": initial_text}]

    last_text: str | None = None
    active_provider_name: str = ""

    try:
        for iteration in range(MAX_ITERATIONS):
            response = await ai_manager.complete_with_tools(
                messages=messages,
                tools=tool_schemas,
                temperature=0.7,
            )

            # Track which provider is handling the loop (for message formatting)
            if ai_manager.current_provider is not None:
                active_provider_name = ai_manager.current_provider.name

            if response.text is not None:
                last_text = response.text
                break

            if not response.tool_calls:
                # Model returned neither text nor tool calls — treat as done
                logger.warning(
                    "ReAct loop got empty response (no text, no tool calls) "
                    f"on iteration {iteration + 1}"
                )
                break

            # --- Execute tool calls and collect observations ---
            is_anthropic = "anthropic" in active_provider_name.lower()

            if is_anthropic:
                # Anthropic: assistant turn = list of tool_use blocks
                assistant_blocks: list[dict[str, Any]] = []
                tool_result_blocks: list[dict[str, Any]] = []

                for tc in response.tool_calls:
                    try:
                        observation = await _invoke_tool(tc.name, tc.arguments, user_id)
                    except Exception as exc:
                        observation = f"Error calling {tc.name}: {exc}"
                        logger.warning(f"Tool {tc.name} failed: {exc}")

                    assistant_blocks.append(
                        {"type": "tool_use", "id": tc.id, "name": tc.name, "input": tc.arguments}
                    )
                    tool_result_blocks.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tc.id,
                            "content": observation,
                        }
                    )

                messages.append({"role": "assistant", "content": assistant_blocks})
                messages.append({"role": "tool_result", "content": tool_result_blocks})

            else:
                # Gemini: assistant turn = functionCall part(s); user turn = functionResponse(s)
                assistant_parts: list[dict[str, Any]] = []
                tool_response_parts: list[dict[str, Any]] = []

                for tc in response.tool_calls:
                    try:
                        observation = await _invoke_tool(tc.name, tc.arguments, user_id)
                    except Exception as exc:
                        observation = f"Error calling {tc.name}: {exc}"
                        logger.warning(f"Tool {tc.name} failed: {exc}")

                    assistant_parts.append(
                        {"functionCall": {"name": tc.name, "args": tc.arguments}}
                    )
                    tool_response_parts.append(
                        {
                            "functionResponse": {
                                "name": tc.name,
                                "response": {"result": observation},
                            }
                        }
                    )

                messages.append({"role": "assistant", "content": assistant_parts})
                messages.append({"role": "tool_result", "content": tool_response_parts})

        # If we exhausted iterations without a final text, use whatever the last
        # text was (may be None if the model never produced one).
        if last_text is None:
            logger.warning(
                f"ReAct loop hit MAX_ITERATIONS ({MAX_ITERATIONS}) without a "
                "final text answer — returning graceful fallback."
            )
            last_text = (
                "I worked through your question but wasn't able to form a complete answer. "
                "Could you rephrase or give me a bit more detail?"
            )

        suggested_mode = detect_mode_suggestion(last_text, state.get("input_mode", "chat"))

        amendment = await _detect_amendment(state, ai_manager, last_text)
        if (
            amendment is not None
            and amendment.is_amendment
            and amendment.amended_ingredients is not None
            and len(amendment.amended_ingredients) > 0
        ):
            return {
                **state,
                "intent": Intent.COOKING_HELP.value,
                "assistant_message": last_text,
                "next_action": NextAction.REVIEW_PROPOSAL.value,
                "proposal": amendment.model_dump(),
                "requires_review": True,
                "confidence": 1.0,
                "workflow_status": WorkflowStatus.AWAITING_REVIEW.value,
                "suggested_mode": suggested_mode,
            }

        return {
            **state,
            "intent": Intent.COOKING_HELP.value,
            "assistant_message": last_text,
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
        logger.error(f"Cooking help ReAct error: {e}")
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

