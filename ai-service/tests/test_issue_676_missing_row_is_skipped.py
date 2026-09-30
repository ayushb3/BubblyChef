"""Issue #676 -- a matched pantry row (or recipe) deleted before cook confirm
must read as "not found", never as a raise.

Root cause: `deduct_pantry_item`, `get_recipe` and `update_recipe_cooked` read
with `.single()`. PostgREST answers zero rows to a `.single()` with a 406 that
supabase-py / postgrest-py 2.31.0 raises as `APIError` (code PGRST116), so the
`if not result.data` "not found" branch was unreachable and both cook confirm
routes returned 500. The old fakes returned `data=None` for a miss instead of
raising, which is why the suite stayed green.

`_PostgrestLikeClient` here behaves like the real client: a `single()` read
with a filtered count other than one RAISES, every other read returns a list,
and an update returns the rows it matched (`return=representation`).
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from postgrest.exceptions import APIError

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.models.cook import MealCookClaim
from bubbly_chef.repository.supabase_repo import SupabaseRepository

USER = "user-676"
OTHER_USER = "someone-else"

_RECIPES_ROUTE = "bubbly_chef.api.routes.recipes_ai"
_MEALS_ROUTE = "bubbly_chef.api.routes.meals_ai"


# ---------------------------------------------------------------------------
# A fake that behaves like postgrest-py 2.31.0
# ---------------------------------------------------------------------------


class _Result:
    """`data` is a list, except for a `.single()` read, where postgrest-py
    returns the bare row dict."""

    def __init__(self, data: Any) -> None:
        self.data = data


class _PostgrestLikeTable:
    def __init__(self, client: _PostgrestLikeClient, name: str) -> None:
        self._client = client
        self._name = name
        self._filters: dict[str, Any] = {}
        self._limit: int | None = None
        self._single = False
        self._order_field: str | None = None
        self._update_payload: dict[str, Any] | None = None

    def select(self, *_args: Any, **_kwargs: Any) -> _PostgrestLikeTable:
        return self

    def eq(self, column: str, value: Any) -> _PostgrestLikeTable:
        self._filters[column] = value
        return self

    def limit(self, n: int) -> _PostgrestLikeTable:
        self._limit = n
        return self

    def single(self) -> _PostgrestLikeTable:
        self._single = True
        return self

    def order(self, field: str, **_kwargs: Any) -> _PostgrestLikeTable:
        self._order_field = field
        return self

    def update(self, payload: dict[str, Any]) -> _PostgrestLikeTable:
        self._update_payload = payload
        return self

    def _matching(self) -> list[dict[str, Any]]:
        rows = self._client.tables.get(self._name, [])
        return [r for r in rows if all(r.get(k) == v for k, v in self._filters.items())]

    def execute(self) -> _Result:
        if self._update_payload is not None:
            self._client.drop_before_update(self._name)
            matched = self._matching()
            self._client.updates.append(
                (self._name, dict(self._update_payload), dict(self._filters))
            )
            for row in matched:
                row.update(self._update_payload)
            return _Result([dict(r) for r in matched])

        rows = self._matching()
        if self._order_field:
            rows = sorted(rows, key=lambda r: r.get(self._order_field))  # type: ignore[arg-type,return-value]
        if self._single:
            if len(rows) != 1:
                raise APIError(
                    {
                        "message": "JSON object requested, multiple (or no) rows returned",
                        "code": "PGRST116",
                        "details": "The result contains 0 rows",
                        "hint": None,
                    }
                )
            return _Result(dict(rows[0]))
        if self._limit is not None:
            rows = rows[: self._limit]
        return _Result([dict(r) for r in rows])


class _PostgrestLikeClient:
    def __init__(self, tables: dict[str, list[dict[str, Any]]]) -> None:
        self.tables = tables
        # (table, payload, filters) for every update executed.
        self.updates: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
        # Row ids removed just before the next update on that table, to model a
        # row deleted between a read and its write.
        self._vanish_before_update: dict[str, set[str]] = {}

    def table(self, name: str) -> _PostgrestLikeTable:
        return _PostgrestLikeTable(self, name)

    def vanish_before_update(self, table: str, row_id: str) -> None:
        self._vanish_before_update.setdefault(table, set()).add(row_id)

    def drop_before_update(self, table: str) -> None:
        gone = self._vanish_before_update.pop(table, set())
        if gone:
            self.tables[table] = [r for r in self.tables[table] if r.get("id") not in gone]

    def updates_to(self, table: str) -> list[dict[str, Any]]:
        return [p for t, p, _f in self.updates if t == table]


def _real_repo(client: _PostgrestLikeClient) -> SupabaseRepository:
    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = client  # type: ignore[assignment]
    return repo


def _pantry_row(row_id: str, name: str = "eggs", qty: float = 10.0) -> dict[str, Any]:
    return {
        "id": row_id,
        "user_id": USER,
        "name": name,
        "quantity": qty,
        "unit": "count",
        "quantity_base": qty,
        "unit_base": "count",
    }


def _recipe_row(recipe_id: str, times_cooked: int = 0) -> dict[str, Any]:
    return {
        "id": recipe_id,
        "user_id": USER,
        "title": f"Recipe {recipe_id[:4]}",
        "ingredients": [],
        "times_cooked": times_cooked,
    }


def _ids(n: int) -> list[str]:
    return [str(uuid.uuid4()) for _ in range(n)]


# ---------------------------------------------------------------------------
# The fake itself models the real client (so the tests below mean something)
# ---------------------------------------------------------------------------


class TestFakeBehavesLikePostgrest:
    def test_single_on_zero_rows_raises_pgrst116(self) -> None:
        client = _PostgrestLikeClient({"recipes": []})
        with pytest.raises(APIError) as exc:
            client.table("recipes").select("*").eq("id", "x").single().execute()
        assert exc.value.code == "PGRST116"

    def test_limit_read_on_zero_rows_returns_empty_list(self) -> None:
        client = _PostgrestLikeClient({"recipes": []})
        assert client.table("recipes").select("*").eq("id", "x").limit(1).execute().data == []


# ---------------------------------------------------------------------------
# Repository
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestRepositoryMissingRows:
    async def test_deduct_on_absent_row_returns_false_and_writes_nothing(self) -> None:
        client = _PostgrestLikeClient({"pantry_items": []})
        repo = _real_repo(client)

        assert await repo.deduct_pantry_item(USER, str(uuid.uuid4()), 1.0) is False
        assert client.updates == []

    async def test_deduct_whose_row_vanishes_before_the_write_returns_false(self) -> None:
        (row_id,) = _ids(1)
        client = _PostgrestLikeClient({"pantry_items": [_pantry_row(row_id)]})
        client.vanish_before_update("pantry_items", row_id)
        repo = _real_repo(client)

        assert await repo.deduct_pantry_item(USER, row_id, 1.0) is False

    async def test_deduct_on_a_present_row_still_deducts(self) -> None:
        (row_id,) = _ids(1)
        client = _PostgrestLikeClient({"pantry_items": [_pantry_row(row_id, qty=10.0)]})
        repo = _real_repo(client)

        assert await repo.deduct_pantry_item(USER, row_id, 4.0) is True
        assert client.updates_to("pantry_items") == [{"quantity": 6.0, "quantity_base": 6.0}]

    async def test_deduct_does_not_touch_another_users_row(self) -> None:
        (row_id,) = _ids(1)
        row = _pantry_row(row_id)
        row["user_id"] = OTHER_USER
        client = _PostgrestLikeClient({"pantry_items": [row]})

        assert await _real_repo(client).deduct_pantry_item(USER, row_id, 1.0) is False
        assert client.updates == []

    async def test_get_recipe_on_absent_id_returns_none(self) -> None:
        client = _PostgrestLikeClient({"recipes": []})
        assert await _real_repo(client).get_recipe(USER, str(uuid.uuid4())) is None

    async def test_get_recipe_on_present_id_returns_the_row(self) -> None:
        (rid,) = _ids(1)
        client = _PostgrestLikeClient({"recipes": [_recipe_row(rid)]})
        row = await _real_repo(client).get_recipe(USER, rid)
        assert row is not None and row["id"] == rid

    async def test_update_recipe_cooked_on_absent_id_returns_false_and_writes_nothing(
        self,
    ) -> None:
        client = _PostgrestLikeClient({"recipes": []})

        assert await _real_repo(client).update_recipe_cooked(USER, str(uuid.uuid4())) is False
        assert client.updates == []

    async def test_update_recipe_cooked_on_present_id_returns_true_and_increments(self) -> None:
        (rid,) = _ids(1)
        client = _PostgrestLikeClient({"recipes": [_recipe_row(rid, times_cooked=2)]})

        assert await _real_repo(client).update_recipe_cooked(USER, rid) is True
        (payload,) = client.updates_to("recipes")
        assert payload["times_cooked"] == 3

    async def test_update_recipe_cooked_whose_row_vanishes_before_the_write_returns_false(
        self,
    ) -> None:
        (rid,) = _ids(1)
        client = _PostgrestLikeClient({"recipes": [_recipe_row(rid)]})
        client.vanish_before_update("recipes", rid)

        assert await _real_repo(client).update_recipe_cooked(USER, rid) is False

    async def test_meal_with_a_dish_whose_recipe_is_gone_gives_empty_recipe(self) -> None:
        meal_id, gone_id = _ids(2)
        client = _PostgrestLikeClient(
            {
                "meals": [{"id": meal_id, "user_id": USER, "title": "Dinner"}],
                "meal_dishes": [
                    {
                        "meal_id": meal_id,
                        "user_id": USER,
                        "role": "main",
                        "position": 0,
                        "recipe_id": gone_id,
                    }
                ],
                "recipes": [],
            }
        )

        result = await _real_repo(client).get_meal_with_dishes(USER, meal_id)

        assert result is not None
        assert result["dishes"][0]["recipe"] == {}
        assert result["dishes"][0]["recipe_id"] == gone_id


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@pytest.fixture
def app() -> Any:
    @asynccontextmanager
    async def _noop_lifespan(_app: Any) -> AsyncGenerator[None, None]:
        yield

    _app = create_app()
    _app.router.lifespan_context = _noop_lifespan

    async def _fake_user() -> str:
        return USER

    _app.dependency_overrides[get_current_user_id] = _fake_user
    return _app


@pytest_asyncio.fixture
async def client(app: Any) -> AsyncGenerator[AsyncClient, None]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _repo_over(fake: _PostgrestLikeClient) -> MagicMock:
    """A repo whose read/write methods are the REAL ones over the fake client."""
    real = _real_repo(fake)
    repo = MagicMock()
    repo.get_recipe = real.get_recipe
    repo.deduct_pantry_item = real.deduct_pantry_item
    repo.update_recipe_cooked = real.update_recipe_cooked
    return repo


def _deduction(item_id: str, qty: float = 1.0) -> dict[str, Any]:
    return {"pantry_item_id": item_id, "deduct_qty": qty, "base_unit": "count"}


@pytest.mark.asyncio
class TestSingleRecipeConfirm:
    async def test_a_deleted_middle_row_is_skipped_not_a_500(self, client: AsyncClient) -> None:
        recipe_id = str(uuid.uuid4())
        a, b, c = _ids(3)
        fake = _PostgrestLikeClient(
            {
                "recipes": [_recipe_row(recipe_id)],
                "pantry_items": [_pantry_row(a, "bread"), _pantry_row(c, "butter")],
            }
        )
        repo = _repo_over(fake)

        with patch(f"{_RECIPES_ROUTE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/recipes/cook/confirm",
                json={
                    "recipe_id": recipe_id,
                    "deductions": [_deduction(a), _deduction(b), _deduction(c)],
                },
            )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["deductions_applied"] == 2
        assert data["deductions_requested"] == 3
        assert data["deductions_skipped"] == [b]
        pantry_updates = fake.updates_to("pantry_items")
        assert len(pantry_updates) == 2
        assert [p["quantity"] for p in pantry_updates] == [9.0, 9.0]
        assert fake.updates_to("recipes")[0]["times_cooked"] == 1

    async def test_cook_confirm_for_an_absent_recipe_is_404(self, client: AsyncClient) -> None:
        repo = _repo_over(_PostgrestLikeClient({"recipes": [], "pantry_items": []}))

        with patch(f"{_RECIPES_ROUTE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/recipes/cook/confirm",
                json={"recipe_id": str(uuid.uuid4()), "deductions": []},
            )

        assert response.status_code == 404

    async def test_cook_for_an_absent_recipe_is_404(self, client: AsyncClient) -> None:
        repo = _repo_over(_PostgrestLikeClient({"recipes": [], "pantry_items": []}))

        with patch(f"{_RECIPES_ROUTE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/recipes/cook", json={"recipe_id": str(uuid.uuid4())}
            )

        assert response.status_code == 404


def _meal_confirm_repo(
    fake: _PostgrestLikeClient, main_id: str, side_id: str, meal_id: str
) -> MagicMock:
    repo = _repo_over(fake)
    repo.get_meal_with_dishes = AsyncMock(
        return_value={
            "meal": {
                "id": meal_id,
                "user_id": USER,
                "title": "Cozy Dinner",
                "last_cook_ref": None,
                "last_cook_status": None,
            },
            "dishes": [
                {
                    "role": "main",
                    "position": 0,
                    "recipe_id": main_id,
                    "recipe": {"id": main_id, "title": "Pasta"},
                },
                {
                    "role": "side",
                    "position": 1,
                    "recipe_id": side_id,
                    "recipe": {"id": side_id, "title": "Salad"},
                },
            ],
        }
    )
    repo.claim_meal_cook = AsyncMock(
        return_value=MealCookClaim(
            outcome="claimed", times_cooked=1, cooked_on=datetime.now(UTC).date()
        )
    )
    repo.mark_meal_cook_applied = AsyncMock(return_value=None)
    return repo


def _meal_body(
    meal_id: str, cook_ref: str, recipe_ids: list[str], item_ids: list[str]
) -> dict[str, Any]:
    return {
        "meal_id": meal_id,
        "cook_ref": cook_ref,
        "recipe_ids": recipe_ids,
        "deductions": [_deduction(i) for i in item_ids],
    }


@pytest.mark.asyncio
class TestMealConfirm:
    async def test_a_deleted_row_is_skipped_and_the_claim_closes(
        self, client: AsyncClient
    ) -> None:
        meal_id, main_id, side_id = _ids(3)
        a, b, c = _ids(3)
        fake = _PostgrestLikeClient(
            {
                "recipes": [_recipe_row(main_id), _recipe_row(side_id)],
                "pantry_items": [_pantry_row(a), _pantry_row(c)],  # B absent
            }
        )
        repo = _meal_confirm_repo(fake, main_id, side_id, meal_id)

        with patch(f"{_MEALS_ROUTE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook/confirm",
                json=_meal_body(meal_id, "ref-1", [main_id, side_id], [a, b, c]),
            )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["deductions_skipped"] == [b]
        assert data["deductions_applied"] == 2
        assert data["recipes_marked_cooked"] == [main_id, side_id]
        repo.mark_meal_cook_applied.assert_awaited_once_with(USER, meal_id, "ref-1")

    async def test_a_dish_recipe_gone_is_not_marked_and_the_claim_still_closes(
        self, client: AsyncClient
    ) -> None:
        meal_id, main_id, side_id = _ids(3)
        a, c = _ids(2)
        fake = _PostgrestLikeClient(
            {
                "recipes": [_recipe_row(main_id)],  # the side's recipe row is gone
                "pantry_items": [_pantry_row(a), _pantry_row(c)],
            }
        )
        repo = _meal_confirm_repo(fake, main_id, side_id, meal_id)

        with patch(f"{_MEALS_ROUTE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook/confirm",
                json=_meal_body(meal_id, "ref-2", [main_id, side_id], [a, c]),
            )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["deductions_applied"] == 2
        assert data["deductions_skipped"] == []
        assert data["recipes_marked_cooked"] == [main_id]
        repo.mark_meal_cook_applied.assert_awaited_once_with(USER, meal_id, "ref-2")

    async def test_a_raise_still_leaves_the_claim_claimed(self, client: AsyncClient) -> None:
        """Guard, passes on main too: a genuine failure (not a missing row)
        keeps the claim 'claimed' so a retry can't re-deduct. This PR must not
        release claims."""
        meal_id, main_id, side_id = _ids(3)
        a, b, c = _ids(3)
        fake = _PostgrestLikeClient(
            {
                "recipes": [_recipe_row(main_id), _recipe_row(side_id)],
                "pantry_items": [_pantry_row(a), _pantry_row(b), _pantry_row(c)],
            }
        )
        repo = _meal_confirm_repo(fake, main_id, side_id, meal_id)
        real_deduct = repo.deduct_pantry_item

        async def _flaky_deduct(user_id: str, item_id: str, deduct_qty: float) -> bool:
            if item_id == b:
                raise ConnectionError("database went away")
            return bool(await real_deduct(user_id=user_id, item_id=item_id, deduct_qty=deduct_qty))

        repo.deduct_pantry_item = _flaky_deduct

        with patch(f"{_MEALS_ROUTE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook/confirm",
                json=_meal_body(meal_id, "ref-3", [main_id, side_id], [a, b, c]),
            )

        assert response.status_code == 500
        pantry_updates = fake.updates_to("pantry_items")
        assert len(pantry_updates) == 1  # A landed, C was never attempted
        repo.mark_meal_cook_applied.assert_not_awaited()
