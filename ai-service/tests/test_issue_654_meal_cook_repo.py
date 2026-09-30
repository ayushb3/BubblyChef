"""Issue #654 §8 S4: `SupabaseRepository.claim_meal_cook` and
`mark_meal_cook_applied`, plus `get_meal_with_dishes`'s new `recipe_id` key
(N1).

Follows the fake-client pattern from `test_issue_651_recent_cuisines.py` /
`test_issue_493_saved_recipe_search.py` (a fake `.table().select()/.update()
.eq()...execute()` chain that records every call) rather than hitting a real
Supabase instance.

The `claim_meal_cook` fake models exactly one `meals` row and lets a test
inject a "race": the FIRST `.execute()` call (the repo method's own initial
read) sees the row as it is when `_repo_for` is constructed; every call
after that sees `race_row` instead, if one was supplied. This is what lets a
test express "the update's own `.or_` filter loses a race that landed
between this method's read and its write" without threading a real
concurrent request through the fake.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from bubbly_chef.repository.supabase_repo import SupabaseRepository


class _Result:
    def __init__(self, data: list[dict[str, Any]]) -> None:
        self.data = data


class _FakeQuery:
    def __init__(self, store: "_FakeMealsStore") -> None:
        self.store = store
        self.op: str | None = None
        self.filters: dict[str, Any] = {}
        self.or_filter: str | None = None
        self.payload: dict[str, Any] | None = None

    def select(self, *_args: Any, **_kwargs: Any) -> "_FakeQuery":
        self.op = "select"
        return self

    def update(self, payload: dict[str, Any]) -> "_FakeQuery":
        self.op = "update"
        self.payload = payload
        return self

    def eq(self, field: str, value: Any) -> "_FakeQuery":
        self.filters[field] = value
        self.store.eq_calls.append((field, value))
        return self

    def or_(self, filter_str: str) -> "_FakeQuery":
        self.or_filter = filter_str
        self.store.or_calls.append(filter_str)
        return self

    def execute(self) -> _Result:
        return self.store._execute(self)


_NO_RACE = object()


class _FakeMealsStore:
    def __init__(self, row: dict[str, Any] | None, race_row: Any = _NO_RACE) -> None:
        self.row = row
        self._race_row = None if race_row is _NO_RACE else race_row
        self._race_armed = race_row is not _NO_RACE
        self.eq_calls: list[tuple[str, Any]] = []
        self.or_calls: list[str] = []
        self.update_calls: list[dict[str, Any]] = []
        self.execute_count = 0

    def table(self, name: str) -> _FakeQuery:
        assert name == "meals"
        return _FakeQuery(self)

    def _execute(self, query: _FakeQuery) -> _Result:
        is_first_call = self.execute_count == 0
        self.execute_count += 1
        row = self.row

        if is_first_call and self._race_armed:
            # From the SECOND call onward, everything sees the raced state --
            # simulating a concurrent request that landed between this
            # method's own read and its write.
            self.row = self._race_row

        if row is None:
            return _Result([])
        for field, value in query.filters.items():
            if row.get(field) != value:
                return _Result([])

        if query.op == "update":
            assert query.payload is not None
            if query.or_filter is not None and not self._or_matches(query.or_filter, row):
                return _Result([])
            row = self.row if self.row is not None else row
            row.update(query.payload)
            self.update_calls.append(dict(query.payload))
            return _Result([dict(row)])

        return _Result([dict(row)])

    @staticmethod
    def _or_matches(filter_str: str, row: dict[str, Any]) -> bool:
        for cond in filter_str.split(","):
            field, op, value = cond.split(".", 2)
            row_value = row.get(field)
            if op == "is" and value == "null" and row_value is None:
                return True
            if op == "neq" and row_value != value:
                return True
        return False


def _repo_for(store: _FakeMealsStore) -> SupabaseRepository:
    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = store  # type: ignore[assignment]
    return repo


def _row(
    *,
    times_cooked: int = 2,
    last_cook_ref: str | None = "old-ref",
    last_cook_status: str | None = "applied",
    last_cooked_at: str | None = "2026-09-01T00:00:00+00:00",
) -> dict[str, Any]:
    return {
        "id": "meal-1",
        "user_id": "user-1",
        "times_cooked": times_cooked,
        "last_cook_ref": last_cook_ref,
        "last_cook_status": last_cook_status,
        "last_cooked_at": last_cooked_at,
    }


@pytest.mark.asyncio
class TestClaimMealCook:
    async def test_or_filter_and_eq_are_exact(self) -> None:
        store = _FakeMealsStore(_row())
        repo = _repo_for(store)

        await repo.claim_meal_cook("user-1", "meal-1", "new-ref")

        assert store.or_calls == ["last_cook_ref.is.null,last_cook_ref.neq.new-ref"]
        assert ("id", "meal-1") in store.eq_calls
        assert ("user_id", "user-1") in store.eq_calls

    async def test_claimed_increments_times_cooked_and_sets_claimed_status(self) -> None:
        store = _FakeMealsStore(_row(times_cooked=2, last_cook_ref="old-ref"))
        repo = _repo_for(store)

        claim = await repo.claim_meal_cook("user-1", "meal-1", "new-ref")

        assert claim is not None
        assert claim.outcome == "claimed"
        assert claim.times_cooked == 3
        assert claim.cooked_on == datetime.now(UTC).date()
        assert store.update_calls[-1]["last_cook_status"] == "claimed"
        assert store.update_calls[-1]["last_cook_ref"] == "new-ref"

    async def test_claim_carries_the_instant_it_was_made_at(self) -> None:
        """#550: the Next.js proxy keys the bubble awards on the account's LOCAL
        date, which it can only compute from the claim's instant (a UTC date
        alone can't say which local day the claim fell on)."""
        store = _FakeMealsStore(_row(last_cook_ref="old-ref"))
        repo = _repo_for(store)

        claim = await repo.claim_meal_cook("user-1", "meal-1", "new-ref")

        assert claim is not None
        assert claim.cooked_at is not None
        assert claim.cooked_at.isoformat() == store.update_calls[-1]["last_cooked_at"]

    async def test_replay_returns_the_original_claim_instant(self) -> None:
        """A replay must hand back the ORIGINAL instant, so a retry after local
        midnight still lands on the first call's award key."""
        store = _FakeMealsStore(
            _row(
                last_cook_ref="new-ref",
                last_cook_status="applied",
                last_cooked_at="2026-09-23T23:50:00+00:00",
            )
        )
        repo = _repo_for(store)

        claim = await repo.claim_meal_cook("user-1", "meal-1", "new-ref")

        assert claim is not None
        assert claim.outcome == "replay_applied"
        assert claim.cooked_at == datetime(2026, 9, 23, 23, 50, tzinfo=UTC)

    async def test_zero_rows_then_replay_applied(self) -> None:
        """The update's own filter loses a race -- the concurrent request
        already stamped `last_cook_ref` to OUR ref with status 'applied' by
        the time our update runs."""
        stale_row = _row(last_cook_ref="old-ref", last_cook_status="applied")
        race_row = _row(last_cook_ref="new-ref", last_cook_status="applied")
        store = _FakeMealsStore(stale_row, race_row=race_row)
        repo = _repo_for(store)

        claim = await repo.claim_meal_cook("user-1", "meal-1", "new-ref")

        assert claim is not None
        assert claim.outcome == "replay_applied"
        assert store.update_calls == []  # the update itself never applied

    async def test_zero_rows_then_no_row_gives_none(self) -> None:
        stale_row = _row(last_cook_ref="old-ref")
        store = _FakeMealsStore(stale_row, race_row=None)
        repo = _repo_for(store)

        claim = await repo.claim_meal_cook("user-1", "meal-1", "new-ref")

        assert claim is None
        assert store.update_calls == []

    async def test_matching_ref_claimed_under_30s_is_in_progress(self) -> None:
        recent = (datetime.now(UTC) - timedelta(seconds=5)).isoformat()
        store = _FakeMealsStore(
            _row(last_cook_ref="same-ref", last_cook_status="claimed", last_cooked_at=recent)
        )
        repo = _repo_for(store)

        claim = await repo.claim_meal_cook("user-1", "meal-1", "same-ref")

        assert claim is not None
        assert claim.outcome == "replay_in_progress"

    async def test_matching_ref_claimed_over_30s_is_incomplete(self) -> None:
        old = (datetime.now(UTC) - timedelta(seconds=60)).isoformat()
        store = _FakeMealsStore(
            _row(last_cook_ref="same-ref", last_cook_status="claimed", last_cooked_at=old)
        )
        repo = _repo_for(store)

        claim = await repo.claim_meal_cook("user-1", "meal-1", "same-ref")

        assert claim is not None
        assert claim.outcome == "replay_claimed"

    async def test_matching_ref_applied_is_replay_applied(self) -> None:
        store = _FakeMealsStore(_row(last_cook_ref="same-ref", last_cook_status="applied"))
        repo = _repo_for(store)

        claim = await repo.claim_meal_cook("user-1", "meal-1", "same-ref")

        assert claim is not None
        assert claim.outcome == "replay_applied"

    async def test_no_row_gives_none(self) -> None:
        store = _FakeMealsStore(None)
        repo = _repo_for(store)

        claim = await repo.claim_meal_cook("user-1", "meal-1", "new-ref")

        assert claim is None


