"""POST /v1/recipes/{recipe_id}/steps/ensure (issue #648).

Route-level contract tests: steps already present (no model call), absent
(derived + persisted), model failure (nothing persisted), and not-found.
Service-level unit tests for `ensure_structured_steps` live alongside these
so the two failure kinds and the idempotency guarantee are each pinned once
at the layer that owns them.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.repository.supabase_repo import SupabaseRepository
from bubbly_chef.services.structured_steps import (
    RecipeNotFoundError,
    StructuredStepsUnavailableError,
    ensure_structured_steps,
)

TEST_USER_ID = "test-user-123"
_ROUTE_MODULE = "bubbly_chef.api.routes.recipes_ai"


@pytest.fixture
def app():
    _app = create_app()

    async def _fake_user_id() -> str:
        return TEST_USER_ID

    _app.dependency_overrides[get_current_user_id] = _fake_user_id
    return _app


@pytest_asyncio.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _repo(recipe_row: dict[str, Any] | None) -> MagicMock:
    repo = MagicMock()
    repo.get_recipe = AsyncMock(return_value=recipe_row)
    repo.update_recipe_steps = AsyncMock(return_value=None)
    return repo


# ---------------------------------------------------------------------------
# Route contract
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_existing_steps_are_returned_with_no_model_call(client):
    stored_steps = [
        {
            "text": "Boil the pasta",
            "label": "Boil pasta",
            "ongoing_label": "the pasta boils",
            "duration_minutes": 10,
            "duration_estimated": False,
            "hands_on": False,
            "depends_on": [],
            "exclusive": [],
        }
    ]
    repo = _repo({"id": "recipe-1", "instructions": ["Boil the pasta"], "steps": stored_steps})
    ai_mock = MagicMock()
    ai_mock.complete = AsyncMock()

    with (
        patch(f"{_ROUTE_MODULE}.get_repository", AsyncMock(return_value=repo)),
        patch("bubbly_chef.api.deps.get_ai_manager", return_value=ai_mock),
    ):
        response = await client.post("/v1/recipes/recipe-1/steps/ensure")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["recipe_id"] == "recipe-1"
    assert body["derived"] is False
    assert body["steps"][0]["label"] == "Boil pasta"
    ai_mock.complete.assert_not_called()
    repo.update_recipe_steps.assert_not_called()


@pytest.mark.asyncio
async def test_missing_steps_are_derived_and_persisted(client):
    repo = _repo({"id": "recipe-1", "title": "Pasta", "instructions": ["Boil the pasta"], "steps": None})
    ai_mock = MagicMock()
    ai_mock.complete = AsyncMock(
        return_value=_steps_ensure_output([{"label": "Boil pasta", "hands_on": False}])
    )

    with (
        patch(f"{_ROUTE_MODULE}.get_repository", AsyncMock(return_value=repo)),
        patch("bubbly_chef.api.deps.get_ai_manager", return_value=ai_mock),
    ):
        response = await client.post("/v1/recipes/recipe-1/steps/ensure")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["derived"] is True
    assert body["steps"][0]["text"] == "Boil the pasta"
    assert body["steps"][0]["label"] == "Boil pasta"
    repo.update_recipe_steps.assert_awaited_once()
    persisted_call = repo.update_recipe_steps.await_args
    assert persisted_call.args[0] == TEST_USER_ID
    assert persisted_call.args[1] == "recipe-1"


@pytest.mark.asyncio
async def test_model_unavailable_persists_nothing_and_returns_502(client):
    repo = _repo({"id": "recipe-1", "title": "Pasta", "instructions": ["Boil the pasta"], "steps": None})
    ai_mock = MagicMock()
    ai_mock.complete = AsyncMock(
        side_effect=NoProviderAvailableError("no provider", kind="network", configured=True)
    )

    with (
        patch(f"{_ROUTE_MODULE}.get_repository", AsyncMock(return_value=repo)),
        patch("bubbly_chef.api.deps.get_ai_manager", return_value=ai_mock),
    ):
        response = await client.post("/v1/recipes/recipe-1/steps/ensure")

    assert response.status_code == 502, response.text
    assert response.json()["detail"]["error_kind"] == "model_unavailable"
    repo.update_recipe_steps.assert_not_called()


@pytest.mark.asyncio
async def test_invalid_model_output_persists_nothing_and_returns_502(client):
    """The model's step count doesn't match the instructions -- discarded,
    not persisted, and reported as an "invalid_output" 502."""
    repo = _repo(
        {
            "id": "recipe-1",
            "title": "Pasta",
            "instructions": ["Boil the pasta", "Drain it"],
            "steps": None,
        }
    )
    ai_mock = MagicMock()
    ai_mock.complete = AsyncMock(return_value=_steps_ensure_output([{"label": "Boil pasta"}]))

    with (
        patch(f"{_ROUTE_MODULE}.get_repository", AsyncMock(return_value=repo)),
        patch("bubbly_chef.api.deps.get_ai_manager", return_value=ai_mock),
    ):
        response = await client.post("/v1/recipes/recipe-1/steps/ensure")

    assert response.status_code == 502, response.text
    assert response.json()["detail"]["error_kind"] == "invalid_output"
    repo.update_recipe_steps.assert_not_called()


@pytest.mark.asyncio
async def test_unknown_recipe_returns_404(client):
    repo = _repo(None)

    with patch(f"{_ROUTE_MODULE}.get_repository", AsyncMock(return_value=repo)):
        response = await client.post("/v1/recipes/does-not-exist/steps/ensure")

    assert response.status_code == 404, response.text


# ---------------------------------------------------------------------------
# Service-level: ensure_structured_steps directly
# ---------------------------------------------------------------------------


def _steps_ensure_output(steps: list[dict[str, Any]]) -> Any:
    from bubbly_chef.services.structured_steps import _StepsEnsureOutput

    return _StepsEnsureOutput.model_validate({"steps": steps})


@pytest.mark.asyncio
async def test_ensure_structured_steps_raises_not_found_for_missing_recipe():
    repo = _repo(None)

    with pytest.raises(RecipeNotFoundError):
        await ensure_structured_steps(
            user_id=TEST_USER_ID,
            recipe_id="ghost",
            repo=repo,  # type: ignore[arg-type]
            ai_manager=MagicMock(),
        )


@pytest.mark.asyncio
async def test_ensure_structured_steps_is_idempotent_on_second_call():
    """Calling it twice in a row: the first derives, the second returns the
    same steps with no further model call -- the persisted round trip."""
    repo: SupabaseRepository = _repo(  # type: ignore[assignment]
        {"id": "recipe-1", "title": "Pasta", "instructions": ["Boil the pasta"], "steps": None}
    )
    ai_mock = MagicMock()
    ai_mock.complete = AsyncMock(
        return_value=_steps_ensure_output([{"label": "Boil pasta", "hands_on": False}])
    )

    steps_first, derived_first = await ensure_structured_steps(
        user_id=TEST_USER_ID, recipe_id="recipe-1", repo=repo, ai_manager=ai_mock
    )
    assert derived_first is True
    ai_mock.complete.assert_awaited_once()

    # Simulate the persisted row on the second call.
    repo.get_recipe = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "id": "recipe-1",
            "instructions": ["Boil the pasta"],
            "steps": [s.model_dump(mode="json") for s in steps_first],
        }
    )
    steps_second, derived_second = await ensure_structured_steps(
        user_id=TEST_USER_ID, recipe_id="recipe-1", repo=repo, ai_manager=ai_mock
    )
    assert derived_second is False
    ai_mock.complete.assert_awaited_once()  # not called again
    assert [s.text for s in steps_second] == [s.text for s in steps_first]


@pytest.mark.asyncio
async def test_ensure_structured_steps_raises_unavailable_on_bad_output_type():
    repo: SupabaseRepository = _repo(  # type: ignore[assignment]
        {"id": "recipe-1", "title": "Pasta", "instructions": ["Boil the pasta"], "steps": None}
    )
    ai_mock = MagicMock()
    ai_mock.complete = AsyncMock(return_value="not a pydantic model")

    with pytest.raises(StructuredStepsUnavailableError) as exc_info:
        await ensure_structured_steps(
            user_id=TEST_USER_ID, recipe_id="recipe-1", repo=repo, ai_manager=ai_mock
        )
    assert exc_info.value.error_kind == "invalid_output"
    repo.update_recipe_steps.assert_not_called()  # type: ignore[attr-defined]
