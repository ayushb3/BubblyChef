"""Issue #650: generate and save a meal from chat.

Covers, through the chat workflow entry point (`run_chat_workflow` /
`classify_intent`), with the model mocked throughout — no live provider
required:

  - meal-shaped vs. named-dish routing (classifier disambiguation +
    the deterministic `context.meal_option_id` pick shortcut)
  - the option stage: three options with deterministic coverage, the
    to-buy cap, and the rescue flag
  - the pantry opt-out (issue #287)
  - the pick stage: at least one side, structured steps on every dish
  - kitchen limits becoming exclusive tags
  - an unknown option id
  - default servings (explicit / mode-of-last-3 / fallback-to-2 on error)
  - the model-unavailable error kind (issue #514's handling, reused)
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.domain.kitchen_limits import map_kitchen_limits_to_tags
from bubbly_chef.models.base import Intent, NextAction
from bubbly_chef.models.meal import (
    MealConstraintsEcho,
    MealCoverage,
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
from bubbly_chef.prompts.router import INTENT_CLASSIFICATION_SYSTEM_PROMPT
from bubbly_chef.workflows.router import classify_intent, run_chat_workflow
from bubbly_chef.workflows.state import LLMIntentResult, LLMRecipeResult

_CONV_ID = "22222222-2222-2222-2222-222222222222"


# ---------------------------------------------------------------------------
# Helpers
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


def _mock_classifier_ai(intent: str, confidence: float = 0.9) -> Any:
    """Patch `bubbly_chef.workflows.router.get_ai_manager` (classify_intent's call)."""
    llm_result = LLMIntentResult(intent=intent, confidence=confidence, reasoning="t", entities=[])
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=llm_result)
    return patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai))


def _fake_extract_recipe_constraints(constraints: dict[str, Any]):
    """A stand-in for `extract_recipe_constraints` as imported into
    `bubbly_chef.workflows.meal.nodes` -- bypasses the LLM constraint-extraction
    call entirely and just stamps the given constraints dict onto state, the
    way the real node does after its own LLM call resolves."""

    async def _fake(state: dict[str, Any]) -> dict[str, Any]:
        return {**state, "recipe_constraints": constraints}

    return AsyncMock(side_effect=_fake)


def _fake_score_pantry_ingredients(scored_items: list[dict[str, Any]] | None = None):
    async def _fake(state: dict[str, Any]) -> dict[str, Any]:
        return {**state, "scored_pantry_items": scored_items or []}

    return AsyncMock(side_effect=_fake)


def _meal_repo(
    *,
    pantry_items: list[PantryItem] | None = None,
    recent_meal_servings: list[int] | None = None,
    meal_plan_state: MealPlanSessionState | None = None,
) -> MagicMock:
    """Mock repository covering both router.py's session load/save and
    meal/nodes.py's pantry + servings + cuisine lookups."""
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
    repo.get_user_recipes = AsyncMock(return_value=[])
    return repo


def _pantry_item(
    name: str,
    *,
    expiry_days: int | None = None,
    category: FoodCategory = FoodCategory.OTHER,
) -> PantryItem:
    expiry_date = None
    if expiry_days is not None:
        expiry_date = date.today() + timedelta(days=expiry_days)
    return PantryItem(name=name, category=category, quantity=2.0, expiry_date=expiry_date)


def _dish_llm(role: str, name: str, ingredients: list[str]) -> MealDishOutlineLLM:
    return MealDishOutlineLLM(
        role=role,  # type: ignore[arg-type]
        name=name,
        key_ingredients=ingredients,
        est_total_minutes=30,
        est_hands_on_minutes=15,
    )


