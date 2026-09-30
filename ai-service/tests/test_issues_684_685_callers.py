"""Issues #684 + #685: every caller of the shared diet matcher, and the direct path.

Contract: `docs/plans/2026-09-30-diet-matcher-contract.md` (R6).

This file imports ONLY symbols that exist on main at `087a481`, so each row either
fails on main on its assertion or passes on main -- never with an ImportError.
The pure-API rows (T-*, S9, S10b) live in `test_diet_terms.py`.

Row markers: "(fails on main)" must be seen red against main; "(naive-widen guard)"
passes on main but would fail if the table were widened without the guards.

The only patch target for the stored diet is
`bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences` (the meal
tests also patch the `fixed_main` copy). No live model: the AI manager is a fake.
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
from bubbly_chef.models.meal import MealOptionLLM, MealDishOutlineLLM, MealOptionsLLMResult
from bubbly_chef.models.recipe import Ingredient, RecipeCard, RecipeConstraints
from bubbly_chef.models.session import ConversationSession
from bubbly_chef.services.recipe_generator import GenerateRecipeResponse, IngredientStatus
from bubbly_chef.workflows.meal.fixed_main import fixed_main_constraints
from bubbly_chef.workflows.meal.nodes import (
    _drop_diets_the_main_contradicts,
    _finish_meal_followup_constraints,
    meal_options_stage,
)
from bubbly_chef.workflows.recipe.nodes import (
    _combine_dietary_preferences,
    _dietary_contradicted,
    _drop_redundant_dietary,
    carry_dietary_tags,
    extract_recipe_constraints,
    generate_grounded_recipe,
    refine_recipe_node,
    research_recipe,
    score_pantry_ingredients,
)
from bubbly_chef.workflows.router import update_session_node
from bubbly_chef.workflows.state import LLMRecipeResult

_NODES = "bubbly_chef.workflows.recipe.nodes"
STORED = f"{_NODES}.get_stored_dietary_preferences"
USER = "user-684"


# ---------------------------------------------------------------------------
# Harness (copied from test_issue_544_refine_dietary.py, no cross-test imports)
# ---------------------------------------------------------------------------


class _FakeAI:
    """Stands in for the AIManager: constraint extraction + grounded generation."""

    def __init__(
        self, extraction: RecipeConstraints | None = None, *, extraction_raises: bool = False
    ) -> None:
        self.extraction = extraction or RecipeConstraints()
        self.extraction_raises = extraction_raises
        self.recipe_prompts: list[str] = []

    async def complete(self, prompt: str, response_schema: Any = None, **_: Any) -> Any:
        if response_schema is RecipeConstraints:
            if self.extraction_raises:
                raise RuntimeError("extraction down")
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

    def sent(self) -> list[str]:
        """The `dietary` list the generator was handed (empty when absent)."""
        return list(self.generated_constraints().get("dietary") or [])


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


def _session_of(**constraints: Any) -> dict[str, Any]:
    return {"metadata": {"recipe_constraints": constraints}}


async def _direct_turn(
    text: str,
    stored: list[str],
    extraction: RecipeConstraints | None = None,
    session: dict[str, Any] | None = None,
    *,
    extraction_raises: bool = False,
) -> tuple[dict[str, Any], _FakeAI]:
    """The direct card path in its real node order."""
    ai = _FakeAI(extraction, extraction_raises=extraction_raises)
    state: Any = _base_state(text, session)
    with _env(stored, ai):
        for node in (
            extract_recipe_constraints,
            score_pantry_ingredients,
            research_recipe,
            generate_grounded_recipe,
        ):
            state = await node(state)
    return dict(state), ai


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


async def _save(state: dict[str, Any]) -> Any:
    """Run `update_session_node` on a turn's result; return the saved session."""
    session = ConversationSession(conversation_id="conv-684")
    repo = MagicMock()
    repo.get_or_create_session = AsyncMock(return_value=session)
    repo.update_session = AsyncMock(return_value=None)
    with patch("bubbly_chef.workflows.router.get_repository", AsyncMock(return_value=repo)):
        await update_session_node({**state, "conversation_id": "conv-684"})  # type: ignore[typeddict-item]
    return repo.update_session.await_args.args[1]


def _session_from(saved: Any) -> dict[str, Any]:
    """The `session` dict the next turn would read, from a saved ConversationSession."""
    return {"metadata": saved.metadata.model_dump(mode="json")}


def _persisted_dietary(saved: Any) -> list[str]:
    rc = saved.metadata.recipe_constraints
    return list(rc.dietary) if rc is not None else []


