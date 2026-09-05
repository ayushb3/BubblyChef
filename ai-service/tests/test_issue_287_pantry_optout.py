"""Issue #287: "don't look at my pantry" must be representable, and must persist.

The reported failure was a two-turn sequence. Turn 1: "I want a recipe with chicken
and potatoes. Don't look at my pantry." — honoured. Turn 2: "Like a full meal. It can
be separate dishes." — the pantry came back, and every suggestion was bent around
expiring apples and bananas.

Three things had to be true for that bug to exist, and this file pins all three:
the constraint is extracted, the prompts actually drop the pantry when it is off,
and the choice survives a follow-up turn that doesn't repeat it.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.recipe import RecipeConstraints
from bubbly_chef.workflows.recipe.nodes import (
    _merge_constraints,
    brainstorm_recipe_ideas,
    extract_recipe_constraints,
    generate_grounded_recipe,
    is_pantry_grounded,
    score_pantry_ingredients,
)
from bubbly_chef.workflows.state import LLMRecipeResult

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_ai(return_value: Any) -> Any:
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=return_value)
    return patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager",
        MagicMock(return_value=ai),
    )


def _captured_prompt(ai_patch_target: Any) -> str:
    """Pull the prompt out of the single ai_manager.complete call."""
    return str(ai_patch_target.complete.await_args.kwargs["prompt"])


def _pantry(*names: str) -> list[dict[str, Any]]:
    return [
        {"name": n, "quantity": 1.0, "unit": "piece", "days_until_expiry": 1}
        for n in names
    ]


def _state(**extra: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "input_text": "",
        "user_id": "user-1",
        "input_mode": "chat",
        "conversation_history": [],
    }
    base.update(extra)
    return base


# ---------------------------------------------------------------------------
# The flag itself
# ---------------------------------------------------------------------------


class TestPantryGroundedPredicate:
    """None means 'no opinion', not 'off' — the distinction the whole fix rests on."""

    def test_unstated_is_grounded(self) -> None:
        assert is_pantry_grounded({}) is True
        assert is_pantry_grounded({"use_pantry": None}) is True

    def test_only_explicit_false_turns_it_off(self) -> None:
        assert is_pantry_grounded({"use_pantry": False}) is False
        assert is_pantry_grounded({"use_pantry": True}) is True

    def test_none_constraints_are_grounded(self) -> None:
        assert is_pantry_grounded(None) is True

    def test_model_property_agrees(self) -> None:
        assert RecipeConstraints().pantry_grounded is True
        assert RecipeConstraints(use_pantry=True).pantry_grounded is True
        assert RecipeConstraints(use_pantry=False).pantry_grounded is False


# ---------------------------------------------------------------------------
# Persistence across turns — the actual reported bug
# ---------------------------------------------------------------------------


class TestOptOutSurvivesFollowUp:
    def test_merge_keeps_false_when_the_next_turn_says_nothing(self) -> None:
        merged = _merge_constraints({"use_pantry": False}, {"use_pantry": None})
        assert merged["use_pantry"] is False

    def test_merge_lets_the_user_turn_it_back_on(self) -> None:
        merged = _merge_constraints({"use_pantry": False}, {"use_pantry": True})
        assert merged["use_pantry"] is True

    def test_merge_lets_the_user_turn_it_off_later(self) -> None:
        merged = _merge_constraints({"use_pantry": True}, {"use_pantry": False})
        assert merged["use_pantry"] is False

    def test_absent_key_does_not_resurrect_the_pantry(self) -> None:
        """A fresh extraction with no use_pantry key at all must not override."""
        merged = _merge_constraints({"use_pantry": False}, {"cuisine": "italian"})
        assert merged["use_pantry"] is False
        assert merged["cuisine"] == "italian"

    @pytest.mark.asyncio
    async def test_second_turn_inherits_the_opt_out_end_to_end(self) -> None:
        """Turn 2 says nothing about the pantry; the turn-1 opt-out must hold."""
        state = _state(
            input_text="Like a full meal. It can be separate dishes",
            session={"metadata": {"recipe_constraints": {"use_pantry": False}}},
        )
        # The model, seeing no pantry mention this turn, returns None for the flag.
        with _mock_ai(RecipeConstraints(use_pantry=None, meal_type="dinner")):
            result = await extract_recipe_constraints(state)  # type: ignore[arg-type]

        assert result["recipe_constraints"]["use_pantry"] is False
        assert is_pantry_grounded(result["recipe_constraints"]) is False


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


class TestScoringShortCircuits:
    @pytest.mark.asyncio
    async def test_opt_out_skips_scoring_entirely(self) -> None:
        state = _state(
            pantry_snapshot=_pantry("banana", "apple"),
            recipe_constraints={"use_pantry": False},
        )
        result = await score_pantry_ingredients(state)  # type: ignore[arg-type]
        assert result["scored_pantry_items"] == []

    @pytest.mark.asyncio
    async def test_opt_out_never_touches_the_database(self) -> None:
        """With no snapshot, the grounded path hits the repo; the opted-out one must not."""
        state = _state(pantry_snapshot=[], recipe_constraints={"use_pantry": False})
        with patch(
            "bubbly_chef.workflows.recipe.nodes.get_repository", new_callable=AsyncMock
        ) as repo:
            result = await score_pantry_ingredients(state)  # type: ignore[arg-type]
        repo.assert_not_awaited()
        assert result["scored_pantry_items"] == []

    @pytest.mark.asyncio
    async def test_default_still_scores(self) -> None:
        state = _state(pantry_snapshot=_pantry("chicken"), recipe_constraints={})
        result = await score_pantry_ingredients(state)  # type: ignore[arg-type]
        assert len(result["scored_pantry_items"]) == 1


# ---------------------------------------------------------------------------
# Prompts — the part that actually reached the user
# ---------------------------------------------------------------------------


class TestBrainstormPrompt:
    @pytest.mark.asyncio
    async def test_opted_out_prompt_carries_no_pantry_and_no_expiry_rule(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(return_value="**Roast Chicken**\nWhich one sounds good?")
        state = _state(
            input_text="I want a recipe with chicken and potatoes. Don't look at my pantry.",
            scored_pantry_items=[],
            recipe_constraints={"use_pantry": False, "meal_type": "dinner"},
        )
        with patch(
            "bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)
        ):
            await brainstorm_recipe_ideas(state)  # type: ignore[arg-type]

        prompt = _captured_prompt(ai)
        assert "Expiring soon" not in prompt
        assert "expiring soon" not in prompt
        assert "Other available" not in prompt
        # The "no pantry items available" fallback would still invite pantry talk.
        assert "No pantry items available" not in prompt
        assert "asked you NOT to use their pantry" in prompt

    @pytest.mark.asyncio
    async def test_opted_out_prompt_drops_the_60_percent_rule(self) -> None:
        """That rule refers to a list this prompt no longer contains."""
        ai = MagicMock()
        ai.complete = AsyncMock(return_value="**Roast Chicken**")
        state = _state(
            input_text="chicken, ignore my pantry",
            scored_pantry_items=[],
            recipe_constraints={"use_pantry": False},
        )
        with patch(
            "bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)
        ):
            await brainstorm_recipe_ideas(state)  # type: ignore[arg-type]
        assert "60%+" not in _captured_prompt(ai)

    @pytest.mark.asyncio
    async def test_opted_out_recipe_mode_drops_its_own_pantry_line(self) -> None:
        """Recipe mode's prefix says to prioritise the pantry — it must not contradict."""
        ai = MagicMock()
        ai.complete = AsyncMock(return_value="**Roast Chicken**")
        state = _state(
            input_text="chicken, don't look at my pantry",
            input_mode="recipe",
            scored_pantry_items=[],
            recipe_constraints={"use_pantry": False},
        )
        with patch(
            "bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)
        ):
            await brainstorm_recipe_ideas(state)  # type: ignore[arg-type]
        prompt = _captured_prompt(ai)
        assert "already has in their pantry" not in prompt
        assert "RECIPE MODE" in prompt  # the rest of the mode prefix survives

    @pytest.mark.asyncio
    async def test_must_use_still_binds_when_opted_out(self) -> None:
        """Opting out of the pantry is not opting out of what the user asked for."""
        ai = MagicMock()
        ai.complete = AsyncMock(return_value="**Chicken Potato Bake**")
        state = _state(
            input_text="chicken and potatoes, don't look at my pantry",
            scored_pantry_items=[],
            recipe_constraints={
                "use_pantry": False,
                "must_use_ingredients": ["chicken", "potatoes"],
            },
        )
        with patch(
            "bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)
        ):
            await brainstorm_recipe_ideas(state)  # type: ignore[arg-type]
        prompt = _captured_prompt(ai)
        assert "chicken, potatoes" in prompt
        assert "Must use" in prompt

    @pytest.mark.asyncio
    async def test_default_prompt_is_unchanged(self) -> None:
        """The grounded path still surfaces expiring stock — as a preference (#288)."""
        ai = MagicMock()
        ai.complete = AsyncMock(return_value="**Chicken Bake**")
        state = _state(
            input_text="what can I make?",
            scored_pantry_items=[
                {"name": "spinach", "_score": 12, "_must_use": False, "_expired": False},
            ],
            recipe_constraints={},
        )
        with patch(
            "bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)
        ):
            await brainstorm_recipe_ideas(state)  # type: ignore[arg-type]
        prompt = _captured_prompt(ai)
        assert "Expiring soon (weave in where it fits, not mandatory): spinach" in prompt
        assert "strong preference, not a" in prompt


class TestGroundedRecipePrompt:
    @pytest.mark.asyncio
    async def test_opted_out_generation_does_not_reload_the_pantry(self) -> None:
        """The direct recipe_card path re-fetches when unscored — it must not here."""
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=LLMRecipeResult(
                title="Roast Chicken",
                description="d",
                ingredients=[],
                instructions=["step"],
            )
        )
        state = _state(
            input_text="Roast Chicken",
            selected_recipe_name="Roast Chicken",
            scored_pantry_items=[],
            pantry_snapshot=[],
            recipe_constraints={"use_pantry": False},
        )
        with patch(
            "bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)
        ), patch(
            "bubbly_chef.workflows.recipe.nodes.get_repository", new_callable=AsyncMock
        ) as repo:
            await generate_grounded_recipe(state)  # type: ignore[arg-type]

        repo.assert_not_awaited()
        prompt = _captured_prompt(ai)
        assert "use_pantry" not in prompt
        assert "Priority ingredients (expiring soon — use first): none specified" in prompt