def _recipe_llm_result(title: str, ingredients: list[str], n_steps: int = 2) -> LLMRecipeResult:
    instructions = [f"Step {i + 1} for {title}" for i in range(n_steps)]
    steps = [StepMetadata(label=f"Step {i + 1}") for i in range(n_steps)]
    return LLMRecipeResult(
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


def _reset_graphs() -> None:
    import bubbly_chef.workflows.router as router_mod

    router_mod._chat_router_graph = None
    router_mod._chat_dispatch_graph = None


# ---------------------------------------------------------------------------
# Prompt disambiguation
# ---------------------------------------------------------------------------


class TestPromptDisambiguation:
    def test_meal_plan_bullet_present(self) -> None:
        assert "meal_plan" in INTENT_CLASSIFICATION_SYSTEM_PROMPT

    def test_meal_occasion_examples_present(self) -> None:
        for example in ("what's for dinner?", "dinner tonight", "a meal for 4"):
            assert example in INTENT_CLASSIFICATION_SYSTEM_PROMPT

    def test_named_dish_boundary_example_present(self) -> None:
        assert "a quick pasta recipe for dinner" in INTENT_CLASSIFICATION_SYSTEM_PROMPT


# ---------------------------------------------------------------------------
# Meal-shaped vs. named-dish routing
# ---------------------------------------------------------------------------


class TestRouting:
    @pytest.mark.asyncio
    async def test_meal_occasion_classifies_meal_plan(self) -> None:
        with _mock_classifier_ai("meal_plan", confidence=0.95):
            result = await classify_intent(_state(input_text="what's for dinner?"))
        assert result["intent"] == Intent.MEAL_PLAN.value

    @pytest.mark.asyncio
    async def test_named_dish_with_mealtime_classifies_recipe_generation(self) -> None:
        with _mock_classifier_ai("recipe_generation", confidence=0.95):
            result = await classify_intent(
                _state(input_text="a quick pasta recipe for dinner")
            )
        assert result["intent"] == Intent.RECIPE_GENERATION.value

    @pytest.mark.asyncio
    async def test_meal_option_id_shortcut_forces_meal_plan_no_llm(self) -> None:
        """The pick turn's message is just the option's title -- on its own it
        would read as a named dish. context.meal_option_id must short-circuit
        straight to meal_plan without ever calling the classifier LLM."""
        ai = MagicMock()
        ai.complete = AsyncMock(side_effect=AssertionError("LLM called despite meal_option_id"))
        with patch("bubbly_chef.workflows.router.get_ai_manager", MagicMock(return_value=ai)):
            result = await classify_intent(
                _state(
                    input_text="Cozy Pasta Night",
                    context={"meal_option_id": "opt_1"},
                )
            )
        assert result["intent"] == Intent.MEAL_PLAN.value
        assert result["intent_confidence"] == 1.0
        ai.complete.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_named_dish_graph_does_not_run_meal_options_stage(self) -> None:
        """Graph-level: a named-dish generation turn must reach
        generate_grounded_recipe, never meal_options_stage."""
        _reset_graphs()
        repo = _meal_repo()
        meal_spy = AsyncMock(side_effect=AssertionError("meal_options_stage ran on a named dish"))
        passthrough = AsyncMock(side_effect=lambda s: s)

        async def _fake_generate(state: dict[str, Any]) -> dict[str, Any]:
            from bubbly_chef.models.recipe import RecipeCard, RecipeCardProposal

            return {
                **state,
                "intent": Intent.RECIPE_CARD.value,
                "assistant_message": "Here is your recipe.",
                "next_action": NextAction.NONE.value,
                "requires_review": False,
                "proposal": RecipeCardProposal(recipe=RecipeCard(title="Creamy Garlic Pasta")),
            }

        with (
            _mock_classifier_ai("recipe_generation", confidence=1.0),
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch("bubbly_chef.workflows.router.extract_recipe_constraints", passthrough),
            patch("bubbly_chef.workflows.router.score_pantry_ingredients", passthrough),
            patch("bubbly_chef.workflows.router.research_recipe", passthrough),
            patch("bubbly_chef.workflows.router.generate_grounded_recipe", AsyncMock(side_effect=_fake_generate)),
            patch("bubbly_chef.workflows.router.meal_options_stage", meal_spy),
        ):
            envelope = await run_chat_workflow(
                message="a quick pasta recipe for dinner",
                conversation_id=_CONV_ID,
                user_id="user-1",
            )
        _reset_graphs()

        meal_spy.assert_not_awaited()
        assert envelope.intent == Intent.RECIPE_CARD


# ---------------------------------------------------------------------------
# Option stage: coverage, cap, rescue -- through run_chat_workflow
# ---------------------------------------------------------------------------


class TestOptionStage:
    @pytest.mark.asyncio
    async def test_three_options_with_coverage_cap_and_rescue(self) -> None:
        _reset_graphs()

        # Pantry: chicken is expiring soon (rescue candidate), rice + onion on
        # hand, salt is a staple (assumed, counts toward neither used nor to_buy).
        pantry = [
            _pantry_item("chicken breast", expiry_days=1, category=FoodCategory.MEAT),
            _pantry_item("rice", category=FoodCategory.DRY_GOODS),
            _pantry_item("onion", category=FoodCategory.PRODUCE),
        ]
        repo = _meal_repo(pantry_items=pantry)

        llm_result = MealOptionsLLMResult(
            options=[
                MealOptionLLM(
                    title="Roast Chicken Night",
                    blurb="Cozy roast chicken with rice.",
                    dishes=[
                        _dish_llm("main", "Roast Chicken", ["chicken breast", "salt"]),
                        _dish_llm("side", "Garlic Rice", ["rice", "onion"]),
                    ],
                ),
                MealOptionLLM(
                    title="Big Shop Feast",
                    blurb="Needs a proper shop.",
                    dishes=[
                        _dish_llm(
                            "main",
                            "Beef Wellington",
                            ["beef tenderloin", "puff pastry", "mushroom duxelles", "foie gras"],
                        ),
                        _dish_llm("side", "Truffle Mash", ["truffle", "potato"]),
                    ],
                ),
                MealOptionLLM(
                    title="Simple Rice Bowl",
                    blurb="Quick pantry bowl.",
                    dishes=[
                        _dish_llm("main", "Rice Bowl", ["rice", "onion"]),
                        _dish_llm("side", "Side Salad", ["lettuce", "tomato"]),
                    ],
                ),
            ]
        )
        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(return_value=llm_result)

        with (
            _mock_classifier_ai("meal_plan", confidence=0.95),
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
        ):
            envelope = await run_chat_workflow(
                message="what's for dinner?",
                conversation_id=_CONV_ID,
                user_id="user-1",
            )
        _reset_graphs()

        assert envelope.next_action == NextAction.PICK_MEAL
        proposal = envelope.proposal
        assert isinstance(proposal, MealOptionsProposal)

        # "Big Shop Feast" needed 4 to-buy items -- over the cap of 3 -- and
        # the other two options qualify, so it's dropped.
        titles = [o.title for o in proposal.options]
        assert "Big Shop Feast" not in titles
        assert len(proposal.options) == 2

        roast = next(o for o in proposal.options if o.title == "Roast Chicken Night")
        assert roast.coverage.pantry_items_used == 3  # chicken, rice, onion (salt is a staple)
        assert roast.coverage.to_buy == []
        assert "chicken breast" in roast.rescues

        # The session persisted the option set next to brainstorm_ideas (#650).
        saved = repo.update_session.await_args.args[1]
        assert saved.metadata.meal_plan is not None
        assert len(saved.metadata.meal_plan.options) == 2

    @pytest.mark.asyncio
    async def test_pantry_optout_skips_pantry_context(self) -> None:
        """issue #287: use_pantry=False must not inject pantry context, and
        must use the no-pantry system prompt."""
        _reset_graphs()
        repo = _meal_repo(pantry_items=[_pantry_item("rice")])

        llm_result = MealOptionsLLMResult(
            options=[
                MealOptionLLM(
                    title="Takeout-Style Stir Fry",
                    dishes=[
                        _dish_llm("main", "Stir Fry", ["tofu", "soy sauce", "rice"]),
                        _dish_llm("side", "Steamed Greens", ["broccoli"]),
                    ],
                ),
                # Needs far more than the to-buy cap. With the pantry ignored
                # it must still be shown, not silently dropped.
                MealOptionLLM(
                    title="Big Shop Feast",
                    dishes=[
                        _dish_llm("main", "Paella", ["saffron", "prawns", "mussels", "chorizo"]),
                        _dish_llm("side", "Aioli Toasts", ["baguette", "garlic"]),
                    ],
                ),
            ]
        )
        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(return_value=llm_result)

        from bubbly_chef.prompts.meal import MEAL_OPTIONS_SYSTEM_PROMPT_NO_PANTRY

        with (
            _mock_classifier_ai("meal_plan", confidence=0.95),
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch(
                "bubbly_chef.workflows.meal.nodes.extract_recipe_constraints",
                _fake_extract_recipe_constraints(
                    RecipeConstraints(use_pantry=False).model_dump()
                ),
            ),
            patch(
                "bubbly_chef.workflows.meal.nodes.score_pantry_ingredients",
                _fake_score_pantry_ingredients(
                    [{"name": "rice", "_score": 5}]
                ),
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=meal_ai)),
        ):
            envelope = await run_chat_workflow(
                message="don't look at my pantry, what's for dinner?",
                conversation_id=_CONV_ID,
                user_id="user-1",
            )
        _reset_graphs()

        assert envelope.next_action == NextAction.PICK_MEAL
        prompt_used = meal_ai.complete.await_args.kwargs["prompt"]
        assert MEAL_OPTIONS_SYSTEM_PROMPT_NO_PANTRY in prompt_used
        assert "rice" not in prompt_used

        # PR #659 review: the opt-out also reaches what the user sees, not just
        # the prompt. No coverage claim, no rescue chips, no cap-based drop.
        options = envelope.proposal.options  # type: ignore[union-attr]
        assert [o.title for o in options] == ["Takeout-Style Stir Fry", "Big Shop Feast"]
        assert all(o.coverage is None for o in options)
        assert all(o.rescues == [] for o in options)


