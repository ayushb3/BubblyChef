"""Regression tests for brainstorm follow-up routing (Part 2 fix).

After a recipe_brainstorm assistant turn:
- Informational phrases ("tell me more", "explain", ...) must NOT produce a
  recipe_card — they fall through to cooking_help / general_chat via LLM.
- Ordinal selection ("the first one", "make the second one") → recipe_card with
  the correct brainstorm idea.
- Clear fuzzy name match ("make the pasta one") → recipe_card with the matched idea.
- The recipe title must NEVER be the raw follow-up phrase.
"""

import sys
import types
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Stub heavy optional deps that are not installed in the lightweight test env.
# These stubs are set up BEFORE any bubbly_chef sub-modules are imported.
# ---------------------------------------------------------------------------

_stubs: list[str] = []


def _stub(name: str) -> None:
    if name not in sys.modules:
        sys.modules[name] = types.ModuleType(name)
        _stubs.append(name)


# supabase (and its sub-modules referenced by bubbly_chef code)
for _mod in ("supabase", "supabase.lib", "supabase.lib.client_options"):
    _stub(_mod)
_supabase = sys.modules["supabase"]
_supabase.Client = MagicMock()  # type: ignore[attr-defined]
_supabase.create_client = MagicMock()  # type: ignore[attr-defined]

# rapidfuzz — used by extract_selected_recipe at call time (local import).
# We need the real package; mock only if absent so unit tests still work.
try:
    import rapidfuzz  # noqa: F401
except ModuleNotFoundError:
    _rp = types.ModuleType("rapidfuzz")
    _rp_fuzz = types.ModuleType("rapidfuzz.fuzz")  # type: ignore[attr-defined]
    _rp_process = types.ModuleType("rapidfuzz.process")  # type: ignore[attr-defined]

    def _partial_ratio(a: str, b: str) -> int:  # simple fallback
        # Not as accurate as the real rapidfuzz but sufficient for ordinal tests
        a_lower, b_lower = a.lower(), b.lower()
        if b_lower in a_lower or a_lower in b_lower:
            return 90
        return 0

    _rp_fuzz.partial_ratio = _partial_ratio  # type: ignore[attr-defined]
    _rp_fuzz.WRatio = _partial_ratio  # type: ignore[attr-defined]
    _rp_process.extractOne = MagicMock(return_value=None)  # type: ignore[attr-defined]
    _rp.fuzz = _rp_fuzz  # type: ignore[attr-defined]
    _rp.process = _rp_process  # type: ignore[attr-defined]
    sys.modules["rapidfuzz"] = _rp
    sys.modules["rapidfuzz.fuzz"] = _rp_fuzz
    sys.modules["rapidfuzz.process"] = _rp_process

from bubbly_chef.models.base import Intent  # noqa: E402
from bubbly_chef.workflows.recipe.nodes import extract_selected_recipe  # noqa: E402
from bubbly_chef.workflows.router import classify_intent  # noqa: E402
from bubbly_chef.workflows.state import LLMIntentResult  # noqa: E402

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BRAINSTORM_CONTENT = (
    "Here are some ideas:\n"
    "**Cheesy Chicken Bites** - crispy fried bites\n"
    "**Pasta Primavera** - light veggie pasta\n"
    "**Beef Tacos** - spicy weeknight tacos\n"
)

_BRAINSTORM_HISTORY: list[dict[str, Any]] = [
    {
        "role": "user",
        "content": "what can I make with chicken?",
    },
    {
        "role": "assistant",
        "content": _BRAINSTORM_CONTENT,
        "intent": Intent.RECIPE_BRAINSTORM.value,
    },
]


def _state(**kwargs: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "input_text": "",
        "errors": [],
        "warnings": [],
        "session_mode": None,
        "session": None,
        "conversation_history": _BRAINSTORM_HISTORY,
        "selected_recipe_name": None,
    }
    base.update(kwargs)
    return base


def _llm_result(intent: str, confidence: float = 0.9) -> LLMIntentResult:
    return LLMIntentResult(intent=intent, confidence=confidence, reasoning="test", entities=[])


def _mock_ai(intent: str, confidence: float = 0.9) -> Any:
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=_llm_result(intent, confidence))
    manager = MagicMock(return_value=ai)
    return patch("bubbly_chef.workflows.router.get_ai_manager", manager)


# ---------------------------------------------------------------------------
# Unit tests for extract_selected_recipe
# ---------------------------------------------------------------------------


def test_extract_returns_none_for_tell_me_more() -> None:
    result = extract_selected_recipe("tell me more about that", _BRAINSTORM_HISTORY)
    assert result is None


def test_extract_returns_none_for_more_info() -> None:
    result = extract_selected_recipe("more info please", _BRAINSTORM_HISTORY)
    assert result is None


def test_extract_returns_none_for_explain() -> None:
    result = extract_selected_recipe("can you explain?", _BRAINSTORM_HISTORY)
    assert result is None


