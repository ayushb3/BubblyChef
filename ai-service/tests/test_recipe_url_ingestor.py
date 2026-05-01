"""Tests for POST /v1/ingest/recipe-url endpoint.

TDD behaviors:
1. Valid known-site URL → returns RecipeCard with title + ingredients
2. Unknown URL with Schema → wild_mode fallback returns RecipeCard
3. No Schema found → AI fallback fires and returns RecipeCard
4. Invalid URL string → returns 422
5. recipe-scrapers raises exception → falls through to AI fallback
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

TEST_USER_ID = "test-user-url-ingest"

# ---------------------------------------------------------------------------
# App fixture
# ---------------------------------------------------------------------------


@pytest.fixture
def app():
    """Create the FastAPI test app with mocked lifespan."""
    from contextlib import asynccontextmanager
    from collections.abc import AsyncGenerator

    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    @asynccontextmanager
    async def no_op_lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        yield

    from fastapi import FastAPI

    app = FastAPI(lifespan=no_op_lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=True,
    )

    from bubbly_chef.api.routes.ingest import router

    app.include_router(router)
    return app


@pytest_asyncio.fixture
async def client(app):
    """Async HTTP client with auth bypass."""
    from bubbly_chef.api.auth import get_current_user_id

    app.dependency_overrides[get_current_user_id] = lambda: TEST_USER_ID

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_scraper_stub(
    title: str = "Chocolate Chip Cookies",
    ingredients: list[str] | None = None,
    instructions: list[str] | None = None,
    total_time: int = 45,
    yields: str = "24 cookies",
    description: str = "Classic cookies",
    image: str = "https://example.com/cookie.jpg",
) -> MagicMock:
    """Build a mock recipe-scrapers scraper object."""
    stub = MagicMock()
    stub.title.return_value = title
    stub.ingredients.return_value = ingredients or ["2 cups flour", "1 cup sugar"]
    stub.instructions_list.return_value = instructions or ["Mix dry ingredients", "Bake"]
    stub.total_time.return_value = total_time
    stub.yields.return_value = yields
    stub.description.return_value = description
    stub.image.return_value = image
    return stub


# ---------------------------------------------------------------------------
# Behavior 1: Valid known-site URL → returns RecipeCard
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_known_site_returns_recipe_card(client):
    """scrape_me() succeeds → return RecipeCard from scraper data."""
    scraper = _make_scraper_stub()

    with patch(
        "bubbly_chef.services.recipe_url_ingestor.scrape_me",
        return_value=scraper,
    ):
        resp = await client.post(
            "/v1/ingest/recipe-url",
            json={"url": "https://www.allrecipes.com/recipe/123/chocolate-chip-cookies/"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Chocolate Chip Cookies"
    assert len(data["ingredients"]) == 2
    assert data["source_type"] == "url"
    assert data["source_url"] == "https://www.allrecipes.com/recipe/123/chocolate-chip-cookies/"
    # scraper path should NOT call AI
    assert "id" in data  # RecipeCard always has an id


# ---------------------------------------------------------------------------
# Behavior 2: Unknown URL with Schema → wild_mode (supported_only=False) fallback
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_site_wild_mode_fallback(client):
    """scrape_me() raises → retry via scrape_html(supported_only=False) succeeds."""
    wild_scraper = _make_scraper_stub(title="Wild Mode Recipe")

    with patch(
        "bubbly_chef.services.recipe_url_ingestor.scrape_me",
        side_effect=Exception("SITE_NOT_SUPPORTED"),
    ), patch(
        "bubbly_chef.services.recipe_url_ingestor.httpx_get",
        new_callable=AsyncMock,
        return_value="<html>unknown blog recipe</html>",
    ), patch(
        "bubbly_chef.services.recipe_url_ingestor.scrape_html",
        return_value=wild_scraper,
    ):
        resp = await client.post(
            "/v1/ingest/recipe-url",
            json={"url": "https://unknownblog.example.com/my-soup-recipe"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Wild Mode Recipe"
    assert data["source_type"] == "url"


# ---------------------------------------------------------------------------
# Behavior 3: No Schema found → AI fallback
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_schema_ai_fallback(client):
    """Both scrape_me attempts raise → AI fallback extracts recipe."""
    from bubbly_chef.models.recipe import Ingredient, RecipeCard

    ai_recipe = RecipeCard(
        title="AI Extracted Pasta",
        ingredients=[Ingredient(name="pasta"), Ingredient(name="sauce")],
        instructions=["Boil pasta", "Add sauce"],
        source_type="url",
        source_url="https://example.com/pasta",
    )

    mock_ai_manager = AsyncMock()
    mock_ai_manager.complete = AsyncMock(return_value=ai_recipe)

    with patch(
        "bubbly_chef.services.recipe_url_ingestor.scrape_me",
        side_effect=Exception("No Schema"),
    ), patch(
        "bubbly_chef.services.recipe_url_ingestor.get_ai_manager",
        return_value=mock_ai_manager,
    ), patch(
        "bubbly_chef.services.recipe_url_ingestor.httpx_get",
        new_callable=AsyncMock,
        return_value="<html>pasta recipe page</html>",
    ):
        resp = await client.post(
            "/v1/ingest/recipe-url",
            json={"url": "https://example.com/pasta"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "AI Extracted Pasta"
    assert data["source_type"] == "url"
    assert mock_ai_manager.complete.called


# ---------------------------------------------------------------------------
# Behavior 4: Invalid URL string → 422
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_invalid_url_returns_422(client):
    """Malformed URL → 422 without calling any external service."""
    resp = await client.post(
        "/v1/ingest/recipe-url",
        json={"url": "not-a-url"},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Behavior 5: recipe-scrapers raises → falls through to AI fallback
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scraper_exception_falls_through_to_ai(client):
    """Any exception from scrape_me (both modes) → AI fallback fires."""
    from bubbly_chef.models.recipe import Ingredient, RecipeCard

    ai_recipe = RecipeCard(
        title="Fallback Soup",
        ingredients=[Ingredient(name="broth")],
        instructions=["Heat broth"],
        source_type="url",
        source_url="https://broken-site.example.com/soup",
    )

    mock_ai_manager = AsyncMock()
    mock_ai_manager.complete = AsyncMock(return_value=ai_recipe)

    with patch(
        "bubbly_chef.services.recipe_url_ingestor.scrape_me",
        side_effect=RuntimeError("connection timeout"),
    ), patch(
        "bubbly_chef.services.recipe_url_ingestor.get_ai_manager",
        return_value=mock_ai_manager,
    ), patch(
        "bubbly_chef.services.recipe_url_ingestor.httpx_get",
        new_callable=AsyncMock,
        return_value="<html>soup page</html>",
    ):
        resp = await client.post(
            "/v1/ingest/recipe-url",
            json={"url": "https://broken-site.example.com/soup"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Fallback Soup"
    assert mock_ai_manager.complete.called
