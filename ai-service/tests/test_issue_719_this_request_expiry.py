"""Issue #719: a diet set aside for one turn must come back on the next one.

PR #709 (issue #687) promised that "we're not vegan tonight" relaxes the diet for
that turn only. It didn't hold when the same message also named the food the diet
forbids ("...can I use butter?"): the extractor records the food as a preferred
ingredient, the whole constraints dict was persisted, and every later turn
inherited the butter and set the diet aside again, for as long as the session
lived.

The product call (logged in the PR): a food that set a diet aside belongs to that
turn only. It is used for that turn's reply and not persisted into the session's
inherited preferred / must-use ingredients. Refining the *same* card keeps the
diet set aside because the card itself records it (`diets_set_aside`) and still
contains the food; a *new* request does not inherit the set-aside.

The model is always a fake; whether a live model fills `preferred_ingredients`
this way is the re-check tracked in issue #691.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.base import Intent, NextAction
from bubbly_chef.models.recipe import DietChanges, RecipeCard, RecipeConstraints
from bubbly_chef.models.session import ConversationSession
from bubbly_chef.services.recipe_generator import GenerateRecipeResponse, IngredientStatus
from bubbly_chef.workflows.recipe.nodes import (
    extract_recipe_constraints,
    generate_grounded_recipe,
    refine_recipe_node,
    research_recipe,
    score_pantry_ingredients,
)
from bubbly_chef.workflows.router import update_session_node
from bubbly_chef.workflows.state import LLMRecipeResult

_NODES = "bubbly_chef.workflows.recipe.nodes"
_ROUTER = "bubbly_chef.workflows.router"
STORED = f"{_NODES}.get_stored_dietary_preferences"
USER = "user-719"


class _FakeAI:
    def __init__(self, extraction: RecipeConstraints | None = None) -> None:
        self.extraction = extraction or RecipeConstraints()

    async def complete(self, prompt: str, response_schema: Any = None, **_: Any) -> Any:
        if response_schema is RecipeConstraints:
            return self.extraction
        if response_schema is LLMRecipeResult:
            return LLMRecipeResult(
                title="Generated Dish",
                ingredients=[{"name": "rice", "quantity": 1, "unit": "cup"}],
                instructions=["Cook it."],
                confidence=0.9,
            )
        raise AssertionError(f"unexpected schema {response_schema}")


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


def _state(text: str, session: dict[str, Any] | None) -> Any:
    return {"input_text": text, "user_id": USER, "errors": [], "warnings": [], "session": session}


async def _turn(
    text: str,
    session: dict[str, Any] | None,
    extraction: RecipeConstraints | None = None,
    stored: list[str] | None = None,
) -> dict[str, Any]:
    """One direct-card turn in its real node order."""
    ai = _FakeAI(extraction)
    state: Any = _state(text, session)
    with _env(stored or [], ai):
        for node in (
            extract_recipe_constraints,
            score_pantry_ingredients,
            research_recipe,
            generate_grounded_recipe,
        ):
            state = await node(state)
    return dict(state)


async def _save(state: dict[str, Any]) -> dict[str, Any]:
    """Persist a turn as `update_session_node` does; return the next turn's session dict."""
    saved = ConversationSession(conversation_id="conv-719")
    repo = MagicMock()
    repo.get_or_create_session = AsyncMock(return_value=saved)
    repo.update_session = AsyncMock(return_value=None)
    with patch(f"{_ROUTER}.get_repository", AsyncMock(return_value=repo)):
        await update_session_node(
            {**state, "intent": Intent.RECIPE_GENERATION.value, "conversation_id": "conv-719"}  # type: ignore[typeddict-item]
        )
    persisted: ConversationSession = repo.update_session.await_args.args[1]
    return {"metadata": persisted.metadata.model_dump(mode="json")}


def _relaxing(label: str, *foods: str) -> RecipeConstraints:
    return RecipeConstraints(
        preferred_ingredients=list(foods),
        diet_changes=DietChanges(remove=[label], scope="this_request"),
    )


def _card_of(state: dict[str, Any]) -> RecipeCard:
    card = state["proposal"].recipe
    assert isinstance(card, RecipeCard)
    return card


