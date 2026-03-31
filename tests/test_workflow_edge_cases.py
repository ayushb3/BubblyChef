"""
Comprehensive edge-case tests for chat router workflows.

Covers:
- Intent classification boundary cases (brainstorm vs cooking_help vs general)
- Session mode overrides and transitions
- Staleness detection and reset
- Exit phrase handling
- Brainstorm followup detection
- Recipe selection extraction
- Streaming path routing
- Score-and-rank edge cases (excluded items, empty pantry)
- Keyword overlap and priority
"""

import re
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from bubbly_chef.models.base import Intent, NextAction, WorkflowStatus
from bubbly_chef.models.session import ConversationSession, SessionMode
from bubbly_chef.workflows.recipe.nodes import (
    detect_brainstorm_followup,
    extract_selected_recipe,
    is_recipe_generation_request,
    score_and_rank,
)
from bubbly_chef.workflows.router import (
    EXIT_PHRASES,
    SESSION_STALE_MINUTES,
    classify_intent,
    load_session,
    route_by_intent,
    update_session_node,
)
from bubbly_chef.workflows.state import WorkflowState


@pytest.fixture(autouse=True)
def mock_repository():
    """Prevent workflow nodes from hitting the real DB."""
    repo_mock = AsyncMock()
    repo_mock.get_all_pantry_items.return_value = []
    # Default session: new, default mode
    default_session = ConversationSession(conversation_id="test-conv")
    repo_mock.get_or_create_session.return_value = default_session
    repo_mock.update_session.return_value = None
    with patch(
        "bubbly_chef.workflows.router.get_repository", return_value=repo_mock
    ), patch(
        "bubbly_chef.workflows.chat.nodes.get_repository", return_value=repo_mock
    ), patch(
        "bubbly_chef.workflows.recipe.nodes.get_repository", return_value=repo_mock
    ):
        yield repo_mock


@pytest.fixture
def base_state() -> WorkflowState:
    return {
        "request_id": str(uuid4()),
        "workflow_id": str(uuid4()),
        "conversation_id": None,
        "input_text": "",
        "input_type": "chat",
        "input_mode": "text",
        "warnings": [],
        "errors": [],
        "conversation_history": [],
    }


# =============================================================================
# Intent Classification: Brainstorm vs Cooking Help
# =============================================================================


