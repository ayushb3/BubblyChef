"""Tests for the recipe grounding workflow."""

from datetime import date, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from bubbly_chef.models.base import Intent, NextAction
from bubbly_chef.models.recipe import RecipeConstraints
from bubbly_chef.workflows.chat_ingest import (
    brainstorm_recipe_ideas,
    detect_brainstorm_followup,
    extract_recipe_constraints,
    extract_selected_recipe,
    generate_grounded_recipe,
    is_recipe_generation_request,
    research_recipe,
    score_and_rank,
    score_pantry_ingredients,
)
from bubbly_chef.workflows.state import LLMRecipeResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_pantry_item(
    name: str,
    days_until_expiry: int | None = 30,
    score: float = 0.0,
) -> dict[str, Any]:
    expiry = (date.today() + timedelta(days=days_until_expiry)).isoformat() if days_until_expiry is not None else None
    return {"name": name, "quantity": 1.0, "unit": "item", "expiry_date": expiry}


def _brainstorm_history(content: str) -> list[dict[str, Any]]:
    return [
        {"role": "user", "content": "what can I make?"},
        {"role": "assistant", "content": content, "intent": Intent.RECIPE_BRAINSTORM.value},
    ]


# ---------------------------------------------------------------------------
# 1. Constraint extraction
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_extract_constraints_cuisine() -> None:
    """'I'm feeling Chinese food' -> cuisine='Chinese'"""
    mock_result = RecipeConstraints(cuisine="Chinese")
    with patch("bubbly_chef.workflows.chat_ingest.get_ai_manager") as mock_get_mgr:
        mock_mgr = AsyncMock()
        mock_mgr.complete.return_value = mock_result
        mock_get_mgr.return_value = mock_mgr

        state: dict[str, Any] = {"input_text": "I'm feeling Chinese food", "errors": []}
        result = await extract_recipe_constraints(state)  # type: ignore[arg-type]

    assert result["recipe_constraints"]["cuisine"] == "Chinese"


@pytest.mark.asyncio
async def test_extract_constraints_dietary() -> None:
    """'something vegetarian' -> dietary=['vegetarian']"""
    mock_result = RecipeConstraints(dietary=["vegetarian"])
    with patch("bubbly_chef.workflows.chat_ingest.get_ai_manager") as mock_get_mgr:
        mock_mgr = AsyncMock()
        mock_mgr.complete.return_value = mock_result
        mock_get_mgr.return_value = mock_mgr

        state: dict[str, Any] = {"input_text": "something vegetarian", "errors": []}
        result = await extract_recipe_constraints(state)  # type: ignore[arg-type]

    assert "vegetarian" in result["recipe_constraints"]["dietary"]


@pytest.mark.asyncio
async def test_extract_constraints_empty() -> None:
    """'what can I make?' -> empty constraints"""
    mock_result = RecipeConstraints()
    with patch("bubbly_chef.workflows.chat_ingest.get_ai_manager") as mock_get_mgr:
        mock_mgr = AsyncMock()
        mock_mgr.complete.return_value = mock_result
        mock_get_mgr.return_value = mock_mgr

        state: dict[str, Any] = {"input_text": "what can I make?", "errors": []}
        result = await extract_recipe_constraints(state)  # type: ignore[arg-type]

    constraints = result["recipe_constraints"]
    assert constraints["cuisine"] is None
    assert constraints["dietary"] == []


@pytest.mark.asyncio
async def test_extract_constraints_graceful_failure() -> None:
    """AI failure -> empty constraints, no crash."""
    with patch("bubbly_chef.workflows.chat_ingest.get_ai_manager") as mock_get_mgr:
        mock_mgr = AsyncMock()
        mock_mgr.complete.side_effect = RuntimeError("provider unavailable")
        mock_get_mgr.return_value = mock_mgr

        state: dict[str, Any] = {"input_text": "make me something", "errors": []}
        result = await extract_recipe_constraints(state)  # type: ignore[arg-type]

    assert result["recipe_constraints"] == {}


