"""Issue #544: a refine keeps the user's diet.

"Make it spicier" on a vegetarian's pinned recipe used to bring meat back
because neither refine path handed the diet to the model. The design is that a
refine *remembers* the decision the first turn already made
(`RecipeCard.diets_set_aside`, computed once at the end of `research_recipe`)
instead of re-guessing it from ingredient names.

The only patch target for the stored diet is
`bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences`. A diet that
was set aside is asserted as `"dietary" not in constraints`. First-turn tests
run the real node order (extract -> score -> research -> generate); the model
and web search are stubbed, so nothing here needs a live provider.
"""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.models.base import Intent, NextAction
from bubbly_chef.models.recipe import Ingredient, RecipeCard, RecipeConstraints
from bubbly_chef.models.session import ConversationSession, SessionContext
from bubbly_chef.prompts.recipe import RECIPE_FOLLOWUP_PROMPT
from bubbly_chef.services.recipe_generator import (
    AIRecipeIngredient,
    AIRecipeOutput,
    GenerateRecipeResponse,
    IngredientStatus,
    format_followup_dietary,
    generate_recipe,
)
from bubbly_chef.workflows.recipe.nodes import (
    _diets_set_aside,
    extract_recipe_constraints,
    generate_grounded_recipe,
    refine_dietary_constraints,
    refine_recipe_node,
    research_recipe,
    score_pantry_ingredients,
)
from bubbly_chef.workflows.recipe.refine_diet import added_text
from bubbly_chef.workflows.router import update_session_node
from bubbly_chef.workflows.state import LLMRecipeResult

_NODES = "bubbly_chef.workflows.recipe.nodes"
STORED = f"{_NODES}.get_stored_dietary_preferences"
USER = "user-544"


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------


class _FakeAI:
    """Stands in for the AIManager: constraint extraction + grounded generation."""

    def __init__(self, extraction: RecipeConstraints | None = None) -> None:
        self.extraction = extraction or RecipeConstraints()
        self.recipe_prompts: list[str] = []

    async def complete(self, prompt: str, response_schema: Any = None, **_: Any) -> Any:
        if response_schema is RecipeConstraints:
            return self.extraction
        if response_schema is LLMRecipeResult:
            self.recipe_prompts.append(prompt)
            return LLMRecipeResult(
                title="Generated Dish",
                ingredients=[{"name": "rice", "quantity": 1, "unit": "cup"}],
                instructions=["Cook it."],
                confidence=0.9,
            )
        raise AssertionError(f"unexpected schema {response_schema}")

    def generated_constraints(self) -> dict[str, Any]:
        """The constraints JSON the grounded generator was actually called with."""
        assert self.recipe_prompts, "the generator was never called"
        for line in self.recipe_prompts[-1].splitlines():
            if line.startswith("Constraints: "):
                parsed: dict[str, Any] = json.loads(line[len("Constraints: ") :])
                return parsed
        raise AssertionError("no Constraints line in the grounded prompt")


@contextmanager
def _env(stored: list[str], ai: _FakeAI) -> Iterator[None]:
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    with (
        patch(STORED, AsyncMock(return_value=stored)),
        patch(f"{_NODES}.get_ai_manager", MagicMock(return_value=ai)),
        patch(f"{_NODES}.get_repository", AsyncMock(return_value=repo)),
        patch(f"{_NODES}.search_recipe", AsyncMock(return_value=None)),
    ):
        yield


def _base_state(text: str, session: dict[str, Any] | None = None, **extra: Any) -> dict[str, Any]:
    return {
        "input_text": text,
        "user_id": USER,
        "errors": [],
        "warnings": [],
        "session": session,
        **extra,
    }


async def _direct_turn(
    text: str,
    stored: list[str],
    extraction: RecipeConstraints | None = None,
) -> tuple[dict[str, Any], _FakeAI]:
    """The direct card path in its real node order."""
    ai = _FakeAI(extraction)
    state: Any = _base_state(text)
    with _env(stored, ai):
        for node in (
            extract_recipe_constraints,
            score_pantry_ingredients,
            research_recipe,
            generate_grounded_recipe,
        ):
            state = await node(state)
    return dict(state), ai


def _pick_session(**constraints: Any) -> dict[str, Any]:
    return {"metadata": {"recipe_constraints": constraints}}


async def _pick_turn(
    name: str, stored: list[str], session: dict[str, Any] | None
) -> tuple[dict[str, Any], _FakeAI]:
    """A brainstorm pick: research -> generate, extract bypassed."""
    ai = _FakeAI()
    with _env(stored, ai):
        state: Any = _base_state(name, session, selected_recipe_name=name)
        state = await research_recipe(state)
        state = await generate_grounded_recipe(state)
    return dict(state), ai


