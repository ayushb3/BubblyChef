"""
E2E tests for the full recipe generation flow (brainstorm -> select -> grounded card).

Covers:
1. Multi-turn brainstorm -> recipe card (grounded) flow
2. Brainstorm with pantry context
3. LLM failure during grounded generation
4. History without recipe_brainstorm intent -- does NOT route to RECIPE_CARD

Uses run_chat_workflow() (not legacy run_chat_ingest) because the recipe flow
is multi-turn and requires conversation_history support.
"""

from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest

from bubbly_chef.models.base import Intent, NextAction, WorkflowStatus
from bubbly_chef.models.recipe import RecipeCard, RecipeCardProposal, RecipeConstraints
from bubbly_chef.workflows.shared_state import LLMRecipeResult

# =============================================================================
# Shared helpers
# =============================================================================


def assert_envelope_structure(envelope: object) -> None:
    """Assert the envelope has all required top-level fields."""
    assert isinstance(envelope.request_id, UUID)
    assert isinstance(envelope.workflow_id, UUID)
    assert envelope.schema_version == "1.0.0"
    assert isinstance(envelope.intent, Intent)
    assert 0.0 <= envelope.confidence.overall <= 1.0
    assert isinstance(envelope.requires_review, bool)
    assert isinstance(envelope.next_action, NextAction)
    assert isinstance(envelope.assistant_message, str)
    assert isinstance(envelope.workflow_status, WorkflowStatus)
    assert isinstance(envelope.warnings, list)
    assert isinstance(envelope.errors, list)


def _make_brainstorm_history(user_message: str, assistant_message: str) -> list[dict]:
    """Build conversation history with a recipe_brainstorm assistant turn."""
    return [
        {"role": "user", "content": user_message},
        {
            "role": "assistant",
            "content": assistant_message,
            "intent": "recipe_brainstorm",
        },
    ]


def _ai_patches(mock_mgr: AsyncMock):
    """Context manager that patches get_ai_manager in all workflow modules."""
    from contextlib import contextmanager

    @contextmanager
    def _ctx():
        with (
            patch("bubbly_chef.workflows.router.get_ai_manager", return_value=mock_mgr),
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=mock_mgr),
            patch("bubbly_chef.workflows.pantry.nodes.get_ai_manager", return_value=mock_mgr),
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", return_value=mock_mgr),
        ):
            yield

    return _ctx()


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture(autouse=True)
def mock_repository():
    """Prevent workflow nodes from hitting the real DB."""
    repo_mock = AsyncMock()
    repo_mock.get_all_pantry_items.return_value = []
    repo_mock.get_conversation_history.return_value = []
    with (
        patch("bubbly_chef.workflows.router.get_repository", return_value=repo_mock),
        patch("bubbly_chef.workflows.chat.nodes.get_repository", return_value=repo_mock),
        patch("bubbly_chef.workflows.recipe.nodes.get_repository", return_value=repo_mock),
    ):
        yield repo_mock


BRAINSTORM_TEXT = (
    "Here are some ideas:\n\n"
    "1. **Chicken Stir Fry** — A quick weeknight meal\n"
    "2. **Chicken Curry** — Rich and aromatic\n"
    "3. **Lemon Chicken** — Light and zesty"
)

RECIPE_RESULT = LLMRecipeResult(
    title="Chicken Stir Fry",
    description="A quick, flavourful weeknight stir fry.",
    prep_time_minutes=10,
    cook_time_minutes=15,
    total_time_minutes=25,
    servings=2,
    ingredients=[
        {"name": "chicken breast", "quantity": 300, "unit": "g"},
        {"name": "soy sauce", "quantity": 2, "unit": "tbsp"},
    ],
    instructions=[
        "Slice chicken into strips.",
        "Heat oil in a wok over high heat.",
        "Stir fry chicken until cooked through.",
        "Add soy sauce and toss to coat.",
    ],
    cuisine="asian",
    confidence=0.9,
)


