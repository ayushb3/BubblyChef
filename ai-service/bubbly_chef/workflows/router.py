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
from collections.abc import AsyncIterator, Hashable
from datetime import UTC, date, datetime, timedelta
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
    PantryProposal,
)
from bubbly_chef.models.proposals import HandoffKind
from bubbly_chef.models.recipe import RecipeCard, RecipeCardProposal, RecipeConstraints
from bubbly_chef.models.session import (
    CookingRecipeSnapshot,
    PendingProposalMemory,
    SessionMode,
)
from bubbly_chef.prompts.router import (
    INTENT_CLASSIFICATION_SYSTEM_PROMPT,
    INTENT_CLASSIFICATION_USER_PROMPT,
    MODE_BIAS_RECIPE_PICKED_PROMPT,
    MODE_BIAS_RECIPE_BROWSING_PROMPT,
    MODE_BIAS_COOKING_PROMPT,
    MODE_BIAS_PANTRY_PROMPT,
)
from bubbly_chef.repository.supabase_repo import SupabaseRepository, get_repository
from bubbly_chef.services.recipe_url_ingestor import ingest_recipe_from_url
from bubbly_chef.workflows.chat.nodes import (
    COOKING_RECIPE_ID_KEY,
    COOKING_RECIPE_KEY,
    GENERAL_CHAT_SYSTEM_PROMPT,
    GENERAL_CHAT_USER_PROMPT,
    _flatten_ingredient,
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
    suggest_specifics,
)
from bubbly_chef.workflows.recipe.nodes import (
    brainstorm_recipe_ideas,
    detect_brainstorm_followup,
    extract_recipe_constraints,
    extract_selected_recipe,
    extract_selected_recipe_by_name,
    generate_grounded_recipe,
    refine_recipe_node,
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

# Rolling cap on session.pending_proposal's two lists — bounds how much
# cross-turn pantry context a single conversation can accumulate in
# session.metadata (persisted to the DB on every pantry-update turn).
_PENDING_PROPOSAL_HISTORY_LIMIT = 20


def _extract_url(text: str) -> str | None:
    m = _URL_RE.search(text)
    return m.group(0) if m else None


def _session_has_picked_recipe(state: WorkflowState) -> bool:
    """Single source of truth for "is a recipe pinned" in RECIPE_EXPLORING (#436
    finding 3).

    Reads ``session.metadata.picked_recipe`` rather than
    ``session.pinned_recipe_id``. The two used to diverge:
    ``update_session_node`` clears ``metadata.picked_recipe`` on a genuinely
    new brainstorm but deliberately leaves ``pinned_recipe_id`` stale (clearing
    it would re-enable the deterministic re-pick path and widen into #415) —
    see the comment above ``session.metadata.picked_recipe = None`` in
    ``update_session_node``. Reading ``pinned_recipe_id`` here meant the
    confirm band and the re-pick gate kept firing as if a recipe were still
    pinned after a fresh brainstorm had cleared it.

    NOT a general "does this session have a pin" check: ``pinned_recipe_id``
    remains the correct field for the COOKING-mode pin (set on cook handoff,
    independent of the recipe_card pick flow) — this helper is only used at
    RECIPE_EXPLORING call sites.
    """
    metadata = (state.get("session") or {}).get("metadata") or {}
    return bool(metadata.get("picked_recipe"))


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
        # Q6: carry the retained brainstorm set into workflow state so a re-pick
        # ("show me the pesto one instead") can resolve against the stored ideas
        # without regeneration, even when conversation_history was truncated.
        # Only seed when the caller didn't already pass a set for this turn.
        loaded_state: WorkflowState = {
            **state,
            "session": session.model_dump(mode="json"),
            "session_mode": session.active_mode.value,
        }
        if not state.get("brainstorm_ideas"):
            loaded_state["brainstorm_ideas"] = list(session.metadata.brainstorm_ideas)
        return loaded_state
    except Exception as e:
        logger.warning(f"Failed to load session: {e}")
        return {**state, "session": None, "session_mode": None}


async def classify_intent(state: WorkflowState) -> WorkflowState:
    """
    Node: Use LLM to classify user intent.

    This determines where to route the conversation.

    Routing priority (highest → lowest):
    1. forced_intent — deterministic override from an explicit UI action (chip tap).
       [Start over] = recipe_brainstorm + set invalidation; [Edit this recipe] = recipe_card.
    2. Empty input — short-circuit to general_chat.
    3. Exit phrase — breaks out of any active mode.
    4. URL shortcut — unambiguous recipe_ingest (no LLM).
    5. Brainstorm set re-pick — re-pick from stored set without regeneration.
    6. LLM classifier — with session-mode bias injected into the prompt.
       Post-classify logic then:
       - RECIPE_EXPLORING + pinned recipe: conservative bias (ambiguous → stay on recipe).
       - RECIPE_EXPLORING + modify-vs-new boundary: confirm band (low/medium → CONFIRM_CHOICE).
       - COOKING mode: only narrow amendments allowed; brainstorm/generation blocked.
       - #408 fix: high-confidence recipe_generation served as generation, not brainstorm.
    """
    input_text = state.get("input_text", "")

    if not input_text.strip():
        return {
            **state,
            "intent": Intent.GENERAL_CHAT.value,
            "intent_confidence": 0.0,
            "errors": state.get("errors", []) + ["Empty input text"],
        }

    # ── Priority 1: forced_intent from an explicit UI action (chip tap) ──────
    # [Start over] chip sends forced_intent=recipe_brainstorm; the set is
    # invalidated below (the chip always wins regardless of confidence).
    # [Edit this recipe] chip sends forced_intent=recipe_card.
    #
    # Allow-list only: recipe_card / recipe_brainstorm are the two chips that
    # exist. recipe_generation is deliberately NOT honoured here — no chip emits
    # it, and accepting it would let a client bypass the COOKING amendment gate
    # (Q3). The ChatRequest.forced_intent Literal already rejects other values at
    # the API boundary; this set is the defence-in-depth check.
    forced_intent_raw = state.get("forced_intent")
    _FORCED_INTENT_ALLOW = {
        Intent.RECIPE_CARD.value,
        Intent.RECIPE_BRAINSTORM.value,
    }
    if forced_intent_raw and forced_intent_raw in _FORCED_INTENT_ALLOW:
        forced = forced_intent_raw
        logger.info(f"classify_intent: forced_intent override via chip: {forced}")
        forced_state: WorkflowState = {
            **state,
            "intent": forced,
            "intent_confidence": 1.0,
            "intent_reasoning": f"Explicit chip override: {forced}",
            "detected_entities": [],
        }
        if forced == Intent.RECIPE_BRAINSTORM.value:
            # [Start over] — invalidate the stored brainstorm set so follow-up
            # turns don't re-pick from a stale menu (Q6).
            forced_state["brainstorm_ideas"] = []
        return forced_state

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

    # ── Priority 3 (URL shortcut — no LLM needed) ──
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

    # ── Priority 4: Brainstorm set re-pick (before LLM) ──
    # Retain brainstorm_ideas across follow-ups; re-pick with no regeneration (Q6).
    # Fires when the last assistant turn was a brainstorm OR (history truncated)
    # when a stored brainstorm set is live AND no recipe is pinned yet — i.e. the
    # user is still browsing the menu.  Once a recipe is pinned the conservative
    # bias applies (follow-ups are modifications, handled by the classifier), so
    # we do NOT let a stored-set fuzzy match hijack "add pesto to it" into a
    # re-pick.
    # A pin makes follow-ups modifications, full stop — neither the
    # last-assistant-was-brainstorm signal nor a live stored set may re-pick.
    # This also seals the confirm-band leak (#416): confirm_choice_response saves
    # its history entry with a telemetry intent of recipe_brainstorm, which would
    # otherwise make detect_brainstorm_followup fire on the *next* turn against the
    # pinned recipe and hijack a modification into a re-pick (#266-flavoured).
    # "Pinned" here is the recipe_card pin (session.metadata.picked_recipe,
    # via _session_has_picked_recipe — #436 finding 3), OR an active COOKING
    # session: COOKING always sets pinned_recipe_id on cook handoff without
    # necessarily setting picked_recipe (e.g. cooking a saved recipe started
    # outside the recipe_card flow), and there is nothing to re-pick from
    # mid-cook regardless.
    stored_ideas = state.get("brainstorm_ideas") or []
    _has_pin = _session_has_picked_recipe(state) or (
        state.get("session_mode") == SessionMode.COOKING.value
    )
    _repick_ok = not _has_pin and (detect_brainstorm_followup(state) or bool(stored_ideas))
    if _repick_ok:
        selected_name = extract_selected_recipe(
            input_text,
            state.get("conversation_history") or [],
            stored_ideas=stored_ideas,
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

    # ── Priority 4b: Pinned re-pick to a DIFFERENT already-offered idea ──
    # Only when a recipe is pinned (not COOKING) and there are stored ideas.
    # Uses name-only matching so positional/ordinal/cardinal references ("the
    # first one", "number two") cannot override a pin — too ambiguous with
    # modification intent. A distinctive-name match that resolves to an idea
    # OTHER than the pinned dish is allowed through; same-dish references fall
    # through to the LLM so "the garlic toast one" still means "tweak this".
    _recipe_pin_only = _session_has_picked_recipe(state) and (
        state.get("session_mode") != SessionMode.COOKING.value
    )
    if _recipe_pin_only and stored_ideas:
        picked_title = (
            (state.get("session") or {})
            .get("metadata", {})
            .get("picked_recipe", {})
            .get("title", "")
            or ""
        )
        name_only_match = extract_selected_recipe_by_name(
            input_text,
            state.get("conversation_history") or [],
            stored_ideas=stored_ideas,
            picked_title=picked_title or None,
        )
        if name_only_match:
            if name_only_match.strip().lower() != picked_title.strip().lower():
                logger.info(
                    f"Intent classified: recipe_card "
                    f"(source=pinned_repick_to_different_idea, selected='{name_only_match}')"
                )
                return {
                    **state,
                    "intent": Intent.RECIPE_CARD.value,
                    "intent_confidence": 0.95,
                    "intent_reasoning": (
                        "Re-pick to a different already-offered idea (pinned session)"
                    ),
                    "detected_entities": [],
                    "selected_recipe_name": name_only_match,
                    "repick_different_idea": True,
                }
        # No name match, ambiguous, or same-dish reference — fall through to LLM

    # ── Priority 5: LLM classifier — with session mode bias injected ──
    ai_manager = get_ai_manager()

    # Build mode-bias context to inject into the prompt as a soft prior.
    # The classifier still reads the full intent list and can override the bias.
    mode_bias_section = _build_mode_bias_prompt(session_mode, state)

    prompt = (
        INTENT_CLASSIFICATION_SYSTEM_PROMPT
        + mode_bias_section
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
        confidence = result.confidence

        logger.info(
            f"Intent classified: {intent} "
            f"(source=llm, confidence={confidence}, llm_intent={result.intent})"
        )
        logger.debug(f"LLM reasoning: {result.reasoning}, entities: {result.entities}")

        # ── Post-classify: mode-aware adjustments ─────────────────────────────

        # COOKING mode gate (Q3/#279): only narrow amendments allowed mid-cook.
        # Full brainstorm/generation is blocked; route to cooking_help instead.
        # This must be explicit — _detect_amendment runs on any cooking-help turn
        # with a pinned recipe, NOT COOKING-scoped; the gate is here.
        # This conversion is UNCONDITIONAL — it runs regardless of the
        # classifier's confidence. The #408 fix (a high-confidence
        # recipe_generation must be served as generation, not downgraded to
        # brainstorm) does not live here; it is the RECIPE_GENERATION
        # fall-through inside the RECIPE_EXPLORING branch below, which this
        # COOKING gate runs BEFORE, not after.
        if session_mode == SessionMode.COOKING.value:
            if intent in (Intent.RECIPE_BRAINSTORM.value, Intent.RECIPE_GENERATION.value):
                logger.info(
                    f"COOKING mode: blocking {intent} → cooking_help "
                    "(brainstorm/generation not reachable mid-cook)"
                )
                intent = Intent.COOKING_HELP.value
                confidence = 0.9
                result = LLMIntentResult(
                    intent="cooking_help",
                    confidence=confidence,
                    reasoning="COOKING mode: brainstorm/generation blocked; route to cooking_help",
                    entities=result.entities,
                )

        # RECIPE_EXPLORING mode: conservative bias + confirm band (Q1/Q2/Q5).
        if session_mode == SessionMode.RECIPE_EXPLORING.value:
            # #436 finding 3: read the same predicate as the re-pick gate
            # above (_session_has_picked_recipe), not pinned_recipe_id — see
            # that helper's docstring for why the two diverge.
            has_pinned = _session_has_picked_recipe(state)

            if intent == Intent.RECIPE_BRAINSTORM.value:
                # Conservative bias (Q2): ambiguous → stay on the recipe.
                # Only exit to brainstorm on explicit "actually something else"
                # phrasing — i.e. the classifier was *unambiguously* asking for
                # new ideas (confidence is already the LLM's own reading).
                if has_pinned and (
                    result.modify_or_new_ambiguous
                    or confidence < settings.confirm_band_confidence_threshold
                ):
                    # Ambiguous — could be modify or new dish; ask rather than guess (Q5).
                    # Primary trigger: LLM set modify_or_new_ambiguous=True (explicit signal).
                    # Secondary trigger: confidence < threshold (belt-and-braces; harmless).
                    # CRITICAL: this must NOT run any generation. We keep the
                    # classifier's intent for logging/telemetry but set
                    # next_action=CONFIRM_CHOICE, which route_by_intent honours
                    # BEFORE reading intent — routing straight to the
                    # confirm_choice node (no extract/score/brainstorm), so the
                    # pick and the stored brainstorm set are preserved (#266/Q6).
                    logger.info(
                        f"RECIPE_EXPLORING confirm band: "
                        f"modify_or_new_ambiguous={result.modify_or_new_ambiguous}, "
                        f"confidence={confidence:.2f} "
                        f"(threshold={settings.confirm_band_confidence_threshold}) "
                        "→ CONFIRM_CHOICE"
                    )
                    return {
                        **state,
                        "intent": Intent.RECIPE_BRAINSTORM.value,
                        "intent_confidence": confidence,
                        "intent_reasoning": result.reasoning,
                        "detected_entities": result.entities,
                        "next_action": NextAction.CONFIRM_CHOICE.value,
                        "requires_review": True,
                        "assistant_message": (
                            "Did you want to tweak this recipe or start fresh with new ideas?"
                        ),
                        # The two one-tap choices the frontend renders as buttons;
                        # each carries the forced_intent to POST back on tap.
                        "confirm_options": [
                            {
                                "label": "Tweak this recipe",
                                "forced_intent": Intent.RECIPE_CARD.value,
                            },
                            {
                                "label": "Start fresh",
                                "forced_intent": Intent.RECIPE_BRAINSTORM.value,
                            },
                        ],
                    }
                # High confidence brainstorm: user clearly wants something new.
                # Invalidate brainstorm set so stale picks aren't offered (Q6).
                logger.info(
                    "RECIPE_EXPLORING: high-confidence brainstorm → "
                    "fresh brainstorm + invalidate set"
                )
                return {
                    **state,
                    "intent": Intent.RECIPE_BRAINSTORM.value,
                    "intent_confidence": confidence,
                    "intent_reasoning": result.reasoning,
                    "detected_entities": result.entities,
                    "brainstorm_ideas": [],  # invalidate stale set (Q6)
                }

            if intent == Intent.RECIPE_CARD.value:
                # Modification follow-up ("make it spicier", "add a fig glaze?").
                # If the LLM set the ambiguity flag, the message is genuinely fuzzy —
                # trigger the confirm band even though the LLM leaned recipe_card.
                if has_pinned and result.modify_or_new_ambiguous:
                    logger.info(
                        f"RECIPE_EXPLORING confirm band: "
                        f"modify_or_new_ambiguous=True on recipe_card "
                        f"(confidence={confidence:.2f}) → CONFIRM_CHOICE"
                    )
                    return {
                        **state,
                        "intent": Intent.RECIPE_CARD.value,
                        "intent_confidence": confidence,
                        "intent_reasoning": result.reasoning,
                        "detected_entities": result.entities,
                        "next_action": NextAction.CONFIRM_CHOICE.value,
                        "requires_review": True,
                        "assistant_message": (
                            "Did you want to tweak this recipe or start fresh with new ideas?"
                        ),
                        "confirm_options": [
                            {
                                "label": "Tweak this recipe",
                                "forced_intent": Intent.RECIPE_CARD.value,
                            },
                            {
                                "label": "Start fresh",
                                "forced_intent": Intent.RECIPE_BRAINSTORM.value,
                            },
                        ],
                    }
                # classifier already returns RECIPE_CARD — just log and pass through.
                logger.info(
                    f"RECIPE_EXPLORING: recipe modification follow-up "
                    f"(confidence={confidence:.2f})"
                )
                selected_name = state.get("selected_recipe_name") or extract_selected_recipe(
                    input_text,
                    state.get("conversation_history") or [],
                )
                return {
                    **state,
                    "intent": Intent.RECIPE_CARD.value,
                    "intent_confidence": confidence,
                    "intent_reasoning": result.reasoning,
                    "detected_entities": result.entities,
                    "selected_recipe_name": selected_name or input_text,
                }

            # #408 fix: high-confidence generation is served as generation even
            # in RECIPE_EXPLORING (user explicitly asked for a new specific recipe).
            if intent == Intent.RECIPE_GENERATION.value:
                logger.info(
                    f"RECIPE_EXPLORING: recipe_generation at confidence={confidence:.2f} "
                    "— serving as generation (#408 fix)"
                )
                # Fall through; no conversion to brainstorm.

            # Other intents (cooking_help, pantry_update, etc.) fall through normally.

        return {
            **state,
            "intent": intent,
            "intent_confidence": confidence,
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


def _build_mode_bias_prompt(session_mode: str | None, state: WorkflowState) -> str:
    """Build a mode-bias section to inject into the classifier prompt as a soft prior.

    This biases the LLM without hard-locking intent — the classifier can still
    return any intent if the evidence is clear.  Mode biasing replaces the old
    mode_intent_map forcing dict (removed in #416).
    """
    if not session_mode or session_mode == SessionMode.DEFAULT.value:
        return ""

    # #436 finding 3: same predicate as classify_intent's confirm band /
    # re-pick gate (_session_has_picked_recipe), not pinned_recipe_id.
    has_pinned = _session_has_picked_recipe(state)

    if session_mode == SessionMode.RECIPE_EXPLORING.value:
        if has_pinned:
            return MODE_BIAS_RECIPE_PICKED_PROMPT
        return MODE_BIAS_RECIPE_BROWSING_PROMPT

    if session_mode == SessionMode.COOKING.value:
        return MODE_BIAS_COOKING_PROMPT

    if session_mode in (SessionMode.INGESTING.value, SessionMode.PANTRY_EDITING.value):
        return MODE_BIAS_PANTRY_PROMPT

    return ""


def route_by_intent(state: WorkflowState) -> str:
    """
    Router: Determine which path to take based on classified intent.

    Returns the name of the next node.
    """
    # CONFIRM_CHOICE short-circuit (#416 Q5): the confirm band emits a one-tap
    # "tweak / start fresh" prompt and must NOT run any recipe generation. This
    # check comes BEFORE the intent dispatch below — the classifier leaves
    # intent=recipe_brainstorm for telemetry, but next_action=CONFIRM_CHOICE
    # routes straight to the non-generating confirm node so the pick and the
    # stored brainstorm set survive (root cause of #266).
    if state.get("next_action") == NextAction.CONFIRM_CHOICE.value:
        return "confirm_choice_response"

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
        # Generation and brainstorm share constraint extraction + pantry scoring;
        # they diverge AFTER score_pantry (see route_after_scoring). Generation
        # yields ONE grounded recipe, not an idea list (#408 / #416 AC4).
        return "extract_recipe_constraints"
    elif intent == Intent.RECIPE_BRAINSTORM.value:
        return "extract_recipe_constraints"
    elif intent == Intent.RECIPE_CARD.value:
        session_metadata = (state.get("session") or {}).get("metadata") or {}
        if state.get("repick_different_idea") and state.get("selected_recipe_name"):
            # Switching to a different already-offered idea is a new dish, not a
            # tweak: refine would keep the pinned recipe's id, so the two cards
            # would share an identity and saving one could overwrite the other.
            return "research_recipe"
        if session_metadata.get("picked_recipe"):
            # A recipe is already pinned in session -- this recipe_card turn is
            # a modification of it ("make it spicier", "add tomato"), not a
            # first pick. Refine the pinned card in place rather than
            # generating an unrelated new dish (#416 AC1).
            return "refine_recipe"
        if state.get("selected_recipe_name"):
            return "research_recipe"
        return "cooking_help_response"  # fallback
    else:
        return "general_chat_response"


def route_after_scoring(state: WorkflowState) -> str:
    """Split the shared constraints+scoring path by intent (#408 / #416 AC4).

    recipe_generation and recipe_brainstorm both run extract_recipe_constraints
    then score_pantry, but they diverge here: generation produces ONE grounded
    recipe (research_recipe -> generate_grounded_recipe), brainstorm produces an
    idea list (brainstorm_recipes). Before this split both intents fell through
    to brainstorm_recipes, so an explicit "recipe for X" was silently served as a
    brainstorm menu and restamped intent=recipe_brainstorm.
    """
    if state.get("intent") == Intent.RECIPE_GENERATION.value:
        return "research_recipe"
    return "brainstorm_recipes"




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


def confirm_choice_response(state: WorkflowState) -> WorkflowState:
    """
    Node: Emit the modify-vs-new confirm prompt WITHOUT running any generation.

    This is the terminal node for the confirm band (#416 Q5). classify_intent has
    already set assistant_message, next_action=CONFIRM_CHOICE and confirm_options;
    this node exists only so the confirm turn has a dedicated non-generating path
    to update_session → END. It deliberately does NOT touch brainstorm_ideas,
    proposal, or the pinned recipe — the pick and the stored set are preserved so
    the follow-up (tweak / start fresh) can act on them (root fix for #266).
    """
    return {
        **state,
        "intent": Intent.RECIPE_BRAINSTORM.value,
        "next_action": NextAction.CONFIRM_CHOICE.value,
        "requires_review": True,
        "workflow_status": WorkflowStatus.AWAITING_REVIEW.value,
        "assistant_message": state.get("assistant_message")
        or "Did you want to tweak this recipe or start fresh with new ideas?",
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
    return resolved


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
            cooking_recipe_dict = normalize_cooking_recipe(raw_cooking_recipe)
            cooking_recipe_snap = CookingRecipeSnapshot.model_validate(cooking_recipe_dict)
            session.active_mode = SessionMode.COOKING
            session.pinned_recipe_id = cooking_recipe_snap.id
            session.metadata.cooking_recipe = cooking_recipe_snap
            await repo.update_session(user_id, session)
            logger.info(
                f"Session pinned to cooking recipe: {old_mode} → cooking "
                f"(recipe_id={cooking_recipe_snap.id})"
            )
            return state

        # Mode transition rules
        if intent in (Intent.RECIPE_BRAINSTORM.value, Intent.RECIPE_GENERATION.value):
            session.active_mode = SessionMode.RECIPE_EXPLORING
            # Q6: invalidate/replace the stored brainstorm set ONLY when a
            # genuinely new brainstorm actually generated ideas this turn. The
            # brainstorm node is the only path that sets next_action=PICK_RECIPE,
            # so that flag distinguishes "new ideas generated" from a bare
            # generation turn or the confirm band (next_action=CONFIRM_CHOICE) —
            # neither of which must clobber the retained set to [] (#266/#416 #4).
            new_ideas = state.get("brainstorm_ideas") or []
            ran_new_brainstorm = (
                state.get("next_action") == NextAction.PICK_RECIPE.value and bool(new_ideas)
            )
            if ran_new_brainstorm:
                session.metadata.brainstorm_ideas = list(new_ideas)
                # A genuinely new brainstorm makes any earlier pin stale by
                # definition -- clear the full picked_recipe so the next pick
                # falls back to research_recipe (a first pick from the new
                # set) instead of "refining" the OLD pinned dish toward an
                # unrelated new pick (#416 AC1 regression). Do NOT clear
                # pinned_recipe_id here -- that would re-enable the
                # deterministic re-pick path and widen this into #415.
                session.metadata.picked_recipe = None
            # else: leave the retained set untouched (do not default-clobber to []).
            # Persist constraints so the follow-up turn (research_recipe) can inherit
            # them even though it bypasses extract_recipe_constraints (#144).
            constraints = state.get("recipe_constraints")
            if constraints:
                session.metadata.recipe_constraints = RecipeConstraints.model_validate(
                    constraints
                )
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
                recipe_obj = getattr(proposal, "recipe", None)
                recipe_id_raw = getattr(recipe_obj, "id", None)
                # Pin the session-local ephemeral RecipeCard uuid so follow-up
                # turns (refine #303, escape-hatch #416) can target the exact
                # card the user picked.
                #
                # NOTE: this id is the RecipeCard's default_factory=uuid4 —
                # it is a SESSION-LOCAL identifier, NOT a persisted DB row id.
                # The recipe is not in the DB until the user explicitly saves it,
                # at which point it gets a different id.  Cross-session references
                # to this pin will be stale; that is accepted and documented
                # (issue #415 design decision).
                session.pinned_recipe_id = str(recipe_id_raw) if recipe_id_raw is not None else None
                session.metadata.last_recipe_title = getattr(recipe_obj, "title", None)
                # Also populate the typed cooking_recipe snapshot so the pin
                # lives in the typed SessionContext and is readable by prompt
                # nodes without string-parsing pinned_recipe_id.  Mirror the
                # COOKING handoff at router.py:681–685.
                if recipe_obj is not None:
                    raw_ingredients = getattr(recipe_obj, "ingredients", None) or []
                    flat_ingredients = [
                        line
                        for ing in raw_ingredients
                        if (line := _flatten_ingredient(
                            ing.model_dump() if hasattr(ing, "model_dump") else ing
                        ))
                    ]
                    session.metadata.cooking_recipe = CookingRecipeSnapshot(
                        id=str(recipe_id_raw) if recipe_id_raw is not None else None,
                        title=str(getattr(recipe_obj, "title", "") or "").strip(),
                        ingredients=flat_ingredients,
                    )
                    # Also carry the FULL recipe card (ingredients w/ quantities +
                    # instructions) so a later recipe_card follow-up can refine it
                    # in place via generate_recipe(previous_recipe=...) instead of
                    # generating an unrelated new dish (#416 AC1). cooking_recipe
                    # above is deliberately left as-is -- COOKING mode + prompt
                    # nodes still read it.
                    session.metadata.picked_recipe = (
                        recipe_obj
                        if isinstance(recipe_obj, RecipeCard)
                        else RecipeCard.model_validate(recipe_obj)
                    )
                # Keep constraints alive across further refinement turns.
                constraints = state.get("recipe_constraints")
                if constraints:
                    session.metadata.recipe_constraints = RecipeConstraints.model_validate(
                        constraints
                    )
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
                existing = session.pending_proposal or PendingProposalMemory()
                merged_items = _merge_dedup_case_insensitive(
                    existing.item_names, item_names
                )
                merged_terms = _merge_dedup_case_insensitive(
                    existing.unclear_terms, unclear_terms
                )

                # Build / update the suggestions map: term.lower() → list of
                # concrete suggestions produced by suggest_specifics this turn.
                # Kept so the resolution filter below (issue #342) can check
                # overlap against actual suggestion lists rather than guessing.
                existing_suggestions: dict[str, list[str]] = existing.suggestions
                new_suggestions: dict[str, list[str]] = {
                    item["term"].lower(): item["suggestions"]
                    for item in state.get("clarification_suggestions", [])
                    if isinstance(item, dict)
                    and isinstance(item.get("term"), str)
                    and isinstance(item.get("suggestions"), list)
                }
                merged_suggestions = {**existing_suggestions, **new_suggestions}

                # Issue #342 — drop resolved terms from unclear_terms.
                # A term is resolved when at least one of ITS OWN suggestions
                # appears in this turn's action names (case-insensitive). This
                # mirrors exactly what the frontend filterResolvedTerms does.
                # A term the user never addressed (e.g. "vegetables" when the
                # user only added "eggs") must NOT be dropped — only terms
                # where the user picked a concrete item from that term's pill
                # row are removed.
                if item_names:
                    action_names_lower = {n.lower() for n in item_names}
                    resolved: set[str] = set()
                    for term in merged_terms:
                        term_suggestions = merged_suggestions.get(term.lower(), [])
                        if any(s.lower() in action_names_lower for s in term_suggestions):
                            resolved.add(term.lower())
                            matched = [
                                s for s in term_suggestions
                                if s.lower() in action_names_lower
                            ]
                            logger.info(
                                f"unclear_term '{term}' resolved via "
                                f"matched suggestions: {matched}"
                            )
                    merged_terms = [t for t in merged_terms if t.lower() not in resolved]
                    # Also remove resolved terms from the suggestions map.
                    merged_suggestions = {
                        k: v for k, v in merged_suggestions.items() if k not in resolved
                    }

                # When all vague terms are resolved (there were some before and
                # now none remain), clear pending_proposal entirely so
                # review_gate no longer prepends the context note. A turn
                # that never had any unclear terms (merged_terms was already
                # empty) must NOT clear pending_proposal — it still needs to
                # carry the item_names for context continuity.
                had_unclear_terms = bool(existing.unclear_terms)
                if merged_items and not merged_terms and had_unclear_terms:
                    session.pending_proposal = None
                    logger.info(
                        "pending_proposal cleared: all unclear_terms resolved"
                    )
                elif merged_items or merged_terms:
                    sliced_terms = merged_terms[-_PENDING_PROPOSAL_HISTORY_LIMIT:]
                    # Prune suggestions to only the terms that survived slicing,
                    # so orphaned entries never accumulate in the JSON column.
                    surviving_keys = {t.lower() for t in sliced_terms}
                    pruned_suggestions = {
                        k: v for k, v in merged_suggestions.items()
                        if k in surviving_keys
                    }
                    session.pending_proposal = PendingProposalMemory(
                        item_names=merged_items[-_PENDING_PROPOSAL_HISTORY_LIMIT:],
                        unclear_terms=sliced_terms,
                        suggestions=pruned_suggestions,
                    )
            else:
                session.active_mode = SessionMode.DEFAULT
                session.pending_proposal = None

        elif intent == Intent.COOKING_HELP.value:
            # Belt-and-suspenders: if brainstorm_ideas exist in state, the brainstorm
            # pipeline ran. BUT only flip to RECIPE_EXPLORING when the session is NOT
            # already COOKING — in COOKING mode the intent is gated at classify_intent,
            # so brainstorm_ideas appearing does not mean the user left the recipe.
            #
            # NOTE: this branch never clobbers the stored set to [] (it only writes
            # when ideas are present), so the Q6 no-clobber concern (#416 #4) does
            # not apply here — that was the RECIPE_BRAINSTORM/RECIPE_GENERATION
            # branch above, which now gates its overwrite on a genuinely-new
            # brainstorm (next_action=PICK_RECIPE).
            if state.get("brainstorm_ideas") and old_mode != SessionMode.COOKING.value:
                session.active_mode = SessionMode.RECIPE_EXPLORING
                session.metadata.brainstorm_ideas = state.get("brainstorm_ideas", [])
                constraints = state.get("recipe_constraints")
                if constraints:
                    session.metadata.recipe_constraints = RecipeConstraints.model_validate(
                        constraints
                    )
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


def _dispatch_passthrough(state: WorkflowState) -> WorkflowState:
    """No-op entry node for the post-classification graph variant.

    The streaming path classifies once up front (initialize → load_session →
    classify_intent, run manually) and then resumes the graph from here so the
    LLM classification is NOT recomputed (#416 #2). route_by_intent reads the
    already-set intent / next_action off the incoming state.
    """
    return state


def build_chat_router_graph(
    entry_point: str = "initialize",
) -> StateGraph[WorkflowState]:
    """
    Build the ChatRouterGraph workflow.

    Args:
        entry_point: "initialize" (default — full pipeline, used by the
            non-streaming path and by run_chat_workflow) or "dispatch" (resume
            from an already-classified state, used by the streaming path so
            classify_intent is not run a second time — #416 #2).

    Flow:
    1. initialize_state: Set up IDs and defaults
    2. classify_intent: Determine what the user wants
    3. Route based on intent:
       - pantry_update: parse -> normalize -> expiry -> dedup -> actions -> review_gate
         -> suggest_specifics -> finalize
       - receipt/product/recipe: build_handoff_*
       - recipe_generation / recipe_brainstorm: extract_constraints -> score_pantry
         -> route_after_scoring splits by intent: recipe_generation ->
         research_recipe -> generate_grounded_recipe -> END; recipe_brainstorm ->
         brainstorm_recipes -> END (#408 / #416 AC4)
       - recipe_card (first pick from brainstorm): research_recipe -> generate_grounded_recipe -> END
       - recipe_card (follow-up on an already-pinned recipe, #416 AC1): refine_recipe -> END
       - general_chat: generate response
    """
    workflow = StateGraph(WorkflowState)

    # Classification prefix — only present on the full-pipeline entry. The
    # streaming path classifies once up front and enters at `dispatch`, so these
    # nodes are omitted there entirely (no orphaned/unreachable nodes).
    if entry_point == "initialize":
        workflow.add_node("initialize", initialize_state)
        workflow.add_node("load_session", load_session)
        workflow.add_node("classify_intent", classify_intent)
    else:
        # Alternate entry for the streaming path — resume post-classification.
        workflow.add_node("dispatch", _dispatch_passthrough)

    # Pantry update path
    workflow.add_node("parse_pantry_items", parse_pantry_items)
    workflow.add_node("normalize", normalize_items)
    workflow.add_node("expiry", apply_expiry_heuristics)
    workflow.add_node("dedup_check", check_for_duplicates)
    workflow.add_node("create_actions", create_actions)
    workflow.add_node("review_gate", review_gate)
    workflow.add_node("suggest_specifics", suggest_specifics)
    workflow.add_node("finalize_pantry", finalize_pantry_proposal)

    # Handoff paths
    workflow.add_node("build_handoff_receipt", build_handoff_receipt)
    workflow.add_node("build_handoff_product", build_handoff_product)
    workflow.add_node("build_handoff_recipe", build_handoff_recipe)

    # General chat path
    workflow.add_node("general_chat_response", general_chat_response)

    # Confirm band (#416 Q5) — non-generating terminal node for CONFIRM_CHOICE
    workflow.add_node("confirm_choice_response", confirm_choice_response)

    # Cooking help path
    workflow.add_node("cooking_help_response", cooking_help_response)

    # Recipe grounding path (brainstorm)
    workflow.add_node("extract_recipe_constraints", extract_recipe_constraints)
    workflow.add_node("score_pantry", score_pantry_ingredients)
    workflow.add_node("brainstorm_recipes", brainstorm_recipe_ideas)

    # Recipe grounding path (grounded generation — brainstorm follow-up)
    workflow.add_node("research_recipe", research_recipe)
    workflow.add_node("generate_grounded_recipe", generate_grounded_recipe)

    # Refine-in-place path (recipe_card follow-up on an already-pinned
    # recipe — #416 AC1). Terminal node, mirrors generate_grounded_recipe.
    workflow.add_node("refine_recipe", refine_recipe_node)

    # Session update (converge point before END)
    workflow.add_node("update_session", update_session_node)

    # Set entry point
    workflow.set_entry_point(entry_point)

    # Route map shared by both entry points (classify_intent and dispatch).
    # Typed as dict[Hashable, str] to satisfy StateGraph.add_conditional_edges.
    _route_map: dict[Hashable, str] = {
        "parse_pantry_items": "parse_pantry_items",
        "build_handoff_receipt": "build_handoff_receipt",
        "build_handoff_product": "build_handoff_product",
        "build_handoff_recipe": "build_handoff_recipe",
        "cooking_help_response": "cooking_help_response",
        "general_chat_response": "general_chat_response",
        "extract_recipe_constraints": "extract_recipe_constraints",
        "research_recipe": "research_recipe",
        "refine_recipe": "refine_recipe",
        "confirm_choice_response": "confirm_choice_response",
    }

    if entry_point == "initialize":
        # Full pipeline: initialize → load_session → classify_intent → route.
        workflow.add_edge("initialize", "load_session")
        workflow.add_edge("load_session", "classify_intent")
        workflow.add_conditional_edges("classify_intent", route_by_intent, _route_map)
    else:
        # Streaming resume: dispatch reads the intent/next_action already on the
        # incoming classified state and routes to the same targets — no
        # re-classification (#416 #2).
        workflow.add_conditional_edges("dispatch", route_by_intent, _route_map)

    # Pantry update path edges
    workflow.add_edge("parse_pantry_items", "normalize")
    workflow.add_edge("normalize", "expiry")
    workflow.add_edge("expiry", "dedup_check")
    workflow.add_edge("dedup_check", "create_actions")
    workflow.add_edge("create_actions", "review_gate")
    workflow.add_edge("review_gate", "suggest_specifics")
    workflow.add_edge("suggest_specifics", "finalize_pantry")
    workflow.add_edge("finalize_pantry", "update_session")

    # Handoff paths → update_session → END
    workflow.add_edge("build_handoff_receipt", "update_session")
    workflow.add_edge("build_handoff_product", "update_session")
    workflow.add_edge("build_handoff_recipe", "update_session")

    # General chat → update_session → END
    workflow.add_edge("general_chat_response", "update_session")

    # Cooking help → update_session → END
    workflow.add_edge("cooking_help_response", "update_session")

    # Confirm band → update_session → END (no generation runs)
    workflow.add_edge("confirm_choice_response", "update_session")

    # Brainstorm path → update_session → END
    # Shared prefix: constraints + pantry scoring. Then split by intent —
    # generation → single grounded recipe, brainstorm → idea list (#408/#416 AC4).
    workflow.add_edge("extract_recipe_constraints", "score_pantry")
    workflow.add_conditional_edges(
        "score_pantry",
        route_after_scoring,
        {
            "research_recipe": "research_recipe",
            "brainstorm_recipes": "brainstorm_recipes",
        },
    )
    workflow.add_edge("brainstorm_recipes", "update_session")

    # Grounded generation path → update_session → END
    workflow.add_edge("research_recipe", "generate_grounded_recipe")
    workflow.add_edge("generate_grounded_recipe", "update_session")

    # Refine-in-place path → update_session → END (terminal, like grounded
    # generation — #416 AC1)
    workflow.add_edge("refine_recipe", "update_session")

    # Single converge point
    workflow.add_edge("update_session", END)

    return workflow


# Compiled graph (singletons)
_chat_router_graph = None
_chat_dispatch_graph = None


def get_chat_router_graph() -> CompiledStateGraph[Any, Any, Any, Any]:
    """Get or create the compiled chat router graph (full pipeline entry)."""
    global _chat_router_graph
    if _chat_router_graph is None:
        _chat_router_graph = build_chat_router_graph().compile()
    return _chat_router_graph


def get_chat_dispatch_graph() -> CompiledStateGraph[Any, Any, Any, Any]:
    """Get or create the post-classification graph (entry point = dispatch).

    Used by the streaming path to resume from an already-classified state so
    classify_intent (an LLM call) is not run a second time — the streamed
    decision and the enveloped decision cannot diverge (#416 #2).
    """
    global _chat_dispatch_graph
    if _chat_dispatch_graph is None:
        _chat_dispatch_graph = build_chat_router_graph(entry_point="dispatch").compile()
    return _chat_dispatch_graph


# =============================================================================
# Public API
# =============================================================================


def workflow_input_text(
    message: str, forced_intent: str | None, forced_intent_source: str | None
) -> str:
    """The text the workflow acts on for this turn.

    A confirm-band tap posts its button label ("Tweak this recipe") as the
    message so the thread reads naturally, and sends the request that raised the
    band as ``forced_intent_source``. The refine / brainstorm must run against
    that request — otherwise "hmm what about something with mushrooms" becomes a
    refine of the literal words "Tweak this recipe".
    """
    if forced_intent and forced_intent_source and forced_intent_source.strip():
        return forced_intent_source
    return message


async def run_chat_workflow(
    message: str,
    conversation_id: str | None = None,
    mode: str = "text",
    pantry_snapshot: list[dict[str, Any]] | None = None,
    history: list[dict[str, Any]] | None = None,
    user_id: str | None = None,
    context: dict[str, Any] | None = None,
    forced_intent: str | None = None,
    forced_intent_source: str | None = None,
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
        "input_text": workflow_input_text(message, forced_intent, forced_intent_source),
        "input_type": "chat",
        "input_mode": mode,
        "pantry_snapshot": pantry_snapshot,
        "conversation_history": history or [],
        "context": context,
        "forced_intent": forced_intent,
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

        pantry_envelope = create_pantry_envelope(
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
        pantry_envelope.metadata["clarification_suggestions"] = final_state.get(
            "clarification_suggestions", []
        )
        return pantry_envelope

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
        # Confirm band (#416 Q5) — surface the CONFIRM_CHOICE decision + options.
        if final_state.get("next_action") == NextAction.CONFIRM_CHOICE.value:
            envelope.next_action = NextAction.CONFIRM_CHOICE
            envelope.requires_review = True
            envelope.metadata["confirm_options"] = final_state.get("confirm_options", [])
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
        envelope.metadata["clarification_suggestions"] = final_state.get(
            "clarification_suggestions", []
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

    # Confirm band (#416 Q5): carry the CONFIRM_CHOICE next_action + the two
    # one-tap options into the envelope so the frontend can render the buttons.
    # create_general_chat_envelope hardcodes next_action=NONE / requires_review
    # =False, so override them here for the confirm turn.
    if final_state.get("next_action") == NextAction.CONFIRM_CHOICE.value:
        envelope.next_action = NextAction.CONFIRM_CHOICE
        envelope.requires_review = True
        envelope.metadata["confirm_options"] = final_state.get("confirm_options", [])
    return envelope


async def run_chat_workflow_streaming(
    message: str,
    conversation_id: str | None = None,
    mode: str = "text",
    pantry_snapshot: list[dict[str, Any]] | None = None,
    history: list[dict[str, Any]] | None = None,
    user_id: str | None = None,
    context: dict[str, Any] | None = None,
    forced_intent: str | None = None,
    forced_intent_source: str | None = None,
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

    # Post-classification graph: resumes at `dispatch`, so classify_intent is not
    # rerun on the graph path (#416 #2). We classify once, manually, below and
    # feed the resulting state straight in.
    dispatch_graph = get_chat_dispatch_graph()

    initial_state: WorkflowState = {
        "request_id": str(uuid4()),
        "workflow_id": str(uuid4()),
        "conversation_id": conversation_id,
        "user_id": user_id,
        "input_text": workflow_input_text(message, forced_intent, forced_intent_source),
        "input_type": "chat",
        "input_mode": mode,
        "pantry_snapshot": pantry_snapshot,
        "conversation_history": history or [],
        "context": context,
        "forced_intent": forced_intent,
        "warnings": [],
        "errors": [],
    }
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
        # Resume the graph from the already-classified state with the recipe-mode
        # override applied; dispatch reads this intent and routes to generation.
        # No re-classification, so the streamed decision and enveloped decision
        # cannot diverge (#416 #2). next_action is cleared so a stale CONFIRM_CHOICE
        # cannot short-circuit the forced generation path.
        dispatch_state: WorkflowState = {
            **classified_state,
            "intent": intent,
            "next_action": NextAction.NONE.value,
        }
        final_state = await dispatch_graph.ainvoke(dispatch_state)
        env = _build_envelope_from_state(final_state, message, conversation_id)
        yield _json.dumps({"type": "envelope", "data": env.model_dump(mode="json")})
        return

    if intent not in streamable_intents:
        # Non-streamable (incl. the confirm band and forced_intent results): resume
        # the graph from the classified state — never re-invoke from raw
        # initial_state, which would recompute classify_intent and discard the
        # confirm/forced-intent decision (#416 #2).
        final_state = await dispatch_graph.ainvoke(classified_state)
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
