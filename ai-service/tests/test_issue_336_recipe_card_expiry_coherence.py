"""Issue #336: expiry urgency must not outrank dish coherence in the recipe
card step, not just brainstorm.

#288 fixed `BRAINSTORM_SYSTEM_PROMPT` (recipe *names*, can decline across a
set of ideas). `GROUNDED_RECIPE_SYSTEM_PROMPT` — the step that builds the
full recipe card once a name is chosen — still said "Priority ingredients
(expiring soon — use first)" with no coherence counterweight and no
permission to leave one out. Two paths reach it with no upstream guard:

1. The direct `recipe_card` intent (`route_by_intent` -> "research_recipe" ->
   `generate_grounded_recipe`) skips brainstorm entirely and re-scores the
   pantry itself (see `router.py`'s conditional edges off `classify_intent`,
   which map `recipe_card` straight to `research_recipe`, never through
   `extract_recipe_constraints` / `score_pantry` / `brainstorm_recipes`).
2. A coherent chosen idea from brainstorm (e.g. "Chicken Potato Bake") still
   reaches this same prompt with the full scored pantry, and could be told to
   use an expiring banana "first" with no license to decline.

Both paths format the same `GROUNDED_RECIPE_SYSTEM_PROMPT`, so the fix lives
there once. As with #288, we cannot deterministically unit-test LLM output —
these tests assert only on the rendered prompt text, following the pattern in
`tests/test_issue_288_expiry_vs_coherence.py`.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.workflows.recipe.nodes import (
    GROUNDED_RECIPE_SYSTEM_PROMPT,
    generate_grounded_recipe,
)
from bubbly_chef.workflows.state import LLMRecipeResult


def _mock_ai() -> Any:
    ai = MagicMock()
    ai.complete = AsyncMock(
        return_value=LLMRecipeResult(
            title="Chicken Potato Bake",
            description="d",
            ingredients=[],
            instructions=["step"],
        )
    )
    return patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager",
        MagicMock(return_value=ai),
    )


def _captured_prompt(mock_mgr: Any) -> str:
    return str(mock_mgr.return_value.complete.call_args.kwargs["prompt"])


# ---------------------------------------------------------------------------
# The static rule text itself
# ---------------------------------------------------------------------------


class TestGroundedRecipePromptRuleText:
    def test_old_unconditional_use_first_rule_is_gone(self) -> None:
        assert "expiring soon — use first" not in GROUNDED_RECIPE_SYSTEM_PROMPT

    def test_priority_is_a_preference_not_a_requirement(self) -> None:
        assert "strong preference, not a" in GROUNDED_RECIPE_SYSTEM_PROMPT
        assert "requirement" in GROUNDED_RECIPE_SYSTEM_PROMPT

    def test_permission_to_omit_a_priority_ingredient(self) -> None:
        """Unlike brainstorm (which can decline across several ideas), this
        step builds one recipe — the honest equivalent is 'include it only
        if it fits this dish', not 'say so instead'."""
        assert "fine to leave one out" in GROUNDED_RECIPE_SYSTEM_PROMPT
        assert "genuinely fits the dish" in GROUNDED_RECIPE_SYSTEM_PROMPT

    def test_coherence_instruction_present(self) -> None:
        assert "sweet ingredient" in GROUNDED_RECIPE_SYSTEM_PROMPT
        assert "savoury dish" in GROUNDED_RECIPE_SYSTEM_PROMPT

    def test_coherence_instruction_has_an_escape_hatch(self) -> None:
        assert "unless the user asked for that combination" in GROUNDED_RECIPE_SYSTEM_PROMPT
        assert "genuine part of the cuisine" in GROUNDED_RECIPE_SYSTEM_PROMPT

    def test_no_reflattening_prioritize_instruction(self) -> None:
        """The prompt's closing line used to say 'Prioritize using the listed
        available ingredients' — a bare 'prioritize' collides with the
        softened 'strong preference, not a requirement' framing above it and
        reads as re-strengthening the very rule this issue softened. No line
        in this prompt may reintroduce that word as an instruction."""
        assert "Prioritize" not in GROUNDED_RECIPE_SYSTEM_PROMPT
        assert "prioritize" not in GROUNDED_RECIPE_SYSTEM_PROMPT

    def test_must_use_precedence_is_unweakened(self) -> None:
        """Must-use ingredients stay a hard requirement, unaffected by the
        softened priority-ingredient rule."""
        assert (
            "Must-use ingredients (the user asked to cook with these — the recipe MUST "
            "include them): {must_use_items}"
        ) in GROUNDED_RECIPE_SYSTEM_PROMPT
        assert "remain a hard requirement regardless of fit" in GROUNDED_RECIPE_SYSTEM_PROMPT


# ---------------------------------------------------------------------------
# The rendered prompt on the direct recipe_card path (no upstream guard)
# ---------------------------------------------------------------------------


class TestDirectRecipeCardPathPrompt:
    """`recipe_card` intent skips brainstorm and reaches this node directly
    with pre-scored pantry items — this is the path issue #336 flags as
    having no upstream coherence guard at all."""

    @pytest.mark.asyncio
    async def test_direct_path_prompt_carries_preference_and_coherence_language(
        self,
    ) -> None:
        scored = [
            {"name": "chicken", "_score": 20, "_must_use": True, "_expired": False},
            {"name": "potato", "_score": 20, "_must_use": True, "_expired": False},
            {"name": "banana", "_score": 10, "_must_use": False, "_expired": False},
        ]
        state = {
            "input_text": "Chicken Potato Bake",
            "selected_recipe_name": "Chicken Potato Bake",
            "scored_pantry_items": scored,
            "pantry_snapshot": [],
            "recipe_constraints": {"must_use_ingredients": ["chicken", "potato"]},
        }
        with _mock_ai() as ai:
            await generate_grounded_recipe(state)  # type: ignore[arg-type]

        prompt = _captured_prompt(ai)
        assert "Must-use ingredients" in prompt
        assert "chicken, potato" in prompt
        assert "banana" in prompt
        assert "strong preference, not a" in prompt
        assert "fine to leave one out" in prompt
        assert "sweet ingredient" in prompt
        assert "remain a hard requirement regardless of fit" in prompt

    @pytest.mark.asyncio
    async def test_must_use_still_binds_regardless_of_priority_softening(self) -> None:
        """Must-use items must still be named as a hard requirement in the
        rendered prompt, unaffected by the priority-ingredient softening."""
        scored = [
            {"name": "chicken", "_score": 20, "_must_use": True, "_expired": False},
        ]
        state = {
            "input_text": "Chicken Dish",
            "selected_recipe_name": "Chicken Dish",
            "scored_pantry_items": scored,
            "pantry_snapshot": [],
            "recipe_constraints": {"must_use_ingredients": ["chicken"]},
        }
        with _mock_ai() as ai:
            await generate_grounded_recipe(state)  # type: ignore[arg-type]

        prompt = _captured_prompt(ai)
        assert "the recipe MUST \\\ninclude them" in prompt or "recipe MUST" in prompt
        assert "chicken" in prompt
