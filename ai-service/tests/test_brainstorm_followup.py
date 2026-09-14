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
from bubbly_chef.workflows.recipe.nodes import extract_selected_recipe, extract_selected_recipe_by_name  # noqa: E402
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
    # "what's in the first idea?" is informational but "first" is an ordinal →
    # ordinal wins; this documents that ordinals take precedence over the
    # informational guard.
    assert (
        extract_selected_recipe("what's in the first idea?", _BRAINSTORM_HISTORY)
        == "Cheesy Chicken Bites"
    )
    # No ordinal → informational guard fires → no selection.
    assert extract_selected_recipe("what's in them", _BRAINSTORM_HISTORY) is None


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
# #442: "the <name> one instead" must select by NAME, not fall to idea[0]
# because the bare word "one" used to be treated as ordinal index 0.
# ---------------------------------------------------------------------------


def test_extract_name_plus_one_selects_by_name_not_first() -> None:
    """'show me the pasta one instead' → Pasta Primavera, NOT the first idea.

    Regression for #442: 'one' was in the ordinal map and matched before the
    fuzzy name pass, so any 'the <name> one' phrase returned ideas[0]."""
    result = extract_selected_recipe(
        "show me the pasta one instead", _BRAINSTORM_HISTORY
    )
    assert result == "Pasta Primavera"


def test_extract_name_plus_one_selects_third_by_name() -> None:
    """'the tacos one' names the third idea — must not resolve to idea[0]."""
    result = extract_selected_recipe("actually the tacos one", _BRAINSTORM_HISTORY)
    assert result == "Beef Tacos"


def test_extract_bare_one_still_selects_first_when_no_name_matches() -> None:
    """With no name in the text, a bare 'give me number one' still means idx 0
    (fallback path preserved)."""
    result = extract_selected_recipe("give me number one", _BRAINSTORM_HISTORY)
    assert result == "Cheesy Chicken Bites"


def test_extract_ordinal_still_wins_over_name() -> None:
    """'the first one' keeps ordinal precedence → idx 0, unchanged by the fix."""
    result = extract_selected_recipe("the first one", _BRAINSTORM_HISTORY)
    assert result == "Cheesy Chicken Bites"


def test_extract_one_inside_word_does_not_trigger_selection() -> None:
    """Word-boundary match: 'one' inside 'someone'/'done' must not pick idx 0."""
    result = extract_selected_recipe(
        "has anyone done these before?", _BRAINSTORM_HISTORY
    )
    assert result is None


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


# ---------------------------------------------------------------------------
# Unit tests for extract_selected_recipe_by_name (name-match-only path)
# Ticket #442, defect 3: pinned-session re-pick to a different offered idea.
# ---------------------------------------------------------------------------

_TOAST_PORRIDGE_IDEAS = [
    "Thai-Style Garlic Toast",
    "Sweet Coconut Milk Toast",
    "Savory Thai Rice Porridge",
]

_TOAST_PORRIDGE_HISTORY: list[dict[str, Any]] = [
    {
        "role": "assistant",
        "content": (
            "Here are some ideas:\n"
            "**Thai-Style Garlic Toast** - crispy toast with garlic\n"
            "**Sweet Coconut Milk Toast** - a sweet breakfast toast\n"
            "**Savory Thai Rice Porridge** - comforting congee-style porridge\n"
        ),
        "intent": Intent.RECIPE_BRAINSTORM.value,
    },
]


def test_name_only_porridge_with_one() -> None:
    """'show me the porridge one instead' → name match → 'Savory Thai Rice Porridge'."""
    result = extract_selected_recipe_by_name(
        "show me the porridge one instead",
        _TOAST_PORRIDGE_HISTORY,
        stored_ideas=_TOAST_PORRIDGE_IDEAS,
    )
    assert result == "Savory Thai Rice Porridge"


def test_name_only_porridge_without_one() -> None:
    """'show me the porridge instead' (no 'one') → still a name match."""
    result = extract_selected_recipe_by_name(
        "show me the porridge instead",
        _TOAST_PORRIDGE_HISTORY,
        stored_ideas=_TOAST_PORRIDGE_IDEAS,
    )
    assert result == "Savory Thai Rice Porridge"


def test_name_only_rejects_the_first_one() -> None:
    """'the first one' is positional — name-only extractor returns None."""
    result = extract_selected_recipe_by_name(
        "the first one",
        _TOAST_PORRIDGE_HISTORY,
        stored_ideas=_TOAST_PORRIDGE_IDEAS,
    )
    assert result is None


def test_name_only_rejects_number_two() -> None:
    """'number two' is a bare cardinal — name-only extractor returns None."""
    result = extract_selected_recipe_by_name(
        "number two",
        _TOAST_PORRIDGE_HISTORY,
        stored_ideas=_TOAST_PORRIDGE_IDEAS,
    )
    assert result is None