# ---------------------------------------------------------------------------
# T-D1: dedupe through norm_label (fails on main: strip().lower() keeps both)
# ---------------------------------------------------------------------------


def test_combine_dedupes_spellings_of_one_label() -> None:
    assert _combine_dietary_preferences(["Dairy Free"], ["dairy-free"], {}, "pasta") == [
        "Dairy Free"
    ]


def test_drop_redundant_dedupes_spellings_of_one_label() -> None:
    assert _drop_redundant_dietary(["Vegan", "Dairy Free"]) == ["Vegan"]


# ---------------------------------------------------------------------------
# C1: first turn, direct
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_c1_chorizo_pasta_sets_stored_vegetarian_aside() -> None:  # fails on main
    state, ai = await _direct_turn("chorizo pasta", ["Vegetarian"])

    assert "dietary" not in ai.generated_constraints()
    assert _card_of(state).diets_set_aside == ["Vegetarian"]


@pytest.mark.asyncio
async def test_c1_vegan_chorizo_pasta_keeps_vegetarian() -> None:  # naive-widen guard
    state, ai = await _direct_turn("vegan chorizo pasta", ["Vegetarian"])

    assert ai.sent() == ["Vegetarian"]
    assert _card_of(state).diets_set_aside == []


@pytest.mark.asyncio
async def test_c1_coconut_milk_curry_keeps_stored_vegan() -> None:  # fails on main
    state, ai = await _direct_turn("coconut milk curry", ["Vegan"])

    assert ai.sent() == ["Vegan"]
    assert _card_of(state).diets_set_aside == []


@pytest.mark.asyncio
async def test_c1_cauliflower_steak_keeps_stored_vegetarian() -> None:
    state, ai = await _direct_turn("cauliflower steak with chimichurri", ["Vegetarian"])

    assert ai.sent() == ["Vegetarian"]
    assert _card_of(state).diets_set_aside == []


# ---------------------------------------------------------------------------
# C1b: first turn, brainstorm (extract only)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_c1b_salami_ideas_set_stored_vegetarian_aside() -> None:  # fails on main
    ai = _FakeAI()
    with _env(["Vegetarian"], ai):
        state = await extract_recipe_constraints(_base_state("salami ideas"))  # type: ignore[arg-type]

    assert state["recipe_constraints"]["dietary"] == []


# ---------------------------------------------------------------------------
# C2: pick
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_c2_prawn_pad_thai_pick_sets_vegetarian_aside() -> None:  # fails on main
    state, ai = await _pick_turn("Prawn Pad Thai", ["Vegetarian"], None)

    assert "dietary" not in ai.generated_constraints()
    assert _card_of(state).diets_set_aside == ["Vegetarian"]


@pytest.mark.asyncio
async def test_c2_oyster_mushroom_stir_fry_pick_keeps_vegetarian() -> None:  # naive-widen guard
    state, ai = await _pick_turn("Oyster Mushroom Stir-Fry", ["Vegetarian"], None)

    assert ai.sent() == ["Vegetarian"]
    assert _card_of(state).diets_set_aside == []


# ---------------------------------------------------------------------------
# C3: chat refine
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("tweak", ["add pancetta", "add chorizo"])  # fails on main
async def test_c3_added_meat_sets_vegetarian_aside(tweak: str) -> None:
    result, gen = await _refine(_card_dict(), tweak, ["Vegetarian"])

    assert "dietary" not in _sent(gen)
    assert _card_of(result).diets_set_aside == ["Vegetarian"]


@pytest.mark.asyncio
async def test_c3_add_oyster_mushrooms_keeps_vegetarian() -> None:  # naive-widen guard
    _, gen = await _refine(_card_dict(), "add oyster mushrooms", ["Vegetarian"])

    assert _sent(gen)["dietary"] == ["Vegetarian"]


@pytest.mark.asyncio
async def test_c3_add_butter_beans_keeps_stored_vegan() -> None:  # fails on main
    _, gen = await _refine(_card_dict(), "add butter beans", ["Vegan"])

    assert _sent(gen)["dietary"] == ["Vegan"]


@pytest.mark.asyncio
async def test_c3_add_mushrooms_bacon_too_sets_vegetarian_aside() -> None:
    # Passes on main; guards the clause join against the imitation guard.
    _, gen = await _refine(_card_dict(), "add mushrooms, bacon too", ["Vegetarian"])

    assert "dietary" not in _sent(gen)


