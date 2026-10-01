"""Issue #654 PR B — mid-cook amendments per dish, backend slice.

Two router changes on `workflows/router.py`:

- Router change 1 (S4): a pinned first turn runs with `session_mode="cooking"`
  so it gets the COOKING gate and cooking-bias prompt immediately, instead of
  waiting a turn for `update_session_node` to pin the recipe. Nothing is
  persisted by `load_session` itself.
- Router change 2 (B1): the streaming path (`run_chat_workflow_streaming`,
  which both `/v1/chat/stream` and the non-streaming `/v1/chat` run through)
  detects an amendment after the stream completes and before `done`, but only
  for a `cooking_help` turn carrying a *readable* request-context cook pin (a
  full `cooking_recipe` dict) — never for an id-only pin or a non-cooking_help
  intent. (Originally also "never for the session-snapshot pin alone"; issue
  #489 widened it to a COOKING session's snapshot, see
  test_issue_489_490_cook_amendment.py.)

Both changes share `_request_cook_pin`, extracted from `_resolve_cook_context`'s
existing full-dict test so the two call sites and the legacy cook-handoff path
agree on what counts as a readable pin.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.models.proposals import RecipeAmendmentDetection, RecipeIngredientAmendment
from bubbly_chef.models.session import ConversationSession, SessionMode
from bubbly_chef.workflows import router as router_mod
from bubbly_chef.workflows.router import _request_cook_pin, classify_intent, load_session
from bubbly_chef.workflows.state import LLMIntentResult

# ---------------------------------------------------------------------------
# Fixtures shared by both router changes
# ---------------------------------------------------------------------------

FULL_PIN = {
    "cooking_recipe": {
        "id": "recipe-1",
        "title": "Creamy pasta",
        "ingredients": ["200 g pasta", "150 ml cream"],
    }
}
ID_ONLY_PIN = {"cooking_recipe_id": "recipe-1"}
THIN_DICT_PIN = {"cooking_recipe": {"id": "recipe-1"}}


def _amendment() -> RecipeAmendmentDetection:
    return RecipeAmendmentDetection(
        is_amendment=True,
        amended_ingredients=[
            RecipeIngredientAmendment(name="greek yoghurt", quantity=150, unit="ml"),
        ],
        change_summary="Swapped the cream for Greek yoghurt.",
    )


# ---------------------------------------------------------------------------
# _request_cook_pin
# ---------------------------------------------------------------------------


class TestRequestCookPin:
    def test_full_dict_is_a_readable_pin(self):
        assert _request_cook_pin(FULL_PIN) == FULL_PIN["cooking_recipe"]

    def test_ingredients_only_dict_is_readable(self):
        context = {"cooking_recipe": {"ingredients": ["1 egg"]}}
        assert _request_cook_pin(context) == context["cooking_recipe"]

    def test_id_only_cooking_recipe_id_is_not_readable(self):
        assert _request_cook_pin(ID_ONLY_PIN) is None

    def test_thin_dict_with_only_id_is_not_readable(self):
        assert _request_cook_pin(THIN_DICT_PIN) is None

    def test_none_context_is_not_readable(self):
        assert _request_cook_pin(None) is None

    def test_empty_context_is_not_readable(self):
        assert _request_cook_pin({}) is None

    def test_blank_title_and_no_ingredients_is_not_readable(self):
        context = {"cooking_recipe": {"id": "x", "title": "   "}}
        assert _request_cook_pin(context) is None


# ---------------------------------------------------------------------------
# Router change 1 (S4): a pinned first turn runs as COOKING
#
# These tests leave `load_session` unpatched (call it directly) and patch
# only `get_repository`, per the contract's §6 harness note.
# ---------------------------------------------------------------------------


def _state(**kwargs):
    base: dict = {
        "input_text": "can I use yoghurt instead of cream?",
        "user_id": "u",
        "conversation_id": "conv-1",
        "context": None,
        "brainstorm_ideas": [],
    }
    base.update(kwargs)
    return base


def _repo_with_session(mode: SessionMode, *, conversation_id: str = "conv-1") -> MagicMock:
    repo = MagicMock()
    repo.get_or_create_session = AsyncMock(
        return_value=ConversationSession(conversation_id=conversation_id, active_mode=mode)
    )
    repo.update_session = AsyncMock(return_value=None)
    return repo


def _patch_repo(repo: MagicMock):
    return patch.object(router_mod, "get_repository", new_callable=AsyncMock, return_value=repo)


class TestRouterChange1PinnedFirstTurn:
    @pytest.mark.asyncio
    async def test_pinned_new_session_runs_as_cooking(self):
        repo = _repo_with_session(SessionMode.DEFAULT)
        with _patch_repo(repo):
            result = await load_session(_state(context=FULL_PIN))
        assert result["session_mode"] == "cooking"
        repo.update_session.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_pinned_with_no_conversation_id_runs_as_cooking(self):
        result = await load_session(_state(conversation_id=None, context=FULL_PIN))
        assert result["session_mode"] == "cooking"
        assert result["session"] is None

    @pytest.mark.asyncio
    async def test_pinned_when_session_load_fails_runs_as_cooking(self):
        with patch.object(
            router_mod, "get_repository", AsyncMock(side_effect=RuntimeError("db down"))
        ):
            result = await load_session(_state(context=FULL_PIN))
        assert result["session_mode"] == "cooking"
        assert result["session"] is None

    @pytest.mark.asyncio
    async def test_id_only_pin_first_turn_keeps_default(self):
        repo = _repo_with_session(SessionMode.DEFAULT)
        with _patch_repo(repo):
            result = await load_session(_state(context=ID_ONLY_PIN))
        assert result["session_mode"] == SessionMode.DEFAULT.value
        repo.update_session.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_no_pin_is_unchanged(self):
        repo = _repo_with_session(SessionMode.DEFAULT)
        with _patch_repo(repo):
            result = await load_session(_state(context=None))
        assert result["session_mode"] == SessionMode.DEFAULT.value
        repo.update_session.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_stored_recipe_exploring_mode_is_left_alone(self):
        repo = _repo_with_session(SessionMode.RECIPE_EXPLORING)
        with _patch_repo(repo):
            result = await load_session(_state(context=FULL_PIN))
        assert result["session_mode"] == SessionMode.RECIPE_EXPLORING.value
        repo.update_session.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_stored_cooking_mode_with_pin_stays_cooking(self):
        repo = _repo_with_session(SessionMode.COOKING)
        with _patch_repo(repo):
            result = await load_session(_state(context=FULL_PIN))
        assert result["session_mode"] == SessionMode.COOKING.value
        repo.update_session.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_load_session_never_writes_the_session(self):
        """Router change 1 only affects the returned state, never persistence."""
        repo = _repo_with_session(SessionMode.DEFAULT)
        with _patch_repo(repo):
            await load_session(_state(context=FULL_PIN))
        repo.update_session.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_pinned_first_turn_brainstorm_is_coerced_to_cooking_help(self):
        """End-to-end through classify_intent: the COOKING gate fires on turn one."""
        repo = _repo_with_session(SessionMode.DEFAULT)
        brainstorm = LLMIntentResult(
            intent="recipe_brainstorm", confidence=0.9, reasoning="test", entities=[]
        )
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=brainstorm)
        with (
            _patch_repo(repo),
            patch.object(router_mod, "get_ai_manager", return_value=ai),
        ):
            session_state = await load_session(_state(context=FULL_PIN))
            result = await classify_intent(session_state)
        assert session_state["session_mode"] == "cooking"
        assert result["intent"] == Intent.COOKING_HELP.value

    @pytest.mark.asyncio
    async def test_id_only_pin_first_turn_leaves_brainstorm_uncoerced(self):
        """The id-only pin never sets session_mode='cooking', so the gate doesn't fire."""
        repo = _repo_with_session(SessionMode.DEFAULT)
        brainstorm = LLMIntentResult(
            intent="recipe_brainstorm", confidence=0.9, reasoning="test", entities=[]
        )
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=brainstorm)
        with (
            _patch_repo(repo),
            patch.object(router_mod, "get_ai_manager", return_value=ai),
        ):
            session_state = await load_session(_state(context=ID_ONLY_PIN))
            result = await classify_intent(session_state)
        assert session_state["session_mode"] == SessionMode.DEFAULT.value
        assert result["intent"] == Intent.RECIPE_BRAINSTORM.value


