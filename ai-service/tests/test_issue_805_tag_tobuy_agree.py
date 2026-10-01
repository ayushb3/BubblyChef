"""Issue #805: a meal's ingredient tags and its "N to buy" line must agree.

The meal screen asks two endpoints about the same dishes: `/v1/pantry/match-ingredients`
(the per-row food tags, #784) and `/v1/grocery/meal-to-buy` (the "N to buy" line, #497).
The demo showed "0.5 count onion" with no tag while the line listed onion. Both now
resolve a line through one function, so for a fixture meal:

- every item on the to-buy line is a row the match endpoint calls `missing` (which the
  meal screen draws as a "To buy" tag), and
- every row the match endpoint calls `missing` is on the line, so no "To buy" tag
  contradicts a line that says "nothing to buy".
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
from bubbly_chef.domain.normalizer import normalize_food_name
from bubbly_chef.main import create_app
from bubbly_chef.models.pantry import PantryItem
from bubbly_chef.services.ingredient_match import match_ingredient_lines

USER = "user-805"


def _pantry(name: str, qty: float, unit: str) -> PantryItem:
    return PantryItem(
        name=name,
        quantity=qty,
        unit=unit,
        expiry_date=(datetime.now(UTC) + timedelta(days=30)).date(),
    )


def _recipe(title: str, ingredients: list[Any]) -> dict[str, Any]:
    return {"id": str(uuid.uuid4()), "title": title, "servings": 2, "ingredients": ingredients}


def _meal() -> dict[str, Any]:
    """Free-text and structured lines, a short line, a staple, water, a repeat across dishes."""
    return {
        "meal": {"id": "meal-1", "user_id": USER, "title": "Onion soup night", "servings": 2},
        "dishes": [
            {
                "role": "main",
                "position": 0,
                "recipe_id": "r-main",
                "recipe": _recipe(
                    "Soup",
                    [
                        "0.5 count onion",  # the demo's line; no onion in the pantry
                        {"name": "saffron", "quantity": 1, "unit": "g"},
                        {"name": "butter", "quantity": 100, "unit": "g"},  # 50 g stocked: short
                        {"name": "flour", "quantity": 200, "unit": "g"},  # covered
                        {"name": "salt", "quantity": 1, "unit": "tsp"},  # staple
                        {"name": "water", "quantity": 2, "unit": "l"},  # never shopped for
                    ],
                ),
            },
            {
                "role": "side",
                "position": 1,
                "recipe_id": "r-side",
                "recipe": _recipe(
                    "Salad",
                    [
                        {"name": "onion", "quantity": 0.5, "unit": "count"},  # same food again
                        {"name": "cucumber", "quantity": 1, "unit": "count"},
                        {"name": "ice", "quantity": 1, "unit": "cup"},  # never shopped for
                    ],
                ),
            },
        ],
    }


def _stock() -> list[PantryItem]:
    return [_pantry("flour", 500, "g"), _pantry("butter", 50, "g")]


def _key(name: str) -> str:
    return normalize_food_name(name).lower().strip()


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


def _wire(monkeypatch: pytest.MonkeyPatch, meal: dict[str, Any], pantry: list[PantryItem]) -> None:
    repo = MagicMock()
    repo.get_meal_with_dishes = AsyncMock(return_value=meal)
    repo.get_all_pantry_items = AsyncMock(return_value=pantry)
    get_repo = AsyncMock(return_value=repo)
    monkeypatch.setattr("bubbly_chef.api.routes.grocery.get_repository", get_repo)
    monkeypatch.setattr("bubbly_chef.api.routes.pantry.get_repository", get_repo)


async def _tags_and_to_buy(
    client: AsyncClient, meal: dict[str, Any]
) -> tuple[list[tuple[str, str]], list[str]]:
    """What the meal screen sees: (line, status) per dish row, and the to-buy names."""
    rows: list[tuple[str, str]] = []
    for dish in meal["dishes"]:
        lines = dish["recipe"]["ingredients"]
        res = await client.post("/v1/pantry/match-ingredients", json={"ingredients": lines})
        assert res.status_code == 200
        matches = res.json()["matches"]
        assert len(matches) == len(lines)
        rows += [(m["name"], m["status"]) for m in matches]
    res = await client.post("/v1/grocery/meal-to-buy", json={"meal_id": "meal-1"})
    assert res.status_code == 200
    return rows, res.json()["to_buy"]


async def _rows_per_dish(client: AsyncClient, meal: dict[str, Any]) -> list[list[tuple[str, str]]]:
    """(line name, status) per row, grouped by dish: what each dish card shows."""
    out: list[list[tuple[str, str]]] = []
    for dish in meal["dishes"]:
        res = await client.post(
            "/v1/pantry/match-ingredients", json={"ingredients": dish["recipe"]["ingredients"]}
        )
        assert res.status_code == 200
        out.append([(m["name"], m["status"]) for m in res.json()["matches"]])
    return out


class TestTagAndToBuyAgree:
    @pytest.mark.asyncio
    async def test_the_onion_line_is_to_buy_on_both(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, _meal(), _stock())
        rows, to_buy = await _tags_and_to_buy(client, _meal())
        assert ("onion", "missing") in rows
        assert "onion" in to_buy

    @pytest.mark.asyncio
    async def test_every_to_buy_item_has_a_missing_row(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, _meal(), _stock())
        rows, to_buy = await _tags_and_to_buy(client, _meal())
        missing = {_key(name) for name, status in rows if status == "missing"}
        for name in to_buy:
            assert _key(name) in missing, f"{name!r} is to buy but no row is tagged To buy"

    @pytest.mark.asyncio
    async def test_every_missing_row_is_on_the_to_buy_line(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, _meal(), _stock())
        rows, to_buy = await _tags_and_to_buy(client, _meal())
        listed = {_key(n) for n in to_buy}
        for name, status in rows:
            if status == "missing":
                assert _key(name) in listed, f"{name!r} is tagged To buy but not on the line"

    @pytest.mark.asyncio
    async def test_each_dish_card_lists_every_one_of_its_to_buy_rows(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Per card, read straight off the response (no client-side re-matching): the
        # names the service attributes to this dish's position must be exactly the
        # dish's rows tagged To buy. The onion is missing in both dishes, listed once.
        _wire(monkeypatch, _meal(), _stock())
        per_dish = await _rows_per_dish(client, _meal())
        res = await client.post("/v1/grocery/meal-to-buy", json={"meal_id": "meal-1"})
        body = res.json()
        assert [_key(n) for n in body["to_buy"]].count("onion") == 1
        assert [i["name"] for i in body["items"]] == body["to_buy"]

        for position, rows in enumerate(per_dish):
            on_card = sorted(
                dish_name
                for item in body["items"]
                for pos, dish_name in zip(item["dish_positions"], item["dish_names"], strict=True)
                if pos == position
            )
            to_buy_rows = sorted({name for name, status in rows if status == "missing"})
            assert on_card == to_buy_rows
        assert "onion" in {n for n, st in per_dish[0] if st == "missing"}
        assert "onion" in {n for n, st in per_dish[1] if st == "missing"}

    @pytest.mark.asyncio
    async def test_a_food_spelled_differently_in_two_dishes_is_one_entry_on_both(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # "fresh basil" and "basil" are one food (normalize_food_name drops "fresh"):
        # the list has one entry, attributed to both dishes, each under its own wording.
        meal = _meal()
        meal["dishes"][0]["recipe"]["ingredients"].append(
            {"name": "fresh basil", "quantity": 1, "unit": "bunch"}
        )
        meal["dishes"][1]["recipe"]["ingredients"].append(
            {"name": "basil", "quantity": 1, "unit": "bunch"}
        )
        _wire(monkeypatch, meal, _stock())
        res = await client.post("/v1/grocery/meal-to-buy", json={"meal_id": "meal-1"})
        body = res.json()
        basil = [i for i in body["items"] if _key(i["name"]) == "basil"]
        assert len(basil) == 1
        assert basil[0] == {
            "name": "fresh basil",
            "dish_positions": [0, 1],
            "dish_names": ["fresh basil", "basil"],
        }
        assert [_key(n) for n in body["to_buy"]].count("basil") == 1
        # And each dish's own row for it is tagged To buy, so each card has to list it.
        per_dish = await _rows_per_dish(client, meal)
        assert ("fresh basil", "missing") in per_dish[0]
        assert ("basil", "missing") in per_dish[1]

    @pytest.mark.asyncio
    async def test_the_fixture_resolves_as_expected(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, _meal(), _stock())
        rows, to_buy = await _tags_and_to_buy(client, _meal())
        status = dict(rows)
        assert status["flour"] == "have"
        assert status["butter"] == "low"
        assert status["salt"] == "have"
        assert status["water"] == "have"  # nobody buys water: not "To buy"
        assert status["ice"] == "have"
        assert sorted(to_buy) == ["cucumber", "onion", "saffron"]

    @pytest.mark.asyncio
    async def test_stocking_the_onion_clears_it_from_both(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _wire(monkeypatch, _meal(), [*_stock(), _pantry("onion", 3, "count")])
        rows, to_buy = await _tags_and_to_buy(client, _meal())
        assert not any(name == "onion" and status == "missing" for name, status in rows)
        assert "onion" not in to_buy


class TestSharedResolution:
    def test_a_half_count_onion_with_no_onion_in_stock_is_missing(self) -> None:
        # The issue's acceptance example, as free text and as a structured line.
        for line in ("0.5 count onion", {"name": "onion", "quantity": 0.5, "unit": "count"}):
            got = match_ingredient_lines([line], [])
            assert [(m.name, m.status) for m in got] == [("onion", "missing")]

    def test_an_unshoppable_line_is_never_missing(self) -> None:
        got = match_ingredient_lines(
            [{"name": "water", "quantity": 1, "unit": "l"}, {"name": "ice"}], []
        )
        assert [m.status for m in got] == ["have", "have"]
        assert [m.basis for m in got] == ["assumed", "assumed"]
