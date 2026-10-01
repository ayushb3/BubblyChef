"""Issue #500 (Spec B.8): profile allergies are a hard "never suggest"; dislikes are a
soft "leave out". Both reach generation and chat as exclusions.

Covers, with the model mocked throughout (no live provider):

  - the allergen matcher (plural, broad labels, `-free`, false friends)
  - the profile read (missing columns, DB errors, allergy beats dislike)
  - the post-generation guard: a mocked provider that TRIES to return peanuts is
    regenerated once, then refused honestly, on every path that returns a card
    (grounded chat card, chat/library refine, /v1/recipes/generate, meal options,
    meal dishes, side alternatives) and on brainstorm ideas
  - precedence: "do it anyway" never overrides an allergy, does override a dislike
  - rendered-prompt tests: the "NEVER include (allergy)" line reaches brainstorm,
    card, refine, cooking-help, general chat and the meal prompts
  - the session never persists profile-origin exclusions
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from bubbly_chef.domain.allergens import allergen_terms, allergens_named, drop_naming_allergen
from bubbly_chef.models.base import Intent, NextAction
from bubbly_chef.models.meal import (
    MealConstraintsEcho,
    MealDishOutline,
    MealDishOutlineLLM,
    MealOption,
    MealOptionLLM,
    MealOptionsLLMResult,
    MealPlanSessionState,
    MealSideAlternativesLLMResult,
)
from bubbly_chef.models.recipe import RecipeCard, RecipeConstraints
from bubbly_chef.services.allergen_guard import (
    AllergenViolation,
    allergen_refusal_message,
    generate_allergen_safe,
)
from bubbly_chef.services.food_exclusions import (
    FoodExclusions,
    allergy_never_block,
    get_stored_food_exclusions,
)
from bubbly_chef.services.recipe_generator import AIRecipeIngredient, AIRecipeOutput
from bubbly_chef.workflows.chat.nodes import (
    _build_cooking_prompt,
    _build_react_initial_message,
    format_dietary_context,
)
from bubbly_chef.workflows.recipe.exclusions import apply_food_exclusions, asks_for
from bubbly_chef.workflows.recipe.nodes import (
    brainstorm_recipe_ideas,
    constraints_to_persist,
    extract_recipe_constraints,
    generate_grounded_recipe,
    refine_dietary_constraints,
    refine_recipe_node,
    score_and_rank,
)
from bubbly_chef.workflows.state import LLMRecipeResult

PEANUT = FoodExclusions(allergies=("peanut",))
USER = "user-500"


def _exclusions(allergies: tuple[str, ...] = (), dislikes: tuple[str, ...] = ()) -> Any:
    """Patch the profile read everywhere it's imported."""
    value = FoodExclusions(allergies=allergies, dislikes=dislikes)
    return [
        patch(f"bubbly_chef.workflows.{mod}.get_stored_food_exclusions", AsyncMock(return_value=value))
        for mod in ("recipe.nodes", "chat.nodes", "meal.nodes", "meal.sides")
    ] + [
        patch(
            "bubbly_chef.api.routes.recipes_ai.get_stored_food_exclusions",
            AsyncMock(return_value=value),
        )
    ]


class _Patched:
    def __init__(self, patches: list[Any]) -> None:
        self._patches = patches

    def __enter__(self) -> "_Patched":
        for p in self._patches:
            p.start()
        return self

    def __exit__(self, *exc: object) -> None:
        for p in reversed(self._patches):
            p.stop()


def profile(allergies: tuple[str, ...] = (), dislikes: tuple[str, ...] = ()) -> _Patched:
    return _Patched(_exclusions(allergies, dislikes))


def _llm_card(title: str, ingredients: list[str]) -> LLMRecipeResult:
    return LLMRecipeResult(
        title=title,
        description="d",
        ingredients=[{"name": n, "quantity": 1, "unit": "cup"} for n in ingredients],
        instructions=["cook"],
    )


# ---------------------------------------------------------------------------
# The allergen matcher
# ---------------------------------------------------------------------------