@pytest.mark.asyncio
async def test_c3_add_cauliflower_steak_keeps_vegetarian() -> None:  # naive-widen guard
    _, gen = await _refine(_card_dict(), "add cauliflower steak", ["Vegetarian"])

    assert _sent(gen)["dietary"] == ["Vegetarian"]


@pytest.mark.asyncio
async def test_c3_meat_and_dairy_free_keeps_vegetarian_and_sends_dairy_free() -> None:
    # fails on main: "meat" survives added_text's `-free` strip
    _, gen = await _refine(
        _card_dict(), "make it meat and dairy free", ["Vegetarian", "Dairy-free"]
    )

    assert _sent(gen)["dietary"] == ["Vegetarian", "Dairy-free"]


@pytest.mark.asyncio
async def test_c3_egg_and_dairy_free_keeps_stored_vegan() -> None:  # fails on main
    _, gen = await _refine(_card_dict(), "egg and dairy free please", ["Vegan"])

    assert _sent(gen)["dietary"] == ["Vegan"]


@pytest.mark.asyncio
async def test_c3_tofu_comma_chicken_too_sets_vegetarian_aside() -> None:
    # T-ID2's refine half: the marker window isn't re-applied to refine's joined text.
    _, gen = await _refine(_card_dict(), "add tofu, chicken too", ["Vegetarian"])

    assert "dietary" not in _sent(gen)


# ---------------------------------------------------------------------------
# C4: library route
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


async def _library_refine(
    client: Any, recipe: dict[str, Any], prompt: str, stored: list[str]
) -> dict[str, Any]:
    """POST /v1/recipes/refine; returns the constraints handed to the generator."""
    gen = AsyncMock(side_effect=lambda **_: _followup_response())
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
    gen.assert_awaited_once()
    constraints: dict[str, Any] = gen.await_args.kwargs["constraints"]
    return constraints


@pytest.mark.asyncio
async def test_c4_untagged_carbonara_drops_vegetarian(client: Any) -> None:  # fails on main
    row = _card_dict("Carbonara", ingredients=("spaghetti", "pancetta"))
    constraints = await _library_refine(client, row, "make it quicker", ["Vegetarian"])

    assert "dietary" not in constraints


@pytest.mark.asyncio
async def test_c4_separator_mushrooms_bacon_row_drops_vegetarian(client: Any) -> None:
    # Passes on main; guards the field separator against the imitation guard.
    row = _card_dict("Pasta Bake", ingredients=("pasta", "mushrooms", "bacon"))
    constraints = await _library_refine(client, row, "make it quicker", ["Vegetarian"])

    assert "dietary" not in constraints


@pytest.mark.asyncio
async def test_c4_separator_tofu_chicken_thighs_row_drops_vegetarian(client: Any) -> None:
    # Passes on main; guards the field separator against the plant-marker window.
    row = _card_dict("Garden Bake", ingredients=("tofu", "chicken thighs"))
    constraints = await _library_refine(client, row, "make it quicker", ["Vegetarian"])

    assert "dietary" not in constraints


@pytest.mark.asyncio
async def test_c4_untagged_cauliflower_steaks_keeps_vegetarian(client: Any) -> None:
    # naive-widen guard
    row = _card_dict("Cauliflower Steaks", ingredients=("cauliflower steak", "tahini"))
    constraints = await _library_refine(client, row, "make it quicker", ["Vegetarian"])

    assert constraints["dietary"] == ["Vegetarian"]


@pytest.mark.asyncio
async def test_c4_untagged_tempeh_blt_keeps_vegetarian(client: Any) -> None:  # fails on main
    row = _card_dict("Tempeh BLT", ingredients=("tempeh bacon", "lettuce"))
    constraints = await _library_refine(client, row, "make it quicker", ["Vegetarian"])

    assert constraints["dietary"] == ["Vegetarian"]


# ---------------------------------------------------------------------------
# C5: carry_dietary_tags
# ---------------------------------------------------------------------------


def test_c5_add_pancetta_drops_the_vegetarian_tag() -> None:  # fails on main
    card = RecipeCard(title="Veggie Pasta", dietary_tags=["vegetarian"])

    assert carry_dietary_tags(card, "add pancetta", []) == []


def test_c5_add_chicken_dairy_free_cheese_drops_the_tag_and_sets_the_diet_aside() -> None:
    # Passes on main. The whole-tweak check still names chicken (not a `-free` list item).
    card = RecipeCard(title="Veggie Pasta", dietary_tags=["vegetarian"])

    assert carry_dietary_tags(card, "add chicken, dairy free cheese", []) == []


