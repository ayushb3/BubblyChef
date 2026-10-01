"""Issue #720: a chat recipe card with no ingredients or steps must never ship.

`LLMRecipeResult` marked `ingredients` / `instructions` optional
(`default_factory=list`), so the JSON schema Ollama is handed as `format=` did not
list them as required, and a small local model answered with only a title and
times. The pipeline accepted that: "Here's a recipe for Chicken Stir Fry!" with a
Cook button on an empty card. Two fixes, both pinned here:

* the schema requires both fields, non-empty (so a grammar-constrained model has
  to produce them);
* a result that still arrives with an empty list (a provider that doesn't enforce
  the schema, an explicit `[]`) is a failed generation: asked for once more, then
  an honest error, never a card.

The model is always a fake. Whether a real Ollama/Gemini run now returns full
cards is the live re-check tracked in issue #691.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from bubbly_chef.models.base import Intent, NextAction
from bubbly_chef.models.recipe import RecipeCard, RecipeConstraints
from bubbly_chef.services.recipe_generator import AIRecipeOutput, AIRecipeRefineOutput
from bubbly_chef.workflows.meal.nodes import MealDishLLMResult
from bubbly_chef.workflows.recipe.nodes import (
    extract_recipe_constraints,
    generate_grounded_recipe,
    research_recipe,
    score_pantry_ingredients,
)
from bubbly_chef.workflows.recipe_result import (
    BlankRecipeError,
    complete_recipe,
    is_blank_recipe,
)
from bubbly_chef.workflows.state import LLMRecipeResult

_NODES = "bubbly_chef.workflows.recipe.nodes"
USER = "user-720"


def _title_only(title: str = "Chicken Stir Fry") -> LLMRecipeResult:
    """What gemma3:4b returned in the #691 live run: no ingredients, no steps.

    `model_construct` skips validation, standing in for a provider that doesn't
    enforce the schema (or a stub) so the pipeline's own guard is what's tested.
    """
    return LLMRecipeResult.model_construct(
        title=title,
        description="A quick stir fry.",
        prep_time_minutes=20,
        ingredients=[],
        instructions=[],
        steps=[],
        confidence=0.85,
    )


def _full(title: str = "Chicken Stir Fry") -> LLMRecipeResult:
    return LLMRecipeResult(
        title=title,
        ingredients=[{"name": "chicken breast", "quantity": 1, "unit": "lb"}],
        instructions=["Slice the chicken.", "Stir fry it."],
        confidence=0.9,
    )


# ---------------------------------------------------------------------------
# The schema
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("model", [LLMRecipeResult, MealDishLLMResult])
def test_the_chat_recipe_schema_lists_ingredients_and_instructions_as_required(
    model: type[LLMRecipeResult],
) -> None:
    schema = model.model_json_schema()

    assert {"title", "ingredients", "instructions"} <= set(schema["required"])
    assert schema["properties"]["ingredients"]["minItems"] == 1
    assert schema["properties"]["instructions"]["minItems"] == 1


@pytest.mark.parametrize("model", [AIRecipeOutput, AIRecipeRefineOutput])
def test_the_sibling_ai_recipe_schemas_do_not_accept_empty_lists_either(
    model: type[AIRecipeOutput],
) -> None:
    schema = model.model_json_schema()

    assert {"ingredients", "instructions"} <= set(schema["required"])
    assert schema["properties"]["ingredients"]["minItems"] == 1
    assert schema["properties"]["instructions"]["minItems"] == 1


def test_a_title_only_answer_does_not_validate() -> None:
    """The decoder can skip the keys no longer: a missing one is a validation error."""
    with pytest.raises(ValidationError):
        LLMRecipeResult.model_validate({"title": "Chicken Stir Fry", "confidence": 0.85})


@pytest.mark.parametrize(
    "payload",
    [
        {"title": "T", "ingredients": [], "instructions": ["Cook."]},
        {"title": "T", "ingredients": [{"name": "rice"}], "instructions": []},
    ],
)
def test_an_explicitly_empty_list_does_not_validate(payload: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        LLMRecipeResult.model_validate(payload)


def test_steps_stay_optional_because_a_card_is_valid_without_them() -> None:
    """`RecipeCard.steps` is derived lazily when absent (#648), so it is not required."""
    result = LLMRecipeResult.model_validate(
        {"title": "T", "ingredients": [{"name": "rice"}], "instructions": ["Cook."]}
    )

    assert result.steps == []
    assert "steps" not in LLMRecipeResult.model_json_schema()["required"]


def test_a_valid_card_passes_the_schema() -> None:
    result = _full()

    assert not is_blank_recipe(result)
    assert is_blank_recipe(_title_only())


# ---------------------------------------------------------------------------
# complete_recipe: retry once, then refuse
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_blank_answer_is_retried_once_then_refused() -> None:
    ai = MagicMock()
    ai.complete = AsyncMock(side_effect=[_title_only(), _title_only()])

    with pytest.raises(BlankRecipeError):
        await complete_recipe(ai, prompt="P", response_schema=LLMRecipeResult, temperature=0.5)

    assert ai.complete.await_count == 2
    assert "RETRY" in ai.complete.await_args_list[1].kwargs["prompt"]
    assert ai.complete.await_args_list[0].kwargs["prompt"] == "P"


@pytest.mark.asyncio
async def test_a_blank_answer_then_a_full_one_returns_the_full_one() -> None:
    ai = MagicMock()
    ai.complete = AsyncMock(side_effect=[_title_only(), _full()])

    result = await complete_recipe(
        ai, prompt="P", response_schema=LLMRecipeResult, temperature=0.5
    )

    assert not is_blank_recipe(result)
    assert ai.complete.await_count == 2


@pytest.mark.asyncio
async def test_a_valid_card_costs_one_call() -> None:
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=_full())

    result = await complete_recipe(
        ai, prompt="P", response_schema=LLMRecipeResult, temperature=0.5
    )

    assert result.title == "Chicken Stir Fry"
    ai.complete.assert_awaited_once()