def _card_of(state: dict[str, Any]) -> RecipeCard:
    card = state["proposal"].recipe
    assert isinstance(card, RecipeCard)
    return card


def _card_dict(
    title: str = "Veggie Chili",
    ingredients: tuple[str, ...] = ("kidney beans", "tomato"),
    **extra: Any,
) -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "title": title,
        "ingredients": [{"name": n, "quantity": 1, "unit": "cup"} for n in ingredients],
        "instructions": ["Cook."],
        **extra,
    }


def _followup_response() -> GenerateRecipeResponse:
    # A refined card as the generator builds it: no dietary_tags, no diets_set_aside.
    return GenerateRecipeResponse(
        recipe=RecipeCard(title="Refined Dish", instructions=["Cook."]),
        ingredients_status=[IngredientStatus(ingredient_name="rice", status="have")],
        missing_count=0,
        have_count=1,
        partial_count=0,
        pantry_match_score=1.0,
    )


async def _refine(
    card: dict[str, Any],
    tweak: str,
    stored: list[str],
    prior: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], AsyncMock]:
    """One chat refine turn against `card`; returns (result state, generator mock)."""
    gen = AsyncMock(return_value=_followup_response())
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    metadata: dict[str, Any] = {"picked_recipe": card}
    if prior is not None:
        metadata["recipe_constraints"] = prior
    state: Any = _base_state(tweak, {"metadata": metadata})
    if prior is not None:
        state["recipe_constraints"] = prior
    with (
        patch(STORED, AsyncMock(return_value=stored)),
        patch(f"{_NODES}._generate_recipe_followup", gen),
        patch(f"{_NODES}.get_repository", AsyncMock(return_value=repo)),
        patch(f"{_NODES}.get_ai_manager", MagicMock()),
    ):
        result = await refine_recipe_node(state)
    return dict(result), gen


def _sent(gen: AsyncMock) -> dict[str, Any]:
    """The `constraints` kwarg the refine handed the generator."""
    gen.assert_awaited_once()
    constraints: dict[str, Any] = gen.await_args.kwargs["constraints"]
    return constraints


# ---------------------------------------------------------------------------
# Two chat turns keep the diet
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("tagged", [True, False])
async def test_two_refines_keep_the_diet_without_relying_on_tags(tagged: bool) -> None:
    card = _card_dict(dietary_tags=["vegetarian"] if tagged else [])

    first, gen1 = await _refine(card, "make it spicier", ["Vegetarian"])
    assert _sent(gen1)["dietary"] == ["Vegetarian"]

    # The refined card has no dietary_tags (the generator never carries them),
    # so the second refine proves the fix doesn't depend on tags.
    refined = _card_of(first)
    assert refined.dietary_tags == []
    second, gen2 = await _refine(
        refined.model_dump(mode="json"), "make it heartier", ["Vegetarian"]
    )
    assert _sent(gen2)["dietary"] == ["Vegetarian"]


# ---------------------------------------------------------------------------
# The first turn's set-aside carries
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chicken_curry_first_turn_is_not_generated_under_vegetarian() -> None:
    state, ai = await _direct_turn("chicken curry", ["Vegetarian"])

    assert "dietary" not in ai.generated_constraints()  # fails on main: research re-applies it
    assert _card_of(state).diets_set_aside == ["Vegetarian"]


@pytest.mark.asyncio
async def test_first_turn_set_aside_carries_through_every_later_tweak() -> None:
    first, _ = await _direct_turn("chicken curry", ["Vegetarian"])
    card = _card_of(first)
    prior = first["recipe_constraints"]

    second, gen2 = await _refine(card.model_dump(mode="json"), "make it spicier", ["Vegetarian"], prior)
    assert "dietary" not in _sent(gen2)
    refined = _card_of(second)
    assert refined.diets_set_aside == ["Vegetarian"]
    assert refined.id == card.id

    third, gen3 = await _refine(refined.model_dump(mode="json"), "make it quicker", ["Vegetarian"], prior)
    assert "dietary" not in _sent(gen3)
    assert _card_of(third).diets_set_aside == ["Vegetarian"]


@pytest.mark.asyncio
async def test_a_diet_the_tweak_names_is_sent_even_though_the_card_carries_it_aside() -> None:
    first, _ = await _direct_turn("chicken curry", ["Vegetarian"])
    card = _card_of(first)

    second, gen = await _refine(
        card.model_dump(mode="json"), "actually make it vegetarian", ["Vegetarian"],
        first["recipe_constraints"],
    )

    assert _sent(gen)["dietary"] == ["Vegetarian"]
    # For that reply only: the card still records the first turn's decision.
    assert _card_of(second).diets_set_aside == ["Vegetarian"]


