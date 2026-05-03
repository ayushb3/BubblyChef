"""Live intent classification tests — call the real Gemini API.

Skipped unless BUBBLY_RUN_LIVE_TESTS=1. Run before shipping prompt changes:
    cd ai-service
    BUBBLY_RUN_LIVE_TESTS=1 pytest tests/test_intent_live.py -v
"""

import os

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.workflows.router import classify_intent

_LIVE = os.getenv("BUBBLY_RUN_LIVE_TESTS", "0") == "1"
_SKIP = pytest.mark.skipif(not _LIVE, reason="set BUBBLY_RUN_LIVE_TESTS=1 to run live tests")

_BRAINSTORM_HISTORY = [
    {"role": "user", "content": "what pasta dishes can you make me?"},
    {
        "role": "assistant",
        "content": (
            "Here are three pasta options: "
            "1. Spaghetti Carbonara, 2. Penne Arrabbiata, 3. Tagliatelle Bolognese"
        ),
    },
]


def _state(**kwargs):  # type: ignore[no-untyped-def]
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


@_SKIP
@pytest.mark.asyncio
async def test_live_pantry_update() -> None:
    result = await classify_intent(_state(input_text="I bought milk"))
    assert result["intent"] == Intent.PANTRY_UPDATE.value


@_SKIP
@pytest.mark.asyncio
async def test_live_recipe_brainstorm() -> None:
    result = await classify_intent(_state(input_text="what can I make tonight?"))
    assert result["intent"] == Intent.RECIPE_BRAINSTORM.value


@_SKIP
@pytest.mark.asyncio
async def test_live_recipe_generation() -> None:
    result = await classify_intent(_state(input_text="give me a pasta recipe"))
    assert result["intent"] == Intent.RECIPE_GENERATION.value


@_SKIP
@pytest.mark.asyncio
async def test_live_cooking_help() -> None:
    result = await classify_intent(_state(input_text="how do I caramelise onions?"))
    assert result["intent"] == Intent.COOKING_HELP.value


@_SKIP
@pytest.mark.asyncio
async def test_live_recipe_ingest_url_shortcut() -> None:
    result = await classify_intent(
        _state(input_text="https://allrecipes.com/recipe/123")
    )
    assert result["intent"] == Intent.RECIPE_INGEST.value


@_SKIP
@pytest.mark.asyncio
async def test_live_recipe_card_from_history() -> None:
    """BubblyChef-747 regression: recipe_card must resolve from conversation history."""
    result = await classify_intent(
        _state(
            input_text="no cheese on that",
            session_mode=None,
            conversation_history=_BRAINSTORM_HISTORY,
        )
    )
    assert result["intent"] == Intent.RECIPE_CARD.value


@_SKIP
@pytest.mark.asyncio
async def test_live_receipt_ingest() -> None:
    result = await classify_intent(_state(input_text="here's my receipt"))
    assert result["intent"] == Intent.RECEIPT_INGEST.value


@_SKIP
@pytest.mark.asyncio
async def test_live_product_ingest() -> None:
    result = await classify_intent(_state(input_text="scan this barcode"))
    assert result["intent"] == Intent.PRODUCT_INGEST.value


@_SKIP
@pytest.mark.asyncio
async def test_live_general_chat() -> None:
    result = await classify_intent(_state(input_text="hello, how are you?"))
    assert result["intent"] == Intent.GENERAL_CHAT.value


@_SKIP
@pytest.mark.asyncio
async def test_live_exit_phrase_breaks_cooking_session() -> None:
    from bubbly_chef.models.session import SessionMode

    result = await classify_intent(
        _state(input_text="done", session_mode=SessionMode.COOKING.value)
    )
    assert result["intent"] == Intent.GENERAL_CHAT.value
    assert result.get("_exit_mode") is True
