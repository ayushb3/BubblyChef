"""Tests for classify_intent in router.py.

Tests verify routing behavior through the classify_intent public interface.
AI manager is mocked via patch so tests don't require a live provider.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.models.session import SessionMode
from bubbly_chef.workflows.router import classify_intent
from bubbly_chef.workflows.state import LLMIntentResult


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
    }
    base.update(kwargs)
    return base


def _llm_result(intent: str, confidence: float = 0.9) -> LLMIntentResult:
    return LLMIntentResult(intent=intent, confidence=confidence, reasoning="test", entities=[])


def _mock_ai(intent: str, confidence: float = 0.9):
    """Return a context manager patch that makes get_ai_manager return a mock completing with given intent."""
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=_llm_result(intent, confidence))
    manager = MagicMock(return_value=ai)
    return patch("bubbly_chef.workflows.router.get_ai_manager", manager)


# ---------------------------------------------------------------------------
# Shortcuts (no LLM)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_input_returns_general_chat():
    result = await classify_intent(_state(input_text=""))
    assert result["intent"] == Intent.GENERAL_CHAT.value


@pytest.mark.asyncio
async def test_whitespace_only_returns_general_chat():
    result = await classify_intent(_state(input_text="   \n  "))
    assert result["intent"] == Intent.GENERAL_CHAT.value


@pytest.mark.asyncio
async def test_https_url_routes_to_recipe_ingest_without_llm():
    with _mock_ai("general_chat") as mock_mgr:
        result = await classify_intent(_state(input_text="https://example.com/pasta"))
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_INGEST.value


@pytest.mark.asyncio
async def test_http_url_routes_to_recipe_ingest_without_llm():
    with _mock_ai("general_chat") as mock_mgr:
        result = await classify_intent(_state(input_text="http://recipes.com/soup"))
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_INGEST.value


@pytest.mark.asyncio
async def test_dotcom_url_routes_to_recipe_ingest_without_llm():
    with _mock_ai("general_chat") as mock_mgr:
        result = await classify_intent(_state(input_text="save recipe from allrecipes.com/pasta"))
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_INGEST.value


# ---------------------------------------------------------------------------
# Session mode override (unchanged behavior)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_session_cooking_mode_routes_to_cooking_help():
    with _mock_ai("general_chat") as mock_mgr:
        result = await classify_intent(
            _state(input_text="how long should I boil eggs?",
                   session_mode=SessionMode.COOKING.value)
        )
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.COOKING_HELP.value


@pytest.mark.asyncio
async def test_session_ingesting_mode_routes_to_pantry_update():
    with _mock_ai("general_chat") as mock_mgr:
        result = await classify_intent(
            _state(input_text="milk, eggs, butter",
                   session_mode=SessionMode.INGESTING.value)
        )
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.PANTRY_UPDATE.value


@pytest.mark.asyncio
async def test_exit_phrase_breaks_out_of_session_mode():
    with _mock_ai("general_chat") as mock_mgr:
        result = await classify_intent(
            _state(input_text="exit", session_mode=SessionMode.COOKING.value)
        )
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.GENERAL_CHAT.value
    assert result.get("_exit_mode") is True


# ---------------------------------------------------------------------------
# LLM path — intents that previously had keyword blocks
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_llm_receipt_intent_routes_to_receipt_ingest():
    with _mock_ai("receipt_ingest_request"):
        result = await classify_intent(_state(input_text="I just scanned a receipt"))
    assert result["intent"] == Intent.RECEIPT_INGEST.value


@pytest.mark.asyncio
async def test_llm_product_intent_routes_to_product_ingest():
    with _mock_ai("product_ingest_request"):
        result = await classify_intent(_state(input_text="scan this barcode for me"))
    assert result["intent"] == Intent.PRODUCT_INGEST.value


@pytest.mark.asyncio
async def test_llm_pantry_update_intent():
    with _mock_ai("pantry_update"):
        result = await classify_intent(_state(input_text="I bought some eggs today"))
    assert result["intent"] == Intent.PANTRY_UPDATE.value


@pytest.mark.asyncio
async def test_llm_recipe_generation_intent():
    with _mock_ai("recipe_generation"):
        result = await classify_intent(_state(input_text="give me a dinner idea"))
    assert result["intent"] == Intent.RECIPE_GENERATION.value


@pytest.mark.asyncio
async def test_llm_cooking_help_intent():
    with _mock_ai("cooking_help"):
        result = await classify_intent(_state(input_text="how do I caramelize onions?"))
    assert result["intent"] == Intent.COOKING_HELP.value


@pytest.mark.asyncio
async def test_llm_recipe_brainstorm_intent():
    with _mock_ai("recipe_brainstorm"):
        result = await classify_intent(_state(input_text="what can I make tonight?"))
    assert result["intent"] == Intent.RECIPE_BRAINSTORM.value


@pytest.mark.asyncio
async def test_llm_recipe_card_intent():
    with _mock_ai("recipe_card"):
        result = await classify_intent(_state(input_text="make me that pasta"))
    assert result["intent"] == Intent.RECIPE_CARD.value


@pytest.mark.asyncio
async def test_unknown_llm_intent_falls_back_to_general_chat():
    with _mock_ai("totally_unknown_intent"):
        result = await classify_intent(_state(input_text="something weird"))
    assert result["intent"] == Intent.GENERAL_CHAT.value


@pytest.mark.asyncio
async def test_llm_confidence_stored_on_state():
    with _mock_ai("cooking_help", confidence=0.75):
        result = await classify_intent(_state(input_text="what temperature for chicken?"))
    assert result["intent_confidence"] == pytest.approx(0.75)


# ---------------------------------------------------------------------------
# LLM is NOT called for URL / empty shortcuts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_llm_not_called_for_empty_input():
    with _mock_ai("pantry_update") as mock_mgr:
        await classify_intent(_state(input_text=""))
    mock_mgr.return_value.complete.assert_not_called()