# =============================================================================
# Test 1: Multi-turn brainstorm -> grounded recipe card
# =============================================================================


class TestChatToRecipeBrainstormToGrounded:
    """Full 2-turn flow: brainstorm ideas then select one for grounded generation."""

    @pytest.mark.asyncio
    async def test_turn1_brainstorm(self):
        """Turn 1: 'What can I make with chicken?' -> RECIPE_BRAINSTORM."""
        from bubbly_chef.workflows.router import run_chat_workflow

        constraints = RecipeConstraints(
            cuisine="asian",
            preferred_ingredients=["chicken"],
        )

        mock_mgr = AsyncMock()
        mock_mgr.complete.side_effect = [constraints, BRAINSTORM_TEXT]

        with _ai_patches(mock_mgr):
            envelope = await run_chat_workflow("What can I make with chicken?")

        assert_envelope_structure(envelope)
        assert envelope.intent == Intent.RECIPE_BRAINSTORM
        assert "Chicken Stir Fry" in envelope.assistant_message

    @pytest.mark.asyncio
    async def test_turn2_select_and_generate(self):
        """Turn 2: user picks recipe from brainstorm -> RECIPE_CARD with proposal."""
        from bubbly_chef.workflows.router import run_chat_workflow

        history = _make_brainstorm_history(
            "What can I make with chicken?",
            BRAINSTORM_TEXT,
        )

        mock_mgr = AsyncMock()
        mock_mgr.complete.side_effect = [RECIPE_RESULT]

        with _ai_patches(mock_mgr), patch(
            "bubbly_chef.workflows.recipe.nodes.search_recipe",
            new=AsyncMock(return_value=None),
        ):
            envelope = await run_chat_workflow(
                "I'll go with Chicken Stir Fry",
                history=history,
            )

        assert_envelope_structure(envelope)
        assert envelope.intent == Intent.RECIPE_CARD
        assert isinstance(envelope.proposal, RecipeCardProposal)

        recipe = envelope.proposal.recipe
        assert isinstance(recipe, RecipeCard)
        assert recipe.title == "Chicken Stir Fry"
        assert recipe.cook_time_minutes == 15
        assert len(recipe.ingredients) == 2
        assert len(recipe.instructions) == 4

    @pytest.mark.asyncio
    async def test_full_two_turn_flow(self):
        """Combined: Turn 1 brainstorm then Turn 2 grounded generation."""
        from bubbly_chef.workflows.router import run_chat_workflow

        constraints = RecipeConstraints(
            cuisine="asian",
            preferred_ingredients=["chicken"],
        )

        # --- Turn 1: brainstorm ---
        mock_mgr = AsyncMock()
        mock_mgr.complete.side_effect = [constraints, BRAINSTORM_TEXT]

        with _ai_patches(mock_mgr):
            env1 = await run_chat_workflow("What can I make with chicken?")

        assert env1.intent == Intent.RECIPE_BRAINSTORM

        # Build history from turn 1
        history = _make_brainstorm_history(
            "What can I make with chicken?",
            env1.assistant_message,
        )

        # --- Turn 2: select + generate ---
        mock_mgr2 = AsyncMock()
        mock_mgr2.complete.side_effect = [RECIPE_RESULT]

        with _ai_patches(mock_mgr2), patch(
            "bubbly_chef.workflows.recipe.nodes.search_recipe",
            new=AsyncMock(return_value=None),
        ):
            env2 = await run_chat_workflow(
                "The first one",
                history=history,
            )

        assert env2.intent == Intent.RECIPE_CARD
        assert isinstance(env2.proposal, RecipeCardProposal)
        assert env2.proposal.recipe.title == "Chicken Stir Fry"


# =============================================================================
# Test 2: Brainstorm with pantry context
# =============================================================================


