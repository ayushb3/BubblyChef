"""Issues #579 and #535: a refine edits the card, it doesn't regenerate it.

#579: refining a picked recipe swapped ingredients the user never mentioned
(Pasta -> Spaghetti, Butter -> Olive Oil) because the card was replaced by the
model's fully regenerated list. #535: a second tweak ("no cheese") dropped the
first tweak's addition (mushrooms); live repro runs could not isolate it from
the same drift, so it is pinned here the same way.

The model now reports what the instruction touched (`added` / `removed` /
`changed` on `AIRecipeRefineOutput`) and only those edits are applied onto the
previous card. Every model here is a scripted fake, so these tests need no
provider: they feed the *drifted* full list a real model produces and assert
the card still comes out right.
"""

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
from bubbly_chef.models.recipe import Ingredient, RecipeCard
from bubbly_chef.models.session import ConversationSession
from bubbly_chef.prompts.recipe import RECIPE_FOLLOWUP_PROMPT
from bubbly_chef.services.recipe_generator import (
    AIRecipeIngredient,
    AIRecipeRefineOutput,
    generate_recipe,
)
from bubbly_chef.services.recipe_refine import apply_ingredient_edits
from bubbly_chef.workflows.recipe.nodes import refine_recipe_node
from bubbly_chef.workflows.router import update_session_node

_NODES = "bubbly_chef.workflows.recipe.nodes"
_ROUTE = "bubbly_chef.api.routes.recipes_ai"
USER = "user-579"


def _ai_ing(
    name: str, quantity: float | None = None, unit: str | None = None
) -> AIRecipeIngredient:
    return AIRecipeIngredient(name=name, quantity=quantity, unit=unit)


def _card(**overrides: Any) -> RecipeCard:
    """The picked recipe from the issue's screenshots."""
    fields: dict[str, Any] = {
        "id": uuid4(),
        "title": "Creamy Carrot Pasta Bake",
        "description": "A cosy bake.",
        "ingredients": [
            Ingredient(name="Pasta", quantity=300, unit="g"),
            Ingredient(name="Butter", quantity=2, unit="tbsp"),
            Ingredient(name="Carrots", quantity=3, unit=None, preparation="grated"),
            Ingredient(name="Parmesan cheese", quantity=50, unit="g"),
            Ingredient(name="Cheddar cheese", quantity=100, unit="g"),
        ],
        "instructions": [
            "Boil the pasta.",
            "Melt the butter and soften the carrots.",
            "Stir in the cheese and bake.",
        ],
    }
    fields.update(overrides)
    return RecipeCard(**fields)


def _dump(ingredients: list[Ingredient]) -> list[str]:
    return [i.model_dump_json() for i in ingredients]


def _drifted_output(**overrides: Any) -> AIRecipeRefineOutput:
    """What the model really returned in #579: the whole list regenerated, with
    Pasta -> Spaghetti and Butter -> Olive Oil nobody asked for."""
    fields: dict[str, Any] = {
        "title": "Creamy Carrot Spaghetti Bake",
        "description": "A cosy bake.",
        "ingredients": [
            _ai_ing("Spaghetti", 300, "g"),
            _ai_ing("Olive Oil", 2, "tbsp"),
            _ai_ing("Carrots", 3),
            _ai_ing("Parmesan cheese", 50, "g"),
            _ai_ing("Cheddar cheese", 100, "g"),
            _ai_ing("Mushrooms", 150, "g"),
        ],
        "instructions": [
            "Boil the spaghetti.",
            "Heat the olive oil and soften the carrots and mushrooms.",
            "Stir in the cheese and bake.",
        ],
    }
    fields.update(overrides)
    return AIRecipeRefineOutput(**fields)


def _ai_returning(*outputs: AIRecipeRefineOutput) -> MagicMock:
    ai = MagicMock()
    ai.complete = AsyncMock(side_effect=list(outputs))
    return ai


# ---------------------------------------------------------------------------
# generate_recipe: the engine behind chat refine, library refine and meal dishes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unrelated_tweak_leaves_every_other_ingredient_byte_identical() -> None:
    previous = _card()
    ai = _ai_returning(_drifted_output(added=[_ai_ing("Mushrooms", 150, "g")]))

    result = await generate_recipe(
        prompt="add mushrooms", pantry_items=[], ai_manager=ai, previous_recipe=previous
    )

    refined = result.recipe.ingredients
    assert _dump(refined[:5]) == _dump(previous.ingredients)  # fails on main
    assert [i.name for i in refined] == [
        "Pasta",
        "Butter",
        "Carrots",
        "Parmesan cheese",
        "Cheddar cheese",
        "Mushrooms",
    ]
    assert refined[5].quantity == 150


