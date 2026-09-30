"""Issue #687: telling chat to forget a diet it remembered from earlier in the chat.

Pattern-matching the message was rejected after three review rounds (it misfired on
"I'm not a vegetarian but my partner is", "we're not vegan tonight", "no longer
vegan?" and "that's not vegetarian!"). So the decision is the extractor's: it
returns a structured `diet_changes` field, and code acts on that field only. Nothing
in this file asserts that any piece of code reads the message text to clear a diet;
every clearing row gets its removal from the mocked structured output, and the same
message text with an empty `diet_changes` keeps the diet.

The model is always mocked. Whether a real model fills `diet_changes` correctly is
the live check tracked in issue #691.
"""

import inspect
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from bubbly_chef.models.base import Intent
from bubbly_chef.models.recipe import DietChanges, RecipeConstraints
from bubbly_chef.models.session import ConversationSession
from bubbly_chef.prompts.recipe import (
    RECIPE_CONSTRAINTS_SYSTEM_PROMPT,
    REMEMBERED_DIETS_CHAT_PREFIX,
    REMEMBERED_DIETS_PROFILE_PREFIX,
)
from bubbly_chef.prompts.router import DIET_CHANGE_FLAG_PROMPT
from bubbly_chef.workflows.recipe.diet_change import resolve_diet_change
from bubbly_chef.workflows.recipe.nodes import (
    apply_diet_change,
    extract_recipe_constraints,
    generate_grounded_recipe,
    research_recipe,
    score_pantry_ingredients,
)
from bubbly_chef.workflows.router import (
    build_chat_router_graph,
    classify_intent,
    route_by_intent,
    update_session_node,
)
from bubbly_chef.workflows.state import LLMIntentResult, LLMRecipeResult

_NODES = "bubbly_chef.workflows.recipe.nodes"
_ROUTER = "bubbly_chef.workflows.router"
STORED = f"{_NODES}.get_stored_dietary_preferences"
USER = "user-687"

# The four phrasings the issue says must never clear a diet.
NEGATIVE_PHRASINGS = [
    "I'm not a vegetarian but my partner is",
    "we're not vegan tonight",
    "no longer vegan?",
    "that's not vegetarian!",
]


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------


class _FakeAI:
    """Stands in for the AIManager: structured extraction + grounded generation."""

    def __init__(self, extraction: RecipeConstraints | None = None) -> None:
        self.extraction = extraction or RecipeConstraints()
        self.extraction_prompts: list[str] = []

    async def complete(self, prompt: str, response_schema: Any = None, **_: Any) -> Any:
        if response_schema is RecipeConstraints:
            self.extraction_prompts.append(prompt)
            return self.extraction
        if response_schema is LLMRecipeResult:
            return LLMRecipeResult(
                title="Generated Dish",
                ingredients=[{"name": "rice", "quantity": 1, "unit": "cup"}],
                instructions=["Cook it."],
                confidence=0.9,
            )
        raise AssertionError(f"unexpected schema {response_schema}")


@contextmanager
def _env(stored: list[str], ai: _FakeAI) -> Iterator[MagicMock]:
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    with (
        patch(STORED, AsyncMock(return_value=stored)),
        patch(f"{_NODES}.get_ai_manager", MagicMock(return_value=ai)),
        patch(f"{_NODES}.get_repository", AsyncMock(return_value=repo)),
        patch(f"{_NODES}.search_recipe", AsyncMock(return_value=None)),
    ):
        yield repo


def _session_of(*dietary: str) -> dict[str, Any]:
    return {"metadata": {"recipe_constraints": {"dietary": list(dietary)}}}


def _state(text: str, session: dict[str, Any] | None, **extra: Any) -> Any:
    return {
        "input_text": text,
        "user_id": USER,
        "errors": [],
        "warnings": [],
        "session": session,
        **extra,
    }


def _removal(*labels: str, scope: str = "conversation") -> RecipeConstraints:
    return RecipeConstraints(diet_changes=DietChanges(remove=list(labels), scope=scope))  # type: ignore[arg-type]