# ---------------------------------------------------------------------------
# The one definition of diets_set_aside, via the real node order
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_vegan_mac_and_cheese_is_covered_by_the_final_diet() -> None:
    extraction = RecipeConstraints(dietary=["Vegan"])
    state, ai = await _direct_turn("vegan mac and cheese", ["Vegan"], extraction)

    # extract set the stored label aside (it names cheese) but the turn's own
    # ["Vegan"] stays in the final diet, so nothing is "set aside".
    assert ai.generated_constraints()["dietary"] == ["Vegan"]
    assert _card_of(state).diets_set_aside == []

    second, gen = await _refine(
        _card_of(state).model_dump(mode="json"),
        "make it creamier",
        ["Vegan"],
        state["recipe_constraints"],
    )
    assert _sent(gen)["dietary"] == ["Vegan"]
    assert _card_of(second).diets_set_aside == []


@pytest.mark.asyncio
async def test_gluten_free_chicken_ideas_then_a_chicken_pick() -> None:
    stored = ["Vegetarian"]
    ai = _FakeAI(RecipeConstraints(dietary=["Gluten-free"]))
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    stored_session = ConversationSession(conversation_id="conv-544")
    repo.get_or_create_session = AsyncMock(return_value=stored_session)
    repo.update_session = AsyncMock(return_value=None)

    # Turn 1: the brainstorm. Extract sets Vegetarian aside for "chicken".
    with _env(stored, ai):
        state: Any = _base_state("gluten-free chicken ideas", conversation_id="conv-544")
        state = await extract_recipe_constraints(state)
    assert state["recipe_constraints"]["dietary"] == ["Gluten-free"]
    state = {
        **state,
        "intent": Intent.RECIPE_BRAINSTORM.value,
        "next_action": NextAction.PICK_RECIPE.value,
        "brainstorm_ideas": ["Gluten-Free Chicken Stir-Fry"],
    }
    with patch("bubbly_chef.workflows.router.get_repository", AsyncMock(return_value=repo)):
        await update_session_node(state)
    persisted = repo.update_session.await_args.args[1].model_dump(mode="json")

    # Turn 2: the pick, from the persisted session.
    picked, ai2 = await _pick_turn("Gluten-Free Chicken Stir-Fry", stored, persisted)
    assert ai2.generated_constraints()["dietary"] == ["Gluten-free"]
    assert _card_of(picked).diets_set_aside == ["Vegetarian"]


@pytest.mark.asyncio
async def test_chicken_tikka_pick_sets_vegetarian_aside() -> None:
    session = _pick_session(dietary=[], cuisine="indian")
    state, ai = await _pick_turn("Chicken Tikka", ["Vegetarian"], session)

    assert "dietary" not in ai.generated_constraints()  # fails on main
    assert _card_of(state).diets_set_aside == ["Vegetarian"]


@pytest.mark.asyncio
async def test_tofu_pick_gets_vegetarian_back() -> None:
    # The #394 reassertion: a diet set aside by the brainstorm comes back once
    # the pick stops contradicting it.
    session = _pick_session(dietary=[], cuisine="asian")
    state, ai = await _pick_turn("Tofu Stir-Fry", ["Vegetarian"], session)

    assert ai.generated_constraints()["dietary"] == ["Vegetarian"]
    assert _card_of(state).diets_set_aside == []


@pytest.mark.asyncio
async def test_a_non_contradicting_pick_holds_both_stored_and_session_diets() -> None:
    session = _pick_session(dietary=["Gluten-free"])
    state, ai = await _pick_turn("Rice Noodle Salad", ["Vegan"], session)

    # _combine_dietary_preferences puts the surviving stored labels first.
    assert ai.generated_constraints()["dietary"] == ["Vegan", "Gluten-free"]
    assert _card_of(state).diets_set_aside == []


@pytest.mark.asyncio
@pytest.mark.parametrize("stored", [[], ["Vegetarian"]])
async def test_session_vegetarian_does_not_survive_a_chicken_tikka_pick(
    stored: list[str],
) -> None:
    session = _pick_session(dietary=["Vegetarian"], cuisine="indian")
    state, ai = await _pick_turn("Chicken Tikka", stored, session)

    assert "dietary" not in ai.generated_constraints()
    assert "dietary" not in state["recipe_constraints"]
    assert _card_of(state).diets_set_aside == stored


@pytest.mark.asyncio
async def test_session_vegetarian_is_kept_by_a_non_contradicting_pick() -> None:
    session = _pick_session(dietary=["Vegetarian"])
    state, ai = await _pick_turn("Tofu Stir-Fry", ["Vegetarian"], session)

    assert ai.generated_constraints()["dietary"] == ["Vegetarian"]
    assert _card_of(state).diets_set_aside == []


