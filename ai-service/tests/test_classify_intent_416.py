"""Table-driven tests for classify_intent — #416 classifier-primary routing.

Tests cover:
- Mode × confidence band matrix (design seam #1, required acceptance criterion)
- All six acceptance criteria from issue #416 / #274 Q1–Q6:
  1. Pick → "make it spicier" / "add a fig glaze?" → refines in place, not brainstorm (#266)
  2. "actually something else" / forced_intent=brainstorm → fresh brainstorm
  3. Low/medium confidence on modify-vs-new → CONFIRM_CHOICE, not auto-act (#274 Q5)
  4. High-confidence recipe_generation served as generation, not brainstorm (#408)
  5. Mid-cook brainstorm/generation blocked → cooking_help (#279)
  6. Re-pick prior idea → no regen; set invalidated only on new brainstorm (Q6)

The AI manager is mocked throughout — no live provider required.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.base import Intent, NextAction
from bubbly_chef.models.session import SessionMode
from bubbly_chef.workflows.router import classify_intent, route_by_intent
from bubbly_chef.workflows.state import LLMIntentResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _state(**kwargs):
    """Minimal WorkflowState for classify_intent tests."""
    base = {
        "input_text": "",
        "errors": [],
        "warnings": [],
        "session_mode": None,
        "session": None,
        "conversation_history": [],
        "selected_recipe_name": None,
        "brainstorm_ideas": [],
        "forced_intent": None,
    }
    base.update(kwargs)
    return base


def _llm_result(
    intent: str, confidence: float = 0.9, modify_or_new_ambiguous: bool = False
) -> LLMIntentResult:
    return LLMIntentResult(
        intent=intent,
        confidence=confidence,
        reasoning="test",
        entities=[],
        modify_or_new_ambiguous=modify_or_new_ambiguous,
    )


def _mock_ai(intent: str, confidence: float = 0.9, modify_or_new_ambiguous: bool = False):
    """Return a context manager that patches get_ai_manager."""
    ai = MagicMock()
    ai.complete = AsyncMock(
        return_value=_llm_result(intent, confidence, modify_or_new_ambiguous)
    )
    manager = MagicMock(return_value=ai)
    return patch("bubbly_chef.workflows.router.get_ai_manager", manager)


def _session_with_pin(recipe_id: str = "pin-123") -> dict:
    """Simulate a session dict with a pinned recipe (post-#415).

    Sets BOTH pinned_recipe_id and metadata.picked_recipe. classify_intent's
    "is a recipe pinned" checks (confirm band, re-pick gate, mode-bias prompt)
    read metadata.picked_recipe, not pinned_recipe_id (#436 finding 3) — the
    two diverge only in the specific stale-pin regression exercised by
    test_new_brainstorm_clears_stale_picked_recipe_pin below.
    """
    return {
        "pinned_recipe_id": recipe_id,
        "metadata": {"picked_recipe": {"title": "Test Recipe", "id": recipe_id}},
    }


# ---------------------------------------------------------------------------
# AC1: Pick → modification follow-up → refines in place, not brainstorm (#266)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_make_it_spicier_routes_to_recipe_card_not_brainstorm():
    """'make it spicier' after picking a recipe → RECIPE_CARD, never RECIPE_BRAINSTORM."""
    with _mock_ai("recipe_card", confidence=0.9):
        result = await classify_intent(
            _state(
                input_text="make it spicier",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_pin(),
            )
        )
    assert result["intent"] == Intent.RECIPE_CARD.value
    assert result.get("next_action") != NextAction.CONFIRM_CHOICE.value


@pytest.mark.asyncio
async def test_add_fig_glaze_question_routes_to_recipe_card():
    """'add a fig glaze?' — a modification phrased as a question → RECIPE_CARD (not prefix-matched, must use classifier)."""
    with _mock_ai("recipe_card", confidence=0.9):
        result = await classify_intent(
            _state(
                input_text="add a fig glaze?",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_pin(),
            )
        )
    assert result["intent"] == Intent.RECIPE_CARD.value


@pytest.mark.asyncio
async def test_no_cheese_routes_to_recipe_card():
    """'no cheese' → RECIPE_CARD (classic modification)."""
    with _mock_ai("recipe_card", confidence=0.92):
        result = await classify_intent(
            _state(
                input_text="no cheese",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_pin(),
            )
        )
    assert result["intent"] == Intent.RECIPE_CARD.value


@pytest.mark.asyncio
async def test_spicier_please_routes_to_recipe_card():
    """'spicier please' — didn't start with a prefix; old code would miss it → now uses classifier."""
    with _mock_ai("recipe_card", confidence=0.88):
        result = await classify_intent(
            _state(
                input_text="spicier please",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_pin(),
            )
        )
    assert result["intent"] == Intent.RECIPE_CARD.value


# ---------------------------------------------------------------------------
# AC2: "actually something else" → fresh brainstorm; [Start over] chip always does
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_actually_something_else_high_confidence_starts_fresh_brainstorm():
    """High-confidence brainstorm intent in RECIPE_EXPLORING → new brainstorm + invalidate set."""
    with _mock_ai("recipe_brainstorm", confidence=0.92):
        result = await classify_intent(
            _state(
                input_text="actually something else please",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_pin(),
                brainstorm_ideas=["Pasta Carbonara", "Pesto Pasta"],
            )
        )
    assert result["intent"] == Intent.RECIPE_BRAINSTORM.value
    # Brainstorm set MUST be invalidated (Q6)
    assert result.get("brainstorm_ideas") == []


@pytest.mark.asyncio
async def test_forced_intent_brainstorm_chip_always_routes_fresh_brainstorm():
    """[Start over] chip: forced_intent=recipe_brainstorm bypasses classifier + invalidates set."""
    with _mock_ai("recipe_card") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="start over",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_pin(),
                brainstorm_ideas=["Pasta Carbonara", "Pesto Pasta"],
                forced_intent=Intent.RECIPE_BRAINSTORM.value,
            )
        )
    # LLM must NOT be called for forced_intent
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_BRAINSTORM.value
    assert result["intent_confidence"] == 1.0
    # Brainstorm set invalidated by [Start over] (Q6)
    assert result.get("brainstorm_ideas") == []


@pytest.mark.asyncio
async def test_forced_intent_recipe_card_chip_routes_to_recipe_card():
    """[Edit this recipe] chip: forced_intent=recipe_card bypasses classifier."""
    with _mock_ai("recipe_brainstorm") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="edit this",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                forced_intent=Intent.RECIPE_CARD.value,
            )
        )
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_CARD.value
    assert result["intent_confidence"] == 1.0