async def _recipe_turn(
    text: str,
    session: dict[str, Any] | None,
    extraction: RecipeConstraints | None = None,
    stored: list[str] | None = None,
) -> tuple[dict[str, Any], _FakeAI]:
    """The direct card path's first two nodes (the diet is decided in the first)."""
    ai = _FakeAI(extraction)
    with _env(stored or [], ai):
        state = await extract_recipe_constraints(_state(text, session))
        state = await score_pantry_ingredients(state)
    return dict(state), ai


async def _save(state: dict[str, Any]) -> ConversationSession:
    """Run `update_session_node` on a turn's result; return the saved session."""
    session = ConversationSession(conversation_id="conv-687")
    repo = MagicMock()
    repo.get_or_create_session = AsyncMock(return_value=session)
    repo.update_session = AsyncMock(return_value=None)
    with patch(f"{_ROUTER}.get_repository", AsyncMock(return_value=repo)):
        await update_session_node({**state, "conversation_id": "conv-687"})  # type: ignore[typeddict-item]
    saved: ConversationSession = repo.update_session.await_args.args[1]
    return saved


def _next_session(saved: ConversationSession) -> dict[str, Any]:
    return {"metadata": saved.metadata.model_dump(mode="json")}


def _persisted(saved: ConversationSession) -> list[str]:
    rc = saved.metadata.recipe_constraints
    return list(rc.dietary) if rc is not None else []


# ---------------------------------------------------------------------------
# The schema
# ---------------------------------------------------------------------------


def test_diet_changes_defaults_to_the_narrow_scope() -> None:
    """No scope from the model means "just this request": the safer reading."""
    assert DietChanges(remove=["Vegetarian"]).scope == "this_request"


def test_an_unknown_scope_is_read_as_this_request_not_a_failed_extraction() -> None:
    """A bad scope must not throw away the rest of the turn's constraints."""
    changes = DietChanges.model_validate({"remove": ["Vegan"], "scope": "forever"})
    assert changes.scope == "this_request"


def test_remove_must_be_a_list_of_labels() -> None:
    with pytest.raises(ValidationError):
        DietChanges.model_validate({"remove": "vegetarian"})


def test_diet_changes_is_optional_on_the_constraints_schema() -> None:
    assert RecipeConstraints().diet_changes is None


# ---------------------------------------------------------------------------
# The resolver never sees the message
# ---------------------------------------------------------------------------


def test_resolver_takes_no_message_text() -> None:
    """No code path can clear a diet on text alone: the resolver has no text to read."""
    params = inspect.signature(resolve_diet_change).parameters
    assert set(params) == {"changes", "session", "stored", "fresh"}


def test_resolver_clears_nothing_without_a_structured_removal() -> None:
    for changes in (None, DietChanges(), DietChanges(remove=[])):
        outcome = resolve_diet_change(changes, ["Vegetarian"], [], [])
        assert outcome.dropped == [] and outcome.relaxed == [] and not outcome.acted


def test_resolver_ignores_a_removal_of_a_diet_the_chat_does_not_hold() -> None:
    outcome = resolve_diet_change(DietChanges(remove=["Vegan"]), ["Vegetarian"], [], [])
    assert not outcome.acted


def test_resolver_keeps_a_diet_the_same_extraction_also_names() -> None:
    """An extraction that both names and drops a diet is contradicting itself: keep it."""
    outcome = resolve_diet_change(
        DietChanges(remove=["Vegetarian"], scope="conversation"),
        ["Vegetarian"],
        [],
        ["vegetarian"],
    )
    assert not outcome.acted


def test_resolver_matches_labels_through_norm_label() -> None:
    outcome = resolve_diet_change(
        DietChanges(remove=["dairy free"], scope="conversation"), ["Dairy-Free"], [], []
    )
    assert outcome.dropped == ["Dairy-Free"]