class TestAllergenMatcher:
    @pytest.mark.parametrize(
        "text",
        ["peanuts", "Crushed Peanuts", "peanut butter", "satay with peanut sauce"],
    )
    def test_peanut_is_named_by_singular_plural_and_compound(self, text: str) -> None:
        assert allergens_named(["peanut"], text) == ["peanut"]

    def test_plural_entry_matches_singular_text(self) -> None:
        assert allergens_named(["Peanuts"], "peanut sauce") == ["Peanuts"]

    def test_free_phrase_is_not_the_allergen(self) -> None:
        assert allergens_named(["peanut"], "peanut-free satay sauce") == []

    def test_unrelated_words_do_not_match(self) -> None:
        assert allergens_named(["nut"], "nutmeg and butternut squash") == []

    def test_broad_label_expands_to_the_foods_it_covers(self) -> None:
        assert allergens_named(["nuts"], "toasted almonds") == ["nuts"]
        assert allergens_named(["shellfish"], "garlic prawns") == ["shellfish"]
        assert allergens_named(["dairy"], "grated parmesan cheese") == ["dairy"]

    def test_tree_nut_label_leaves_peanut_alone(self) -> None:
        assert allergens_named(["tree nuts"], "cashews") == ["tree nuts"]
        assert allergens_named(["tree nuts"], "peanuts") == []

    def test_false_friends_are_not_the_allergen(self) -> None:
        assert allergens_named(["dairy"], "cream of tartar") == []
        assert allergens_named(["dairy"], "coconut milk") == []
        assert allergens_named(["egg"], "flax egg") == []

    def test_each_field_is_read_on_its_own(self) -> None:
        # "tofu" + "nut" must never be read together as one phrase.
        assert allergens_named(["peanut"], "tofu", "butter") == []

    def test_safety_check_ignores_plant_markers(self) -> None:
        # The diet matcher would wave "tofu egg scramble" through as not-egg; an egg-allergic
        # user's safety check does not.
        assert allergens_named(["egg"], "tofu egg scramble") == ["egg"]

    def test_terms_include_what_was_typed(self) -> None:
        assert "kiwi" in allergen_terms("Kiwi")
        assert allergen_terms("  ") == frozenset()

    def test_drop_naming_allergen(self) -> None:
        assert drop_naming_allergen(["peanut noodles", "rice"], ["peanut"]) == ["rice"]
        assert drop_naming_allergen(["peanut noodles"], []) == ["peanut noodles"]


# ---------------------------------------------------------------------------
# The profile read
# ---------------------------------------------------------------------------


class TestStoredFoodExclusions:
    async def _read(self, profile_row: Any) -> FoodExclusions:
        repo = MagicMock()
        repo.get_profile = AsyncMock(return_value=profile_row)
        with patch(
            "bubbly_chef.services.food_exclusions.get_repository", AsyncMock(return_value=repo)
        ):
            return await get_stored_food_exclusions(USER)

    @pytest.mark.asyncio
    async def test_reads_both_lists(self) -> None:
        got = await self._read({"allergies": ["peanut"], "disliked_ingredients": ["cilantro"]})
        assert got == FoodExclusions(allergies=("peanut",), dislikes=("cilantro",))

    @pytest.mark.asyncio
    async def test_columns_missing_before_the_migration_runs_reads_as_empty(self) -> None:
        # The hosted DB has no such columns until 00018 is applied: the row simply lacks them.
        got = await self._read({"dietary_preferences": ["Vegetarian"], "user_id": USER})
        assert got == FoodExclusions()

    @pytest.mark.asyncio
    async def test_missing_profile_and_malformed_columns_read_as_empty(self) -> None:
        assert await self._read(None) == FoodExclusions()
        assert await self._read({"allergies": "peanut", "disliked_ingredients": 3}) == FoodExclusions()

    @pytest.mark.asyncio
    async def test_unreachable_db_degrades_and_never_raises(self) -> None:
        with patch(
            "bubbly_chef.services.food_exclusions.get_repository",
            AsyncMock(side_effect=RuntimeError("db down")),
        ):
            assert await get_stored_food_exclusions(USER) == FoodExclusions()

    @pytest.mark.asyncio
    async def test_empty_user_id_reads_as_empty(self) -> None:
        assert await get_stored_food_exclusions("") == FoodExclusions()

    @pytest.mark.asyncio
    async def test_an_allergy_beats_the_same_dislike_and_entries_are_cleaned(self) -> None:
        got = await self._read(
            {"allergies": ["Peanut", " peanut ", ""], "disliked_ingredients": ["peanut", "olives"]}
        )
        assert got == FoodExclusions(allergies=("Peanut",), dislikes=("olives",))


# ---------------------------------------------------------------------------
# The guard
# ---------------------------------------------------------------------------


class TestGuard:
    @pytest.mark.asyncio
    async def test_clean_result_is_one_call(self) -> None:
        gen = AsyncMock(return_value="ok")
        out = await generate_allergen_safe(gen, lambda r: [], ["peanut"])
        assert out == "ok"
        assert gen.await_count == 1

    @pytest.mark.asyncio
    async def test_dirty_then_clean_regenerates_once_naming_the_offence(self) -> None:
        calls: list[str] = []

        async def gen(extra: str) -> str:
            calls.append(extra)
            return "peanuts" if not extra else "cashews"

        out = await generate_allergen_safe(
            gen, lambda r: ["peanut"] if "peanut" in r else [], ["peanut"]
        )
        assert out == "cashews"
        assert calls[0] == "" and "peanut" in calls[1]

    @pytest.mark.asyncio
    async def test_dirty_twice_raises_and_never_returns_the_dirty_result(self) -> None:
        gen = AsyncMock(return_value="peanuts")
        with pytest.raises(AllergenViolation) as exc:
            await generate_allergen_safe(
                gen, lambda r: ["peanut"] if "peanut" in r else [], ["peanut"]
            )
        assert exc.value.allergens == ["peanut"]
        assert gen.await_count == 2

    @pytest.mark.asyncio
    async def test_no_allergies_is_a_single_unchecked_call(self) -> None:
        gen = AsyncMock(return_value="peanuts")
        checker = MagicMock(return_value=["peanut"])
        assert await generate_allergen_safe(gen, checker, []) == "peanuts"
        checker.assert_not_called()

    @pytest.mark.asyncio
    async def test_salvage_keeps_the_clean_parts_and_refuses_when_none(self) -> None:
        gen = AsyncMock(return_value=["peanut soup", "rice"])
        bad = lambda r: [x for x in r if "peanut" in x] and ["peanut"]  # noqa: E731
        out = await generate_allergen_safe(
            gen, bad, ["peanut"], salvage=lambda r: [x for x in r if "peanut" not in x] or None
        )
        assert out == ["rice"]

        gen_all_bad = AsyncMock(return_value=["peanut soup"])
        with pytest.raises(AllergenViolation):
            await generate_allergen_safe(
                gen_all_bad,
                bad,
                ["peanut"],
                salvage=lambda r: [x for x in r if "peanut" not in x] or None,
            )

    def test_refusal_message_says_what_and_why(self) -> None:
        msg = allergen_refusal_message(["peanut"], "'Chicken Satay'")
        assert "peanut" in msg and "allergy" in msg and "Chicken Satay" in msg