@pytest.mark.asyncio
async def test_stored_must_use_chicken_does_not_count_as_the_pick_naming_chicken() -> None:
    session = _pick_session(dietary=[], must_use_ingredients=["chicken"])
    state, ai = await _pick_turn("Tofu Stir-Fry", ["Vegetarian"], session)

    assert ai.generated_constraints()["dietary"] == ["Vegetarian"]  # the `{}` argument
    assert _card_of(state).diets_set_aside == []


@pytest.mark.asyncio
async def test_defensive_case_applies_the_stored_diet() -> None:
    state, ai = await _pick_turn("Lentil Soup", ["Vegetarian"], None)

    assert ai.generated_constraints()["dietary"] == ["Vegetarian"]
    assert _card_of(state).diets_set_aside == []


# ---------------------------------------------------------------------------
# (ii): the tweak adds a forbidden food
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_add_bacon_sets_vegetarian_aside_and_the_card_records_it() -> None:
    result, gen = await _refine(_card_dict(), "add bacon", ["Vegetarian"])

    assert "dietary" not in _sent(gen)
    assert "Vegetarian" in _card_of(result).diets_set_aside


@pytest.mark.asyncio
async def test_bacon_stays_allowed_on_the_next_tweak() -> None:
    first, _ = await _refine(_card_dict(), "add bacon", ["Vegetarian"])
    second, gen = await _refine(
        _card_of(first).model_dump(mode="json"), "make it spicier", ["Vegetarian"]
    )

    assert "dietary" not in _sent(gen)
    assert _card_of(second).diets_set_aside == ["Vegetarian"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tweak", "stored", "kept"),
    [
        ("substitute tofu for the chicken", ["Vegetarian"], True),
        ("swap the chicken for tofu", ["Vegetarian"], True),
        ("swap the tofu for chicken", ["Vegetarian"], False),
        ("no more cheese please", ["Vegan"], True),
        ("use chicken instead of tofu", ["Vegetarian"], False),
        ("tofu instead of chicken", ["Vegetarian"], True),
        ("skip the chicken", ["Vegetarian"], True),
        ("make it dairy free", ["Dairy-free"], True),
        ("add a little cheese", ["Dairy-free"], False),
        ("do not add meat", ["Vegetarian"], True),
        ("make it heartier, not with meat", ["Vegetarian"], True),
        ("never add chicken", ["Vegetarian"], True),
        ("dont add chicken", ["Vegetarian"], True),
        ("exclude the chicken", ["Vegetarian"], True),
        ("omit the bacon", ["Vegetarian"], True),
        ("get rid of the chicken", ["Vegetarian"], True),
        # Plant-based phrases are not added forbidden food.
        ("add coconut milk", ["Vegan"], True),
        ("add oat milk", ["Vegan"], True),
        ("finish with cashew cream", ["Vegan"], True),
        ("add vegan cheese", ["Vegan"], True),
        ("add tempeh bacon", ["Vegetarian"], True),
        ("add bacon", ["Vegetarian"], False),
        # "non-vegetarian" / "not vegetarian" name the label to reject it.
        ("make it non-vegetarian, add chicken", ["Vegetarian"], False),
        ("make it not vegetarian, add chicken", ["Vegetarian"], False),
        ("make it vegetarian", ["Vegetarian"], True),
    ],
)
async def test_tweak_adds_a_forbidden_food_only_when_it_really_adds_it(
    tweak: str, stored: list[str], kept: bool
) -> None:
    _, gen = await _refine(_card_dict(), tweak, stored)

    sent = _sent(gen)
    if kept:
        assert sent["dietary"] == stored
    else:
        assert "dietary" not in sent


# ---------------------------------------------------------------------------
# _diets_set_aside: the one definition
# ---------------------------------------------------------------------------


def test_diets_set_aside_a_final_vegan_covers_a_stored_vegetarian() -> None:
    assert _diets_set_aside(["Vegetarian"], ["Vegan"]) == []
    assert _diets_set_aside(["Vegetarian", "Nut-free"], ["Vegan"]) == ["Nut-free"]
    # Not the other way round: a final Vegetarian doesn't cover a stored Vegan.
    assert _diets_set_aside(["Vegan"], ["Vegetarian"]) == ["Vegan"]


def test_diets_set_aside_ignores_case_spaces_and_hyphens() -> None:
    assert _diets_set_aside(["gluten free"], ["Gluten-Free"]) == []
    assert _diets_set_aside(["Gluten-Free"], ["gluten_free"]) == []
    assert _diets_set_aside(["Dairy-free"], ["Vegetarian"]) == ["Dairy-free"]
    assert _diets_set_aside(["Vegetarian"], []) == ["Vegetarian"]