class TestBrainstormVsCookingHelp:
    """Ensure brainstorm keywords route to RECIPE_BRAINSTORM, not COOKING_HELP."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "text",
        [
            "What can I make with what I have?",
            "what can i cook tonight",
            "What should I make for dinner?",
            "what should i cook with these ingredients",
            "what to cook today",
            "what to make for lunch",
            "suggest a recipe",
            "recipe ideas please",
            "recipe suggestions for tonight",
            "What can I make with what I have in my pantry?",
        ],
    )
    async def test_brainstorm_keywords_route_correctly(self, base_state, text):
        state = {**base_state, "input_text": text}
        result = await classify_intent(state)
        assert result["intent"] == Intent.RECIPE_BRAINSTORM.value, (
            f"'{text}' classified as {result['intent']} instead of recipe_brainstorm"
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "text",
        [
            "how to cook chicken",
            "how long does cheese last",
            "substitute for butter",
        ],
    )
    async def test_cooking_help_keywords_still_work(self, base_state, text):
        state = {**base_state, "input_text": text}
        result = await classify_intent(state)
        assert result["intent"] == Intent.COOKING_HELP.value, (
            f"'{text}' classified as {result['intent']} instead of cooking_help"
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "text",
        [
            "dinner idea",
            "lunch idea",
            "suggest a meal",
            "recipe for chicken curry",
            "give me a recipe",
            "make me a recipe",
            "i want a recipe for pasta",
            "make me something with chicken",
        ],
    )
    async def test_recipe_generation_keywords(self, base_state, text):
        """Recipe generation phrases route to RECIPE_GENERATION."""
        state = {**base_state, "input_text": text}
        result = await classify_intent(state)
        assert result["intent"] == Intent.RECIPE_GENERATION.value, (
            f"'{text}' classified as {result['intent']} instead of recipe_generation"
        )

    @pytest.mark.asyncio
    async def test_generic_recipe_is_generation(self, base_state):
        """Bare 'recipe' keyword routes to RECIPE_GENERATION, not COOKING_HELP."""
        state = {**base_state, "input_text": "I need a recipe"}
        result = await classify_intent(state)
        assert result["intent"] == Intent.RECIPE_GENERATION.value


class TestBrainstormRouting:
    """Verify route_by_intent sends brainstorm/generation to the right pipeline."""

    def test_recipe_brainstorm_routes_to_constraints(self):
        state = {"intent": Intent.RECIPE_BRAINSTORM.value}
        assert route_by_intent(state) == "extract_recipe_constraints"

    def test_recipe_generation_routes_to_constraints(self):
        """RECIPE_GENERATION always routes to extract_recipe_constraints."""
        state = {"intent": Intent.RECIPE_GENERATION.value}
        assert route_by_intent(state) == "extract_recipe_constraints"

    def test_cooking_help_routes_to_help(self):
        """COOKING_HELP always routes to cooking_help_response."""
        state = {
            "intent": Intent.COOKING_HELP.value,
            "input_text": "how long does milk last in the fridge",
            "input_mode": "text",
        }
        assert route_by_intent(state) == "cooking_help_response"


# =============================================================================
# Session Mode Overrides
# =============================================================================


class TestSessionModeOverrides:
    """Test that active session modes force intent correctly."""

    @pytest.mark.asyncio
    async def test_cooking_mode_forces_cooking_help(self, base_state):
        state = {
            **base_state,
            "input_text": "hello there",
            "session_mode": SessionMode.COOKING.value,
        }
        result = await classify_intent(state)
        assert result["intent"] == Intent.COOKING_HELP.value

    @pytest.mark.asyncio
    async def test_recipe_exploring_treats_input_as_selection(self, base_state):
        """In RECIPE_EXPLORING, any input is treated as a recipe selection attempt."""
        state = {
            **base_state,
            "input_text": "something quick and easy",
            "session_mode": SessionMode.RECIPE_EXPLORING.value,
        }
        result = await classify_intent(state)
        # extract_selected_recipe falls back to raw text → treated as recipe_card
        assert result["intent"] == Intent.RECIPE_CARD.value
        assert result["selected_recipe_name"] == "something quick and easy"

    @pytest.mark.asyncio
    async def test_recipe_exploring_with_selection_returns_recipe_card(
        self, base_state
    ):
        """When in RECIPE_EXPLORING and user picks a recipe, route to RECIPE_CARD."""
        state = {
            **base_state,
            "input_text": "the second one",
            "session_mode": SessionMode.RECIPE_EXPLORING.value,
            "conversation_history": [
                {
                    "role": "assistant",
                    "intent": Intent.RECIPE_BRAINSTORM.value,
                    "content": "Here are some ideas:\n1. **Chicken Stir Fry**\n2. **Pasta Primavera**\n3. **Veggie Soup**",
                }
            ],
        }
        result = await classify_intent(state)
        assert result["intent"] == Intent.RECIPE_CARD.value
        assert result["selected_recipe_name"] == "Pasta Primavera"

    @pytest.mark.asyncio
    async def test_ingesting_mode_forces_pantry_update(self, base_state):
        state = {
            **base_state,
            "input_text": "yes add those",
            "session_mode": SessionMode.INGESTING.value,
        }
        result = await classify_intent(state)
        assert result["intent"] == Intent.PANTRY_UPDATE.value


# =============================================================================
# Exit Phrases
# =============================================================================


class TestExitPhrases:

    @pytest.mark.asyncio
    @pytest.mark.parametrize("phrase", list(EXIT_PHRASES))
    async def test_exit_phrase_resets_to_general_chat(self, base_state, phrase):
        """Every exit phrase should return general_chat + _exit_mode flag."""
        state = {
            **base_state,
            "input_text": phrase,
            "session_mode": SessionMode.COOKING.value,
        }
        result = await classify_intent(state)
        assert result["intent"] == Intent.GENERAL_CHAT.value
        assert result.get("_exit_mode") is True

    @pytest.mark.asyncio
    async def test_exit_phrase_ignored_in_default_mode(self, base_state):
        """Exit phrases don't trigger special handling in default mode."""
        state = {
            **base_state,
            "input_text": "done",
            "session_mode": SessionMode.DEFAULT.value,
        }
        # In default mode, "done" falls through to keyword/LLM classification
        # It shouldn't match any food keywords, so it goes to LLM
        with patch(
            "bubbly_chef.workflows.router.get_ai_manager"
        ) as mock_get_ai:
            mock_mgr = AsyncMock()
            from bubbly_chef.workflows.state import LLMIntentResult

            mock_mgr.complete.return_value = LLMIntentResult(
                intent="general_chat", confidence=0.9
            )
            mock_get_ai.return_value = mock_mgr
            result = await classify_intent(state)
        assert result["intent"] == Intent.GENERAL_CHAT.value
        assert result.get("_exit_mode") is not True

    @pytest.mark.asyncio
    async def test_exit_phrase_case_insensitive(self, base_state):
        state = {
            **base_state,
            "input_text": "  GO BACK  ",
            "session_mode": SessionMode.RECIPE_EXPLORING.value,
        }
        result = await classify_intent(state)
        assert result["intent"] == Intent.GENERAL_CHAT.value
        assert result.get("_exit_mode") is True


