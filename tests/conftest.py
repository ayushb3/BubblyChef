"""Pytest configuration and fixtures."""

import asyncio
import os
import tempfile
from typing import AsyncGenerator, Generator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create event loop for async tests."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def test_db() -> AsyncGenerator[str, None]:
    """Create a temporary test database."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name

    yield db_path

    # Cleanup
    if os.path.exists(db_path):
        os.unlink(db_path)


@pytest_asyncio.fixture
async def repository(test_db: str):
    """Create a test repository with fresh database."""
    from bubbly_chef.repository.sqlite import SQLiteRepository

    repo = SQLiteRepository(db_path=test_db)
    await repo.initialize()
    yield repo
    await repo.close()


@pytest_asyncio.fixture
async def client(test_db: str) -> AsyncGenerator[AsyncClient, None]:
    """Create test client with fresh database."""
    from bubbly_chef.repository import sqlite

    # Reset repository singleton and point to test db
    sqlite._repository = None

    # Patch the default db path
    original_init = sqlite.SQLiteRepository.__init__

    def patched_init(self, db_path: str = test_db):
        original_init(self, db_path)

    sqlite.SQLiteRepository.__init__ = patched_init

    # Import app after patching
    from bubbly_chef.api.app import create_app

    app = create_app()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    # Cleanup
    sqlite.SQLiteRepository.__init__ = original_init
    if sqlite._repository:
        await sqlite._repository.close()
        sqlite._repository = None
