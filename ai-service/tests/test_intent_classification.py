"""Snapshot tests for intent classification.

Replays captured Gemini responses (tests/fixtures/intent_classifications.json)
as mocks — no API calls required. Validates that the classify_intent function
routes each input to the expected intent when the LLM returns the captured result.

Run the capture script to refresh fixtures after any prompt change:
    cd ai-service
    BUBBLY_GEMINI_API_KEY=... python tests/capture_intent_fixtures.py
"""

import hashlib
import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.workflows.router import INTENT_CLASSIFICATION_SYSTEM_PROMPT, classify_intent
from bubbly_chef.workflows.state import LLMIntentResult

_FIXTURES_PATH = Path(__file__).parent / "fixtures" / "intent_classifications.json"


def _load_fixtures() -> dict[str, Any]:
    if not _FIXTURES_PATH.exists():
        pytest.skip(
            f"Fixtures not found at {_FIXTURES_PATH} — "
            "run `python tests/capture_intent_fixtures.py` first",
            allow_module_level=True,
        )
    with _FIXTURES_PATH.open() as f:
        return json.load(f)  # type: ignore[no-any-return]


_FIXTURES = _load_fixtures()

# Verify prompt hasn't drifted from the captured fixtures.
_CURRENT_HASH = hashlib.sha256(INTENT_CLASSIFICATION_SYSTEM_PROMPT.encode()).hexdigest()
_CAPTURED_HASH = _FIXTURES.get("_meta", {}).get("prompt_hash", "")

assert _CURRENT_HASH == _CAPTURED_HASH, (
    f"Prompt hash mismatch — re-run `python tests/capture_intent_fixtures.py`\n"
    f"  captured: {_CAPTURED_HASH[:16]}...\n"
    f"  current:  {_CURRENT_HASH[:16]}..."
)

# Build parametrize list: one entry per fixture case (skip _meta).
_CASES = [
    (text, data)
    for text, data in _FIXTURES.items()
    if text != "_meta"
]


def _base_state(input_text: str, **overrides: Any) -> dict[str, Any]:
    state: dict[str, Any] = {
        "input_text": input_text,
        "errors": [],
        "warnings": [],
        "session_mode": None,
        "session": None,
        "conversation_history": [],
        "selected_recipe_name": None,
    }
    state.update(overrides)
    return state


def _mock_ai(fixture_data: dict[str, Any]) -> Any:
    """Patch get_ai_manager so complete() returns the captured LLMIntentResult."""
    llm_result = LLMIntentResult(
        intent=fixture_data["intent"],
        confidence=fixture_data["confidence"],
        reasoning=fixture_data.get("reasoning") or "captured",
        entities=fixture_data.get("entities") or [],
    )
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=llm_result)
    return patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai))


@pytest.mark.parametrize("input_text,fixture_data", _CASES, ids=[c[0] for c in _CASES])
@pytest.mark.asyncio
async def test_intent_snapshot(input_text: str, fixture_data: dict[str, Any]) -> None:
    expected_intent = fixture_data["expected"]
    confidence = fixture_data["confidence"]

    assert confidence >= 0.7, (
        f"Captured confidence {confidence:.2f} for {input_text!r} is below 0.7 — "
        "re-capture with a clearer prompt or accept this fixture is unreliable"
    )

    with _mock_ai(fixture_data):
        result = await classify_intent(_base_state(input_text))

    assert result["intent"] == expected_intent, (
        f"Expected {expected_intent!r}, got {result['intent']!r} for {input_text!r}"
    )
    assert result.get("intent_confidence", 0) >= 0.7