# ---------------------------------------------------------------------------
# 2. Pantry scoring — deterministic, no mocks needed
# ---------------------------------------------------------------------------


def test_score_expiring_items_rank_higher() -> None:
    """Items expiring in 2 days rank above items expiring in 30 days."""
    items = [
        _make_pantry_item("old broccoli", days_until_expiry=30),
        _make_pantry_item("wilting spinach", days_until_expiry=2),
    ]
    scored = score_and_rank(items, {})
    assert scored[0]["name"] == "wilting spinach"


def test_score_cuisine_match() -> None:
    """Soy sauce ranks higher when cuisine='Chinese'."""
    items = [
        _make_pantry_item("soy sauce", days_until_expiry=60),
        _make_pantry_item("cheddar cheese", days_until_expiry=60),
    ]
    scored = score_and_rank(items, {"cuisine": "chinese"})
    assert scored[0]["name"] == "soy sauce"


def test_score_excluded_ingredients() -> None:
    """Excluded items get score -100 and sort last."""
    items = [
        _make_pantry_item("peanuts", days_until_expiry=60),
        _make_pantry_item("chicken", days_until_expiry=2),
    ]
    scored = score_and_rank(items, {"excluded_ingredients": ["peanuts"]})
    assert scored[0]["name"] == "chicken"
    peanut_entry = next(s for s in scored if s["name"] == "peanuts")
    assert peanut_entry["_score"] == -100


def test_score_preferred_ingredients() -> None:
    """Preferred items get +5 bonus."""
    items = [
        _make_pantry_item("garlic", days_until_expiry=60),
        _make_pantry_item("onion", days_until_expiry=60),
    ]
    scored = score_and_rank(items, {"preferred_ingredients": ["garlic"]})
    garlic_entry = next(s for s in scored if s["name"] == "garlic")
    onion_entry = next(s for s in scored if s["name"] == "onion")
    assert garlic_entry["_score"] > onion_entry["_score"]


def test_score_empty_pantry() -> None:
    """Empty pantry returns empty scored list."""
    scored = score_and_rank([], {"cuisine": "Italian"})
    assert scored == []


@pytest.mark.asyncio
async def test_score_pantry_ingredients_node() -> None:
    """score_pantry_ingredients node uses pantry_snapshot from state."""
    state: dict[str, Any] = {
        "pantry_snapshot": [
            _make_pantry_item("eggs", days_until_expiry=3),
            _make_pantry_item("flour", days_until_expiry=90),
        ],
        "recipe_constraints": {},
    }
    result = await score_pantry_ingredients(state)  # type: ignore[arg-type]
    assert len(result["scored_pantry_items"]) == 2
    assert result["scored_pantry_items"][0]["name"] == "eggs"


# ---------------------------------------------------------------------------
# 3. Brainstorm follow-up detection
# ---------------------------------------------------------------------------


def test_detect_followup_after_brainstorm() -> None:
    """When last assistant intent is recipe_brainstorm, detect_brainstorm_followup is True."""
    state: dict[str, Any] = {
        "conversation_history": _brainstorm_history("**Egg Fried Rice** or **Omelette**?"),
    }
    assert detect_brainstorm_followup(state) is True  # type: ignore[arg-type]


def test_no_followup_without_brainstorm() -> None:
    """When last assistant intent is general_chat, detect follow-up is False."""
    state: dict[str, Any] = {
        "conversation_history": [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "Hello!", "intent": Intent.GENERAL_CHAT.value},
        ],
    }
    assert detect_brainstorm_followup(state) is False  # type: ignore[arg-type]


def test_no_followup_with_empty_history() -> None:
    state: dict[str, Any] = {"conversation_history": []}
    assert detect_brainstorm_followup(state) is False  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# 4. Recipe name extraction
# ---------------------------------------------------------------------------


def test_extract_recipe_by_ordinal() -> None:
    """'the second one' extracts the second bold name from brainstorm."""
    history = _brainstorm_history(
        "1. **Egg Fried Rice** 2. **Spinach Omelette** 3. **Stir-Fried Tofu**"
    )
    result = extract_selected_recipe("the second one", history)
    assert result == "Spinach Omelette"


