"""Integration tests for /v1/recipes/cook and /v1/recipes/cook/confirm routes.

Mocks:
- get_current_user_id dependency → fixed test user_id
- SupabaseRepository.get_recipe, get_all_pantry_items, deduct_pantry_item,
  update_recipe_cooked → AsyncMock stubs
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation

TEST_USER_ID = "test-cook-user-123"
RECIPE_ID = str(uuid.uuid4())
PANTRY_ITEM_ID = str(uuid.uuid4())


def _make_pantry_item(
    item_id: str,
    name: str,
    qty: float,
    unit: str,
    qty_base: float | None,
    unit_base: str | None,
) -> PantryItem:
    return PantryItem(
        id=uuid.UUID(item_id),
        name=name,
        category=FoodCategory.OTHER,
        storage_location=StorageLocation.PANTRY,
        quantity=qty,
        unit=unit,
        quantity_base=qty_base,
        unit_base=unit_base,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


@pytest.fixture
def app():
    """Create a FastAPI app with auth override and no-op lifespan."""
    from contextlib import asynccontextmanager
    from collections.abc import AsyncGenerator

    @asynccontextmanager
    async def _noop_lifespan(app: Any) -> AsyncGenerator[None, None]:
        yield

    _app = create_app()
    _app.router.lifespan_context = _noop_lifespan

    async def _fake_user() -> str:
        return TEST_USER_ID

    _app.dependency_overrides[get_current_user_id] = _fake_user
    return _app


@pytest_asyncio.fixture
async def client(app: Any) -> AsyncClient:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


# ---------------------------------------------------------------------------
# POST /v1/recipes/cook
# ---------------------------------------------------------------------------


class TestCookRoute:
    """Tests for the cook proposal endpoint."""

    @pytest.mark.asyncio
    async def test_returns_proposal_for_valid_recipe(self, client: AsyncClient) -> None:
        """Valid recipe with pantry items returns a CookProposal."""
        pantry_item = _make_pantry_item(
            PANTRY_ITEM_ID, "eggs", 12.0, "count", 12.0, "count"
        )
        recipe_dict: dict[str, Any] = {
            "id": RECIPE_ID,
            "title": "Scrambled Eggs",
            "ingredients": [{"name": "eggs", "quantity": 3.0, "unit": "count"}],
        }

        mock_repo = AsyncMock()
        mock_repo.get_recipe.return_value = recipe_dict
        mock_repo.get_all_pantry_items.return_value = [pantry_item]

        with patch(
            "bubbly_chef.api.routes.recipes_ai.get_repository",
            return_value=mock_repo,
        ):
            response = await client.post(
                "/v1/recipes/cook", json={"recipe_id": RECIPE_ID}
            )

        assert response.status_code == 200
        data = response.json()
        assert data["recipe_id"] == RECIPE_ID
        assert data["recipe_title"] == "Scrambled Eggs"
        assert len(data["matches"]) == 1
        assert data["matches"][0]["status"] == "ready"
        assert data["missing"] == []

    @pytest.mark.asyncio
    async def test_returns_404_for_missing_recipe(self, client: AsyncClient) -> None:
        """Recipe not found returns 404."""
        mock_repo = AsyncMock()
        mock_repo.get_recipe.return_value = None

        with patch(
            "bubbly_chef.api.routes.recipes_ai.get_repository",
            return_value=mock_repo,
        ):
            response = await client.post(
                "/v1/recipes/cook", json={"recipe_id": RECIPE_ID}
            )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_missing_ingredient_appears_in_missing_list(
        self, client: AsyncClient
    ) -> None:
        """Ingredient not in pantry appears in the missing list."""
        recipe_dict: dict[str, Any] = {
            "id": RECIPE_ID,
            "title": "Pasta",
            "ingredients": [{"name": "truffle oil", "quantity": 1.0, "unit": "tbsp"}],
        }

        mock_repo = AsyncMock()
        mock_repo.get_recipe.return_value = recipe_dict
        mock_repo.get_all_pantry_items.return_value = []

        with patch(
            "bubbly_chef.api.routes.recipes_ai.get_repository",
            return_value=mock_repo,
        ):
            response = await client.post(
                "/v1/recipes/cook", json={"recipe_id": RECIPE_ID}
            )

        assert response.status_code == 200
        data = response.json()
        assert "truffle oil" in data["missing"]


# ---------------------------------------------------------------------------
# POST /v1/recipes/cook/confirm
# ---------------------------------------------------------------------------


class TestCookConfirmRoute:
    """Tests for the cook confirmation endpoint."""

    @pytest.mark.asyncio
    async def test_applies_deductions_and_marks_cooked(
        self, client: AsyncClient
    ) -> None:
        """Confirm call applies deductions and updates recipe."""
        recipe_dict: dict[str, Any] = {"id": RECIPE_ID, "title": "Eggs"}

        mock_repo = AsyncMock()
        mock_repo.get_recipe.return_value = recipe_dict
        mock_repo.deduct_pantry_item.return_value = None
        mock_repo.update_recipe_cooked.return_value = None

        payload = {
            "recipe_id": RECIPE_ID,
            "deductions": [
                {
                    "pantry_item_id": PANTRY_ITEM_ID,
                    "deduct_qty": 3.0,
                    "base_unit": "count",
                }
            ],
        }

        with patch(
            "bubbly_chef.api.routes.recipes_ai.get_repository",
            return_value=mock_repo,
        ):
            response = await client.post("/v1/recipes/cook/confirm", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["deductions_applied"] == 1

        mock_repo.deduct_pantry_item.assert_called_once_with(
            user_id=TEST_USER_ID,
            item_id=PANTRY_ITEM_ID,
            deduct_qty=3.0,
        )
        mock_repo.update_recipe_cooked.assert_called_once_with(
            user_id=TEST_USER_ID, recipe_id=RECIPE_ID
        )

    @pytest.mark.asyncio
    async def test_returns_404_when_recipe_missing(self, client: AsyncClient) -> None:
        """Confirm returns 404 if recipe doesn't exist."""
        mock_repo = AsyncMock()
        mock_repo.get_recipe.return_value = None

        payload = {
            "recipe_id": RECIPE_ID,
            "deductions": [],
        }

        with patch(
            "bubbly_chef.api.routes.recipes_ai.get_repository",
            return_value=mock_repo,
        ):
            response = await client.post("/v1/recipes/cook/confirm", json=payload)

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_empty_deductions_still_marks_cooked(
        self, client: AsyncClient
    ) -> None:
        """Confirm with no deductions still increments times_cooked."""
        recipe_dict: dict[str, Any] = {"id": RECIPE_ID, "title": "Eggs"}

        mock_repo = AsyncMock()
        mock_repo.get_recipe.return_value = recipe_dict
        mock_repo.update_recipe_cooked.return_value = None

        payload = {"recipe_id": RECIPE_ID, "deductions": []}

        with patch(
            "bubbly_chef.api.routes.recipes_ai.get_repository",
            return_value=mock_repo,
        ):
            response = await client.post("/v1/recipes/cook/confirm", json=payload)

        assert response.status_code == 200
        mock_repo.update_recipe_cooked.assert_called_once()
        mock_repo.deduct_pantry_item.assert_not_called()
