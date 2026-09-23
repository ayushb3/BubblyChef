"""Issue #540: "do I have spinach?" is classified as pantry_update — the user
gets an add-to-pantry proposal instead of an answer.

Following the `test_issue_493_saved_recipe_lookup.py` pattern: an LLM's actual
classification isn't deterministically testable without hitting the live
model, so the disambiguation itself is checked by asserting the classifier
system prompt carries explicit stock-question examples (cooking_help) next to
contrasting pantry-mutation examples (pantry_update) — the boundary the LLM
is currently missing, per the issue — plus table-driven checks against the
*recorded live-model classifications* in tests/fixtures/intent_classifications.json
(captured by tests/capture_intent_fixtures.py) for both sides of the boundary.

The table tests deliberately do not mock an intent per phrase: a mock that
returns "cooking_help" would pass for any input, so it proves nothing about
the prompt (PR #577 review). Each phrase must have a real captured answer,
that answer must be the correct intent, and replaying it through
classify_intent must keep it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.prompts.router import INTENT_CLASSIFICATION_SYSTEM_PROMPT
from bubbly_chef.workflows.chat.nodes import cooking_help_response
from bubbly_chef.workflows.router import classify_intent
from bubbly_chef.workflows.state import LLMIntentResult


def _state(**kwargs: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
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


class TestStockQuestionDisambiguationInPrompt:
    """The prompt must explicitly show the LLM both sides of the boundary:
    a stock question ("do I have spinach?") is cooking_help, not
    pantry_update, even though it names a food item like a pantry_update
    message would."""

    def test_disambiguation_block_present(self) -> None:
        assert "Distinguish cooking_help from pantry_update" in INTENT_CLASSIFICATION_SYSTEM_PROMPT

    def test_stock_question_examples_present(self) -> None:
        for phrase in (
            "do I have spinach?",
            "is there any milk left?",
            "what cheese do I have?",
        ):
            assert phrase in INTENT_CLASSIFICATION_SYSTEM_PROMPT, phrase

    def test_contrasting_pantry_update_examples_present(self) -> None:
        """The same block should show the mutation-phrased counterexamples so
        the LLM sees both sides, not just the new one."""
        for phrase in (
            "I bought spinach",
            "add 2 eggs",
            "used up the last of the milk",
        ):
            assert phrase in INTENT_CLASSIFICATION_SYSTEM_PROMPT, phrase


# ---------------------------------------------------------------------------
# Classifier routing — table-driven, against recorded live-model answers
# ---------------------------------------------------------------------------

_FIXTURES: dict[str, Any] = json.loads(
    (Path(__file__).parent / "fixtures" / "intent_classifications.json").read_text(encoding="utf-8")
)


def _replay(captured: dict[str, Any]) -> Any:
    """Patch the classifier's LLM call to return exactly what the live model
    answered for this phrase when the fixtures were captured."""
    llm_result = LLMIntentResult(
        intent=captured["intent"],
        confidence=captured["confidence"],
        reasoning=captured.get("reasoning") or "captured",
        entities=captured.get("entities") or [],
    )
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=llm_result)
    return patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai))


STOCK_QUESTION_PHRASINGS = [
    "do I have spinach?",
    "is there any milk left?",
    "what cheese do I have?",
    "do we have any eggs?",
    "is there butter in the fridge?",
    "how many eggs do I have?",
]

PANTRY_UPDATE_PHRASINGS = [
    "I bought spinach",
    "add 2 eggs",
    "I got some milk today",
    "used up the last of the butter",
    "threw away the old yogurt",
]


@pytest.mark.asyncio
@pytest.mark.parametrize("text", STOCK_QUESTION_PHRASINGS)
async def test_stock_questions_route_to_cooking_help(text: str) -> None:
    captured = _FIXTURES.get(text)
    assert captured is not None, (
        f"No recorded live classification for {text!r}; add it to CASES in "
        "tests/capture_intent_fixtures.py and re-capture"
    )
    assert captured["intent"] == Intent.COOKING_HELP.value, (
        f"The live model classified {text!r} as {captured['intent']!r}"
    )
    with _replay(captured):
        result = await classify_intent(_state(input_text=text))
    assert result["intent"] == Intent.COOKING_HELP.value


@pytest.mark.asyncio
@pytest.mark.parametrize("text", PANTRY_UPDATE_PHRASINGS)
async def test_pantry_mutations_still_route_to_pantry_update(text: str) -> None:
    captured = _FIXTURES.get(text)
    assert captured is not None, (
        f"No recorded live classification for {text!r}; add it to CASES in "
        "tests/capture_intent_fixtures.py and re-capture"
    )
    assert captured["intent"] == Intent.PANTRY_UPDATE.value, (
        f"The live model classified {text!r} as {captured['intent']!r}"
    )
    with _replay(captured):
        result = await classify_intent(_state(input_text=text))
    assert result["intent"] == Intent.PANTRY_UPDATE.value


# ---------------------------------------------------------------------------
# ReAct grounding — once classify_intent routes a stock question to
# cooking_help, the answer only carries live pantry context if the model
# actually calls check_pantry. Gemini reports supports_tool_calling=True
# (bubbly_chef/ai/gemini.py), so production goes through
# `_cooking_help_react`, not the `_fetch_pantry_context`-driven single-shot
# fallback (`_cooking_help_single_shot`, only reachable when no provider
# supports tool calling). These tests exercise the ReAct path end to end
# with the real `check_pantry` tool (only the repository is mocked) to show
# grounding actually happens there, rather than asserting on the fallback
# path a Gemini deployment never takes.
# ---------------------------------------------------------------------------


def _react_manager(tool_name: str, ingredient: str, final_text: str) -> Any:
    """AIManager mock: one tool-call turn (real check_pantry runs), then a
    final text turn, mirroring how Gemini's ReAct loop actually behaves."""
    from bubbly_chef.ai.provider import ToolCall, ToolCallResponse

    provider = MagicMock()
    provider.supports_tool_calling = True
    provider.name = "gemini"

    manager = MagicMock()
    manager.providers = [provider]
    manager.current_provider = provider
    tool_call = ToolCall(id="tc1", name=tool_name, arguments={"ingredient": ingredient})
    manager.complete_with_tools = AsyncMock(
        side_effect=[
            ToolCallResponse(tool_calls=[tool_call]),
            ToolCallResponse(text=final_text),
        ]
    )
    return manager