# ---------------------------------------------------------------------------
# The chat pipeline: no blank card, an honest message
# ---------------------------------------------------------------------------


class _ScriptedAI:
    """Constraint extraction returns empty; each recipe call pops the next scripted result."""

    def __init__(self, *recipe_results: LLMRecipeResult) -> None:
        self.recipe_results = list(recipe_results)
        self.recipe_calls = 0

    async def complete(self, prompt: str, response_schema: Any = None, **_: Any) -> Any:
        if response_schema is RecipeConstraints:
            return RecipeConstraints()
        if response_schema is LLMRecipeResult:
            self.recipe_calls += 1
            return self.recipe_results.pop(0)
        raise AssertionError(f"unexpected schema {response_schema}")


@contextmanager
def _env(ai: _ScriptedAI) -> Iterator[None]:
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    with (
        patch(f"{_NODES}.get_stored_dietary_preferences", AsyncMock(return_value=[])),
        patch(f"{_NODES}.get_ai_manager", MagicMock(return_value=ai)),
        patch(f"{_NODES}.get_repository", AsyncMock(return_value=repo)),
        patch(f"{_NODES}.search_recipe", AsyncMock(return_value=None)),
    ):
        yield


async def _chat_turn(ai: _ScriptedAI) -> dict[str, Any]:
    state: Any = {
        "input_text": "Give me a recipe for chicken stir fry",
        "user_id": USER,
        "errors": [],
        "warnings": [],
        "session": None,
    }
    with _env(ai):
        for node in (
            extract_recipe_constraints,
            score_pantry_ingredients,
            research_recipe,
            generate_grounded_recipe,
        ):
            state = await node(state)
    return dict(state)


@pytest.mark.asyncio
async def test_a_title_only_provider_gets_one_retry_then_an_honest_error() -> None:
    ai = _ScriptedAI(_title_only(), _title_only())

    state = await _chat_turn(ai)

    assert ai.recipe_calls == 2
    assert state["proposal"] is None
    assert state["requires_review"] is False
    assert state["next_action"] == NextAction.NONE.value
    assert state["intent"] == Intent.GENERAL_CHAT.value
    message = state["assistant_message"]
    assert "couldn't generate a recipe" in message
    assert "Here's a recipe" not in message
    assert state["errors"], "the failure is recorded, not silent"


@pytest.mark.asyncio
async def test_a_blank_first_answer_then_a_full_one_ships_the_full_card() -> None:
    ai = _ScriptedAI(_title_only(), _full())

    state = await _chat_turn(ai)

    assert ai.recipe_calls == 2
    card = state["proposal"].recipe
    assert isinstance(card, RecipeCard)
    assert [i.name for i in card.ingredients] == ["chicken breast"]
    assert card.instructions == ["Slice the chicken.", "Stir fry it."]


@pytest.mark.asyncio
async def test_a_valid_card_is_generated_with_a_single_call() -> None:
    ai = _ScriptedAI(_full())

    state = await _chat_turn(ai)

    assert ai.recipe_calls == 1
    assert state["proposal"].recipe.ingredients
    assert state["proposal"].recipe.instructions