# ---------------------------------------------------------------------------
# Precedence: allergy (never overridden) vs dislike (overridden by an explicit ask)
# ---------------------------------------------------------------------------


class TestPrecedence:
    def test_explicit_do_it_anyway_does_not_override_an_allergy(self) -> None:
        applied = apply_food_exclusions(
            {"must_use_ingredients": ["peanut noodles", "rice"]},
            PEANUT,
            "I know I'm allergic, make it with peanuts anyway",
        )
        assert "peanut" in applied.constraints["excluded_ingredients"]
        assert applied.allergies == ["peanut"]
        # ...and a must-use that names the allergen can't contradict the exclusion.
        assert applied.constraints["must_use_ingredients"] == ["rice"]

    def test_explicit_ask_overrides_a_dislike(self) -> None:
        applied = apply_food_exclusions(
            {}, FoodExclusions(dislikes=("cilantro",)), "add cilantro on top"
        )
        assert applied.constraints.get("excluded_ingredients", []) == []
        assert applied.dislikes_set_aside == ["cilantro"]

    def test_dislike_stays_excluded_when_not_asked_for(self) -> None:
        stored = FoodExclusions(dislikes=("cilantro",))
        for message in ("make me tacos", "tacos without cilantro", "no cilantro please"):
            applied = apply_food_exclusions({}, stored, message)
            assert applied.constraints["excluded_ingredients"] == ["cilantro"], message
            assert applied.dislikes_set_aside == []

    def test_profile_exclusions_join_what_the_user_typed_without_duplicates(self) -> None:
        applied = apply_food_exclusions(
            {"excluded_ingredients": ["Mushrooms", "peanut"]},
            FoodExclusions(allergies=("peanut",), dislikes=("olives",)),
            "dinner",
        )
        assert applied.constraints["excluded_ingredients"] == ["Mushrooms", "peanut", "olives"]

    def test_nothing_stored_changes_nothing(self) -> None:
        constraints = {"cuisine": "thai"}
        applied = apply_food_exclusions(constraints, FoodExclusions(), "dinner")
        assert applied.constraints == constraints

    def test_asks_for_reads_additions_not_negations(self) -> None:
        assert asks_for("cilantro", "add cilantro on top")
        assert not asks_for("cilantro", "hold the cilantro")

    @pytest.mark.asyncio
    async def test_extract_folds_profile_exclusions_into_the_turn(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=RecipeConstraints(must_use_ingredients=["peanut butter", "noodles"])
        )
        with (
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            profile(("peanut",), ("cilantro",)),
        ):
            state = await extract_recipe_constraints(
                {
                    "input_text": "I'm allergic but make peanut noodles anyway",
                    "errors": [],
                    "warnings": [],
                    "session": None,
                    "user_id": USER,
                }
            )
        constraints = state["recipe_constraints"]
        assert constraints["excluded_ingredients"] == ["peanut", "cilantro"]
        assert constraints["must_use_ingredients"] == ["noodles"]
        assert state["profile_allergies"] == ["peanut"]

    @pytest.mark.asyncio
    async def test_extract_lets_the_message_win_over_a_dislike(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=RecipeConstraints())
        with (
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            profile((), ("cilantro",)),
        ):
            state = await extract_recipe_constraints(
                {
                    "input_text": "tacos please, add cilantro on top",
                    "errors": [],
                    "warnings": [],
                    "session": None,
                    "user_id": USER,
                }
            )
        assert "cilantro" not in (state["recipe_constraints"].get("excluded_ingredients") or [])
        assert state["dislikes_set_aside"] == ["cilantro"]

    def test_session_never_persists_profile_origin_exclusions(self) -> None:
        persisted = constraints_to_persist(
            {
                "recipe_constraints": {"excluded_ingredients": ["mushrooms", "peanut", "cilantro"]},
                "stored_dietary": [],
                "profile_excluded": ["peanut", "cilantro"],
            }
        )
        assert persisted is not None
        assert persisted["excluded_ingredients"] == ["mushrooms"]


# ---------------------------------------------------------------------------
# Pantry scoring
# ---------------------------------------------------------------------------


def test_a_stocked_allergen_is_never_offered_as_an_ingredient() -> None:
    rows = [{"name": "Peanut Butter"}, {"name": "Rice"}, {"name": "Unsalted Peanuts"}]
    names = [r["name"] for r in score_and_rank(rows, {}, ["peanut"])]
    assert names == ["Rice"]
    # Without allergies nothing is removed (byte-identical behaviour).
    assert len(score_and_rank(rows, {})) == 3