def test_extract_recipe_by_name() -> None:
    """'make me the stir fry' fuzzy-matches 'Stir-Fried Tofu'."""
    history = _brainstorm_history(
        "1. **Egg Fried Rice** 2. **Stir-Fried Tofu**"
    )
    result = extract_selected_recipe("make me the stir fry", history)
    assert "Stir" in result or "stir" in result.lower()


def test_extract_recipe_surprise_me() -> None:
    """'surprise me' picks the first (highest-scored) option."""
    history = _brainstorm_history("1. **Garlic Noodles** 2. **Bean Soup**")
    result = extract_selected_recipe("surprise me", history)
    assert result == "Garlic Noodles"


def test_extract_recipe_no_bold_fallback() -> None:
    """When no bold names in history, falls back to raw user text."""
    history = [
        {"role": "assistant", "content": "plain text no bold", "intent": Intent.RECIPE_BRAINSTORM.value},
    ]
    result = extract_selected_recipe("pasta please", history)
    assert result == "pasta please"


# ---------------------------------------------------------------------------
# 5. is_recipe_generation_request helper
# ---------------------------------------------------------------------------


def test_is_recipe_generation_request_positive() -> None:
    for phrase in ["what can i make", "dinner idea", "recipes with chicken", "surprise me"]:
        assert is_recipe_generation_request({"input_text": phrase}) is True  # type: ignore[arg-type]


def test_is_recipe_generation_request_negative() -> None:
    for phrase in ["how long to bake chicken?", "what's a substitute for butter?", "hello!"]:
        assert is_recipe_generation_request({"input_text": phrase}) is False  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# 6. Web search graceful failure
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_recipe_graceful_failure() -> None:
    """A network timeout returns None without crashing."""
    import httpx
    from bubbly_chef.tools.web_search import search_recipe

    with patch("bubbly_chef.tools.web_search.httpx.AsyncClient") as mock_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get.side_effect = httpx.TimeoutException("timeout")
        mock_cls.return_value = mock_client

        result = await search_recipe("Egg Fried Rice", cuisine_tag="Chinese")

    assert result is None


@pytest.mark.asyncio
async def test_research_recipe_node_graceful_failure() -> None:
    """research_recipe node: when search fails, state.web_search_result is None."""
    with patch("bubbly_chef.workflows.chat_ingest.search_recipe", return_value=None):
        state: dict[str, Any] = {
            "selected_recipe_name": "Egg Fried Rice",
            "recipe_constraints": {},
            "errors": [],
        }
        result = await research_recipe(state)  # type: ignore[arg-type]

    assert result["web_search_result"] is None


# ---------------------------------------------------------------------------
# 7. Brainstorm node
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_brainstorm_intent_is_recipe_brainstorm() -> None:
    """brainstorm_recipe_ideas sets intent=recipe_brainstorm."""
    brainstorm_text = (
        "Here are some ideas:\n1. **Garlic Fried Rice**\n2. **Egg Drop Soup**\n"
        "Which one sounds good?"
    )
    with patch("bubbly_chef.workflows.chat_ingest.get_ai_manager") as mock_get_mgr:
        mock_mgr = AsyncMock()
        mock_mgr.complete.return_value = brainstorm_text
        mock_get_mgr.return_value = mock_mgr

        state: dict[str, Any] = {
            "input_text": "what can I make?",
            "scored_pantry_items": [_make_pantry_item("garlic")],
            "recipe_constraints": {},
            "conversation_history": [],
            "errors": [],
            "warnings": [],
            "input_mode": "chat",
        }
        result = await brainstorm_recipe_ideas(state)  # type: ignore[arg-type]

    assert result["intent"] == Intent.RECIPE_BRAINSTORM.value


