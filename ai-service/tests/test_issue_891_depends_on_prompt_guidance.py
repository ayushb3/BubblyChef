"""Issue #891: the step-metadata prompts tell the model that a hands-off wait
(a preheat) blocks only the steps that need it, so hands-on prep is not chained
behind it. The scheduler also repairs chained dependencies deterministically
(see nextjs/src/__tests__/meal-scheduler-preheat.test.ts); this is the nudge
that keeps new recipes from needing the repair.
"""

import pytest

from bubbly_chef.prompts.meal import MEAL_DISH_EXPANSION_SYSTEM_PROMPT
from bubbly_chef.prompts.recipe import (
    GROUNDED_RECIPE_SYSTEM_PROMPT,
    STRUCTURED_STEPS_ENSURE_PROMPT,
)


@pytest.mark.parametrize(
    "prompt",
    [
        MEAL_DISH_EXPANSION_SYSTEM_PROMPT,
        GROUNDED_RECIPE_SYSTEM_PROMPT,
        STRUCTURED_STEPS_ENSURE_PROMPT,
    ],
    ids=["meal_dish_expansion", "grounded_recipe", "structured_steps_ensure"],
)
def test_depends_on_guidance_keeps_prep_out_of_the_preheat(prompt: str) -> None:
    lowered = " ".join(prompt.lower().split())
    assert "preheat" in lowered
    assert "only the steps that" in lowered
    assert "not on the step before" in lowered
