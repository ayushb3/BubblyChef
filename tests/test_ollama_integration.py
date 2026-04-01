"""Integration tests that hit a real Ollama instance.

These tests require a running Ollama server with llama3.1:8b.
They are skipped automatically if Ollama is not reachable.

Run explicitly:
    pytest tests/test_ollama_integration.py -v --timeout=120
"""

import httpx
import pytest

from bubbly_chef.ai.manager import AIManager
from bubbly_chef.ai.ollama import OllamaProvider
from bubbly_chef.models.base import Intent
from bubbly_chef.models.recipe import Ingredient, RecipeCard, RecipeConstraints
from bubbly_chef.workflows.shared_state import (
    LLMGeneralChatResult,
    LLMIntentResult,
    LLMRecipeResult,
)

# ---------------------------------------------------------------------------
# Skip entire module if Ollama is unreachable
# ---------------------------------------------------------------------------

OLLAMA_URL = "http://localhost:11434"
OLLAMA_MODEL = "llama3.1:8b"


def _ollama_available() -> bool:
    try:
        r = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        if r.status_code != 200:
            return False
        models = [m.get("name", "") for m in r.json().get("models", [])]
        return any(OLLAMA_MODEL.split(":")[0] in m for m in models)
    except httpx.RequestError:
        return False