# ---------------------------------------------------------------------------
# AC3: Low/medium confidence → CONFIRM_CHOICE, not auto-act (#274 Q5)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "confidence,expect_confirm",
    [
        (0.50, True),   # low → confirm
        (0.70, True),   # medium → confirm
        (0.84, True),   # just below threshold (0.85) → confirm
        (0.85, False),  # at threshold → auto-act
        (0.95, False),  # high → auto-act
        (1.00, False),  # forced chip → auto-act (not tested here, but boundary check)
    ],
)
@pytest.mark.asyncio
async def test_confirm_band_fires_on_low_medium_confidence_brainstorm(
    confidence: float, expect_confirm: bool
):
    """
    In RECIPE_EXPLORING with a pinned recipe, brainstorm intent at low/medium confidence
    → CONFIRM_CHOICE (ask user); at high confidence → auto-act (brainstorm).
    """
    with _mock_ai("recipe_brainstorm", confidence=confidence):
        result = await classify_intent(
            _state(
                input_text="show me something else",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_pin(),
            )
        )
    assert result["intent"] == Intent.RECIPE_BRAINSTORM.value
    if expect_confirm:
        assert result.get("next_action") == NextAction.CONFIRM_CHOICE.value
        assert result.get("requires_review") is True
    else:
        assert result.get("next_action") != NextAction.CONFIRM_CHOICE.value


@pytest.mark.asyncio
async def test_confirm_band_not_fired_without_pinned_recipe():
    """Without a pinned recipe, no confirm band — brainstorm proceeds normally."""
    with _mock_ai("recipe_brainstorm", confidence=0.60):
        result = await classify_intent(
            _state(
                input_text="show me something else",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=None,  # no pinned recipe
            )
        )
    assert result["intent"] == Intent.RECIPE_BRAINSTORM.value
    assert result.get("next_action") != NextAction.CONFIRM_CHOICE.value


# ---------------------------------------------------------------------------
# AC3 (flag-based trigger): modify_or_new_ambiguous fires the band regardless
# of whether the LLM leaned recipe_card or recipe_brainstorm (#416 AC3 fix)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ambiguous_flag_recipe_card_lean_triggers_confirm_band():
    """
    Pinned session + modify_or_new_ambiguous=True, LLM intent recipe_card →
    CONFIRM_CHOICE with two typed options (flag is the primary trigger, not confidence).
    """
    with _mock_ai("recipe_card", confidence=0.9, modify_or_new_ambiguous=True):
        result = await classify_intent(
            _state(
                input_text="hmm what about something with mushrooms",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_pin(),
            )
        )
    assert result.get("next_action") == NextAction.CONFIRM_CHOICE.value
    assert result.get("requires_review") is True
    options = result.get("confirm_options") or []
    assert len(options) == 2
    forced = {o["forced_intent"] for o in options}
    assert forced == {Intent.RECIPE_CARD.value, Intent.RECIPE_BRAINSTORM.value}


@pytest.mark.asyncio
async def test_ambiguous_flag_recipe_brainstorm_lean_triggers_confirm_band():
    """
    Pinned session + modify_or_new_ambiguous=True, LLM intent recipe_brainstorm →
    CONFIRM_CHOICE (flag fires from either lean).
    """
    with _mock_ai("recipe_brainstorm", confidence=0.9, modify_or_new_ambiguous=True):
        result = await classify_intent(
            _state(
                input_text="what about a pasta dish?",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_pin(),
            )
        )
    assert result.get("next_action") == NextAction.CONFIRM_CHOICE.value
    assert result.get("requires_review") is True
    options = result.get("confirm_options") or []
    assert len(options) == 2
    forced = {o["forced_intent"] for o in options}
    assert forced == {Intent.RECIPE_CARD.value, Intent.RECIPE_BRAINSTORM.value}


@pytest.mark.asyncio
async def test_no_ambiguous_flag_high_confidence_recipe_card_not_confirm():
    """
    modify_or_new_ambiguous=False + confidence=0.9, intent recipe_card, pinned →
    NOT CONFIRM_CHOICE (clear tweaks still act directly; regression floor).
    """
    with _mock_ai("recipe_card", confidence=0.9, modify_or_new_ambiguous=False):
        result = await classify_intent(
            _state(
                input_text="make it spicier",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_pin(),
            )
        )
    assert result["intent"] == Intent.RECIPE_CARD.value
    assert result.get("next_action") != NextAction.CONFIRM_CHOICE.value


# ---------------------------------------------------------------------------
# AC4: High-confidence recipe_generation → served as generation, not brainstorm (#408)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_high_confidence_recipe_generation_served_as_generation():
    """High-confidence recipe_generation is NOT downgraded to brainstorm (#408)."""
    with _mock_ai("recipe_generation", confidence=1.0):
        result = await classify_intent(
            _state(input_text="give me a recipe for chicken tikka masala")
        )
    assert result["intent"] == Intent.RECIPE_GENERATION.value


@pytest.mark.asyncio
async def test_recipe_generation_in_recipe_exploring_not_downgraded():
    """
    Recipe generation inside RECIPE_EXPLORING must NOT be downgraded to brainstorm.
    User explicitly asked for a new specific recipe — the mode should not suppress it.
    """
    with _mock_ai("recipe_generation", confidence=0.95):
        result = await classify_intent(
            _state(
                input_text="give me a pasta carbonara recipe",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_pin(),
            )
        )
    assert result["intent"] == Intent.RECIPE_GENERATION.value


# ---------------------------------------------------------------------------
# AC5: Mid-cook brainstorm/generation blocked → cooking_help (#279)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "llm_intent",
    [Intent.RECIPE_BRAINSTORM.value, Intent.RECIPE_GENERATION.value],
)
@pytest.mark.asyncio
async def test_cooking_mode_blocks_brainstorm_and_generation(llm_intent: str):
    """
    In COOKING mode, brainstorm and generation from the LLM are blocked.
    They route to cooking_help instead (Q3/#279).
    """
    with _mock_ai(llm_intent, confidence=0.9):
        result = await classify_intent(
            _state(
                input_text="what should I make next?",
                session_mode=SessionMode.COOKING.value,
            )
        )
    assert result["intent"] == Intent.COOKING_HELP.value


@pytest.mark.asyncio
async def test_cooking_mode_allows_cooking_help():
    """In COOKING mode, cooking_help passes through normally."""
    with _mock_ai("cooking_help", confidence=0.9):
        result = await classify_intent(
            _state(
                input_text="how long should I simmer the sauce?",
                session_mode=SessionMode.COOKING.value,
            )
        )
    assert result["intent"] == Intent.COOKING_HELP.value


