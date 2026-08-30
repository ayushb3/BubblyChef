"""Test configuration and shared fixtures for ai-service tests.

Fix #208: The `_ai_manager` singleton in `bubbly_chef.api.deps` holds an httpx
client that is bound to the event loop created at first construction.
pytest-asyncio gives each test its own event loop, so test 2+ would receive a
closed client.  The autouse fixture below resets the singleton before and after
every test so each test constructs a fresh manager on the current loop.
"""

import pytest

from bubbly_chef.api import deps
from bubbly_chef.services.cook_matcher import _alias_cache


@pytest.fixture(autouse=True)
def reset_ai_manager() -> None:
    """Reset the AIManager singleton between tests (#208).

    Prevents httpx clients bound to a stale event loop from leaking across
    test boundaries when pytest-asyncio assigns a fresh loop per test.
    """
    deps._ai_manager = None
    yield  # type: ignore[misc]
    deps._ai_manager = None


@pytest.fixture(autouse=True)
def reset_alias_cache() -> None:
    """Clear the alias-resolution cache between tests (#280).

    `_alias_cache` is module-global and survives the test that populated it, so
    a later test calling resolve_aliases_with_llm() with the same
    (unmatched names, pantry names) fingerprint would get a cache hit and never
    reach its mocked provider — making assertions on await counts and on notes
    fail depending only on test ordering.
    """
    _alias_cache.clear()
    yield  # type: ignore[misc]
    _alias_cache.clear()