# ---------------------------------------------------------------------------
# Kitchen limits -> exclusive tags
# ---------------------------------------------------------------------------


class TestKitchenLimits:
    def test_map_kitchen_limits_to_tags(self) -> None:
        tags = map_kitchen_limits_to_tags(["one pan", "no oven"])
        assert "pan" in tags
        assert "oven" in tags

    @pytest.mark.asyncio
    async def test_kitchen_limits_land_on_constraints_echo_and_prompt(self) -> None:
        _reset_graphs()
        repo = _meal_repo(pantry_items=[])

        llm_result = MealOptionsLLMResult(
            options=[
                MealOptionLLM(
                    title="One Pan Pasta Night",
                    dishes=[
                        _dish_llm("main", "One Pan Pasta", ["pasta", "tomato"]),
                        _dish_llm("side", "Garlic Bread", ["bread", "butter"]),
                    ],
                )
            ]
        )
        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(return_value=llm_result)

        with (
            _mock_classifier_ai("meal_plan", confidence=0.95),
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch(
                "bubbly_chef.workflows.meal.nodes.extract_recipe_constraints",
                _fake_extract_recipe_constraints(
                    RecipeConstraints(kitchen_limits=["one pan", "no oven"]).model_dump()
                ),
            ),
            patch(
                "bubbly_chef.workflows.meal.nodes.score_pantry_ingredients",
                _fake_score_pantry_ingredients(),
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=meal_ai)),
        ):
            envelope = await run_chat_workflow(
                message="one pan dinner, no oven, what's for dinner?",
                conversation_id=_CONV_ID,
                user_id="user-1",
            )
        _reset_graphs()

        proposal = envelope.proposal
        assert isinstance(proposal, MealOptionsProposal)
        assert "pan" in proposal.constraints.exclusive_tags
        assert "oven" in proposal.constraints.exclusive_tags
        assert proposal.constraints.kitchen_limits == ["one pan", "no oven"]

        prompt_used = meal_ai.complete.await_args.kwargs["prompt"]
        assert "one pan" in prompt_used or "no oven" in prompt_used


