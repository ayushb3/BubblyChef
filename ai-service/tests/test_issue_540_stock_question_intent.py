"""Issue #540: "do I have spinach?" is classified as pantry_update — the user
gets an add-to-pantry proposal instead of an answer.

Following the `test_issue_493_saved_recipe_lookup.py` pattern: an LLM's actual
classification isn't deterministically testable without hitting the live
model, so the disambiguation itself is checked by asserting the classifier
system prompt carries explicit stock-question examples (cooking_help) next to
contrasting pantry-mutation examples (pantry_update) — the boundary the LLM
is currently missing, per the issue — plus a table-driven mock of
`ai_manager.complete` covering both sides of the boundary.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.prompts.router import INTENT_CLASSIFICATION_SYSTEM_PROMPT
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


def _mock_ai(intent: str, confidence: float = 0.9) -> Any:
    llm_result = LLMIntentResult(intent=intent, confidence=confidence, reasoning="t", entities=[])
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=llm_result)
    return patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai))


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
# Classifier routing — table-driven, mocked LLM
# ---------------------------------------------------------------------------

STOCK_QUESTION_PHRASINGS = [
    "do I have spinach?",
    "is there any milk left?",
    "what cheese do I have?",
    "do we have any eggs?",
    "is there butter in the fridge?",
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
    with _mock_ai("cooking_help"):
        result = await classify_intent(_state(input_text=text))
    assert result["intent"] == Intent.COOKING_HELP.value


@pytest.mark.asyncio
@pytest.mark.parametrize("text", PANTRY_UPDATE_PHRASINGS)
async def test_pantry_mutations_still_route_to_pantry_update(text: str) -> None:
    with _mock_ai("pantry_update"):
        result = await classify_intent(_state(input_text=text))
    assert result["intent"] == Intent.PANTRY_UPDATE.value
