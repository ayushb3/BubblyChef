"""Tests for /v1/recipes/generate and /v1/recipes/refine routes.

Regression coverage for a bug where both routes imported ``get_ai_manager``
from ``bubbly_chef.ai.manager`` (which does not define it — it actually lives
in ``bubbly_chef.api.deps``) and then ``await``ed it, even though it is a
synchronous function. Both defects made every call to these endpoints raise
and return HTTP 500.

Mocks:
- get_current_user_id dependency -> fixed test user_id
- bubbly_chef.api.deps.get_ai_manager -> a stub AIManager (patched at its
  real source module, matching how the route imports it locally)
- bubbly_chef.services.recipe_generator.generate_recipe -> a stub response
- bubbly_chef.api.routes.recipes_ai.get_repository -> in-memory stub repo
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.models.recipe import RecipeCard
from bubbly_chef.services.recipe_generator import GenerateRecipeResponse, IngredientStatus

TEST_USER_ID = "test-user-123"

_GET_AI_MANAGER_PATCH = "bubbly_chef.api.deps.get_ai_manager"
_GEN_RECIPE_PATCH = "bubbly_chef.services.recipe_generator.generate_recipe"
_GET_REPOSITORY_PATCH = "bubbly_chef.api.routes.recipes_ai.get_repository"


def _make_stub_response() -> GenerateRecipeResponse:
    """Build a minimal, valid GenerateRecipeResponse for mocking gen_recipe."""
    return GenerateRecipeResponse(
        recipe=RecipeCard(
            title="Test Pasta",
            description="A quick test pasta dish",
            ingredients=[],
            instructions=["Boil water", "Cook pasta"],
        ),
        ingredients_status=[
            IngredientStatus(ingredient_name="pasta", status="have"),
        ],
        missing_count=0,
        have_count=1,
        partial_count=0,
        pantry_match_score=1.0,
    )


@pytest.fixture
def app():
    """Create a fresh FastAPI app with auth dependency overridden."""
    _app = create_app()

    async def _fake_user_id() -> str:
        return TEST_USER_ID

    _app.dependency_overrides[get_current_user_id] = _fake_user_id
    return _app


@pytest_asyncio.fixture
async def client(app):
    """Async HTTP client wired to the test app."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _make_mock_repo() -> MagicMock:
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    return repo


@pytest.mark.asyncio
async def test_generate_recipe_returns_200(client: AsyncClient) -> None:
    """POST /v1/recipes/generate succeeds when the AI manager + pantry are mocked.

    This is the regression case: prior to the fix, get_ai_manager was imported
    from the wrong module (ImportError) and then awaited (TypeError), so this
    endpoint always returned 500.
    """
    mock_ai_manager = MagicMock()
    mock_repo = _make_mock_repo()

    with (
        patch(_GET_AI_MANAGER_PATCH, return_value=mock_ai_manager),
        patch(_GEN_RECIPE_PATCH, new_callable=AsyncMock, return_value=_make_stub_response()),
        patch(_GET_REPOSITORY_PATCH, new_callable=AsyncMock, return_value=mock_repo),
    ):
        response = await client.post(
            "/v1/recipes/generate",
            json={"prompt": "quick pasta dinner", "use_pantry": True},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["recipe"]["title"] == "Test Pasta"
    assert data["have_count"] == 1


@pytest.mark.asyncio
async def test_generate_recipe_requires_auth(app) -> None:
    """POST /v1/recipes/generate without auth returns 401, not 500."""
    app.dependency_overrides.clear()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post(
            "/v1/recipes/generate",
            json={"prompt": "quick pasta dinner"},
        )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_refine_recipe_returns_200(client: AsyncClient) -> None:
    """POST /v1/recipes/refine succeeds when the AI manager + pantry are mocked."""
    mock_ai_manager = MagicMock()
    mock_repo = _make_mock_repo()

    existing_recipe: dict[str, Any] = {
        "title": "Original Pasta",
        "description": "Before refinement",
        "ingredients": [],
        "instructions": ["Boil water"],
    }

    with (
        patch(_GET_AI_MANAGER_PATCH, return_value=mock_ai_manager),
        patch(_GEN_RECIPE_PATCH, new_callable=AsyncMock, return_value=_make_stub_response()),
        patch(_GET_REPOSITORY_PATCH, new_callable=AsyncMock, return_value=mock_repo),
    ):
        response = await client.post(
            "/v1/recipes/refine",
            json={"recipe": existing_recipe, "prompt": "make it vegetarian"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["recipe"]["title"] == "Test Pasta"


@pytest.mark.asyncio
async def test_refine_recipe_requires_auth(app) -> None:
    """POST /v1/recipes/refine without auth returns 401, not 500."""
    app.dependency_overrides.clear()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post(
            "/v1/recipes/refine",
            json={"recipe": {"title": "x", "instructions": []}, "prompt": "spicier"},
        )

    assert response.status_code == 401
