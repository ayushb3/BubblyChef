"""Issue #721: a refine's reported names may carry the ingredient line's decoration.

The previous card is shown to the model as `- 250.0 g cheddar cheese, shredded`
and the prompt tells it to copy names "exactly as written", so a model that
obeys reports `250.0 g cheddar cheese`. `_find` used to match only a bare name,
so that removal was silently dropped and the ingredient stayed on the card.
The prompt now asks for the name alone, and matching tolerates the rendered
form either way. No model is involved: everything here is a pure function or
the rendered prompt.
"""

import pytest

from bubbly_chef.models.recipe import Ingredient, RecipeCard
from bubbly_chef.prompts.recipe import RECIPE_FOLLOWUP_PROMPT
from bubbly_chef.services.recipe_generator import AIRecipeRefineOutput, format_recipe_for_context
from bubbly_chef.services.recipe_refine import apply_ingredient_edits


def _card_ingredients() -> list[Ingredient]:
    return [
        Ingredient(name="cheddar cheese", quantity=250, unit="g", preparation="shredded"),
        Ingredient(name="butter", quantity=250, unit="g"),
        Ingredient(name="basmati rice", quantity=2, unit="kg"),
        Ingredient(name="canned chopped tomatoes", quantity=4, unit="can"),
        Ingredient(name="large free-range eggs", quantity=12, unit="count"),
        Ingredient(name="parsley", quantity=1, unit="bunch", optional=True),
        Ingredient(name="olive oil", quantity=1, unit="bottle"),
        Ingredient(name="salt"),
    ]


def _names(ingredients: list[Ingredient]) -> list[str]:
    return [i.name for i in ingredients]


# The exact strings the live model reported in #691 (issue #721's evidence table).
@pytest.mark.parametrize(
    ("reported", "gone"),
    [
        ("250.0 g cheddar cheese", "cheddar cheese"),
        ("250.0 g cheddar cheese, shredded", "cheddar cheese"),
        ("250.0 g butter", "butter"),
        ("2.0 kg basmati rice", "basmati rice"),
        ("4.0 can canned chopped tomatoes", "canned chopped tomatoes"),
        ("12.0 count large free-range eggs", "large free-range eggs"),
        ("1 bunch parsley (optional)", "parsley"),
        ("1 bottle olive oil", "olive oil"),
        ("1/2 cup butter", "butter"),
    ],
)
def test_a_removal_copied_with_its_quantity_is_applied(reported: str, gone: str) -> None:
    applied = apply_ingredient_edits(_card_ingredients(), removed=[reported])

    assert gone not in _names(applied.ingredients)
    assert len(applied.ingredients) == len(_card_ingredients()) - 1
    assert applied.unmatched_removals == []


def test_every_rendered_line_of_the_card_removes_its_ingredient() -> None:
    """The issue's test: feed back the line exactly as the model saw it."""
    previous = _card_ingredients()
    card = RecipeCard(title="T", ingredients=previous, instructions=["Cook."])
    rendered = [
        line[2:] for line in format_recipe_for_context(card).splitlines() if line.startswith("- ")
    ]
    assert len(rendered) == len(previous)

    for line, ingredient in zip(rendered, previous, strict=True):
        applied = apply_ingredient_edits(previous, removed=[line])
        assert ingredient.name not in _names(applied.ingredients), line
        assert len(applied.ingredients) == len(previous) - 1, line


def test_a_changed_name_copied_with_its_quantity_still_updates_that_row() -> None:
    applied = apply_ingredient_edits(
        _card_ingredients(),
        changed=[Ingredient(name="250.0 g butter", quantity=100, unit="g")],
    )

    butter = next(i for i in applied.ingredients if i.name == "butter")
    assert butter.quantity == 100
    assert applied.unmatched_changes == []
    assert len(applied.ingredients) == len(_card_ingredients())


def test_a_plain_name_still_matches() -> None:
    applied = apply_ingredient_edits(_card_ingredients(), removed=["cheddar cheese"])

    assert "cheddar cheese" not in _names(applied.ingredients)
    assert applied.unmatched_removals == []


def test_a_shortened_name_still_matches_by_its_words() -> None:
    previous = [Ingredient(name="cheddar cheese", quantity=250, unit="g"), Ingredient(name="eggs")]

    applied = apply_ingredient_edits(previous, removed=["250 g cheese"])

    assert _names(applied.ingredients) == ["eggs"]


def test_an_unrelated_name_still_matches_nothing() -> None:
    for reported in ("250.0 g tofu", "tofu", "3 cloves garlic"):
        applied = apply_ingredient_edits(_card_ingredients(), removed=[reported])

        assert _names(applied.ingredients) == _names(_card_ingredients()), reported
        assert applied.unmatched_removals == [reported]


def test_a_bare_quantity_is_not_a_name() -> None:
    applied = apply_ingredient_edits(_card_ingredients(), removed=["250.0 g"])

    assert len(applied.ingredients) == len(_card_ingredients())
    assert applied.unmatched_removals == ["250.0 g"]


def test_the_prompt_asks_for_the_name_alone() -> None:
    rendered = " ".join(
        RECIPE_FOLLOWUP_PROMPT.format(
            previous_recipe="Title: X",
            pantry_items_formatted="none",
            user_prompt="make it vegan",
            dietary_requirements="",
        ).split()
    )

    assert "copied exactly as written" not in rendered
    assert "name alone" in rendered
    assert "without its amount, unit or preparation" in rendered
    assert "cheddar cheese" in rendered


def test_the_schema_description_asks_for_the_name_alone() -> None:
    description = AIRecipeRefineOutput.model_json_schema()["properties"]["removed"]["description"]

    assert "without" in description and "amount" in description