# ---------------------------------------------------------------------------
# (1) a this_request relaxation naming the food expires with its turn
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("session_diet", "stored"),
    [
        pytest.param(["Vegan"], [], id="conversation-diet"),
        pytest.param([], ["Vegan"], id="profile-diet"),
        pytest.param(["Vegan"], ["Vegan"], id="both"),
    ],
)
async def test_a_diet_relaxed_by_a_message_naming_butter_is_back_on_the_next_turn(
    session_diet: list[str], stored: list[str]
) -> None:
    session = {"metadata": {"recipe_constraints": {"dietary": session_diet}}}

    first = await _turn(
        "we're not vegan tonight, can I use butter?",
        session if session_diet else None,
        _relaxing("Vegan", "butter"),
        stored,
    )
    # The turn itself is generated without the diet, and with the butter.
    assert not first["recipe_constraints"].get("dietary")
    assert first["recipe_constraints"]["preferred_ingredients"] == ["butter"]

    nxt = await _save(first)
    second = await _turn("something quick", nxt, None, stored)

    assert second["recipe_constraints"]["dietary"] == ["Vegan"]
    assert "butter" not in (second["recipe_constraints"].get("preferred_ingredients") or [])


@pytest.mark.asyncio
async def test_a_food_that_does_not_clash_with_the_diet_is_still_remembered() -> None:
    """Only the food that set the diet aside is turn-scoped, not every ingredient."""
    first = await _turn(
        "not vegan tonight, butter and pasta please",
        {"metadata": {"recipe_constraints": {"dietary": ["Vegan"]}}},
        _relaxing("Vegan", "butter", "pasta"),
    )

    nxt = await _save(first)

    persisted = nxt["metadata"]["recipe_constraints"]
    assert persisted["dietary"] == ["Vegan"]
    assert persisted["preferred_ingredients"] == ["pasta"]


# ---------------------------------------------------------------------------
# (2)+(3) refining the same card keeps it set aside; a new request does not
# ---------------------------------------------------------------------------


def _refined_response() -> GenerateRecipeResponse:
    return GenerateRecipeResponse(
        recipe=RecipeCard(title="Refined Dish", instructions=["Cook."]),
        ingredients_status=[IngredientStatus(ingredient_name="rice", status="have")],
        missing_count=0,
        have_count=1,
        partial_count=0,
        pantry_match_score=1.0,
    )


