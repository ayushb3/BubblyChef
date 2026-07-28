"""Tests for /v1/recipes/generate and /v1/recipes/refine.

Regression coverage for the wiring of these two routes. Both previously did::

    from bubbly_chef.ai.manager import get_ai_manager   # wrong module
    ai_manager = await get_ai_manager()                 # not a coroutine

`get_ai_manager` lives in `bubbly_chef.api.deps` and is synchronous, so every
request raised ImportError inside the route's blanket ``except Exception`` and
came back as an opaque HTTP 500. Asserting a 200 here catches both mistakes —
a wrong import module and a spurious await — because either one trips the same
except branch.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app

TEST_USER_ID = "test-user-123"

_ROUTE_MODULE = "bubbly_chef.api.routes.recipes_ai"


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


def _fake_generation_result() -> MagicMock:
    """Mimic the RecipeGenerationResult shape the routes unpack."""
    recipe = MagicMock()
    recipe.model_dump.return_value = {"title": "Tomato Pasta", "ingredients": [], "steps": []}

    result = MagicMock()
    result.recipe = recipe
    result.ingredients_status = []
    result.missing_count = 0
    result.have_count = 2
    result.partial_count = 0
    result.pantry_match_score = 1.0
    return result


def _patched_deps(gen_mock: AsyncMock) -> Any:
    """Patch the repository and the recipe generator the routes import lazily."""
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=[])

    return (
        patch(f"{_ROUTE_MODULE}.get_repository", AsyncMock(return_value=repo)),
        patch("bubbly_chef.services.recipe_generator.generate_recipe", gen_mock),
    )


@pytest.mark.asyncio
async def test_generate_resolves_ai_manager_and_returns_200(client):
    """POST /v1/recipes/generate wires up without ImportError."""
    gen_mock = AsyncMock(return_value=_fake_generation_result())
    repo_patch, gen_patch = _patched_deps(gen_mock)

    with repo_patch, gen_patch, patch("bubbly_chef.api.deps.get_ai_manager") as get_mgr:
        get_mgr.return_value = MagicMock()

        response = await client.post(
            "/v1/recipes/generate",
            json={"prompt": "quick pasta dinner", "use_pantry": True},
        )

    assert response.status_code == 200, response.text
    assert response.json()["recipe"]["title"] == "Tomato Pasta"
    # Synchronous call — awaiting it would raise inside the route.
    get_mgr.assert_called_once_with()


@pytest.mark.asyncio
async def test_refine_resolves_ai_manager_and_returns_200(client):
    """POST /v1/recipes/refine wires up without ImportError."""
    gen_mock = AsyncMock(return_value=_fake_generation_result())
    repo_patch, gen_patch = _patched_deps(gen_mock)

    with repo_patch, gen_patch, patch("bubbly_chef.api.deps.get_ai_manager") as get_mgr:
        get_mgr.return_value = MagicMock()

        response = await client.post(
            "/v1/recipes/refine",
            json={"recipe": {}, "prompt": "make it vegetarian"},
        )

    assert response.status_code == 200, response.text
    get_mgr.assert_called_once_with()


def test_routes_import_get_ai_manager_from_deps():
    """`get_ai_manager` is defined in api.deps, not ai.manager.

    A direct guard against the import drifting back: `ai.manager` exports the
    AIManager class and its errors, but never the accessor.
    """
    import bubbly_chef.ai.manager as ai_manager_module
    from bubbly_chef.api.deps import get_ai_manager

    assert not hasattr(ai_manager_module, "get_ai_manager")
    assert callable(get_ai_manager)
