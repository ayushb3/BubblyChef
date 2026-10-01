"""Issue #846: refining a meal in chat re-runs the meal engine, it doesn't ask what you have.

After a meal pick, "no, something quicker, I don't have butter" was classified as a recipe
edit; with no pinned recipe that fell through to a generic cooking answer ("What
ingredients do you currently have on hand?"). A typed refinement of the meal (or the
options) on screen now takes the same path a pill tap does: the option stage, with the
retained constraints, the pantry, and this turn's change merged in.

No model is called: the classifier and the option stage's model are stubs, so a green
test means the routing and merge rules made the decision.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.models.meal import (
    MealConstraintsEcho,
    MealCoverage,
    MealDishOutline,
    MealOption,
    MealOptionLLM,
    MealOptionsLLMResult,
    MealOptionsProposal,
    MealPlanSessionState,
)
from bubbly_chef.models.recipe import RecipeConstraints
from bubbly_chef.workflows.meal.nodes import meal_pick_stage
from bubbly_chef.workflows.router import (
    classify_intent,
    run_chat_workflow,
    run_chat_workflow_streaming,
)
from bubbly_chef.workflows.shared_state import LLMIntentResult

from .test_issue_651_meal_pills import (
    _CONV_ID,
    _dish_llm,
    _meal_repo,
    _pantry_item,
    _recipe_llm_result,
    _reset_graphs,
)

_MEAL_TURN = {"role": "assistant", "content": "Here are three meal ideas!", "intent": "meal_plan"}
_OTHER_TURN = {"role": "assistant", "content": "Sure thing.", "intent": "general_chat"}


def _option(option_id: str = "opt_1") -> MealOption:
    return MealOption(
        option_id=option_id,
        title="Chickpea Stew Night",
        dishes=[
            MealDishOutline(
                role="main", name="Chickpea Tomato Stew", key_ingredients=["chickpeas", "tomato"]
            ),
            MealDishOutline(role="side", name="Garlic Bread", key_ingredients=["bread", "butter"]),
        ],
        coverage=MealCoverage(pantry_items_used=3, to_buy=[]),
    )


def _retained(**recipe_constraints: Any) -> MealPlanSessionState:
    return MealPlanSessionState(
        options=[_option()],
        servings=3,
        constraints=MealConstraintsEcho(recipe_constraints=recipe_constraints),
    )


def _session(meal_plan: MealPlanSessionState | None = None, **extra: Any) -> dict[str, Any]:
    metadata: dict[str, Any] = dict(extra)
    if meal_plan is not None:
        metadata["meal_plan"] = meal_plan.model_dump(mode="json")
    return {"metadata": metadata}


def _state(text: str, **extra: Any) -> Any:
    return {
        "input_text": text,
        "errors": [],
        "warnings": [],
        "session_mode": None,
        "session": _session(_retained()),
        "conversation_history": [
            {"role": "user", "content": "Plan dinner"},
            _MEAL_TURN,
        ],
        "selected_recipe_name": None,
        "context": None,
        **extra,
    }


def _llm_says(intent: str) -> tuple[Any, MagicMock]:
    ai = MagicMock()
    ai.complete = AsyncMock(
        return_value=LLMIntentResult(intent=intent, confidence=0.9, reasoning="stub", entities=[])
    )
    return patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai)), ai


# ---------------------------------------------------------------------------
# Routing: a refinement of the meal on screen is a meal turn
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("wrong_llm_intent", ["recipe_card", "recipe_brainstorm", "general_chat"])
@pytest.mark.parametrize(
    "text",
    [
        # The five shapes the issue names.
        "something quicker",
        "no, something quicker, I don't have butter",
        "no mushrooms please",
        "make it vegetarian",
        "can we make it spicier?",
        "fewer dishes",
        # Other phrasings of the same ask.
        "can you make it a bit faster",
        "I don't have any butter",
        "I'm out of eggs",
        "without the cream",
        "something lighter",
        "only one side please",
        "something different",
        "Make it dairy-free",
    ],
)
async def test_meal_refinements_route_to_the_meal_path_without_asking_the_model(
    text: str, wrong_llm_intent: str
) -> None:
    patcher, ai = _llm_says(wrong_llm_intent)
    with patcher:
        result = await classify_intent(_state(text))

    assert result["intent"] == Intent.MEAL_PLAN.value
    assert result.get("meal_refinement") is True
    ai.complete.assert_not_called()


@pytest.mark.asyncio
async def test_a_recipe_edit_reading_from_the_model_still_lands_on_the_meal_path() -> None:
    # No rule phrase here, so the classifier is asked; it calls it a recipe edit, which with
    # no pinned recipe used to dead-end in a generic reply.
    patcher, ai = _llm_says("recipe_card")
    with patcher:
        result = await classify_intent(_state("could we go a bit more Italian with it"))

    ai.complete.assert_called_once()
    assert result["intent"] == Intent.MEAL_PLAN.value
    assert result.get("meal_refinement") is True


@pytest.mark.asyncio
async def test_a_refinement_of_the_options_on_screen_routes_the_same_way() -> None:
    # Nothing picked yet: the retained state is the three options, and that is enough.
    patcher, ai = _llm_says("recipe_card")
    with patcher:
        result = await classify_intent(_state("no, something quicker"))

    assert result["intent"] == Intent.MEAL_PLAN.value
    ai.complete.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text,llm_intent",
    [
        ("how long do I roast the chickpeas?", "cooking_help"),
        ("what can I use instead of butter?", "cooking_help"),
        ("is this vegetarian?", "cooking_help"),
        ("how spicy is it?", "cooking_help"),
        ("thanks, no problem", "general_chat"),
        ("no thanks", "general_chat"),
    ],
)
async def test_questions_about_the_meal_are_left_to_the_classifier(
    text: str, llm_intent: str
) -> None:
    patcher, ai = _llm_says(llm_intent)
    with patcher:
        result = await classify_intent(_state(text))

    assert result["intent"] == llm_intent
    assert not result.get("meal_refinement")
    ai.complete.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides,case",
    [
        ({"session": _session(None)}, "no retained meal"),
        ({"session": None}, "no session"),
        ({"conversation_history": [_MEAL_TURN, _OTHER_TURN]}, "last turn was not a meal"),
        ({"conversation_history": []}, "no history"),
        ({"session_mode": "cooking"}, "mid-cook"),
    ],
)
async def test_without_a_meal_on_screen_a_refinement_phrase_is_left_alone(
    overrides: dict[str, Any], case: str
) -> None:
    patcher, ai = _llm_says("recipe_card")
    with patcher:
        result = await classify_intent(_state("something quicker", **overrides))

    assert not result.get("meal_refinement"), case
    ai.complete.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text",
    [
        "give me a recipe for banana pancakes",
        "show me the full recipe for the chickpea stew",
        "what can I use instead of butter?",
        "can I replace the butter with oil",
        "show me a vegetarian recipe for dinner",
        "make me a banana pancake batch",
    ],
)
async def test_a_recipe_card_reading_that_is_not_an_edit_of_the_meal_keeps_its_routing(
    text: str,
) -> None:
    # The classifier is stubbed to recipe_card (what it may well say for these), not to
    # cooking_help: the override must not turn them into a new options card.
    patcher, ai = _llm_says("recipe_card")
    with patcher:
        result = await classify_intent(_state(text))

    ai.complete.assert_called_once()
    assert result["intent"] == Intent.RECIPE_CARD.value
    assert not result.get("meal_refinement")


@pytest.mark.asyncio
async def test_a_pinned_recipe_keeps_its_edit_even_with_a_meal_as_the_last_turn() -> None:
    patcher, ai = _llm_says("recipe_card")
    pinned = {"title": "Old Pancakes", "ingredients": [], "instructions": []}
    with patcher:
        result = await classify_intent(
            _state(
                "could we go a bit more Italian with it",
                session=_session(_retained(), picked_recipe=pinned),
            )
        )

    assert result["intent"] == Intent.RECIPE_CARD.value
    assert not result.get("meal_refinement")


@pytest.mark.asyncio
async def test_a_request_for_another_recipe_is_not_taken_by_the_phrase_list_either() -> None:
    patcher, ai = _llm_says("recipe_generation")
    with patcher:
        result = await classify_intent(_state("show me a vegetarian recipe for dinner"))

    ai.complete.assert_called_once()
    assert not result.get("meal_refinement")


@pytest.mark.parametrize(
    "text,expected",
    [
        ("I don't have much time", []),
        ("something quicker, I don't have much time", []),
        ("I don't have a lot of time", []),
        ("I don't have enough time", []),
        ("I don't have long", []),
        ("no butter and no cream", ["butter", "cream"]),
        ("no butter, no cream", ["butter", "cream"]),
        ("I don't have any butter or no cream", ["butter", "cream"]),
        ("no butter or cream", ["butter", "cream"]),
        ("without the cream", ["cream"]),
    ],
)
def test_absent_ingredients_keeps_only_ingredients(text: str, expected: list[str]) -> None:
    from bubbly_chef.workflows.meal.refine import absent_ingredients

    assert absent_ingredients(text) == expected


@pytest.mark.asyncio
async def test_i_dont_have_much_time_stores_no_exclusion() -> None:
    envelope, ai, _ = await _refine(
        "something quicker, I don't have much time",
        retained=_retained(cuisine="Italian"),
        extracted=RecipeConstraints(),
    )

    assert isinstance(envelope.proposal, MealOptionsProposal)
    echoed = envelope.proposal.constraints.recipe_constraints
    assert not echoed.get("excluded_ingredients")
    assert "Exclude:" not in _option_prompt(ai)


@pytest.mark.asyncio
async def test_a_malformed_retained_meal_is_not_a_meal_on_screen() -> None:
    patcher, ai = _llm_says("recipe_card")
    with patcher:
        result = await classify_intent(
            _state("something quicker", session={"metadata": {"meal_plan": {"options": "nope"}}})
        )

    assert not result.get("meal_refinement")
    ai.complete.assert_called_once()


@pytest.mark.asyncio
async def test_the_option_card_tap_still_wins_over_a_refinement_phrase() -> None:
    patcher, ai = _llm_says("recipe_card")
    with patcher:
        result = await classify_intent(
            _state("something quicker", context={"meal_option_id": "opt_1"})
        )

    assert result["intent"] == Intent.MEAL_PLAN.value
    assert not result.get("meal_refinement")


# ---------------------------------------------------------------------------
# The option stage: pantry + saved constraints + this turn's change
# ---------------------------------------------------------------------------


def _options_ai(extracted: RecipeConstraints) -> MagicMock:
    """Extraction returns `extracted`; the option stage returns two fixed options."""

    async def _complete(*, prompt: str, response_schema: type, temperature: float = 0.7) -> Any:
        if response_schema is RecipeConstraints:
            return extracted
        if response_schema is MealOptionsLLMResult:
            return MealOptionsLLMResult(
                options=[
                    MealOptionLLM(
                        title="Quick Chickpea Bowl",
                        dishes=[
                            _dish_llm("main", "Chickpea Tomato Bowl", ["chickpeas", "tomato"]),
                            _dish_llm("side", "Green Salad", ["lettuce"]),
                        ],
                    ),
                    MealOptionLLM(
                        title="Tomato Egg Skillet",
                        dishes=[_dish_llm("main", "Tomato Egg Skillet", ["eggs", "tomato"])],
                    ),
                ],
                follow_ups=[],
            )
        raise AssertionError(f"Unexpected model call: {response_schema!r}")

    ai = MagicMock()
    ai.complete = AsyncMock(side_effect=_complete)
    return ai


def _option_prompt(ai: MagicMock) -> str:
    return next(
        c.kwargs["prompt"]
        for c in ai.complete.await_args_list
        if c.kwargs["response_schema"] is MealOptionsLLMResult
    )


async def _refine(
    message: str,
    *,
    retained: MealPlanSessionState,
    extracted: RecipeConstraints,
    pantry: list[str] | None = None,
) -> tuple[Any, MagicMock, MagicMock]:
    """One typed refinement turn through the real graph, models stubbed."""
    _reset_graphs()
    repo = _meal_repo(
        pantry_items=[
            _pantry_item(n) for n in (pantry or ["chickpeas", "tomato", "eggs", "butter", "rice"])
        ],
        meal_plan_state=retained,
    )
    ai = _options_ai(extracted)
    classifier = MagicMock()
    classifier.complete = AsyncMock(side_effect=AssertionError("classifier ran for a refinement"))
    with (
        patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=classifier)),
        patch("bubbly_chef.workflows.router.get_repository", AsyncMock(return_value=repo)),
        patch("bubbly_chef.workflows.meal.nodes.get_repository", AsyncMock(return_value=repo)),
        patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=ai)),
        patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
        patch("bubbly_chef.workflows.recipe.nodes.get_repository", AsyncMock(return_value=repo)),
        patch(
            "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
            AsyncMock(return_value=[]),
        ),
    ):
        envelope = await run_chat_workflow(
            message=message,
            conversation_id=_CONV_ID,
            user_id="user-1",
            history=[{"role": "user", "content": "Plan dinner"}, _MEAL_TURN],
        )
    _reset_graphs()
    return envelope, ai, repo


@pytest.mark.asyncio
async def test_quicker_no_butter_keeps_pantry_and_saved_constraints_and_returns_a_meal_card() -> None:
    retained = _retained(
        cuisine="Italian",
        dietary=["vegetarian"],
        max_time_minutes=45,
        excluded_ingredients=["mushrooms"],
    )
    envelope, ai, repo = await _refine(
        "no, something quicker, I don't have butter",
        retained=retained,
        extracted=RecipeConstraints(excluded_ingredients=["butter"]),
    )

    # A new meal card, never a generic question.
    assert isinstance(envelope.proposal, MealOptionsProposal)
    assert "What ingredients" not in envelope.assistant_message
    assert envelope.proposal.servings == 3

    prompt = _option_prompt(ai)
    # Saved constraints carried over.
    assert "Cuisine preference: Italian" in prompt
    assert "Dietary: vegetarian" in prompt
    # The new ask is added on top: quicker, and butter out beside the earlier exclusion.
    assert "Max time: 30 minutes" in prompt
    assert "Exclude: mushrooms, butter" in prompt
    # Still pantry-grounded, minus the butter the user doesn't have.
    pantry_line = prompt.split("Other available:", 1)[1].split("\n", 1)[0]
    assert "chickpeas" in pantry_line and "tomato" in pantry_line
    assert "butter" not in pantry_line

    # Coverage is counted against the pantry (still grounded), excluding butter.
    first = envelope.proposal.options[0]
    assert first.coverage is not None
    assert first.coverage.pantry_items_used == 2
    # No pantry write: the "I don't have butter" is for this turn's context only.
    repo.upsert_pantry_item.assert_not_called()
    repo.delete_pantry_item.assert_not_called()


@pytest.mark.asyncio
async def test_the_streaming_path_the_ui_uses_answers_with_a_meal_card_too() -> None:
    # /v1/chat/stream classifies once, then resumes the dispatch graph from that state.
    _reset_graphs()
    repo = _meal_repo(
        pantry_items=[_pantry_item(n) for n in ("chickpeas", "tomato", "butter")],
        meal_plan_state=_retained(cuisine="Italian"),
    )
    ai = _options_ai(RecipeConstraints(excluded_ingredients=["butter"]))
    classifier = MagicMock()
    classifier.complete = AsyncMock(side_effect=AssertionError("classifier ran for a refinement"))
    with (
        patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=classifier)),
        patch("bubbly_chef.workflows.router.get_repository", AsyncMock(return_value=repo)),
        patch("bubbly_chef.workflows.meal.nodes.get_repository", AsyncMock(return_value=repo)),
        patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=ai)),
        patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
        patch("bubbly_chef.workflows.recipe.nodes.get_repository", AsyncMock(return_value=repo)),
        patch(
            "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
            AsyncMock(return_value=[]),
        ),
    ):
        events = [
            json.loads(chunk)
            async for chunk in run_chat_workflow_streaming(
                message="no, something quicker, I don't have butter",
                conversation_id=_CONV_ID,
                user_id="user-1",
                history=[{"role": "user", "content": "Plan dinner"}, _MEAL_TURN],
            )
        ]
    _reset_graphs()

    envelope = next(e["data"] for e in events if e["type"] == "envelope")
    assert envelope["intent"] == "meal_plan"
    assert envelope["proposal"]["proposal_type"] == "meal_options"
    assert "Max time: 30 minutes" in _option_prompt(ai)


@pytest.mark.asyncio
async def test_the_refined_constraints_are_retained_for_the_next_turn() -> None:
    retained = _retained(cuisine="Italian", excluded_ingredients=["mushrooms"])
    envelope, _, _ = await _refine(
        "no butter, something quicker",
        retained=retained,
        extracted=RecipeConstraints(excluded_ingredients=["butter"]),
    )

    assert isinstance(envelope.proposal, MealOptionsProposal)
    echoed = envelope.proposal.constraints.recipe_constraints
    assert echoed["cuisine"] == "Italian"
    assert echoed["excluded_ingredients"] == ["mushrooms", "butter"]
    assert echoed["max_time_minutes"] == 30


@pytest.mark.asyncio
async def test_i_dont_have_x_excludes_x_even_when_extraction_missed_it() -> None:
    envelope, ai, _ = await _refine(
        "I don't have butter",
        retained=_retained(cuisine="Italian"),
        extracted=RecipeConstraints(),
    )

    prompt = _option_prompt(ai)
    assert "Exclude: butter" in prompt
    pantry_line = prompt.split("Other available:", 1)[1].split("\n", 1)[0]
    assert "butter" not in pantry_line
    assert isinstance(envelope.proposal, MealOptionsProposal)


@pytest.mark.asyncio
async def test_an_explicit_contradiction_replaces_the_earlier_exclusion() -> None:
    retained = _retained(excluded_ingredients=["butter", "mushrooms"])
    envelope, ai, _ = await _refine(
        "actually, use butter",
        retained=retained,
        extracted=RecipeConstraints(preferred_ingredients=["butter"]),
    )

    prompt = _option_prompt(ai)
    assert "Exclude: mushrooms" in prompt
    assert "butter" not in prompt.split("Exclude:", 1)[1].split("\n", 1)[0]
    assert "Preferred flavors/ingredients: butter" in prompt
    assert isinstance(envelope.proposal, MealOptionsProposal)
    assert envelope.proposal.constraints.recipe_constraints["excluded_ingredients"] == ["mushrooms"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "message",
    ["actually, use butter", "actually, I do have butter", "actually butter is fine"],
)
async def test_taking_an_exclusion_back_works_even_if_extraction_misses_it(message: str) -> None:
    # The extractor returns nothing for these phrasings; the rule itself brings butter back.
    envelope, ai, _ = await _refine(
        message,
        retained=_retained(excluded_ingredients=["butter", "mushrooms"]),
        extracted=RecipeConstraints(),
    )

    prompt = _option_prompt(ai)
    exclude_line = prompt.split("Exclude:", 1)[1].split("\n", 1)[0]
    assert exclude_line.strip() == "mushrooms"
    assert isinstance(envelope.proposal, MealOptionsProposal)
    assert envelope.proposal.constraints.recipe_constraints["excluded_ingredients"] == ["mushrooms"]


@pytest.mark.asyncio
async def test_a_message_that_rules_butter_out_does_not_reinstate_it() -> None:
    envelope, _, _ = await _refine(
        "I don't have butter, use oil",
        retained=_retained(excluded_ingredients=["butter"]),
        extracted=RecipeConstraints(),
    )

    assert isinstance(envelope.proposal, MealOptionsProposal)
    assert envelope.proposal.constraints.recipe_constraints["excluded_ingredients"] == ["butter"]


@pytest.mark.asyncio
async def test_a_new_exclusion_replaces_an_earlier_want() -> None:
    retained = _retained(preferred_ingredients=["butter", "lemon"])
    envelope, ai, _ = await _refine(
        "no butter",
        retained=retained,
        extracted=RecipeConstraints(excluded_ingredients=["butter"]),
    )

    prompt = _option_prompt(ai)
    assert "Preferred flavors/ingredients: lemon" in prompt
    assert "Exclude: butter" in prompt
    assert isinstance(envelope.proposal, MealOptionsProposal)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "retained_minutes,expected",
    [(None, 30), (60, 30), (30, 20), (20, 15), (15, 15)],
)
async def test_quicker_tightens_the_saved_time_limit(
    retained_minutes: int | None, expected: int
) -> None:
    constraints = {"max_time_minutes": retained_minutes} if retained_minutes else {}
    envelope, ai, _ = await _refine(
        "something quicker",
        retained=_retained(**constraints),
        extracted=RecipeConstraints(),
    )

    assert f"Max time: {expected} minutes" in _option_prompt(ai)
    assert isinstance(envelope.proposal, MealOptionsProposal)


@pytest.mark.asyncio
async def test_an_explicit_time_in_the_message_beats_the_quicker_rule() -> None:
    _, ai, _ = await _refine(
        "something quicker, under 20 minutes",
        retained=_retained(max_time_minutes=45),
        extracted=RecipeConstraints(max_time_minutes=20),
    )

    assert "Max time: 20 minutes" in _option_prompt(ai)


@pytest.mark.asyncio
async def test_the_prompt_tells_the_model_this_is_a_refinement_of_the_meal_on_screen() -> None:
    _, ai, _ = await _refine(
        "fewer dishes",
        retained=_retained(),
        extracted=RecipeConstraints(),
    )

    prompt = _option_prompt(ai)
    assert "refining" in prompt.lower()
    assert "fewer dishes" in prompt


@pytest.mark.asyncio
async def test_pantry_opt_out_survives_a_refinement() -> None:
    _, ai, _ = await _refine(
        "something spicier",
        retained=_retained(use_pantry=False),
        extracted=RecipeConstraints(),
    )

    assert "Other available:" not in _option_prompt(ai)


# ---------------------------------------------------------------------------
# The pick message names the dish once
# ---------------------------------------------------------------------------


def _pick_state(option: MealOption) -> Any:
    return {
        "input_text": option.title,
        "user_id": "user-1",
        "context": {"meal_option_id": option.option_id},
        "session": _session(
            MealPlanSessionState(options=[option], servings=2, constraints=MealConstraintsEcho())
        ),
        "errors": [],
        "warnings": [],
    }


async def _pick_message(option: MealOption, dish_titles: list[str]) -> str:
    repo = _meal_repo(pantry_items=[_pantry_item("chickpeas")])
    results = [_recipe_llm_result(t, ["chickpeas"]) for t in dish_titles]
    ai = MagicMock()
    ai.complete = AsyncMock(side_effect=results)
    with (
        patch("bubbly_chef.workflows.meal.nodes.get_repository", AsyncMock(return_value=repo)),
        patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=ai)),
    ):
        out = await meal_pick_stage(_pick_state(option))
    message = out["assistant_message"]
    assert isinstance(message, str)
    return message


@pytest.mark.asyncio
async def test_pick_message_does_not_repeat_the_title_when_main_matches_the_option_title() -> None:
    option = MealOption(
        option_id="opt_1",
        title="Rustic Chickpea Tomato Stew",
        dishes=[
            MealDishOutline(
                role="main", name="Rustic Chickpea Tomato Stew", key_ingredients=["chickpeas"]
            )
        ],
    )
    message = await _pick_message(option, ["Rustic Chickpea Tomato Stew"])

    assert message == "Here's your Rustic Chickpea Tomato Stew!"


@pytest.mark.asyncio
async def test_pick_message_dedupes_case_insensitively_and_keeps_the_sides() -> None:
    option = MealOption(
        option_id="opt_1",
        title="Rustic Chickpea Tomato Stew",
        dishes=[
            MealDishOutline(role="main", name="Rustic Chickpea Tomato Stew"),
            MealDishOutline(role="side", name="Garlic Bread"),
            MealDishOutline(role="side", name="Green Salad"),
        ],
    )
    message = await _pick_message(
        option, ["rustic chickpea  tomato stew", "Garlic Bread", "Green Salad"]
    )

    assert message == "Here's your Rustic Chickpea Tomato Stew with Garlic Bread and Green Salad!"


@pytest.mark.asyncio
async def test_pick_message_keeps_both_names_when_they_differ() -> None:
    option = MealOption(
        option_id="opt_1",
        title="Cozy Pasta Night",
        dishes=[MealDishOutline(role="main", name="Creamy Pasta")],
    )
    message = await _pick_message(option, ["Creamy Pasta"])

    assert message == "Here's your Cozy Pasta Night: Creamy Pasta!"


@pytest.mark.parametrize(
    "text,expected",
    [
        ("actually, use butter", ["butter"]),
        ("butter is fine", ["butter"]),
        ("I do have butter", ["butter"]),
        ("go ahead and use the butter", ["butter"]),
        ("with butter please", ["butter"]),
        ("I don't have butter", []),
        ("without butter", []),
        ("no butter, use oil", []),
        ("use oil", []),
    ],
)
def test_reinstated_ingredients_reads_only_a_taking_back(text: str, expected: list[str]) -> None:
    from bubbly_chef.workflows.meal.refine import absent_ingredients, reinstated_ingredients

    assert reinstated_ingredients(text, ["butter"], absent_ingredients(text)) == expected
