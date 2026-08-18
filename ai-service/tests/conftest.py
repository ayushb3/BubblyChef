"""Test configuration and shared fixtures for ai-service tests.

Fix #208: The `_ai_manager` singleton in `bubbly_chef.api.deps` holds an httpx
client that is bound to the event loop created at first construction.
pytest-asyncio gives each test its own event loop, so test 2+ would receive a
closed client.  The autouse fixture below resets the singleton before and after
every test so each test constructs a fresh manager on the current loop.
"""

import pytest

from bubbly_chef.api import deps


@pytest.fixture(autouse=True)
def reset_ai_manager() -> None:
    """Reset the AIManager singleton between tests (#208).

    Prevents httpx clients bound to a stale event loop from leaking across
    test boundaries when pytest-asyncio assigns a fresh loop per test.
    """
    deps._ai_manager = None
    yield  # type: ignore[misc]
    deps._ai_manager = None
