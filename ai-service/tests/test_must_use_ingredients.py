"""Issue #138: "must use this ingredient" hint in the recipe grounding workflow.

Covers the deep-link flow where tapping an expiring pantry item auto-sends
"What can I make with my eggs before they go bad?" — the grounding workflow
must bias suggestions toward that ingredient instead of treating it as
generic chatter.
"""

from datetime import date, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.recipe import RecipeConstraints
from bubbly_chef.workflows.recipe.nodes import (
    brainstorm_recipe_ideas,
    extract_recipe_constraints,
    generate_grounded_recipe,
    score_and_rank,
)
from bubbly_chef.workflows.state import LLMRecipeResult


def _mock_ai(return_value: Any) -> Any:
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=return_value)
    return patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager",
        MagicMock(return_value=ai),
    )


def _item(name: str, days_until_expiry: int | None = None) -> dict[str, Any]:
    item: dict[str, Any] = {"name": name, "quantity": 1, "unit": "item"}
    if days_until_expiry is not None:
        item["expiry_date"] = (date.today() + timedelta(days=days_until_expiry)).isoformat()
    return item


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------


def test_constraints_default_to_empty_must_use() -> None:
    assert RecipeConstraints().must_use_ingredients == []


# ---------------------------------------------------------------------------
# extract_recipe_constraints
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_extraction_populates_must_use_ingredients() -> None:
    """The structured LLM result's must_use_ingredients reaches workflow state."""
    extracted = RecipeConstraints(meal_type="dinner", must_use_ingredients=["eggs"])
    with _mock_ai(extracted):
        result = await extract_recipe_constraints(
            {"input_text": "What can I make with my eggs before they go bad?"}
        )
    assert result["recipe_constraints"]["must_use_ingredients"] == ["eggs"]


@pytest.mark.asyncio
async def test_extraction_prompt_explains_must_use_field() -> None:
    """The prompt has to teach the model the must-use vs. preferred distinction."""
    with _mock_ai(RecipeConstraints()) as mock_mgr:
        await extract_recipe_constraints({"input_text": "what's for dinner?"})
    prompt = mock_mgr.return_value.complete.call_args.kwargs["prompt"]
    assert "must_use_ingredients" in prompt
    assert "preferred_ingredients" in prompt


@pytest.mark.asyncio
async def test_extraction_without_named_ingredient_stays_empty() -> None:
    """Regression guard: generic requests must not gain a phantom constraint."""
    with _mock_ai(RecipeConstraints(meal_type="dinner")):
        result = await extract_recipe_constraints({"input_text": "what's for dinner?"})
    assert result["recipe_constraints"]["must_use_ingredients"] == []


@pytest.mark.asyncio
async def test_extraction_failure_still_yields_usable_constraints() -> None:
    """A failed LLM call must not break the node (pre-existing behaviour)."""
    ai = MagicMock()
    ai.complete = AsyncMock(side_effect=RuntimeError("provider down"))
    with patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager", MagicMock(return_value=ai)
    ):
        result = await extract_recipe_constraints({"input_text": "use up my eggs"})
    # Constraints collapse to {} on failure — downstream reads must stay safe
    assert result["recipe_constraints"].get("must_use_ingredients", []) == []
    assert result["recipe_constraints"]["meal_type"]  # defaulted from time of day
    assert score_and_rank([_item("eggs")], result["recipe_constraints"])


# ---------------------------------------------------------------------------
# score_and_rank
# ---------------------------------------------------------------------------


def test_must_use_item_outranks_a_more_urgent_item() -> None:
    """The named ingredient leads even when something else expires sooner."""
    items = [_item("milk", days_until_expiry=1), _item("eggs", days_until_expiry=20)]
    ranked = score_and_rank(items, {"must_use_ingredients": ["eggs"]})
    assert ranked[0]["name"] == "eggs"
    assert ranked[0]["_must_use"] is True
    assert ranked[1]["_must_use"] is False


