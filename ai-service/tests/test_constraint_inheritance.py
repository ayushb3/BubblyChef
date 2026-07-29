"""Issue #144: Recipe constraints must survive the brainstorm → follow-up turn boundary.

When the user establishes constraints on turn 1 (e.g. "vegetarian pasta, under 30 min")
and then selects an idea on turn 2 ("make me the first one"), the routing goes directly
to research_recipe, bypassing extract_recipe_constraints.  Without the fix the
constraints are silently dropped — this file covers the two-turn sequence end-to-end
and validates every constraint that must survive.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.models.recipe import RecipeConstraints
from bubbly_chef.workflows.recipe.nodes import (
    _merge_constraints,
    _prior_constraints_from_state,
    extract_recipe_constraints,
    research_recipe,
)
from bubbly_chef.workflows.state import LLMRecipeResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_recipe_nodes_ai(return_value: Any) -> Any:
    ai = MagicMock()
    ai.complete = AsyncMock(return_value=return_value)
    return patch(
        "bubbly_chef.workflows.recipe.nodes.get_ai_manager",
        MagicMock(return_value=ai),
    )


def _state_with_session_constraints(
    input_text: str,
    prior_constraints: dict[str, Any],
    **extra: Any,
) -> dict[str, Any]:
    """Build a minimal WorkflowState whose session metadata carries prior constraints."""
    return {
        "input_text": input_text,
        "errors": [],
        "warnings": [],
        "session": {
            "conversation_id": "conv-1",
            "active_mode": "recipe_exploring",
            "metadata": {"recipe_constraints": prior_constraints},
        },
        **extra,
    }


def _llm_recipe() -> LLMRecipeResult:
    return LLMRecipeResult(
        title="Veggie Pasta",
        ingredients=[{"name": "pasta", "quantity": 200, "unit": "g"}],
        instructions=["Cook pasta."],
        confidence=0.9,
    )


# ---------------------------------------------------------------------------
# Unit: _merge_constraints
# ---------------------------------------------------------------------------


def test_merge_inherits_dietary_when_fresh_is_empty() -> None:
    prior = {"dietary": ["vegetarian"], "cuisine": "italian"}
    fresh: dict[str, Any] = {"dietary": [], "cuisine": None}
    merged = _merge_constraints(prior, fresh)
    assert merged["dietary"] == ["vegetarian"]
    assert merged["cuisine"] == "italian"  # also inherited (fresh is None)


def test_merge_fresh_dietary_overrides_prior() -> None:
    prior = {"dietary": ["vegetarian"]}
    fresh: dict[str, Any] = {"dietary": ["vegan"]}
    merged = _merge_constraints(prior, fresh)
    assert merged["dietary"] == ["vegan"]


def test_merge_inherits_must_use_when_fresh_is_empty() -> None:
    prior = {"must_use_ingredients": ["eggs", "spinach"]}
    fresh: dict[str, Any] = {"must_use_ingredients": []}
    merged = _merge_constraints(prior, fresh)
    assert merged["must_use_ingredients"] == ["eggs", "spinach"]


def test_merge_fresh_must_use_overrides_prior() -> None:
    prior = {"must_use_ingredients": ["eggs"]}
    fresh: dict[str, Any] = {"must_use_ingredients": ["chicken"]}
    merged = _merge_constraints(prior, fresh)
    assert merged["must_use_ingredients"] == ["chicken"]


def test_merge_inherits_max_time_when_fresh_is_none() -> None:
    prior = {"max_time_minutes": 30}
    fresh: dict[str, Any] = {"max_time_minutes": None}
    merged = _merge_constraints(prior, fresh)
    assert merged["max_time_minutes"] == 30


def test_merge_fresh_max_time_overrides_prior() -> None:
    prior = {"max_time_minutes": 30}
    fresh: dict[str, Any] = {"max_time_minutes": 45}
    merged = _merge_constraints(prior, fresh)
    assert merged["max_time_minutes"] == 45


def test_merge_preserves_unmentioned_cuisine() -> None:
    prior = {"cuisine": "italian", "dietary": ["vegetarian"]}
    # Fresh extraction says nothing about cuisine
    fresh: dict[str, Any] = {"cuisine": None, "dietary": []}
    merged = _merge_constraints(prior, fresh)
    assert merged["cuisine"] == "italian"
    assert merged["dietary"] == ["vegetarian"]


def test_merge_with_no_prior_returns_fresh() -> None:
    fresh = {"dietary": ["vegan"], "cuisine": "thai", "must_use_ingredients": ["tofu"]}
    merged = _merge_constraints({}, fresh)
    assert merged == fresh


# ---------------------------------------------------------------------------
# Unit: _prior_constraints_from_state
# ---------------------------------------------------------------------------


def test_prior_constraints_from_state_returns_dict() -> None:
    state = _state_with_session_constraints("hi", {"dietary": ["vegetarian"]})
    result = _prior_constraints_from_state(state)
    assert result == {"dietary": ["vegetarian"]}


def test_prior_constraints_from_state_returns_none_when_no_session() -> None:
    state = {"input_text": "hi", "session": None}
    assert _prior_constraints_from_state(state) is None


def test_prior_constraints_from_state_returns_none_when_no_metadata_key() -> None:
    state = {"session": {"metadata": {}}}
    assert _prior_constraints_from_state(state) is None


# ---------------------------------------------------------------------------
# extract_recipe_constraints: merges session constraints on follow-up turns
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_extract_merges_dietary_from_session_on_followup() -> None:
    """Turn-2 extraction keeps dietary from turn 1 when user doesn't repeat it."""
    prior = {
        "dietary": ["vegetarian"],
        "cuisine": "italian",
        "must_use_ingredients": [],
        "max_time_minutes": 30,
    }
    # Fresh LLM result: user just says "make me the pasta one" — no dietary mentioned
    fresh_llm = RecipeConstraints(meal_type="dinner")

    with _mock_recipe_nodes_ai(fresh_llm):
        result = await extract_recipe_constraints(
            _state_with_session_constraints(
                "make me the pasta one", prior
            )
        )

    constraints = result["recipe_constraints"]
    assert constraints["dietary"] == ["vegetarian"], (
        "Dietary restriction from turn 1 must survive the follow-up turn"
    )
    assert constraints["cuisine"] == "italian", "Cuisine must also be inherited"
    assert constraints["max_time_minutes"] == 30, "Time limit must be inherited"