class TestReactPathGroundsStockQuestions:
    """`cooking_help_response` picks the ReAct path when a provider supports
    tool calling (it does not consult `_fetch_pantry_context`), so grounding
    for a stock question depends on the model choosing to call
    `check_pantry` and on that tool's own matching. Run the real tool against
    a mocked repository to confirm the wiring actually grounds the answer,
    and that the answer surfaces content check_pantry produced."""

    @pytest.mark.asyncio
    async def test_single_ingredient_stock_question_grounds_via_check_pantry(self) -> None:
        """'do I have spinach?' — the ReAct loop calls check_pantry("spinach"),
        and the real tool (mocked repo) reports the live quantity."""
        import bubbly_chef.tools.cooking  # noqa: F401 — ensure check_pantry is registered

        spinach = MagicMock()
        spinach.name = "spinach"
        spinach.quantity = 2.0
        spinach.unit = "cup"
        spinach.expiry_date = None

        mock_repo = MagicMock()
        mock_repo.find_similar_item = AsyncMock(return_value=spinach)

        manager = _react_manager("check_pantry", "spinach", "Yes, you've got spinach on hand!")

        from bubbly_chef.workflows.chat.nodes import _invoke_tool as real_invoke_tool

        captured_observation: dict[str, str] = {}

        async def _capture_invoke(tool_name: str, arguments: dict[str, Any], user_id: str) -> str:
            observation = await real_invoke_tool(tool_name, arguments, user_id)
            captured_observation["text"] = observation
            return observation

        with (
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager),
            patch(
                "bubbly_chef.tools.cooking.pantry_tools.get_repository",
                new_callable=AsyncMock,
                return_value=mock_repo,
            ),
            patch(
                "bubbly_chef.workflows.chat.nodes._invoke_tool",
                side_effect=_capture_invoke,
            ),
        ):
            result = await cooking_help_response(
                _state(input_text="do I have spinach?", user_id="u1")
            )

        assert result["intent"] == Intent.COOKING_HELP.value
        # The real check_pantry (not a mock) produced a grounded, live-stock
        # observation that the ReAct loop fed back to the model.
        assert "spinach" in captured_observation["text"].lower()
        assert "2.0" in captured_observation["text"]

    @pytest.mark.asyncio
    async def test_category_stock_question_relies_on_whole_word_match(self) -> None:
        """'what cheese do I have?' — check_pantry("cheese") only grounds the
        answer if a pantry row shares the whole word "cheese"; this is a
        known, narrower guarantee than a semantic category match."""
        import bubbly_chef.tools.cooking  # noqa: F401

        cheddar = MagicMock()
        cheddar.name = "cheddar cheese"
        cheddar.quantity = 1.0
        cheddar.unit = "block"
        cheddar.expiry_date = None

        mock_repo = MagicMock()
        mock_repo.find_similar_item = AsyncMock(return_value=None)
        mock_repo.get_all_pantry_items = AsyncMock(return_value=[cheddar])

        manager = _react_manager("check_pantry", "cheese", "You've got cheddar cheese ready to go!")

        with (
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager),
            patch(
                "bubbly_chef.tools.cooking.pantry_tools.get_repository",
                new_callable=AsyncMock,
                return_value=mock_repo,
            ),
        ):
            result = await cooking_help_response(
                _state(input_text="what cheese do I have?", user_id="u1")
            )

        assert result["intent"] == Intent.COOKING_HELP.value
        assert "cheddar" in result["assistant_message"].lower()