@pytest.mark.asyncio
async def test_cooking_mode_exit_phrase_breaks_out():
    """Exit phrase still breaks out of COOKING mode (unchanged behaviour)."""
    result = await classify_intent(
        _state(input_text="exit", session_mode=SessionMode.COOKING.value)
    )
    assert result["intent"] == Intent.GENERAL_CHAT.value
    assert result.get("_exit_mode") is True


# ---------------------------------------------------------------------------
# AC6: Brainstorm set lifecycle — re-pick from stored set, no regen (Q6)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_brainstorm_followup_repick_uses_stored_set_no_regen():
    """
    'show me the pesto one instead' re-picks from the stored brainstorm set
    via extract_selected_recipe — NO regeneration.
    The brainstorm_ideas list must NOT be cleared.

    Note: extract_selected_recipe finds ideas from **bold** recipe names in the
    prior assistant message; the history must be formatted accordingly.
    """
    history = [
        {
            "role": "assistant",
            "content": "Here are some ideas: **Pesto Pasta**, **Carbonara**, **Tomato Soup**",
            "intent": "recipe_brainstorm",
        }
    ]
    with _mock_ai("recipe_card") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="show me the pesto one",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=None,  # no pin — browsing set
                brainstorm_ideas=["Pesto Pasta", "Carbonara", "Tomato Soup"],
                conversation_history=history,
            )
        )
    # LLM should NOT be called — the brainstorm followup shortcut catches this
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_CARD.value
    assert result.get("selected_recipe_name") == "Pesto Pasta"
    # Set must NOT be invalidated on a re-pick
    # (state is read-through; brainstorm_ideas key is unchanged from input)


@pytest.mark.asyncio
async def test_pinned_recipe_blocks_repick_even_after_confirm_turn():
    """
    Regression (#416 finding #1d): the confirm-band turn saves its assistant
    history entry with a telemetry intent of ``recipe_brainstorm``. On the NEXT
    turn detect_brainstorm_followup would fire on that intent — but a recipe is
    pinned, so the follow-up is a modification, never a re-pick. The stored-set
    fuzzy match must NOT hijack it, even though the follow-up text names a stored
    idea. Routes to the LLM classifier (recipe_card here), not the re-pick shortcut.
    """
    history = [
        {
            "role": "assistant",
            "content": "Did you want to tweak this recipe or start fresh with new ideas?",
            "intent": "recipe_brainstorm",  # telemetry-only value from confirm turn
        }
    ]
    with _mock_ai("recipe_card") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="make the Pesto Pasta one spicier",  # names a stored idea
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_pin(),  # PINNED
                brainstorm_ideas=["Pesto Pasta", "Carbonara", "Tomato Soup"],
                conversation_history=history,
            )
        )
    # Re-pick shortcut must be skipped — classifier runs (not the 0.95-confidence
    # "Follow-up to recipe brainstorm" shortcut that would fire without the LLM).
    mock_mgr.return_value.complete.assert_awaited_once()
    assert result["intent"] == Intent.RECIPE_CARD.value
    assert result.get("intent_reasoning") != "Follow-up to recipe brainstorm"


@pytest.mark.asyncio
async def test_brainstorm_set_invalidated_on_new_brainstorm():
    """A genuinely new brainstorm (high confidence) invalidates the stored set (Q6)."""
    with _mock_ai("recipe_brainstorm", confidence=0.92):
        result = await classify_intent(
            _state(
                input_text="actually, show me vegetarian options instead",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_pin(),
                brainstorm_ideas=["Pasta Carbonara", "Beef Stew"],
            )
        )
    assert result["intent"] == Intent.RECIPE_BRAINSTORM.value
    assert result.get("brainstorm_ideas") == []  # invalidated


# ---------------------------------------------------------------------------
# #436 finding 1: the widened re-pick gate (`or bool(stored_ideas)`) must not
# hijack ordinary turns. extract_selected_recipe's old loose substring/fuzzy
# matcher misrouted these to recipe_card *before* the LLM classifier ever ran
# (reproduced against pre-fix bubbly_chef.workflows.recipe.nodes with
# ideas=['Pesto Pasta', 'Chicken Curry', 'Tomato Soup']:
#   'how many eggs do I need'      -> 'Pesto Pasta'  ("any" substring of "many")
#   'is any of this gluten free'   -> 'Pesto Pasta'
#   'add tomato soup to my pantry' -> 'Tomato Soup'
#   'I bought chicken curry paste' -> 'Chicken Curry'
# ). Genuine re-picks (demonstrative / ordinal / explicit selection language)
# must still resolve from the stored set with no regeneration (issue #410
# Implementation Decisions §5, Q6).
# ---------------------------------------------------------------------------

_STORED_IDEAS_436 = ["Pesto Pasta", "Chicken Curry", "Tomato Soup"]


@pytest.mark.parametrize(
    "input_text,mocked_llm_intent",
    [
        ("how many eggs do I need", "cooking_help"),
        ("is any of this gluten free", "cooking_help"),
        ("add tomato soup to my pantry", "pantry_update"),
        ("I bought chicken curry paste", "pantry_update"),
    ],
)
@pytest.mark.asyncio
async def test_repick_gate_does_not_hijack_ordinary_turns(
    input_text: str, mocked_llm_intent: str
):
    """These must reach the LLM classifier, not short-circuit to recipe_card.

    Pre-fix: the repick shortcut fired on every one of these (see reproduction
    above) and never called the LLM at all — this test asserts the LLM WAS
    called, which fails against the pre-fix code (it isn't; the shortcut
    returns before Priority 5 / the LLM call).
    """
    with _mock_ai(mocked_llm_intent) as mock_mgr:
        result = await classify_intent(
            _state(
                input_text=input_text,
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=None,  # no pin — still browsing the stored set
                brainstorm_ideas=list(_STORED_IDEAS_436),
                conversation_history=[],  # widened trigger path: stored_ideas alone
            )
        )
    mock_mgr.return_value.complete.assert_called_once()
    assert result["intent"] != Intent.RECIPE_CARD.value


@pytest.mark.parametrize(
    "input_text,expected_selection",
    [
        ("show me the pesto one instead", "Pesto Pasta"),
        ("let's do the pesto one", "Pesto Pasta"),
        ("the second one", "Chicken Curry"),
    ],
)
@pytest.mark.asyncio
async def test_repick_gate_still_resolves_genuine_selections(
    input_text: str, expected_selection: str
):
    """Genuine re-picks must still resolve from the stored set with NO
    regeneration — the narrowed matcher must not overcorrect into blocking
    these (issue #410 §5)."""
    with _mock_ai("cooking_help") as mock_mgr:  # would be the wrong answer if reached
        result = await classify_intent(
            _state(
                input_text=input_text,
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=None,
                brainstorm_ideas=list(_STORED_IDEAS_436),
                conversation_history=[],
            )
        )
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_CARD.value
    assert result.get("selected_recipe_name") == expected_selection