@pytest.mark.asyncio
async def test_c5_add_chicken_dairy_free_cheese_sets_vegetarian_aside_in_chat() -> None:
    _, gen = await _refine(_card_dict(), "add chicken, dairy free cheese", ["Vegetarian"])

    assert "dietary" not in _sent(gen)


# ---------------------------------------------------------------------------
# C6: fixed_main_constraints
# ---------------------------------------------------------------------------

_FIXED_STORED = "bubbly_chef.workflows.meal.fixed_main.get_stored_dietary_preferences"


def _meal_state(**extra: Any) -> Any:
    return {
        "input_text": "Make it a meal",
        "user_id": USER,
        "context": None,
        "session": None,
        "errors": [],
        "warnings": [],
        **extra,
    }


def _main(title: str, *names: str, tags: list[str] | None = None) -> RecipeCard:
    return RecipeCard(
        title=title, ingredients=[Ingredient(name=n) for n in names], dietary_tags=tags or []
    )


@pytest.mark.asyncio
async def test_c6_carbonara_main_sets_stored_vegetarian_aside() -> None:  # fails on main
    card = _main("Spaghetti Carbonara", "spaghetti", "pancetta")
    with patch(_FIXED_STORED, AsyncMock(return_value=["vegetarian"])):
        constraints = await fixed_main_constraints(_meal_state(), card)

    assert "vegetarian" not in constraints["dietary"]


@pytest.mark.asyncio
async def test_c6_untagged_coconut_milk_main_keeps_stored_vegan() -> None:  # fails on main
    card = _main("Chat Curry", "chickpeas", "coconut milk")
    with patch(_FIXED_STORED, AsyncMock(return_value=["vegan"])):
        constraints = await fixed_main_constraints(_meal_state(), card)

    assert "vegan" in constraints["dietary"]


@pytest.mark.asyncio
async def test_c6b_separator_mushrooms_bacon_main_sets_vegetarian_aside() -> None:
    card = _main("Pasta Bake", "pasta", "mushrooms", "bacon")
    with patch(_FIXED_STORED, AsyncMock(return_value=["vegetarian"])):
        constraints = await fixed_main_constraints(_meal_state(), card)

    assert "vegetarian" not in constraints["dietary"]


# ---------------------------------------------------------------------------
# C7: _drop_diets_the_main_contradicts
# ---------------------------------------------------------------------------


def test_c7_chorizo_paella_main_drops_the_carried_vegetarian() -> None:  # fails on main
    card = _main("Chorizo Paella", "rice", "saffron")

    out = _drop_diets_the_main_contradicts(
        {"dietary": ["vegetarian"]}, card, carried=["vegetarian"], input_text="quicker"
    )

    assert out["dietary"] == []


def test_c7_separator_tofu_chicken_thighs_main_drops_the_diet() -> None:
    card = _main("Garden Bake", "tofu", "chicken thighs")

    out = _drop_diets_the_main_contradicts(
        {"dietary": ["vegetarian"]}, card, carried=["vegetarian"], input_text="quicker"
    )

    assert out["dietary"] == []


def test_c7_a_dairy_free_tag_rescues_a_carried_dairy_free_spelling() -> None:
    # naive-widen guard: passes on main only because main's label lookup misses
    # "Dairy Free" entirely; once labels go through norm_label, the tag must rescue it.
    card = _main("Cheesy Bake", "pasta", "cheese", tags=["dairy-free"])

    out = _drop_diets_the_main_contradicts(
        {"dietary": ["Dairy Free"]}, card, carried=["Dairy Free"], input_text="quicker"
    )

    assert out["dietary"] == ["Dairy Free"]


def test_c7_naming_the_diet_this_turn_keeps_a_differently_spelled_label() -> None:
    # fails on main: "dairy-free" isn't a substring of "make it dairy free"
    card = _main("Cheesy Bake", "pasta", "cheese")

    out = _drop_diets_the_main_contradicts(
        {"dietary": ["Dairy-free"]}, card, carried=["Dairy-free"], input_text="make it dairy free"
    )

    assert out["dietary"] == ["Dairy-free"]


# ---------------------------------------------------------------------------
# C8: _finish_meal_followup_constraints
# ---------------------------------------------------------------------------


def test_c8_pill_adding_prawns_drops_the_retained_vegetarian() -> None:  # fails on main
    out = _finish_meal_followup_constraints({"dietary": ["vegetarian"]}, {}, "add some prawns")

    assert "vegetarian" not in out["dietary"]