# ---------------------------------------------------------------------------
# added_text (pure)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("tweak", "present", "absent"),
    [
        ("add bacon", "bacon", None),
        ("no more cheese please", None, "cheese"),
        ("without cheese", None, "cheese"),
        ("make it dairy free", None, "dairy"),
        ("make it meat-free", None, "meat"),
        ("gluten-free chicken stir fry", "chicken", "gluten"),
        ("use chicken instead of tofu", "chicken", "tofu"),
        ("instead of tofu use chicken", "chicken", "tofu"),
        ("tofu instead of chicken", "tofu", "chicken"),
        ("swap the chicken for tofu", "tofu", "chicken"),
        ("swap the tofu for chicken", "chicken", "tofu"),
        ("replace the beef with mushrooms", "mushrooms", "beef"),
        ("substitute tofu for the chicken", None, "chicken"),
        ("substitute tofu for the chicken", None, "tofu"),
        ("sub tofu for chicken", None, "chicken"),
        ("substitute tofu for chicken and add bacon", "add bacon", "chicken"),
        ("no chicken, but add bacon", "add bacon", "chicken"),
        ("add a submarine roll", "submarine", None),
        ("skip the chicken", None, "chicken"),
        ("hold the bacon", None, "bacon"),
        ("take out the bacon", None, "bacon"),
        ("leave out the bacon", None, "bacon"),
        ("drop the ham", None, "ham"),
        ("lose the cheese", None, "cheese"),
        ("minus the butter", None, "butter"),
        ("less cheese", None, "cheese"),
        ("fewer eggs", None, "eggs"),
        ("cut the bacon", None, "bacon"),
        ("don't add chicken", None, "chicken"),
        ("remove the chicken", None, "chicken"),
        ("avoid nuts", None, "nuts"),
        ("do not add meat", None, "meat"),
        ("make it heartier, not with meat", "heartier", "meat"),
        ("never add chicken", None, "chicken"),
        ("dont add chicken", None, "chicken"),
        ("exclude the chicken", None, "chicken"),
        ("omit the bacon", None, "bacon"),
        ("get rid of the chicken", None, "chicken"),
        ("take away the ham", None, "ham"),
        # Plant-based foods are not the food they're named after (refine-only).
        ("add coconut milk", None, "milk"),
        ("add oat milk", None, "milk"),
        ("finish with cashew cream", None, "cream"),
        ("add vegan cheese", None, "cheese"),
        ("add dairy free cheese", None, "cheese"),
        ("add tempeh bacon", None, "bacon"),
        ("add veggie sausage", None, "sausage"),
        ("add bacon", "bacon", None),
        ("add cheese and oat milk", "cheese", "milk"),
        ("add tofu and chicken", "chicken", "tofu"),
    ],
)
def test_added_text(tweak: str, present: str | None, absent: str | None) -> None:
    result = added_text(tweak)
    if present:
        assert present in result
    if absent:
        assert absent not in result


@pytest.mark.parametrize(
    ("tweak", "present", "absent"),
    [
        ("cut the salt and add pancetta", "pancetta", "salt"),
        ("less cheese and add bacon", "bacon", "cheese"),
        ("skip the onion and add chorizo", "chorizo", "onion"),
        ("no chicken and bacon", None, "bacon"),
        ("no chicken and bacon", None, "chicken"),
        ("hold the mayo and then use ham", "ham", "mayo"),
    ],
)
def test_a_negation_ends_at_an_adding_verb_but_not_at_a_bare_and(
    tweak: str, present: str | None, absent: str
) -> None:
    result = added_text(tweak)
    if present:
        assert present in result
    assert absent not in result


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tweak", "kept"),
    [
        ("cut the salt and add ham", False),
        ("less cheese and add bacon", False),
        ("skip the onion and add sausage", False),
        ("no chicken and bacon", True),
    ],
)
async def test_negation_span_decides_whether_the_diet_survives_the_tweak(
    tweak: str, kept: bool
) -> None:
    _, gen = await _refine(_card_dict(), tweak, ["Vegetarian"])

    if kept:
        assert _sent(gen)["dietary"] == ["Vegetarian"]
    else:
        assert "dietary" not in _sent(gen)


# ---------------------------------------------------------------------------
# Exclusions
# ---------------------------------------------------------------------------