# ---------------------------------------------------------------------------
# Table-driven matrix: mode × confidence × expected_intent × expect_confirm
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "session_mode,llm_intent,confidence,expected_intent,expect_confirm",
    [
        # DEFAULT mode — LLM result passes through unchanged
        (None, "recipe_brainstorm", 0.9, Intent.RECIPE_BRAINSTORM.value, False),
        (None, "recipe_generation", 0.9, Intent.RECIPE_GENERATION.value, False),
        (None, "recipe_card", 0.9, Intent.RECIPE_CARD.value, False),
        (None, "cooking_help", 0.9, Intent.COOKING_HELP.value, False),
        (None, "pantry_update", 0.9, Intent.PANTRY_UPDATE.value, False),
        # RECIPE_EXPLORING + pinned + RECIPE_CARD (modification) — passes through
        (SessionMode.RECIPE_EXPLORING.value, "recipe_card", 0.9, Intent.RECIPE_CARD.value, False),
        (SessionMode.RECIPE_EXPLORING.value, "recipe_card", 0.5, Intent.RECIPE_CARD.value, False),
        # RECIPE_EXPLORING + pinned + RECIPE_BRAINSTORM low conf → confirm
        (SessionMode.RECIPE_EXPLORING.value, "recipe_brainstorm", 0.60, Intent.RECIPE_BRAINSTORM.value, True),
        (SessionMode.RECIPE_EXPLORING.value, "recipe_brainstorm", 0.70, Intent.RECIPE_BRAINSTORM.value, True),
        (SessionMode.RECIPE_EXPLORING.value, "recipe_brainstorm", 0.84, Intent.RECIPE_BRAINSTORM.value, True),
        # RECIPE_EXPLORING + pinned + RECIPE_BRAINSTORM high conf → auto-act
        (SessionMode.RECIPE_EXPLORING.value, "recipe_brainstorm", 0.90, Intent.RECIPE_BRAINSTORM.value, False),
        # RECIPE_EXPLORING + pinned + RECIPE_GENERATION → passes through (#408 fix)
        (SessionMode.RECIPE_EXPLORING.value, "recipe_generation", 0.95, Intent.RECIPE_GENERATION.value, False),
        # COOKING mode: brainstorm → cooking_help
        (SessionMode.COOKING.value, "recipe_brainstorm", 0.9, Intent.COOKING_HELP.value, False),
        # COOKING mode: generation → cooking_help
        (SessionMode.COOKING.value, "recipe_generation", 0.9, Intent.COOKING_HELP.value, False),
        # COOKING mode: cooking_help passes through
        (SessionMode.COOKING.value, "cooking_help", 0.9, Intent.COOKING_HELP.value, False),
        # INGESTING mode: pantry_update passes through (mode bias, LLM can still override)
        (SessionMode.INGESTING.value, "pantry_update", 0.9, Intent.PANTRY_UPDATE.value, False),
    ],
)
@pytest.mark.asyncio
async def test_mode_confidence_matrix(
    session_mode: str | None,
    llm_intent: str,
    confidence: float,
    expected_intent: str,
    expect_confirm: bool,
):
    """Table-driven matrix: mode × confidence → resolved intent + confirm flag (seam #1)."""
    state = _state(
        input_text="test message",
        session_mode=session_mode,
        session=_session_with_pin() if session_mode == SessionMode.RECIPE_EXPLORING.value else None,
    )
    with _mock_ai(llm_intent, confidence=confidence):
        result = await classify_intent(state)

    assert result["intent"] == expected_intent, (
        f"mode={session_mode}, llm={llm_intent}, conf={confidence}: "
        f"expected {expected_intent}, got {result['intent']}"
    )
    if expect_confirm:
        assert result.get("next_action") == NextAction.CONFIRM_CHOICE.value, (
            f"mode={session_mode}, conf={confidence}: expected CONFIRM_CHOICE"
        )
    else:
        assert result.get("next_action") != NextAction.CONFIRM_CHOICE.value


# ---------------------------------------------------------------------------
# Mode bias prompt sanity — LLM is called (not short-circuited) for modes
# that used to hard-force intent but now bias instead (INGESTING, PANTRY_EDITING)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ingesting_mode_uses_llm_not_hard_forced():
    """INGESTING mode used to hard-force pantry_update; now it biases the LLM.
    Classifier result still wins — here we confirm LLM IS called."""
    with _mock_ai("pantry_update") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="milk, eggs, butter",
                session_mode=SessionMode.INGESTING.value,
            )
        )
    mock_mgr.return_value.complete.assert_called_once()
    assert result["intent"] == Intent.PANTRY_UPDATE.value


@pytest.mark.asyncio
async def test_pantry_editing_mode_uses_llm_not_hard_forced():
    """PANTRY_EDITING mode also biases (not hard-forces) via LLM."""
    with _mock_ai("pantry_update") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="remove the expired yogurt",
                session_mode=SessionMode.PANTRY_EDITING.value,
            )
        )
    mock_mgr.return_value.complete.assert_called_once()
    assert result["intent"] == Intent.PANTRY_UPDATE.value


@pytest.mark.asyncio
async def test_cooking_mode_uses_llm_not_hard_forced():
    """COOKING mode now uses LLM (with cooking_help bias), not hard-forcing."""
    with _mock_ai("cooking_help") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="how long should I cook this?",
                session_mode=SessionMode.COOKING.value,
            )
        )
    mock_mgr.return_value.complete.assert_called_once()
    assert result["intent"] == Intent.COOKING_HELP.value


@pytest.mark.asyncio
async def test_recipe_exploring_uses_llm_not_hard_forced():
    """RECIPE_EXPLORING with pinned recipe uses LLM for modification phrased as question."""
    with _mock_ai("recipe_card") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="what if I used maple syrup instead?",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_pin(),
            )
        )
    mock_mgr.return_value.complete.assert_called_once()
    assert result["intent"] == Intent.RECIPE_CARD.value


# ---------------------------------------------------------------------------
# Regression: forced_intent unknown value is ignored (falls through to LLM)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_forced_intent_falls_through_to_llm():
    """An unrecognised forced_intent value is silently ignored; LLM is used."""
    with _mock_ai("cooking_help") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="how hot for the pan?",
                forced_intent="some_unknown_intent",
            )
        )
    mock_mgr.return_value.complete.assert_called_once()
    assert result["intent"] == Intent.COOKING_HELP.value