# ---------------------------------------------------------------------------
# S1-S5: the direct path checks the conversation's diet (#685)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_s1_session_vegetarian_is_not_sent_for_chicken_curry() -> None:  # fails on main
    state, ai = await _direct_turn(
        "chicken curry", [], session=_session_of(dietary=["Vegetarian"])
    )

    assert "dietary" not in ai.generated_constraints()
    assert _card_of(state).diets_set_aside == ["Vegetarian"]


@pytest.mark.asyncio
async def test_s2_session_vegetarian_is_sent_for_pasta() -> None:
    state, ai = await _direct_turn("pasta", [], session=_session_of(dietary=["Vegetarian"]))

    assert ai.sent() == ["Vegetarian"]
    assert _card_of(state).diets_set_aside == []


@pytest.mark.asyncio
async def test_s3_stored_and_session_vegetarian_are_set_aside_once() -> None:  # fails on main
    state, ai = await _direct_turn(
        "chicken curry", ["Vegetarian"], session=_session_of(dietary=["Vegetarian"])
    )

    assert "dietary" not in ai.generated_constraints()
    assert _card_of(state).diets_set_aside == ["Vegetarian"]


@pytest.mark.asyncio
async def test_s4_a_diet_named_this_turn_is_never_checked() -> None:
    state, ai = await _direct_turn(
        "vegetarian chicken curry",
        [],
        extraction=RecipeConstraints(dietary=["Vegetarian"]),
        session=_session_of(dietary=["Vegetarian"]),
    )

    assert ai.sent() == ["Vegetarian"]
    assert _card_of(state).diets_set_aside == []


@pytest.mark.asyncio
async def test_s5_an_inherited_must_use_is_not_this_turns_ask() -> None:
    _, ai = await _direct_turn(
        "something quick",
        [],
        session=_session_of(dietary=["Vegetarian"], must_use_ingredients=["chicken"]),
    )

    assert ai.sent() == ["Vegetarian"]


@pytest.mark.asyncio
async def test_s5b_naming_the_diet_beats_an_inherited_must_use() -> None:
    # Passes on main. Pins decision 8: an inherited must_use never overrides a named diet.
    s1, _ = await _direct_turn(
        "use up my chicken", [], RecipeConstraints(must_use_ingredients=["chicken"])
    )
    saved1 = await _save(s1)
    s2, _ = await _direct_turn(
        "actually make it vegetarian",
        [],
        RecipeConstraints(dietary=["Vegetarian"]),
        _session_from(saved1),
    )
    saved2 = await _save(s2)
    _, ai3 = await _direct_turn("something quick", [], session=_session_from(saved2))

    assert ai3.sent() == ["Vegetarian"]


@pytest.mark.asyncio
async def test_s5d_stored_diet_survives_the_four_turn_chain() -> None:
    # Passes on main. Under R3 it failed at T4.
    s1, _ = await _direct_turn(
        "use up my chicken", ["Vegetarian"], RecipeConstraints(must_use_ingredients=["chicken"])
    )
    saved1 = await _save(s1)
    s2, _ = await _direct_turn(
        "actually make it vegetarian",
        ["Vegetarian"],
        RecipeConstraints(dietary=["Vegetarian"]),
        _session_from(saved1),
    )
    saved2 = await _save(s2)
    s3, ai3 = await _direct_turn("something quick", ["Vegetarian"], session=_session_from(saved2))
    saved3 = await _save(s3)
    _, ai4 = await _direct_turn("something quick", ["Vegetarian"], session=_session_from(saved3))

    assert ai3.sent() == ["Vegetarian"]
    assert _persisted_dietary(saved3) == ["Vegetarian"]
    assert ai4.sent() == ["Vegetarian"]


@pytest.mark.asyncio
async def test_s5c_a_freshly_extracted_ingredient_counts_against_the_session_diet() -> None:
    # fails on main
    state, ai = await _direct_turn(
        "something with the leftovers",
        [],
        RecipeConstraints(preferred_ingredients=["chicken"]),
        _session_of(dietary=["Vegetarian"]),
    )

    assert "dietary" not in ai.generated_constraints()
    assert _card_of(state).diets_set_aside == ["Vegetarian"]
    assert _persisted_dietary(await _save(state)) == ["Vegetarian"]


