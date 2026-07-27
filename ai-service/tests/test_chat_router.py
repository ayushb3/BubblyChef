"""Tests for classify_intent in router.py.

Tests verify routing behavior through the classify_intent public interface.
AI manager is mocked via patch so tests don't require a live provider.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.models.session import ConversationSession, SessionMode
from bubbly_chef.workflows.chat.nodes import format_cooking_recipe_context
from bubbly_chef.workflows.router import classify_intent, update_session_node
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


# ---------------------------------------------------------------------------
# Cook handoff — session pinning via request context (issue #122)
# ---------------------------------------------------------------------------


def _cooking_context(recipe_id: str = "recipe-42") -> dict:
    return {
        "cooking_recipe": {
            "id": recipe_id,
            "title": "Lemon Garlic Pasta",
            "ingredients": ["spaghetti", "lemon", "garlic"],
        }
    }


def _session_repo(mode: SessionMode = SessionMode.DEFAULT) -> MagicMock:
    """Mock repository whose session starts in `mode`."""
    repo = MagicMock()
    repo.get_or_create_session = AsyncMock(
        return_value=ConversationSession(conversation_id="conv-1", active_mode=mode)
    )
    repo.update_session = AsyncMock(return_value=None)
    return repo


def _patch_repo(repo: MagicMock):
    return patch(
        "bubbly_chef.workflows.router.get_repository",
        new_callable=AsyncMock,
        return_value=repo,
    )


@pytest.mark.asyncio
async def test_cooking_context_sets_cooking_mode_and_pins_recipe():
    repo = _session_repo()
    state = _state(
        input_text="how do I julienne the carrots?",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.COOKING_HELP.value,
        context=_cooking_context(),
    )

    with _patch_repo(repo):
        await update_session_node(state)

    repo.update_session.assert_awaited_once()
    saved = repo.update_session.await_args.args[1]
    assert saved.active_mode == SessionMode.COOKING
    assert saved.pinned_recipe_id == "recipe-42"
    assert saved.metadata["cooking_recipe"]["title"] == "Lemon Garlic Pasta"
    assert saved.metadata["cooking_recipe"]["ingredients"] == [
        "spaghetti",
        "lemon",
        "garlic",
    ]


@pytest.mark.asyncio
async def test_cooking_context_repins_when_user_cooks_another_recipe():
    """A second cook handoff replaces the pinned recipe rather than keeping the first."""
    repo = _session_repo(SessionMode.COOKING)
    repo.get_or_create_session = AsyncMock(
        return_value=ConversationSession(
            conversation_id="conv-1",
            active_mode=SessionMode.COOKING,
            pinned_recipe_id="recipe-1",
            metadata={"cooking_recipe": {"id": "recipe-1", "title": "Old Dish"}},
        )
    )
    state = _state(
        input_text="how hot should the pan be?",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.COOKING_HELP.value,
        context=_cooking_context("recipe-99"),
    )

    with _patch_repo(repo):
        await update_session_node(state)

    saved = repo.update_session.await_args.args[1]
    assert saved.pinned_recipe_id == "recipe-99"
    assert saved.metadata["cooking_recipe"]["title"] == "Lemon Garlic Pasta"


@pytest.mark.asyncio
async def test_exit_phrase_clears_cooking_mode_even_with_context():
    """Exit handling wins over a resent cook context — mode resets to default."""
    repo = _session_repo(SessionMode.COOKING)
    state = _state(
        input_text="stop",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.GENERAL_CHAT.value,
        context=_cooking_context(),
        _exit_mode=True,
    )

    with _patch_repo(repo):
        await update_session_node(state)

    saved = repo.update_session.await_args.args[1]
    assert saved.active_mode == SessionMode.DEFAULT
    assert saved.pinned_recipe_id is None
    assert saved.metadata == {}


@pytest.mark.asyncio
async def test_no_context_leaves_session_mode_alone():
    """Plain cooking_help turns without context don't force COOKING mode."""
    repo = _session_repo()
    state = _state(
        input_text="how long do I boil eggs?",
        conversation_id="conv-1",
        user_id="user-1",
        intent=Intent.COOKING_HELP.value,
    )

    with _patch_repo(repo):
        await update_session_node(state)

    saved = repo.update_session.await_args.args[1]
    assert saved.active_mode == SessionMode.DEFAULT
    assert saved.pinned_recipe_id is None


# ---------------------------------------------------------------------------
# Cook handoff — prompt injection
# ---------------------------------------------------------------------------


def test_cooking_recipe_context_reads_request_context():
    block = format_cooking_recipe_context(_state(context=_cooking_context()))
    assert "Lemon Garlic Pasta" in block
    assert "spaghetti" in block


def test_cooking_recipe_context_falls_back_to_session_metadata():
    """Later turns get the recipe from the session, since the client sends it once."""
    block = format_cooking_recipe_context(
        _state(session={"metadata": _cooking_context()})
    )
    assert "Lemon Garlic Pasta" in block


def test_cooking_recipe_context_empty_without_recipe():
    assert format_cooking_recipe_context(_state()) == ""
    assert format_cooking_recipe_context(_state(context={"other": 1})) == ""