# ---------------------------------------------------------------------------
# Router change 2 (B1): stream-path amendment detection
# ---------------------------------------------------------------------------

_CLASSIFIED_BASE = {
    "request_id": "11111111-1111-4111-8111-111111111111",
    "workflow_id": "22222222-2222-4222-8222-222222222222",
    "conversation_id": None,
    "user_id": "u",
    "input_text": "can I use yoghurt instead of cream?",
    "input_mode": "chat",
    "conversation_history": [],
    "warnings": [],
    "errors": [],
    # Not a COOKING session: the no-pin / id-only cases below must see NO readable
    # pin at all. (Issue #489 widened detection to a COOKING session's own snapshot;
    # that is covered in test_issue_489_490_cook_amendment.py.)
    "session_mode": "default",
    "session": None,
}


async def _collect_stream(
    *,
    intent: str = Intent.COOKING_HELP.value,
    context: dict | None = FULL_PIN,
    detect_amendment: AsyncMock | None = None,
    stream_error: BaseException | None = None,
):
    """Streaming harness modelled on test_issue_498_follow_up_chips.py's
    `_collect_stream`, with `_detect_amendment` patched on the router module
    (not the `chat.nodes` copy the router binds at import time) and a
    `context` knob for the pin.
    """

    async def _tokens(**_kwargs):
        if stream_error is not None:
            raise stream_error
        for tok in ("Sure, ", "swap it."):
            yield tok

    manager = MagicMock()
    manager.stream_complete = _tokens
    manager.complete = AsyncMock()  # follow-up pass; unused with follow_up_chips=False

    dispatch_graph = MagicMock()
    dispatch_graph.ainvoke = AsyncMock(return_value={})

    classified_state = {**_CLASSIFIED_BASE, "intent": intent, "context": context}
    detect_mock = detect_amendment if detect_amendment is not None else AsyncMock(return_value=None)

    with (
        patch.object(router_mod, "get_chat_dispatch_graph", return_value=dispatch_graph),
        patch.object(router_mod, "initialize_state", side_effect=lambda s: s),
        patch.object(router_mod, "load_session", AsyncMock(side_effect=lambda s: s)),
        patch.object(router_mod, "classify_intent", AsyncMock(return_value=classified_state)),
        patch.object(router_mod, "get_ai_manager", return_value=manager),
        patch.object(router_mod, "get_repository", AsyncMock(side_effect=RuntimeError("no db"))),
        patch.object(router_mod, "update_session_node", AsyncMock(side_effect=lambda s: s)),
        patch.object(router_mod, "_detect_amendment", detect_mock),
    ):
        events = [
            json.loads(chunk)
            async for chunk in router_mod.run_chat_workflow_streaming(
                message="can I use yoghurt instead of cream?",
                user_id="u",
                context=context,
                follow_up_chips=False,
            )
        ]
    return events, detect_mock