def test_resolver_never_drops_a_profile_diet() -> None:
    outcome = resolve_diet_change(
        DietChanges(remove=["Vegetarian"], scope="conversation"), [], ["Vegetarian"], []
    )
    assert outcome.dropped == [] and outcome.relaxed == []
    assert outcome.kept_by_profile == ["Vegetarian"]
    assert outcome.acted


# ---------------------------------------------------------------------------
# Negative phrasings keep the diet (the mock returns empty diet_changes)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("text", NEGATIVE_PHRASINGS)
async def test_negative_phrasings_keep_the_diet_on_a_recipe_turn(text: str) -> None:
    state, _ = await _recipe_turn(f"{text}. Suggest a pasta dinner", _session_of("Vegetarian"))
    assert state["recipe_constraints"]["dietary"] == ["Vegetarian"]
    saved = await _save({**state, "intent": Intent.RECIPE_GENERATION.value})
    assert _persisted(saved) == ["Vegetarian"]


@pytest.mark.asyncio
@pytest.mark.parametrize("text", NEGATIVE_PHRASINGS)
async def test_negative_phrasings_keep_the_diet_through_the_diet_change_node(text: str) -> None:
    ai = _FakeAI()  # empty diet_changes
    with _env([], ai):
        out = await apply_diet_change(_state(text, _session_of("Vegetarian")))
    assert out.get("diet_change_applied") is not True
    assert out.get("diet_change_constraints") is None


@pytest.mark.asyncio
async def test_the_same_words_clear_only_when_the_structured_field_says_so() -> None:
    """One message, two mocked outputs. The text decides nothing; the field does."""
    text = "I'm not vegetarian any more"
    kept, _ = await _recipe_turn(text, _session_of("Vegetarian"), RecipeConstraints())
    cleared, _ = await _recipe_turn(text, _session_of("Vegetarian"), _removal("Vegetarian"))
    assert kept["recipe_constraints"]["dietary"] == ["Vegetarian"]
    assert cleared["recipe_constraints"]["dietary"] == []


@pytest.mark.asyncio
async def test_a_failed_extraction_keeps_the_diet() -> None:
    ai = _FakeAI()
    ai.complete = AsyncMock(side_effect=RuntimeError("extraction down"))  # type: ignore[method-assign]
    with _env([], ai):
        state = await extract_recipe_constraints(
            _state("I'm not vegetarian any more", _session_of("Vegetarian"))
        )
    assert state["recipe_constraints"]["dietary"] == ["Vegetarian"]


# ---------------------------------------------------------------------------
# An explicit removal clears it (recipe path)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_explicit_conversation_removal_clears_and_stays_cleared() -> None:
    state, _ = await _recipe_turn(
        "I'm not vegetarian any more, make me a chicken curry",
        _session_of("Vegetarian"),
        _removal("Vegetarian", scope="conversation"),
    )
    assert state["recipe_constraints"]["dietary"] == []
    assert "diet_changes" not in state["recipe_constraints"]

    saved = await _save({**state, "intent": Intent.RECIPE_GENERATION.value})
    assert _persisted(saved) == []

    # The next turn says nothing about diets: the diet must not come back.
    later, _ = await _recipe_turn("now a salad", _next_session(saved))
    assert later["recipe_constraints"]["dietary"] == []


@pytest.mark.asyncio
async def test_diet_changes_is_never_persisted_into_the_session() -> None:
    state, _ = await _recipe_turn(
        "make a curry", _session_of("Vegetarian"), _removal("Vegetarian", scope="conversation")
    )
    saved = await _save({**state, "intent": Intent.RECIPE_GENERATION.value})
    assert saved.metadata.recipe_constraints is not None
    assert saved.metadata.recipe_constraints.diet_changes is None


@pytest.mark.asyncio
async def test_removing_one_diet_keeps_the_others() -> None:
    state, _ = await _recipe_turn(
        "I'm not dairy free any more, make something",
        _session_of("Vegetarian", "Dairy-Free"),
        _removal("dairy free", scope="conversation"),
    )
    assert state["recipe_constraints"]["dietary"] == ["Vegetarian"]