# ---------------------------------------------------------------------------
# Regression: URL shortcut still bypasses LLM in all modes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_url_shortcut_bypasses_llm_even_in_recipe_exploring():
    with _mock_ai("general_chat") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="https://allrecipes.com/recipe/pasta",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
            )
        )
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_INGEST.value


# ---------------------------------------------------------------------------
# Regression: exit phrase still works in all modes
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "session_mode",
    [
        SessionMode.COOKING.value,
        SessionMode.RECIPE_EXPLORING.value,
        SessionMode.INGESTING.value,
        SessionMode.PANTRY_EDITING.value,
    ],
)
@pytest.mark.asyncio
async def test_exit_phrase_breaks_all_modes(session_mode: str):
    result = await classify_intent(
        _state(input_text="exit", session_mode=session_mode)
    )
    assert result["intent"] == Intent.GENERAL_CHAT.value
    assert result.get("_exit_mode") is True


# ---------------------------------------------------------------------------
# GRAPH-LEVEL tests (finding #6): assert the confirm band, forced-intent gate,
# and Q6 no-clobber behave correctly through the compiled graph / envelope, not
# just at the classify_intent seam.  These would fail on the pre-fix code where
# the confirm case ran the full brainstorm pipeline (#266).
# ---------------------------------------------------------------------------

import bubbly_chef.workflows.router as router_mod  # noqa: E402
from bubbly_chef.models.session import ConversationSession  # noqa: E402
from bubbly_chef.workflows.router import run_chat_workflow  # noqa: E402

# The envelope builders in shared_state parse conversation_id with UUID(...),
# so graph-level tests must pass a syntactically valid UUID string, not "conv-1".
_CONV_ID = "11111111-1111-1111-1111-111111111111"


def _graph_repo(
    mode: SessionMode = SessionMode.RECIPE_EXPLORING,
    pinned_recipe_id: str | None = "pin-123",
    brainstorm_ideas: list[str] | None = None,
    picked_recipe=None,
):
    """Mock repository returning a session in `mode` with a pin + stored set."""
    from bubbly_chef.models.session import SessionContext

    session = ConversationSession(
        conversation_id=_CONV_ID,
        active_mode=mode,
        pinned_recipe_id=pinned_recipe_id,
        metadata=SessionContext(
            brainstorm_ideas=list(brainstorm_ideas or []),
            picked_recipe=picked_recipe,
        ),
    )
    repo = MagicMock()
    repo.get_or_create_session = AsyncMock(return_value=session)
    repo.update_session = AsyncMock(return_value=None)
    repo.get_recipe = AsyncMock(return_value=None)
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    return repo


def _reset_graphs():
    """Force a fresh graph compile so patched node functions take effect."""
    router_mod._chat_router_graph = None
    router_mod._chat_dispatch_graph = None


@pytest.mark.asyncio
async def test_confirm_band_graph_does_not_run_brainstorm_pipeline():
    """
    CRITICAL (#266 root fix): a low-confidence modify-vs-new turn in
    RECIPE_EXPLORING with a pinned recipe must yield a CONFIRM_CHOICE envelope
    and must NOT run the brainstorm pipeline (extract/score/brainstorm) — so the
    pick and the stored brainstorm set survive.
    """
    _reset_graphs()
    from bubbly_chef.models.recipe import RecipeCard

    repo = _graph_repo(
        brainstorm_ideas=["Pesto Pasta", "Carbonara"],
        # A pin is required for the confirm band to fire (#436 finding 3: it
        # reads metadata.picked_recipe, not the default pinned_recipe_id).
        picked_recipe=RecipeCard(title="Pesto Pasta"),
    )

    # Spies on the generation nodes — must NOT be invoked on the confirm path.
    extract_spy = AsyncMock(side_effect=AssertionError("extract_constraints ran on confirm turn"))
    score_spy = AsyncMock(side_effect=AssertionError("score_pantry ran on confirm turn"))
    brainstorm_spy = AsyncMock(side_effect=AssertionError("brainstorm ran on confirm turn"))

    with (
        _mock_ai("recipe_brainstorm", confidence=0.60),
        patch("bubbly_chef.workflows.router.get_repository", new_callable=AsyncMock, return_value=repo),
        patch("bubbly_chef.workflows.router.extract_recipe_constraints", extract_spy),
        patch("bubbly_chef.workflows.router.score_pantry_ingredients", score_spy),
        patch("bubbly_chef.workflows.router.brainstorm_recipe_ideas", brainstorm_spy),
    ):
        envelope = await run_chat_workflow(
            message="show me something else",
            conversation_id=_CONV_ID,
            user_id="user-1",
        )
    _reset_graphs()

    # Confirm surfaced to the UI with two one-tap options.
    assert envelope.next_action == NextAction.CONFIRM_CHOICE
    assert envelope.requires_review is True
    options = envelope.metadata.get("confirm_options")
    assert options and len(options) == 2
    forced = {o["forced_intent"] for o in options}
    assert forced == {Intent.RECIPE_CARD.value, Intent.RECIPE_BRAINSTORM.value}
    # The generation spies raise on call; reaching here proves none ran.
    extract_spy.assert_not_awaited()
    score_spy.assert_not_awaited()
    brainstorm_spy.assert_not_awaited()
    # The stored brainstorm set was NOT clobbered (Q6): update_session saved it intact.
    saved = repo.update_session.await_args.args[1]
    assert saved.metadata.brainstorm_ideas == ["Pesto Pasta", "Carbonara"]


@pytest.mark.asyncio
async def test_high_confidence_brainstorm_graph_runs_pipeline_and_invalidates_set():
    """
    Contrast case: a high-confidence brainstorm DOES run the pipeline and DOES
    replace the stored set — confirming the confirm-band gate is confidence-keyed.
    """
    _reset_graphs()
    repo = _graph_repo(brainstorm_ideas=["Old Idea"])

    async def _fake_brainstorm(state):
        return {
            **state,
            "intent": Intent.RECIPE_BRAINSTORM.value,
            "assistant_message": "Here are ideas: **New Idea A**, **New Idea B**",
            "brainstorm_ideas": ["New Idea A", "New Idea B"],
            "next_action": NextAction.PICK_RECIPE.value,
            "requires_review": False,
        }

    passthrough = AsyncMock(side_effect=lambda s: s)
    with (
        _mock_ai("recipe_brainstorm", confidence=0.95),
        patch("bubbly_chef.workflows.router.get_repository", new_callable=AsyncMock, return_value=repo),
        patch("bubbly_chef.workflows.router.extract_recipe_constraints", passthrough),
        patch("bubbly_chef.workflows.router.score_pantry_ingredients", passthrough),
        patch("bubbly_chef.workflows.router.brainstorm_recipe_ideas", AsyncMock(side_effect=_fake_brainstorm)),
    ):
        envelope = await run_chat_workflow(
            message="actually something completely different",
            conversation_id=_CONV_ID,
            user_id="user-1",
        )
    _reset_graphs()

    assert envelope.next_action != NextAction.CONFIRM_CHOICE
    saved = repo.update_session.await_args.args[1]
    # Stored set replaced by the freshly generated one (Q6 invalidate-on-new).
    assert saved.metadata.brainstorm_ideas == ["New Idea A", "New Idea B"]