# =============================================================================
# Session Staleness
# =============================================================================


class TestSessionStaleness:

    @pytest.mark.asyncio
    async def test_stale_session_resets_to_default(self, base_state, mock_repository):
        stale_session = ConversationSession(
            conversation_id="stale-conv",
            active_mode=SessionMode.RECIPE_EXPLORING,
            updated_at=datetime.now(UTC) - timedelta(minutes=SESSION_STALE_MINUTES + 5),
        )
        mock_repository.get_or_create_session.return_value = stale_session

        state = {**base_state, "conversation_id": "stale-conv"}
        result = await load_session(state)

        assert result["session_mode"] == SessionMode.DEFAULT.value
        mock_repository.update_session.assert_called_once()

    @pytest.mark.asyncio
    async def test_fresh_session_not_reset(self, base_state, mock_repository):
        fresh_session = ConversationSession(
            conversation_id="fresh-conv",
            active_mode=SessionMode.COOKING,
            updated_at=datetime.now(UTC) - timedelta(minutes=5),
        )
        mock_repository.get_or_create_session.return_value = fresh_session

        state = {**base_state, "conversation_id": "fresh-conv"}
        result = await load_session(state)

        assert result["session_mode"] == SessionMode.COOKING.value
        mock_repository.update_session.assert_not_called()

    @pytest.mark.asyncio
    async def test_default_mode_never_triggers_staleness(self, base_state, mock_repository):
        """Default mode sessions are never reset for staleness."""
        old_session = ConversationSession(
            conversation_id="old-default",
            active_mode=SessionMode.DEFAULT,
            updated_at=datetime.now(UTC) - timedelta(hours=24),
        )
        mock_repository.get_or_create_session.return_value = old_session

        state = {**base_state, "conversation_id": "old-default"}
        result = await load_session(state)

        assert result["session_mode"] == SessionMode.DEFAULT.value
        mock_repository.update_session.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_conversation_id_skips_session(self, base_state, mock_repository):
        state = {**base_state, "conversation_id": None}
        result = await load_session(state)
        assert result["session"] is None
        assert result["session_mode"] is None
        mock_repository.get_or_create_session.assert_not_called()


# =============================================================================
# Session Transitions (update_session_node)
# =============================================================================