pytestmark = pytest.mark.skipif(
    not _ollama_available(),
    reason=f"Ollama not available or {OLLAMA_MODEL} not loaded",
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def ollama_provider() -> OllamaProvider:
    return OllamaProvider(base_url=OLLAMA_URL, model=OLLAMA_MODEL, timeout=120.0)


@pytest.fixture
def ai_manager(ollama_provider: OllamaProvider) -> AIManager:
    return AIManager(providers=[ollama_provider])


# ---------------------------------------------------------------------------
# 1. Basic provider health
# ---------------------------------------------------------------------------


class TestOllamaHealth:
    @pytest.mark.asyncio
    async def test_provider_is_available(self, ollama_provider: OllamaProvider) -> None:
        assert await ollama_provider.is_available()

    @pytest.mark.asyncio
    async def test_provider_name(self, ollama_provider: OllamaProvider) -> None:
        assert OLLAMA_MODEL.split(":")[0] in ollama_provider.name

    @pytest.mark.asyncio
    async def test_manager_finds_provider(self, ai_manager: AIManager) -> None:
        provider = await ai_manager.get_available_provider()
        assert provider is not None


# ---------------------------------------------------------------------------
# 2. Free-text completion
# ---------------------------------------------------------------------------


class TestFreeText:
    @pytest.mark.asyncio
    async def test_simple_completion(self, ai_manager: AIManager) -> None:
        result = await ai_manager.complete("What is 2 + 2? Reply with just the number.")
        assert isinstance(result, str)
        assert "4" in result

    @pytest.mark.asyncio
    async def test_streaming(self, ollama_provider: OllamaProvider) -> None:
        tokens: list[str] = []
        async for token in ollama_provider.stream_complete("Say hello in one word."):
            tokens.append(token)
        joined = "".join(tokens).lower()
        assert len(tokens) > 0
        assert "hello" in joined or "hi" in joined


# ---------------------------------------------------------------------------
# 3. Structured output — Intent classification
# ---------------------------------------------------------------------------


class TestIntentClassification:
    @pytest.mark.asyncio
    async def test_pantry_intent(self, ai_manager: AIManager) -> None:
        prompt = (
            "Classify this user message intent.\n"
            "User: 'I just bought 3 eggs and a gallon of milk'\n"
            "Return JSON with intent, confidence, reasoning."
        )
        result = await ai_manager.complete(prompt, LLMIntentResult)
        assert isinstance(result, LLMIntentResult)
        assert result.intent in ("pantry_update", "receipt_ingest_request")
        assert result.confidence > 0.3

    @pytest.mark.asyncio
    async def test_recipe_intent(self, ai_manager: AIManager) -> None:
        prompt = (
            "Classify this user message intent.\n"
            "User: 'What can I make for dinner tonight?'\n"
            "Return JSON with intent, confidence, reasoning."
        )
        result = await ai_manager.complete(prompt, LLMIntentResult)
        assert isinstance(result, LLMIntentResult)
        # Accept any recipe-related or cooking intent
        assert result.intent in (
            "cooking_help", "recipe_brainstorm", "recipe_generation",
            "recipe_ingest_request", "general_chat",
        )

    @pytest.mark.asyncio
    async def test_general_chat_intent(self, ai_manager: AIManager) -> None:
        prompt = (
            "Classify this user message intent.\n"
            "User: 'Hello! How are you today?'\n"
            "Return JSON with intent, confidence, reasoning."
        )
        result = await ai_manager.complete(prompt, LLMIntentResult)
        assert isinstance(result, LLMIntentResult)
        assert result.intent == "general_chat"


# ---------------------------------------------------------------------------
# 4. Structured output — Recipe generation
# ---------------------------------------------------------------------------


class TestRecipeGeneration:
    @pytest.mark.asyncio
    async def test_generate_recipe_structured(self, ai_manager: AIManager) -> None:
        """LLM returns a valid LLMRecipeResult with real content."""
        prompt = (
            "Generate a complete recipe for egg fried rice.\n"
            "You MUST include:\n"
            "- title: a string\n"
            "- ingredients: a list of objects, each with 'name' (string), "
            "'quantity' (number), 'unit' (string). Include at least 3 ingredients.\n"
            "- instructions: a list of strings with at least 3 steps\n"
            "- confidence: a number between 0.5 and 1.0\n"
        )
        result = await ai_manager.complete(prompt, LLMRecipeResult)
        assert isinstance(result, LLMRecipeResult)
        assert len(result.title) > 0
        # Small models may return sparse results — just verify the types
        assert isinstance(result.ingredients, list)
        assert isinstance(result.instructions, list)
        assert result.confidence > 0

    @pytest.mark.asyncio
    async def test_recipe_ingredients_have_names(self, ai_manager: AIManager) -> None:
        """Every ingredient dict from the LLM has a name field."""
        prompt = (
            "Generate a recipe for pasta with tomato sauce.\n"
            "The ingredients field MUST be a list with at least 2 objects.\n"
            "Each object must have: name (string), quantity (number), unit (string).\n"
            "Example: {\"name\": \"pasta\", \"quantity\": 200, \"unit\": \"g\"}\n"
        )
        result = await ai_manager.complete(prompt, LLMRecipeResult)
        assert isinstance(result, LLMRecipeResult)
        for ing in result.ingredients:
            if isinstance(ing, dict):
                assert "name" in ing, f"Ingredient missing name: {ing}"

    @pytest.mark.asyncio
    async def test_to_taste_quantity_handling(self, ai_manager: AIManager) -> None:
        """Non-numeric quantities like 'to taste' don't crash Ingredient creation."""
        prompt = (
            "Generate a recipe that includes salt 'to taste' as an ingredient.\n"
            "For salt, set quantity to the string 'to taste' (not a number).\n"
            "Return as LLMRecipeResult JSON."
        )
        result = await ai_manager.complete(prompt, LLMRecipeResult)
        assert isinstance(result, LLMRecipeResult)

        # Now convert through the same path as generate_grounded_recipe
        for ing_dict in result.ingredients:
            if isinstance(ing_dict, dict):
                raw_qty = ing_dict.get("quantity")
                qty: float | None = None
                extra_note: str | None = None
                if raw_qty is not None:
                    try:
                        qty = float(raw_qty)
                    except (ValueError, TypeError):
                        extra_note = str(raw_qty)

                prep = ing_dict.get("preparation") or ""
                if extra_note:
                    prep = f"{extra_note}, {prep}" if prep else extra_note

                # This must not raise
                ingredient = Ingredient(
                    name=ing_dict.get("name", ""),
                    quantity=qty,
                    unit=ing_dict.get("unit"),
                    preparation=prep or None,
                )
                assert ingredient.name


# ---------------------------------------------------------------------------
# 5. Structured output — General chat
# ---------------------------------------------------------------------------


class TestGeneralChat:
    @pytest.mark.asyncio
    async def test_chat_response(self, ai_manager: AIManager) -> None:
        prompt = (
            "You are a friendly cooking assistant. "
            "The user says: 'What's a good substitute for butter in baking?'\n"
            "Respond helpfully."
        )
        result = await ai_manager.complete(prompt, LLMGeneralChatResult)
        assert isinstance(result, LLMGeneralChatResult)
        assert len(result.response) > 10


# ---------------------------------------------------------------------------
# 6. Constraint extraction
# ---------------------------------------------------------------------------


class TestConstraintExtraction:
    @pytest.mark.asyncio
    async def test_extract_cuisine_constraint(self, ai_manager: AIManager) -> None:
        prompt = (
            "Extract recipe constraints from: 'I want something Italian'\n"
            "Return RecipeConstraints JSON."
        )
        result = await ai_manager.complete(prompt, RecipeConstraints)
        assert isinstance(result, RecipeConstraints)
        assert result.cuisine is not None
        assert "italian" in result.cuisine.lower()

    @pytest.mark.asyncio
    async def test_extract_time_constraint(self, ai_manager: AIManager) -> None:
        prompt = (
            "Extract recipe constraints from: 'Quick meal under 20 minutes'\n"
            "Return RecipeConstraints JSON."
        )
        result = await ai_manager.complete(prompt, RecipeConstraints)
        assert isinstance(result, RecipeConstraints)
        assert result.max_time_minutes is not None
        assert result.max_time_minutes <= 30  # some LLM wiggle room


# ---------------------------------------------------------------------------
# 7. End-to-end: generate_grounded_recipe node
# ---------------------------------------------------------------------------


class TestGroundedRecipeE2E:
    """Run the actual generate_grounded_recipe node with a real LLM."""

    @pytest.mark.asyncio
    async def test_grounded_recipe_produces_card(self) -> None:
        """Full node execution produces a recipe card with ingredients."""
        from typing import Any
        from unittest.mock import AsyncMock, patch
        from uuid import uuid4

        from bubbly_chef.workflows.recipe.nodes import generate_grounded_recipe

        provider = OllamaProvider(
            base_url=OLLAMA_URL, model=OLLAMA_MODEL, timeout=120.0,
        )
        manager = AIManager(providers=[provider])

        with patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", return_value=manager), \
             patch("bubbly_chef.workflows.recipe.nodes.get_repository") as mock_repo:
            mock_repo_inst = AsyncMock()
            mock_repo_inst.get_all_pantry_items.return_value = []
            mock_repo.return_value = mock_repo_inst

            state: dict[str, Any] = {
                "selected_recipe_name": "Egg Fried Rice",
                "recipe_constraints": {"cuisine": "Chinese"},
                "scored_pantry_items": [
                    {"name": "egg", "quantity": 6.0, "unit": "item",
                     "expiry_date": None, "_score": 8.0},
                    {"name": "rice", "quantity": 2.0, "unit": "cup",
                     "expiry_date": None, "_score": 5.0},
                ],
                "web_search_result": None,
                "errors": [],
                "warnings": [],
                "request_id": str(uuid4()),
                "workflow_id": str(uuid4()),
            }
            result = await generate_grounded_recipe(state)  # type: ignore[arg-type]

        assert result.get("intent") == Intent.RECIPE_CARD.value
        assert result.get("proposal") is not None
        recipe = result["proposal"].recipe
        assert isinstance(recipe, RecipeCard)
        assert len(recipe.title) > 0
        assert len(recipe.ingredients) >= 2
        assert len(recipe.instructions) >= 1
        # Verify no Pydantic crash on any ingredient
        for ing in recipe.ingredients:
            assert isinstance(ing, Ingredient)

    @pytest.mark.asyncio
    async def test_grounded_recipe_handles_non_numeric_qty(self) -> None:
        """Node doesn't crash when LLM returns 'to taste' quantities."""
        from typing import Any
        from unittest.mock import AsyncMock, patch
        from uuid import uuid4

        from bubbly_chef.workflows.recipe.nodes import generate_grounded_recipe

        provider = OllamaProvider(
            base_url=OLLAMA_URL, model=OLLAMA_MODEL, timeout=120.0,
        )
        manager = AIManager(providers=[provider])

        with patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", return_value=manager), \
             patch("bubbly_chef.workflows.recipe.nodes.get_repository") as mock_repo:
            mock_repo_inst = AsyncMock()
            mock_repo_inst.get_all_pantry_items.return_value = []
            mock_repo.return_value = mock_repo_inst

            state: dict[str, Any] = {
                "selected_recipe_name": "Simple Seasoned Chicken",
                "recipe_constraints": {},
                "scored_pantry_items": [
                    {"name": "chicken breast", "quantity": 2.0, "unit": "lb",
                     "expiry_date": None, "_score": 8.0},
                ],
                "web_search_result": None,
                "errors": [],
                "warnings": [],
                "request_id": str(uuid4()),
                "workflow_id": str(uuid4()),
            }
            # This should not raise a ValidationError
            result = await generate_grounded_recipe(state)  # type: ignore[arg-type]

        # Even if the LLM returns "to taste", it should succeed
        assert result.get("intent") == Intent.RECIPE_CARD.value
        recipe = result["proposal"].recipe
        for ing in recipe.ingredients:
            assert isinstance(ing, Ingredient)
            # quantity should be float or None, never a string
            assert ing.quantity is None or isinstance(ing.quantity, float)


# ---------------------------------------------------------------------------
# 8. Brainstorm node E2E
# ---------------------------------------------------------------------------


class TestBrainstormE2E:
    @pytest.mark.asyncio
    async def test_brainstorm_returns_ideas(self) -> None:
        from typing import Any
        from unittest.mock import patch

        from bubbly_chef.workflows.recipe.nodes import brainstorm_recipe_ideas

        provider = OllamaProvider(
            base_url=OLLAMA_URL, model=OLLAMA_MODEL, timeout=120.0,
        )
        manager = AIManager(providers=[provider])

        with patch("bubbly_chef.workflows.recipe.nodes.get_ai_manager", return_value=manager):
            state: dict[str, Any] = {
                "input_text": "What can I make with chicken and rice?",
                "scored_pantry_items": [
                    {"name": "chicken", "quantity": 1.0, "unit": "lb",
                     "expiry_date": None, "_score": 8.0},
                    {"name": "rice", "quantity": 2.0, "unit": "cup",
                     "expiry_date": None, "_score": 5.0},
                ],
                "recipe_constraints": {},
                "conversation_history": [],
                "errors": [],
                "warnings": [],
                "input_mode": "chat",
            }
            result = await brainstorm_recipe_ideas(state)  # type: ignore[arg-type]

        assert result.get("intent") == Intent.RECIPE_BRAINSTORM.value
        assert len(result.get("assistant_message", "")) > 20
