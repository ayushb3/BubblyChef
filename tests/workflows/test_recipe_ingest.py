"""Tests for recipe ingest workflow nodes."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
import pytest

from bubbly_chef.models.recipe import Ingredient, RecipeCard
from bubbly_chef.workflows.recipe_ingest import (
    fetch_url,
    parse_recipe_llm,
    run_recipe_ingest,
    validate_recipe,
)
from bubbly_chef.workflows.state import LLMRecipeResult


# ---------------------------------------------------------------------------
# fetch_url node
# ---------------------------------------------------------------------------

class TestFetchUrl:
    @pytest.mark.asyncio
    async def test_no_url(self):
        state = {"url": None, "warnings": []}
        result = await fetch_url(state)
        assert result["fetched_content"] is None

    @pytest.mark.asyncio
    async def test_successful_fetch(self):
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.text = "<html><body><h1>Pasta Carbonara</h1><p>Boil pasta</p></body></html>"
        mock_response.raise_for_status = lambda: None

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("bubbly_chef.workflows.recipe_ingest.httpx.AsyncClient", return_value=mock_client):
            state = {"url": "https://example.com/recipe", "warnings": []}
            result = await fetch_url(state)

        assert result["fetched_content"] is not None
        assert "Pasta Carbonara" in result["fetched_content"]

    @pytest.mark.asyncio
    async def test_fetch_failure(self):
        mock_client = AsyncMock()
        mock_client.get.side_effect = httpx.ConnectError("Connection refused")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("bubbly_chef.workflows.recipe_ingest.httpx.AsyncClient", return_value=mock_client):
            state = {"url": "https://example.com/404", "warnings": []}
            result = await fetch_url(state)

        assert result["fetched_content"] is None
        assert len(result["warnings"]) > 0


# ---------------------------------------------------------------------------
# parse_recipe_llm node
# ---------------------------------------------------------------------------

class TestParseRecipeLLM:
    @pytest.mark.asyncio
    async def test_empty_text(self):
        state = {"fetched_content": None, "input_text": "", "errors": []}
        result = await parse_recipe_llm(state)
        assert result["confidence"] == 0.0
        assert "No recipe content" in result["errors"][0]

    @pytest.mark.asyncio
    async def test_successful_parse(self):
        llm_result = LLMRecipeResult(
            title="Pasta Carbonara",
            description="Classic Italian pasta",
            prep_time_minutes=10,
            cook_time_minutes=20,
            servings=4,
            ingredients=[
                {"name": "pasta", "quantity": 1, "unit": "lb"},
                {"name": "eggs", "quantity": 3},
            ],
            instructions=["Boil pasta", "Mix eggs and cheese", "Combine"],
            cuisine="Italian",
            difficulty="easy",
            confidence=0.9,
        )
        mock_llm = AsyncMock()
        mock_llm.generate_structured.return_value = (llm_result, None)

        with patch("bubbly_chef.workflows.recipe_ingest.get_ollama_client", return_value=mock_llm):
            state = {
                "fetched_content": "Pasta Carbonara Recipe...",
                "input_text": "",
                "caption": "Italian classic",
                "url": "https://example.com",
                "errors": [],
            }
            result = await parse_recipe_llm(state)

        assert result["recipe"].title == "Pasta Carbonara"
        assert len(result["recipe"].ingredients) == 2
        assert result["confidence"] == 0.9

    @pytest.mark.asyncio
    async def test_llm_error(self):
        mock_llm = AsyncMock()
        mock_llm.generate_structured.return_value = (None, "Parse failed")

        with patch("bubbly_chef.workflows.recipe_ingest.get_ollama_client", return_value=mock_llm):
            state = {"fetched_content": "some text", "input_text": "", "errors": [], "caption": None, "url": None}
            result = await parse_recipe_llm(state)

        assert result["confidence"] == 0.0
        assert "Could not parse recipe" in result["errors"][0]

    @pytest.mark.asyncio
    async def test_llm_exception(self):
        from bubbly_chef.tools.llm_client import LLMError

        mock_llm = AsyncMock()
        mock_llm.generate_structured.side_effect = LLMError("timeout")

        with patch("bubbly_chef.workflows.recipe_ingest.get_ollama_client", return_value=mock_llm):
            state = {"fetched_content": "text", "input_text": "", "errors": [], "caption": None, "url": None}
            result = await parse_recipe_llm(state)

        assert result["confidence"] == 0.0

    @pytest.mark.asyncio
    async def test_total_time_calculated(self):
        llm_result = LLMRecipeResult(
            title="Quick Salad",
            prep_time_minutes=5,
            cook_time_minutes=0,
            ingredients=[{"name": "lettuce", "quantity": 1}],
            instructions=["Chop", "Toss"],
            confidence=0.85,
        )
        mock_llm = AsyncMock()
        mock_llm.generate_structured.return_value = (llm_result, None)

        with patch("bubbly_chef.workflows.recipe_ingest.get_ollama_client", return_value=mock_llm):
            state = {
                "fetched_content": "Quick salad recipe",
                "input_text": "",
                "caption": None,
                "url": None,
                "errors": [],
            }
            result = await parse_recipe_llm(state)

        assert result["recipe"].total_time_minutes == 5


# ---------------------------------------------------------------------------
# validate_recipe node
# ---------------------------------------------------------------------------

class TestValidateRecipe:
    def test_no_recipe(self):
        state = {"recipe": None, "warnings": [], "errors": [], "confidence": 0.0}
        result = validate_recipe(state)
        assert result["requires_review"] is True

    def test_valid_recipe(self):
        recipe = RecipeCard(
            id=uuid4(),
            title="Pasta Carbonara",
            ingredients=[
                Ingredient(name="pasta", quantity=1, unit="lb"),
                Ingredient(name="eggs", quantity=3),
                Ingredient(name="cheese", quantity=0.5, unit="cup"),
            ],
            instructions=["Boil pasta", "Mix eggs", "Combine"],
        )
        state = {"recipe": recipe, "warnings": [], "errors": [], "confidence": 0.85}
        result = validate_recipe(state)
        assert result["confidence"] == 0.85

    def test_short_title_penalty(self):
        recipe = RecipeCard(
            id=uuid4(),
            title="AB",
            ingredients=[Ingredient(name="a"), Ingredient(name="b")],
            instructions=["do", "this"],
        )
        state = {"recipe": recipe, "warnings": [], "errors": [], "confidence": 0.8}
        result = validate_recipe(state)
        assert result["confidence"] < 0.8
        assert any("title" in e for e in result["errors"])

    def test_no_ingredients_penalty(self):
        recipe = RecipeCard(
            id=uuid4(),
            title="Empty Recipe",
            ingredients=[],
            instructions=["do something"],
        )
        state = {"recipe": recipe, "warnings": [], "errors": [], "confidence": 0.8}
        result = validate_recipe(state)
        assert any("ingredients" in e.lower() for e in result["errors"])

    def test_no_instructions_penalty(self):
        recipe = RecipeCard(
            id=uuid4(),
            title="No Steps Recipe",
            ingredients=[Ingredient(name="flour"), Ingredient(name="water")],
            instructions=[],
        )
        state = {"recipe": recipe, "warnings": [], "errors": [], "confidence": 0.8}
        result = validate_recipe(state)
        assert any("instructions" in e.lower() for e in result["errors"])

    def test_few_ingredients_warning(self):
        recipe = RecipeCard(
            id=uuid4(),
            title="Simple Recipe",
            ingredients=[Ingredient(name="flour")],
            instructions=["Mix", "Bake"],
        )
        state = {"recipe": recipe, "warnings": [], "errors": [], "confidence": 0.8}
        result = validate_recipe(state)
        assert any("few ingredients" in w for w in result["warnings"])

    def test_long_time_warning(self):
        recipe = RecipeCard(
            id=uuid4(),
            title="Slow Cook Recipe",
            total_time_minutes=600,
            ingredients=[Ingredient(name="beef"), Ingredient(name="onion")],
            instructions=["Cook", "Wait"],
        )
        state = {"recipe": recipe, "warnings": [], "errors": [], "confidence": 0.8}
        result = validate_recipe(state)
        assert any("long" in w for w in result["warnings"])


# ---------------------------------------------------------------------------
# Full workflow
# ---------------------------------------------------------------------------

class TestRunRecipeIngest:
    @pytest.mark.asyncio
    async def test_with_text_input(self):
        llm_result = LLMRecipeResult(
            title="Scrambled Eggs",
            ingredients=[{"name": "eggs", "quantity": 3}, {"name": "butter", "quantity": 1, "unit": "tbsp"}],
            instructions=["Crack eggs", "Scramble in butter"],
            confidence=0.9,
        )
        mock_llm = AsyncMock()
        mock_llm.generate_structured.return_value = (llm_result, None)

        with patch("bubbly_chef.workflows.recipe_ingest.get_ollama_client", return_value=mock_llm):
            envelope = await run_recipe_ingest(text="Scrambled eggs: crack 3 eggs, cook in butter")

        assert envelope.proposal.recipe.title == "Scrambled Eggs"
        assert envelope.confidence.overall > 0

    @pytest.mark.asyncio
    async def test_error_creates_empty_recipe(self):
        mock_llm = AsyncMock()
        mock_llm.generate_structured.return_value = (None, "failed")

        with patch("bubbly_chef.workflows.recipe_ingest.get_ollama_client", return_value=mock_llm):
            envelope = await run_recipe_ingest(text="some recipe")

        # Should still return an envelope, but with Unknown Recipe
        assert envelope.proposal.recipe.title == "Unknown Recipe"
        assert len(envelope.errors) > 0