def test_must_use_composes_with_expiry_rather_than_replacing_it() -> None:
    """Within the must-use group, expiry urgency still orders items."""
    items = [_item("eggs", days_until_expiry=20), _item("egg noodles", days_until_expiry=1)]
    ranked = score_and_rank(items, {"must_use_ingredients": ["egg"]})
    assert [i["name"] for i in ranked] == ["egg noodles", "eggs"]
    assert ranked[0]["_score"] == 24  # 20 must-use + 4 expiring ≤3d
    assert ranked[1]["_score"] == 20


def test_must_use_matches_substring_both_directions() -> None:
    items = [_item("large free-range eggs"), _item("flour")]
    ranked = score_and_rank(items, {"must_use_ingredients": ["eggs"]})
    assert ranked[0]["name"] == "large free-range eggs"
    assert ranked[0]["_must_use"] is True


def test_exclusion_still_beats_must_use() -> None:
    """An excluded ingredient stays filtered out even if also flagged must-use."""
    items = [_item("eggs"), _item("flour")]
    ranked = score_and_rank(
        items, {"must_use_ingredients": ["eggs"], "excluded_ingredients": ["eggs"]}
    )
    assert [i["name"] for i in ranked] == ["flour"]


def test_empty_must_use_leaves_existing_ranking_unchanged() -> None:
    """Regression guard: no must-use hint means the old scoring, untouched."""
    items = [_item("flour"), _item("milk", days_until_expiry=2), _item("basil")]
    baseline = score_and_rank(items, {"cuisine": "italian"})
    with_empty = score_and_rank(items, {"cuisine": "italian", "must_use_ingredients": []})
    assert [i["name"] for i in baseline] == [i["name"] for i in with_empty]
    assert [i["_score"] for i in baseline] == [4, 3, 0]  # milk ≤3d, basil (italian), flour
    assert all(i["_must_use"] is False for i in baseline)


def test_fit_beats_bare_expiry() -> None:
    """Issue #347: a strong cuisine + preference match must outrank a bare
    expiring item with no fit. Expiry ≤3d = +4; cuisine + preferred = 3 + 5 = 8."""
    items = [
        # expiring soon but no cuisine/preference fit
        _item("banana", days_until_expiry=2),
        # not expiring but matches cuisine + preferred
        _item("tomato", days_until_expiry=30),
    ]
    ranked = score_and_rank(
        items,
        {"cuisine": "italian", "preferred_ingredients": ["tomato"]},
    )
    assert ranked[0]["name"] == "tomato"   # 3 + 5 = 8
    assert ranked[1]["name"] == "banana"   # 4
    assert ranked[0]["_score"] == 8
    assert ranked[1]["_score"] == 4


def test_expiring_preferred_item_still_leads_non_expiring_cuisine_match() -> None:
    """Expiry as tiebreaker within similar fit: expiring preferred (4 + 5 = 9)
    beats non-expiring cuisine-only match (3)."""
    items = [
        _item("parmesan", days_until_expiry=60),  # cuisine match only
        _item("tofu", days_until_expiry=2),        # preferred + expiring (not in italian keywords)
    ]
    ranked = score_and_rank(
        items,
        {"cuisine": "italian", "preferred_ingredients": ["tofu"]},
    )
    assert ranked[0]["name"] == "tofu"     # 5 preferred + 4 expiring ≤3d = 9
    assert ranked[1]["name"] == "parmesan" # cuisine match only = 3
    assert ranked[0]["_score"] == 9
    assert ranked[1]["_score"] == 3


# ---------------------------------------------------------------------------
# score_and_rank — expired stock (#239)
# ---------------------------------------------------------------------------


def test_expired_item_is_flagged_and_not_promoted() -> None:
    """Past-date stock scores neutral and carries `_expired`, never the +10
    urgency bonus an unbounded `days_left <= 3` used to hand it (#239)."""
    ranked = score_and_rank([_item("spinach", days_until_expiry=-14)], {})
    assert ranked[0]["_expired"] is True
    assert ranked[0]["_score"] == 0