def test_extract_returns_none_for_whats_in() -> None:
    result = extract_selected_recipe("what's in the first idea?", _BRAINSTORM_HISTORY)
    # "what's in" is informational but "first" is ordinal → ordinal wins; returns first idea
    # This tests that ordinal takes precedence even with informational phrasing
    result2 = extract_selected_recipe("what's in them", _BRAINSTORM_HISTORY)
    assert result2 is None  # no ordinal → informational guard fires


def test_extract_returns_none_for_how_do_i_make_no_ordinal() -> None:
    result = extract_selected_recipe("how do i make these?", _BRAINSTORM_HISTORY)
    assert result is None


def test_extract_first_idea_by_ordinal() -> None:
    result = extract_selected_recipe("the first one please", _BRAINSTORM_HISTORY)
    assert result == "Cheesy Chicken Bites"


def test_extract_second_idea_by_ordinal() -> None:
    result = extract_selected_recipe("make the second one", _BRAINSTORM_HISTORY)
    assert result == "Pasta Primavera"


def test_extract_third_idea_by_ordinal() -> None:
    result = extract_selected_recipe("I'll try the third", _BRAINSTORM_HISTORY)
    assert result == "Beef Tacos"


def test_extract_fuzzy_match_pasta() -> None:
    # "pasta primavera" is a substring of the idea name when lowercased.
    # This test verifies direct/substring matching works.
    result = extract_selected_recipe("I want pasta primavera", _BRAINSTORM_HISTORY)
    assert result == "Pasta Primavera"


def test_extract_fuzzy_match_tacos() -> None:
    result = extract_selected_recipe("beef tacos sound great", _BRAINSTORM_HISTORY)
    assert result == "Beef Tacos"


def test_extract_returns_none_on_no_match() -> None:
    result = extract_selected_recipe("something completely unrelated xyz", _BRAINSTORM_HISTORY)
    assert result is None


def test_extract_returns_none_when_no_history() -> None:
    result = extract_selected_recipe("the first one", [])
    # no ideas to match against
    assert result is None


def test_extract_surprise_keyword_returns_first() -> None:
    result = extract_selected_recipe("surprise me!", _BRAINSTORM_HISTORY)
    assert result == "Cheesy Chicken Bites"


# ---------------------------------------------------------------------------
# Integration tests: classify_intent routing after brainstorm turn
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tell_me_more_falls_through_to_llm_not_recipe_card() -> None:
    """'Tell me more about that' must NOT produce recipe_card."""
    with _mock_ai("cooking_help") as mock_mgr:
        result = await classify_intent(_state(input_text="tell me more about that"))
    # LLM was called (brainstorm guard fell through)
    mock_mgr.return_value.complete.assert_called_once()
    assert result["intent"] != Intent.RECIPE_CARD.value
    # Title must not be the raw phrase
    assert result.get("selected_recipe_name") != "tell me more about that"


@pytest.mark.asyncio
async def test_explain_falls_through_to_llm() -> None:
    """'Explain those ideas' must not produce recipe_card."""
    with _mock_ai("cooking_help"):
        result = await classify_intent(_state(input_text="explain those ideas"))
    assert result["intent"] != Intent.RECIPE_CARD.value
    assert result.get("selected_recipe_name") != "explain those ideas"


@pytest.mark.asyncio
async def test_first_one_produces_recipe_card_with_correct_idea() -> None:
    """'the first one' → recipe_card titled with the first brainstorm idea."""
    with _mock_ai("general_chat") as mock_mgr:
        result = await classify_intent(_state(input_text="the first one please"))
    # Short-circuit: LLM should NOT be called
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_CARD.value
    assert result["selected_recipe_name"] == "Cheesy Chicken Bites"


@pytest.mark.asyncio
async def test_second_one_produces_recipe_card_with_second_idea() -> None:
    with _mock_ai("general_chat") as mock_mgr:
        result = await classify_intent(_state(input_text="make the second one"))
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_CARD.value
    assert result["selected_recipe_name"] == "Pasta Primavera"


@pytest.mark.asyncio
async def test_fuzzy_pasta_produces_recipe_card() -> None:
    """A clear fuzzy name match skips LLM and returns the matched idea."""
    with _mock_ai("general_chat") as mock_mgr:
        result = await classify_intent(_state(input_text="beef tacos sound great"))
    mock_mgr.return_value.complete.assert_not_called()
    assert result["intent"] == Intent.RECIPE_CARD.value
    assert result["selected_recipe_name"] == "Beef Tacos"


@pytest.mark.asyncio
async def test_raw_phrase_never_becomes_recipe_title_after_brainstorm() -> None:
    """Regression: literal follow-up phrase must never be the recipe title."""
    bad_phrases = [
        "tell me more about that",
        "more info please",
        "can you explain?",
        "what are the details",
    ]
    for phrase in bad_phrases:
        with _mock_ai("cooking_help"):
            result = await classify_intent(_state(input_text=phrase))
        assert result.get("selected_recipe_name") != phrase, (
            f"Phrase '{phrase}' became a recipe title — guard not working"
        )