@pytest.mark.asyncio
async def test_extract_merges_must_use_from_session_on_followup() -> None:
    """Turn-2 extraction keeps must_use_ingredients from turn 1."""
    prior = {"must_use_ingredients": ["spinach", "eggs"], "dietary": []}

    fresh_llm = RecipeConstraints(meal_type="lunch")

    with _mock_recipe_nodes_ai(fresh_llm):
        result = await extract_recipe_constraints(
            _state_with_session_constraints("give me the first one", prior)
        )

    assert result["recipe_constraints"]["must_use_ingredients"] == ["spinach", "eggs"]


@pytest.mark.asyncio
async def test_extract_fresh_dietary_overrides_session_dietary() -> None:
    """If the user explicitly specifies a new dietary restriction, it wins."""
    prior = {"dietary": ["vegetarian"]}
    fresh_llm = RecipeConstraints(meal_type="dinner", dietary=["vegan"])

    with _mock_recipe_nodes_ai(fresh_llm):
        result = await extract_recipe_constraints(
            _state_with_session_constraints("actually make it vegan", prior)
        )

    assert result["recipe_constraints"]["dietary"] == ["vegan"]


@pytest.mark.asyncio
async def test_extract_without_prior_session_is_unchanged() -> None:
    """When there is no session, behaviour is identical to the original code."""
    fresh_llm = RecipeConstraints(meal_type="dinner", dietary=["gluten-free"])

    state = {"input_text": "quick gluten-free dinner", "session": None, "errors": [], "warnings": []}

    with _mock_recipe_nodes_ai(fresh_llm):
        result = await extract_recipe_constraints(state)

    assert result["recipe_constraints"]["dietary"] == ["gluten-free"]


# ---------------------------------------------------------------------------
# research_recipe: loads constraints from session when state has none (#144)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_research_recipe_inherits_constraints_from_session() -> None:
    """The brainstorm follow-up path bypasses extract_recipe_constraints.

    research_recipe must load constraints from the session so that
    generate_grounded_recipe has them for cuisine tagging and must-use
    ingredient binding.
    """
    prior = {
        "dietary": ["vegetarian"],
        "cuisine": "italian",
        "must_use_ingredients": ["spinach"],
        "max_time_minutes": 30,
    }
    state = _state_with_session_constraints(
        "make me the first one",
        prior,
        selected_recipe_name="Spinach Pasta",
        # No recipe_constraints in state — this is the bug scenario
    )

    with patch(
        "bubbly_chef.workflows.recipe.nodes.search_recipe",
        new_callable=AsyncMock,
        return_value=None,
    ):
        result = await research_recipe(state)

    # Constraints must now be present on the state for generate_grounded_recipe
    constraints = result.get("recipe_constraints") or {}
    assert constraints.get("dietary") == ["vegetarian"], (
        "Dietary restriction must be loaded from session on the brainstorm follow-up path"
    )
    assert constraints.get("cuisine") == "italian"
    assert constraints.get("must_use_ingredients") == ["spinach"]
    assert constraints.get("max_time_minutes") == 30


