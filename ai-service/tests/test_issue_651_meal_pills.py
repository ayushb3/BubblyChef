"""Issue #651: predictive pills for the meal_plan option and pick stages.

Covers, through the chat workflow entry point (`run_chat_workflow` /
`classify_intent`) and the pure filter helper directly, with the model
mocked throughout -- no live provider required:

  - the option stage: `follow_ups` rides the one structured call, cleaned
    into `metadata.follow_up_suggestions`
  - the pick stage: `follow_ups` rides exactly one dish's call (the main),
    via `MealDishLLMResult`
  - `_clean_meal_follow_ups`'s filter rules
  - the pantry opt-out reaching both stages' follow-ups
  - the `context.meal_followup` routing shortcut and its precedence against
    `meal_option_id`
  - the `meal_followup` inheritance branch (retained constraints, servings,
    and previously-offered titles), using the *real*
    `extract_recipe_constraints`
  - the pick-stage reply naming the expanded dishes

Stubs at the `AIManager` boundary, dispatching on the `response_schema`
kwarg for call sites that share one turn (constraint extraction vs. meal
generation), and at the repository boundary -- following
`test_issue_650_meal_from_chat.py`'s own helpers.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.base import Intent
from bubbly_chef.models.meal import (
    MealConstraintsEcho,
    MealCoverage,
    MealDishOutline,
    MealDishOutlineLLM,
    MealOption,
    MealOptionLLM,
    MealOptionsLLMResult,
    MealOptionsProposal,
    MealPlanSessionState,
    MealProposal,
)
from bubbly_chef.models.pantry import FoodCategory, PantryItem
from bubbly_chef.models.recipe import RecipeConstraints, StepMetadata
from bubbly_chef.models.session import ConversationSession, SessionContext, SessionMode
from bubbly_chef.prompts.meal import (
    MEAL_FOLLOW_UPS_NO_PANTRY_RULE,
    MEAL_OPTIONS_PREVIOUS_BLOCK,
    MEAL_OPTIONS_SYSTEM_PROMPT,
    MEAL_OPTIONS_SYSTEM_PROMPT_NO_PANTRY,
)
from bubbly_chef.workflows.meal.nodes import (
    MAX_MEAL_FOLLOW_UPS,
    MealDishLLMResult,
    _clean_meal_follow_ups,
)
from bubbly_chef.workflows.router import classify_intent, run_chat_workflow
from bubbly_chef.workflows.state import LLMRecipeResult

_CONV_ID = "33333333-3333-3333-3333-333333333333"


# ---------------------------------------------------------------------------
# Helpers (mirrors test_issue_650_meal_from_chat.py's own)
# ---------------------------------------------------------------------------


def _state(**kwargs: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "input_text": "",
        "errors": [],
        "warnings": [],
        "session_mode": None,
        "session": None,
        "conversation_history": [],
        "selected_recipe_name": None,
        "context": None,
        "forced_intent": None,
    }
    base.update(kwargs)
    return base


def _raising_classifier_ai() -> Any:
    """Patch `bubbly_chef.workflows.router.get_ai_manager` with a classifier
    that fails the test if it's ever awaited -- for the deterministic
    `meal_followup` shortcut, which must never call the LLM."""
    ai = MagicMock()
    ai.complete = AsyncMock(side_effect=AssertionError("classifier LLM called despite meal_followup"))
    return patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai))


def _fake_extract_recipe_constraints(constraints: dict[str, Any]) -> AsyncMock:
    """A stand-in for `extract_recipe_constraints` as imported into
    `bubbly_chef.workflows.meal.nodes` -- bypasses the LLM constraint-
    extraction call entirely and just stamps the given constraints dict onto
    state, the way the real node does after its own LLM call resolves."""

    async def _fake(state: dict[str, Any]) -> dict[str, Any]:
        return {**state, "recipe_constraints": constraints}

    return AsyncMock(side_effect=_fake)


def _fake_score_pantry_ingredients(scored_items: list[dict[str, Any]] | None = None) -> AsyncMock:
    async def _fake(state: dict[str, Any]) -> dict[str, Any]:
        return {**state, "scored_pantry_items": scored_items or []}

    return AsyncMock(side_effect=_fake)


def _meal_repo(
    *,
    pantry_items: list[PantryItem] | None = None,
    recent_meal_servings: list[int] | None = None,
    meal_plan_state: MealPlanSessionState | None = None,
) -> MagicMock:
    session = ConversationSession(
        conversation_id=_CONV_ID,
        active_mode=SessionMode.DEFAULT,
        metadata=SessionContext(meal_plan=meal_plan_state),
    )
    repo = MagicMock()
    repo.get_or_create_session = AsyncMock(return_value=session)
    repo.update_session = AsyncMock(return_value=None)
    repo.get_all_pantry_items = AsyncMock(return_value=pantry_items or [])
    repo.get_recent_meal_servings = AsyncMock(return_value=recent_meal_servings or [])
    repo.get_recent_cuisines = AsyncMock(return_value=[])
    return repo


def _pantry_item(name: str, *, category: FoodCategory = FoodCategory.OTHER) -> PantryItem:
    return PantryItem(name=name, category=category, quantity=2.0)


def _dish_llm(role: str, name: str, ingredients: list[str]) -> MealDishOutlineLLM:
    return MealDishOutlineLLM(
        role=role,  # type: ignore[arg-type]
        name=name,
        key_ingredients=ingredients,
        est_total_minutes=30,
        est_hands_on_minutes=15,
    )


def _recipe_llm_result(
    title: str, ingredients: list[str], *, n_steps: int = 1, follow_ups: list[str] | None = None
) -> LLMRecipeResult:
    instructions = [f"Step {i + 1} for {title}" for i in range(n_steps)]
    steps = [StepMetadata(label=f"Step {i + 1}") for i in range(n_steps)]
    kwargs: dict[str, Any] = dict(
        title=title,
        description="A tasty dish.",
        prep_time_minutes=10,
        cook_time_minutes=20,
        total_time_minutes=30,
        servings=2,
        ingredients=[{"name": ing} for ing in ingredients],
        instructions=instructions,
        steps=steps,
    )
    if follow_ups is not None:
        return MealDishLLMResult(**kwargs, follow_ups=follow_ups)
    return LLMRecipeResult(**kwargs)


def _reset_graphs() -> None:
    import bubbly_chef.workflows.router as router_mod

    router_mod._chat_router_graph = None
    router_mod._chat_dispatch_graph = None


# ---------------------------------------------------------------------------
# `_clean_meal_follow_ups`
# ---------------------------------------------------------------------------


class TestCleanMealFollowUps:
    def test_caps_at_four(self) -> None:
        raw = [f"Ask number {i}" for i in range(6)]
        cleaned = _clean_meal_follow_ups(raw, pantry_grounded=True)
        assert len(cleaned) == MAX_MEAL_FOLLOW_UPS == 4

    def test_case_insensitive_dupes_dropped(self) -> None:
        raw = ["Something lighter?", "something lighter?", "Something else"]
        cleaned = _clean_meal_follow_ups(raw, pantry_grounded=True)
        assert cleaned == ["Something lighter?", "Something else"]

    def test_over_sixty_characters_dropped(self) -> None:
        long_one = "x" * 61
        cleaned = _clean_meal_follow_ups([long_one, "Short one"], pantry_grounded=True)
        assert cleaned == ["Short one"]

    def test_app_action_wording_dropped(self) -> None:
        cleaned = _clean_meal_follow_ups(
            ["Start cooking now", "Add it to my grocery list", "Something with less prep"],
            pantry_grounded=True,
        )
        assert cleaned == ["Something with less prep"]

    def test_pantry_wording_dropped_only_when_not_grounded(self) -> None:
        raw = ["Use up the spinach in your fridge", "Can I use chicken stock instead?"]
        assert _clean_meal_follow_ups(raw, pantry_grounded=False) == [
            "Can I use chicken stock instead?"
        ]
        assert _clean_meal_follow_ups(raw, pantry_grounded=True) == raw

    def test_one_survivor_ships_as_is(self) -> None:
        assert _clean_meal_follow_ups(["Only this one"], pantry_grounded=True) == [
            "Only this one"
        ]

    def test_no_survivors_ships_empty_list_not_missing(self) -> None:
        cleaned = _clean_meal_follow_ups(["Start cooking now"], pantry_grounded=True)
        assert cleaned == []


# ---------------------------------------------------------------------------
# Option stage
# ---------------------------------------------------------------------------


class TestOptionStageFollowUps:
    @pytest.mark.asyncio
    async def test_follow_ups_ride_the_one_call_and_are_cleaned(self) -> None:
        _reset_graphs()
        repo = _meal_repo()

        llm_result = MealOptionsLLMResult(
            options=[
                MealOptionLLM(
                    title="Cozy Pasta Night",
                    dishes=[
                        _dish_llm("main", "Creamy Pasta", ["pasta", "cream"]),
                        _dish_llm("side", "Garlic Bread", ["bread", "butter"]),
                    ],
                )
            ],
            follow_ups=[
                "Something with less prep",
                "Make the pasta one vegetarian",
                "Save these options",
            ],
        )
        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(return_value=llm_result)

        with (
            _raising_classifier_ai(),
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch(
                "bubbly_chef.workflows.meal.nodes.extract_recipe_constraints",
                _fake_extract_recipe_constraints(RecipeConstraints().model_dump()),
            ),
            patch(
                "bubbly_chef.workflows.meal.nodes.score_pantry_ingredients",
                _fake_score_pantry_ingredients(),
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=meal_ai)),
            patch("bubbly_chef.workflows.router.suggest_follow_ups", AsyncMock(side_effect=AssertionError("suggest_follow_ups called for meal_plan"))) as spy,
        ):
            envelope = await run_chat_workflow(
                message="what's for dinner?",
                conversation_id=_CONV_ID,
                user_id="user-1",
                context={"meal_followup": True},
            )
        _reset_graphs()

        assert isinstance(envelope.proposal, MealOptionsProposal)
        assert envelope.metadata["follow_up_suggestions"] == [
            "Something with less prep",
            "Make the pasta one vegetarian",
        ]
        assert meal_ai.complete.await_count == 1
        assert meal_ai.complete.await_args.kwargs["response_schema"] is MealOptionsLLMResult
        spy.assert_not_awaited()


# ---------------------------------------------------------------------------
# Pick stage
# ---------------------------------------------------------------------------


class TestPickStageFollowUps:
    def _option(self) -> MealOption:
        return MealOption(
            option_id="opt_1",
            title="Cozy Pasta Night",
            dishes=[
                MealDishOutline(role="main", name="Creamy Pasta", key_ingredients=["pasta", "cream"]),
                MealDishOutline(role="side", name="Garlic Bread", key_ingredients=["bread", "butter"]),
            ],
            coverage=MealCoverage(pantry_items_used=2, to_buy=[]),
        )

    @pytest.mark.asyncio
    async def test_main_dish_carries_cleaned_pills_side_does_not(self) -> None:
        _reset_graphs()
        option = self._option()
        meal_plan_state = MealPlanSessionState(
            options=[option], servings=2, constraints=MealConstraintsEcho()
        )
        repo = _meal_repo(pantry_items=[_pantry_item("pasta")], meal_plan_state=meal_plan_state)

        main_result = _recipe_llm_result(
            "Creamy Pasta",
            ["pasta", "cream"],
            n_steps=2,
            follow_ups=["Can I prep any of this ahead?", "What should I start first?", "save this"],
        )
        side_result = _recipe_llm_result("Garlic Bread", ["bread", "butter"], n_steps=1)

        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(side_effect=[main_result, side_result])

        with (
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=meal_ai)),
        ):
            envelope = await run_chat_workflow(
                message="Cozy Pasta Night",
                conversation_id=_CONV_ID,
                user_id="user-1",
                context={"meal_option_id": "opt_1"},
            )
        _reset_graphs()

        assert meal_ai.complete.await_count == 2
        schemas = [c.kwargs["response_schema"] for c in meal_ai.complete.await_args_list]
        assert schemas == [MealDishLLMResult, LLMRecipeResult]
        # The main-dish call's prompt names the main dish itself.
        main_call_prompt = meal_ai.complete.await_args_list[0].kwargs["prompt"]
        assert "Creamy Pasta" in main_call_prompt

        assert envelope.metadata["follow_up_suggestions"] == [
            "Can I prep any of this ahead?",
            "What should I start first?",
        ]

        proposal = envelope.proposal
        assert isinstance(proposal, MealProposal)
        dumped = proposal.model_dump(mode="json")
        for dish in dumped["dishes"]:
            assert "follow_ups" not in dish["recipe"]

    @pytest.mark.asyncio
    async def test_plain_llmrecipe_result_on_main_degrades_to_no_pills(self) -> None:
        """Compatibility: an old stub / non-complying provider returning
        plain `LLMRecipeResult` for the main gives `follow_up_suggestions
        == []`, and the meal still builds."""
        _reset_graphs()
        option = self._option()
        meal_plan_state = MealPlanSessionState(options=[option], servings=2)
        repo = _meal_repo(meal_plan_state=meal_plan_state)

        main_result = _recipe_llm_result("Creamy Pasta", ["pasta", "cream"], n_steps=2)
        side_result = _recipe_llm_result("Garlic Bread", ["bread", "butter"], n_steps=1)
        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(side_effect=[main_result, side_result])

        with (
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=meal_ai)),
        ):
            envelope = await run_chat_workflow(
                message="Cozy Pasta Night",
                conversation_id=_CONV_ID,
                user_id="user-1",
                context={"meal_option_id": "opt_1"},
            )
        _reset_graphs()

        assert envelope.metadata["follow_up_suggestions"] == []
        assert isinstance(envelope.proposal, MealProposal)
        assert len(envelope.proposal.dishes) == 2

    @pytest.mark.asyncio
    async def test_reply_names_the_dishes_two_sides(self) -> None:
        _reset_graphs()
        option = MealOption(
            option_id="opt_1",
            title="Family Roast Night",
            dishes=[
                MealDishOutline(role="main", name="Herb Roast Chicken", key_ingredients=["chicken"]),
                MealDishOutline(role="side", name="Garlic Mash", key_ingredients=["potato"]),
                MealDishOutline(role="side", name="Green Beans", key_ingredients=["beans"]),
            ],
            coverage=MealCoverage(),
        )
        meal_plan_state = MealPlanSessionState(options=[option], servings=4)
        repo = _meal_repo(meal_plan_state=meal_plan_state)

        results = [
            _recipe_llm_result("Herb Roast Chicken", ["chicken"], follow_ups=["Question?"]),
            _recipe_llm_result("Garlic Mash", ["potato"]),
            _recipe_llm_result("Green Beans", ["beans"]),
        ]
        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(side_effect=results)

        with (
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=meal_ai)),
        ):
            envelope = await run_chat_workflow(
                message="Family Roast Night",
                conversation_id=_CONV_ID,
                user_id="user-1",
                context={"meal_option_id": "opt_1"},
            )
        _reset_graphs()

        assert envelope.assistant_message == (
            "Here's your Family Roast Night: Herb Roast Chicken with "
            "Garlic Mash and Green Beans!"
        )

    @pytest.mark.asyncio
    async def test_reply_names_the_dishes_one_side(self) -> None:
        _reset_graphs()
        option = self._option()  # main + one side
        meal_plan_state = MealPlanSessionState(options=[option], servings=2)
        repo = _meal_repo(meal_plan_state=meal_plan_state)

        results = [
            _recipe_llm_result("Creamy Pasta", ["pasta"], follow_ups=["Question?"]),
            _recipe_llm_result("Garlic Bread", ["bread"]),
        ]
        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(side_effect=results)

        with (
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=meal_ai)),
        ):
            envelope = await run_chat_workflow(
                message="Cozy Pasta Night",
                conversation_id=_CONV_ID,
                user_id="user-1",
                context={"meal_option_id": "opt_1"},
            )
        _reset_graphs()

        assert envelope.assistant_message == (
            "Here's your Cozy Pasta Night: Creamy Pasta with Garlic Bread!"
        )


# ---------------------------------------------------------------------------
# The pantry opt-out fixture (both stages)
# ---------------------------------------------------------------------------


class TestPantryOptOutFollowUps:
    @pytest.mark.asyncio
    async def test_option_stage_no_pantry_rule_present_and_filters_pantry_wording(self) -> None:
        _reset_graphs()
        repo = _meal_repo()

        llm_result = MealOptionsLLMResult(
            options=[
                MealOptionLLM(
                    title="Takeout-Style Stir Fry",
                    dishes=[
                        _dish_llm("main", "Stir Fry", ["tofu", "soy sauce"]),
                        _dish_llm("side", "Steamed Greens", ["broccoli"]),
                    ],
                )
            ],
            follow_ups=["Use up the spinach in your fridge", "Can I use chicken stock instead?"],
        )
        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(return_value=llm_result)

        with (
            _raising_classifier_ai(),
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch(
                "bubbly_chef.workflows.meal.nodes.extract_recipe_constraints",
                _fake_extract_recipe_constraints(RecipeConstraints(use_pantry=False).model_dump()),
            ),
            patch(
                "bubbly_chef.workflows.meal.nodes.score_pantry_ingredients",
                _fake_score_pantry_ingredients(),
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=meal_ai)),
        ):
            envelope = await run_chat_workflow(
                message="don't look at my pantry, what's for dinner?",
                conversation_id=_CONV_ID,
                user_id="user-1",
                context={"meal_followup": True},
            )
        _reset_graphs()

        prompt_used = meal_ai.complete.await_args.kwargs["prompt"]
        assert MEAL_FOLLOW_UPS_NO_PANTRY_RULE in prompt_used
        assert envelope.metadata["follow_up_suggestions"] == ["Can I use chicken stock instead?"]

    @pytest.mark.asyncio
    async def test_pick_stage_no_pantry_rule_present_and_filters_pantry_wording(self) -> None:
        _reset_graphs()
        option = MealOption(
            option_id="opt_1",
            title="Cozy Pasta Night",
            dishes=[
                MealDishOutline(role="main", name="Creamy Pasta", key_ingredients=["pasta"]),
                MealDishOutline(role="side", name="Garlic Bread", key_ingredients=["bread"]),
            ],
            coverage=None,
        )
        meal_plan_state = MealPlanSessionState(
            options=[option],
            servings=2,
            constraints=MealConstraintsEcho(
                recipe_constraints=RecipeConstraints(use_pantry=False).model_dump()
            ),
        )
        repo = _meal_repo(meal_plan_state=meal_plan_state)

        main_result = _recipe_llm_result(
            "Creamy Pasta",
            ["pasta"],
            follow_ups=["Use up the spinach in your fridge", "Can I use chicken stock instead?"],
        )
        side_result = _recipe_llm_result("Garlic Bread", ["bread"])
        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(side_effect=[main_result, side_result])

        with (
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=meal_ai)),
        ):
            envelope = await run_chat_workflow(
                message="Cozy Pasta Night",
                conversation_id=_CONV_ID,
                user_id="user-1",
                context={"meal_option_id": "opt_1"},
            )
        _reset_graphs()

        main_call_prompt = meal_ai.complete.await_args_list[0].kwargs["prompt"]
        assert MEAL_FOLLOW_UPS_NO_PANTRY_RULE in main_call_prompt
        assert envelope.metadata["follow_up_suggestions"] == ["Can I use chicken stock instead?"]


# ---------------------------------------------------------------------------
# `meal_followup` routing
# ---------------------------------------------------------------------------


class TestMealFollowupRouting:
    @pytest.mark.asyncio
    async def test_meal_followup_true_forces_meal_plan_no_llm(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(side_effect=AssertionError("LLM called despite meal_followup"))
        with patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai)):
            result = await classify_intent(
                _state(input_text="Something quicker, under 30 minutes", context={"meal_followup": True})
            )
        assert result["intent"] == Intent.MEAL_PLAN.value
        assert result["intent_confidence"] == 1.0
        ai.complete.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_meal_followup_true_holds_in_cooking_mode(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(side_effect=AssertionError("LLM called despite meal_followup"))
        with patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai)):
            result = await classify_intent(
                _state(
                    input_text="Something quicker",
                    context={"meal_followup": True},
                    session_mode=SessionMode.COOKING.value,
                )
            )
        assert result["intent"] == Intent.MEAL_PLAN.value

    @pytest.mark.asyncio
    async def test_meal_followup_true_holds_with_picked_recipe_in_session(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(side_effect=AssertionError("LLM called despite meal_followup"))
        with patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai)):
            result = await classify_intent(
                _state(
                    input_text="Something quicker",
                    context={"meal_followup": True},
                    session={"metadata": {"picked_recipe": {"title": "Some Pinned Recipe"}}},
                )
            )
        assert result["intent"] == Intent.MEAL_PLAN.value

    @pytest.mark.asyncio
    async def test_string_true_is_not_honoured(self) -> None:
        with _mock_classifier_ai_recipe_generation():
            result = await classify_intent(
                _state(input_text="Something quicker", context={"meal_followup": "true"})
            )
        assert result["intent"] != Intent.MEAL_PLAN.value or result.get("intent_reasoning") != (
            "Meal follow-up pill — context.meal_followup present"
        )

    @pytest.mark.asyncio
    async def test_meal_option_id_wins_over_meal_followup(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(side_effect=AssertionError("LLM called"))
        with patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai)):
            result = await classify_intent(
                _state(
                    input_text="Cozy Pasta Night",
                    context={"meal_option_id": "opt_1", "meal_followup": True},
                )
            )
        assert result["intent"] == Intent.MEAL_PLAN.value
        assert result["intent_reasoning"] == "Meal option pick — context.meal_option_id present"

    @pytest.mark.asyncio
    async def test_graph_routes_meal_followup_to_options_stage_not_pick(self) -> None:
        _reset_graphs()
        repo = _meal_repo()
        llm_result = MealOptionsLLMResult(
            options=[
                MealOptionLLM(
                    title="Simple Dinner",
                    dishes=[
                        _dish_llm("main", "Pasta", ["pasta"]),
                        _dish_llm("side", "Salad", ["lettuce"]),
                    ],
                )
            ]
        )
        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(return_value=llm_result)
        pick_spy = AsyncMock(side_effect=AssertionError("meal_pick_stage ran on a meal_followup turn"))

        with (
            _raising_classifier_ai(),
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch(
                "bubbly_chef.workflows.meal.nodes.extract_recipe_constraints",
                _fake_extract_recipe_constraints(RecipeConstraints().model_dump()),
            ),
            patch(
                "bubbly_chef.workflows.meal.nodes.score_pantry_ingredients",
                _fake_score_pantry_ingredients(),
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=meal_ai)),
            patch("bubbly_chef.workflows.router.meal_pick_stage", pick_spy),
        ):
            envelope = await run_chat_workflow(
                message="Something quicker, under 30 minutes",
                conversation_id=_CONV_ID,
                user_id="user-1",
                context={"meal_followup": True},
            )
        _reset_graphs()

        pick_spy.assert_not_awaited()
        assert isinstance(envelope.proposal, MealOptionsProposal)


def _mock_classifier_ai_recipe_generation() -> Any:
    from bubbly_chef.workflows.state import LLMIntentResult

    llm_result = LLMIntentResult(
        intent="recipe_generation", confidence=0.9, reasoning="t", entities=[]
    )
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=llm_result)
    return patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai))


# ---------------------------------------------------------------------------
# `meal_followup` inheritance -- real `extract_recipe_constraints`
# ---------------------------------------------------------------------------


class TestMealFollowupInheritance:
    def _dispatching_ai(self, responses: dict[type, Any]) -> MagicMock:
        async def _complete(*, prompt: str, response_schema: type, temperature: float = 0.7) -> Any:
            if response_schema not in responses:
                raise AssertionError(f"Unexpected response_schema {response_schema!r}")
            value = responses[response_schema]
            if isinstance(value, BaseException):
                raise value
            return value

        ai = MagicMock()
        ai.complete = AsyncMock(side_effect=_complete)
        return ai

    def _retained_state(self) -> MealPlanSessionState:
        options = [
            MealOption(
                option_id="opt_1",
                title="Cozy Pasta Night",
                dishes=[
                    MealDishOutline(role="main", name="Creamy Pasta", key_ingredients=["pasta"]),
                    MealDishOutline(role="side", name="Garlic Bread", key_ingredients=["bread"]),
                ],
                coverage=None,
            ),
            MealOption(
                option_id="opt_2",
                title="Big Roast Night",
                dishes=[
                    MealDishOutline(role="main", name="Roast Chicken", key_ingredients=["chicken"]),
                    MealDishOutline(role="side", name="Mash", key_ingredients=["potato"]),
                ],
                coverage=None,
            ),
            MealOption(
                option_id="opt_3",
                title="Simple Rice Bowl",
                dishes=[
                    MealDishOutline(role="main", name="Rice Bowl", key_ingredients=["rice"]),
                    MealDishOutline(role="side", name="Side Salad", key_ingredients=["lettuce"]),
                ],
                coverage=None,
            ),
        ]
        return MealPlanSessionState(
            options=options,
            servings=4,
            constraints=MealConstraintsEcho(
                recipe_constraints=RecipeConstraints(
                    servings=4, dietary=["vegetarian"], kitchen_limits=["one pan"]
                ).model_dump()
            ),
        )

    @pytest.mark.asyncio
    async def test_case_1_inherits_constraints_servings_and_previous_titles(self) -> None:
        _reset_graphs()
        retained = self._retained_state()
        repo = _meal_repo(meal_plan_state=retained)

        fresh_constraints = RecipeConstraints(max_time_minutes=30)
        option_llm_result = MealOptionsLLMResult(
            options=[
                MealOptionLLM(
                    title="Quick Pasta Night",
                    dishes=[
                        _dish_llm("main", "Quick Pasta", ["pasta"]),
                        _dish_llm("side", "Side Salad", ["lettuce"]),
                    ],
                )
            ]
        )
        ai = self._dispatching_ai(
            {RecipeConstraints: fresh_constraints, MealOptionsLLMResult: option_llm_result}
        )

        with (
            _raising_classifier_ai(),
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=ai)),
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            patch(
                "bubbly_chef.workflows.recipe.nodes.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch(
                "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
                AsyncMock(return_value=[]),
            ),
        ):
            envelope = await run_chat_workflow(
                message="Something quicker, under 30 minutes",
                conversation_id=_CONV_ID,
                user_id="user-1",
                context={"meal_followup": True},
            )
        _reset_graphs()

        option_call = next(
            c for c in ai.complete.await_args_list if c.kwargs["response_schema"] is MealOptionsLLMResult
        )
        prompt_used = option_call.kwargs["prompt"]
        assert "Dietary: vegetarian" in prompt_used
        assert "Kitchen limits: one pan" in prompt_used
        assert "Max time: 30 minutes" in prompt_used

        assert MEAL_OPTIONS_PREVIOUS_BLOCK.split("{options}")[0] in prompt_used
        for title in ("Cozy Pasta Night", "Big Roast Night", "Simple Rice Bowl"):
            assert title in prompt_used
        for dish_name in ("Creamy Pasta", "Garlic Bread", "Roast Chicken", "Mash", "Rice Bowl", "Side Salad"):
            assert dish_name in prompt_used

        cuisine_idx = prompt_used.find("cuisines")
        previous_idx = prompt_used.find("Already suggested")
        user_idx = prompt_used.rfind("\n\nUser:")
        assert previous_idx > 0
        assert previous_idx < user_idx
        # previous block is placed after the cuisine hint when present, and
        # always before "User:" — cuisine hint may be absent here (no recent
        # cuisines stubbed), so only the ordering vs. "User:" is load-bearing.
        if cuisine_idx > 0:
            assert cuisine_idx < previous_idx

        proposal = envelope.proposal
        assert isinstance(proposal, MealOptionsProposal)
        assert proposal.servings == 4

    @pytest.mark.asyncio
    async def test_case_2_dietary_and_excluded_ingredients_union(self) -> None:
        _reset_graphs()
        retained = MealPlanSessionState(
            options=[
                MealOption(
                    option_id="opt_1",
                    title="Cozy Pasta Night",
                    dishes=[
                        MealDishOutline(role="main", name="Creamy Pasta", key_ingredients=["pasta"]),
                        MealDishOutline(role="side", name="Garlic Bread", key_ingredients=["bread"]),
                    ],
                    coverage=None,
                )
            ],
            servings=2,
            constraints=MealConstraintsEcho(
                recipe_constraints=RecipeConstraints(
                    dietary=["gluten-free"], excluded_ingredients=["mushroom"]
                ).model_dump()
            ),
        )
        repo = _meal_repo(meal_plan_state=retained)

        fresh_constraints = RecipeConstraints(dietary=["vegetarian"], excluded_ingredients=["onion"])
        option_llm_result = MealOptionsLLMResult(
            options=[
                MealOptionLLM(
                    title="Veggie Pasta Night",
                    dishes=[
                        _dish_llm("main", "Veggie Pasta", ["pasta"]),
                        _dish_llm("side", "Side Salad", ["lettuce"]),
                    ],
                )
            ]
        )
        ai = self._dispatching_ai(
            {RecipeConstraints: fresh_constraints, MealOptionsLLMResult: option_llm_result}
        )

        with (
            _raising_classifier_ai(),
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=ai)),
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            patch(
                "bubbly_chef.workflows.recipe.nodes.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch(
                "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
                AsyncMock(return_value=[]),
            ),
        ):
            envelope = await run_chat_workflow(
                message="Make it vegetarian, and no onion",
                conversation_id=_CONV_ID,
                user_id="user-1",
                context={"meal_followup": True},
            )
        _reset_graphs()

        option_call = next(
            c for c in ai.complete.await_args_list if c.kwargs["response_schema"] is MealOptionsLLMResult
        )
        prompt_used = option_call.kwargs["prompt"]
        assert "gluten-free" in prompt_used
        assert "vegetarian" in prompt_used
        assert "mushroom" in prompt_used
        assert "onion" in prompt_used
        assert isinstance(envelope.proposal, MealOptionsProposal)

    @pytest.mark.asyncio
    async def test_without_stamp_retained_constraints_are_not_used(self) -> None:
        """Same retained state, same message, but no `meal_followup` stamp --
        the retained dietary/kitchen-limits must NOT reach the prompt."""
        _reset_graphs()
        retained = self._retained_state()
        repo = _meal_repo(meal_plan_state=retained)

        fresh_constraints = RecipeConstraints(max_time_minutes=30)
        option_llm_result = MealOptionsLLMResult(
            options=[
                MealOptionLLM(
                    title="Quick Pasta Night",
                    dishes=[
                        _dish_llm("main", "Quick Pasta", ["pasta"]),
                        _dish_llm("side", "Side Salad", ["lettuce"]),
                    ],
                )
            ]
        )
        ai = self._dispatching_ai(
            {RecipeConstraints: fresh_constraints, MealOptionsLLMResult: option_llm_result}
        )

        with (
            _mock_classifier_ai_recipe_generation_as_meal_plan(),
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=ai)),
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            patch(
                "bubbly_chef.workflows.recipe.nodes.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch(
                "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
                AsyncMock(return_value=[]),
            ),
        ):
            envelope = await run_chat_workflow(
                message="Something quicker, under 30 minutes",
                conversation_id=_CONV_ID,
                user_id="user-1",
                # No context at all -- not a meal_followup turn.
            )
        _reset_graphs()

        option_call = next(
            c for c in ai.complete.await_args_list if c.kwargs["response_schema"] is MealOptionsLLMResult
        )
        prompt_used = option_call.kwargs["prompt"]
        # "vegetarian" and "one pan" appear in MEAL_OPTIONS_FOLLOW_UPS_RULES's
        # own example text regardless of the stamp -- the load-bearing check
        # is that the *constraints block* naming them is absent.
        assert "Dietary: vegetarian" not in prompt_used
        assert "Kitchen limits: one pan" not in prompt_used
        assert "Already suggested" not in prompt_used
        assert isinstance(envelope.proposal, MealOptionsProposal)
        # No explicit/retained servings signal without the stamp -- falls to
        # _default_servings (2, since get_recent_meal_servings is []).
        assert envelope.proposal.servings == 2

    @pytest.mark.asyncio
    async def test_retained_meal_type_survives_a_turn_that_doesnt_restate_it(self) -> None:
        """Review blocker: a stamped turn must keep a retained meal_type just
        because this turn's message didn't restate it -- `extract_recipe_
        constraints` must run against the retained value as its prior, not a
        pure fresh extraction."""
        _reset_graphs()
        retained = MealPlanSessionState(
            options=[
                MealOption(
                    option_id="opt_1",
                    title="Cozy Pasta Night",
                    dishes=[
                        MealDishOutline(role="main", name="Creamy Pasta", key_ingredients=["pasta"]),
                        MealDishOutline(role="side", name="Garlic Bread", key_ingredients=["bread"]),
                    ],
                    coverage=None,
                )
            ],
            servings=2,
            constraints=MealConstraintsEcho(
                recipe_constraints=RecipeConstraints(meal_type="dinner").model_dump()
            ),
        )
        repo = _meal_repo(meal_plan_state=retained)

        fresh_constraints = RecipeConstraints(max_time_minutes=30)  # no meal_type this turn
        option_llm_result = MealOptionsLLMResult(
            options=[
                MealOptionLLM(
                    title="Quick Pasta Night",
                    dishes=[
                        _dish_llm("main", "Quick Pasta", ["pasta"]),
                        _dish_llm("side", "Side Salad", ["lettuce"]),
                    ],
                )
            ]
        )
        ai = self._dispatching_ai(
            {RecipeConstraints: fresh_constraints, MealOptionsLLMResult: option_llm_result}
        )

        with (
            _raising_classifier_ai(),
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=ai)),
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            patch(
                "bubbly_chef.workflows.recipe.nodes.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch(
                "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
                AsyncMock(return_value=[]),
            ),
        ):
            envelope = await run_chat_workflow(
                message="Something quicker, under 30 minutes",
                conversation_id=_CONV_ID,
                user_id="user-1",
                context={"meal_followup": True},
            )
        _reset_graphs()

        option_call = next(
            c for c in ai.complete.await_args_list if c.kwargs["response_schema"] is MealOptionsLLMResult
        )
        prompt_used = option_call.kwargs["prompt"]
        assert "Meal type: dinner" in prompt_used
        assert "Meal type: lunch" not in prompt_used
        assert isinstance(envelope.proposal, MealOptionsProposal)

    @pytest.mark.asyncio
    async def test_fresh_request_contradicting_retained_diet_sets_it_aside(self) -> None:
        """Review should-fix: the union must not re-add a retained diet the
        fresh request contradicts -- reuses #394's
        `_combine_dietary_preferences` "set aside for this reply" logic."""
        _reset_graphs()
        retained = MealPlanSessionState(
            options=[
                MealOption(
                    option_id="opt_1",
                    title="Veggie Pasta Night",
                    dishes=[
                        MealDishOutline(role="main", name="Veggie Pasta", key_ingredients=["pasta"]),
                        MealDishOutline(role="side", name="Side Salad", key_ingredients=["lettuce"]),
                    ],
                    coverage=None,
                )
            ],
            servings=2,
            constraints=MealConstraintsEcho(
                recipe_constraints=RecipeConstraints(dietary=["vegetarian"]).model_dump()
            ),
        )
        repo = _meal_repo(meal_plan_state=retained)

        # The fresh extraction itself doesn't need to name a dietary change --
        # the contradiction check also scans input_text (#394's own haystack).
        fresh_constraints = RecipeConstraints()
        option_llm_result = MealOptionsLLMResult(
            options=[
                MealOptionLLM(
                    title="Chicken Pasta Night",
                    dishes=[
                        _dish_llm("main", "Chicken Pasta", ["pasta", "chicken"]),
                        _dish_llm("side", "Side Salad", ["lettuce"]),
                    ],
                )
            ]
        )
        ai = self._dispatching_ai(
            {RecipeConstraints: fresh_constraints, MealOptionsLLMResult: option_llm_result}
        )

        with (
            _raising_classifier_ai(),
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=ai)),
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            patch(
                "bubbly_chef.workflows.recipe.nodes.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch(
                "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
                AsyncMock(return_value=[]),
            ),
        ):
            envelope = await run_chat_workflow(
                message="Put chicken in the pasta one",
                conversation_id=_CONV_ID,
                user_id="user-1",
                context={"meal_followup": True},
            )
        _reset_graphs()

        option_call = next(
            c for c in ai.complete.await_args_list if c.kwargs["response_schema"] is MealOptionsLLMResult
        )
        prompt_used = option_call.kwargs["prompt"]
        # vegetarian is set aside for this reply -- no Dietary line at all,
        # since the fresh side didn't ask for a diet either.
        assert "Dietary:" not in prompt_used
        assert isinstance(envelope.proposal, MealOptionsProposal)

    @pytest.mark.asyncio
    async def test_retained_pantry_optout_survives_a_followup_that_doesnt_restate_it(self) -> None:
        """Test gap: a retained `use_pantry: False` must still be honoured
        on a `meal_followup` turn whose own extraction says nothing about
        the pantry either way (`use_pantry: None`) -- the no-pantry system
        prompt and pill rule apply, and the pantry is never read."""
        _reset_graphs()
        retained = MealPlanSessionState(
            options=[
                MealOption(
                    option_id="opt_1",
                    title="Takeout-Style Stir Fry",
                    dishes=[
                        MealDishOutline(role="main", name="Stir Fry", key_ingredients=["tofu"]),
                        MealDishOutline(role="side", name="Steamed Greens", key_ingredients=["broccoli"]),
                    ],
                    coverage=None,
                )
            ],
            servings=2,
            constraints=MealConstraintsEcho(
                recipe_constraints=RecipeConstraints(use_pantry=False).model_dump()
            ),
        )
        repo = _meal_repo(pantry_items=[_pantry_item("rice")], meal_plan_state=retained)

        # "Make it vegetarian" -- the extraction says nothing about the
        # pantry either way (use_pantry defaults to None).
        fresh_constraints = RecipeConstraints(dietary=["vegetarian"])
        assert fresh_constraints.use_pantry is None
        option_llm_result = MealOptionsLLMResult(
            options=[
                MealOptionLLM(
                    title="Veggie Stir Fry",
                    dishes=[
                        _dish_llm("main", "Veggie Stir Fry", ["tofu"]),
                        _dish_llm("side", "Steamed Greens", ["broccoli"]),
                    ],
                )
            ]
        )
        ai = self._dispatching_ai(
            {RecipeConstraints: fresh_constraints, MealOptionsLLMResult: option_llm_result}
        )

        with (
            _raising_classifier_ai(),
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=ai)),
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            patch(
                "bubbly_chef.workflows.recipe.nodes.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch(
                "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
                AsyncMock(return_value=[]),
            ),
        ):
            envelope = await run_chat_workflow(
                message="Make it vegetarian",
                conversation_id=_CONV_ID,
                user_id="user-1",
                context={"meal_followup": True},
            )
        _reset_graphs()

        option_call = next(
            c for c in ai.complete.await_args_list if c.kwargs["response_schema"] is MealOptionsLLMResult
        )
        prompt_used = option_call.kwargs["prompt"]
        assert MEAL_OPTIONS_SYSTEM_PROMPT_NO_PANTRY in prompt_used
        assert MEAL_FOLLOW_UPS_NO_PANTRY_RULE in prompt_used
        assert MEAL_OPTIONS_SYSTEM_PROMPT not in prompt_used
        repo.get_all_pantry_items.assert_not_awaited()
        assert isinstance(envelope.proposal, MealOptionsProposal)


def _mock_classifier_ai_recipe_generation_as_meal_plan() -> Any:
    from bubbly_chef.workflows.state import LLMIntentResult

    llm_result = LLMIntentResult(intent="meal_plan", confidence=0.95, reasoning="t", entities=[])
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=llm_result)
    return patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai))