async def _refine(
    card: RecipeCard, tweak: str, stored: list[str], prior: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    gen = AsyncMock(return_value=_refined_response())
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    metadata = {"picked_recipe": card.model_dump(mode="json"), "recipe_constraints": prior}
    state: Any = _state(tweak, {"metadata": metadata})
    state["recipe_constraints"] = prior
    with (
        patch(STORED, AsyncMock(return_value=stored)),
        patch(f"{_NODES}._generate_recipe_followup", gen),
        patch(f"{_NODES}.get_repository", AsyncMock(return_value=repo)),
        patch(f"{_NODES}.get_ai_manager", MagicMock()),
    ):
        result = await refine_recipe_node(state)
    sent: dict[str, Any] = gen.await_args.kwargs["constraints"]
    return dict(result), sent


@pytest.mark.asyncio
async def test_refining_the_card_that_set_vegetarian_aside_keeps_it_aside() -> None:
    stored = ["Vegetarian"]
    first = await _turn(
        "chicken curry", None, RecipeConstraints(preferred_ingredients=["chicken"]), stored
    )
    card = _card_of(first)
    assert card.diets_set_aside == ["Vegetarian"]
    nxt = await _save(first)

    refined, sent = await _refine(
        card, "make it spicier", stored, nxt["metadata"]["recipe_constraints"]
    )

    assert "dietary" not in sent
    assert _card_of(refined).diets_set_aside == ["Vegetarian"]


@pytest.mark.asyncio
async def test_a_new_request_after_that_gets_vegetarian_back() -> None:
    stored = ["Vegetarian"]
    first = await _turn(
        "chicken curry", None, RecipeConstraints(preferred_ingredients=["chicken"]), stored
    )
    nxt = await _save(first)

    second = await _turn("something with rice", nxt, None, stored)

    assert second["recipe_constraints"]["dietary"] == ["Vegetarian"]
    assert _card_of(second).diets_set_aside == []


@pytest.mark.asyncio
async def test_naming_the_food_again_still_sets_the_diet_aside_for_that_turn() -> None:
    """Turn-scoping must not weaken the per-turn check."""
    stored = ["Vegetarian"]
    first = await _turn(
        "chicken curry", None, RecipeConstraints(preferred_ingredients=["chicken"]), stored
    )
    nxt = await _save(first)

    second = await _turn(
        "chicken tikka instead", nxt, RecipeConstraints(preferred_ingredients=["chicken"]), stored
    )

    assert not second["recipe_constraints"].get("dietary")
    assert _card_of(second).diets_set_aside == ["Vegetarian"]


# ---------------------------------------------------------------------------
# must_use_ingredients is turn-scoped the same way as preferred_ingredients
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_must_use_food_that_set_the_diet_aside_is_not_remembered() -> None:
    stored = ["Vegetarian"]
    first = await _turn(
        "use up my chicken tonight",
        None,
        RecipeConstraints(must_use_ingredients=["chicken", "rice"]),
        stored,
    )
    assert _card_of(first).diets_set_aside == ["Vegetarian"]

    nxt = await _save(first)

    persisted = nxt["metadata"]["recipe_constraints"]
    assert persisted["must_use_ingredients"] == ["rice"]
    second = await _turn("something quick", nxt, None, stored)
    assert second["recipe_constraints"]["dietary"] == ["Vegetarian"]
    assert "chicken" not in (second["recipe_constraints"].get("must_use_ingredients") or [])


# ---------------------------------------------------------------------------
# brainstorm -> pick is one request: the food the brainstorm asked for survives
# until the pick, whose title may not name it
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["must_use_ingredients", "preferred_ingredients"])
async def test_a_pick_keeps_the_food_the_brainstorm_asked_for(field: str) -> None:
    stored = ["Vegetarian"]
    ai = _FakeAI(RecipeConstraints(**{field: ["chicken"]}))

    # Turn 1: "give me some chicken ideas" under a stored Vegetarian diet.
    with _env(stored, ai):
        brainstorm: Any = _state("give me some chicken ideas", None)
        brainstorm = await extract_recipe_constraints(brainstorm)
    saved = ConversationSession(conversation_id="conv-719")
    repo = MagicMock()
    repo.get_or_create_session = AsyncMock(return_value=saved)
    repo.update_session = AsyncMock(return_value=None)
    with patch(f"{_ROUTER}.get_repository", AsyncMock(return_value=repo)):
        await update_session_node(
            {
                **brainstorm,
                "intent": Intent.RECIPE_BRAINSTORM.value,
                "next_action": NextAction.PICK_RECIPE.value,
                "brainstorm_ideas": ["Honey Garlic Thighs", "Lemon Herb Drumsticks"],
                "conversation_id": "conv-719",
            }  # type: ignore[typeddict-item]
        )
    persisted: ConversationSession = repo.update_session.await_args.args[1]
    session = {"metadata": persisted.metadata.model_dump(mode="json")}
    assert session["metadata"]["recipe_constraints"][field] == ["chicken"]

    # Turn 2: pick a dish whose title does not name chicken.
    with _env(stored, _FakeAI()):
        pick: Any = _state("Honey Garlic Thighs", session)
        pick["selected_recipe_name"] = "Honey Garlic Thighs"
        pick = await research_recipe(pick)
        pick = await generate_grounded_recipe(pick)

    assert "dietary" not in pick["recipe_constraints"]
    assert pick["recipe_constraints"][field] == ["chicken"]
    assert _card_of(pick).diets_set_aside == ["Vegetarian"]

    # And the pick ends it: the next turn gets Vegetarian back, without the chicken.
    nxt = await _save(pick)
    assert field not in nxt["metadata"]["recipe_constraints"] or not nxt["metadata"][
        "recipe_constraints"
    ][field]
    after = await _turn("something quick", nxt, None, stored)
    assert after["recipe_constraints"]["dietary"] == ["Vegetarian"]