@pytest.mark.asyncio
async def test_the_availability_report_describes_the_preserved_list() -> None:
    previous = _card()
    ai = _ai_returning(_drifted_output(added=[_ai_ing("Mushrooms", 150, "g")]))

    result = await generate_recipe(
        prompt="add mushrooms", pantry_items=[], ai_manager=ai, previous_recipe=previous
    )

    names = [s.ingredient_name for s in result.ingredients_status]
    assert "Pasta" in names and "Spaghetti" not in names  # fails on main


@pytest.mark.asyncio
async def test_a_model_that_reports_no_edits_changes_no_ingredient() -> None:
    previous = _card()
    ai = _ai_returning(_drifted_output(title="Cosier Bake"))

    result = await generate_recipe(
        prompt="make the title cosier", pantry_items=[], ai_manager=ai, previous_recipe=previous
    )

    assert _dump(result.recipe.ingredients) == _dump(previous.ingredients)  # fails on main
    assert result.recipe.title == "Cosier Bake"


@pytest.mark.asyncio
async def test_removed_ingredients_go_and_the_rest_are_untouched() -> None:
    previous = _card()
    ai = _ai_returning(
        _drifted_output(
            removed=["Parmesan cheese", "Cheddar cheese"],
            instructions=[
                "Boil the pasta.",
                "Melt the butter and soften the carrots.",
                "Bake until golden.",
            ],
        )
    )

    result = await generate_recipe(
        prompt="no cheese", pantry_items=[], ai_manager=ai, previous_recipe=previous
    )

    assert _dump(result.recipe.ingredients) == _dump(previous.ingredients[:3])  # fails on main


@pytest.mark.asyncio
async def test_a_shortened_removal_name_reaches_every_matching_ingredient() -> None:
    previous = _card()
    ai = _ai_returning(
        _drifted_output(removed=["cheese"], instructions=["Boil.", "Fry.", "Bake until golden."])
    )

    result = await generate_recipe(
        prompt="no cheese", pantry_items=[], ai_manager=ai, previous_recipe=previous
    )

    assert [i.name for i in result.recipe.ingredients] == ["Pasta", "Butter", "Carrots"]


@pytest.mark.asyncio
async def test_a_changed_amount_keeps_the_name_and_position() -> None:
    previous = _card()
    ai = _ai_returning(
        _drifted_output(changed=[_ai_ing("Carrots", 6)], instructions=previous.instructions)
    )

    result = await generate_recipe(
        prompt="double the carrots", pantry_items=[], ai_manager=ai, previous_recipe=previous
    )

    refined = result.recipe.ingredients
    assert [i.name for i in refined] == [i.name for i in previous.ingredients]
    assert refined[2].quantity == 6
    # The carrots' other details are the model's new values; the rest are identical.
    assert _dump(refined[:2]) == _dump(previous.ingredients[:2])
    assert _dump(refined[3:]) == _dump(previous.ingredients[3:])


@pytest.mark.asyncio
async def test_a_change_naming_the_wrong_ingredient_is_ignored_not_guessed() -> None:
    previous = _card()
    ai = _ai_returning(
        _drifted_output(changed=[_ai_ing("Saffron", 9)], instructions=previous.instructions)
    )

    result = await generate_recipe(
        prompt="more saffron", pantry_items=[], ai_manager=ai, previous_recipe=previous
    )

    assert _dump(result.recipe.ingredients) == _dump(previous.ingredients)


@pytest.mark.asyncio
async def test_a_swap_is_a_removal_plus_an_addition() -> None:
    previous = _card()
    ai = _ai_returning(
        _drifted_output(
            removed=["Butter"],
            added=[_ai_ing("Olive Oil", 2, "tbsp")],
            instructions=["Boil.", "Heat the olive oil and soften the carrots.", "Bake."],
        )
    )

    result = await generate_recipe(
        prompt="swap the butter for olive oil",
        pantry_items=[],
        ai_manager=ai,
        previous_recipe=previous,
    )

    assert [i.name for i in result.recipe.ingredients] == [
        "Pasta",
        "Carrots",
        "Parmesan cheese",
        "Cheddar cheese",
        "Olive Oil",
    ]