def test_fresh_item_is_not_flagged_expired() -> None:
    """The `_expired` flag stays off for in-date items, and expiry scoring holds."""
    ranked = score_and_rank(
        [_item("milk", days_until_expiry=1), _item("rice", days_until_expiry=30)], {}
    )
    by_name = {i["name"]: i for i in ranked}
    assert by_name["milk"]["_expired"] is False
    assert by_name["milk"]["_score"] == 4  # expiring ≤3d
    assert by_name["rice"]["_expired"] is False


def test_expired_item_ranks_below_a_fresh_expiring_item() -> None:
    """An expired item must not lead the list over genuinely urgent stock."""
    ranked = score_and_rank(
        [_item("old lettuce", days_until_expiry=-10), _item("milk", days_until_expiry=1)],
        {},
    )
    assert ranked[0]["name"] == "milk"


def test_expired_item_still_promoted_when_explicitly_must_use() -> None:
    """A must-use item is an explicit user request — it survives the expiry rule."""
    ranked = score_and_rank(
        [_item("eggs", days_until_expiry=-2), _item("flour")],
        {"must_use_ingredients": ["eggs"]},
    )
    assert ranked[0]["name"] == "eggs"
    assert ranked[0]["_must_use"] is True
    assert ranked[0]["_expired"] is True


# ---------------------------------------------------------------------------
# brainstorm_recipe_ideas — prompt grounding
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_brainstorm_prompt_surfaces_must_use_ingredient() -> None:
    scored = score_and_rank(
        [_item("eggs"), _item("flour")], {"must_use_ingredients": ["eggs"]}
    )
    with _mock_ai("**Egg Fried Rice**") as mock_mgr:
        await brainstorm_recipe_ideas(
            {
                "input_text": "What can I make with my eggs before they go bad?",
                "scored_pantry_items": scored,
                "recipe_constraints": {"must_use_ingredients": ["eggs"]},
            }
        )
    prompt = mock_mgr.return_value.complete.call_args.kwargs["prompt"]
    assert "Must use" in prompt
    assert "eggs" in prompt
    # The must-use item must not be mislabelled as expiring
    expiring_line = next(li for li in prompt.splitlines() if li.startswith("Expiring soon"))
    assert "eggs" not in expiring_line


@pytest.mark.asyncio
async def test_brainstorm_surfaces_must_use_ingredient_absent_from_pantry() -> None:
    """A named ingredient the user doesn't own still binds the suggestions."""
    with _mock_ai("**Egg Fried Rice**") as mock_mgr:
        await brainstorm_recipe_ideas(
            {
                "input_text": "something with eggs",
                "scored_pantry_items": [],
                "recipe_constraints": {"must_use_ingredients": ["eggs"]},
            }
        )
    prompt = mock_mgr.return_value.complete.call_args.kwargs["prompt"]
    assert "Must use: eggs" in prompt


@pytest.mark.asyncio
async def test_brainstorm_prompt_omits_must_use_when_unset() -> None:
    """Regression guard: no hint means no must-use noise in the prompt."""
    scored = score_and_rank([_item("flour"), _item("milk", days_until_expiry=1)], {})
    with _mock_ai("**Pancakes**") as mock_mgr:
        await brainstorm_recipe_ideas(
            {
                "input_text": "what's for dinner?",
                "scored_pantry_items": scored,
                "recipe_constraints": {},
            }
        )
    prompt = mock_mgr.return_value.complete.call_args.kwargs["prompt"]
    # The static rule mentions "Must use", but no must-use data line is emitted
    assert not any(li.startswith("Must use") for li in prompt.splitlines())
    assert "Expiring soon (weave in where it fits, not mandatory): milk" in prompt


@pytest.mark.asyncio
async def test_brainstorm_drops_expired_stock_from_the_pool() -> None:
    """Expired items must not reach the suggestion prompt at all (#239)."""
    scored = score_and_rank(
        [_item("fresh basil", days_until_expiry=2), _item("old spinach", days_until_expiry=-14)],
        {},
    )
    with _mock_ai("**Basil Pasta**") as mock_mgr:
        await brainstorm_recipe_ideas(
            {
                "input_text": "what's for dinner?",
                "scored_pantry_items": scored,
                "recipe_constraints": {},
            }
        )
    prompt = mock_mgr.return_value.complete.call_args.kwargs["prompt"]
    assert "basil" in prompt
    assert "spinach" not in prompt