# ---------------------------------------------------------------------------
# this_request relaxes only that turn
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_this_request_scope_does_not_persist_to_the_next_turn() -> None:
    state, _ = await _recipe_turn(
        "we're not vegan tonight, make a cheese pizza",
        _session_of("Vegan"),
        _removal("Vegan", scope="this_request"),
    )
    assert state["recipe_constraints"]["dietary"] == []  # relaxed for this turn

    saved = await _save({**state, "intent": Intent.RECIPE_GENERATION.value})
    assert _persisted(saved) == ["Vegan"]  # still remembered

    later, _ = await _recipe_turn("now a salad", _next_session(saved))
    assert later["recipe_constraints"]["dietary"] == ["Vegan"]  # back on


# ---------------------------------------------------------------------------
# The profile diet is untouched
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("scope", ["conversation", "this_request"])
async def test_a_profile_diet_stays_in_force(scope: str) -> None:
    ai = _FakeAI(_removal("Vegetarian", scope=scope))
    with _env(["Vegetarian"], ai) as repo:
        repo.update_profile = AsyncMock()
        state: Any = await extract_recipe_constraints(
            _state("I'm not vegetarian any more, make me dinner", None)
        )
    assert state["recipe_constraints"]["dietary"] == ["Vegetarian"]
    assert state["stored_dietary"] == ["Vegetarian"]
    # No write reaches the profile (or anything else) from the diet decision.
    repo.update_profile.assert_not_awaited()
    assert {call[0] for call in repo.mock_calls} <= {"get_all_pantry_items"}


@pytest.mark.asyncio
async def test_a_chat_copy_of_a_profile_diet_is_dropped_but_the_profile_still_applies() -> None:
    state, _ = await _recipe_turn(
        "I'm not vegetarian any more, make me dinner",
        _session_of("Vegetarian"),
        _removal("Vegetarian", scope="conversation"),
        stored=["Vegetarian"],
    )
    assert state["recipe_constraints"]["dietary"] == ["Vegetarian"]  # the profile's
    saved = await _save({**state, "intent": Intent.RECIPE_GENERATION.value})
    assert _persisted(saved) == []  # a profile diet is never written into the session


@pytest.mark.asyncio
async def test_a_diet_named_in_this_same_message_is_kept() -> None:
    """The extractor drops Vegetarian but also names it: keep (the safe direction)."""
    extraction = RecipeConstraints(
        dietary=["Vegetarian"],
        diet_changes=DietChanges(remove=["Vegetarian"], scope="conversation"),
    )
    state, _ = await _recipe_turn("make it", _session_of("Vegetarian"), extraction)
    assert state["recipe_constraints"]["dietary"] == ["Vegetarian"]


# ---------------------------------------------------------------------------
# A bare statement reaches the extraction (classifier-level routing)
# ---------------------------------------------------------------------------


def _classifier_ai(result: LLMIntentResult) -> Any:
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=result)
    return ai


async def _classify(result: LLMIntentResult, **state_extra: Any) -> tuple[dict[str, Any], Any]:
    ai = _classifier_ai(result)
    state = {
        "input_text": "I'm not vegetarian any more",
        "errors": [],
        "warnings": [],
        "session_mode": None,
        "session": None,
        "conversation_history": [],
        "selected_recipe_name": None,
        **state_extra,
    }
    with patch(f"{_ROUTER}.get_ai_manager", MagicMock(return_value=ai)):
        out = await classify_intent(state)  # type: ignore[arg-type]
    return dict(out), ai