async def _exclusions(tweak: str, previous: RecipeCard | None = None) -> list[str]:
    with patch(STORED, AsyncMock(return_value=[])):
        constraints, _, _ = await refine_dietary_constraints(
            USER, tweak, {"excluded_ingredients": ["peanuts"]}, previous
        )
    excluded: list[str] = constraints.get("excluded_ingredients", [])
    return excluded


@pytest.mark.asyncio
async def test_exclusion_is_dropped_when_the_tweak_adds_it() -> None:
    assert await _exclusions("add peanuts") == []


@pytest.mark.asyncio
async def test_exclusion_is_kept_when_the_tweak_negates_it() -> None:
    assert await _exclusions("no peanuts please") == ["peanuts"]


@pytest.mark.asyncio
async def test_exclusion_is_dropped_when_an_earlier_tweak_added_it() -> None:
    card = RecipeCard(title="Satay", exclusions_set_aside=["peanuts"])
    assert await _exclusions("make it spicier", card) == []


@pytest.mark.asyncio
async def test_exclusion_is_not_dropped_because_the_card_contains_it() -> None:
    # A first-turn model ignoring "no peanuts" looks the same as a deliberate
    # add; letting it silently delete an allergen exclusion is the worse failure.
    card = RecipeCard(title="Satay", ingredients=[Ingredient(name="peanuts")])
    assert await _exclusions("make it spicier", card) == ["peanuts"]


@pytest.mark.asyncio
async def test_no_peanuts_first_turn_is_still_sent_when_the_card_has_peanuts() -> None:
    card = _card_dict("Satay", ingredients=("peanuts", "noodles"))
    prior = {"excluded_ingredients": ["peanuts"]}

    result, gen = await _refine(card, "make it spicier", [], prior)

    assert _sent(gen)["excluded_ingredients"] == ["peanuts"]
    assert "Never use: peanuts" in format_followup_dietary(_sent(gen))
    assert _card_of(result).exclusions_set_aside == []


@pytest.mark.asyncio
async def test_add_peanuts_sets_the_exclusion_aside_and_it_carries() -> None:
    prior = {"excluded_ingredients": ["peanuts"]}
    card = _card_dict("Noodles", ingredients=("noodles",))

    first, gen1 = await _refine(card, "add peanuts", [], prior)
    assert "excluded_ingredients" not in _sent(gen1)
    refined = _card_of(first)
    assert refined.exclusions_set_aside == ["peanuts"]

    second, gen2 = await _refine(
        refined.model_dump(mode="json"), "make it spicier", [], prior
    )
    assert "excluded_ingredients" not in _sent(gen2)
    assert _card_of(second).exclusions_set_aside == ["peanuts"]


@pytest.mark.asyncio
async def test_exclusion_is_kept_on_a_recipe_without_it() -> None:
    card = RecipeCard(title="Chili", ingredients=[Ingredient(name="beans")])
    assert await _exclusions("make it spicier", card) == ["peanuts"]


# ---------------------------------------------------------------------------
# Not persisted; round trip
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_refine_set_aside_is_never_written_back_to_the_session() -> None:
    prior = {"dietary": ["Vegetarian"]}
    result, _ = await _refine(_card_dict(), "add bacon", ["Vegetarian"], prior)

    # Returned exactly as it came in.
    assert result["recipe_constraints"] == {"dietary": ["Vegetarian"]}

    session = ConversationSession(conversation_id="conv-544")
    repo = MagicMock()
    repo.get_or_create_session = AsyncMock(return_value=session)
    repo.update_session = AsyncMock(return_value=None)
    result["conversation_id"] = "conv-544"
    with patch("bubbly_chef.workflows.router.get_repository", AsyncMock(return_value=repo)):
        await update_session_node(result)  # type: ignore[arg-type]

    saved = repo.update_session.await_args.args[1]
    assert saved.metadata.recipe_constraints.dietary == ["Vegetarian"]
    assert saved.metadata.picked_recipe.diets_set_aside == ["Vegetarian"]


def test_session_round_trips_diets_set_aside() -> None:
    card = RecipeCard(title="Chicken Curry", diets_set_aside=["Vegetarian"])
    dumped = SessionContext(picked_recipe=card).model_dump(mode="json")

    restored = SessionContext.model_validate(dumped)

    assert restored.picked_recipe is not None
    assert restored.picked_recipe.diets_set_aside == ["Vegetarian"]


def test_an_old_session_without_the_field_validates_as_empty() -> None:
    dumped = SessionContext(picked_recipe=RecipeCard(title="Old")).model_dump(mode="json")
    del dumped["picked_recipe"]["diets_set_aside"]

    restored = SessionContext.model_validate(dumped)

    assert restored.picked_recipe is not None
    assert restored.picked_recipe.diets_set_aside == []


# ---------------------------------------------------------------------------
# Library route: POST /v1/recipes/refine
# ---------------------------------------------------------------------------

