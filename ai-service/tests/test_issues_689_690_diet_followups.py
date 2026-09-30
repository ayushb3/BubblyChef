"""Issues #689 + #690: diet follow-ups to the shared matcher (PR #688).

#689: `fixed_main_constraints` compares a card's dietary tags through `norm_label`, so a
"dairy-free" tag is inherited under any spelling of the label.

#690: a STORED diet on the first turn (the #394 combine) gets the same two-part test the
inherited conversation diet gets: the negation-aware per-clause text AND the whole
message must both name the food before the diet is set aside.

No live model: the AI manager is a fake and the stored diet is patched.
"""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.domain.diet_terms import norm_label
from bubbly_chef.models.recipe import Ingredient, RecipeCard, RecipeConstraints
from bubbly_chef.workflows.meal.fixed_main import fixed_main_constraints
from bubbly_chef.workflows.recipe.nodes import (
    _combine_dietary_preferences,
    extract_recipe_constraints,
    generate_grounded_recipe,
    research_recipe,
    score_pantry_ingredients,
)
from bubbly_chef.workflows.state import LLMRecipeResult

_NODES = "bubbly_chef.workflows.recipe.nodes"
_FIXED_STORED = "bubbly_chef.workflows.meal.fixed_main.get_stored_dietary_preferences"
USER = "user-689-690"


# ---------------------------------------------------------------------------
# #689: fixed_main_constraints inherits tags through norm_label
# ---------------------------------------------------------------------------


def _meal_state() -> Any:
    return {
        "input_text": "Make it a meal",
        "user_id": USER,
        "context": None,
        "session": None,
        "errors": [],
        "warnings": [],
    }


def _main(title: str, *names: str, tags: list[str] | None = None) -> RecipeCard:
    return RecipeCard(
        title=title, ingredients=[Ingredient(name=n) for n in names], dietary_tags=tags or []
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("tag", ["Dairy Free", "dairy-free", "dairy_free", " DAIRY-FREE "])
async def test_689_a_dairy_free_tag_is_inherited_under_any_spelling(tag: str) -> None:
    card = _main("Coconut Curry", "chickpeas", "coconut milk", tags=[tag])
    with patch(_FIXED_STORED, AsyncMock(return_value=[])):
        constraints = await fixed_main_constraints(_meal_state(), card)

    assert [norm_label(d) for d in constraints["dietary"]] == ["dairy-free"]


@pytest.mark.asyncio
async def test_689_a_non_inheritable_tag_is_still_not_inherited() -> None:
    card = _main("Quick Pasta", "pasta", tags=["Quick", "Comfort Food"])
    with patch(_FIXED_STORED, AsyncMock(return_value=[])):
        constraints = await fixed_main_constraints(_meal_state(), card)

    assert constraints["dietary"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("stored", ["Dairy Free", "dairy_free", "DAIRY-FREE"])
async def test_689_a_stored_spelling_and_a_tag_spelling_collapse_to_one_label(
    stored: str,
) -> None:
    card = _main("Coconut Curry", "chickpeas", "coconut milk", tags=["dairy-free"])
    with patch(_FIXED_STORED, AsyncMock(return_value=[stored])):
        constraints = await fixed_main_constraints(_meal_state(), card)

    assert len(constraints["dietary"]) == 1


# ---------------------------------------------------------------------------
# #690: the stored-diet first-turn check ignores negated foods
# ---------------------------------------------------------------------------


class _FakeAI:
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

    def sent(self) -> list[str]:
        """The `dietary` list the grounded generator was actually handed."""
        for line in self.recipe_prompts[-1].splitlines():
            if line.startswith("Constraints: "):
                parsed: dict[str, Any] = json.loads(line[len("Constraints: ") :])
                return list(parsed.get("dietary") or [])
        raise AssertionError("no Constraints line in the grounded prompt")


@contextmanager
def _env(stored: list[str], ai: _FakeAI) -> Iterator[None]:
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    with (
        patch(f"{_NODES}.get_stored_dietary_preferences", AsyncMock(return_value=stored)),
        patch(f"{_NODES}.get_ai_manager", MagicMock(return_value=ai)),
        patch(f"{_NODES}.get_repository", AsyncMock(return_value=repo)),
        patch(f"{_NODES}.search_recipe", AsyncMock(return_value=None)),
    ):
        yield


async def _first_turn(
    text: str, stored: list[str], extraction: RecipeConstraints | None = None
) -> list[str]:
    """The dietary list sent to the generator on a first direct turn."""
    ai = _FakeAI(extraction)
    state: Any = {
        "input_text": text,
        "user_id": USER,
        "errors": [],
        "warnings": [],
        "session": None,
    }
    with _env(stored, ai):
        for node in (
            extract_recipe_constraints,
            score_pantry_ingredients,
            research_recipe,
            generate_grounded_recipe,
        ):
            state = await node(state)
    return ai.sent()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text",
    [
        "pizza without pepperoni",
        "pasta with no chicken",
        "pasta without chicken",
        "a burger with no bacon please",
        "vegan pulled pork tacos",
    ],
)
async def test_690_a_negated_or_plant_food_keeps_the_stored_vegetarian(text: str) -> None:
    assert await _first_turn(text, ["Vegetarian"]) == ["Vegetarian"]


@pytest.mark.asyncio
@pytest.mark.parametrize("text", ["chicken curry", "make me a pork chop", "pasta with bacon"])
async def test_690_a_plainly_asked_for_food_still_sets_the_stored_diet_aside(text: str) -> None:
    assert await _first_turn(text, ["Vegetarian"]) == []


@pytest.mark.asyncio
async def test_690_an_extracted_forbidden_ingredient_still_sets_the_diet_aside() -> None:
    # The extractor can fold "chicken curry" into a field rather than the message text.
    extraction = RecipeConstraints(preferred_ingredients=["chicken"])
    assert await _first_turn("something for dinner", ["Vegetarian"], extraction) == []


def test_690_combine_unit_rows() -> None:
    def combine(stored: list[str], text: str) -> list[str]:
        return _combine_dietary_preferences(stored, [], {}, text)

    assert combine(["Vegetarian"], "pizza without pepperoni") == ["Vegetarian"]
    assert combine(["Vegetarian"], "pasta with no chicken") == ["Vegetarian"]
    assert combine(["Vegetarian"], "vegan pulled pork tacos") == ["Vegetarian"]
    assert combine(["Vegetarian"], "chicken curry") == []
    assert combine(["Vegan"], "pizza without cheese") == ["Vegan"]
