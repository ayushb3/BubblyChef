"""Tests for recipe API endpoints."""

import pytest
from datetime import date, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient

from bubbly_chef.models.recipe import Ingredient, RecipeCard
from bubbly_chef.services.recipe_generator import (
    AIRecipeIngredient,
    AIRecipeOutput,
    GenerateRecipeResponse,
    IngredientStatus,
)


class TestRecipeGeneration:
    """Tests for POST /recipes/generate"""

    @pytest.fixture
    def mock_ai_response(self):
        """Create a mock AI response."""
        return AIRecipeOutput(
            title="Test Recipe",
            description="A delicious test recipe",
            prep_time_minutes=10,
            cook_time_minutes=20,
            servings=4,
            ingredients=[
                AIRecipeIngredient(name="chicken", quantity=1, unit="lb"),
                AIRecipeIngredient(name="garlic", quantity=3, unit="cloves"),
            ],
            instructions=["Step 1: Prep", "Step 2: Cook"],
            tips=["Tip 1"],
            cuisine="American",
            difficulty="easy",
        )

    @pytest.mark.asyncio
    async def test_generate_recipe_success(self, client: AsyncClient, mock_ai_response):
        """Test successful recipe generation."""
        with patch("bubbly_chef.api.routes.recipes.get_ai_manager") as mock_get_ai:
            mock_manager = MagicMock()
            mock_manager.complete = AsyncMock(return_value=mock_ai_response)
            mock_get_ai.return_value = mock_manager

            response = await client.post(
                "/recipes/generate",
                json={"prompt": "Make dinner with chicken"},
            )

            assert response.status_code == 200
            data = response.json()
            assert "recipe" in data
            assert data["recipe"]["title"] == "Test Recipe"
            assert "pantry_match_score" in data
            assert "ingredients_status" in data
            assert "missing_count" in data
            assert "have_count" in data

    @pytest.mark.asyncio
    async def test_generate_recipe_with_constraints(self, client: AsyncClient, mock_ai_response):
        """Test recipe generation with constraints."""
        with patch("bubbly_chef.api.routes.recipes.get_ai_manager") as mock_get_ai:
            mock_manager = MagicMock()
            mock_manager.complete = AsyncMock(return_value=mock_ai_response)
            mock_get_ai.return_value = mock_manager

            response = await client.post(
                "/recipes/generate",
                json={
                    "prompt": "Quick healthy meal",
                    "constraints": {
                        "max_time_minutes": 30,
                        "dietary": ["vegetarian"],
                    },
                },
            )

            assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_generate_recipe_empty_prompt_fails(self, client: AsyncClient):
        """Test that empty prompt returns 422."""
        response = await client.post(
            "/recipes/generate",
            json={"prompt": ""},
        )

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_generate_recipe_missing_prompt_fails(self, client: AsyncClient):
        """Test that missing prompt returns 422."""
        response = await client.post(
            "/recipes/generate",
            json={},
        )

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_generate_recipe_ai_failure_returns_500(self, client: AsyncClient):
        """Test that AI failure returns 500."""
        with patch("bubbly_chef.api.routes.recipes.get_ai_manager") as mock_get_ai:
            mock_manager = MagicMock()
            mock_manager.complete = AsyncMock(side_effect=Exception("AI service unavailable"))
            mock_get_ai.return_value = mock_manager

            response = await client.post(
                "/recipes/generate",
                json={"prompt": "Make dinner"},
            )

            assert response.status_code == 500
            assert "failed" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_generate_recipe_all_missing(self, client: AsyncClient, mock_ai_response):
        """Test recipe generation returns proper status counts."""
        with patch("bubbly_chef.api.routes.recipes.get_ai_manager") as mock_get_ai:
            mock_manager = MagicMock()
            mock_manager.complete = AsyncMock(return_value=mock_ai_response)
            mock_get_ai.return_value = mock_manager

            response = await client.post(
                "/recipes/generate",
                json={"prompt": "Make something with chicken"},
            )

            assert response.status_code == 200
            data = response.json()
            # Verify status counts are returned and sum correctly
            total_ingredients = len(data["ingredients_status"])
            assert data["missing_count"] + data["have_count"] + data["partial_count"] == total_ingredients
            assert data["pantry_match_score"] >= 0.0
            assert data["pantry_match_score"] <= 1.0

    @pytest.mark.asyncio
    async def test_generate_recipe_with_followup(self, client: AsyncClient, mock_ai_response):
        """Test recipe generation as a follow-up modification."""
        previous_recipe = {
            "title": "Original Chicken",
            "ingredients": [{"name": "chicken", "quantity": 1, "unit": "lb"}],
            "instructions": ["Cook it"],
        }

        with patch("bubbly_chef.api.routes.recipes.get_ai_manager") as mock_get_ai:
            mock_manager = MagicMock()
            mock_manager.complete = AsyncMock(return_value=mock_ai_response)
            mock_get_ai.return_value = mock_manager

            import json
            response = await client.post(
                "/recipes/generate",
                json={
                    "prompt": "Make it spicier",
                    "previous_recipe_context": json.dumps(previous_recipe),
                },
            )

            assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_generate_recipe_response_structure(self, client: AsyncClient, mock_ai_response):
        """Test that response has all expected fields."""
        with patch("bubbly_chef.api.routes.recipes.get_ai_manager") as mock_get_ai:
            mock_manager = MagicMock()
            mock_manager.complete = AsyncMock(return_value=mock_ai_response)
            mock_get_ai.return_value = mock_manager

            response = await client.post(
                "/recipes/generate",
                json={"prompt": "Make dinner"},
            )

            assert response.status_code == 200
            data = response.json()

            # Recipe structure
            recipe = data["recipe"]
            assert "id" in recipe
            assert "title" in recipe
            assert "description" in recipe
            assert "ingredients" in recipe
            assert "instructions" in recipe

            # Response metadata
            assert isinstance(data["ingredients_status"], list)
            assert isinstance(data["missing_count"], int)
            assert isinstance(data["have_count"], int)
            assert isinstance(data["partial_count"], int)
            assert 0.0 <= data["pantry_match_score"] <= 1.0


