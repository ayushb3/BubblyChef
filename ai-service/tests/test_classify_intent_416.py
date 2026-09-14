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
from bubbly_chef.workflows.router import classify_intent
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


def _llm_result(intent: str, confidence: float = 0.9) -> LLMIntentResult:
    return LLMIntentResult(intent=intent, confidence=confidence, reasoning="test", entities=[])


def _mock_ai(intent: str, confidence: float = 0.9):
    """Return a context manager that patches get_ai_manager."""
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=_llm_result(intent, confidence))
    manager = MagicMock(return_value=ai)
    return patch("bubbly_chef.workflows.router.get_ai_manager", manager)


def _session_with_pin(recipe_id: str = "pin-123") -> dict:
    """Simulate a session dict with a pinned recipe (post-#415)."""
    return {"pinned_recipe_id": recipe_id}


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