_ROUTE = "bubbly_chef.api.routes.recipes_ai"


@pytest.fixture
def app() -> Any:
    _app = create_app()

    async def _fake_user_id() -> str:
        return USER

    _app.dependency_overrides[get_current_user_id] = _fake_user_id
    return _app


@pytest_asyncio.fixture
async def client(app: Any) -> Any:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _route_result() -> GenerateRecipeResponse:
    """A real generator response: a refined card with no tags, as the model builds it."""
    return _followup_response()


async def _post_refine(
    client: Any, recipe: dict[str, Any], prompt: str, stored: list[str], gen: AsyncMock
) -> Any:
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    with (
        patch(STORED, AsyncMock(return_value=stored)),
        patch(f"{_ROUTE}.get_repository", AsyncMock(return_value=repo)),
        patch("bubbly_chef.services.recipe_generator.generate_recipe", gen),
        patch("bubbly_chef.api.deps.get_ai_manager", MagicMock()),
    ):
        response = await client.post(
            "/v1/recipes/refine", json={"recipe": recipe, "prompt": prompt}
        )
    assert response.status_code == 200, response.text
    return response


async def _library_refine(
    client: Any, recipe: dict[str, Any], prompt: str, stored: list[str]
) -> AsyncMock:
    gen = AsyncMock(side_effect=lambda **_: _route_result())
    response = await _post_refine(client, recipe, prompt, stored, gen)
    # The real serialisation of a real RecipeCard: the chat-only field is excluded.
    assert "diets_set_aside" not in response.json()["recipe"]
    assert "exclusions_set_aside" not in response.json()["recipe"]
    return gen


def _library_constraints(gen: AsyncMock) -> dict[str, Any]:
    gen.assert_awaited_once()
    constraints: dict[str, Any] = gen.await_args.kwargs["constraints"]
    return constraints


@pytest.mark.asyncio
async def test_library_refine_with_no_recipe_still_sends_the_stored_diet(client: Any) -> None:
    ai = MagicMock()
    ai.complete = AsyncMock(
        return_value=AIRecipeOutput(
            title="Veg Dish",
            description="d",
            ingredients=[AIRecipeIngredient(name="rice")],
            instructions=["Cook."],
        )
    )
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    with (
        patch(STORED, AsyncMock(return_value=["Vegetarian"])),
        patch(f"{_ROUTE}.get_repository", AsyncMock(return_value=repo)),
        patch("bubbly_chef.api.deps.get_ai_manager", MagicMock(return_value=ai)),
    ):
        response = await client.post(
            "/v1/recipes/refine", json={"recipe": {}, "prompt": "make it quicker"}
        )

    assert response.status_code == 200, response.text
    prompt = ai.complete.await_args.kwargs["prompt"]
    assert "Dietary requirements: Vegetarian" in prompt  # fails on main


@pytest.mark.asyncio
async def test_library_refine_of_a_chicken_recipe_does_not_force_vegetarian(client: Any) -> None:
    recipe = _card_dict("Roast Chicken", ingredients=("whole chicken", "lemon"))
    gen = await _library_refine(client, recipe, "make it quicker", ["Vegetarian"])

    assert "dietary" not in _library_constraints(gen)


@pytest.mark.asyncio
async def test_library_refine_of_a_tofu_recipe_keeps_the_diet(client: Any) -> None:
    recipe = _card_dict("Tofu Stir-Fry", ingredients=("tofu", "broccoli"))
    gen = await _library_refine(client, recipe, "add more protein", ["Vegetarian"])

    assert _library_constraints(gen)["dietary"] == ["Vegetarian"]


@pytest.mark.asyncio
async def test_library_refine_of_a_tagged_row_keeps_the_diet_despite_a_matcher_misfire(
    client: Any,
) -> None:
    # "tempeh bacon" trips the existing matcher on `bacon`; the row's tag wins.
    row = _card_dict("Tempeh BLT", ingredients=("tempeh bacon", "lettuce"))
    row["tags"] = ["Vegetarian"]
    gen = await _library_refine(client, row, "make it quicker", ["Vegetarian"])

    assert _library_constraints(gen)["dietary"] == ["Vegetarian"]


@pytest.mark.asyncio
async def test_library_refine_without_the_tag_drops_the_misfiring_diet(client: Any) -> None:
    row = _card_dict("Tempeh BLT", ingredients=("tempeh bacon", "lettuce"))
    gen = await _library_refine(client, row, "make it quicker", ["Vegetarian"])

    assert "dietary" not in _library_constraints(gen)