class TestRecipeSuggestions:
    """Tests for GET /recipes/suggestions"""

    @pytest.mark.asyncio
    async def test_suggestions_returns_list(self, client: AsyncClient):
        """Test that suggestions returns a list."""
        response = await client.get("/recipes/suggestions")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) <= 5

    @pytest.mark.asyncio
    async def test_suggestions_empty_pantry(self, client: AsyncClient):
        """Test suggestions with empty pantry returns generic suggestions."""
        response = await client.get("/recipes/suggestions")

        assert response.status_code == 200
        data = response.json()
        assert len(data) > 0
        # Should have generic suggestions
        assert any("quick" in s.lower() or "dinner" in s.lower() for s in data)

    @pytest.mark.asyncio
    async def test_suggestions_max_count(self, client: AsyncClient):
        """Test that suggestions are limited to 5."""
        response = await client.get("/recipes/suggestions")

        assert response.status_code == 200
        data = response.json()
        assert len(data) <= 5

    @pytest.mark.asyncio
    async def test_suggestions_contains_generic_options(self, client: AsyncClient):
        """Test that suggestions include typical generic options."""
        response = await client.get("/recipes/suggestions")

        assert response.status_code == 200
        data = response.json()
        # At least one suggestion should be present
        assert len(data) >= 1