@pytest.mark.asyncio
async def test_a_removal_of_butter_does_not_take_peanut_butter() -> None:
    previous = _card(
        ingredients=[Ingredient(name="Butter"), Ingredient(name="Peanut butter")],
        instructions=["Cook."],
    )
    ai = _ai_returning(_drifted_output(removed=["butter"], instructions=["Cook."]))

    result = await generate_recipe(
        prompt="no butter", pantry_items=[], ai_manager=ai, previous_recipe=previous
    )

    assert [i.name for i in result.recipe.ingredients] == ["Peanut butter"]


# ---- steps may be regenerated, but must not cook a removed ingredient ----------


@pytest.mark.asyncio
async def test_steps_that_still_use_a_removed_ingredient_are_re_asked() -> None:
    previous = _card()
    still_cheesy = _drifted_output(removed=["cheese"])  # its steps still say "the cheese"
    clean = _drifted_output(
        removed=["cheese"],
        instructions=["Boil the pasta.", "Soften the carrots.", "Bake until golden."],
    )
    ai = _ai_returning(still_cheesy, clean)

    result = await generate_recipe(
        prompt="no cheese", pantry_items=[], ai_manager=ai, previous_recipe=previous
    )

    assert ai.complete.await_count == 2
    assert "Stir in the cheese" in ai.complete.await_args_list[1].kwargs["prompt"]
    assert result.recipe.instructions == [
        "Boil the pasta.",
        "Soften the carrots.",
        "Bake until golden.",
    ]


@pytest.mark.asyncio
async def test_steps_still_naming_a_removed_ingredient_after_the_re_ask_are_dropped() -> None:
    previous = _card()
    ai = _ai_returning(_drifted_output(removed=["cheese"]), _drifted_output(removed=["cheese"]))

    result = await generate_recipe(
        prompt="no cheese", pantry_items=[], ai_manager=ai, previous_recipe=previous
    )

    assert ai.complete.await_count == 2
    assert not any("cheese" in step.lower() for step in result.recipe.instructions)
    assert result.recipe.instructions  # the clean steps survive
    assert result.recipe.steps is None  # positional metadata can't be realigned


@pytest.mark.asyncio
async def test_a_step_about_an_ingredient_still_on_the_card_is_not_flagged() -> None:
    previous = _card(
        ingredients=[Ingredient(name="Butter"), Ingredient(name="Peanut butter")],
        instructions=["Cook."],
    )
    ai = _ai_returning(
        _drifted_output(removed=["butter"], instructions=["Stir in the peanut butter."])
    )

    result = await generate_recipe(
        prompt="no butter", pantry_items=[], ai_manager=ai, previous_recipe=previous
    )

    assert ai.complete.await_count == 1
    assert result.recipe.instructions == ["Stir in the peanut butter."]


# ---- the model is asked for edits, and told to edit ----------------------------


@pytest.mark.asyncio
async def test_refine_asks_the_model_for_the_edit_schema() -> None:
    ai = _ai_returning(_drifted_output())

    await generate_recipe(
        prompt="add mushrooms", pantry_items=[], ai_manager=ai, previous_recipe=_card()
    )

    assert ai.complete.await_args.kwargs["response_schema"] is AIRecipeRefineOutput


def test_the_followup_prompt_says_edit_dont_regenerate() -> None:
    prompt = RECIPE_FOLLOWUP_PROMPT
    assert "EDIT" in prompt
    assert "Pasta stays Pasta" in prompt
    assert '"added"' in prompt and '"removed"' in prompt and '"changed"' in prompt


# ---------------------------------------------------------------------------
# apply_ingredient_edits: the pure piece
# ---------------------------------------------------------------------------


def test_edits_never_mutate_the_previous_list() -> None:
    previous = [Ingredient(name="Pasta", quantity=300, unit="g")]
    before = _dump(previous)

    apply_ingredient_edits(previous, removed=["Pasta"], added=[Ingredient(name="Rice")], changed=[])

    assert _dump(previous) == before


def test_an_added_name_already_on_the_card_updates_it_instead_of_duplicating() -> None:
    previous = [Ingredient(name="Garlic", quantity=2, unit="cloves", substitutes=["shallot"])]

    applied = apply_ingredient_edits(
        previous, added=[Ingredient(name="garlic", quantity=5, unit="cloves")]
    )

    assert len(applied.ingredients) == 1
    assert applied.ingredients[0].name == "Garlic"
    assert applied.ingredients[0].quantity == 5
    assert applied.ingredients[0].substitutes == ["shallot"]


def test_an_ambiguous_change_is_ignored() -> None:
    previous = [Ingredient(name="Parmesan cheese", quantity=1), Ingredient(name="Cheddar cheese")]

    applied = apply_ingredient_edits(previous, changed=[Ingredient(name="cheese", quantity=9)])

    assert _dump(applied.ingredients) == _dump(previous)
    assert applied.unmatched_changes == ["cheese"]