@pytest.mark.asyncio
async def test_a_flagged_general_chat_turn_routes_to_the_diet_node() -> None:
    out, _ = await _classify(
        LLMIntentResult(intent="general_chat", confidence=0.9, diet_change_mentioned=True)
    )
    assert out["diet_change_mentioned"] is True
    assert route_by_intent(out) == "apply_diet_change"  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_a_flagged_cooking_help_turn_routes_to_the_diet_node() -> None:
    out, _ = await _classify(
        LLMIntentResult(intent="cooking_help", confidence=0.9, diet_change_mentioned=True)
    )
    assert route_by_intent(out) == "apply_diet_change"  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_an_unflagged_general_chat_turn_routes_as_before() -> None:
    out, _ = await _classify(LLMIntentResult(intent="general_chat", confidence=0.9))
    assert route_by_intent(out) == "general_chat_response"  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_a_flagged_recipe_request_still_goes_through_constraint_extraction() -> None:
    out, _ = await _classify(
        LLMIntentResult(intent="recipe_generation", confidence=0.9, diet_change_mentioned=True)
    )
    assert route_by_intent(out) == "extract_recipe_constraints"  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_a_flag_mid_cook_does_not_leave_cooking_help() -> None:
    out, _ = await _classify(
        LLMIntentResult(intent="cooking_help", confidence=0.9, diet_change_mentioned=True),
        session_mode="cooking",
    )
    assert route_by_intent(out) == "cooking_help_response"  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_the_classifier_prompt_carries_the_diet_change_guidance() -> None:
    _, ai = await _classify(LLMIntentResult(intent="general_chat", confidence=0.9))
    prompt = ai.complete.await_args.kwargs["prompt"]
    assert DIET_CHANGE_FLAG_PROMPT in prompt
    assert "diet_change_mentioned" in DIET_CHANGE_FLAG_PROMPT


@pytest.mark.asyncio
async def test_bare_statement_reaches_extraction_clears_and_persists_through_the_graph() -> None:
    """The real dispatch graph: a bare statement is extracted, cleared, and saved."""
    ai = _FakeAI(_removal("Vegetarian", scope="conversation"))
    session = ConversationSession(conversation_id="conv-687")
    repo = MagicMock()
    repo.get_or_create_session = AsyncMock(return_value=session)
    repo.update_session = AsyncMock(return_value=None)
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    graph = build_chat_router_graph(entry_point="dispatch").compile()
    state = _state(
        "I'm not vegetarian any more",
        _session_of("Vegetarian"),
        intent=Intent.GENERAL_CHAT.value,
        diet_change_mentioned=True,
        conversation_id="conv-687",
    )
    with (
        _env([], ai),
        patch(f"{_ROUTER}.get_repository", AsyncMock(return_value=repo)),
    ):
        final = await graph.ainvoke(state)

    assert ai.extraction_prompts, "the extractor never ran for the bare statement"
    assert "Vegetarian" in final["assistant_message"]
    saved = repo.update_session.await_args.args[1]
    assert saved.metadata.recipe_constraints is not None
    assert saved.metadata.recipe_constraints.dietary == []


@pytest.mark.asyncio
async def test_a_flagged_turn_the_extractor_declines_falls_back_to_general_chat() -> None:
    ai = _FakeAI(RecipeConstraints())  # extractor: nothing to remove

    async def general(state: Any) -> Any:
        return {**state, "assistant_message": "general reply"}

    session = ConversationSession(conversation_id="conv-687")
    repo = MagicMock()
    repo.get_or_create_session = AsyncMock(return_value=session)
    repo.update_session = AsyncMock(return_value=None)
    with (
        _env([], ai),
        patch(f"{_ROUTER}.general_chat_response", general),
        patch(f"{_ROUTER}.get_repository", AsyncMock(return_value=repo)),
    ):
        graph = build_chat_router_graph(entry_point="dispatch").compile()
        final = await graph.ainvoke(
            _state(
                "I'm not a vegetarian but my partner is",
                _session_of("Vegetarian"),
                intent=Intent.GENERAL_CHAT.value,
                diet_change_mentioned=True,
                conversation_id="conv-687",
            )
        )
    assert final["assistant_message"] == "general reply"
    saved = repo.update_session.await_args.args[1]
    # Nothing was cleared, and nothing was rewritten either.
    assert saved.metadata.recipe_constraints is None


