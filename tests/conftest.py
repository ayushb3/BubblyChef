"""Pytest configuration and fixtures."""

import os
import tempfile
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import bubbly_chef.repository.sqlite as sqlite_mod
from bubbly_chef.repository.sqlite import SQLiteRepository


@pytest.fixture(autouse=True)
def clear_ai_manager_cache():
    """Clear the lru_cache on get_ai_manager before every test.

    Without this, a test that triggers the real get_ai_manager() caches a live
    OllamaProvider/GeminiProvider. Subsequent tests that only patch the function
    reference still get the cached real provider, which hangs trying to connect.
    """
    from bubbly_chef.api.deps import get_ai_manager
    get_ai_manager.cache_clear()
    yield
    get_ai_manager.cache_clear()


def create_test_app() -> FastAPI:
    """Create a test app with a no-op lifespan (no Ollama/Gemini startup checks)."""
    from bubbly_chef.api.app import create_app

    app = create_app()

    @asynccontextmanager
    async def test_lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
        yield

    app.router.lifespan_context = test_lifespan
    return app


@pytest_asyncio.fixture
async def client():
    """Create an async test client with a clean database for each test."""
    db_fd, db_path = tempfile.mkstemp(suffix=".db")

    test_repo = SQLiteRepository(db_path=db_path)
    await test_repo.initialize()

    # Override the module-level singleton so all routes see it
    old_repo = sqlite_mod._repository
    sqlite_mod._repository = test_repo

    app = create_test_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    # Cleanup
    await test_repo.close()
    sqlite_mod._repository = old_repo
    os.close(db_fd)
    os.unlink(db_path)
