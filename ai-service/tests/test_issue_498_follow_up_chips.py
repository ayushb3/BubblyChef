"""Issue #498 — context-aware follow-up chips.

`GeneralChatResponse.follow_up_suggestions` was declared with zero producers
and zero consumers. This test file pins the producer side:

- `suggest_follow_ups` is a structured-output post-pass over the finished
  reply (schema `FollowUpSuggestions`, never raw-string parsing), capped at
  `MAX_FOLLOW_UP_SUGGESTIONS`, deduped, and best-effort (any failure → `[]`).
- The graph nodes never run it. The streaming entry point is the only caller:
  it sends the envelope first (with `metadata.follow_ups_pending`), then the
  suggestions as a separate `follow_ups` SSE event, so a turn costs at most
  one extra model call and the reply is never held back for the chips.
- No pass for replies that carry their own actions (idea cards, recipe or
  pantry proposals, the confirm band), for callers that render no chips
  (`follow_up_chips=False`, the guided-cook overlay), or for the error
  fallback reply.
- The fallback contract: when the pass yields nothing, the `follow_ups` event
  still arrives with an empty list, so the frontend falls back to its static
  per-intent chips.
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
# The prompt lives in prompts/ (CODEOWNERS-reviewed), not inline
# ---------------------------------------------------------------------------


def test_follow_up_prompt_is_defined_in_the_prompts_package():
    from bubbly_chef.prompts import chat as chat_prompts
    from bubbly_chef.workflows.chat import nodes

    assert "{user_message}" in chat_prompts._FOLLOW_UP_PROMPT
    assert "{reply_text}" in chat_prompts._FOLLOW_UP_PROMPT
    assert nodes._FOLLOW_UP_PROMPT is chat_prompts._FOLLOW_UP_PROMPT


# ---------------------------------------------------------------------------
# Graph nodes make no follow-up call: the streaming entry owns the one pass
# ---------------------------------------------------------------------------


class TestNodesMakeNoFollowUpCall:
    @pytest.mark.asyncio
    async def test_cooking_help_react_path_does_not_run_the_post_pass(self):
        manager = _manager(complete_result=FollowUpSuggestions(follow_up_suggestions=SUGGESTIONS))
        with (
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager),
            patch("bubbly_chef.workflows.chat.nodes.get_repository", new_callable=AsyncMock),
        ):
            result = await cooking_help_response(_state())
        assert result["assistant_message"] == REPLY
        schemas = [c.kwargs.get("response_schema") for c in manager.complete.await_args_list]
        assert FollowUpSuggestions not in schemas
        assert "follow_up_suggestions" not in result

    @pytest.mark.asyncio
    async def test_general_chat_node_makes_exactly_one_call(self):
        manager = _manager()
        manager.complete = AsyncMock(return_value=REPLY)
        with (
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager),
            patch("bubbly_chef.workflows.chat.nodes.get_repository", new_callable=AsyncMock),
        ):
            result = await general_chat_response(_state())
        assert result["assistant_message"] == REPLY
        manager.complete.assert_awaited_once()


# ---------------------------------------------------------------------------
# Streaming path (the one the UI uses): envelope first, chips after
# ---------------------------------------------------------------------------

_CLASSIFIED = {
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


async def _collect_stream(
    *,
    intent=Intent.COOKING_HELP.value,
    dispatch_final=None,
    post_pass=None,
    stream_error=None,
    follow_up_chips=True,
):
    from bubbly_chef.workflows import router as router_mod

    async def _tokens(**_kwargs):
        if stream_error is not None:
            raise stream_error
        for tok in ("Chicken ", "is done."):
            yield tok

    manager = _manager()
    manager.stream_complete = _tokens
    if isinstance(post_pass, BaseException):
        manager.complete = AsyncMock(side_effect=post_pass)
    else:
        manager.complete = AsyncMock(
            return_value=post_pass
            if post_pass is not None
            else FollowUpSuggestions(follow_up_suggestions=SUGGESTIONS)
        )
    dispatch_graph = MagicMock()
    dispatch_graph.ainvoke = AsyncMock(return_value=dispatch_final or {})

    with (
        patch.object(router_mod, "get_chat_dispatch_graph", return_value=dispatch_graph),
        patch.object(router_mod, "initialize_state", side_effect=lambda s: s),
        patch.object(router_mod, "load_session", AsyncMock(side_effect=lambda s: s)),
        patch.object(
            router_mod, "classify_intent", AsyncMock(return_value={**_CLASSIFIED, "intent": intent})
        ),
        patch.object(router_mod, "get_ai_manager", return_value=manager),
        patch.object(router_mod, "get_repository", AsyncMock(side_effect=RuntimeError("no db"))),
        patch.object(router_mod, "update_session_node", AsyncMock(side_effect=lambda s: s)),
    ):
        events = [
            json.loads(chunk)
            async for chunk in router_mod.run_chat_workflow_streaming(
                message="how do I know chicken is done?",
                user_id="u",
                follow_up_chips=follow_up_chips,
            )
        ]
    return events, manager


class TestStreamingPath:
    @pytest.mark.asyncio
    async def test_envelope_is_sent_before_the_chips_are_computed(self):
        events, manager = await _collect_stream()
        types = [e["type"] for e in events]
        assert types.index("done") < types.index("envelope") < types.index("follow_ups")
        envelope = next(e for e in events if e["type"] == "envelope")["data"]
        # The envelope does not wait for the chips: it says they are coming.
        assert envelope["metadata"]["follow_ups_pending"] is True
        assert "follow_up_suggestions" not in envelope["metadata"]
        follow = next(e for e in events if e["type"] == "follow_ups")["data"]
        assert follow["suggestions"] == SUGGESTIONS
        # The post-pass saw the fully streamed reply, not a partial one.
        assert "Chicken is done." in manager.complete.await_args.kwargs["prompt"]

    @pytest.mark.asyncio
    async def test_a_text_turn_costs_exactly_one_extra_call(self):
        _, manager = await _collect_stream()
        manager.complete.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_empty_model_output_still_sends_an_empty_follow_ups_event(self):
        events, _ = await _collect_stream(post_pass=FollowUpSuggestions(follow_up_suggestions=[]))
        follow = next(e for e in events if e["type"] == "follow_ups")["data"]
        assert follow["suggestions"] == []

    @pytest.mark.asyncio
    async def test_post_pass_failure_sends_empty_and_the_stream_completes(self):
        events, _ = await _collect_stream(post_pass=RuntimeError("model down"))
        assert [e["type"] for e in events][-1] == "follow_ups"
        assert next(e for e in events if e["type"] == "follow_ups")["data"]["suggestions"] == []

    @pytest.mark.asyncio
    async def test_reply_with_idea_cards_gets_no_follow_up_pass(self):
        """A brainstorm reply renders its own tappable idea cards: no chip pass."""
        events, manager = await _collect_stream(
            intent=Intent.RECIPE_BRAINSTORM.value,
            dispatch_final={
                "intent": Intent.RECIPE_BRAINSTORM.value,
                "assistant_message": "Here are some ideas",
                "brainstorm_ideas": ["Stew", "Curry"],
            },
        )
        envelope = next(e for e in events if e["type"] == "envelope")["data"]
        assert envelope["metadata"].get("follow_ups_pending") is False
        assert "follow_ups" not in [e["type"] for e in events]
        manager.complete.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_reply_with_confirm_buttons_gets_no_follow_up_pass(self):
        from bubbly_chef.models.base import NextAction

        events, manager = await _collect_stream(
            intent=Intent.RECIPE_CARD.value,
            dispatch_final={
                "intent": Intent.GENERAL_CHAT.value,
                "assistant_message": "Tweak this recipe or start fresh?",
                "next_action": NextAction.CONFIRM_CHOICE.value,
                "confirm_options": [{"label": "Tweak", "forced_intent": "recipe_card"}],
            },
        )
        assert "follow_ups" not in [e["type"] for e in events]
        manager.complete.assert_not_awaited()


class TestSkippedWhenNobodyShowsChips:
    @pytest.mark.asyncio
    async def test_caller_that_renders_no_chips_makes_no_call(self):
        """The guided-cook overlay streams chat but never renders chips."""
        events, manager = await _collect_stream(follow_up_chips=False)
        envelope = next(e for e in events if e["type"] == "envelope")["data"]
        assert envelope["metadata"]["follow_ups_pending"] is False
        assert "follow_ups" not in [e["type"] for e in events]
        manager.complete.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_error_fallback_reply_makes_no_call(self):
        """'Sorry, I ran into an error' is not something to suggest follow-ups for."""
        events, manager = await _collect_stream(stream_error=RuntimeError("gemini 500"))
        envelope = next(e for e in events if e["type"] == "envelope")["data"]
        assert envelope["assistant_message"].startswith("Sorry, I ran into an error")
        assert envelope["metadata"]["follow_ups_pending"] is False
        assert "follow_ups" not in [e["type"] for e in events]
        manager.complete.assert_not_awaited()


# ---------------------------------------------------------------------------
# The route folds the late event into what it persists
# ---------------------------------------------------------------------------


def test_merge_follow_ups_into_envelope_updates_metadata():
    from bubbly_chef.workflows.router import merge_follow_ups_into_envelope

    envelope = {"intent": "cooking_help", "metadata": {"follow_ups_pending": True}}
    merge_follow_ups_into_envelope(envelope, {"suggestions": SUGGESTIONS})
    assert envelope["metadata"]["follow_up_suggestions"] == SUGGESTIONS
    assert envelope["metadata"]["follow_ups_pending"] is False


def test_merge_follow_ups_into_envelope_tolerates_missing_pieces():
    from bubbly_chef.workflows.router import merge_follow_ups_into_envelope

    envelope: dict = {"intent": "cooking_help"}
    merge_follow_ups_into_envelope(envelope, {"suggestions": "not a list"})
    assert envelope["metadata"] == {"follow_up_suggestions": [], "follow_ups_pending": False}