@pytest.mark.asyncio
async def test_generation_graph_runs_grounded_recipe_not_brainstorm():
    """
    CRITICAL (#408 / AC4): a high-confidence recipe_generation ("recipe for
    spaghetti creamy and garlicky") must reach generate_grounded_recipe and
    produce ONE recipe — it must NOT run brainstorm_recipe_ideas and get served
    as an idea menu. Before the score_pantry split, route_by_intent sent both
    generation and brainstorm to the same node and generation always fell through
    to brainstorm, restamping intent=recipe_brainstorm. This is the graph-level
    seam the node-mocked classify tests could not catch.
    """
    _reset_graphs()
    repo = _graph_repo()

    passthrough = AsyncMock(side_effect=lambda s: s)

    # brainstorm node must NOT run on a generation turn.
    brainstorm_spy = AsyncMock(
        side_effect=AssertionError("brainstorm_recipe_ideas ran on a generation turn")
    )

    async def _fake_generate(state):
        return {
            **state,
            "intent": Intent.RECIPE_CARD.value,  # single-recipe render
            "assistant_message": "Here is your Creamy Garlic Spaghetti recipe.",
            "next_action": NextAction.NONE.value,
            "requires_review": False,
        }

    generate_spy = AsyncMock(side_effect=_fake_generate)

    with (
        _mock_ai("recipe_generation", confidence=1.0),
        patch("bubbly_chef.workflows.router.get_repository", new_callable=AsyncMock, return_value=repo),
        patch("bubbly_chef.workflows.router.extract_recipe_constraints", passthrough),
        patch("bubbly_chef.workflows.router.score_pantry_ingredients", passthrough),
        patch("bubbly_chef.workflows.router.research_recipe", passthrough),
        patch("bubbly_chef.workflows.router.brainstorm_recipe_ideas", brainstorm_spy),
        patch("bubbly_chef.workflows.router.generate_grounded_recipe", generate_spy),
    ):
        envelope = await run_chat_workflow(
            message="recipe for spaghetti creamy and garlicky",
            conversation_id=_CONV_ID,
            user_id="user-1",
        )
    _reset_graphs()

    # Generation reached the single-recipe node, never the brainstorm menu.
    brainstorm_spy.assert_not_awaited()
    generate_spy.assert_awaited_once()
    assert envelope.next_action != NextAction.CONFIRM_CHOICE


@pytest.mark.asyncio
async def test_forced_intent_generation_rejected_by_request_model():
    """
    #5 safety: recipe_generation is no longer an accepted forced_intent value —
    the ChatRequest Literal rejects it, so a client cannot use a chip to bypass
    the COOKING amendment gate.
    """
    import pydantic

    from bubbly_chef.models.requests import ChatRequest

    # Allowed values validate.
    ChatRequest(message="x", forced_intent="recipe_card")
    ChatRequest(message="x", forced_intent="recipe_brainstorm")
    # recipe_generation is rejected at the API boundary.
    with pytest.raises(pydantic.ValidationError):
        ChatRequest(message="x", forced_intent="recipe_generation")


@pytest.mark.asyncio
async def test_forced_generation_not_honoured_by_classifier_allow_list():
    """
    Defence-in-depth: even if a recipe_generation forced_intent reached
    classify_intent (bypassing the request model), the allow-list does not honour
    it — it falls through to the LLM classifier (COOKING gate still applies).
    """
    with _mock_ai("cooking_help") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="what else can I make?",
                session_mode=SessionMode.COOKING.value,
                forced_intent="recipe_generation",
            )
        )
    # LLM WAS consulted (forced value ignored) and COOKING gate mapped it.
    mock_mgr.return_value.complete.assert_called_once()
    assert result["intent"] == Intent.COOKING_HELP.value


@pytest.mark.asyncio
async def test_generation_turn_does_not_clobber_stored_brainstorm_set():
    """
    #4: a RECIPE_GENERATION turn (no new brainstorm ran → no PICK_RECIPE) must
    NOT overwrite the retained brainstorm set to [] in update_session (Q6).
    """
    from bubbly_chef.workflows.router import update_session_node

    repo = _graph_repo(brainstorm_ideas=["Kept Idea A", "Kept Idea B"])
    state = _state(
        input_text="give me a lasagna recipe",
        conversation_id=_CONV_ID,
        user_id="user-1",
        intent=Intent.RECIPE_GENERATION.value,
        next_action=NextAction.NONE.value,  # no brainstorm ran this turn
        brainstorm_ideas=[],  # state carries no new ideas
    )
    with patch(
        "bubbly_chef.workflows.router.get_repository",
        new_callable=AsyncMock,
        return_value=repo,
    ):
        await update_session_node(state)

    saved = repo.update_session.await_args.args[1]
    assert saved.metadata.brainstorm_ideas == ["Kept Idea A", "Kept Idea B"]


@pytest.mark.asyncio
async def test_load_session_seeds_brainstorm_ideas_from_stored_set():
    """Q6 wiring: load_session copies session.metadata.brainstorm_ideas into state."""
    from bubbly_chef.workflows.router import load_session

    repo = _graph_repo(brainstorm_ideas=["Stored A", "Stored B"])
    with patch(
        "bubbly_chef.workflows.router.get_repository",
        new_callable=AsyncMock,
        return_value=repo,
    ):
        result = await load_session(
            _state(conversation_id=_CONV_ID, user_id="user-1", brainstorm_ideas=[])
        )
    assert result.get("brainstorm_ideas") == ["Stored A", "Stored B"]


@pytest.mark.asyncio
async def test_repick_resolves_against_stored_set_when_history_truncated():
    """
    Q6 re-pick: with a live stored set but no bold names in history, a re-pick
    ("show me the pesto one") still resolves to RECIPE_CARD without regeneration.
    """
    with _mock_ai("recipe_brainstorm") as mock_mgr:  # LLM would say brainstorm; must not be reached
        result = await classify_intent(
            _state(
                input_text="show me the pesto one",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=None,
                brainstorm_ideas=["Pesto Pasta", "Carbonara"],
                conversation_history=[],  # truncated — no bold names to parse
            )
        )
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_CARD.value
    assert result.get("selected_recipe_name") == "Pesto Pasta"


