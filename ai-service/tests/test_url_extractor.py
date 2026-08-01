"""Tests for the URL extractor and its integration with the dispatcher.

Behaviors covered:
1. detect_modality: URL string → IngestModality.URL  (dispatcher unit test)
2. url_extractor: calls ingest_recipe_from_url and returns RecipeCardProposal envelope
3. url_extractor: uses payload.url when set
4. url_extractor: falls back to payload.text when payload.url is None
5. url_extractor: raises ValueError when neither url nor text is set
6. url_extractor: propagates RuntimeError from ingest_recipe_from_url
7. dispatcher singleton: URL modality is routed to url_extractor after module import
8. compat shim POST /v1/ingest/recipe-url: delegates to dispatcher, returns bare RecipeCard
9. compat shim POST /v1/ingest/recipe-url: 422 for invalid URL (validator fires before dispatch)
10. compat shim POST /v1/ingest/recipe-url: 502 when extraction raises
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

TEST_USER_ID = "test-user-url-extractor"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_scraper_stub(
    title: str = "Pasta Carbonara",
    ingredients: list[str] | None = None,
    instructions: list[str] | None = None,
    total_time: int = 25,
    yields: str = "2 servings",
    description: str | None = "Classic Italian pasta",
    image: str | None = "https://example.com/pasta.jpg",
) -> MagicMock:
    stub = MagicMock()
    stub.title.return_value = title
    stub.ingredients.return_value = ingredients or ["200g spaghetti", "100g pancetta"]
    stub.instructions_list.return_value = instructions or ["Boil pasta", "Mix with sauce"]
    stub.total_time.return_value = total_time
    stub.yields.return_value = yields
    stub.description.return_value = description
    stub.image.return_value = image
    return stub


# ---------------------------------------------------------------------------
# App fixture (reuse the same pattern as other integration tests)
# ---------------------------------------------------------------------------


@pytest.fixture
def app():
    from contextlib import asynccontextmanager
    from collections.abc import AsyncGenerator

    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    @asynccontextmanager
    async def no_op_lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        yield

    app = FastAPI(lifespan=no_op_lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=True,
    )

    # Importing url_extractor registers the URL extractor into the dispatcher.
    import bubbly_chef.services.url_extractor  # noqa: F401

    from bubbly_chef.api.routes.ingest import router

    app.include_router(router)
    return app


@pytest_asyncio.fixture
async def client(app):
    from bubbly_chef.api.auth import get_current_user_id

    app.dependency_overrides[get_current_user_id] = lambda: TEST_USER_ID
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Behavior 1: detect_modality still identifies URL strings correctly
# ---------------------------------------------------------------------------


def test_detect_modality_url():
    """detect_modality returns URL for http/https strings (regression guard)."""
    from bubbly_chef.api.ingest_dispatcher import IngestModality, ModalityDispatcher

    assert (
        ModalityDispatcher.detect_modality(text="https://www.allrecipes.com/recipe/123/pasta/")
        is IngestModality.URL
    )
    assert (
        ModalityDispatcher.detect_modality(text="http://myblog.example.com/soup")
        is IngestModality.URL
    )


# ---------------------------------------------------------------------------
# Behaviors 2–6: url_extractor unit tests (no HTTP, mock ingest_recipe_from_url)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_url_extractor_returns_recipe_card_proposal_envelope():
    """url_extractor wraps RecipeCard in RecipeCardProposal and envelope."""
    from bubbly_chef.models.recipe import Ingredient, RecipeCard
    from bubbly_chef.api.ingest_dispatcher import IngestModality, IngestPayload
    from bubbly_chef.services.url_extractor import url_extractor

    fake_recipe = RecipeCard(
        title="Pasta Carbonara",
        ingredients=[Ingredient(name="spaghetti"), Ingredient(name="pancetta")],
        instructions=["Boil pasta", "Mix with sauce"],
        source_type="url",
        source_url="https://example.com/pasta",
    )

    with patch(
        "bubbly_chef.services.url_extractor.ingest_recipe_from_url",
        new_callable=AsyncMock,
        return_value=fake_recipe,
    ):
        payload = IngestPayload(
            modality=IngestModality.URL,
            url="https://example.com/pasta",
        )
        envelope = await url_extractor(payload)

    # Envelope shape
    assert envelope.intent.value == "recipe_card"
    assert envelope.proposal is not None
    assert envelope.proposal.recipe.title == "Pasta Carbonara"
    assert envelope.proposal.source_url == "https://example.com/pasta"
    assert len(envelope.proposal.recipe.ingredients) == 2


@pytest.mark.asyncio
async def test_url_extractor_uses_payload_url():
    """url_extractor reads the URL from payload.url when set."""
    from bubbly_chef.models.recipe import RecipeCard
    from bubbly_chef.api.ingest_dispatcher import IngestModality, IngestPayload
    from bubbly_chef.services.url_extractor import url_extractor

    fake_recipe = RecipeCard(
        title="Tiramisu",
        source_type="url",
        source_url="https://example.com/tiramisu",
    )

    mock_ingest = AsyncMock(return_value=fake_recipe)
    with patch("bubbly_chef.services.url_extractor.ingest_recipe_from_url", mock_ingest):
        payload = IngestPayload(
            modality=IngestModality.URL,
            url="https://example.com/tiramisu",
        )
        await url_extractor(payload)

    mock_ingest.assert_awaited_once_with("https://example.com/tiramisu")


@pytest.mark.asyncio
async def test_url_extractor_falls_back_to_payload_text():
    """url_extractor uses payload.text when payload.url is None."""
    from bubbly_chef.models.recipe import RecipeCard
    from bubbly_chef.api.ingest_dispatcher import IngestModality, IngestPayload
    from bubbly_chef.services.url_extractor import url_extractor

    fake_recipe = RecipeCard(
        title="Risotto",
        source_type="url",
        source_url="https://example.com/risotto",
    )

    mock_ingest = AsyncMock(return_value=fake_recipe)
    with patch("bubbly_chef.services.url_extractor.ingest_recipe_from_url", mock_ingest):
        payload = IngestPayload(
            modality=IngestModality.URL,
            url=None,
            text="https://example.com/risotto",
        )
        await url_extractor(payload)

    mock_ingest.assert_awaited_once_with("https://example.com/risotto")


@pytest.mark.asyncio
async def test_url_extractor_raises_value_error_when_no_url():
    """url_extractor raises ValueError when neither url nor text is provided."""
    from bubbly_chef.api.ingest_dispatcher import IngestModality, IngestPayload
    from bubbly_chef.services.url_extractor import url_extractor

    payload = IngestPayload(modality=IngestModality.URL, url=None, text=None)

    with pytest.raises(ValueError, match="requires a URL"):
        await url_extractor(payload)


@pytest.mark.asyncio
async def test_url_extractor_propagates_runtime_error():
    """url_extractor lets RuntimeError from ingest_recipe_from_url bubble up."""
    from bubbly_chef.api.ingest_dispatcher import IngestModality, IngestPayload
    from bubbly_chef.services.url_extractor import url_extractor

    with patch(
        "bubbly_chef.services.url_extractor.ingest_recipe_from_url",
        new_callable=AsyncMock,
        side_effect=RuntimeError("All extraction tiers failed"),
    ):
        payload = IngestPayload(
            modality=IngestModality.URL,
            url="https://broken.example.com/recipe",
        )
        with pytest.raises(RuntimeError, match="All extraction tiers failed"):
            await url_extractor(payload)


# ---------------------------------------------------------------------------
# Behavior 7: dispatcher singleton routes URL to url_extractor after import
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_global_dispatcher_routes_url_to_extractor():
    """After importing url_extractor, the global dispatcher handles URL payloads."""
    import bubbly_chef.services.url_extractor  # noqa: F401  — triggers registration

    from bubbly_chef.api.ingest_dispatcher import (
        IngestModality,
        IngestPayload,
        dispatcher,
    )
    from bubbly_chef.models.recipe import RecipeCard

    fake_recipe = RecipeCard(
        title="Global Dispatch Test",
        source_type="url",
        source_url="https://example.com/global",
    )

    with patch(
        "bubbly_chef.services.url_extractor.ingest_recipe_from_url",
        new_callable=AsyncMock,
        return_value=fake_recipe,
    ):
        payload = IngestPayload(
            modality=IngestModality.URL,
            url="https://example.com/global",
        )
        envelope = await dispatcher.dispatch(payload)

    assert envelope.proposal.recipe.title == "Global Dispatch Test"  # type: ignore[union-attr]


# ---------------------------------------------------------------------------
# Behaviors 8–10: compat shim POST /v1/ingest/recipe-url
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_compat_shim_returns_bare_recipe_card(client):
    """POST /v1/ingest/recipe-url → 200 with bare RecipeCard (unchanged contract)."""
    stub = _make_scraper_stub()

    with patch(
        "bubbly_chef.services.recipe_url_ingestor.scrape_me",
        return_value=stub,
    ):
        resp = await client.post(
            "/v1/ingest/recipe-url",
            json={"url": "https://www.allrecipes.com/recipe/123/pasta/"},
        )

    assert resp.status_code == 200
    data = resp.json()
    # Must return the same RecipeCard fields as before the shim was introduced
    assert data["title"] == "Pasta Carbonara"
    assert data["source_type"] == "url"
    assert data["source_url"] == "https://www.allrecipes.com/recipe/123/pasta/"
    assert "id" in data
    # Must NOT wrap in a ProposalEnvelope — bare RecipeCard only
    assert "intent" not in data
    assert "proposal" not in data


@pytest.mark.asyncio
async def test_compat_shim_invalid_url_returns_422(client):
    """POST /v1/ingest/recipe-url with non-URL string → 422."""
    resp = await client.post(
        "/v1/ingest/recipe-url",
        json={"url": "not-a-url"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_compat_shim_extraction_failure_returns_502(client):
    """POST /v1/ingest/recipe-url when all extraction tiers fail → 502."""
    with (
        patch(
            "bubbly_chef.services.recipe_url_ingestor.scrape_me",
            side_effect=Exception("SITE_NOT_SUPPORTED"),
        ),
        patch(
            "bubbly_chef.services.recipe_url_ingestor.httpx_get",
            new_callable=AsyncMock,
            side_effect=Exception("connection refused"),
        ),
        patch(
            "bubbly_chef.services.recipe_url_ingestor.get_ai_manager",
            side_effect=Exception("AI unavailable"),
        ),
    ):
        resp = await client.post(
            "/v1/ingest/recipe-url",
            json={"url": "https://broken.example.com/recipe"},
        )

    assert resp.status_code == 502
    assert "extract" in resp.json()["detail"].lower()