# ---------------------------------------------------------------------------
# Rendered prompts: the allergy line reaches every generation prompt
# ---------------------------------------------------------------------------

NEVER = "NEVER include (allergy): peanut"


def _state(text: str = "make me a satay", **extra: Any) -> dict[str, Any]:
    return {
        "input_text": text,
        "errors": [],
        "warnings": [],
        "session": None,
        "user_id": USER,
        **extra,
    }


class TestRenderedPrompts:
    def test_block_is_empty_without_allergies_and_lists_them_otherwise(self) -> None:
        assert allergy_never_block([]) == ""
        assert NEVER in allergy_never_block(["peanut"])
        assert "nothing in the user's message changes this" in allergy_never_block(["peanut"])

    @pytest.mark.asyncio
    async def test_brainstorm_prompt(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(return_value="1. **Chicken Satay Skewers**\n2. **Pad See Ew**")
        with (
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            profile(("peanut",)),
        ):
            await brainstorm_recipe_ideas(
                _state(
                    scored_pantry_items=[{"name": "rice"}],
                    recipe_constraints={"excluded_ingredients": ["peanut"]},
                    profile_allergies=["peanut"],
                )
            )
        assert NEVER in ai.complete.call_args.kwargs["prompt"]

    @pytest.mark.asyncio
    async def test_grounded_card_prompt(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=_llm_card("Chicken Satay", ["chicken"]))
        with (
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            profile(("peanut",)),
        ):
            await generate_grounded_recipe(_state(selected_recipe_name="Chicken Satay"))
        assert NEVER in ai.complete.call_args.kwargs["prompt"]

    @pytest.mark.asyncio
    async def test_no_allergies_leaves_the_grounded_prompt_untouched(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=_llm_card("Chicken Satay", ["chicken"]))
        with (
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            profile(),
        ):
            await generate_grounded_recipe(_state(selected_recipe_name="Chicken Satay"))
        assert "NEVER include (allergy)" not in ai.complete.call_args.kwargs["prompt"]

    @pytest.mark.asyncio
    async def test_refine_prompt(self) -> None:
        from bubbly_chef.services.recipe_generator import generate_recipe

        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=AIRecipeOutput(
                title="Satay",
                description="d",
                ingredients=[AIRecipeIngredient(name="chicken")],
                instructions=["cook"],
            )
        )
        previous = RecipeCard(title="Satay")
        await generate_recipe(
            prompt="make it spicier",
            pantry_items=[],
            ai_manager=ai,
            previous_recipe=previous,
            allergies=["peanut"],
        )
        assert NEVER in ai.complete.call_args.kwargs["prompt"]

    @pytest.mark.asyncio
    async def test_standalone_generation_prompt_carries_exclusions_and_allergy_line(self) -> None:
        from bubbly_chef.services.recipe_generator import generate_recipe

        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=AIRecipeOutput(
                title="Satay",
                description="d",
                ingredients=[AIRecipeIngredient(name="chicken")],
                instructions=["cook"],
            )
        )
        await generate_recipe(
            prompt="satay",
            pantry_items=[],
            ai_manager=ai,
            constraints={"excluded_ingredients": ["peanut", "cilantro"]},
            allergies=["peanut"],
        )
        prompt = ai.complete.call_args.kwargs["prompt"]
        assert NEVER in prompt
        assert "Leave out: peanut, cilantro" in prompt

    @pytest.mark.asyncio
    async def test_cooking_help_prompts_single_shot_and_react(self) -> None:
        with profile(("peanut",), ("cilantro",)):
            dietary = await format_dietary_context(_state("what can I use instead of butter?"))
        assert NEVER in dietary
        assert "dislikes: cilantro" in dietary

        single_shot = _build_cooking_prompt(_state(), "SYSTEM", "", dietary)
        react = _build_react_initial_message(_state(), dietary)
        assert NEVER in single_shot
        assert NEVER in react

    @pytest.mark.asyncio
    async def test_chat_context_drops_a_dislike_the_message_asks_for_but_never_an_allergy(
        self,
    ) -> None:
        with profile(("peanut",), ("cilantro",)):
            dietary = await format_dietary_context(_state("add peanut and cilantro, do it anyway"))
        assert NEVER in dietary
        assert "dislikes" not in dietary

    @pytest.mark.asyncio
    async def test_chat_context_is_empty_when_nothing_is_stored(self) -> None:
        with profile():
            assert await format_dietary_context(_state()) == ""


# ---------------------------------------------------------------------------
# The guard at the grounding boundary: a provider that TRIES to return peanuts
# ---------------------------------------------------------------------------