# ---------------------------------------------------------------------------
# route_by_intent — refine-in-place dispatch (#416 AC1)
#
# Bug: a recipe_card follow-up on an already-pinned recipe routed to
# research_recipe -> generate_grounded_recipe, which builds a brand-new
# standalone recipe and never reads the pinned recipe. It must instead route
# to the new refine_recipe node when a full recipe is pinned in session
# (session.metadata.picked_recipe), and keep routing to research_recipe for
# a genuine first pick (no picked_recipe yet).
# ---------------------------------------------------------------------------


def _minimal_recipe_card_dict(title: str = "Creamy Garlic Spaghetti") -> dict:
    """Minimal RecipeCard-shaped dict, enough for RecipeCard.model_validate."""
    return {
        "title": title,
        "ingredients": [{"name": "garlic", "quantity": 2, "unit": "cloves"}],
        "instructions": ["Cook pasta.", "Add garlic."],
    }


def test_route_by_intent_recipe_card_with_picked_recipe_routes_to_refine():
    """A recipe_card follow-up with a full recipe already pinned in session
    is a modification ('make it spicier') — must route to refine_recipe, not
    research_recipe (which would generate an unrelated new dish)."""
    from bubbly_chef.workflows.router import route_by_intent

    state = _state(
        intent=Intent.RECIPE_CARD.value,
        input_text="something with tomato flavor instead",
        selected_recipe_name=None,
        session={
            "metadata": {"picked_recipe": _minimal_recipe_card_dict()},
        },
    )
    assert route_by_intent(state) == "refine_recipe"


def test_route_by_intent_recipe_card_first_pick_routes_to_research_recipe():
    """A recipe_card first-pick (no picked_recipe pinned yet) keeps the
    existing brainstorm-follow-up path — no regression on #408/#266."""
    from bubbly_chef.workflows.router import route_by_intent

    state = _state(
        intent=Intent.RECIPE_CARD.value,
        selected_recipe_name="Pesto Pasta",
        session={"metadata": {"picked_recipe": None}},
    )
    assert route_by_intent(state) == "research_recipe"


def test_route_by_intent_recipe_card_no_session_falls_back_to_cooking_help():
    """No session at all (session=None) and no selected_recipe_name — the
    pre-existing fallback branch must still hold; refine must not fire on a
    missing session."""
    from bubbly_chef.workflows.router import route_by_intent

    state = _state(
        intent=Intent.RECIPE_CARD.value,
        selected_recipe_name=None,
        session=None,
    )
    assert route_by_intent(state) == "cooking_help_response"


# ---------------------------------------------------------------------------
# Regression: a genuinely new brainstorm must clear the stale picked_recipe
# pin, or a fresh pick from the new set gets "refined" toward the OLD pinned
# dish instead of routing to research_recipe for the new one.
#
# Sequence: pin spaghetti -> "what else could I make?" (new brainstorm,
# next_action=PICK_RECIPE, ideas generated) -> "the pad thai one" (recipe_card,
# selected_recipe_name set). Before the fix, picked_recipe survives the
# brainstorm turn, so route_by_intent sees it set and sends the pad thai pick
# to refine_recipe, which would "refine" the pinned spaghetti card instead of
# generating pad thai.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_new_brainstorm_clears_stale_picked_recipe_pin():
    """update_session_node must clear metadata.picked_recipe when a genuinely
    new brainstorm ran this turn (next_action=PICK_RECIPE with ideas) -- the
    old pin is stale the moment a fresh idea set replaces it.

    pinned_recipe_id is deliberately left untouched -- clearing it would
    re-enable the deterministic re-pick path (#415 territory), which is out
    of scope here. This intentionally locks in a pinned_recipe_id /
    metadata.picked_recipe divergence, but it is now SAFE (#436 finding 3):
    classify_intent's "is a recipe pinned" checks (confirm band, re-pick gate,
    mode-bias prompt) all read metadata.picked_recipe via
    _session_has_picked_recipe, never the stale pinned_recipe_id. See
    test_confirm_band_not_fired_after_new_brainstorm_clears_pin below, which
    exercises exactly that read path against the state this test produces.
    """
    from bubbly_chef.workflows.router import update_session_node

    repo = _graph_repo(
        brainstorm_ideas=["Creamy Garlic Spaghetti"],
        picked_recipe=_minimal_recipe_card_dict("Creamy Garlic Spaghetti"),
    )
    state = _state(
        input_text="what else could I make?",
        conversation_id=_CONV_ID,
        user_id="user-1",
        intent=Intent.RECIPE_BRAINSTORM.value,
        next_action=NextAction.PICK_RECIPE.value,  # a brainstorm node actually ran
        brainstorm_ideas=["Pad Thai", "Fried Rice"],  # new ideas generated this turn
    )
    with patch(
        "bubbly_chef.workflows.router.get_repository",
        new_callable=AsyncMock,
        return_value=repo,
    ):
        await update_session_node(state)

    saved = repo.update_session.await_args.args[1]
    assert saved.metadata.picked_recipe is None
    # pinned_recipe_id is untouched -- clearing it would re-enable the
    # deterministic re-pick path (#415 territory), which is out of scope here.
    assert saved.pinned_recipe_id == "pin-123"


@pytest.mark.asyncio
async def test_confirm_band_not_fired_after_new_brainstorm_clears_pin():
    """#436 finding 3 regression: pick A -> "show me different options" (new
    brainstorm, clears metadata.picked_recipe but leaves pinned_recipe_id
    stale) -> an ambiguous follow-up must NOT trip the confirm band ("Did you
    want to tweak this recipe or start fresh?") since there is no "this
    recipe" any more. Before the fix, classify_intent read the stale
    pinned_recipe_id and fired the confirm band anyway.
    """
    with _mock_ai("recipe_brainstorm", confidence=0.60):
        result = await classify_intent(
            _state(
                input_text="something with noodles maybe?",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                # pinned_recipe_id stale from the earlier pick; picked_recipe
                # already cleared by update_session_node on the new brainstorm.
                session={
                    "pinned_recipe_id": "pin-123",
                    "metadata": {"picked_recipe": None},
                },
            )
        )
    assert result.get("next_action") != NextAction.CONFIRM_CHOICE.value
    assert result.get("requires_review") is not True


def test_fresh_pick_after_new_brainstorm_routes_to_research_recipe_not_refine():
    """After a new brainstorm clears the stale pin (picked_recipe=None), a
    recipe_card pick from the NEW set must route to research_recipe (first
    pick), not refine_recipe (which would 'refine' the old pinned dish)."""
    from bubbly_chef.workflows.router import route_by_intent

    state = _state(
        intent=Intent.RECIPE_CARD.value,
        selected_recipe_name="Pad Thai",
        session={"metadata": {"picked_recipe": None}},  # cleared by the fix above
    )
    assert route_by_intent(state) == "research_recipe"