@pytest.mark.asyncio
async def test_research_recipe_keeps_existing_constraints_when_present() -> None:
    """If constraints are already on the state (non-brainstorm path), keep them."""
    existing = {"dietary": ["vegan"], "cuisine": "thai"}
    session_prior = {"dietary": ["vegetarian"], "cuisine": "italian"}

    state = {
        "input_text": "Pad Thai",
        "selected_recipe_name": "Pad Thai",
        "recipe_constraints": existing,
        "session": {
            "metadata": {"recipe_constraints": session_prior},
        },
        "errors": [],
        "warnings": [],
    }

    with patch(
        "bubbly_chef.workflows.recipe.nodes.search_recipe",
        new_callable=AsyncMock,
        return_value=None,
    ):
        result = await research_recipe(state)

    # Existing constraints win — session prior must NOT overwrite them
    assert result["recipe_constraints"]["dietary"] == ["vegan"]
    assert result["recipe_constraints"]["cuisine"] == "thai"


@pytest.mark.asyncio
async def test_research_recipe_without_session_works_normally() -> None:
    """No session → constraints stay empty, no crash."""
    state = {
        "input_text": "make me pasta",
        "selected_recipe_name": "Pasta",
        "session": None,
        "errors": [],
        "warnings": [],
    }

    with patch(
        "bubbly_chef.workflows.recipe.nodes.search_recipe",
        new_callable=AsyncMock,
        return_value=None,
    ):
        result = await research_recipe(state)

    # No session → empty constraints, no crash
    assert result.get("recipe_constraints") == {}


# ---------------------------------------------------------------------------
# End-to-end two-turn simulation: constraint set turn 1 → idea selected turn 2
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_two_turn_constraint_inheritance_end_to_end() -> None:
    """Simulate the full two-turn sequence described in issue #144.

    Turn 1: User asks for a vegetarian pasta recipe (brainstorm) — constraints
            are extracted and persisted to session metadata via update_session_node.
    Turn 2: User selects an idea ("make me the first one") — routing bypasses
            extract_recipe_constraints and goes straight to research_recipe.
            Constraints must still reach generate_grounded_recipe.

    This test exercises research_recipe (the node that runs on turn 2) and verifies
    that the constraints from turn 1 are present in state when it returns, ready
    for generate_grounded_recipe to consume.
    """
    # --- Simulate what update_session_node would have stored after turn 1 ---
    turn1_constraints = {
        "dietary": ["vegetarian"],
        "cuisine": "italian",
        "must_use_ingredients": [],
        "max_time_minutes": 30,
        "meal_type": "dinner",
        "mood": None,
        "servings": None,
        "skill_level": None,
        "preferred_ingredients": [],
        "excluded_ingredients": [],
    }

    # --- Turn 2 state: brainstorm follow-up, no recipe_constraints in state ---
    turn2_state = {
        "input_text": "make me the first one",
        "selected_recipe_name": "Spinach and Ricotta Pasta",
        # recipe_constraints is absent — this is the pre-fix bug state
        "session": {
            "conversation_id": "conv-1",
            "active_mode": "recipe_exploring",
            "metadata": {"recipe_constraints": turn1_constraints},
        },
        "errors": [],
        "warnings": [],
    }

    with patch(
        "bubbly_chef.workflows.recipe.nodes.search_recipe",
        new_callable=AsyncMock,
        return_value=None,
    ):
        result = await research_recipe(turn2_state)

    constraints = result.get("recipe_constraints") or {}

    # Core regression assertions
    assert "vegetarian" in (constraints.get("dietary") or []), (
        "#144: Dietary restriction from turn 1 must not be dropped on turn 2"
    )
    assert constraints.get("cuisine") == "italian", (
        "#144: Cuisine from turn 1 must not be dropped on turn 2"
    )
    assert constraints.get("max_time_minutes") == 30, (
        "#144: Time constraint from turn 1 must not be dropped on turn 2"
    )