# ---------------------------------------------------------------------------
# Chat: the #535 scenario, through the real node and session writeback
# ---------------------------------------------------------------------------


@contextmanager
def _chat_env(ai: MagicMock) -> Iterator[None]:
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    with (
        patch(f"{_NODES}.get_stored_dietary_preferences", AsyncMock(return_value=[])),
        patch(f"{_NODES}.get_ai_manager", MagicMock(return_value=ai)),
        patch(f"{_NODES}.get_repository", AsyncMock(return_value=repo)),
    ):
        yield


async def _chat_turn(text: str, picked: dict[str, Any], ai: MagicMock) -> Any:
    state: Any = {
        "input_text": text,
        "user_id": USER,
        "conversation_id": "conv-579",
        "errors": [],
        "warnings": [],
        "session": {"metadata": {"picked_recipe": picked}},
    }
    with _chat_env(ai):
        return await refine_recipe_node(state)


async def _persist(state: Any) -> dict[str, Any]:
    """What update_session_node writes back as the pinned recipe after a turn."""
    session = ConversationSession(conversation_id="conv-579")
    repo = MagicMock()
    repo.get_or_create_session = AsyncMock(return_value=session)
    repo.update_session = AsyncMock(return_value=None)
    with patch("bubbly_chef.workflows.router.get_repository", AsyncMock(return_value=repo)):
        await update_session_node(state)
    saved = repo.update_session.await_args.args[1].model_dump(mode="json")
    picked: dict[str, Any] = saved["metadata"]["picked_recipe"]
    return picked


@pytest.mark.asyncio
async def test_no_cheese_after_add_mushrooms_keeps_the_mushrooms() -> None:
    picked = _card().model_dump(mode="json")
    before = _dump(_card().ingredients)

    # Turn 1: "add mushrooms". The model drifts Pasta and Butter as well.
    turn1 = await _chat_turn(
        "can we add mushrooms",
        picked,
        _ai_returning(_drifted_output(added=[_ai_ing("Mushrooms", 150, "g")])),
    )
    card1 = turn1["proposal"].recipe
    assert [i.name for i in card1.ingredients][:2] == ["Pasta", "Butter"]  # fails on main
    assert "Mushrooms" in [i.name for i in card1.ingredients]

    # Turn 2 reads the card turn 1 wrote back. The model's regenerated list
    # forgets the mushrooms (the #535 failure) and renames Pasta again.
    turn2_output = AIRecipeRefineOutput(
        title="Creamy Carrot Pasta Bake",
        description="A cosy bake.",
        ingredients=[
            _ai_ing("Spaghetti", 300, "g"),
            _ai_ing("Olive Oil", 2, "tbsp"),
            _ai_ing("Carrots", 3),
        ],
        instructions=["Boil the pasta.", "Soften the carrots.", "Bake until golden."],
        removed=["cheese"],
    )
    turn2 = await _chat_turn("no cheese", await _persist(turn1), _ai_returning(turn2_output))

    names = [i.name for i in turn2["proposal"].recipe.ingredients]
    assert names == ["Pasta", "Butter", "Carrots", "Mushrooms"]  # fails on main
    assert _dump(turn2["proposal"].recipe.ingredients[:3]) == before[:3]
    assert turn2["proposal"].recipe.id == card1.id


# ---------------------------------------------------------------------------
# Library refine (/v1/recipes/refine), which a meal's dish refine goes through
# ---------------------------------------------------------------------------


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


@pytest.mark.asyncio
async def test_library_refine_preserves_the_dishes_other_ingredients(client: Any) -> None:
    previous = _card()
    ai = _ai_returning(_drifted_output(added=[_ai_ing("Mushrooms", 150, "g")]))
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    with (
        patch(f"{_NODES}.get_stored_dietary_preferences", AsyncMock(return_value=[])),
        patch(f"{_ROUTE}.get_repository", AsyncMock(return_value=repo)),
        patch("bubbly_chef.api.deps.get_ai_manager", MagicMock(return_value=ai)),
    ):
        response = await client.post(
            "/v1/recipes/refine",
            json={"recipe": previous.model_dump(mode="json"), "prompt": "add mushrooms"},
        )

    assert response.status_code == 200, response.text
    names = [i["name"] for i in response.json()["recipe"]["ingredients"]]
    assert names == ["Pasta", "Butter", "Carrots", "Parmesan cheese", "Cheddar cheese", "Mushrooms"]