@pytest.mark.asyncio
class TestMarkMealCookApplied:
    async def test_filters_on_id_user_and_last_cook_ref(self) -> None:
        store = _FakeMealsStore(_row(last_cook_ref="new-ref", last_cook_status="claimed"))
        repo = _repo_for(store)

        await repo.mark_meal_cook_applied("user-1", "meal-1", "new-ref")

        assert store.update_calls == [{"last_cook_status": "applied"}]
        assert ("id", "meal-1") in store.eq_calls
        assert ("user_id", "user-1") in store.eq_calls
        assert ("last_cook_ref", "new-ref") in store.eq_calls

    async def test_never_stamps_a_different_ref(self) -> None:
        store = _FakeMealsStore(_row(last_cook_ref="someone-elses-newer-ref", last_cook_status="claimed"))
        repo = _repo_for(store)

        await repo.mark_meal_cook_applied("user-1", "meal-1", "stale-ref")

        assert store.update_calls == []
        assert store.row is not None
        assert store.row["last_cook_status"] == "claimed"


# ---------------------------------------------------------------------------
# get_meal_with_dishes -- recipe_id on every dish dict (N1)
# ---------------------------------------------------------------------------


class _FakeTable:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows
        self._filters: dict[str, Any] = {}
        self._order_field: str | None = None
        self._limit: int | None = None

    def select(self, *_args: Any, **_kwargs: Any) -> "_FakeTable":
        return self

    def eq(self, field: str, value: Any) -> "_FakeTable":
        self._filters[field] = value
        return self

    def order(self, field: str, **_kwargs: Any) -> "_FakeTable":
        self._order_field = field
        return self

    def limit(self, n: int) -> "_FakeTable":
        self._limit = n
        return self

    def execute(self) -> Any:
        rows = [r for r in self._rows if all(r.get(k) == v for k, v in self._filters.items())]
        if self._order_field:
            rows = sorted(rows, key=lambda r: r.get(self._order_field))
        if self._limit is not None:
            rows = rows[: self._limit]
        return _Result(rows)


