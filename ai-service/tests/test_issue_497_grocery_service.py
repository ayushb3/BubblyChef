"""Issue #497 (Spec B.5, backend): regenerate + add-from-meal, end to end.

Three layers, none touching a live DB or model:

- the repository's grocery methods against an in-memory PostgREST-shaped fake,
  including the cross-user cases (user B can't read, change or delete user A's
  list or lines -- the service_role client bypasses RLS, so the `user_id`
  scoping in every query *is* the isolation on this path);
- `services/grocery.py` orchestration (the merge semantics through the repo);
- the two HTTP routes.

The RLS policies themselves (the Next.js path) are pinned separately in
`test_issue_497_migration_rls.py`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.domain.grocery import food_key
from bubbly_chef.main import create_app
from bubbly_chef.repository.supabase_repo import SupabaseRepository

ALICE = "user-alice"
BOB = "user-bob"
_ROUTE = "bubbly_chef.api.routes.grocery"


# ---------------------------------------------------------------------------
# An in-memory stand-in for the supabase-py client (filters, upsert, update...)
# ---------------------------------------------------------------------------


class _Result:
    def __init__(self, data: list[dict[str, Any]]) -> None:
        self.data = data


class _Query:
    def __init__(self, store: dict[str, list[dict[str, Any]]], table: str) -> None:
        self._rows = store.setdefault(table, [])
        self._table = table
        self._eq: list[tuple[str, Any]] = []
        self._in: list[tuple[str, list[Any]]] = []
        self._gte: list[tuple[str, Any]] = []
        self._op = "select"
        self._payload: Any = None
        self._on_conflict: list[str] = []
        self._ignore_dupes = False

    def select(self, *_a: Any, **_k: Any) -> _Query:
        self._op = "select"
        return self

    def insert(self, payload: Any) -> _Query:
        self._op, self._payload = "insert", payload
        return self

    def upsert(self, payload: Any, on_conflict: str = "", ignore_duplicates: bool = False) -> _Query:
        self._op, self._payload = "upsert", payload
        self._on_conflict = [c.strip() for c in on_conflict.split(",") if c.strip()]
        self._ignore_dupes = ignore_duplicates
        return self

    def update(self, payload: dict[str, Any]) -> _Query:
        self._op, self._payload = "update", payload
        return self

    def delete(self) -> _Query:
        self._op = "delete"
        return self

    def eq(self, col: str, val: Any) -> _Query:
        self._eq.append((col, val))
        return self

    def in_(self, col: str, vals: list[Any]) -> _Query:
        self._in.append((col, list(vals)))
        return self

    def gte(self, col: str, val: Any) -> _Query:
        self._gte.append((col, val))
        return self

    def order(self, *_a: Any, **_k: Any) -> _Query:
        return self

    def limit(self, *_a: Any, **_k: Any) -> _Query:
        return self

    def _matches(self, row: dict[str, Any]) -> bool:
        return (
            all(row.get(c) == v for c, v in self._eq)
            and all(row.get(c) in vs for c, vs in self._in)
            and all(str(row.get(c)) >= str(v) for c, v in self._gte)
        )

    def execute(self) -> _Result:
        if self._op == "select":
            return _Result([dict(r) for r in self._rows if self._matches(r)])
        if self._op in ("insert", "upsert"):
            out = []
            for raw in self._payload if isinstance(self._payload, list) else [self._payload]:
                row = {"id": str(uuid.uuid4()), "checked": False, **raw}
                dupe = (
                    next(
                        (
                            r
                            for r in self._rows
                            if self._on_conflict
                            and all(r.get(c) == row.get(c) for c in self._on_conflict)
                        ),
                        None,
                    )
                    if self._op == "upsert"
                    else None
                )
                if dupe is not None:
                    if not self._ignore_dupes:
                        dupe.update(raw)
                        out.append(dict(dupe))
                    continue
                self._rows.append(row)
                out.append(dict(row))
            return _Result(out)
        if self._op == "update":
            hit = [r for r in self._rows if self._matches(r)]
            for r in hit:
                r.update(self._payload)
            return _Result([dict(r) for r in hit])
        hit = [r for r in self._rows if self._matches(r)]
        self._rows[:] = [r for r in self._rows if not self._matches(r)]
        return _Result([dict(r) for r in hit])


class _FakeClient:
    def __init__(self) -> None:
        self.store: dict[str, list[dict[str, Any]]] = {}

    def table(self, name: str) -> _Query:
        return _Query(self.store, name)


@pytest.fixture
def repo() -> SupabaseRepository:
    r = SupabaseRepository.__new__(SupabaseRepository)
    r.client = _FakeClient()  # type: ignore[assignment]
    return r


def _fake(repo: SupabaseRepository) -> _FakeClient:
    return repo.client  # type: ignore[return-value]


def _row(list_id: str, user: str, name: str, **kw: Any) -> dict[str, Any]:
    return {
        "list_id": list_id,
        "user_id": user,
        "name": name,
        "name_key": food_key(name),
        "quantity": None,
        "unit": None,
        "category": "other",
        "source": "manual",
        "source_ref": None,
        **kw,
    }


# ---------------------------------------------------------------------------
# Repository: user scoping
# ---------------------------------------------------------------------------


class TestRepositoryUserScoping:
    @pytest.mark.asyncio
    async def test_one_list_per_user_get_or_create_is_stable(self, repo: SupabaseRepository) -> None:
        a1 = await repo.get_or_create_grocery_list(ALICE)
        a2 = await repo.get_or_create_grocery_list(ALICE)
        b1 = await repo.get_or_create_grocery_list(BOB)
        assert a1["id"] == a2["id"] != b1["id"]
        assert len(_fake(repo).store["grocery_lists"]) == 2

    @pytest.mark.asyncio
    async def test_bob_cannot_read_alices_lines(self, repo: SupabaseRepository) -> None:
        alice = await repo.get_or_create_grocery_list(ALICE)
        await repo.insert_grocery_items(ALICE, alice["id"], [_row(alice["id"], ALICE, "eggs")])
        # Bob asking for Alice's list id gets nothing.
        assert await repo.get_grocery_items(BOB, alice["id"]) == []
        assert [r["name"] for r in await repo.get_grocery_items(ALICE, alice["id"])] == ["eggs"]

    @pytest.mark.asyncio
    async def test_bob_cannot_update_or_delete_alices_lines(self, repo: SupabaseRepository) -> None:
        alice = await repo.get_or_create_grocery_list(ALICE)
        await repo.insert_grocery_items(ALICE, alice["id"], [_row(alice["id"], ALICE, "eggs")])
        line_id = _fake(repo).store["grocery_items"][0]["id"]

        await repo.update_grocery_item(BOB, line_id, {"checked": True})
        await repo.delete_grocery_items(BOB, [line_id])

        (line,) = _fake(repo).store["grocery_items"]
        assert line["checked"] is False  # untouched
        await repo.delete_grocery_items(ALICE, [line_id])
        assert _fake(repo).store["grocery_items"] == []

    @pytest.mark.asyncio
    async def test_insert_refuses_rows_stamped_for_another_user(
        self, repo: SupabaseRepository
    ) -> None:
        alice = await repo.get_or_create_grocery_list(ALICE)
        # A row claiming to be Bob's, written through Alice's call, is re-stamped
        # to Alice rather than trusted.
        await repo.insert_grocery_items(ALICE, alice["id"], [_row(alice["id"], BOB, "kale")])
        assert {r["user_id"] for r in _fake(repo).store["grocery_items"]} == {ALICE}

    @pytest.mark.asyncio
    async def test_bob_cannot_write_into_alices_list(self, repo: SupabaseRepository) -> None:
        alice = await repo.get_or_create_grocery_list(ALICE)
        with pytest.raises(LookupError):
            await repo.insert_grocery_items(BOB, alice["id"], [_row(alice["id"], BOB, "kale")])
        assert _fake(repo).store.get("grocery_items", []) == []

    @pytest.mark.asyncio
    async def test_duplicate_food_on_one_list_is_ignored_not_doubled(
        self, repo: SupabaseRepository
    ) -> None:
        alice = await repo.get_or_create_grocery_list(ALICE)
        await repo.insert_grocery_items(ALICE, alice["id"], [_row(alice["id"], ALICE, "eggs")])
        await repo.insert_grocery_items(ALICE, alice["id"], [_row(alice["id"], ALICE, "eggs")])
        assert len(_fake(repo).store["grocery_items"]) == 1

    @pytest.mark.asyncio
    async def test_depletion_events_are_only_the_callers(self, repo: SupabaseRepository) -> None:
        ev = {"outcome": "used", "item_name": "butter", "created_at": "2026-09-29T10:00:00+00:00"}
        _fake(repo).store["pantry_events"] = [
            {**ev, "user_id": ALICE},
            {**ev, "user_id": BOB, "item_name": "secret sauce"},
        ]
        got = await repo.get_pantry_depletion_events(ALICE, "2026-09-01T00:00:00+00:00")
        assert [e["item_name"] for e in got] == ["butter"]


# ---------------------------------------------------------------------------
# Service: regenerate + add-from-meal through the repository
# ---------------------------------------------------------------------------


def _pantry_row(user: str, name: str, qty: float, unit: str = "item", **kw: Any) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "user_id": user,
        "name": name,
        "category": kw.pop("category", "other"),
        "location": "pantry",
        "quantity": qty,
        "unit": unit,
        "added_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
        **kw,
    }


def _days(n: int) -> str:
    return (datetime.now(UTC).date() + timedelta(days=n)).isoformat()


@pytest_asyncio.fixture
async def seeded(repo: SupabaseRepository) -> SupabaseRepository:
    _fake(repo).store["pantry_items"] = [
        _pantry_row(ALICE, "eggs", 0, category="dairy"),
        _pantry_row(ALICE, "milk", 1, "L", expiry_date=_days(1), category="dairy"),
        _pantry_row(ALICE, "rice", 3, "kg", expiry_date=_days(300)),
        _pantry_row(BOB, "caviar", 0),  # someone else's -- must never appear
    ]
    _fake(repo).store["pantry_events"] = [
        {
            "user_id": ALICE,
            "item_name": "butter",
            "outcome": "used",
            "quantity": 250,
            "unit": "g",
            "created_at": (datetime.now(UTC) - timedelta(days=2)).isoformat(),
        }
    ]
    return repo


class TestRegenerate:
    @pytest.mark.asyncio
    async def test_builds_the_list_from_pantry_and_events(self, seeded: SupabaseRepository) -> None:
        from bubbly_chef.services.grocery import regenerate_grocery_list

        result = await regenerate_grocery_list(seeded, ALICE)

        assert {i["name"]: i["source"] for i in result.items} == {
            "eggs": "depleted",
            "milk": "expiring",
            "butter": "depleted",
        }
        assert result.added == 3 and result.updated == 0 and result.removed == 0
        assert all(i["user_id"] == ALICE for i in _fake(seeded).store["grocery_items"])

    @pytest.mark.asyncio
    async def test_regenerate_keeps_checked_and_manual_and_refreshes_the_rest(
        self, seeded: SupabaseRepository
    ) -> None:
        from bubbly_chef.services.grocery import regenerate_grocery_list

        await regenerate_grocery_list(seeded, ALICE)
        store = _fake(seeded).store["grocery_items"]
        list_id = store[0]["list_id"]
        next(r for r in store if r["name"] == "eggs")["checked"] = True  # got it
        await seeded.insert_grocery_items(
            ALICE, list_id, [_row(list_id, ALICE, "paper towels", source="manual")]
        )
        # The pantry moves on: milk is bought fresh, butter restocked.
        _fake(seeded).store["pantry_items"] = [
            _pantry_row(ALICE, "milk", 2, "L", expiry_date=_days(9)),
            _pantry_row(ALICE, "butter", 2, "item", expiry_date=_days(30)),
            _pantry_row(ALICE, "flour", 0),
        ]

        result = await regenerate_grocery_list(seeded, ALICE)

        names = {i["name"]: i for i in result.items}
        assert set(names) == {"eggs", "paper towels", "flour"}
        assert names["eggs"]["checked"] is True  # kept
        assert names["paper towels"]["source"] == "manual"  # kept
        assert result.added == 1 and result.removed == 2  # flour in; milk, butter out

    @pytest.mark.asyncio
    async def test_regenerate_twice_is_a_no_op(self, seeded: SupabaseRepository) -> None:
        from bubbly_chef.services.grocery import regenerate_grocery_list

        await regenerate_grocery_list(seeded, ALICE)
        again = await regenerate_grocery_list(seeded, ALICE)
        assert (again.added, again.updated, again.removed) == (0, 0, 0)
        assert len(_fake(seeded).store["grocery_items"]) == 3

    @pytest.mark.asyncio
    async def test_bobs_list_is_independent(self, seeded: SupabaseRepository) -> None:
        from bubbly_chef.services.grocery import regenerate_grocery_list

        await regenerate_grocery_list(seeded, ALICE)
        bob = await regenerate_grocery_list(seeded, BOB)
        assert [i["name"] for i in bob.items] == ["caviar"]


def _meal(user: str = ALICE) -> dict[str, Any]:
    def recipe(title: str, ings: list[Any]) -> dict[str, Any]:
        return {"id": f"r-{title}", "title": title, "servings": 2, "ingredients": ings}

    return {
        "meal": {"id": "meal-1", "user_id": user, "title": "Pasta night", "servings": 2},
        "dishes": [
            {
                "role": "main",
                "position": 0,
                "recipe_id": "r-main",
                "recipe": recipe(
                    "Pasta",
                    [
                        {"name": "spaghetti", "quantity": 200, "unit": "g"},
                        {"name": "fresh basil", "quantity": 1, "unit": "bunch"},
                        {"name": "salt", "quantity": 1, "unit": "tsp"},  # staple: assumed
                        {"name": "water", "quantity": 2, "unit": "l"},  # never to buy
                        {"name": "eggs", "quantity": 2, "unit": "item"},
                    ],
                ),
            },
            {
                "role": "side",
                "position": 1,
                "recipe_id": "r-side",
                "recipe": recipe(
                    "Salad",
                    [{"name": "fresh basil", "quantity": 1, "unit": "bunch"}, "1 cucumber"],
                ),
            },
        ],
    }


class TestAddFromMeal:
    @pytest.mark.asyncio
    async def test_adds_only_what_the_pantry_lacks_once(self, seeded: SupabaseRepository) -> None:
        from bubbly_chef.services.grocery import add_meal_missing_to_list

        _fake(seeded).store["pantry_items"].append(_pantry_row(ALICE, "eggs", 6, expiry_date=_days(9)))
        with patch.object(seeded, "get_meal_with_dishes", AsyncMock(return_value=_meal())):
            result = await add_meal_missing_to_list(seeded, ALICE, "meal-1")

        assert sorted(result.to_buy) == ["cucumber", "fresh basil", "spaghetti"]
        assert sorted(result.added) == ["cucumber", "fresh basil", "spaghetti"]
        assert result.already_on_list == []
        rows = {r["name"]: r for r in _fake(seeded).store["grocery_items"]}
        assert {r["source"] for r in rows.values()} == {"meal"}
        assert rows["spaghetti"]["source_ref"] == "meal-1"

    @pytest.mark.asyncio
    async def test_food_already_on_the_list_is_reported_not_duplicated(
        self, seeded: SupabaseRepository
    ) -> None:
        from bubbly_chef.services.grocery import add_meal_missing_to_list

        list_id = (await seeded.get_or_create_grocery_list(ALICE))["id"]
        await seeded.insert_grocery_items(
            ALICE, list_id, [_row(list_id, ALICE, "spaghetti", source="manual")]
        )
        with patch.object(seeded, "get_meal_with_dishes", AsyncMock(return_value=_meal())):
            result = await add_meal_missing_to_list(seeded, ALICE, "meal-1")
        assert "spaghetti" in result.already_on_list
        assert "spaghetti" not in result.added
        assert sum(1 for r in _fake(seeded).store["grocery_items"] if r["name"] == "spaghetti") == 1

    @pytest.mark.asyncio
    async def test_unknown_or_foreign_meal_is_not_found(self, seeded: SupabaseRepository) -> None:
        from bubbly_chef.services.grocery import MealNotFoundError, add_meal_missing_to_list

        # The repo's scoped read returns None for a meal that isn't this user's.
        with patch.object(seeded, "get_meal_with_dishes", AsyncMock(return_value=None)):
            with pytest.raises(MealNotFoundError):
                await add_meal_missing_to_list(seeded, BOB, "meal-1")
        assert _fake(seeded).store.get("grocery_items", []) == []

    @pytest.mark.asyncio
    async def test_regenerate_drops_a_meal_line_once_the_food_is_stocked(
        self, seeded: SupabaseRepository
    ) -> None:
        from bubbly_chef.services.grocery import add_meal_missing_to_list, regenerate_grocery_list

        with patch.object(seeded, "get_meal_with_dishes", AsyncMock(return_value=_meal())):
            await add_meal_missing_to_list(seeded, ALICE, "meal-1")
        _fake(seeded).store["pantry_items"].append(
            _pantry_row(ALICE, "spaghetti", 500, "g", expiry_date=_days(200))
        )
        result = await regenerate_grocery_list(seeded, ALICE)
        assert "spaghetti" not in {i["name"] for i in result.items}
        assert "fresh basil" in {i["name"] for i in result.items}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@pytest.fixture
def app():
    _app = create_app()

    async def _fake_user_id() -> str:
        return ALICE

    _app.dependency_overrides[get_current_user_id] = _fake_user_id
    return _app


@pytest_asyncio.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


class TestRoutes:
    @pytest.mark.asyncio
    async def test_regenerate_route_scopes_to_the_authenticated_user(
        self, client: AsyncClient, seeded: SupabaseRepository
    ) -> None:
        with patch(f"{_ROUTE}.get_repository", AsyncMock(return_value=seeded)):
            res = await client.post("/v1/grocery/regenerate")
        assert res.status_code == 200
        body = res.json()
        assert body["added"] == 3
        assert {i["name"] for i in body["items"]} == {"eggs", "milk", "butter"}
        assert "user_id" not in body["items"][0]

    @pytest.mark.asyncio
    async def test_from_meal_route(self, client: AsyncClient, seeded: SupabaseRepository) -> None:
        with (
            patch(f"{_ROUTE}.get_repository", AsyncMock(return_value=seeded)),
            patch.object(seeded, "get_meal_with_dishes", AsyncMock(return_value=_meal())),
        ):
            res = await client.post("/v1/grocery/from-meal", json={"meal_id": "meal-1"})
        assert res.status_code == 200
        body = res.json()
        assert "spaghetti" in body["added"]
        assert body["to_buy"] and body["items"]

    @pytest.mark.asyncio
    async def test_from_meal_404_when_the_meal_is_not_the_users(
        self, client: AsyncClient, seeded: SupabaseRepository
    ) -> None:
        with (
            patch(f"{_ROUTE}.get_repository", AsyncMock(return_value=seeded)),
            patch.object(seeded, "get_meal_with_dishes", AsyncMock(return_value=None)),
        ):
            res = await client.post("/v1/grocery/from-meal", json={"meal_id": "not-mine"})
        assert res.status_code == 404

    @pytest.mark.asyncio
    async def test_routes_require_auth(self) -> None:
        app = create_app()  # no dependency override
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            assert (await ac.post("/v1/grocery/regenerate")).status_code in (401, 403)
            r = await ac.post("/v1/grocery/from-meal", json={"meal_id": "x"})
            assert r.status_code in (401, 403)