def test_cooking_help_with_pin_answers_not_refine():
    """A QUESTION about the pinned recipe ('does it have yogurt?') classified as
    cooking_help must route to cooking_help_response — it answers the question
    and NEVER rewrites the pinned card via refine_recipe. Regression for the bug
    where any recipe_card-adjacent follow-up on a pinned recipe silently
    rebuilt the card instead of replying."""
    state = _state(
        intent=Intent.COOKING_HELP.value,
        session={"metadata": {"picked_recipe": {"title": "Beef Stroganoff"}}},
    )
    assert route_by_intent(state) == "cooking_help_response"


# ---------------------------------------------------------------------------
# #442 defect 3: pinned re-pick to a DIFFERENT already-offered idea
# "show me the porridge one instead" while spaghetti is pinned must switch
# to the porridge idea, not regenerate or modify the pinned dish.
# ---------------------------------------------------------------------------

_PINNED_REPICK_IDEAS = [
    "Thai-Style Garlic Toast",
    "Sweet Coconut Milk Toast",
    "Savory Thai Rice Porridge",
]
_PINNED_REPICK_HISTORY = [
    {
        "role": "assistant",
        "content": (
            "Here are some ideas:\n"
            "**Thai-Style Garlic Toast** - crispy toast with garlic\n"
            "**Sweet Coconut Milk Toast** - a sweet breakfast toast\n"
            "**Savory Thai Rice Porridge** - comforting congee-style porridge\n"
        ),
        "intent": "recipe_brainstorm",
    },
]


def _session_with_picked(title: str) -> dict:
    """Simulate a pinned session where `title` is the currently-picked recipe."""
    return {
        "pinned_recipe_id": "pin-456",
        "metadata": {"picked_recipe": {"title": title, "id": "pin-456"}},
    }


@pytest.mark.asyncio
async def test_pinned_repick_different_idea_short_circuits():
    """'show me the porridge one instead' while Thai-Style Garlic Toast is pinned
    → deterministic re-pick to 'Savory Thai Rice Porridge' without calling the LLM.
    """
    with _mock_ai("recipe_card") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="show me the porridge one instead",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_picked("Thai-Style Garlic Toast"),
                brainstorm_ideas=list(_PINNED_REPICK_IDEAS),
                conversation_history=_PINNED_REPICK_HISTORY,
            )
        )
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_CARD.value
    assert result.get("selected_recipe_name") == "Savory Thai Rice Porridge"


@pytest.mark.asyncio
async def test_pinned_modification_falls_through_to_llm():
    """'add pesto to it' while pinned → not a stored idea name → LLM is called
    (should modify the pinned dish, not re-pick).
    """
    with _mock_ai("recipe_card") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="add pesto to it",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_picked("Thai-Style Garlic Toast"),
                brainstorm_ideas=list(_PINNED_REPICK_IDEAS),
                conversation_history=_PINNED_REPICK_HISTORY,
            )
        )
    mock_mgr.return_value.complete.assert_awaited_once()
    assert result.get("intent_reasoning") != "Re-pick to a different already-offered idea (pinned session)"


# ---------------------------------------------------------------------------
# MEDIUM regression: sibling near-tie / shared-token in router (integration)
# ---------------------------------------------------------------------------

_SIBLING_ROUTER_IDEAS = ["Garlic Toast Supreme", "Garlic Bread Twists", "Tomato Basil Soup"]
_SIBLING_ROUTER_HISTORY = [
    {
        "role": "assistant",
        "content": (
            "**Garlic Toast Supreme** - rich garlic toast\n"
            "**Garlic Bread Twists** - twisted garlic bread\n"
            "**Tomato Basil Soup** - classic tomato soup\n"
        ),
        "intent": "recipe_brainstorm",
    },
]


@pytest.mark.asyncio
async def test_sibling_garlic_ambiguous_falls_through_to_llm():
    """'the garlic one' while 'Garlic Bread Twists' is pinned -- both sibling
    ideas share 'garlic' with the pin -> ambiguous -> must NOT re-pick to the
    sibling; LLM is called instead.
    """
    with _mock_ai("recipe_card") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="the garlic one",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_picked("Garlic Bread Twists"),
                brainstorm_ideas=list(_SIBLING_ROUTER_IDEAS),
                conversation_history=_SIBLING_ROUTER_HISTORY,
            )
        )
    mock_mgr.return_value.complete.assert_awaited_once()
    assert result.get("intent_reasoning") != "Re-pick to a different already-offered idea (pinned session)"


@pytest.mark.asyncio
async def test_sibling_tomato_unambiguous_repicks():
    """'show me the tomato one instead' while 'Garlic Bread Twists' is pinned --
    'tomato' does not appear in the pinned title -> unambiguous -> re-picks to
    'Tomato Basil Soup' without calling the LLM.
    """
    with _mock_ai("recipe_card") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="show me the tomato one instead",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_picked("Garlic Bread Twists"),
                brainstorm_ideas=list(_SIBLING_ROUTER_IDEAS),
                conversation_history=_SIBLING_ROUTER_HISTORY,
            )
        )
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_CARD.value
    assert result.get("selected_recipe_name") == "Tomato Basil Soup"


@pytest.mark.asyncio
async def test_novel_comparative_falls_through_to_llm():
    """'make it gooier' -- novel comparative matched by the regex guard -> LLM is called."""
    with _mock_ai("recipe_card") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="make it gooier",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_picked("Thai-Style Garlic Toast"),
                brainstorm_ideas=list(_PINNED_REPICK_IDEAS),
                conversation_history=_PINNED_REPICK_HISTORY,
            )
        )
    mock_mgr.return_value.complete.assert_awaited_once()
    assert result.get("intent_reasoning") != "Re-pick to a different already-offered idea (pinned session)"
@pytest.mark.asyncio
async def test_pinned_same_dish_reference_falls_through_to_llm():
    """'the garlic toast one' names the CURRENTLY pinned dish → no re-pick;
    falls through to LLM (treated as a modification of the current dish).
    """
    with _mock_ai("recipe_card") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="the garlic toast one",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
                session=_session_with_picked("Thai-Style Garlic Toast"),
                brainstorm_ideas=list(_PINNED_REPICK_IDEAS),
                conversation_history=_PINNED_REPICK_HISTORY,
            )
        )
    mock_mgr.return_value.complete.assert_awaited_once()
    assert result.get("intent_reasoning") != "Re-pick to a different already-offered idea (pinned session)"