class TestSessionTransitions:

    @pytest.mark.asyncio
    async def test_brainstorm_transitions_to_recipe_exploring(self, mock_repository):
        default_session = ConversationSession(conversation_id="conv-transition")
        mock_repository.get_or_create_session.return_value = default_session

        state = WorkflowState(
            conversation_id="conv-transition",
            intent=Intent.RECIPE_BRAINSTORM.value,
            brainstorm_ideas=["Pasta", "Stir Fry", "Soup"],
        )
        await update_session_node(state)

        saved = mock_repository.update_session.call_args[0][0]
        assert saved.active_mode == SessionMode.RECIPE_EXPLORING
        assert saved.metadata["brainstorm_ideas"] == ["Pasta", "Stir Fry", "Soup"]

    @pytest.mark.asyncio
    async def test_recipe_card_with_proposal_stays_in_exploring(self, mock_repository):
        """RECIPE_CARD with proposal stays in RECIPE_EXPLORING for follow-up refinements."""
        exploring_session = ConversationSession(
            conversation_id="conv-recipe",
            active_mode=SessionMode.RECIPE_EXPLORING,
        )
        mock_repository.get_or_create_session.return_value = exploring_session

        state = WorkflowState(
            conversation_id="conv-recipe",
            intent=Intent.RECIPE_CARD.value,
            proposal=MagicMock(),  # non-None proposal
        )
        await update_session_node(state)

        saved = mock_repository.update_session.call_args[0][0]
        assert saved.active_mode == SessionMode.RECIPE_EXPLORING

    @pytest.mark.asyncio
    async def test_recipe_card_without_proposal_stays_in_mode(self, mock_repository):
        exploring_session = ConversationSession(
            conversation_id="conv-no-proposal",
            active_mode=SessionMode.RECIPE_EXPLORING,
        )
        mock_repository.get_or_create_session.return_value = exploring_session

        state = WorkflowState(
            conversation_id="conv-no-proposal",
            intent=Intent.RECIPE_CARD.value,
            proposal=None,
        )
        await update_session_node(state)

        saved = mock_repository.update_session.call_args[0][0]
        assert saved.active_mode == SessionMode.RECIPE_EXPLORING

    @pytest.mark.asyncio
    async def test_exit_mode_resets_session(self, mock_repository):
        cooking_session = ConversationSession(
            conversation_id="conv-exit",
            active_mode=SessionMode.COOKING,
        )
        mock_repository.get_or_create_session.return_value = cooking_session

        state = WorkflowState(
            conversation_id="conv-exit",
            intent=Intent.GENERAL_CHAT.value,
            _exit_mode=True,
        )
        await update_session_node(state)

        saved = mock_repository.update_session.call_args[0][0]
        assert saved.active_mode == SessionMode.DEFAULT

    @pytest.mark.asyncio
    async def test_pantry_update_with_review_transitions_to_ingesting(
        self, mock_repository
    ):
        default_session = ConversationSession(conversation_id="conv-ingest")
        mock_repository.get_or_create_session.return_value = default_session

        state = WorkflowState(
            conversation_id="conv-ingest",
            intent=Intent.PANTRY_UPDATE.value,
            requires_review=True,
        )
        await update_session_node(state)

        saved = mock_repository.update_session.call_args[0][0]
        assert saved.active_mode == SessionMode.INGESTING

    @pytest.mark.asyncio
    async def test_cooking_help_with_brainstorm_ideas_transitions(self, mock_repository):
        """Belt-and-suspenders: COOKING_HELP with brainstorm_ideas → RECIPE_EXPLORING."""
        default_session = ConversationSession(conversation_id="conv-belt")
        mock_repository.get_or_create_session.return_value = default_session

        state = WorkflowState(
            conversation_id="conv-belt",
            intent=Intent.COOKING_HELP.value,
            brainstorm_ideas=["Soup", "Stew"],
        )
        await update_session_node(state)

        saved = mock_repository.update_session.call_args[0][0]
        assert saved.active_mode == SessionMode.RECIPE_EXPLORING

    @pytest.mark.asyncio
    async def test_no_conversation_id_is_noop(self, mock_repository):
        state = WorkflowState(
            conversation_id=None,
            intent=Intent.RECIPE_BRAINSTORM.value,
        )
        result = await update_session_node(state)
        mock_repository.get_or_create_session.assert_not_called()
        assert result == state


# =============================================================================
# Brainstorm Followup Detection
# =============================================================================


class TestBrainstormFollowup:

    def test_followup_detected_when_last_assistant_is_brainstorm(self):
        state = {
            "conversation_history": [
                {"role": "user", "content": "what can i make"},
                {
                    "role": "assistant",
                    "intent": Intent.RECIPE_BRAINSTORM.value,
                    "content": "Here are ideas...",
                },
            ]
        }
        assert detect_brainstorm_followup(state) is True

    def test_followup_not_detected_when_last_is_general(self):
        state = {
            "conversation_history": [
                {
                    "role": "assistant",
                    "intent": Intent.GENERAL_CHAT.value,
                    "content": "Hello!",
                },
            ]
        }
        assert detect_brainstorm_followup(state) is False

    def test_followup_not_detected_with_empty_history(self):
        state = {"conversation_history": []}
        assert detect_brainstorm_followup(state) is False

    def test_followup_not_detected_with_no_history(self):
        state = {}
        assert detect_brainstorm_followup(state) is False

    def test_followup_skips_user_turns_to_find_last_assistant(self):
        state = {
            "conversation_history": [
                {
                    "role": "assistant",
                    "intent": Intent.RECIPE_BRAINSTORM.value,
                    "content": "Ideas...",
                },
                {"role": "user", "content": "hmm let me think"},
            ]
        }
        # Last assistant is recipe_brainstorm (reversed search)
        assert detect_brainstorm_followup(state) is True