@pytest.mark.asyncio
async def test_s6_brainstorm_extract_drops_the_session_diet_for_this_turn() -> None:
    # fails on main
    ai = _FakeAI()
    with _env([], ai):
        state = await extract_recipe_constraints(
            _base_state("chicken ideas", _session_of(dietary=["Vegetarian"]))  # type: ignore[arg-type]
        )

    assert "Vegetarian" not in state["recipe_constraints"]["dietary"]
    assert state["session_dietary"] == ["Vegetarian"]  # type: ignore[typeddict-item]


# ---------------------------------------------------------------------------
# S7-S8: persistence chains
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_s7_a_set_aside_session_diet_is_remembered_and_the_refine_skips_it() -> None:
    # fails on main: the card records nothing, the session forgets nothing to restore
    s1, _ = await _direct_turn(
        "chicken curry", [], session=_session_of(dietary=["Vegetarian"])
    )
    saved = await _save(s1)

    assert _persisted_dietary(saved) == ["Vegetarian"]
    assert saved.metadata.picked_recipe.diets_set_aside == ["Vegetarian"]

    _, ai2 = await _direct_turn("pasta", [], session=_session_from(saved))
    assert ai2.sent() == ["Vegetarian"]

    prior = saved.metadata.recipe_constraints.model_dump(mode="json")
    _, gen = await _refine(
        saved.metadata.picked_recipe.model_dump(mode="json"), "make it spicier", [], prior
    )
    assert "dietary" not in _sent(gen)


@pytest.mark.asyncio
async def test_s8_a_set_aside_pick_remembers_the_session_diet() -> None:  # fails on main
    session = _session_of(dietary=["Vegetarian"])
    state, _ = await _pick_turn("Chicken Tikka", [], session)
    saved = await _save(state)

    assert _persisted_dietary(saved) == ["Vegetarian"]

    _, ai2 = await _direct_turn("tofu curry", [], session=_session_from(saved))
    assert ai2.sent() == ["Vegetarian"]


@pytest.mark.asyncio
async def test_s9b_an_empty_diet_still_saves_and_overwrites() -> None:  # fails on main
    state, _ = await _direct_turn("pasta", ["Vegetarian"], extraction_raises=True)
    saved = await _save(state)

    # Vegetarian was sent this turn from the stored read; it is not written to the session.
    assert _persisted_dietary(saved) == []


# ---------------------------------------------------------------------------
# S10: the one-turn tier
# ---------------------------------------------------------------------------

_SET_ASIDE_ROWS = [
    ("make it non-vegan", "Vegan"),
    ("a non-vegetarian pasta", "Vegetarian"),
]

