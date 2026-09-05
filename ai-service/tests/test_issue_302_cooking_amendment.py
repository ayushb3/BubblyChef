"""Issue #302: cooking-mode chat turns emit a structured recipe amendment proposal.

When the user is in cooking mode (session pinned to a recipe) and amends the
recipe mid-cook ("I'm out of cream, use milk instead"), the cooking-help node
must:
  1. Return the original prose reply unchanged.
  2. Run a second structured-output pass to detect the amendment.
  3. If an amendment is detected, return a typed RecipeAmendmentDetection payload
     in the proposal field with requires_review=True.
  4. If the turn is NOT an amendment, return proposal=None / requires_review=False
     (identical to pre-#302 behaviour).
  5. If the detection pass itself fails, degrade gracefully: proposal=None,
     requires_review=False — never fail the cooking-help turn.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.ai.provider import ToolCallResponse
from bubbly_chef.models.base import Intent, NextAction, WorkflowStatus
from bubbly_chef.models.proposals import RecipeAmendmentDetection, RecipeIngredientAmendment
from bubbly_chef.workflows.chat.nodes import (
    _detect_amendment,
    cooking_help_response,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PINNED_RECIPE = {
    "id": "recipe-abc",
    "title": "Creamy Pasta",
    "ingredients": [
        {"name": "pasta", "quantity": 200, "unit": "g"},
        {"name": "heavy cream", "quantity": 200, "unit": "ml"},
        {"name": "parmesan", "quantity": 50, "unit": "g"},
    ],
}

_AMENDED_INGREDIENTS = [
    RecipeIngredientAmendment(name="pasta", quantity=200.0, unit="g"),
    RecipeIngredientAmendment(
        name="milk", quantity=200.0, unit="ml", notes="substituted for heavy cream"
    ),
    RecipeIngredientAmendment(name="parmesan", quantity=50.0, unit="g"),
]

_AMENDMENT_DETECTION_RESULT = RecipeAmendmentDetection(
    is_amendment=True,
    amended_ingredients=_AMENDED_INGREDIENTS,
    change_summary="Replaced heavy cream with milk.",
)

_NO_AMENDMENT_RESULT = RecipeAmendmentDetection(
    is_amendment=False,
    amended_ingredients=None,
    change_summary=None,
)


def _state(**kwargs):
    """Minimal WorkflowState for cooking_help tests with a pinned recipe."""
    base: dict = {
        "input_text": "I'm out of cream, can I use milk instead?",
        "user_id": "test-user-302",
        "errors": [],
        "warnings": [],
        "session_mode": None,
        "session": None,
        "conversation_history": [],
        "input_mode": "chat",
        "context": {"cooking_recipe": _PINNED_RECIPE},
    }
    base.update(kwargs)
    return base


def _make_manager(supports_tool_calling: bool = False):
    """Build a mock AIManager. Default: single-shot path (no tool calling)."""
    provider = MagicMock()
    provider.supports_tool_calling = supports_tool_calling
    provider.name = "mock/provider"

    manager = MagicMock()
    manager.providers = [provider]
    manager.current_provider = provider
    manager.complete = AsyncMock(return_value="Sure, milk works fine as a cream substitute.")
    manager.complete_with_tools = AsyncMock()
    return manager


# ---------------------------------------------------------------------------
# Unit tests for _detect_amendment directly
# ---------------------------------------------------------------------------


class TestDetectAmendmentUnit:
    @pytest.mark.asyncio
    async def test_returns_none_when_no_recipe_pinned(self):
        """When no cooking recipe is in state, detection is skipped (returns None)."""
        manager = _make_manager()
        state = _state(context=None)
        result = await _detect_amendment(state, manager, "some prose")
        assert result is None
        manager.complete.assert_not_called()

    @pytest.mark.asyncio
    async def test_returns_none_when_recipe_has_no_ingredients(self):
        """When the pinned recipe has an empty ingredient list, skip detection."""
        manager = _make_manager()
        state = _state(context={"cooking_recipe": {"title": "Mystery Dish", "ingredients": []}})
        result = await _detect_amendment(state, manager, "some prose")
        assert result is None
        manager.complete.assert_not_called()

    @pytest.mark.asyncio
    async def test_returns_detection_object_on_amendment(self):
        """complete() returning a RecipeAmendmentDetection passes it straight through."""
        manager = _make_manager()
        manager.complete = AsyncMock(return_value=_AMENDMENT_DETECTION_RESULT)
        state = _state()
        result = await _detect_amendment(state, manager, "Sure, milk works fine.")
        assert isinstance(result, RecipeAmendmentDetection)
        assert result.is_amendment is True
        assert result.amended_ingredients is not None
        assert len(result.amended_ingredients) == 3

    @pytest.mark.asyncio
    async def test_coerces_dict_result_to_model(self):
        """If the provider returns a dict (e.g. parsed JSON), it must be coerced."""
        manager = _make_manager()
        manager.complete = AsyncMock(
            return_value={
                "is_amendment": True,
                "amended_ingredients": [
                    {"name": "milk", "quantity": 200.0, "unit": "ml"}
                ],
                "change_summary": "Cream → milk",
            }
        )
        state = _state()
        result = await _detect_amendment(state, manager, "Sure, milk works fine.")
        assert isinstance(result, RecipeAmendmentDetection)
        assert result.is_amendment is True

    @pytest.mark.asyncio
    async def test_returns_none_on_exception(self):
        """Any exception inside complete() must be swallowed; result is None."""
        manager = _make_manager()
        manager.complete = AsyncMock(side_effect=RuntimeError("LLM error"))
        state = _state()
        result = await _detect_amendment(state, manager, "Some prose")
        assert result is None


# ---------------------------------------------------------------------------
# Integration tests through cooking_help_response (single-shot path)
# ---------------------------------------------------------------------------


class TestCookingHelpAmendmentSingleShot:
    @pytest.mark.asyncio
    async def test_amending_turn_returns_proposal_single_shot(self):
        """Single-shot path: amendment detected → requires_review=True, proposal non-null."""
        manager = _make_manager(supports_tool_calling=False)
        # First call: prose reply.  Second call: amendment detection.
        manager.complete = AsyncMock(
            side_effect=[
                "Sure, milk works fine as a substitute for heavy cream.",
                _AMENDMENT_DETECTION_RESULT,
            ]
        )

        with (
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager),
            patch(
                "bubbly_chef.workflows.chat.nodes.get_repository",
                new_callable=AsyncMock,
                return_value=MagicMock(get_all_pantry_items=AsyncMock(return_value=[])),
            ),
        ):
            result = await cooking_help_response(_state())

        assert result["intent"] == Intent.COOKING_HELP.value
        assert result["requires_review"] is True
        assert result["next_action"] == NextAction.REVIEW_PROPOSAL.value
        assert result["workflow_status"] == WorkflowStatus.AWAITING_REVIEW.value
        assert result["proposal"] is not None
        proposal = result["proposal"]
        assert proposal["is_amendment"] is True
        assert proposal["amended_ingredients"] is not None
        assert len(proposal["amended_ingredients"]) == 3
        # Prose reply is preserved in assistant_message
        assert "milk" in result["assistant_message"]

    @pytest.mark.asyncio
    async def test_non_amending_turn_returns_no_proposal_single_shot(self):
        """Single-shot path: technique question → requires_review=False, proposal=None."""
        manager = _make_manager(supports_tool_calling=False)
        manager.complete = AsyncMock(
            side_effect=[
                "Al dente means the pasta still has a slight bite to it.",
                _NO_AMENDMENT_RESULT,
            ]
        )
        state = _state(input_text="What does al dente mean?")

        with (
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager),
            patch(
                "bubbly_chef.workflows.chat.nodes.get_repository",
                new_callable=AsyncMock,
                return_value=MagicMock(get_all_pantry_items=AsyncMock(return_value=[])),
            ),
        ):
            result = await cooking_help_response(state)

        assert result["intent"] == Intent.COOKING_HELP.value
        assert result["requires_review"] is False
        assert result["next_action"] == NextAction.NONE.value
        assert result["workflow_status"] == WorkflowStatus.COMPLETED.value
        assert result["proposal"] is None

    @pytest.mark.asyncio
    async def test_amendment_detection_failure_degrades_gracefully_single_shot(self):
        """If _detect_amendment raises internally, the turn still succeeds with proposal=None."""
        manager = _make_manager(supports_tool_calling=False)
        # Prose call succeeds; detection call fails.
        manager.complete = AsyncMock(
            side_effect=[
                "Milk is a fine substitute for cream here.",
                RuntimeError("structured output failed"),
            ]
        )

        with (
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager),
            patch(
                "bubbly_chef.workflows.chat.nodes.get_repository",
                new_callable=AsyncMock,
                return_value=MagicMock(get_all_pantry_items=AsyncMock(return_value=[])),
            ),
        ):
            result = await cooking_help_response(_state())

        assert result["intent"] == Intent.COOKING_HELP.value
        # Must not fail the turn
        assert result["workflow_status"] == WorkflowStatus.COMPLETED.value
        assert result["proposal"] is None
        assert result["requires_review"] is False
        assert "Milk" in result["assistant_message"]

    @pytest.mark.asyncio
    async def test_amending_turn_with_is_amendment_false_no_proposal(self):
        """is_amendment=True but empty amended_ingredients → treat as non-amendment."""
        manager = _make_manager(supports_tool_calling=False)
        detection = RecipeAmendmentDetection(
            is_amendment=True,
            amended_ingredients=[],  # Empty list — not a real amendment
            change_summary=None,
        )
        manager.complete = AsyncMock(
            side_effect=[
                "Try adding some basil for extra flavour.",
                detection,
            ]
        )

        with (
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager),
            patch(
                "bubbly_chef.workflows.chat.nodes.get_repository",
                new_callable=AsyncMock,
                return_value=MagicMock(get_all_pantry_items=AsyncMock(return_value=[])),
            ),
        ):
            result = await cooking_help_response(_state(input_text="Add some herbs?"))

        assert result["proposal"] is None
        assert result["requires_review"] is False


# ---------------------------------------------------------------------------
# Integration tests through cooking_help_response (ReAct loop path)
# ---------------------------------------------------------------------------


class TestCookingHelpAmendmentReact:
    @pytest.mark.asyncio
    async def test_amending_turn_returns_proposal_react(self):
        """ReAct path: amendment detected after loop → requires_review=True."""
        manager = _make_manager(supports_tool_calling=True)
        manager.complete_with_tools = AsyncMock(
            return_value=ToolCallResponse(
                text="Sure, milk works fine as a substitute for heavy cream."
            )
        )
        # Amendment detection goes through complete()
        manager.complete = AsyncMock(return_value=_AMENDMENT_DETECTION_RESULT)

        with patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager):
            result = await cooking_help_response(_state())

        assert result["intent"] == Intent.COOKING_HELP.value
        assert result["requires_review"] is True
        assert result["next_action"] == NextAction.REVIEW_PROPOSAL.value
        assert result["workflow_status"] == WorkflowStatus.AWAITING_REVIEW.value
        assert result["proposal"] is not None
        assert result["proposal"]["is_amendment"] is True

    @pytest.mark.asyncio
    async def test_non_amending_turn_returns_no_proposal_react(self):
        """ReAct path: technique question → requires_review=False, proposal=None."""
        manager = _make_manager(supports_tool_calling=True)
        manager.complete_with_tools = AsyncMock(
            return_value=ToolCallResponse(
                text="Al dente means the pasta still has a slight bite."
            )
        )
        manager.complete = AsyncMock(return_value=_NO_AMENDMENT_RESULT)
        state = _state(input_text="What does al dente mean?")

        with patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager):
            result = await cooking_help_response(state)

        assert result["requires_review"] is False
        assert result["proposal"] is None

    @pytest.mark.asyncio
    async def test_amendment_detection_failure_degrades_gracefully_react(self):
        """ReAct path: _detect_amendment failure → turn still succeeds, proposal=None."""
        manager = _make_manager(supports_tool_calling=True)
        manager.complete_with_tools = AsyncMock(
            return_value=ToolCallResponse(text="Milk is fine here.")
        )
        manager.complete = AsyncMock(side_effect=RuntimeError("boom"))

        with patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager):
            result = await cooking_help_response(_state())

        assert result["intent"] == Intent.COOKING_HELP.value
        assert result["workflow_status"] == WorkflowStatus.COMPLETED.value
        assert result["proposal"] is None
        assert result["requires_review"] is False
