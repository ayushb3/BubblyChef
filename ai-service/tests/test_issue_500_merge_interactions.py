"""Issue #500 against the two features that landed on main after it branched.

* #579/#535 (refine edit list): a refine builds its card from the previous card plus the
  model's reported `added` / `removed` / `changed`. The allergen guard reads the FINAL
  card that edit list produces, so an `added` allergen is regenerated once, then refused.
* #687 (forget a diet): a chat message can drop a diet the conversation remembered. An
  allergy is profile-stored and hard, so no diet removal can touch one.

Every model is a scripted fake: no provider, no network.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from bubbly_chef.domain.allergens import allergies_behind_diet_label
from bubbly_chef.models.recipe import DietChanges, Ingredient, RecipeCard, RecipeConstraints
from bubbly_chef.services.allergen_guard import AllergenViolation
from bubbly_chef.services.food_exclusions import FoodExclusions
from bubbly_chef.services.recipe_generator import (
    AIRecipeIngredient,
    AIRecipeRefineOutput,
    generate_recipe,
)
from bubbly_chef.workflows.recipe.diet_change import diet_change_reply, resolve_diet_change
from bubbly_chef.workflows.recipe.nodes import (
    apply_diet_change,
    constraints_to_persist,
    extract_recipe_constraints,
)

USER = "user-500-merge"
NEVER = "NEVER include (allergy): peanut"
_NODES = "bubbly_chef.workflows.recipe.nodes"


def _profile(*allergies: str) -> Any:
    return patch(
        f"{_NODES}.get_stored_food_exclusions",
        AsyncMock(return_value=FoodExclusions(allergies=tuple(allergies))),
    )


# ---------------------------------------------------------------------------
# The refine edit list is guarded
# ---------------------------------------------------------------------------


def _noodle_card() -> RecipeCard:
    return RecipeCard(
        id=uuid4(),
        title="Sesame Noodles",
        description="Cold noodles.",
        ingredients=[
            Ingredient(name="Noodles", quantity=200, unit="g"),
            Ingredient(name="Soy sauce", quantity=2, unit="tbsp"),
        ],
        instructions=["Boil the noodles.", "Toss with the soy sauce."],
    )


def _refine_output(
    *, added: list[str] | None = None, removed: list[str] | None = None, title: str = "Noodles"
) -> AIRecipeRefineOutput:
    return AIRecipeRefineOutput(
        title=title,
        description="d",
        ingredients=[AIRecipeIngredient(name="Noodles", quantity=200, unit="g")],
        instructions=["Boil the noodles.", "Toss with the soy sauce."],
        added=[AIRecipeIngredient(name=n) for n in added or []],
        removed=removed or [],
    )


def _scripted(*outputs: AIRecipeRefineOutput) -> MagicMock:
    ai = MagicMock()
    ai.complete = AsyncMock(side_effect=list(outputs))
    return ai


class TestRefineEditListIsGuarded:
    @pytest.mark.asyncio
    async def test_the_refine_prompt_carries_the_never_line(self) -> None:
        ai = _scripted(_refine_output())
        await generate_recipe(
            "add some crunch", [], ai, previous_recipe=_noodle_card(), allergies=["peanut"]
        )
        assert NEVER in ai.complete.call_args_list[0].kwargs["prompt"]

    @pytest.mark.asyncio
    async def test_an_added_allergen_is_regenerated_once_then_the_clean_card_returned(
        self,
    ) -> None:
        ai = _scripted(
            _refine_output(added=["Crushed peanuts"]),
            _refine_output(added=["Sesame seeds"]),
        )
        result = await generate_recipe(
            "add some crunch", [], ai, previous_recipe=_noodle_card(), allergies=["peanut"]
        )
        assert ai.complete.await_count == 2
        names = [i.name for i in result.recipe.ingredients]
        assert "Sesame seeds" in names
        assert not any("peanut" in n.lower() for n in names)
        # the retry names the offence
        assert "peanut" in ai.complete.call_args_list[1].kwargs["prompt"].lower()

    @pytest.mark.asyncio
    async def test_an_added_allergen_that_keeps_coming_back_is_refused_not_returned(
        self,
    ) -> None:
        ai = _scripted(
            _refine_output(added=["Peanut butter"]), _refine_output(added=["Peanut butter"])
        )
        with pytest.raises(AllergenViolation) as err:
            await generate_recipe(
                "add peanut butter",
                [],
                ai,
                previous_recipe=_noodle_card(),
                allergies=["peanut"],
            )
        assert ai.complete.await_count == 2
        assert list(err.value.allergens) == ["peanut"]

    @pytest.mark.asyncio
    async def test_a_title_that_drifts_onto_an_allergen_is_caught_too(self) -> None:
        ai = _scripted(
            _refine_output(title="Peanut Noodles"), _refine_output(title="Plain Noodles")
        )
        result = await generate_recipe(
            "make it nuttier", [], ai, previous_recipe=_noodle_card(), allergies=["peanut"]
        )
        assert result.recipe.title == "Plain Noodles"

    @pytest.mark.asyncio
    async def test_removing_an_allergen_the_card_already_had_passes_the_guard(self) -> None:
        card = _noodle_card()
        card.ingredients.append(Ingredient(name="Peanut oil", quantity=1, unit="tbsp"))
        ai = _scripted(_refine_output(removed=["Peanut oil"]))
        result = await generate_recipe(
            "take out the peanut oil", [], ai, previous_recipe=card, allergies=["peanut"]
        )
        assert ai.complete.await_count == 1
        assert not any("peanut" in i.name.lower() for i in result.recipe.ingredients)

    # -- the user's own saved recipe already contains the allergen -------------------

    @staticmethod
    def _satay_card() -> RecipeCard:
        return RecipeCard(
            id=uuid4(),
            title="Chicken Satay",
            description="Skewers.",
            ingredients=[
                Ingredient(name="Chicken", quantity=400, unit="g"),
                Ingredient(name="Peanut sauce", quantity=3, unit="tbsp"),
            ],
            instructions=["Skewer the chicken.", "Grill, then brush with the peanut sauce."],
        )

    @pytest.mark.asyncio
    async def test_refining_a_saved_recipe_that_has_the_allergen_is_not_refused(self) -> None:
        """Rejected alternative: refusing every refine of such a recipe (decision 5)."""
        ai = _scripted(_refine_output(added=["Chilli flakes"], title="Spicy Chicken Satay"))
        result = await generate_recipe(
            "make it spicier",
            [],
            ai,
            previous_recipe=self._satay_card(),
            allergies=["peanut"],
        )
        assert ai.complete.await_count == 1  # no regeneration for what the user already had
        names = [i.name for i in result.recipe.ingredients]
        assert "Peanut sauce" in names and "Chilli flakes" in names
        assert result.allergy_warning == (
            "This recipe contains peanut, which is on your allergy list."
        )

    @pytest.mark.asyncio
    async def test_the_chat_reply_carries_the_one_line_warning(self) -> None:
        from bubbly_chef.workflows.recipe.nodes import refine_recipe_node

        ai = _scripted(_refine_output(added=["Chilli flakes"], title="Spicy Chicken Satay"))
        card = self._satay_card()
        state: Any = {
            "input_text": "make it spicier",
            "user_id": USER,
            "errors": [],
            "warnings": [],
            "session": {"metadata": {"picked_recipe": card.model_dump(mode="json")}},
        }
        repo = MagicMock()
        repo.get_all_pantry_items = AsyncMock(return_value=[])
        with (
            patch(f"{_NODES}.get_ai_manager", MagicMock(return_value=ai)),
            patch(f"{_NODES}.get_repository", AsyncMock(return_value=repo)),
            patch(f"{_NODES}.get_stored_dietary_preferences", AsyncMock(return_value=[])),
            _profile("peanut"),
        ):
            out = await refine_recipe_node(state)
        assert out.get("proposal") is not None, out.get("assistant_message")
        assert "This recipe contains peanut, which is on your allergy list." in (
            out["assistant_message"]
        )

    @pytest.mark.asyncio
    async def test_a_refine_that_adds_a_new_allergen_to_such_a_recipe_is_still_rejected(
        self,
    ) -> None:
        """The card already has peanut sauce; adding peanut butter is a NEW ingredient."""
        ai = _scripted(
            _refine_output(added=["Peanut butter"]), _refine_output(added=["Peanut butter"])
        )
        with pytest.raises(AllergenViolation):
            await generate_recipe(
                "creamier please",
                [],
                ai,
                previous_recipe=self._satay_card(),
                allergies=["peanut"],
            )
        assert ai.complete.await_count == 2

    @pytest.mark.asyncio
    async def test_a_new_allergen_is_regenerated_away_even_when_the_card_already_has_one(
        self,
    ) -> None:
        ai = _scripted(
            _refine_output(added=["Crushed peanuts"]), _refine_output(added=["Lime wedges"])
        )
        result = await generate_recipe(
            "add some crunch",
            [],
            ai,
            previous_recipe=self._satay_card(),
            allergies=["peanut"],
        )
        names = [i.name for i in result.recipe.ingredients]
        assert "Lime wedges" in names and "Crushed peanuts" not in names
        assert "Peanut sauce" in names
        assert result.allergy_warning is not None

    @pytest.mark.asyncio
    async def test_a_rescaled_allergen_ingredient_is_not_new(self) -> None:
        out = _refine_output()
        out.changed = [AIRecipeIngredient(name="Peanut sauce", quantity=6, unit="tbsp")]
        ai = _scripted(out)
        result = await generate_recipe(
            "double the sauce", [], ai, previous_recipe=self._satay_card(), allergies=["peanut"]
        )
        assert ai.complete.await_count == 1
        sauce = next(i for i in result.recipe.ingredients if i.name == "Peanut sauce")
        assert sauce.quantity == 6

    @pytest.mark.asyncio
    async def test_no_warning_when_the_card_carries_no_allergen(self) -> None:
        ai = _scripted(_refine_output(added=["Sesame seeds"]))
        result = await generate_recipe(
            "add crunch", [], ai, previous_recipe=_noodle_card(), allergies=["peanut"]
        )
        assert result.allergy_warning is None

    @pytest.mark.asyncio
    async def test_removing_the_allergen_clears_the_warning(self) -> None:
        ai = _scripted(_refine_output(removed=["Peanut sauce"]))
        result = await generate_recipe(
            "drop the peanut sauce",
            [],
            ai,
            previous_recipe=self._satay_card(),
            allergies=["peanut"],
        )
        assert result.allergy_warning is None

    @pytest.mark.asyncio
    async def test_no_allergies_leaves_the_refine_untouched(self) -> None:
        ai = _scripted(_refine_output(added=["Crushed peanuts"]))
        result = await generate_recipe(
            "add some crunch", [], ai, previous_recipe=_noodle_card(), allergies=None
        )
        assert ai.complete.await_count == 1
        assert "Crushed peanuts" in [i.name for i in result.recipe.ingredients]
        assert NEVER not in ai.complete.call_args_list[0].kwargs["prompt"]


# ---------------------------------------------------------------------------
# A chat diet removal never touches an allergy
# ---------------------------------------------------------------------------


class _ExtractAI:
    """Structured extraction only: whatever `extraction` says."""

    def __init__(self, extraction: RecipeConstraints) -> None:
        self.extraction = extraction

    async def complete(self, prompt: str, response_schema: Any = None, **_: Any) -> Any:
        return self.extraction


def _removal(*labels: str, scope: str = "conversation") -> RecipeConstraints:
    return RecipeConstraints(diet_changes=DietChanges(remove=list(labels), scope=scope))  # type: ignore[arg-type]


def _state(text: str, session: dict[str, Any] | None) -> Any:
    return {
        "input_text": text,
        "user_id": USER,
        "errors": [],
        "warnings": [],
        "session": session,
    }


class TestDietRemovalNeverTouchesAnAllergy:
    @pytest.mark.parametrize(
        ("label", "allergy"),
        [
            ("nut-free", "peanut"),
            ("Nut Free", "almonds"),
            ("peanut-free", "Peanuts"),
            ("dairy-free", "milk"),
            ("gluten-free", "gluten"),
            ("no shellfish", "shrimp"),
        ],
    )
    def test_an_exclusion_label_is_recognised_as_the_allergy_behind_it(
        self, label: str, allergy: str
    ) -> None:
        assert allergies_behind_diet_label(label, [allergy]) == [allergy]

    @pytest.mark.parametrize(
        ("label", "allergy"),
        [("vegan", "peanut"), ("vegetarian", "peanut"), ("keto", "peanut"), ("nut-free", "sesame")],
    )
    def test_a_label_that_is_not_the_allergy_is_not_matched(self, label: str, allergy: str) -> None:
        assert allergies_behind_diet_label(label, [allergy]) == []

    @pytest.mark.parametrize("scope", ["conversation", "this_request"])
    def test_resolver_keeps_the_allergy_whatever_the_scope(self, scope: str) -> None:
        outcome = resolve_diet_change(
            DietChanges(remove=["Nut-Free"], scope=scope),  # type: ignore[arg-type]
            ["Nut-Free"],
            [],
            [],
            ["peanut"],
        )
        assert outcome.kept_by_allergy == ["peanut"]
        assert outcome.dropped == [] and outcome.relaxed == []
        assert outcome.acted

    def test_resolver_still_drops_a_diet_that_is_not_an_allergy(self) -> None:
        outcome = resolve_diet_change(
            DietChanges(remove=["Vegetarian", "Nut-Free"], scope="conversation"),
            ["Vegetarian", "Nut-Free"],
            [],
            [],
            ["peanut"],
        )
        assert outcome.dropped == ["Vegetarian"]
        assert outcome.kept_by_allergy == ["peanut"]

    def test_resolver_without_allergies_behaves_as_before(self) -> None:
        outcome = resolve_diet_change(
            DietChanges(remove=["Nut-Free"], scope="conversation"), ["Nut-Free"], [], []
        )
        assert outcome.dropped == ["Nut-Free"] and outcome.kept_by_allergy == []

    def test_reply_says_the_allergy_stays_and_never_claims_it_was_dropped(self) -> None:
        outcome = resolve_diet_change(
            DietChanges(remove=["Nut-Free"], scope="conversation"),
            ["Nut-Free"],
            [],
            [],
            ["peanut"],
        )
        reply = diet_change_reply(outcome).lower()
        assert "peanut" in reply and "allergy" in reply and "profile" in reply
        assert "dropped" not in reply and "rest of this chat" not in reply

    @pytest.mark.asyncio
    async def test_the_diet_node_keeps_the_allergy_and_rewrites_nothing(self) -> None:
        ai = _ExtractAI(_removal("Nut-Free"))
        state = _state(
            "I'm not nut-free any more",
            {"metadata": {"recipe_constraints": {"dietary": ["Nut-Free"]}}},
        )
        with (
            patch(f"{_NODES}.get_stored_dietary_preferences", AsyncMock(return_value=[])),
            patch(f"{_NODES}.get_ai_manager", MagicMock(return_value=ai)),
            _profile("peanut"),
        ):
            out = await apply_diet_change(state)
        assert out["diet_change_applied"] is True
        assert "diet_change_constraints" not in out  # nothing dropped, nothing to rewrite
        assert "peanut" in out["diet_change_notice"]

    @pytest.mark.asyncio
    async def test_the_diet_node_answers_an_allergy_only_user_too(self) -> None:
        """Nothing in the chat or the diet profile, but the profile holds an allergy."""
        ai = _ExtractAI(_removal("Nut-Free"))
        with (
            patch(f"{_NODES}.get_stored_dietary_preferences", AsyncMock(return_value=[])),
            patch(f"{_NODES}.get_ai_manager", MagicMock(return_value=ai)),
            _profile("nuts"),
        ):
            out = await apply_diet_change(_state("I'm not allergic to nuts any more", None))
        assert out["diet_change_applied"] is True
        assert "allergy" in out["diet_change_notice"].lower()

    @pytest.mark.asyncio
    async def test_a_recipe_turn_still_excludes_the_allergen_after_a_diet_removal(self) -> None:
        """Removing every label the user holds leaves the profile exclusion and the
        guard's allergy list intact, and neither is written into the session."""
        ai = _ExtractAI(_removal("Nut-Free", "Peanut-Free", "Vegan"))
        state = _state(
            "make me a satay, I'm not nut-free any more",
            {"metadata": {"recipe_constraints": {"dietary": ["Nut-Free", "Vegan"]}}},
        )
        with (
            patch(f"{_NODES}.get_stored_dietary_preferences", AsyncMock(return_value=[])),
            patch(f"{_NODES}.get_ai_manager", MagicMock(return_value=ai)),
            _profile("peanut"),
        ):
            out = await extract_recipe_constraints(state)
        constraints = out["recipe_constraints"]
        assert "peanut" in [e.lower() for e in constraints["excluded_ingredients"]]
        assert out["profile_allergies"] == ["peanut"]
        # a chat diet that is not an allergy really was dropped (#687 unchanged)
        assert "Vegan" not in (constraints.get("dietary") or [])
        # and the profile-origin exclusion is not remembered by the session
        persisted = constraints_to_persist(out) or {}
        assert "peanut" not in [e.lower() for e in persisted.get("excluded_ingredients") or []]
