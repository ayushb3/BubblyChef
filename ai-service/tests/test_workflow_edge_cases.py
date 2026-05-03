"""Edge case regression tests for the chat router.

Covers scenarios that were previously broken by keyword pattern interception.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.models.session import SessionMode
from bubbly_chef.workflows.router import classify_intent
from bubbly_chef.workflows.state import LLMIntentResult


def _state(**kwargs):
    base = {
        "input_text": "",
        "errors": [],
        "warnings": [],
        "session_mode": None,
        "session": None,
        "conversation_history": [],
        "selected_recipe_name": None,
    }
    base.update(kwargs)
    return base


def _llm_result(intent: str) -> LLMIntentResult:
    return LLMIntentResult(intent=intent, confidence=0.9, reasoning="test", entities=[])


def _mock_ai(intent: str):
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=_llm_result(intent))
    return patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai))


# ---------------------------------------------------------------------------
# BubblyChef-747: "no cheese" in RECIPE_EXPLORING must NOT be intercepted
# by a keyword block and must route to recipe_card via session override.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_cheese_in_recipe_exploring_routes_to_recipe_card():
    """BubblyChef-747: 'no cheese' follow-up must route to recipe_card, not pantry_update."""
    with _mock_ai("pantry_update") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="no cheese",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
            )
        )
    # Session override must fire; LLM must NOT be consulted
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_CARD.value


@pytest.mark.asyncio
async def test_without_bacon_in_recipe_exploring_routes_to_recipe_card():
    with _mock_ai("pantry_update") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="without bacon",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
            )
        )
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_CARD.value


@pytest.mark.asyncio
async def test_make_it_spicier_in_recipe_exploring_routes_to_recipe_card():
    with _mock_ai("recipe_brainstorm") as mock_mgr:
        result = await classify_intent(
            _state(
                input_text="make it spicier",
                session_mode=SessionMode.RECIPE_EXPLORING.value,
            )
        )
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_CARD.value


# ---------------------------------------------------------------------------
# Formerly keyword-intercepted phrases now correctly go to LLM
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_receipt_keyword_no_longer_hardcoded_uses_llm():
    """'receipt' in message must now go to LLM (no keyword shortcut)."""
    with _mock_ai("general_chat"):
        result = await classify_intent(_state(input_text="I lost my receipt somewhere"))
    # LLM says general_chat — verify it was used (not hardcoded to receipt_ingest)
    assert result["intent"] == Intent.GENERAL_CHAT.value


@pytest.mark.asyncio
async def test_use_my_keyword_no_longer_hardcoded_uses_llm():
    """'use my' was a cooking_help keyword — should now route via LLM."""
    with _mock_ai("recipe_generation"):
        result = await classify_intent(_state(input_text="use my leftover chicken"))
    assert result["intent"] == Intent.RECIPE_GENERATION.value


@pytest.mark.asyncio
async def test_no_ai_provider_falls_back_to_general_chat():
    """When no AI provider is available, router falls back to general_chat."""
    from bubbly_chef.ai.manager import NoProviderAvailableError

    ai = MagicMock()
    ai.complete = AsyncMock(side_effect=NoProviderAvailableError("no provider"))
    with patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai)):
        result = await classify_intent(_state(input_text="some ambiguous message"))
    assert result["intent"] == Intent.GENERAL_CHAT.value
    assert "no_ai_provider" in result.get("errors", [])