# ---------------------------------------------------------------------------
# Pick stage: at least one side, structured steps on every dish
# ---------------------------------------------------------------------------


class TestPickStage:
    @pytest.mark.asyncio
    async def test_pick_gives_a_side_and_structured_steps_on_every_dish(self) -> None:
        _reset_graphs()

        from bubbly_chef.models.meal import MealDishOutline

        option = MealOption(
            option_id="opt_1",
            title="Cozy Pasta Night",
            dishes=[
                MealDishOutline(role="main", name="Creamy Pasta", key_ingredients=["pasta", "cream"]),
                MealDishOutline(role="side", name="Garlic Bread", key_ingredients=["bread", "butter"]),
            ],
            coverage=MealCoverage(pantry_items_used=2, to_buy=[]),
        )
        meal_plan_state = MealPlanSessionState(
            options=[option], servings=2, constraints=MealConstraintsEcho()
        )
        repo = _meal_repo(pantry_items=[_pantry_item("pasta")], meal_plan_state=meal_plan_state)

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

        assert envelope.next_action == NextAction.REVIEW_PROPOSAL
        proposal = envelope.proposal
        assert isinstance(proposal, MealProposal)
        assert len(proposal.dishes) == 2
        roles = {d.role for d in proposal.dishes}
        assert "side" in roles  # at least one side survived expansion
        for dish in proposal.dishes:
            assert dish.recipe.steps is not None
            assert len(dish.recipe.steps) == len(dish.recipe.instructions)
        # The idempotency key POST /api/meals dedupes on (PR #659 review).
        assert len(proposal.meal_ref) == 32

    @pytest.mark.asyncio
    async def test_pick_after_pantry_optout_never_reads_or_prompts_the_pantry(self) -> None:
        """PR #659 review: the opt-out must reach the pick, not just the cards.

        The retained constraints carry use_pantry=False, so the pick must not
        read the pantry, must not put pantry items (or the grounded block's
        wording) in any dish prompt, and reports no missing ingredients.
        """
        _reset_graphs()

        from bubbly_chef.models.meal import MealDishOutline

        option = MealOption(
            option_id="opt_1",
            title="Cozy Pasta Night",
            dishes=[
                MealDishOutline(role="main", name="Creamy Pasta", key_ingredients=["pasta", "cream"]),
                MealDishOutline(role="side", name="Garlic Bread", key_ingredients=["bread", "butter"]),
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
        repo = _meal_repo(
            pantry_items=[_pantry_item("wilting spinach", expiry_days=1)],
            meal_plan_state=meal_plan_state,
        )

        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(
            side_effect=[
                _recipe_llm_result("Creamy Pasta", ["pasta", "cream"], n_steps=2),
                _recipe_llm_result("Garlic Bread", ["bread", "butter"], n_steps=1),
            ]
        )

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

        proposal = envelope.proposal
        assert isinstance(proposal, MealProposal)
        assert len(proposal.dishes) == 2
        repo.get_all_pantry_items.assert_not_awaited()
        assert proposal.missing_ingredients == []
        assert meal_ai.complete.await_count == 2
        for call in meal_ai.complete.await_args_list:
            prompt = call.kwargs["prompt"]
            assert "spinach" not in prompt
            assert "Priority ingredients" not in prompt
            assert "NOT to use their pantry" in prompt


# ---------------------------------------------------------------------------
# Unknown option id
# ---------------------------------------------------------------------------


class TestUnknownOptionId:
    @pytest.mark.asyncio
    async def test_unknown_option_id_falls_back_to_general_chat(self) -> None:
        _reset_graphs()
        meal_plan_state = MealPlanSessionState(
            options=[
                MealOption(
                    option_id="opt_1",
                    title="Cozy Pasta Night",
                    dishes=[],
                    coverage=MealCoverage(),
                )
            ],
            servings=2,
        )
        repo = _meal_repo(meal_plan_state=meal_plan_state)
        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(side_effect=AssertionError("AI called for unknown option id"))

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
                message="Some Other Meal",
                conversation_id=_CONV_ID,
                user_id="user-1",
                context={"meal_option_id": "opt_99"},
            )
        _reset_graphs()

        assert envelope.intent == Intent.GENERAL_CHAT
        assert envelope.next_action == NextAction.NONE
        meal_ai.complete.assert_not_awaited()


# ---------------------------------------------------------------------------
# Default servings
# ---------------------------------------------------------------------------


class TestDefaultServings:
    @pytest.mark.asyncio
    async def test_explicit_servings_beats_repo(self) -> None:
        _reset_graphs()
        repo = _meal_repo()
        llm_result = MealOptionsLLMResult(
            options=[
                MealOptionLLM(
                    title="Dinner for Six",
                    dishes=[
                        _dish_llm("main", "Roast", ["chicken"]),
                        _dish_llm("side", "Salad", ["lettuce"]),
                    ],
                )
            ]
        )
        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(return_value=llm_result)

        with (
            _mock_classifier_ai("meal_plan", confidence=0.95),
            patch(
                "bubbly_chef.workflows.router.get_repository",
                new_callable=AsyncMock,
                return_value=repo,
            ),
            patch(
                "bubbly_chef.workflows.meal.nodes.extract_recipe_constraints",
                _fake_extract_recipe_constraints(RecipeConstraints(servings=6).model_dump()),
            ),
            patch(
                "bubbly_chef.workflows.meal.nodes.score_pantry_ingredients",
                _fake_score_pantry_ingredients(),
            ),
            patch("bubbly_chef.workflows.meal.nodes.get_repository", new_callable=AsyncMock, return_value=repo),
            patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=meal_ai)),
        ):
            envelope = await run_chat_workflow(
                message="dinner for 6",
                conversation_id=_CONV_ID,
                user_id="user-1",
            )
        _reset_graphs()

        proposal = envelope.proposal
        assert isinstance(proposal, MealOptionsProposal)
        assert proposal.servings == 6
        repo.get_recent_meal_servings.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_mode_of_last_three_cooked_meals(self) -> None:
        _reset_graphs()
        repo = _meal_repo(recent_meal_servings=[4, 4, 2])
        llm_result = MealOptionsLLMResult(
            options=[
                MealOptionLLM(
                    title="Family Dinner",
                    dishes=[
                        _dish_llm("main", "Roast", ["chicken"]),
                        _dish_llm("side", "Salad", ["lettuce"]),
                    ],
                )
            ]
        )
        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(return_value=llm_result)

        with (
            _mock_classifier_ai("meal_plan", confidence=0.95),
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
        ):
            envelope = await run_chat_workflow(
                message="what's for dinner?",
                conversation_id=_CONV_ID,
                user_id="user-1",
            )
        _reset_graphs()

        proposal = envelope.proposal
        assert isinstance(proposal, MealOptionsProposal)
        assert proposal.servings == 4

    @pytest.mark.asyncio
    async def test_servings_falls_back_to_two_on_repo_error(self) -> None:
        _reset_graphs()
        repo = _meal_repo()
        repo.get_recent_meal_servings = AsyncMock(side_effect=RuntimeError("db down"))
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

        with (
            _mock_classifier_ai("meal_plan", confidence=0.95),
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
        ):
            envelope = await run_chat_workflow(
                message="what's for dinner?",
                conversation_id=_CONV_ID,
                user_id="user-1",
            )
        _reset_graphs()

        proposal = envelope.proposal
        assert isinstance(proposal, MealOptionsProposal)
        assert proposal.servings == 2