@pytest.mark.asyncio
@pytest.mark.parametrize("flagged,streams", [(True, False), (False, True)])
async def test_streaming_path_sends_a_flagged_turn_through_the_graph(
    flagged: bool, streams: bool
) -> None:
    """A flagged general_chat turn is answered by the graph, not free-streamed."""
    import json

    from bubbly_chef.workflows import router as router_mod

    classified = {
        "input_text": "I'm not vegetarian any more",
        "intent": Intent.GENERAL_CHAT.value,
        "intent_confidence": 0.9,
        "diet_change_mentioned": flagged,
        "request_id": str(uuid4()),
        "workflow_id": str(uuid4()),
        "errors": [],
        "warnings": [],
    }
    streamed: list[str] = []

    async def _tokens(**_: Any) -> Any:
        streamed.append("called")
        yield "hello"

    manager = MagicMock()
    manager.stream_complete = _tokens
    manager.complete = AsyncMock(side_effect=RuntimeError("no follow-ups"))
    dispatch_graph = MagicMock()
    dispatch_graph.ainvoke = AsyncMock(
        return_value={**classified, "assistant_message": "Okay, I've dropped Vegetarian."}
    )
    with (
        patch.object(router_mod, "get_chat_dispatch_graph", return_value=dispatch_graph),
        patch.object(router_mod, "initialize_state", side_effect=lambda s: s),
        patch.object(router_mod, "load_session", AsyncMock(side_effect=lambda s: s)),
        patch.object(router_mod, "classify_intent", AsyncMock(return_value=classified)),
        patch.object(router_mod, "get_ai_manager", return_value=manager),
        patch.object(router_mod, "get_repository", AsyncMock(side_effect=RuntimeError("no db"))),
        patch.object(router_mod, "update_session_node", AsyncMock(side_effect=lambda s: s)),
    ):
        events = [
            json.loads(chunk)
            async for chunk in router_mod.run_chat_workflow_streaming(
                "I'm not vegetarian any more", conversation_id=str(uuid4()), user_id=USER
            )
        ]

    assert bool(streamed) is streams
    assert (dispatch_graph.ainvoke.await_count == 1) is (not streams)
    if not streams:
        envelope = next(e for e in events if e["type"] == "envelope")
        assert "dropped Vegetarian" in envelope["data"]["assistant_message"]


# ---------------------------------------------------------------------------
# The diet-change node on its own
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_node_makes_no_model_call_when_nothing_is_remembered() -> None:
    ai = _FakeAI(_removal("Vegetarian", scope="conversation"))
    with _env([], ai):
        out = await apply_diet_change(_state("I'm not vegetarian any more", None))
    assert ai.extraction_prompts == []
    assert out.get("diet_change_applied") is not True


@pytest.mark.asyncio
async def test_node_clears_the_chat_diet_and_says_so() -> None:
    ai = _FakeAI(_removal("Vegetarian", scope="conversation"))
    with _env([], ai):
        out = await apply_diet_change(
            _state("I'm not vegetarian any more", _session_of("Vegetarian", "Dairy-Free"))
        )
    assert out["diet_change_applied"] is True
    assert out["diet_change_constraints"]["dietary"] == ["Dairy-Free"]
    assert "Vegetarian" in out["assistant_message"]
    assert "profile" not in out["assistant_message"].lower()


@pytest.mark.asyncio
async def test_node_tells_the_user_a_profile_diet_stays() -> None:
    ai = _FakeAI(_removal("Vegetarian", scope="conversation"))
    with _env(["Vegetarian"], ai):
        out = await apply_diet_change(
            _state("I'm not vegetarian any more", _session_of("Vegetarian"))
        )
    assert out["diet_change_applied"] is True
    message = out["assistant_message"].lower()
    assert "profile" in message
    assert "vegetarian" in message
    # the session copy is cleared, the profile is not written
    assert out["diet_change_constraints"]["dietary"] == []