class TestGroundedCardGuard:
    @pytest.mark.asyncio
    async def test_a_card_with_peanuts_is_regenerated_once_and_the_clean_one_returned(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(
            side_effect=[
                _llm_card("Chicken Satay", ["chicken thigh", "crushed peanuts", "coconut milk"]),
                _llm_card("Chicken Satay", ["chicken thigh", "sesame seeds", "coconut milk"]),
            ]
        )
        with (
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            profile(("peanut",)),
        ):
            out = await generate_grounded_recipe(_state(selected_recipe_name="Chicken Satay"))

        assert ai.complete.await_count == 2
        assert "peanut" in ai.complete.call_args_list[1].kwargs["prompt"]  # the retry names it
        proposal = out["proposal"]
        names = [i.name for i in proposal.recipe.ingredients]
        assert not any("peanut" in n.lower() for n in names)
        # The reply says why.
        assert "peanut" in out["assistant_message"]
        assert "allerg" in out["assistant_message"]

    @pytest.mark.asyncio
    async def test_a_provider_that_keeps_returning_peanuts_is_refused_honestly(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=_llm_card("Chicken Satay", ["chicken", "peanut butter"])
        )
        with (
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            profile(("peanut",)),
        ):
            out = await generate_grounded_recipe(_state(selected_recipe_name="Chicken Satay"))

        assert ai.complete.await_count == 2  # regenerates ONCE, then stops
        assert out["proposal"] is None
        assert out["intent"] == Intent.GENERAL_CHAT.value
        assert out["next_action"] == NextAction.NONE.value
        assert "peanut" in out["assistant_message"] and "allergy" in out["assistant_message"]

    @pytest.mark.asyncio
    async def test_a_substitute_naming_the_allergen_counts(self) -> None:
        dirty = LLMRecipeResult(
            title="Noodles",
            description="d",
            ingredients=[{"name": "tahini", "substitutes": ["peanut butter"]}],
            instructions=["stir"],
        )
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=dirty)
        with (
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            profile(("peanut",)),
        ):
            out = await generate_grounded_recipe(_state(selected_recipe_name="Noodles"))
        assert out["proposal"] is None

    @pytest.mark.asyncio
    async def test_no_allergies_means_no_extra_call_and_an_unchanged_reply(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=_llm_card("Chicken Satay", ["peanut butter"]))
        with (
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            profile(),
        ):
            out = await generate_grounded_recipe(_state(selected_recipe_name="Chicken Satay"))
        assert ai.complete.await_count == 1
        assert out["assistant_message"] == "Here's a recipe for Chicken Satay!"

    @pytest.mark.asyncio
    async def test_a_dislike_the_message_asked_for_is_stamped_as_set_aside(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=_llm_card("Tacos", ["tortilla", "cilantro"]))
        with (
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            profile((), ("cilantro",)),
        ):
            out = await generate_grounded_recipe(
                _state(selected_recipe_name="Tacos", dislikes_set_aside=["cilantro"])
            )
        assert out["proposal"].recipe.exclusions_set_aside == ["cilantro"]
        assert "cilantro" in [i.name for i in out["proposal"].recipe.ingredients]

    @pytest.mark.asyncio
    async def test_brainstorm_with_a_peanut_idea_is_regenerated_then_refused(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(return_value="1. **Peanut Noodles**\n2. **Pad See Ew**")
        with (
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            profile(("peanut",)),
        ):
            out = await brainstorm_recipe_ideas(
                _state(
                    scored_pantry_items=[{"name": "rice"}],
                    recipe_constraints={},
                    profile_allergies=["peanut"],
                )
            )
        assert ai.complete.await_count == 2
        assert out["proposal"] is None
        assert out["brainstorm_ideas"] == []
        assert "allergy" in out["assistant_message"]

    @pytest.mark.asyncio
    async def test_brainstorm_note_that_only_mentions_the_allergen_is_fine(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value="1. **Pad See Ew**\nI kept peanuts out of all of these.\nWhich one?"
        )
        with (
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            profile(("peanut",)),
        ):
            out = await brainstorm_recipe_ideas(
                _state(
                    scored_pantry_items=[{"name": "rice"}],
                    recipe_constraints={},
                    profile_allergies=["peanut"],
                )
            )
        assert ai.complete.await_count == 1
        assert out["brainstorm_ideas"] == ["Pad See Ew"]


# ---------------------------------------------------------------------------
# Refine (chat + library)
# ---------------------------------------------------------------------------


class TestRefine:
    @pytest.mark.asyncio
    async def test_a_tweak_that_adds_the_allergen_still_sends_it_as_excluded(self) -> None:
        with profile(("peanut",)), patch(
            "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
            AsyncMock(return_value=[]),
        ):
            decision = await refine_dietary_constraints(
                USER, "add peanuts, I know, do it anyway", None, RecipeCard(title="Satay")
            )
        assert decision.constraints["excluded_ingredients"] == ["peanut"]
        assert decision.allergies == ("peanut",)

    @pytest.mark.asyncio
    async def test_a_tweak_that_adds_a_disliked_food_sets_the_dislike_aside(self) -> None:
        with profile((), ("cilantro",)), patch(
            "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
            AsyncMock(return_value=[]),
        ):
            decision = await refine_dietary_constraints(
                USER, "add cilantro on top", None, RecipeCard(title="Tacos")
            )
        assert "excluded_ingredients" not in decision.constraints
        assert decision.exclusions_set_aside_now == ["cilantro"]

    @pytest.mark.asyncio
    async def test_an_unrelated_tweak_keeps_the_dislike_excluded(self) -> None:
        with profile((), ("cilantro",)), patch(
            "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
            AsyncMock(return_value=[]),
        ):
            decision = await refine_dietary_constraints(
                USER, "make it spicier", None, RecipeCard(title="Tacos")
            )
        assert decision.constraints["excluded_ingredients"] == ["cilantro"]

    @pytest.mark.asyncio
    async def test_refine_node_refuses_when_the_model_keeps_adding_the_allergen(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=AIRecipeOutput(
                title="Satay",
                description="d",
                ingredients=[AIRecipeIngredient(name="peanut sauce")],
                instructions=["cook"],
            )
        )
        pinned = RecipeCard(title="Satay").model_dump(mode="json")
        repo = MagicMock()
        repo.get_all_pantry_items = AsyncMock(return_value=[])
        with (
            patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)),
            patch("bubbly_chef.workflows.recipe.nodes.get_repository", AsyncMock(return_value=repo)),
            patch(
                "bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences",
                AsyncMock(return_value=[]),
            ),
            patch("bubbly_chef.services.recipe_generator.asyncio.sleep", AsyncMock()),
            profile(("peanut",)),
        ):
            out = await refine_recipe_node(
                _state(
                    "add a peanut sauce",
                    session={"metadata": {"picked_recipe": pinned}},
                )
            )
        assert ai.complete.await_count == 2
        assert out["proposal"] is None
        assert "allergy" in out["assistant_message"]