_DOES_NOTHING_ROWS = [
    ("that's not vegetarian!", "Vegetarian"),
    ("is this not vegan?", "Vegan"),
    ("not vegetarian-friendly enough", "Vegetarian"),
    ("I'm not a vegetarian but my partner is", "Vegetarian"),
    ("not vegan tonight", "Vegan"),
    ("no longer vegan? ok", "Vegan"),
    ("I'm not vegetarian any more", "Vegetarian"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(("text", "label"), _SET_ASIDE_ROWS)
async def test_s10_a_non_label_modifier_sets_the_label_aside_for_this_turn(
    text: str, label: str
) -> None:  # fails on main
    state, ai = await _direct_turn(text, [], session=_session_of(dietary=[label]))

    assert "dietary" not in ai.generated_constraints()
    assert _card_of(state).diets_set_aside == [label]
    saved = await _save(state)
    assert _persisted_dietary(saved) == [label]
    _, ai2 = await _direct_turn("pasta", [], session=_session_from(saved))
    assert ai2.sent() == [label]


@pytest.mark.asyncio
@pytest.mark.parametrize(("text", "label"), _DOES_NOTHING_ROWS)
async def test_s10_a_bare_negation_does_nothing(text: str, label: str) -> None:
    state, ai = await _direct_turn(text, [], session=_session_of(dietary=[label]))

    assert ai.sent() == [label]
    saved = await _save(state)
    _, ai2 = await _direct_turn("pasta", [], session=_session_from(saved))
    assert ai2.sent() == [label]


@pytest.mark.asyncio
async def test_s10c_non_label_beats_a_fresh_extraction() -> None:  # fails on main
    _, ai = await _direct_turn(
        "make it non-vegan", [], extraction=RecipeConstraints(dietary=["Vegan"])
    )

    assert "Vegan" not in ai.sent()


@pytest.mark.asyncio
async def test_s10c_the_session_diet_is_inherited_when_the_fresh_list_is_emptied() -> None:
    # fails on main: the fresh Vegan overrides the session's Gluten-free
    _, ai = await _direct_turn(
        "make it non-vegan",
        [],
        extraction=RecipeConstraints(dietary=["Vegan"]),
        session=_session_of(dietary=["Gluten-free"]),
    )

    assert ai.sent() == ["Gluten-free"]


@pytest.mark.asyncio
async def test_s10c_a_plain_mention_beats_a_non_label_in_the_same_message() -> None:
    _, ai = await _direct_turn(
        "a vegan dinner my non-vegan family will enjoy",
        [],
        extraction=RecipeConstraints(dietary=["Vegan"]),
        session=_session_of(dietary=["Vegan"]),
    )

    assert ai.sent() == ["Vegan"]


@pytest.mark.asyncio
async def test_s10c_a_plain_mention_of_an_inherited_label_is_kept() -> None:
    _, ai = await _direct_turn(
        "vegetarian chili for my non-vegetarian friends",
        [],
        session=_session_of(dietary=["Vegetarian"]),
    )

    assert ai.sent() == ["Vegetarian"]


@pytest.mark.asyncio
async def test_s10d_a_stored_label_is_set_aside_for_this_turn() -> None:  # fails on main
    state, ai = await _direct_turn("make it non-vegan", ["Vegan"])

    assert "Vegan" not in ai.sent()
    assert _card_of(state).diets_set_aside == ["Vegan"]


@pytest.mark.asyncio
async def test_s10d_the_stored_label_comes_back_next_turn() -> None:
    state, _ = await _direct_turn("make it non-vegan", ["Vegan"])
    saved = await _save(state)

    _, ai2 = await _direct_turn("pasta", ["Vegan"], session=_session_from(saved))

    assert ai2.sent() == ["Vegan"]


# ---------------------------------------------------------------------------
# S11: legacy and stored-origin labels
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_s11_a_legacy_session_label_is_kept() -> None:
    state, ai = await _direct_turn(
        "chicken curry", ["Vegetarian"], session=_session_of(dietary=["Vegetarian"])
    )

    assert "dietary" not in ai.generated_constraints()
    assert _card_of(state).diets_set_aside == ["Vegetarian"]
    saved = await _save(state)
    assert _persisted_dietary(saved) == ["Vegetarian"]
    _, ai2 = await _direct_turn("pasta", ["Vegetarian"], session=_session_from(saved))
    assert ai2.sent() == ["Vegetarian"]


@pytest.mark.asyncio
async def test_s11b_the_profile_diet_is_not_stuck_in_the_session() -> None:  # fails on main
    state, ai = await _direct_turn("pasta", ["Vegetarian"])
    assert ai.sent() == ["Vegetarian"]
    saved = await _save(state)

    assert "Vegetarian" not in _persisted_dietary(saved)
    _, ai2 = await _direct_turn("pasta", [], session=_session_from(saved))
    assert "dietary" not in ai2.generated_constraints()


@pytest.mark.asyncio
async def test_s11b_a_diet_named_this_turn_is_persisted() -> None:
    state, _ = await _direct_turn(
        "vegetarian pasta", ["Vegetarian"], RecipeConstraints(dietary=["Vegetarian"])
    )

    assert _persisted_dietary(await _save(state)) == ["Vegetarian"]


# ---------------------------------------------------------------------------
# S12: meal fresh turn
# ---------------------------------------------------------------------------


def _meal_repo() -> MagicMock:
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    repo.get_recent_meal_servings = AsyncMock(return_value=[])
    repo.get_recent_cuisines = AsyncMock(return_value=[])
    return repo


def _meal_ai() -> MagicMock:
    def _dish(role: str, name: str) -> MealDishOutlineLLM:
        return MealDishOutlineLLM(
            role=role,  # type: ignore[arg-type]
            name=name,
            key_ingredients=[],
            est_total_minutes=30,
            est_hands_on_minutes=15,
        )

    result = MealOptionsLLMResult(
        options=[
            MealOptionLLM(title=f"Option {i}", dishes=[_dish("main", f"Main {i}"), _dish("side", f"Side {i}")])
            for i in range(3)
        ],
        follow_ups=[],
    )

    async def _complete(*, prompt: str, response_schema: type, temperature: float = 0.7) -> Any:
        if response_schema is MealOptionsLLMResult:
            return result
        if response_schema is RecipeConstraints:
            return RecipeConstraints()
        raise AssertionError(f"Unexpected model call: {response_schema!r}")

    ai = MagicMock()
    ai.complete = AsyncMock(side_effect=_complete)
    return ai


async def _fresh_meal_turn(text: str) -> dict[str, Any]:
    repo = _meal_repo()
    ai = _meal_ai()
    get_repo = AsyncMock(return_value=repo)
    with (
        patch(_FIXED_STORED, AsyncMock(return_value=[])),
        patch("bubbly_chef.workflows.meal.nodes.get_repository", get_repo),
        patch("bubbly_chef.workflows.meal.nodes.get_ai_manager", MagicMock(return_value=ai)),
        patch(f"{_NODES}.get_repository", get_repo),
        patch(f"{_NODES}.get_ai_manager", MagicMock(return_value=ai)),
        patch(STORED, AsyncMock(return_value=[])),
    ):
        out = await meal_options_stage(
            _meal_state(input_text=text, session=_session_of(dietary=["Vegetarian"]))
        )
    return dict(out)


@pytest.mark.asyncio
async def test_s12_a_chicken_dinner_drops_the_session_vegetarian() -> None:  # fails on main
    out = await _fresh_meal_turn("a chicken dinner")

    assert "Vegetarian" not in (out["recipe_constraints"].get("dietary") or [])


@pytest.mark.asyncio
async def test_s12_a_pasta_dinner_keeps_the_session_vegetarian() -> None:
    out = await _fresh_meal_turn("a pasta dinner")

    assert out["recipe_constraints"]["dietary"] == ["Vegetarian"]


# ---------------------------------------------------------------------------
# S13: cooking-help brainstorm fallback
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_s13_the_cooking_help_fallback_persists_through_the_helper() -> None:
    # fails on main
    saved = await _save(
        {
            "user_id": USER,
            "intent": "cooking_help",
            "brainstorm_ideas": ["Idea"],
            "recipe_constraints": {"dietary": []},
            "session_dietary": ["Vegetarian"],
            "stored_dietary": [],
        }  # type: ignore[arg-type]
    )

    assert _persisted_dietary(saved) == ["Vegetarian"]


# ---------------------------------------------------------------------------
# S14: negated foods and guarded phrases don't count against an inherited diet
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("text", ["pasta with no meat", "something without chicken"])
async def test_s14_a_negated_food_keeps_the_inherited_diet(text: str) -> None:
    state, ai = await _direct_turn(text, [], session=_session_of(dietary=["Vegetarian"]))

    assert ai.sent() == ["Vegetarian"]
    assert _card_of(state).diets_set_aside == []


@pytest.mark.asyncio
async def test_s14_control_a_positive_food_beside_a_negated_one_sets_it_aside() -> None:
    # fails on main
    state, ai = await _direct_turn(
        "pasta with chicken, no cheese", [], session=_session_of(dietary=["Vegetarian"])
    )

    assert "dietary" not in ai.generated_constraints()
    assert _card_of(state).diets_set_aside == ["Vegetarian"]


@pytest.mark.asyncio
@pytest.mark.parametrize("text", ["vegan pulled pork tacos", "meat and dairy free pasta"])
async def test_s14_whole_message_guards_keep_the_inherited_diet(text: str) -> None:
    _, ai = await _direct_turn(text, [], session=_session_of(dietary=["Vegetarian"]))

    assert ai.sent() == ["Vegetarian"]


@pytest.mark.asyncio
async def test_s14_a_guarded_fresh_ingredient_keeps_the_inherited_diet() -> None:
    _, ai = await _direct_turn(
        "something quick",
        [],
        RecipeConstraints(preferred_ingredients=["tempeh bacon"]),
        _session_of(dietary=["Vegetarian"]),
    )

    assert ai.sent() == ["Vegetarian"]


# ---------------------------------------------------------------------------
# S15: a named looser diet survives a stricter stored one
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_s15_a_named_vegetarian_is_persisted_under_a_stored_vegan() -> None:
    # fails on main: main persists ["Vegan"] and re-sends Vegan
    state, _ = await _direct_turn(
        "vegetarian dinner ideas", ["Vegan"], RecipeConstraints(dietary=["Vegetarian"])
    )
    saved = await _save(state)

    assert _persisted_dietary(saved) == ["Vegetarian"]

    # The stored Vegan is set aside by the cheese; the remembered Vegetarian is sent.
    _, ai2 = await _direct_turn("cheese omelette", ["Vegan"], session=_session_from(saved))
    assert ai2.sent() == ["Vegetarian"]


def test_dietary_contradicted_still_takes_two_arguments() -> None:
    assert _dietary_contradicted("vegetarian", "chicken curry")
