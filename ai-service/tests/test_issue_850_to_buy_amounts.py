"""Issue #850: the to-buy list keeps each food's missing amount, unit and category.

The meal screen's "Add to grocery list" used to put bare names on the list, so
every line lost its amount. The service now says how much of each missing food
the meal needs. A food that reads "To buy" has nothing usable in the pantry, so
the missing amount is the whole recipe amount; two dishes needing the same food
add up when they count it in the same unit.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.domain.normalizer import resolve_category
from bubbly_chef.main import create_app
from bubbly_chef.services.grocery import meal_to_buy_items

USER = "user-850"
_ROUTE = "bubbly_chef.api.routes.grocery"


def _dish(position: int, ingredients: list[Any]) -> dict[str, Any]:
    return {
        "role": "main" if position == 0 else "side",
        "position": position,
        "recipe_id": f"r-{position}",
        "recipe": {"id": str(uuid.uuid4()), "title": f"Dish {position}", "ingredients": ingredients},
    }


def _repo(dishes: list[dict[str, Any]]) -> MagicMock:
    repo = MagicMock()
    repo.get_meal_with_dishes = AsyncMock(return_value={"meal": {"id": "m"}, "dishes": dishes})
    repo.get_all_pantry_items = AsyncMock(return_value=[])
    return repo


async def _by_name(dishes: list[dict[str, Any]]) -> dict[str, Any]:
    items = await meal_to_buy_items(_repo(dishes), USER, "m")
    return {i.name: i for i in items}


@pytest.mark.asyncio
async def test_a_missing_food_carries_its_amount_unit_and_category() -> None:
    got = await _by_name([_dish(0, [{"name": "feta", "quantity": 200, "unit": "g"}])])
    assert got["feta"].quantity == 200
    assert got["feta"].unit == "g"
    assert got["feta"].category == resolve_category("feta")
    assert got["feta"].category  # known to the catalog


@pytest.mark.asyncio
async def test_a_free_text_line_is_parsed_for_its_amount() -> None:
    got = await _by_name([_dish(0, ["300 g flour"])])
    assert (got["flour"].quantity, got["flour"].unit) == (300, "g")


@pytest.mark.asyncio
async def test_a_line_with_no_amount_has_none_and_an_unknown_food_has_no_category() -> None:
    got = await _by_name([_dish(0, [{"name": "fresh parsley", "quantity": None, "unit": None}])])
    assert got["fresh parsley"].quantity is None
    assert got["fresh parsley"].unit is None
    assert got["fresh parsley"].category is None


@pytest.mark.asyncio
async def test_two_dishes_needing_the_same_food_add_up_in_the_same_unit() -> None:
    got = await _by_name(
        [
            _dish(0, [{"name": "fresh basil", "quantity": 1, "unit": "bunch"}]),
            _dish(1, [{"name": "fresh basil", "quantity": 2, "unit": "bunches"}]),
        ]
    )
    assert len(got) == 1
    item = got["fresh basil"]
    assert item.quantity == 3
    assert item.unit == "bunch"
    assert item.dish_positions == [0, 1]


@pytest.mark.asyncio
async def test_units_that_cannot_be_added_keep_the_first_dishes_amount() -> None:
    got = await _by_name(
        [
            _dish(0, [{"name": "feta", "quantity": 200, "unit": "g"}]),
            _dish(1, [{"name": "feta", "quantity": 1, "unit": "cup"}]),
        ]
    )
    assert (got["feta"].quantity, got["feta"].unit) == (200, "g")


@pytest.mark.asyncio
async def test_the_route_returns_amounts_and_keeps_to_buy_unchanged(monkeypatch) -> None:
    app = create_app()

    async def _uid() -> str:
        return USER

    app.dependency_overrides[get_current_user_id] = _uid
    dishes = [_dish(0, [{"name": "feta", "quantity": 200, "unit": "g"}])]
    monkeypatch.setattr(f"{_ROUTE}.get_repository", AsyncMock(return_value=_repo(dishes)))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.post("/v1/grocery/meal-to-buy", json={"meal_id": "m"})
    body = res.json()
    assert body["to_buy"] == ["feta"]
    assert body["items"][0]["quantity"] == 200
    assert body["items"][0]["unit"] == "g"
    assert body["items"][0]["category"] == resolve_category("feta")


@pytest.mark.asyncio
async def test_a_food_listed_twice_in_one_dish_adds_up() -> None:
    got = await _by_name(
        [
            _dish(
                0,
                [
                    {"name": "feta", "quantity": 200, "unit": "g"},
                    {"name": "feta", "quantity": 50, "unit": "g"},
                ],
            )
        ]
    )
    assert len(got) == 1
    assert (got["feta"].quantity, got["feta"].unit) == (250, "g")
    assert got["feta"].dish_positions == [0]


@pytest.mark.asyncio
async def test_a_food_listed_twice_in_one_dish_in_different_units_keeps_the_first() -> None:
    got = await _by_name(
        [
            _dish(
                0,
                [
                    {"name": "feta", "quantity": 200, "unit": "g"},
                    {"name": "feta", "quantity": 1, "unit": "cup"},
                ],
            )
        ]
    )
    assert (got["feta"].quantity, got["feta"].unit) == (200, "g")


@pytest.mark.asyncio
async def test_a_numeric_string_quantity_counts() -> None:
    got = await _by_name([_dish(0, [{"name": "feta", "quantity": "200", "unit": "g"}])])
    assert (got["feta"].quantity, got["feta"].unit) == (200, "g")