# ---------------------------------------------------------------------------
# The standalone routes
# ---------------------------------------------------------------------------


class TestRoutes:
    @pytest.mark.asyncio
    async def test_generate_route_returns_422_when_the_model_keeps_naming_the_allergen(self) -> None:
        from bubbly_chef.api.routes.recipes_ai import GenerateRequest, generate_recipe

        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=AIRecipeOutput(
                title="Satay",
                description="d",
                ingredients=[AIRecipeIngredient(name="roasted peanuts")],
                instructions=["cook"],
            )
        )
        repo = MagicMock()
        repo.get_all_pantry_items = AsyncMock(return_value=[])
        with (
            patch("bubbly_chef.api.deps.get_ai_manager", MagicMock(return_value=ai)),
            patch("bubbly_chef.api.routes.recipes_ai.get_repository", AsyncMock(return_value=repo)),
            patch("bubbly_chef.services.recipe_generator.asyncio.sleep", AsyncMock()),
            profile(("peanut",)),
        ):
            with pytest.raises(HTTPException) as exc:
                await generate_recipe(GenerateRequest(prompt="satay"), user_id=USER)
        assert exc.value.status_code == 422
        assert "allergy" in str(exc.value.detail)
        assert ai.complete.await_count == 2

    @pytest.mark.asyncio
    async def test_generate_route_sends_exclusions_and_allergy_line_to_the_model(self) -> None:
        from bubbly_chef.api.routes.recipes_ai import GenerateRequest, generate_recipe

        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=AIRecipeOutput(
                title="Noodles",
                description="d",
                ingredients=[AIRecipeIngredient(name="rice noodles")],
                instructions=["cook"],
            )
        )
        repo = MagicMock()
        repo.get_all_pantry_items = AsyncMock(return_value=[])
        with (
            patch("bubbly_chef.api.deps.get_ai_manager", MagicMock(return_value=ai)),
            patch("bubbly_chef.api.routes.recipes_ai.get_repository", AsyncMock(return_value=repo)),
            profile(("peanut",), ("cilantro",)),
        ):
            await generate_recipe(GenerateRequest(prompt="noodles"), user_id=USER)
        prompt = ai.complete.call_args.kwargs["prompt"]
        assert NEVER in prompt
        assert "Leave out: peanut, cilantro" in prompt


# ---------------------------------------------------------------------------
# The meal engine
# ---------------------------------------------------------------------------


def _option(title: str, main: str, main_ings: list[str], side: str = "Side Salad") -> MealOptionLLM:
    return MealOptionLLM(
        title=title,
        blurb="b",
        dishes=[
            MealDishOutlineLLM(role="main", name=main, key_ingredients=main_ings),
            MealDishOutlineLLM(role="side", name=side, key_ingredients=["lettuce"]),
        ],
    )


def _meal_repo() -> MagicMock:
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    repo.get_recent_meal_servings = AsyncMock(return_value=[])
    repo.get_user_recipes = AsyncMock(return_value=[])
    return repo


def _meal_patches(ai: Any) -> list[Any]:
    async def _extract(state: dict[str, Any]) -> dict[str, Any]:
        return {**state, "recipe_constraints": {}}

    async def _score(state: dict[str, Any]) -> dict[str, Any]:
        return {**state, "scored_pantry_items": []}

    return [
        patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=ai)),
        patch(
            "bubbly_chef.workflows.meal.nodes.get_repository",
            AsyncMock(return_value=_meal_repo()),
        ),
        patch(
            "bubbly_chef.workflows.meal.nodes.extract_recipe_constraints",
            AsyncMock(side_effect=_extract),
        ),
        patch(
            "bubbly_chef.workflows.meal.nodes.score_pantry_ingredients",
            AsyncMock(side_effect=_score),
        ),
    ]