class TestRouterChange2StreamAmendmentDetection:
    @pytest.mark.asyncio
    async def test_readable_pin_attaches_the_amendment_proposal(self):
        events, detect_mock = await _collect_stream(
            detect_amendment=AsyncMock(return_value=_amendment())
        )
        detect_mock.assert_awaited_once()
        types = [e["type"] for e in events]
        assert max(i for i, t in enumerate(types) if t == "token") < types.index("done")
        assert types.index("done") < types.index("envelope")

        envelope = next(e for e in events if e["type"] == "envelope")["data"]
        assert envelope["proposal"]["proposal_type"] == "recipe_amendment"
        assert envelope["proposal"]["recipe_id"] == "recipe-1"
        assert envelope["requires_review"] is True
        assert envelope["next_action"] == "review_proposal"
        assert envelope["metadata"]["follow_ups_pending"] is False

    @pytest.mark.asyncio
    async def test_without_a_pin_detection_is_not_awaited(self):
        events, detect_mock = await _collect_stream(context=None)
        detect_mock.assert_not_awaited()
        envelope = next(e for e in events if e["type"] == "envelope")["data"]
        assert envelope["proposal"] is None

    @pytest.mark.asyncio
    async def test_id_only_pin_detection_is_not_awaited(self):
        events, detect_mock = await _collect_stream(context=ID_ONLY_PIN)
        detect_mock.assert_not_awaited()
        envelope = next(e for e in events if e["type"] == "envelope")["data"]
        assert envelope["proposal"] is None

    @pytest.mark.asyncio
    async def test_thin_dict_pin_detection_is_not_awaited(self):
        events, detect_mock = await _collect_stream(context=THIN_DICT_PIN)
        detect_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_general_chat_intent_with_pin_is_not_awaited(self):
        events, detect_mock = await _collect_stream(intent=Intent.GENERAL_CHAT.value)
        detect_mock.assert_not_awaited()
        envelope = next(e for e in events if e["type"] == "envelope")["data"]
        assert envelope["proposal"] is None

    @pytest.mark.asyncio
    async def test_detection_raising_falls_back_to_prose_only(self):
        events, detect_mock = await _collect_stream(
            detect_amendment=AsyncMock(side_effect=RuntimeError("provider outage"))
        )
        detect_mock.assert_awaited_once()
        types = [e["type"] for e in events]
        assert "done" in types
        envelope = next(e for e in events if e["type"] == "envelope")["data"]
        assert envelope["proposal"] is None

    @pytest.mark.asyncio
    async def test_stream_failure_skips_detection(self):
        events, detect_mock = await _collect_stream(stream_error=RuntimeError("gemini 500"))
        detect_mock.assert_not_awaited()
        envelope = next(e for e in events if e["type"] == "envelope")["data"]
        assert envelope["proposal"] is None

    @pytest.mark.asyncio
    async def test_no_detection_produces_the_general_chat_envelope(self):
        """No amendment found: the everyday `ProposalEnvelope[None]` shape, unchanged."""
        events, _ = await _collect_stream(detect_amendment=AsyncMock(return_value=None))
        envelope = next(e for e in events if e["type"] == "envelope")["data"]
        assert envelope["proposal"] is None
        assert envelope["requires_review"] is False
        assert envelope["next_action"] == "none"

    @pytest.mark.asyncio
    async def test_envelope_serializes_with_no_warning(self):
        import warnings

        with warnings.catch_warnings():
            warnings.simplefilter("error")
            events, _ = await _collect_stream(detect_amendment=AsyncMock(return_value=_amendment()))
        envelope = next(e for e in events if e["type"] == "envelope")["data"]
        assert envelope["proposal"]["proposal_type"] == "recipe_amendment"