@pytest.mark.asyncio
async def test_a_stricter_tag_keeps_the_looser_stored_diet(client: Any) -> None:
    # A "vegan" tag rescues a stored Vegetarian (_DIETARY_SUBSUMES).
    row = _card_dict("Tempeh BLT", ingredients=("tempeh bacon", "lettuce"))
    row["tags"] = ["vegan"]
    gen = await _library_refine(client, row, "make it quicker", ["Vegetarian"])

    assert _library_constraints(gen)["dietary"] == ["Vegetarian"]


@pytest.mark.asyncio
async def test_chained_library_refines_keep_the_diet_through_the_carried_tag(
    client: Any,
) -> None:
    row = _card_dict("Tempeh BLT", ingredients=("tempeh bacon", "lettuce"))
    row["tags"] = ["vegetarian"]

    gen1 = AsyncMock(side_effect=lambda **_: _route_result())
    first = await _post_refine(client, row, "make it quicker", ["Vegetarian"], gen1)
    assert _library_constraints(gen1)["dietary"] == ["Vegetarian"]

    # The generator returned a card with no tags; the route carried the row's.
    refined = first.json()["recipe"]
    assert refined["dietary_tags"] == ["vegetarian"]
    assert "diets_set_aside" not in refined

    # Feed the refined card back in: the tag still protects the diet.
    refined["ingredients"] = row["ingredients"]  # the stub generator returns none
    gen2 = AsyncMock(side_effect=lambda **_: _route_result())
    second = await _post_refine(client, refined, "make it heartier", ["Vegetarian"], gen2)
    assert _library_constraints(gen2)["dietary"] == ["Vegetarian"]
    assert second.json()["recipe"]["dietary_tags"] == ["vegetarian"]


@pytest.mark.asyncio
async def test_a_library_tweak_that_sets_the_diet_aside_drops_the_carried_tag(
    client: Any,
) -> None:
    row = _card_dict("Tempeh BLT", ingredients=("tempeh bacon", "lettuce"))
    row["tags"] = ["vegetarian"]
    gen = AsyncMock(side_effect=lambda **_: _route_result())

    response = await _post_refine(client, row, "add bacon", ["Vegetarian"], gen)

    assert "dietary" not in _library_constraints(gen)
    assert response.json()["recipe"]["dietary_tags"] == []


# ---------------------------------------------------------------------------
# Generator + prompt
# ---------------------------------------------------------------------------


def _ai_recording_prompt() -> tuple[MagicMock, list[str]]:
    prompts: list[str] = []

    async def _complete(prompt: str, **_: Any) -> AIRecipeOutput:
        prompts.append(prompt)
        return AIRecipeOutput(
            title="Dish",
            description="d",
            ingredients=[AIRecipeIngredient(name="rice")],
            instructions=["Cook."],
        )

    ai = MagicMock()
    ai.complete = _complete
    return ai, prompts


@pytest.mark.asyncio
async def test_followup_prompt_carries_the_diet_right_after_the_modify_line() -> None:
    ai, prompts = _ai_recording_prompt()
    previous = RecipeCard(title="Chili", instructions=["Cook."])

    await generate_recipe(
        prompt="make it spicier",
        pantry_items=[],
        ai_manager=ai,
        previous_recipe=previous,
        constraints={"dietary": ["Vegan"], "excluded_ingredients": ["peanuts"]},
    )

    prompt = prompts[0]
    modify = prompt.index("Modify the recipe according to the user's request.")
    diet = prompt.index("Dietary requirements: Vegan")
    never = prompt.index("Never use: peanuts")
    assert modify < diet < never
    assert "Example of the output format only (not a recipe to copy):" in prompt


@pytest.mark.asyncio
async def test_followup_prompt_has_no_dietary_block_without_constraints() -> None:
    ai, prompts = _ai_recording_prompt()

    await generate_recipe(
        prompt="make it spicier",
        pantry_items=[],
        ai_manager=ai,
        previous_recipe=RecipeCard(title="Chili", instructions=["Cook."]),
    )

    assert "Dietary Requirements" not in prompts[0]


def test_format_followup_dietary_omits_empty_lists() -> None:
    assert format_followup_dietary(None) == ""
    assert format_followup_dietary({}) == ""
    only_diet = format_followup_dietary({"dietary": ["Vegan"]})
    assert "Dietary requirements: Vegan" in only_diet
    assert "Never use" not in only_diet
    only_excluded = format_followup_dietary({"excluded_ingredients": ["peanuts"]})
    assert "Never use: peanuts" in only_excluded
    assert "Dietary requirements" not in only_excluded


def test_followup_prompt_template_has_the_dietary_slot() -> None:
    assert "{dietary_requirements}" in RECIPE_FOLLOWUP_PROMPT