class TestMealEngine:
    async def _options(self, ai: Any, allergies: tuple[str, ...] = ("peanut",)) -> dict[str, Any]:
        from bubbly_chef.workflows.meal.nodes import meal_options_stage

        with _Patched(_meal_patches(ai)), profile(allergies):
            return await meal_options_stage(_state("what's for dinner?", user_id=USER))

    @pytest.mark.asyncio
    async def test_option_prompt_carries_the_allergy_line(self) -> None:
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=MealOptionsLLMResult(
                options=[_option(f"Meal {i}", f"Main {i}", ["rice"]) for i in range(3)]
            )
        )
        out = await self._options(ai)
        assert NEVER in ai.complete.call_args.kwargs["prompt"]
        assert out["proposal"] is not None

    @pytest.mark.asyncio
    async def test_an_option_naming_the_allergen_is_regenerated_once(self) -> None:
        dirty = MealOptionsLLMResult(
            options=[_option("Satay Night", "Chicken Satay", ["chicken", "peanut sauce"])]
            + [_option(f"Meal {i}", f"Main {i}", ["rice"]) for i in range(2)]
        )
        clean = MealOptionsLLMResult(
            options=[_option(f"Meal {i}", f"Main {i}", ["rice"]) for i in range(3)]
        )
        ai = MagicMock()
        ai.complete = AsyncMock(side_effect=[dirty, clean])
        out = await self._options(ai)
        assert ai.complete.await_count == 2
        titles = [o.title for o in out["proposal"].options]
        assert "Satay Night" not in titles and len(titles) == 3

    @pytest.mark.asyncio
    async def test_still_dirty_options_are_dropped_and_clean_ones_kept(self) -> None:
        dirty = MealOptionsLLMResult(
            options=[_option("Satay Night", "Chicken Satay", ["peanut sauce"])]
            + [_option(f"Meal {i}", f"Main {i}", ["rice"]) for i in range(2)]
        )
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=dirty)
        out = await self._options(ai)
        assert ai.complete.await_count == 2
        titles = [o.title for o in out["proposal"].options]
        assert titles == ["Meal 0", "Meal 1"]

    @pytest.mark.asyncio
    async def test_a_reassuring_blurb_does_not_drop_an_option(self) -> None:
        """Prose is not an ingredient list: "no peanuts in sight" keeps the option."""
        reassuring = _option("Noodle Night", "Plain Noodles", ["noodles"])
        reassuring.blurb = "Simple and peanut-free: no peanuts in sight."
        reassuring.dishes[0].blurb = "Not a peanut anywhere."
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=MealOptionsLLMResult(
                options=[reassuring]
                + [_option(f"Meal {i}", f"Main {i}", ["rice"]) for i in range(2)]
            )
        )
        out = await self._options(ai)
        assert ai.complete.await_count == 1
        assert "Noodle Night" in [o.title for o in out["proposal"].options]

    def test_a_fixed_mains_allergen_in_the_option_title_is_the_users_own(self) -> None:
        from bubbly_chef.workflows.meal.nodes import option_allergens

        own = _option("Peanut Noodles Night", "Peanut Noodles", ["noodles", "peanut sauce"])
        assert option_allergens(own, ["peanut"], skip_main=True) == []
        # a side that brings the allergen in is still the model's to answer for
        side = _option("Peanut Noodles Night", "Peanut Noodles", ["peanut sauce"], side="Satay Slaw")
        side.dishes[1].key_ingredients = ["peanuts"]
        assert option_allergens(side, ["peanut"], skip_main=True) == ["peanut"]
        # without a fixed main the title is scanned as before
        assert option_allergens(own, ["peanut"]) == ["peanut"]

    @pytest.mark.asyncio
    async def test_an_allergen_in_a_key_ingredient_still_drops_the_option(self) -> None:
        sneaky = _option("Noodle Night", "Plain Noodles", ["noodles", "peanut sauce"])
        sneaky.blurb = "Nothing to worry about."
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=MealOptionsLLMResult(
                options=[sneaky] + [_option(f"Meal {i}", f"Main {i}", ["rice"]) for i in range(2)]
            )
        )
        out = await self._options(ai)
        assert "Noodle Night" not in [o.title for o in out["proposal"].options]

    @pytest.mark.asyncio
    async def test_all_options_dirty_is_an_honest_error(self) -> None:
        dirty = MealOptionsLLMResult(
            options=[_option(f"Satay {i}", "Chicken Satay", ["peanut sauce"]) for i in range(3)]
        )
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=dirty)
        out = await self._options(ai)
        assert out["proposal"] is None
        assert "allergy" in out["assistant_message"]

    @pytest.mark.asyncio
    async def test_no_allergies_does_not_trigger_the_guard(self) -> None:
        dirty = MealOptionsLLMResult(
            # three different proteins: three of one would trigger #877's replacement call
            options=[
                _option(f"Satay {i}", f"{protein} Satay", ["peanut sauce"])
                for i, protein in enumerate(("Chicken", "Beef", "Tofu"))
            ]
        )
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=dirty)
        out = await self._options(ai, allergies=())
        assert ai.complete.await_count == 1
        assert out["proposal"] is not None

    @pytest.mark.asyncio
    async def test_pick_stage_guards_every_dish_and_carries_the_allergy_line(self) -> None:
        from bubbly_chef.workflows.meal.nodes import meal_pick_stage

        option = MealOption(
            option_id="opt_1",
            title="Night",
            dishes=[
                MealDishOutline(role="main", name="Noodles", key_ingredients=["noodles"]),
                MealDishOutline(role="side", name="Slaw", key_ingredients=["cabbage"]),
            ],
        )
        session = {
            "metadata": {
                "meal_plan": MealPlanSessionState(
                    options=[option], servings=2, constraints=MealConstraintsEcho()
                ).model_dump(mode="json")
            }
        }
        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=_llm_card("Peanut Noodles", ["noodles", "peanut butter"])
        )
        state = _state(
            "Night", user_id=USER, session=session, context={"meal_option_id": "opt_1"}
        )
        with _Patched(_meal_patches(ai)), profile(("peanut",)):
            out = await meal_pick_stage(state)

        assert out["proposal"] is None
        assert "allergy" in out["assistant_message"]
        assert all(NEVER in c.kwargs["prompt"] for c in ai.complete.call_args_list)

    @pytest.mark.asyncio
    async def test_pick_stage_clean_dishes_go_through(self) -> None:
        from bubbly_chef.workflows.meal.nodes import meal_pick_stage

        option = MealOption(
            option_id="opt_1",
            title="Night",
            dishes=[
                MealDishOutline(role="main", name="Noodles", key_ingredients=["noodles"]),
                MealDishOutline(role="side", name="Slaw", key_ingredients=["cabbage"]),
            ],
        )
        session = {
            "metadata": {
                "meal_plan": MealPlanSessionState(
                    options=[option], servings=2, constraints=MealConstraintsEcho()
                ).model_dump(mode="json")
            }
        }
        ai = MagicMock()
        ai.complete = AsyncMock(return_value=_llm_card("Sesame Noodles", ["noodles", "sesame"]))
        state = _state(
            "Night", user_id=USER, session=session, context={"meal_option_id": "opt_1"}
        )
        with _Patched(_meal_patches(ai)), profile(("peanut",)):
            out = await meal_pick_stage(state)
        assert out["proposal"] is not None
        assert ai.complete.await_count == 2  # one per dish, no regeneration

    @pytest.mark.asyncio
    async def test_side_alternatives_keep_the_clean_ones_and_carry_the_allergy_line(self) -> None:
        from bubbly_chef.workflows.meal.sides import generate_side_alternatives

        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=MealSideAlternativesLLMResult(
                alternatives=[
                    MealDishOutlineLLM(role="side", name="Peanut Slaw", key_ingredients=["peanuts"]),
                    MealDishOutlineLLM(role="side", name="Cucumber Salad", key_ingredients=["cucumber"]),
                ]
            )
        )
        repo = MagicMock()
        repo.get_all_pantry_items = AsyncMock(return_value=[])
        repo.get_meal = AsyncMock(return_value=None)
        loaded = MagicMock()
        loaded.dishes = [{"role": "main", "position": 0, "recipe": {"title": "Noodles"}}]
        loaded.constraints_echo = MealConstraintsEcho()
        loaded.title = "Night"
        loaded.servings = 2
        with (
            patch("bubbly_chef.workflows.meal.sides._load_meal", AsyncMock(return_value=loaded)),
            patch(
                "bubbly_chef.workflows.meal.sides._pantry_items_for_matching",
                AsyncMock(return_value=[]),
            ),
            profile(("peanut",)),
        ):
            alternatives = await generate_side_alternatives(
                user_id=USER, meal_id="m1", position=None, repo=repo, ai_manager=ai
            )
        assert [a.name for a in alternatives] == ["Cucumber Salad"]
        assert NEVER in ai.complete.call_args_list[0].kwargs["prompt"]

    @pytest.mark.asyncio
    async def test_a_reassuring_side_blurb_keeps_the_alternative(self) -> None:
        from bubbly_chef.workflows.meal.sides import generate_side_alternatives

        ai = MagicMock()
        ai.complete = AsyncMock(
            return_value=MealSideAlternativesLLMResult(
                alternatives=[
                    MealDishOutlineLLM(
                        role="side",
                        name="Cucumber Salad",
                        blurb="Crisp and peanut-free, no peanuts in sight.",
                        key_ingredients=["cucumber"],
                    ),
                ]
            )
        )
        repo = MagicMock()
        repo.get_all_pantry_items = AsyncMock(return_value=[])
        repo.get_meal = AsyncMock(return_value=None)
        loaded = MagicMock()
        loaded.dishes = [{"role": "main", "position": 0, "recipe": {"title": "Noodles"}}]
        loaded.constraints_echo = MealConstraintsEcho()
        loaded.title = "Night"
        loaded.servings = 2
        with (
            patch("bubbly_chef.workflows.meal.sides._load_meal", AsyncMock(return_value=loaded)),
            patch(
                "bubbly_chef.workflows.meal.sides._pantry_items_for_matching",
                AsyncMock(return_value=[]),
            ),
            profile(("peanut",)),
        ):
            alternatives = await generate_side_alternatives(
                user_id=USER, meal_id="m1", position=None, repo=repo, ai_manager=ai
            )
        assert [a.name for a in alternatives] == ["Cucumber Salad"]
        assert ai.complete.await_count == 1