class _FakeMealClient:
    def __init__(self, meals: list[dict[str, Any]], meal_dishes: list[dict[str, Any]], recipes: list[dict[str, Any]]) -> None:
        self._tables = {"meals": meals, "meal_dishes": meal_dishes, "recipes": recipes}

    def table(self, name: str) -> _FakeTable:
        return _FakeTable(list(self._tables.get(name, [])))


@pytest.mark.asyncio
class TestGetMealWithDishesRecipeId:
    async def test_every_dish_dict_carries_recipe_id(self) -> None:
        meal_id, user_id = "meal-1", "user-1"
        meals = [{"id": meal_id, "user_id": user_id, "title": "Dinner"}]
        meal_dishes = [
            {"meal_id": meal_id, "user_id": user_id, "role": "main", "position": 0, "recipe_id": "r1"},
            {"meal_id": meal_id, "user_id": user_id, "role": "side", "position": 1, "recipe_id": "r2"},
        ]
        recipes = [
            {"id": "r1", "user_id": user_id, "title": "Pasta"},
            {"id": "r2", "user_id": user_id, "title": "Salad"},
        ]
        repo = SupabaseRepository.__new__(SupabaseRepository)
        repo.client = _FakeMealClient(meals, meal_dishes, recipes)  # type: ignore[assignment]

        result = await repo.get_meal_with_dishes(user_id, meal_id)

        assert result is not None
        assert [d["recipe_id"] for d in result["dishes"]] == ["r1", "r2"]
        assert result["dishes"][0]["recipe"]["title"] == "Pasta"

    async def test_deleted_recipe_gives_empty_recipe_but_keeps_recipe_id(self) -> None:
        meal_id, user_id = "meal-1", "user-1"
        meals = [{"id": meal_id, "user_id": user_id, "title": "Dinner"}]
        meal_dishes = [
            {"meal_id": meal_id, "user_id": user_id, "role": "main", "position": 0, "recipe_id": "gone"},
        ]
        repo = SupabaseRepository.__new__(SupabaseRepository)
        repo.client = _FakeMealClient(meals, meal_dishes, [])  # type: ignore[assignment]

        result = await repo.get_meal_with_dishes(user_id, meal_id)

        assert result is not None
        assert result["dishes"][0]["recipe_id"] == "gone"
        assert result["dishes"][0]["recipe"] == {}
