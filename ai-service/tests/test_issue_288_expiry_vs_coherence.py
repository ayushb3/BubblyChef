"""Issue #288: expiry urgency must not outrank whether a dish makes sense.

Reported bug: asked for a chicken-and-potato meal with banana and apple near
expiry, the brainstorm returned "Savory Chicken Potato Banana Fritters" — the
model welded a sweet fruit into a savoury dish because `BRAINSTORM_SYSTEM_PROMPT`
listed "prioritize expiring ingredients" as an unconditional rule with no
counterweight, and the pantry-context block labelled the section
"Expiring soon (prioritize)".

We cannot deterministically unit-test LLM output (mocking the LLM to return
banana-free suggestions proves nothing about real behaviour). What we *can*
pin is the contract the model actually sees: the rendered prompt text. This
file asserts on that text only — precedent for prompt-level assertions is in
`tests/test_issue_287_pantry_optout.py` and `tests/test_must_use_ingredients.py`.

Scope is prompt-level only, per the triage brief: no compatibility/pairing
score, no change to `_score` / `score_and_rank`, no touching
`BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY` (#287 deliberately dropped rather than
softened the pantry-dependent rules there) or `GROUNDED_RECIPE_SYSTEM_PROMPT`
(flagged separately, not changed here).
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.workflows.recipe.nodes import (
    BRAINSTORM_SYSTEM_PROMPT,
    BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY,
    brainstorm_recipe_ideas,
)


def _mock_ai(return_value: Any = "**Idea**\nWhich one sounds good?") -> Any:
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=return_value)
    return patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager",
        MagicMock(return_value=ai),
    )


def _captured_prompt(mock_mgr: Any) -> str:
    """Pull the prompt from the mocked AIManager's `complete()` call.

    `mock_mgr` is the object bound by `with _mock_ai() as mock_mgr`, i.e. the
    `MagicMock(return_value=ai)` standing in for `get_ai_manager`; calling it
    returns the `ai` mock whose `.complete` was actually awaited.
    """
    return str(mock_mgr.return_value.complete.call_args.kwargs["prompt"])


# ---------------------------------------------------------------------------
# The static rule text itself
# ---------------------------------------------------------------------------


class TestBrainstormPromptRuleText:
    def test_old_unconditional_rule_is_gone(self) -> None:
        """The bare 'prioritize expiring' rule with no counterweight is gone."""
        assert "Prioritize ingredients marked as expiring soon" not in BRAINSTORM_SYSTEM_PROMPT

    def test_expiry_is_a_preference_not_a_requirement(self) -> None:
        """The rule must explicitly say expiring items are a preference, not a rule."""
        assert "strong preference, not a" in BRAINSTORM_SYSTEM_PROMPT
        assert "requirement" in BRAINSTORM_SYSTEM_PROMPT

    def test_permission_to_omit_an_expiring_item(self) -> None:
        """The model must be explicitly told it may leave an expiring item out."""
        assert "fine to leave an expiring item out" in BRAINSTORM_SYSTEM_PROMPT

    def test_expiry_nudge_survives(self) -> None:
        """Expiring stock must not silently vanish: try at least one idea, or say so."""
        assert "try to build at least one idea around them" in BRAINSTORM_SYSTEM_PROMPT
        assert "say so briefly instead of forcing one in" in BRAINSTORM_SYSTEM_PROMPT

    def test_coherence_instruction_present(self) -> None:
        """A coherence rule must exist and name the reported failure mode directly."""
        assert "make culinary sense" in BRAINSTORM_SYSTEM_PROMPT
        assert "sweet ingredient" in BRAINSTORM_SYSTEM_PROMPT
        assert "savoury dish" in BRAINSTORM_SYSTEM_PROMPT

    def test_coherence_instruction_has_an_escape_hatch(self) -> None:
        """The rule against forcing fruit into savoury dishes must yield to an
        explicit user ask or a genuinely coherent cuisine context — it is not
        an absolute ban on sweet-savoury combinations."""
        assert "unless the user asked for that combination" in BRAINSTORM_SYSTEM_PROMPT
        assert "genuine part of the cuisine" in BRAINSTORM_SYSTEM_PROMPT

    def test_must_use_override_is_verbatim_unchanged(self) -> None:
        """#239-era behaviour: must-use overrides every other preference,
        including the (now softer) expiry rule. This wording must not move."""
        assert (
            'If "Must use" ingredients are listed, EVERY idea must actually use them — '
            "this overrides every other preference"
        ) in BRAINSTORM_SYSTEM_PROMPT

    def test_no_pantry_prompt_is_untouched(self) -> None:
        """#287's no-pantry prompt deliberately dropped (not softened) the
        pantry-dependent rules. This issue must not reintroduce pantry
        language there."""
        assert "expiring soon" not in BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY
        assert "strong preference" not in BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY
        assert (
            'If "Must use" ingredients are listed, EVERY idea must actually use them — '
            "this overrides every other preference"
        ) in BRAINSTORM_SYSTEM_PROMPT_NO_PANTRY


# ---------------------------------------------------------------------------
# The rendered pantry-context block (what actually reaches the model)
# ---------------------------------------------------------------------------


class TestPantryContextLabel:
    @pytest.mark.asyncio
    async def test_expiring_block_is_not_labelled_prioritize(self) -> None:
        """The bare 'Expiring soon (prioritize)' label reinforced the
        hard-requirement reading — it must be softened."""
        scored = [
            {"name": "banana", "_score": 10, "_must_use": False, "_expired": False},
            {"name": "apple", "_score": 10, "_must_use": False, "_expired": False},
        ]
        with _mock_ai() as ai:
            await brainstorm_recipe_ideas(
                {
                    "input_text": "chicken and potato dinner",
                    "scored_pantry_items": scored,
                    "recipe_constraints": {"must_use_ingredients": ["chicken", "potato"]},
                }
            )
        prompt = _captured_prompt(ai)
        assert "Expiring soon (prioritize)" not in prompt
        assert "banana" in prompt
        assert "apple" in prompt
        # Must-use precedence: chicken/potato still bind every idea.
        assert "Must use: chicken, potato" in prompt

    @pytest.mark.asyncio
    async def test_reported_scenario_prompt_carries_both_signals(self) -> None:
        """Reproduces the exact reported inputs at the prompt-construction
        level: must-use (chicken, potato) and expiring (banana, apple) both
        reach the prompt, must-use is unconditional, expiring is a
        preference the model may decline for a specific idea."""
        scored = [
            {"name": "chicken", "_score": 20, "_must_use": True, "_expired": False},
            {"name": "potato", "_score": 20, "_must_use": True, "_expired": False},
            {"name": "banana", "_score": 10, "_must_use": False, "_expired": False},
            {"name": "apple", "_score": 10, "_must_use": False, "_expired": False},
        ]
        with _mock_ai() as ai:
            await brainstorm_recipe_ideas(
                {
                    "input_text": "I want a chicken and potato meal, my banana and "
                    "apple are about to expire",
                    "scored_pantry_items": scored,
                    "recipe_constraints": {
                        "must_use_ingredients": ["chicken", "potato"],
                    },
                }
            )
        prompt = _captured_prompt(ai)
        assert "Must use: chicken, potato" in prompt
        assert "this overrides every other preference" in prompt
        assert "banana" in prompt and "apple" in prompt
        assert "fine to leave an expiring item out" in prompt
        assert "sweet ingredient" in prompt