@pytest.mark.asyncio
async def test_brainstorm_returns_recipe_names() -> None:
    """brainstorm_recipe_ideas extracts bold recipe names into brainstorm_ideas."""
    brainstorm_text = "1. **Egg Fried Rice** 2. **Stir-Fried Tofu**\nWhich sounds good?"
    with patch("bubbly_chef.workflows.chat_ingest.get_ai_manager") as mock_get_mgr:
        mock_mgr = AsyncMock()
        mock_mgr.complete.return_value = brainstorm_text
        mock_get_mgr.return_value = mock_mgr

        state: dict[str, Any] = {
            "input_text": "what can I make?",
            "scored_pantry_items": [],
            "recipe_constraints": {},
            "conversation_history": [],
            "errors": [],
            "warnings": [],
            "input_mode": "chat",
        }
        result = await brainstorm_recipe_ideas(state)  # type: ignore[arg-type]

    assert "Egg Fried Rice" in result["brainstorm_ideas"]
    assert "Stir-Fried Tofu" in result["brainstorm_ideas"]


# ---------------------------------------------------------------------------
# 8. Full grounded generation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_grounded_recipe_intent_is_recipe_card() -> None:
    """generate_grounded_recipe sets intent=recipe_card on success."""
    llm_result = LLMRecipeResult(
        title="Egg Fried Rice",
        ingredients=[{"name": "egg", "quantity": 2, "unit": "item"}],
        instructions=["Beat eggs", "Fry with rice"],
        confidence=0.85,
    )
    with patch("bubbly_chef.workflows.chat_ingest.get_ai_manager") as mock_get_mgr, \
         patch("bubbly_chef.workflows.chat_ingest.get_repository") as mock_repo:
        mock_mgr = AsyncMock()
        mock_mgr.complete.return_value = llm_result
        mock_get_mgr.return_value = mock_mgr
        mock_repo_inst = AsyncMock()
        mock_repo_inst.get_all_pantry_items.return_value = []
        mock_repo.return_value = mock_repo_inst

        state: dict[str, Any] = {
            "selected_recipe_name": "Egg Fried Rice",
            "recipe_constraints": {},
            "scored_pantry_items": [
                {**_make_pantry_item("egg"), "_score": 0},
            ],
            "web_search_result": None,
            "errors": [],
            "warnings": [],
            "request_id": str(uuid4()),
            "workflow_id": str(uuid4()),
        }
        result = await generate_grounded_recipe(state)  # type: ignore[arg-type]

    assert result["intent"] == Intent.RECIPE_CARD.value


@pytest.mark.asyncio
async def test_grounded_recipe_has_availability() -> None:
    """Generated recipe card populates ingredient_availability."""
    llm_result = LLMRecipeResult(
        title="Egg Fried Rice",
        ingredients=[
            {"name": "egg", "quantity": 2, "unit": "item"},
            {"name": "truffle oil", "quantity": 1, "unit": "tbsp"},
        ],
        instructions=["Beat eggs", "Fry"],
        confidence=0.85,
    )
    with patch("bubbly_chef.workflows.chat_ingest.get_ai_manager") as mock_get_mgr, \
         patch("bubbly_chef.workflows.chat_ingest.get_repository") as mock_repo:
        mock_mgr = AsyncMock()
        mock_mgr.complete.return_value = llm_result
        mock_get_mgr.return_value = mock_mgr
        mock_repo_inst = AsyncMock()
        mock_repo_inst.get_all_pantry_items.return_value = []
        mock_repo.return_value = mock_repo_inst

        state: dict[str, Any] = {
            "selected_recipe_name": "Egg Fried Rice",
            "recipe_constraints": {},
            "scored_pantry_items": [
                {**_make_pantry_item("egg"), "_score": 0},
            ],
            "web_search_result": None,
            "errors": [],
            "warnings": [],
            "request_id": str(uuid4()),
            "workflow_id": str(uuid4()),
        }
        result = await generate_grounded_recipe(state)  # type: ignore[arg-type]

    avail = result["ingredient_availability"]
    assert any(a["name"] == "egg" and a["status"] == "have" for a in avail)
    assert any(a["name"] == "truffle oil" and a["status"] == "missing" for a in avail)
