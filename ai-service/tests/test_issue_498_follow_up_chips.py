"""Issue #498 — context-aware follow-up chips.

`GeneralChatResponse.follow_up_suggestions` was declared with zero producers
and zero consumers. This test file pins the producer side:

- `suggest_follow_ups` is a structured-output post-pass over the finished
  reply (schema `FollowUpSuggestions`, never raw-string parsing), capped at
  `MAX_FOLLOW_UP_SUGGESTIONS`, deduped, and best-effort (any failure → `[]`).
- The cooking-help ReAct path and the general-chat node carry the result in
  state as `follow_up_suggestions`.
- The router threads it into `envelope.metadata["follow_up_suggestions"]` on
  both the non-streaming and the streaming (SSE) path, the latter being the
  one the UI actually uses.
- The fallback contract: when the pass yields nothing, the key is present and
  empty so the frontend falls back to its static per-intent chips.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.ai.provider import ToolCallResponse
from bubbly_chef.models.base import Intent
from bubbly_chef.models.proposals import FollowUpSuggestions, GeneralChatResponse
from bubbly_chef.workflows.chat.nodes import (
    MAX_FOLLOW_UP_SUGGESTIONS,
    cooking_help_response,
    general_chat_response,
    suggest_follow_ups,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

REPLY = (
    "Chicken is done at 74°C / 165°F in the thickest part. "
    "Rest it for five minutes before slicing."
)
SUGGESTIONS = ["What internal temperature?", "How long should it rest?", "Can I use a thermometer?"]


def _state(**kwargs):
    base: dict = {
        "input_text": "How do I know when chicken is fully cooked?",
        "user_id": "test-user-123",
        "errors": [],
        "warnings": [],
        "session_mode": None,
        "session": None,
        "conversation_history": [],
        "input_mode": "chat",
        "context": None,
    }
    base.update(kwargs)
    return base


def _manager(*, supports_tool_calling: bool = True, complete_result=None):
    provider = MagicMock()
    provider.supports_tool_calling = supports_tool_calling
    provider.name = "mock/provider"
    manager = MagicMock()
    manager.providers = [provider]
    manager.current_provider = provider
    manager.complete = AsyncMock(return_value=complete_result)
    manager.complete_with_tools = AsyncMock(
        return_value=ToolCallResponse(text=REPLY, tool_calls=[])
    )
    return manager


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------


def test_general_chat_response_still_carries_follow_up_suggestions():
    """The dormant field on GeneralChatResponse is unchanged by this change."""
    assert GeneralChatResponse(response_text="hi").follow_up_suggestions == []
    assert "follow_up_suggestions" in FollowUpSuggestions.model_fields


# ---------------------------------------------------------------------------
# suggest_follow_ups — structured post-pass
# ---------------------------------------------------------------------------


class TestSuggestFollowUps:
    @pytest.mark.asyncio
    async def test_uses_structured_schema_and_returns_suggestions(self):
        manager = _manager(complete_result=FollowUpSuggestions(follow_up_suggestions=SUGGESTIONS))
        result = await suggest_follow_ups(manager, "q", REPLY)
        assert result == SUGGESTIONS
        kwargs = manager.complete.await_args.kwargs
        assert kwargs["response_schema"] is FollowUpSuggestions
        assert REPLY in kwargs["prompt"]

    @pytest.mark.asyncio
    async def test_caps_dedupes_and_normalises_whitespace(self):
        raw = ["  What  temp? ", "what temp?", "", "How long?", "Rest time?", "Fifth one?"]
        manager = _manager(complete_result=FollowUpSuggestions(follow_up_suggestions=raw))
        result = await suggest_follow_ups(manager, "q", REPLY)
        assert result == ["What temp?", "How long?", "Rest time?"]
        assert len(result) == MAX_FOLLOW_UP_SUGGESTIONS

    @pytest.mark.asyncio
    async def test_dict_result_is_coerced(self):
        manager = _manager(complete_result={"follow_up_suggestions": ["A?", "B?"]})
        assert await suggest_follow_ups(manager, "q", REPLY) == ["A?", "B?"]

    @pytest.mark.asyncio
    async def test_unexpected_result_type_yields_empty(self):
        """A provider handing back a raw string is not parsed — it is dropped."""
        manager = _manager(complete_result='{"follow_up_suggestions": ["A?"]}')
        assert await suggest_follow_ups(manager, "q", REPLY) == []

    @pytest.mark.asyncio
    async def test_provider_error_yields_empty_and_does_not_raise(self):
        manager = _manager()
        manager.complete = AsyncMock(side_effect=RuntimeError("boom"))
        assert await suggest_follow_ups(manager, "q", REPLY) == []

    @pytest.mark.asyncio
    async def test_blank_reply_skips_the_call(self):
        manager = _manager()
        assert await suggest_follow_ups(manager, "q", "   ") == []
        manager.complete.assert_not_awaited()


# ---------------------------------------------------------------------------
# Nodes carry the suggestions in state
# ---------------------------------------------------------------------------


class TestNodesCarrySuggestions:
    @pytest.mark.asyncio
    async def test_cooking_help_react_path_populates_state(self):
        manager = _manager(complete_result=FollowUpSuggestions(follow_up_suggestions=SUGGESTIONS))
        with (
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager),
            patch("bubbly_chef.workflows.chat.nodes.get_repository", new_callable=AsyncMock),
        ):
            result = await cooking_help_response(_state())
        assert result["intent"] == Intent.COOKING_HELP.value
        assert result["assistant_message"] == REPLY
        assert result["follow_up_suggestions"] == SUGGESTIONS

    @pytest.mark.asyncio
    async def test_cooking_help_react_path_empty_when_pass_fails(self):
        """Fallback contract: the key is present and empty, never missing."""
        manager = _manager()
        manager.complete = AsyncMock(side_effect=RuntimeError("model down"))
        with (
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager),
            patch("bubbly_chef.workflows.chat.nodes.get_repository", new_callable=AsyncMock),
        ):
            result = await cooking_help_response(_state())
        assert result["assistant_message"] == REPLY
        assert result["follow_up_suggestions"] == []

    @pytest.mark.asyncio
    async def test_general_chat_node_populates_state(self):
        manager = _manager()
        manager.complete = AsyncMock(
            side_effect=[REPLY, FollowUpSuggestions(follow_up_suggestions=SUGGESTIONS[:2])]
        )
        with (
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager),
            patch("bubbly_chef.workflows.chat.nodes.get_repository", new_callable=AsyncMock),
        ):
            result = await general_chat_response(_state())
        assert result["intent"] == Intent.GENERAL_CHAT.value
        assert result["assistant_message"] == REPLY
        assert result["follow_up_suggestions"] == SUGGESTIONS[:2]


# ---------------------------------------------------------------------------
# Router threads state → envelope.metadata
# ---------------------------------------------------------------------------


class TestEnvelopeMetadata:
    def test_build_envelope_from_state_carries_suggestions(self):
        from bubbly_chef.workflows.router import _build_envelope_from_state

        env = _build_envelope_from_state(
            {
                "intent": Intent.COOKING_HELP.value,
                "assistant_message": REPLY,
                "follow_up_suggestions": SUGGESTIONS,
            },
            "msg",
            None,
        )
        assert env.metadata["follow_up_suggestions"] == SUGGESTIONS

    def test_build_envelope_from_state_defaults_to_empty(self):
        from bubbly_chef.workflows.router import _build_envelope_from_state

        env = _build_envelope_from_state(
            {"intent": Intent.GENERAL_CHAT.value, "assistant_message": REPLY}, "msg", None
        )
        assert env.metadata["follow_up_suggestions"] == []


# ---------------------------------------------------------------------------
# Streaming path (the one the UI uses)
# ---------------------------------------------------------------------------


async def _collect_stream(**overrides):
    from bubbly_chef.workflows import router as router_mod

    async def _tokens(**_kwargs):
        for tok in ("Chicken ", "is done."):
            yield tok

    manager = _manager()
    manager.stream_complete = _tokens
    manager.complete = AsyncMock(
        return_value=overrides.get(
            "post_pass", FollowUpSuggestions(follow_up_suggestions=SUGGESTIONS)
        )
    )
    classified = {
        "request_id": "11111111-1111-4111-8111-111111111111",
        "workflow_id": "22222222-2222-4222-8222-222222222222",
        "conversation_id": None,
        "user_id": "u",
        "input_text": "how do I know chicken is done?",
        "input_mode": "chat",
        "conversation_history": [],
        "context": None,
        "warnings": [],
        "errors": [],
        "intent": Intent.COOKING_HELP.value,
        "session_mode": None,
        "session": None,
    }

    with (
        patch.object(router_mod, "get_chat_router_graph", return_value=MagicMock()),
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
                message="how do I know chicken is done?", user_id="u"
            )
        ]
    return events, manager


class TestStreamingPath:
    @pytest.mark.asyncio
    async def test_envelope_carries_suggestions_after_done(self):
        events, manager = await _collect_stream()
        types = [e["type"] for e in events]
        assert types.index("done") < types.index("envelope")
        envelope = next(e for e in events if e["type"] == "envelope")["data"]
        assert envelope["intent"] == Intent.COOKING_HELP.value
        assert envelope["metadata"]["follow_up_suggestions"] == SUGGESTIONS
        # The post-pass saw the fully streamed reply, not a partial one.
        assert "Chicken is done." in manager.complete.await_args.kwargs["prompt"]

    @pytest.mark.asyncio
    async def test_envelope_has_empty_list_when_model_returns_nothing(self):
        events, _ = await _collect_stream(
            post_pass=FollowUpSuggestions(follow_up_suggestions=[])
        )
        envelope = next(e for e in events if e["type"] == "envelope")["data"]
        assert envelope["metadata"]["follow_up_suggestions"] == []
