"""Issue #784: a deterministic ingredient-to-pantry match for the recipe food tags.

The recipe card tags every ingredient line have / low / missing. The only other
thing that matches a recipe against the pantry is the cook endpoint, which is
LLM-backed and builds a deduction proposal, so drawing tags from it would spend
a model call per recipe view. This route reuses the cook matcher's synonym path
and base-unit lot sum (#356) with no model call and no writes, and reads only
the caller's pantry.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.models.pantry import PantryItem
from bubbly_chef.services.ingredient_match import match_ingredient_lines

USER = "user-784"
_ROUTE = "bubbly_chef.api.routes.pantry"


def _pantry(name: str, qty: float = 3.0, unit: str = "item", expires_in: int | None = 30) -> PantryItem:
    return PantryItem(
        name=name,
        quantity=qty,
        unit=unit,
        expiry_date=None
        if expires_in is None
        else (datetime.now(UTC) + timedelta(days=expires_in)).date(),
    )


def _line(name: str, quantity: float | None = None, unit: str | None = None) -> dict[str, Any]:
    return {"name": name, "quantity": quantity, "unit": unit}


def _statuses(lines: list[Any], pantry: list[PantryItem]) -> list[str]:
    return [m.status for m in match_ingredient_lines(lines, pantry)]


class TestStatuses:
    def test_have_low_and_missing(self) -> None:
        pantry = [_pantry("flour", 500, "g"), _pantry("butter", 50, "g")]
        got = match_ingredient_lines(
            [
                _line("flour", 200, "g"),  # 500 >= 200
                _line("butter", 100, "g"),  # 50 < 100
                _line("saffron", 1, "g"),  # not stocked
            ],
            pantry,
        )
        assert [m.status for m in got] == ["have", "low", "missing"]
        assert [m.name for m in got] == ["flour", "butter", "saffron"]
        assert got[0].pantry_food == "flour"
        assert got[1].pantry_food == "butter"
        assert got[2].pantry_food is None

    def test_low_converts_within_the_same_dimension(self) -> None:
        pantry = [_pantry("flour", 1, "kg")]
        assert _statuses([_line("flour", 800, "g")], pantry) == ["have"]
        assert _statuses([_line("flour", 1200, "g")], pantry) == ["low"]

    def test_lots_of_one_food_are_summed(self) -> None:
        # Two rows of onion (2 + 3) cover 4 even though neither does alone (#356).
        pantry = [_pantry("onion", 2), _pantry("onion", 3, expires_in=10)]
        assert _statuses([_line("onion", 4, "item")], pantry) == ["have"]
        assert _statuses([_line("onion", 6, "item")], pantry) == ["low"]

    def test_two_lines_drawing_on_one_food_share_its_stock(self) -> None:
        pantry = [_pantry("onion", 3)]
        assert _statuses([_line("onion", 2, "item"), _line("onion", 2, "item")], pantry) == [
            "have",
            "low",
        ]

    def test_two_lines_of_one_food_each_keep_their_own_status(self) -> None:
        # "2 eggs" takes both eggs, so "1 egg" is the one that is short; the
        # client aligns by row, so each line must carry its own answer.
        got = match_ingredient_lines(["2 eggs", "1 egg"], [_pantry("eggs", 2)])
        assert [m.status for m in got] == ["have", "low"]
        assert got[1].shortfall == pytest.approx(1)
        assert got[1].pantry_qty_available == pytest.approx(0)

    def test_expired_only_stock_matches_the_to_buy_list_not_the_cook_flow(self) -> None:
        # Deliberate (#784): the tags agree with the meal screen's "N to buy" line,
        # which drops expired rows, so expired-only stock reads missing.
        got = match_ingredient_lines([_line("milk", 1, "l")], [_pantry("milk", 1, "l", expires_in=-3)])
        assert got[0].status == "missing"

    def test_uses_the_synonym_path(self) -> None:
        assert _statuses([_line("spaghetti", 200, "g")], [_pantry("pasta", 500, "g")]) == ["have"]

    def test_a_line_with_no_amount_is_have_when_the_food_is_present(self) -> None:
        assert _statuses([_line("basil")], [_pantry("basil", 1, "bunch")]) == ["have"]

    def test_an_incompatible_unit_counts_as_have_when_the_food_is_present(self) -> None:
        # Pantry counts eggs; the recipe measures them in grams: not comparable.
        assert _statuses([_line("eggs", 100, "g")], [_pantry("eggs", 6)]) == ["have"]

    def test_to_taste_lines_are_have(self) -> None:
        got = match_ingredient_lines(
            [_line("salt and pepper", None, "to taste"), _line("basil", None, "to taste")],
            [_pantry("basil", 1, "bunch")],
        )
        assert [m.status for m in got] == ["have", "have"]

    def test_a_staple_not_in_the_pantry_is_have_like_the_cook_flow_assumes(self) -> None:
        got = match_ingredient_lines([_line("salt", 1, "tsp")], [])
        assert got[0].status == "have"
        assert got[0].pantry_food is None
        assert got[0].basis == "assumed"

    def test_basis_and_amounts_tell_the_tag_why(self) -> None:
        got = match_ingredient_lines(
            [
                _line("butter", 150, "g"),  # 50 g on hand
                _line("flour", 100, "g"),
                _line("salt and pepper", None, "to taste"),
                _line("saffron", 1, "g"),
            ],
            [_pantry("butter", 50, "g"), _pantry("flour", 500, "g")],
        )
        assert [m.basis for m in got] == ["pantry", "pantry", "to_taste", "none"]
        assert got[0].shortfall == pytest.approx(100)
        assert got[0].pantry_qty_available == pytest.approx(50)
        assert got[1].shortfall is None

    def test_expired_or_empty_stock_does_not_count(self) -> None:
        pantry = [_pantry("eggs", 0), _pantry("pasta", 500, "g", expires_in=-2)]
        assert _statuses([_line("eggs", 2, "item"), _line("pasta", 100, "g")], pantry) == [
            "missing",
            "missing",
        ]

    def test_string_lines_are_parsed(self) -> None:
        assert _statuses(["200 g flour", "1 saffron"], [_pantry("flour", 500, "g")]) == [
            "have",
            "missing",
        ]

    def test_one_result_per_line_in_order_even_with_a_blank_line(self) -> None:
        got = match_ingredient_lines(
            [_line("saffron", 1, "g"), _line("  "), _line("flour", 100, "g")],
            [_pantry("flour", 500, "g")],
        )
        assert [m.status for m in got] == ["missing", "missing", "have"]
        assert [m.name for m in got] == ["saffron", "", "flour"]

    def test_empty_input_gives_empty_output(self) -> None:
        assert match_ingredient_lines([], [_pantry("flour")]) == []


def _repo(pantry: list[PantryItem]) -> MagicMock:
    repo = MagicMock()
    repo.get_all_pantry_items = AsyncMock(return_value=pantry)
    return repo


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
    async def test_returns_one_status_per_line(self, client: AsyncClient, monkeypatch) -> None:
        repo = _repo([_pantry("flour", 500, "g"), _pantry("butter", 50, "g")])
        monkeypatch.setattr(f"{_ROUTE}.get_repository", AsyncMock(return_value=repo))
        res = await client.post(
            "/v1/pantry/match-ingredients",
            json={
                "ingredients": [
                    {"name": "flour", "quantity": 200, "unit": "g"},
                    {"name": "butter", "quantity": 100, "unit": "g"},
                    "1 saffron",
                ]
            },
        )
        assert res.status_code == 200
        body = res.json()["matches"]
        assert [m["status"] for m in body] == ["have", "low", "missing"]
        assert body[0]["pantry_food"] == "flour"
        assert body[2]["pantry_food"] is None

    @pytest.mark.asyncio
    async def test_each_match_carries_exactly_the_fields_the_client_reads(
        self, client: AsyncClient, monkeypatch
    ) -> None:
        # The Next.js client (lib/api/ingredient-match.ts) reads these keys; a rename
        # here must fail a test rather than silently drop the tags.
        repo = _repo([_pantry("eggs", 2)])
        monkeypatch.setattr(f"{_ROUTE}.get_repository", AsyncMock(return_value=repo))
        res = await client.post(
            "/v1/pantry/match-ingredients", json={"ingredients": ["2 eggs", "1 egg"]}
        )
        matches = res.json()["matches"]
        assert all(
            set(m) == {"name", "status", "pantry_food", "basis", "pantry_qty_available", "shortfall"}
            for m in matches
        )
        assert matches[0]["name"] == "eggs"  # the server's parsed name, not the line "2 eggs"
        assert [m["status"] for m in matches] == ["have", "low"]

    @pytest.mark.asyncio
    async def test_reads_only_the_callers_pantry_and_writes_nothing(
        self, client: AsyncClient, monkeypatch
    ) -> None:
        repo = _repo([_pantry("flour", 500, "g")])
        monkeypatch.setattr(f"{_ROUTE}.get_repository", AsyncMock(return_value=repo))
        res = await client.post(
            "/v1/pantry/match-ingredients", json={"ingredients": [_line("flour", 1, "g")]}
        )
        assert res.status_code == 200
        repo.get_all_pantry_items.assert_awaited_once_with(USER)
        assert {c[0] for c in repo.method_calls} == {"get_all_pantry_items"}

    @pytest.mark.asyncio
    async def test_never_touches_the_ai_manager(self, client: AsyncClient, monkeypatch) -> None:
        import bubbly_chef.api.deps as deps_mod
        from bubbly_chef.ai.manager import AIManager

        def _boom(*_a: Any, **_k: Any) -> Any:
            raise AssertionError("AIManager must not be used by the ingredient match")

        # Constructing one, fetching the shared one, or calling any model entry point fails.
        monkeypatch.setattr(AIManager, "__init__", _boom)
        for attr in (
            "get_available_provider",
            "complete",
            "vision_complete",
            "video_complete",
            "complete_with_tools",
            "stream_complete",
        ):
            monkeypatch.setattr(AIManager, attr, _boom)
        monkeypatch.setattr(deps_mod, "get_ai_manager", _boom)
        monkeypatch.setattr(
            f"{_ROUTE}.get_repository", AsyncMock(return_value=_repo([_pantry("flour", 5, "g")]))
        )
        res = await client.post(
            "/v1/pantry/match-ingredients",
            json={"ingredients": [_line("flour", 1, "g"), _line("saffron", 1, "g")]},
        )
        assert res.status_code == 200

    @pytest.mark.asyncio
    async def test_rejects_an_oversized_list(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setattr(f"{_ROUTE}.get_repository", AsyncMock(return_value=_repo([])))
        res = await client.post(
            "/v1/pantry/match-ingredients",
            json={"ingredients": [_line("flour")] * 201},
        )
        assert res.status_code == 422

    @pytest.mark.asyncio
    async def test_requires_auth(self) -> None:
        app = create_app()  # no dependency override
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            res = await ac.post("/v1/pantry/match-ingredients", json={"ingredients": []})
        assert res.status_code in (401, 403)