@pytest.mark.asyncio
async def test_node_with_only_a_profile_diet_still_answers() -> None:
    """Nothing in the chat, but the user tries to drop what their profile holds."""
    ai = _FakeAI(_removal("Vegetarian", scope="conversation"))
    with _env(["Vegetarian"], ai):
        out = await apply_diet_change(_state("I'm not vegetarian any more", None))
    assert out["diet_change_applied"] is True
    assert "profile" in out["assistant_message"].lower()
    assert out.get("diet_change_constraints") is None  # nothing to rewrite in the session


@pytest.mark.asyncio
async def test_node_this_request_persists_nothing() -> None:
    ai = _FakeAI(_removal("Vegan", scope="this_request"))
    with _env([], ai):
        out = await apply_diet_change(_state("we're not vegan tonight", _session_of("Vegan")))
    assert out["diet_change_applied"] is True
    assert out.get("diet_change_constraints") is None
    assert "Vegan" in out["assistant_message"]


@pytest.mark.asyncio
async def test_node_persists_through_update_session() -> None:
    ai = _FakeAI(_removal("Vegetarian", scope="conversation"))
    with _env([], ai):
        out = await apply_diet_change(
            _state("I'm not vegetarian any more", _session_of("Vegetarian"))
        )
    saved = await _save({**out, "intent": Intent.GENERAL_CHAT.value})
    assert _persisted(saved) == []
    assert saved.metadata.recipe_constraints is not None


# ---------------------------------------------------------------------------
# Rendered prompts
# ---------------------------------------------------------------------------


def test_extractor_prompt_guides_the_four_hard_cases() -> None:
    prompt = RECIPE_CONSTRAINTS_SYSTEM_PROMPT
    assert "diet_changes" in prompt
    # each of the four phrasings is named, so the model sees them as NOT clearing
    for phrasing in NEGATIVE_PHRASINGS:
        assert phrasing in prompt
    # and the positive case, with its scopes
    assert "I'm not vegetarian any more" in prompt
    assert "conversation" in prompt and "this_request" in prompt
    # the safe direction is stated
    assert "leave diet_changes empty" in prompt.lower() or "leave it empty" in prompt.lower()


@pytest.mark.asyncio
async def test_the_prompt_actually_sent_carries_the_guidance_and_remembered_diets() -> None:
    _, ai = await _recipe_turn("hello", _session_of("Vegetarian"), stored=["Dairy-Free"])
    sent = ai.extraction_prompts[0]
    for phrasing in NEGATIVE_PHRASINGS:
        assert phrasing in sent
    assert REMEMBERED_DIETS_CHAT_PREFIX + "Vegetarian" in sent  # remembered for this chat
    assert REMEMBERED_DIETS_PROFILE_PREFIX + "Dairy-Free" in sent  # the profile's, named apart
    assert sent.endswith("User message: hello")


@pytest.mark.asyncio
async def test_the_prompt_omits_the_remembered_block_when_nothing_is_remembered() -> None:
    _, ai = await _recipe_turn("hello", None)
    sent = ai.extraction_prompts[0]
    assert REMEMBERED_DIETS_CHAT_PREFIX not in sent
    assert REMEMBERED_DIETS_PROFILE_PREFIX not in sent
    assert sent == RECIPE_CONSTRAINTS_SYSTEM_PROMPT + "\n\nUser message: hello"


# ---------------------------------------------------------------------------
# Regression: unrelated turns are untouched
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_ordinary_turn_inherits_the_chat_diet() -> None:
    state, _ = await _recipe_turn("a quick pasta", _session_of("Vegetarian"))
    assert state["recipe_constraints"]["dietary"] == ["Vegetarian"]


@pytest.mark.asyncio
async def test_generation_still_runs_after_a_removal() -> None:
    ai = _FakeAI(_removal("Vegetarian", scope="conversation"))
    with _env([], ai):
        state: Any = await extract_recipe_constraints(
            _state("I'm not vegetarian any more, chicken curry", _session_of("Vegetarian"))
        )
        state = await score_pantry_ingredients(state)
        state = await research_recipe(state)
        state = await generate_grounded_recipe(state)
    assert state["proposal"].recipe.title == "Generated Dish"
