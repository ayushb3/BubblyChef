"""Issue #497 (Spec B.5): a saved meal's to-buy list for the grocery list.

A saved meal doesn't store its missing ingredients, so the meal screen's "Add
missing to grocery list" action needs them computed against the current pantry
with the cook matcher's synonym path. The route must be deterministic (no LLM)
and read-only (the grocery list itself lives client-side), and scoped to the
caller's meals.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.models.pantry import PantryItem
from bubbly_chef.services.grocery import MealNotFoundError, meal_to_buy

USER = "user-497"
_ROUTE = "bubbly_chef.api.routes.grocery"


def _pantry(name: str, qty: float = 3.0, unit: str = "item", expires_in: int | None = 30) -> PantryItem:
    return PantryItem(
        name=name,
        quantity=qty,
        unit=unit,
        expiry_date=None
        if expires_in is None
        else (datetime.now(UTC) + timedelta(days=expires_in)).date(),
    )


def _recipe(title: str, ingredients: list[Any]) -> dict[str, Any]:
    return {"id": str(uuid.uuid4()), "title": title, "servings": 2, "ingredients": ingredients}


def _meal() -> dict[str, Any]:
    return {
        "meal": {"id": "meal-1", "user_id": USER, "title": "Pasta night", "servings": 2},
        "dishes": [
            {
                "role": "main",
                "position": 0,
                "recipe_id": "r-main",
                "recipe": _recipe(
                    "Pasta",
                    [
                        {"name": "spaghetti", "quantity": 200, "unit": "g"},
                        {"name": "fresh basil", "quantity": 1, "unit": "bunch"},
                        {"name": "salt", "quantity": 1, "unit": "tsp"},  # staple: assumed on hand
                        {"name": "water", "quantity": 2, "unit": "l"},  # never shopped for
                        {"name": "eggs", "quantity": 2, "unit": "item"},
                    ],
                ),
            },
            {
                "role": "side",
                "position": 1,
                "recipe_id": "r-side",
                "recipe": _recipe(
                    "Salad",
                    [{"name": "fresh basil", "quantity": 1, "unit": "bunch"}, "1 cucumber"],
                ),
            },
        ],
    }


def _repo(meal: dict[str, Any] | None, pantry: list[PantryItem]) -> MagicMock:
    repo = MagicMock()
    repo.get_meal_with_dishes = AsyncMock(return_value=meal)
    repo.get_all_pantry_items = AsyncMock(return_value=pantry)
    return repo


class TestMealToBuy:
    @pytest.mark.asyncio
    async def test_lists_only_what_the_pantry_lacks_once_each(self) -> None:
        repo = _repo(_meal(), [_pantry("eggs", 6)])
        got = await meal_to_buy(repo, USER, "meal-1")
        assert sorted(got) == ["cucumber", "fresh basil", "spaghetti"]  # no salt, water, eggs, dupe basil
        repo.get_meal_with_dishes.assert_awaited_once_with(USER, "meal-1")
        repo.get_all_pantry_items.assert_awaited_once_with(USER)

    @pytest.mark.asyncio
    async def test_uses_the_synonym_path_so_stocked_pasta_covers_spaghetti(self) -> None:
        repo = _repo(_meal(), [_pantry("pasta", 500, "g"), _pantry("eggs", 6)])
        assert "spaghetti" not in await meal_to_buy(repo, USER, "meal-1")

    @pytest.mark.asyncio
    async def test_expired_or_empty_stock_does_not_count_as_on_hand(self) -> None:
        repo = _repo(_meal(), [_pantry("eggs", 0), _pantry("pasta", 500, "g", expires_in=-2)])
        got = await meal_to_buy(repo, USER, "meal-1")
        assert {"eggs"} <= {n.lower() for n in got}
        assert any("spaghetti" in n or "pasta" in n for n in got)

    @pytest.mark.asyncio
    async def test_a_meal_that_is_not_the_users_is_not_found(self) -> None:
        with pytest.raises(MealNotFoundError):
            await meal_to_buy(_repo(None, []), USER, "someone-elses")

    @pytest.mark.asyncio
    async def test_a_meal_with_no_ingredients_needs_nothing(self) -> None:
        meal = _meal()
        for dish in meal["dishes"]:
            dish["recipe"]["ingredients"] = []
        assert await meal_to_buy(_repo(meal, []), USER, "meal-1") == []

    @pytest.mark.asyncio
    async def test_never_writes(self) -> None:
        repo = _repo(_meal(), [])
        await meal_to_buy(repo, USER, "meal-1")
        called = {c[0] for c in repo.method_calls}
        assert called == {"get_meal_with_dishes", "get_all_pantry_items"}


@pytest.fixture
def app():
    _app = create_app()

    async def _fake_user_id() -> str:
        return USER

    _app.dependency_overrides[get_current_user_id] = _fake_user_id
    return _app


@pytest_asyncio.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


class TestRoute:
    @pytest.mark.asyncio
    async def test_returns_the_to_buy_names(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setattr(f"{_ROUTE}.get_repository", AsyncMock(return_value=_repo(_meal(), [])))
        res = await client.post("/v1/grocery/meal-to-buy", json={"meal_id": "meal-1"})
        assert res.status_code == 200
        assert "spaghetti" in res.json()["to_buy"]

    @pytest.mark.asyncio
    async def test_404_for_a_meal_that_is_not_the_callers(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setattr(f"{_ROUTE}.get_repository", AsyncMock(return_value=_repo(None, [])))
        res = await client.post("/v1/grocery/meal-to-buy", json={"meal_id": "not-mine"})
        assert res.status_code == 404

    @pytest.mark.asyncio
    async def test_requires_auth(self) -> None:
        app = create_app()  # no dependency override
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            res = await ac.post("/v1/grocery/meal-to-buy", json={"meal_id": "x"})
        assert res.status_code in (401, 403)