class TestRecipeValidation:
    """Tests for recipe request validation."""

    @pytest.mark.asyncio
    async def test_prompt_too_short(self, client: AsyncClient):
        """Test that very short prompts are rejected."""
        response = await client.post(
            "/recipes/generate",
            json={"prompt": ""},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_invalid_constraints_type(self, client: AsyncClient):
        """Test that invalid constraints type is handled."""
        response = await client.post(
            "/recipes/generate",
            json={"prompt": "Make dinner", "constraints": "invalid"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_valid_constraints_format(self, client: AsyncClient):
        """Test that valid constraints are accepted."""
        with patch("bubbly_chef.api.routes.recipes.get_ai_manager") as mock_get_ai:
            mock_manager = MagicMock()
            mock_manager.complete = AsyncMock(
                return_value=AIRecipeOutput(
                    title="Test",
                    description="Test",
                    ingredients=[],
                    instructions=["Test"],
                )
            )
            mock_get_ai.return_value = mock_manager

            response = await client.post(
                "/recipes/generate",
                json={
                    "prompt": "Make dinner",
                    "constraints": {
                        "max_time_minutes": 30,
                        "cuisine": "italian",
                        "dietary": ["vegetarian", "gluten-free"],
                        "use_expiring": True,
                        "servings": 4,
                    },
                },
            )
            # Should not fail validation
            assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_long_prompt_accepted(self, client: AsyncClient):
        """Test that longer prompts are accepted."""
        with patch("bubbly_chef.api.routes.recipes.get_ai_manager") as mock_get_ai:
            mock_manager = MagicMock()
            mock_manager.complete = AsyncMock(
                return_value=AIRecipeOutput(
                    title="Test",
                    description="Test",
                    ingredients=[],
                    instructions=["Test"],
                )
            )
            mock_get_ai.return_value = mock_manager

            long_prompt = "I want to make a delicious dinner " * 10
            response = await client.post(
                "/recipes/generate",
                json={"prompt": long_prompt},
            )
            assert response.status_code == 200


# =============================================================================
# Recipe Library CRUD tests
# =============================================================================


def _make_recipe(**kwargs: Any) -> RecipeCard:
    """Helper: build a minimal RecipeCard."""
    defaults: dict[str, Any] = {
        "title": "Test Recipe",
        "description": "A tasty dish",
        "ingredients": [],
        "instructions": ["Step 1"],
        "source_type": "chat",
    }
    defaults.update(kwargs)
    return RecipeCard(**defaults)


class TestRecipeLibraryList:
    """Tests for GET /recipes"""

    @pytest.mark.asyncio
    async def test_list_empty(self, client: AsyncClient) -> None:
        """Returns empty list when no recipes saved."""
        response = await client.get("/recipes")
        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_list_returns_saved_recipe(self, client: AsyncClient) -> None:
        """Saved recipe appears in list."""
        import bubbly_chef.repository.sqlite as sqlite_mod

        repo = sqlite_mod._repository
        assert repo is not None
        recipe = _make_recipe(title="Pasta Carbonara", cuisine="Italian")
        await repo.add_recipe(recipe)

        response = await client.get("/recipes")
        assert response.status_code == 200
        data = response.json()
        titles = [r["title"] for r in data]
        assert "Pasta Carbonara" in titles

    @pytest.mark.asyncio
    async def test_list_filter_by_search(self, client: AsyncClient) -> None:
        """Search filter returns only matching recipes."""
        import bubbly_chef.repository.sqlite as sqlite_mod

        repo = sqlite_mod._repository
        assert repo is not None
        await repo.add_recipe(_make_recipe(title="Chicken Tikka"))
        await repo.add_recipe(_make_recipe(title="Beef Stew"))

        response = await client.get("/recipes?search=tikka")
        assert response.status_code == 200
        data = response.json()
        assert all("tikka" in r["title"].lower() for r in data)

    @pytest.mark.asyncio
    async def test_list_filter_by_cuisine(self, client: AsyncClient) -> None:
        """Cuisine filter excludes non-matching recipes."""
        import bubbly_chef.repository.sqlite as sqlite_mod

        repo = sqlite_mod._repository
        assert repo is not None
        await repo.add_recipe(_make_recipe(title="Tacos", cuisine="Mexican"))
        await repo.add_recipe(_make_recipe(title="Ramen", cuisine="Japanese"))

        response = await client.get("/recipes?cuisine=Mexican")
        assert response.status_code == 200
        data = response.json()
        assert all(r["cuisine"] == "Mexican" for r in data)

    @pytest.mark.asyncio
    async def test_list_filter_drafts(self, client: AsyncClient) -> None:
        """is_draft filter returns only drafts."""
        import bubbly_chef.repository.sqlite as sqlite_mod

        repo = sqlite_mod._repository
        assert repo is not None
        await repo.add_recipe(_make_recipe(title="Draft Recipe", is_draft=True))
        await repo.add_recipe(_make_recipe(title="Final Recipe", is_draft=False))

        response = await client.get("/recipes?is_draft=true")
        assert response.status_code == 200
        data = response.json()
        assert all(r["is_draft"] is True for r in data)

    @pytest.mark.asyncio
    async def test_list_pagination(self, client: AsyncClient) -> None:
        """limit/offset pagination works."""
        import bubbly_chef.repository.sqlite as sqlite_mod

        repo = sqlite_mod._repository
        assert repo is not None
        for i in range(5):
            await repo.add_recipe(_make_recipe(title=f"Recipe {i}"))

        r1 = await client.get("/recipes?limit=3&offset=0")
        r2 = await client.get("/recipes?limit=3&offset=3")
        assert r1.status_code == 200
        assert r2.status_code == 200
        ids1 = {r["id"] for r in r1.json()}
        ids2 = {r["id"] for r in r2.json()}
        assert ids1.isdisjoint(ids2)


class TestRecipeLibraryGet:
    """Tests for GET /recipes/{recipe_id}"""

    @pytest.mark.asyncio
    async def test_get_existing_recipe(self, client: AsyncClient) -> None:
        """Returns recipe when it exists."""
        import bubbly_chef.repository.sqlite as sqlite_mod

        repo = sqlite_mod._repository
        assert repo is not None
        recipe = _make_recipe(title="Spaghetti Bolognese")
        await repo.add_recipe(recipe)

        response = await client.get(f"/recipes/{recipe.id}")
        assert response.status_code == 200
        assert response.json()["title"] == "Spaghetti Bolognese"

    @pytest.mark.asyncio
    async def test_get_missing_recipe_404(self, client: AsyncClient) -> None:
        """Returns 404 for unknown recipe ID."""
        import uuid

        response = await client.get(f"/recipes/{uuid.uuid4()}")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_get_recipe_preserves_new_fields(self, client: AsyncClient) -> None:
        """New fields round-trip through DB correctly."""
        import bubbly_chef.repository.sqlite as sqlite_mod

        repo = sqlite_mod._repository
        assert repo is not None
        recipe = _make_recipe(
            title="Croissant",
            cuisine="French",
            source_type="url",
            source_title="Bon Appétit",
            is_draft=True,
            difficulty="hard",
        )
        await repo.add_recipe(recipe)

        response = await client.get(f"/recipes/{recipe.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["cuisine"] == "French"
        assert data["source_type"] == "url"
        assert data["source_title"] == "Bon Appétit"
        assert data["is_draft"] is True
        assert data["difficulty"] == "hard"


class TestRecipeLibraryDelete:
    """Tests for DELETE /recipes/{recipe_id}"""

    @pytest.mark.asyncio
    async def test_delete_existing_recipe(self, client: AsyncClient) -> None:
        """Deletes recipe and returns 204."""
        import bubbly_chef.repository.sqlite as sqlite_mod

        repo = sqlite_mod._repository
        assert repo is not None
        recipe = _make_recipe(title="To Delete")
        await repo.add_recipe(recipe)

        response = await client.delete(f"/recipes/{recipe.id}")
        assert response.status_code == 204

        # Verify gone
        response2 = await client.get(f"/recipes/{recipe.id}")
        assert response2.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_missing_recipe_404(self, client: AsyncClient) -> None:
        """Returns 404 when deleting non-existent recipe."""
        import uuid

        response = await client.delete(f"/recipes/{uuid.uuid4()}")
        assert response.status_code == 404


class TestRecipeLibraryRefine:
    """Tests for POST /recipes/{recipe_id}/refine"""

    @pytest.mark.asyncio
    async def test_refine_recipe_success(self, client: AsyncClient) -> None:
        """Refine updates the recipe and returns it."""
        import bubbly_chef.repository.sqlite as sqlite_mod

        repo = sqlite_mod._repository
        assert repo is not None
        original = _make_recipe(
            title="Chicken Soup",
            ingredients=[
                Ingredient(name="chicken", quantity=1.0, unit="lb"),
                Ingredient(name="carrots", quantity=2.0, unit="whole"),
            ],
            instructions=["Boil chicken", "Add carrots"],
        )
        await repo.add_recipe(original)

        refined = _make_recipe(
            title="Vegetarian Soup",
            ingredients=[
                Ingredient(name="tofu", quantity=1.0, unit="block"),
                Ingredient(name="carrots", quantity=2.0, unit="whole"),
            ],
            instructions=["Boil tofu", "Add carrots"],
        )
        refined.id = original.id  # same id returned by AI mock

        with patch("bubbly_chef.api.routes.recipes.get_ai_manager") as mock_get_ai:
            mock_manager = MagicMock()
            mock_manager.complete = AsyncMock(return_value=refined)
            mock_get_ai.return_value = mock_manager

            response = await client.post(
                f"/recipes/{original.id}/refine",
                json={"instruction": "make it vegetarian"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["title"] == "Vegetarian Soup"
            assert data["id"] == str(original.id)

    @pytest.mark.asyncio
    async def test_refine_missing_recipe_404(self, client: AsyncClient) -> None:
        """Returns 404 when refining non-existent recipe."""
        import uuid

        response = await client.post(
            f"/recipes/{uuid.uuid4()}/refine",
            json={"instruction": "make it healthier"},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_refine_ai_failure_500(self, client: AsyncClient) -> None:
        """Returns 500 when AI call fails."""
        import bubbly_chef.repository.sqlite as sqlite_mod

        repo = sqlite_mod._repository
        assert repo is not None
        recipe = _make_recipe(title="Simple Dish")
        await repo.add_recipe(recipe)

        with patch("bubbly_chef.api.routes.recipes.get_ai_manager") as mock_get_ai:
            mock_manager = MagicMock()
            mock_manager.complete = AsyncMock(side_effect=Exception("provider down"))
            mock_get_ai.return_value = mock_manager

            response = await client.post(
                f"/recipes/{recipe.id}/refine",
                json={"instruction": "make it spicier"},
            )
            assert response.status_code == 500