# ---------------------------------------------------------------------------
# Model-unavailable error kind (issue #514's handling, reused)
# ---------------------------------------------------------------------------


class TestModelUnavailable:
    @pytest.mark.asyncio
    async def test_option_stage_model_unavailable(self) -> None:
        _reset_graphs()
        repo = _meal_repo()
        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(
            side_effect=NoProviderAvailableError("no provider", kind="quota_exhausted", configured=True)
        )

        with (
            _mock_classifier_ai("meal_plan", confidence=0.95),
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
        ):
            envelope = await run_chat_workflow(
                message="what's for dinner?",
                conversation_id=_CONV_ID,
                user_id="user-1",
            )
        _reset_graphs()

        assert envelope.intent == Intent.GENERAL_CHAT
        assert envelope.next_action == NextAction.NONE
        assert envelope.assistant_message

    @pytest.mark.asyncio
    async def test_pick_stage_model_unavailable(self) -> None:
        _reset_graphs()
        from bubbly_chef.models.meal import MealDishOutline

        option = MealOption(
            option_id="opt_1",
            title="Cozy Pasta Night",
            dishes=[
                MealDishOutline(role="main", name="Creamy Pasta", key_ingredients=["pasta"]),
                MealDishOutline(role="side", name="Garlic Bread", key_ingredients=["bread"]),
            ],
            coverage=MealCoverage(),
        )
        meal_plan_state = MealPlanSessionState(options=[option], servings=2)
        repo = _meal_repo(meal_plan_state=meal_plan_state)
        meal_ai = MagicMock()
        meal_ai.complete = AsyncMock(
            side_effect=NoProviderAvailableError("no provider", kind="auth", configured=True)
        )

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

        assert envelope.intent == Intent.GENERAL_CHAT
        assert envelope.next_action == NextAction.NONE
        assert envelope.assistant_message