@pytest.mark.asyncio
async def test_brainstorm_keeps_expired_item_when_must_use() -> None:
    """A must-use item survives the expiry drop — user asked for it explicitly."""
    scored = score_and_rank(
        [_item("eggs", days_until_expiry=-2)], {"must_use_ingredients": ["eggs"]}
    )
    with _mock_ai("**Scramble**") as mock_mgr:
        await brainstorm_recipe_ideas(
            {
                "input_text": "use up my eggs",
                "scored_pantry_items": scored,
                "recipe_constraints": {"must_use_ingredients": ["eggs"]},
            }
        )
    prompt = mock_mgr.return_value.complete.call_args.kwargs["prompt"]
    assert "eggs" in prompt


@pytest.mark.asyncio
async def test_brainstorm_defaults_meal_type_when_unset() -> None:
    """Without a meal_type the prompt would let the model pick freely, yielding
    breakfast at midnight (#248). The node falls back to the time of day."""
    from bubbly_chef.workflows.recipe.nodes import _default_meal_type

    # Provide a non-empty pantry so the #243 empty-pantry ingest-prompt guard
    # doesn't short-circuit before the LLM is called. The meal-type fallback
    # being tested is independent of pantry state, but the guard fires when
    # scored_pantry_items=[] + no must_use, which would bypass the LLM entirely.
    scored = score_and_rank([_item("flour"), _item("milk", days_until_expiry=3)], {})
    with _mock_ai("**Dinner Idea**") as mock_mgr:
        await brainstorm_recipe_ideas(
            {
                "input_text": "what can I make?",
                "scored_pantry_items": scored,
                "recipe_constraints": {},
            }
        )
    prompt = mock_mgr.return_value.complete.call_args.kwargs["prompt"]
    assert _default_meal_type() in prompt


# ---------------------------------------------------------------------------
# generate_grounded_recipe — prompt grounding
# ---------------------------------------------------------------------------


def _llm_recipe() -> LLMRecipeResult:
    return LLMRecipeResult(
        title="Egg Fried Rice",
        ingredients=[{"name": "eggs", "quantity": 2, "unit": "item"}],
        instructions=["Scramble the eggs."],
        confidence=0.9,
    )


@pytest.mark.asyncio
async def test_grounded_recipe_prompt_names_must_use_ingredient() -> None:
    scored = score_and_rank([_item("eggs"), _item("rice")], {"must_use_ingredients": ["eggs"]})
    with _mock_ai(_llm_recipe()) as mock_mgr:
        await generate_grounded_recipe(
            {
                "selected_recipe_name": "Egg Fried Rice",
                "scored_pantry_items": scored,
                "recipe_constraints": {"must_use_ingredients": ["eggs"]},
                "warnings": [],
                "errors": [],
            }
        )
    prompt = mock_mgr.return_value.complete.call_args.kwargs["prompt"]
    assert "Must-use ingredients" in prompt
    must_use_line = next(li for li in prompt.splitlines() if li.startswith("Must-use"))
    assert "eggs" in must_use_line


@pytest.mark.asyncio
async def test_grounded_recipe_prompt_without_must_use_is_unchanged() -> None:
    """Regression guard: the must-use slot degrades to 'none specified'."""
    scored = score_and_rank([_item("rice")], {})
    with _mock_ai(_llm_recipe()) as mock_mgr:
        result = await generate_grounded_recipe(
            {
                "selected_recipe_name": "Egg Fried Rice",
                "scored_pantry_items": scored,
                "recipe_constraints": {},
                "warnings": [],
                "errors": [],
            }
        )
    prompt = mock_mgr.return_value.complete.call_args.kwargs["prompt"]
    must_use_line = next(li for li in prompt.splitlines() if li.startswith("Must-use"))
    assert "none specified" in must_use_line
    assert result["proposal"].recipe.title == "Egg Fried Rice"