# =============================================================================
# Recipe Selection Extraction
# =============================================================================


class TestRecipeSelection:

    BRAINSTORM_HISTORY = [
        {
            "role": "assistant",
            "intent": Intent.RECIPE_BRAINSTORM.value,
            "content": (
                "Here are some ideas:\n"
                "1. **Chicken Stir Fry** - quick and easy\n"
                "2. **Pasta Primavera** - veggie loaded\n"
                "3. **Thai Green Curry** - aromatic and spicy"
            ),
        }
    ]

    def test_ordinal_selection_first(self):
        result = extract_selected_recipe("the first one", self.BRAINSTORM_HISTORY)
        assert result == "Chicken Stir Fry"

    def test_ordinal_selection_second(self):
        result = extract_selected_recipe("second please", self.BRAINSTORM_HISTORY)
        assert result == "Pasta Primavera"

    def test_ordinal_selection_third(self):
        result = extract_selected_recipe("I'll take the third", self.BRAINSTORM_HISTORY)
        assert result == "Thai Green Curry"

    def test_numeric_ordinal_1st(self):
        result = extract_selected_recipe("1st one", self.BRAINSTORM_HISTORY)
        assert result == "Chicken Stir Fry"

    def test_surprise_pick_returns_first(self):
        result = extract_selected_recipe("surprise me!", self.BRAINSTORM_HISTORY)
        assert result == "Chicken Stir Fry"

    def test_fuzzy_match_by_name(self):
        result = extract_selected_recipe("pasta sounds good", self.BRAINSTORM_HISTORY)
        assert result == "Pasta Primavera"

    def test_fuzzy_match_curry(self):
        result = extract_selected_recipe("the curry", self.BRAINSTORM_HISTORY)
        assert result == "Thai Green Curry"

    def test_fallback_to_raw_text_with_no_history(self):
        result = extract_selected_recipe("chicken soup", [])
        assert result == "chicken soup"

    def test_fallback_to_raw_text_with_no_brainstorm(self):
        history = [
            {
                "role": "assistant",
                "intent": Intent.COOKING_HELP.value,
                "content": "Here's how to make soup...",
            }
        ]
        result = extract_selected_recipe("the first one", history)
        assert result == "the first one"


# =============================================================================
# Score and Rank
# =============================================================================


class TestScoreAndRank:

    def test_expiring_items_score_highest(self):
        today = date.today()
        items = [
            {"name": "chicken", "expiry_date": (today + timedelta(days=1)).isoformat()},
            {"name": "rice", "expiry_date": (today + timedelta(days=30)).isoformat()},
            {"name": "milk", "expiry_date": (today + timedelta(days=2)).isoformat()},
        ]
        scored = score_and_rank(items, {})
        # chicken and milk both expire within 3 days, should be top
        names = [s["name"] for s in scored]
        assert names[0] in ("chicken", "milk")
        assert names[1] in ("chicken", "milk")

    def test_excluded_items_filtered_out(self):
        items = [
            {"name": "peanut butter"},
            {"name": "milk"},
            {"name": "bread"},
        ]
        scored = score_and_rank(items, {"excluded_ingredients": ["peanut"]})
        names = [s["name"] for s in scored]
        assert "peanut butter" not in names

    def test_cuisine_match_boosts_score(self):
        items = [
            {"name": "soy sauce"},
            {"name": "bread"},
        ]
        scored = score_and_rank(items, {"cuisine": "chinese"})
        assert scored[0]["name"] == "soy sauce"

    def test_preferred_ingredients_boosted(self):
        items = [
            {"name": "chicken"},
            {"name": "tofu"},
        ]
        scored = score_and_rank(items, {"preferred_ingredients": ["tofu"]})
        assert scored[0]["name"] == "tofu"

    def test_empty_pantry_returns_empty(self):
        assert score_and_rank([], {}) == []

    def test_max_15_items_returned(self):
        items = [{"name": f"item-{i}"} for i in range(30)]
        scored = score_and_rank(items, {})
        assert len(scored) <= 15

    def test_invalid_expiry_date_handled(self):
        items = [
            {"name": "milk", "expiry_date": "not-a-date"},
            {"name": "eggs", "expiry_date": None},
        ]
        scored = score_and_rank(items, {})
        assert len(scored) == 2  # No crash