class TestBrainstormWithPantryContext:
    """Brainstorm flow incorporates pantry items when available."""

    @pytest.mark.asyncio
    async def test_brainstorm_includes_pantry_items(self, mock_repository):
        from bubbly_chef.models.pantry import PantryItem
        from bubbly_chef.workflows.router import run_chat_workflow

        pantry_items = [
            PantryItem(name="chicken breast", quantity=2, unit="lb", category="meat"),
            PantryItem(name="garlic", quantity=3, unit="clove", category="produce"),
            PantryItem(name="olive oil", quantity=1, unit="bottle", category="condiments"),
        ]
        mock_repository.get_all_pantry_items.return_value = pantry_items

        constraints = RecipeConstraints(preferred_ingredients=["chicken breast", "garlic"])
        brainstorm = (
            "With your pantry, you could make:\n\n"
            "1. **Garlic Chicken** — Uses your chicken and garlic\n"
            "2. **Chicken Piccata** — Light and lemony"
        )

        mock_mgr = AsyncMock()
        mock_mgr.complete.side_effect = [constraints, brainstorm]

        with _ai_patches(mock_mgr):
            envelope = await run_chat_workflow("What can I make with what I have?")

        assert_envelope_structure(envelope)
        assert envelope.intent == Intent.RECIPE_BRAINSTORM
        assert len(envelope.assistant_message) > 0


# =============================================================================
# Test 3: LLM failure during grounded generation
# =============================================================================


class TestRecipeGenerationLLMError:
    """Grounded generation fails gracefully when LLM raises."""

    @pytest.mark.asyncio
    async def test_grounded_generation_llm_failure(self):
        from bubbly_chef.ai.manager import NoProviderAvailableError
        from bubbly_chef.workflows.router import run_chat_workflow

        history = _make_brainstorm_history(
            "Suggest some vegetarian meals",
            "Here are some ideas:\n\n"
            "1. **Pasta Primavera** — Light and fresh\n"
            "2. **Veggie Stir Fry** — Quick and easy",
        )

        mock_mgr = AsyncMock()
        mock_mgr.complete.side_effect = NoProviderAvailableError("LLM unavailable")

        with _ai_patches(mock_mgr), patch(
            "bubbly_chef.workflows.recipe.nodes.search_recipe",
            new=AsyncMock(return_value=None),
        ):
            envelope = await run_chat_workflow(
                "I'd like Pasta Primavera",
                history=history,
            )

        assert_envelope_structure(envelope)
        # generate_grounded_recipe catches the error and returns a fallback
        # with intent=GENERAL_CHAT and an apology message
        assert envelope.intent in (Intent.GENERAL_CHAT, Intent.RECIPE_CARD)
        assert "couldn't generate" in envelope.assistant_message.lower() or len(envelope.errors) > 0
        # Should not have a valid recipe proposal
        assert not isinstance(envelope.proposal, RecipeCardProposal)


# =============================================================================
# Test 4: No brainstorm in history -> no RECIPE_CARD routing
# =============================================================================


class TestBrainstormNoFollowupDetected:
    """History without intent=recipe_brainstorm does NOT route to RECIPE_CARD."""

    @pytest.mark.asyncio
    async def test_general_history_does_not_trigger_recipe_card(self):
        from bubbly_chef.workflows.router import run_chat_workflow

        history = [
            {"role": "user", "content": "How long does chicken last in the fridge?"},
            {
                "role": "assistant",
                "content": "Raw chicken lasts 1-2 days in the fridge.",
                "intent": "cooking_help",
            },
        ]

        cooking_response = "Pasta Primavera is great! Boil pasta, sauté veggies, toss together."

        mock_mgr = AsyncMock()
        mock_mgr.complete.side_effect = [cooking_response]

        with _ai_patches(mock_mgr):
            envelope = await run_chat_workflow(
                "Tell me about Pasta Primavera",
                history=history,
            )

        assert_envelope_structure(envelope)
        assert envelope.intent != Intent.RECIPE_CARD
        assert not isinstance(envelope.proposal, RecipeCardProposal)
