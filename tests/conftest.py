"""Pytest configuration and fixtures."""

import asyncio
import os
import tempfile
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from bubbly_chef.api.app import create_app
from bubbly_chef.repository.sqlite import SQLiteRepository, _repository


@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def client():
    """Create an async test client with a clean database for each test."""
    # Create a temporary database file
    db_fd, db_path = tempfile.mkstemp(suffix=".db")

    # Create a fresh repository with the temp database
    test_repo = SQLiteRepository(db_path=db_path)
    await test_repo.initialize()

    # Override the global repository
    global _repository
    old_repo = _repository
    _repository = test_repo

    # Create app and client
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    # Cleanup
    await test_repo.close()
    _repository = old_repo
    os.close(db_fd)
    os.unlink(db_path)
