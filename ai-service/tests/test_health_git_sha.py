"""Tests for the deployed-commit-SHA block on /health and /health/ai.

Agent-loop step 3: a post-merge smoke test needs to tell whether it's
hitting the new deploy or a stale one still serving. These endpoints must
never 500 just because no SHA was configured.
"""

from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.config import settings
from bubbly_chef.main import create_app


@pytest_asyncio.fixture
async def client() -> AsyncClient:
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture(autouse=True)
def _restore_settings() -> None:
    """Restore settings.git_sha after each test — it's a shared singleton."""
    original = settings.git_sha
    yield
    settings.git_sha = original


@pytest.mark.asyncio
async def test_health_root_reports_configured_git_sha(client: AsyncClient) -> None:
    settings.git_sha = "abc1234"

    response = await client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"]["git_sha"] == "abc1234"


@pytest.mark.asyncio
async def test_health_root_falls_back_to_unknown_when_sha_unset(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings.git_sha = ""
    monkeypatch.delenv("RAILWAY_GIT_COMMIT_SHA", raising=False)

    response = await client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"]["git_sha"] == "unknown"


@pytest.mark.asyncio
async def test_health_root_falls_back_to_railway_env(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings.git_sha = ""
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "railway-sha-789")

    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json()["version"]["git_sha"] == "railway-sha-789"


@pytest.mark.asyncio
async def test_health_ai_keeps_existing_fields_and_adds_version(
    client: AsyncClient,
) -> None:
    settings.git_sha = "deadbeef"
    fake_status = {"healthy": True, "providers": ["gemini"]}

    with patch(
        "bubbly_chef.api.deps.get_ai_manager"
    ) as mock_get_manager:
        mock_get_manager.return_value.health_check = AsyncMock(return_value=fake_status)

        response = await client.get("/health/ai")

    assert response.status_code == 200
    body = response.json()
    # Existing fields untouched — Railway's healthcheck and old tests rely on these.
    assert body["status"] == "ok"
    assert body["service"] == "ai-microservice"
    assert body["ai_available"] is True
    assert body["providers"] == ["gemini"]
    # New field.
    assert body["version"]["git_sha"] == "deadbeef"
    assert "app_version" in body["version"]