def test_name_only_rejects_add_pesto() -> None:
    """'add pesto to it' is a modification, not a stored idea name → None."""
    result = extract_selected_recipe_by_name(
        "add pesto to it",
        _TOAST_PORRIDGE_HISTORY,
        stored_ideas=_TOAST_PORRIDGE_IDEAS,
    )
    assert result is None


# ---------------------------------------------------------------------------
# MEDIUM regression: sibling near-tie / shared-token ambiguity guard
# Ideas: Garlic Toast Supreme, Garlic Bread Twists, Tomato Basil Soup
# Pinned: Garlic Bread Twists
# "the garlic one" → both Garlic Toast Supreme AND Garlic Bread Twists share
# the decisive "garlic" token → ambiguous → must return None (not re-pick
# to the sibling silently).
# ---------------------------------------------------------------------------

_SIBLING_IDEAS = ["Garlic Toast Supreme", "Garlic Bread Twists", "Tomato Basil Soup"]
_SIBLING_HISTORY: list[dict[str, Any]] = [
    {
        "role": "assistant",
        "content": (
            "**Garlic Toast Supreme** - rich garlic toast\n"
            "**Garlic Bread Twists** - twisted garlic bread\n"
            "**Tomato Basil Soup** - classic tomato soup\n"
        ),
        "intent": Intent.RECIPE_BRAINSTORM.value,
    },
]


def test_name_only_sibling_garlic_ambiguous_returns_none() -> None:
    """'the garlic one' with pinned='Garlic Bread Twists' — both sibling ideas
    share the decisive 'garlic' token with the pinned dish → ambiguous → None."""
    result = extract_selected_recipe_by_name(
        "the garlic one",
        _SIBLING_HISTORY,
        stored_ideas=_SIBLING_IDEAS,
        picked_title="Garlic Bread Twists",
    )
    assert result is None


def test_name_only_sibling_tomato_unambiguous() -> None:
    """'show me the tomato one instead' with pinned='Garlic Bread Twists' —
    'tomato' does not appear in the pinned title → unambiguous → Tomato Basil Soup."""
    result = extract_selected_recipe_by_name(
        "show me the tomato one instead",
        _SIBLING_HISTORY,
        stored_ideas=_SIBLING_IDEAS,
        picked_title="Garlic Bread Twists",
    )
    assert result == "Tomato Basil Soup"


# ---------------------------------------------------------------------------
# LOW 2 regression: novel comparatives caught by the regex rule
# ---------------------------------------------------------------------------


def test_name_only_novel_comparative_gooier_blocks_repick() -> None:
    """'make it gooier' — 'gooier' matched by \\b\\w{4,}ier\\b → modification guard fires → None."""
    result = extract_selected_recipe_by_name(
        "make it gooier",
        _TOAST_PORRIDGE_HISTORY,
        stored_ideas=_TOAST_PORRIDGE_IDEAS,
        picked_title="Thai-Style Garlic Toast",
    )
    assert result is None


# ---------------------------------------------------------------------------
# Regression: dish names ending in -er must NOT be swallowed by the
# comparative guard.  The old \b\w{5,}(ier|er)\b regex fired on food nouns
# like "cheeseburger", "burger", "pepper", "butter", blocking legitimate
# re-picks.  The tightened guard uses -ier-only regex + explicit -er set.
# ---------------------------------------------------------------------------

_BURGER_IDEAS = ["Classic Cheeseburger", "Pasta Primavera", "Tomato Soup"]
_BURGER_HISTORY: list[dict[str, Any]] = [
    {
        "role": "assistant",
        "content": (
            "**Classic Cheeseburger** - classic beef patty\n"
            "**Pasta Primavera** - light veggie pasta\n"
            "**Tomato Soup** - warming tomato soup\n"
        ),
        "intent": Intent.RECIPE_BRAINSTORM.value,
    },
]


def test_name_only_cheeseburger_repick_not_blocked() -> None:
    """'show me the cheeseburger one instead' — 'cheeseburger' ends in -er but
    is a food noun, NOT a comparative → must re-pick to 'Classic Cheeseburger'."""
    result = extract_selected_recipe_by_name(
        "show me the cheeseburger one instead",
        _BURGER_HISTORY,
        stored_ideas=_BURGER_IDEAS,
        picked_title="Pasta Primavera",
    )
    assert result == "Classic Cheeseburger"


def test_name_only_spicier_still_blocked() -> None:
    """'make it spicier' — 'spicier' ends -ier → modification guard still fires → None."""
    result = extract_selected_recipe_by_name(
        "make it spicier",
        _BURGER_HISTORY,
        stored_ideas=_BURGER_IDEAS,
        picked_title="Classic Cheeseburger",
    )
    assert result is None


def test_name_only_sweeter_explicit_er_blocked() -> None:
    """'a bit sweeter' — 'sweeter' is in the explicit -er set → modification guard → None."""
    result = extract_selected_recipe_by_name(
        "a bit sweeter",
        _BURGER_HISTORY,
        stored_ideas=_BURGER_IDEAS,
        picked_title="Classic Cheeseburger",
    )
    assert result is None