# ---------------------------------------------------------------------------
# Card estimates and to-buy hygiene (found in PR #659 re-verify screenshots)
# ---------------------------------------------------------------------------


class TestCardEstimatesAndToBuy:
    def test_total_is_never_less_than_summed_hands_on(self) -> None:
        """One cook: "35 min total · 40 min hands-on" can't happen."""
        from bubbly_chef.models.meal import MealDishOutline
        from bubbly_chef.workflows.meal.nodes import _meal_level_estimates

        dishes = [
            MealDishOutline(
                role="main", name="Kofta", key_ingredients=[], est_total_minutes=30,
                est_hands_on_minutes=25,
            ),
            MealDishOutline(
                role="side", name="Tabbouleh", key_ingredients=[], est_total_minutes=20,
                est_hands_on_minutes=15,
            ),
        ]
        total, hands_on = _meal_level_estimates(dishes)
        assert hands_on == 40
        assert total == 40  # was 35: longest (30) + 5

    def test_total_keeps_longest_plus_buffer_when_that_is_larger(self) -> None:
        from bubbly_chef.models.meal import MealDishOutline
        from bubbly_chef.workflows.meal.nodes import _meal_level_estimates

        dishes = [
            MealDishOutline(
                role="main", name="Roast", key_ingredients=[], est_total_minutes=60,
                est_hands_on_minutes=10,
            ),
            MealDishOutline(
                role="side", name="Salad", key_ingredients=[], est_total_minutes=10,
                est_hands_on_minutes=10,
            ),
        ]
        assert _meal_level_estimates(dishes) == (65, 20)

    def test_water_is_never_to_buy_but_coconut_water_is(self) -> None:
        from bubbly_chef.workflows.meal.nodes import _shoppable

        assert _shoppable(["water", "Boiling water", "parsley", "coconut water"]) == [
            "parsley",
            "coconut water",
        ]


@pytest.fixture(autouse=True)
def _no_stored_dietary_preferences():
    """research_recipe/refine now read the stored diet on every call (#544).

    Patch the single read seam so this suite stays hermetic (no repository
    lookup) and its assertions are about what it was written for.
    """
    with patch(
        "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
        AsyncMock(return_value=[]),
    ):
        yield
