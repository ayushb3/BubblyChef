"""Issue #772: clear whole-meal asks route to meal_plan, not a single recipe or brainstorm.

Found in the live check for the meal-options PR: "plan a cozy Italian dinner for two"
went to recipe_card, "easy weeknight dinner, I only have eggs and rice" went to
recipe_brainstorm. A deterministic pre-classifier rule (the seam #760 used for
meal-again) takes the unambiguous phrases; the borderline ones are left to the
classifier, whose prompt gets few-shots for them.

No model is called: the classifier is a stub that answers what the model got wrong
live, so a green test means the rule - not the stub - made the routing decision.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.prompts.router import MEAL_PLAN_ROUTING_PROMPT
from bubbly_chef.workflows.router import classify_intent
from bubbly_chef.workflows.shared_state import LLMIntentResult


def _state(text: str, **extra: Any) -> Any:
    return {
        "input_text": text,
        "errors": [],
        "warnings": [],
        "session_mode": None,
        "session": None,
        "conversation_history": [],
        "selected_recipe_name": None,
        **extra,
    }


def _llm_says(intent: str) -> tuple[Any, MagicMock]:
    ai = MagicMock()
    ai.complete = AsyncMock(
        return_value=LLMIntentResult(intent=intent, confidence=0.9, reasoning="stub", entities=[])
    )
    patcher = patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai))
    return patcher, ai


# ---------------------------------------------------------------------------
# Whole-meal asks the rule owns: meal_plan, and the model is never asked
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("wrong_llm_intent", ["recipe_card", "recipe_brainstorm"])
@pytest.mark.parametrize(
    "text",
    [
        # The three failing asks from the issue's table.
        "plan a cozy Italian dinner for two",
        "easy weeknight dinner, I only have eggs and rice",
        "a meal for 2 tonight, using only eggs and rice",
        # Same shapes, other words.
        "Plan dinner for 2",
        "plan lunch for the family",
        "can you plan a romantic dinner?",
        "dinner for two",
        "a meal for four tonight",
        "a cozy dinner for 2 please",
        "lunch for me and my partner",
        "quick weeknight dinner",
        "a simple dinner using up leftover rice",
    ],
)
async def test_clear_whole_meal_asks_route_to_meal_plan(text: str, wrong_llm_intent: str) -> None:
    patcher, ai = _llm_says(wrong_llm_intent)
    with patcher:
        result = await classify_intent(_state(text))

    assert result["intent"] == Intent.MEAL_PLAN.value
    ai.complete.assert_not_called()


# ---------------------------------------------------------------------------
# Asks that must keep their single-recipe / brainstorm routing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text,llm_intent",
    [
        ("a recipe for lemon pasta", "recipe_generation"),
        ("ideas for using up spinach", "recipe_brainstorm"),
        ("give me a pasta recipe", "recipe_generation"),
        ("a quick pasta recipe for dinner", "recipe_generation"),
        ("something for dinner", "recipe_brainstorm"),
        ("dinner ideas", "recipe_brainstorm"),
        ("an idea for dinner with chicken", "recipe_brainstorm"),
        ("a recipe for dinner", "recipe_generation"),
        ("what can I make with eggs and rice?", "recipe_brainstorm"),
        ("make a pasta dinner", "recipe_generation"),
        ("a pasta dinner for two", "recipe_generation"),
        ("how do I cook rice for dinner?", "cooking_help"),
        ("recipe for dinner for two", "recipe_generation"),
        ("what are some ideas for a meal for 4", "recipe_brainstorm"),
    ],
)
async def test_single_recipe_and_brainstorm_asks_are_left_to_the_classifier(
    text: str, llm_intent: str
) -> None:
    patcher, ai = _llm_says(llm_intent)
    with patcher:
        result = await classify_intent(_state(text))

    assert result["intent"] == llm_intent
    ai.complete.assert_called_once()


# ---------------------------------------------------------------------------
# Near misses: a message that merely MENTIONS a meal is not an ask for one.
# The rules skip the model, so a false positive cannot be recovered - these must
# reach the classifier (review of PR #775).
# ---------------------------------------------------------------------------

_NEAR_MISSES = [
    # From the review.
    "can I freeze the dinner for 4?",
    "is this enough for a meal for two?",
    "my family loved the dinner for 6",
    "can you help me plan my shopping list for dinner?",
    "what should I make for dinner with the chicken I cooked last night?",
    # Questions about a dinner.
    "how long can the dinner for 4 sit out?",
    "is a meal for two too much chicken?",
    "does the dinner for two reheat well?",
    # Storage and leftovers.
    "where should I store the leftover dinner for 6?",
    "can I reheat last night's dinner for two?",
    # Past meals.
    "the dinner for 4 last night was great",
    "we had a lovely meal for two yesterday",
    "I cooked dinner for the family and it was good",
    "that was an easy weeknight dinner, thanks",
    # Shopping and planning nouns.
    "my plan for dinner is pasta",
    "help me plan the grocery run for the dinner for 4",
    "what's the plan for dinner?",
    "plan dinner for the whole week",
    "plan a dinner party menu for 8",
    # Dishes and ideas.
    "a lasagna dinner for 6",
    "ideas for a dinner for two",
]


@pytest.mark.asyncio
@pytest.mark.parametrize("text", _NEAR_MISSES)
async def test_a_mention_of_a_meal_is_left_to_the_classifier(text: str) -> None:
    patcher, ai = _llm_says("cooking_help")
    with patcher:
        result = await classify_intent(_state(text))

    assert result["intent"] == Intent.COOKING_HELP.value
    ai.complete.assert_called_once()


# ---------------------------------------------------------------------------
# The two rule sets (#760 meal-again, #772 whole-meal) must not collide
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text",
    [
        "make that pasta dinner again",
        "Make the pasta dinner again",
        "make that dinner for two again",
        "plan that dinner again",
        "show me my saved dinner for two",
        "the cozy dinner for two I made last week",
        "show me my saved meals",
    ],
)
async def test_meal_again_phrasing_still_reaches_the_saved_lookup(text: str) -> None:
    patcher, ai = _llm_says("meal_plan")
    with patcher:
        result = await classify_intent(_state(text))

    assert result["intent"] == Intent.SAVED_RECIPE_LOOKUP.value
    ai.complete.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text",
    [
        "what should I make for dinner with the chicken I cooked last night?",
        "a dinner for the chicken I cooked",
        "lunch using the sauce we made",
        "dinner from the rice I made yesterday",
    ],
)
async def test_a_past_cook_mentioned_inside_a_question_is_not_a_saved_lookup(text: str) -> None:
    patcher, ai = _llm_says("recipe_brainstorm")
    with patcher:
        result = await classify_intent(_state(text))

    assert result["intent"] == Intent.RECIPE_BRAINSTORM.value
    ai.complete.assert_called_once()


# ---------------------------------------------------------------------------
# Session state: a pinned recipe or an active cook owns the message
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mid_cook_the_rule_stays_out_of_the_way() -> None:
    patcher, ai = _llm_says("cooking_help")
    with patcher:
        result = await classify_intent(
            _state("plan a dinner for two", session_mode="cooking")
        )

    assert result["intent"] == Intent.COOKING_HELP.value
    ai.complete.assert_called_once()


@pytest.mark.asyncio
async def test_a_picked_recipe_keeps_dinner_for_n_as_a_tweak() -> None:
    # "make it a dinner for 4" while a recipe is open is scaling it, not a new meal.
    session = {"metadata": {"picked_recipe": {"title": "Lemon Pasta"}}}
    patcher, ai = _llm_says("recipe_card")
    with patcher:
        result = await classify_intent(
            _state(
                "dinner for 4",
                session_mode="recipe_exploring",
                session=session,
            )
        )

    assert result["intent"] == Intent.RECIPE_CARD.value
    ai.complete.assert_called_once()


@pytest.mark.asyncio
async def test_an_explicit_meal_pick_still_beats_the_rule() -> None:
    patcher, _ai = _llm_says("recipe_card")
    with patcher:
        result = await classify_intent(
            _state("dinner for two", context={"meal_option_id": "opt-1"})
        )

    assert result["intent"] == Intent.MEAL_PLAN.value
    assert result["intent_confidence"] == 1.0


# ---------------------------------------------------------------------------
# Borderline asks: the classifier prompt carries the few-shots
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_classifier_prompt_teaches_the_borderline_whole_meal_ask() -> None:
    patcher, ai = _llm_says("meal_plan")
    with patcher:
        await classify_intent(_state("something that's a whole meal in one bowl"))

    prompt = ai.complete.call_args.kwargs["prompt"]
    assert MEAL_PLAN_ROUTING_PROMPT in prompt
    assert "whole meal in one bowl" in prompt
    assert "meal_plan" in MEAL_PLAN_ROUTING_PROMPT


def test_few_shots_cover_the_issue_asks_and_the_stay_put_cases() -> None:
    for ask in (
        "plan a cozy Italian dinner for two",
        "easy weeknight dinner, I only have eggs and rice",
        "a meal for 2 tonight, using only eggs and rice",
    ):
        assert f"'{ask}' → meal_plan" in MEAL_PLAN_ROUTING_PROMPT
    for stay in ("a recipe for lemon pasta", "ideas for using up spinach"):
        assert stay in MEAL_PLAN_ROUTING_PROMPT