# =============================================================================
# is_recipe_generation_request
# =============================================================================


class TestIsRecipeGeneration:

    def test_recipe_mode_always_true(self):
        state = {"input_mode": "recipe", "input_text": "hello"}
        assert is_recipe_generation_request(state) is True

    def test_generation_keywords_detected(self):
        keywords = [
            "what can i make",
            "dinner idea",
            "surprise me",
            "quick dinner",
            "easy meal",
            "make me something",
            "something to eat",
        ]
        for kw in keywords:
            state = {"input_text": kw, "input_mode": "text"}
            assert is_recipe_generation_request(state) is True, f"Failed: {kw}"

    def test_non_generation_returns_false(self):
        state = {"input_text": "how long does chicken last", "input_mode": "text"}
        assert is_recipe_generation_request(state) is False


# =============================================================================
# Keyword Priority / Overlap
# =============================================================================


class TestKeywordPriority:
    """Test that keyword lists don't have conflicting overlaps."""

    @pytest.mark.asyncio
    async def test_url_with_recipe_routes_to_ingest(self, base_state):
        """URL presence should force recipe_ingest, even with cooking keywords."""
        state = {
            **base_state,
            "input_text": "save this recipe https://example.com/recipe",
        }
        result = await classify_intent(state)
        assert result["intent"] == Intent.RECIPE_INGEST.value

    @pytest.mark.asyncio
    async def test_receipt_keyword_beats_pantry_keyword(self, base_state):
        """Receipt keywords checked before pantry keywords."""
        state = {
            **base_state,
            "input_text": "I bought stuff, here's my receipt",
        }
        result = await classify_intent(state)
        assert result["intent"] == Intent.RECEIPT_INGEST.value

    @pytest.mark.asyncio
    async def test_brainstorm_keyword_beats_generic_recipe(self, base_state):
        """'recipe ideas' should be brainstorm, not generic recipe_generation."""
        state = {**base_state, "input_text": "give me some recipe ideas"}
        result = await classify_intent(state)
        assert result["intent"] == Intent.RECIPE_BRAINSTORM.value

    @pytest.mark.asyncio
    async def test_with_what_i_have_is_brainstorm(self, base_state):
        """'with what i have' is a brainstorm signal."""
        state = {
            **base_state,
            "input_text": "Can I cook something with what i have?",
        }
        result = await classify_intent(state)
        assert result["intent"] == Intent.RECIPE_BRAINSTORM.value


# =============================================================================
# Streaming Path Routing
# =============================================================================


class TestStreamingPathRouting:
    """Verify the streaming path sends the right intents through the graph."""

    def test_brainstorm_not_in_streamable(self):
        """RECIPE_BRAINSTORM should NOT be streamed — needs full pipeline."""
        from bubbly_chef.workflows.router import run_chat_workflow_streaming
        import inspect

        source = inspect.getsource(run_chat_workflow_streaming)
        # Verify RECIPE_BRAINSTORM is not in the streamable_intents set
        assert "RECIPE_BRAINSTORM" not in source.split("streamable_intents")[1].split("}")[0]


# =============================================================================
# ConversationSession Model
# =============================================================================


class TestConversationSessionModel:

    def test_reset_preserves_conversation_id(self):
        session = ConversationSession(
            conversation_id="abc",
            active_mode=SessionMode.RECIPE_EXPLORING,
            metadata={"brainstorm_ideas": ["Soup"]},
        )
        reset = session.reset()
        assert reset.conversation_id == "abc"
        assert reset.active_mode == SessionMode.DEFAULT
        assert reset.metadata == {}

    def test_reset_updates_timestamp(self):
        old_time = datetime.now(UTC) - timedelta(hours=1)
        session = ConversationSession(
            conversation_id="xyz",
            updated_at=old_time,
        )
        reset = session.reset()
        assert reset.updated_at > old_time

    def test_is_default_only_for_default_mode(self):
        for mode in SessionMode:
            session = ConversationSession(
                conversation_id="test", active_mode=mode
            )
            if mode == SessionMode.DEFAULT:
                assert session.is_default() is True
            else:
                assert session.is_default() is False

    def test_metadata_is_mutable_dict(self):
        session = ConversationSession(conversation_id="m")
        session.metadata["key"] = "value"
        assert session.metadata["key"] == "value"
