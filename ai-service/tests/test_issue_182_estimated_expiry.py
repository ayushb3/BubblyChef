"""Round-trip tests for PantryItem.estimated_expiry (#182).

The field already existed on the Pydantic model and several workflow nodes
already computed it, but nothing backed it in the DB: the repository dropped
it on insert and never read it back. These tests pin the fix at the
repository boundary, following the fake-client pattern in
test_pantry_deduction.py.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest

from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.repository.supabase_repo import SupabaseRepository


class _FakeInsertQuery:
    """Records the insert payload and echoes it back as the inserted row."""

    def __init__(self, store: dict[str, Any]) -> None:
        self._store = store
        self._payload: dict[str, Any] | None = None

    def insert(self, payload: dict[str, Any]) -> _FakeInsertQuery:
        self._payload = payload
        self._store["inserts"].append(payload)
        return self

    def execute(self) -> Any:
        assert self._payload is not None
        row = {
            "id": "11111111-1111-1111-1111-111111111111",
            "added_at": "2026-09-05T00:00:00+00:00",
            "updated_at": "2026-09-05T00:00:00+00:00",
            **self._payload,
        }
        return type("Result", (), {"data": [row]})()


class _FakeUpdateQuery:
    """Records the update payload and echoes it back as the updated row."""

    def __init__(self, store: dict[str, Any]) -> None:
        self._store = store
        self._payload: dict[str, Any] | None = None

    def update(self, payload: dict[str, Any]) -> _FakeUpdateQuery:
        self._payload = payload
        self._store["updates"].append(payload)
        return self

    def eq(self, *_args: Any, **_kwargs: Any) -> _FakeUpdateQuery:
        return self

    def execute(self) -> Any:
        assert self._payload is not None
        row = {
            "id": "11111111-1111-1111-1111-111111111111",
            "name": "item",
            "added_at": "2026-09-05T00:00:00+00:00",
            "updated_at": "2026-09-05T00:00:00+00:00",
            **self._payload,
        }
        return type("Result", (), {"data": [row]})()


class _FakeSelectQuery:
    """Chain for find_similar_item — always reports no existing match."""

    def select(self, *_args: Any, **_kwargs: Any) -> _FakeSelectQuery:
        return self

    def eq(self, *_args: Any, **_kwargs: Any) -> _FakeSelectQuery:
        return self

    def limit(self, *_args: Any, **_kwargs: Any) -> _FakeSelectQuery:
        return self

    def execute(self) -> Any:
        return type("Result", (), {"data": []})()


class _FakeClient:
    """Dispatches insert vs. select chains for the "pantry_items" table."""

    def __init__(self) -> None:
        self.store: dict[str, Any] = {"inserts": [], "updates": []}

    def table(self, _name: str) -> Any:
        return _FakeTableProxy(self.store)


class _FakeTableProxy:
    """Returns an insert, update, or select chain lazily depending on which is called."""

    def __init__(self, store: dict[str, Any]) -> None:
        self._store = store

    def insert(self, payload: dict[str, Any]) -> _FakeInsertQuery:
        return _FakeInsertQuery(self._store).insert(payload)

    def update(self, payload: dict[str, Any]) -> _FakeUpdateQuery:
        return _FakeUpdateQuery(self._store).update(payload)

    def select(self, *args: Any, **kwargs: Any) -> _FakeSelectQuery:
        return _FakeSelectQuery().select(*args, **kwargs)


def _repo() -> tuple[SupabaseRepository, _FakeClient]:
    repo = SupabaseRepository.__new__(SupabaseRepository)
    client = _FakeClient()
    repo.client = client  # type: ignore[assignment]
    return repo, client


# ---------------------------------------------------------------------------
# add_pantry_item — insert payload carries estimated_expiry
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestAddPantryItemEstimatedExpiry:
    async def test_true_flows_into_insert_payload(self) -> None:
        repo, client = _repo()
        item = PantryItem(
            name="banana",
            category=FoodCategory.PRODUCE,
            storage_location=StorageLocation.PANTRY,
            expiry_date=date(2026, 9, 12),
            estimated_expiry=True,
        )

        result = await repo.add_pantry_item(user_id="u1", item=item)

        assert client.store["inserts"][0]["estimated_expiry"] is True
        assert result.estimated_expiry is True

    async def test_false_flows_into_insert_payload(self) -> None:
        repo, client = _repo()
        item = PantryItem(
            name="milk",
            category=FoodCategory.DAIRY,
            storage_location=StorageLocation.FRIDGE,
            expiry_date=date(2026, 9, 8),
            estimated_expiry=False,
        )

        result = await repo.add_pantry_item(user_id="u1", item=item)

        assert client.store["inserts"][0]["estimated_expiry"] is False
        assert result.estimated_expiry is False

    async def test_defaults_to_false_when_not_set_on_item(self) -> None:
        repo, client = _repo()
        item = PantryItem(name="rice", category=FoodCategory.DRY_GOODS)

        await repo.add_pantry_item(user_id="u1", item=item)

        assert client.store["inserts"][0]["estimated_expiry"] is False


# ---------------------------------------------------------------------------
# _row_to_pantry_item — reading a row back tolerates missing/NULL column
# ---------------------------------------------------------------------------


class TestRowToPantryItemEstimatedExpiry:
    def test_true_round_trips(self) -> None:
        repo = SupabaseRepository.__new__(SupabaseRepository)
        item = repo._row_to_pantry_item(
            {
                "id": "11111111-1111-1111-1111-111111111111",
                "name": "banana",
                "estimated_expiry": True,
            }
        )
        assert item.estimated_expiry is True

    def test_false_round_trips(self) -> None:
        repo = SupabaseRepository.__new__(SupabaseRepository)
        item = repo._row_to_pantry_item(
            {
                "id": "11111111-1111-1111-1111-111111111111",
                "name": "milk",
                "estimated_expiry": False,
            }
        )
        assert item.estimated_expiry is False

    def test_missing_key_defaults_to_false(self) -> None:
        """A row from before the migration ran has no estimated_expiry key."""
        repo = SupabaseRepository.__new__(SupabaseRepository)
        item = repo._row_to_pantry_item(
            {"id": "11111111-1111-1111-1111-111111111111", "name": "salt"}
        )
        assert item.estimated_expiry is False

    def test_null_value_defaults_to_false(self) -> None:
        """A row where the column exists but is NULL must not crash."""
        repo = SupabaseRepository.__new__(SupabaseRepository)
        item = repo._row_to_pantry_item(
            {
                "id": "11111111-1111-1111-1111-111111111111",
                "name": "pepper",
                "estimated_expiry": None,
            }
        )
        assert item.estimated_expiry is False


# ---------------------------------------------------------------------------
# apply_pantry_proposal (add branch) — computed/explicit estimated_expiry
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestApplyPantryProposalEstimatedExpiry:
    async def test_explicit_action_flag_wins_over_computed_heuristic(self) -> None:
        repo, client = _repo()

        applied, failed, errors = await repo.apply_pantry_proposal(
            user_id="u1",
            actions=[
                {
                    "action": "add",
                    "name": "carrot",
                    "category": "produce",
                    "location": "fridge",
                    "quantity": 2,
                    "unit": "item",
                    "expiry_date": None,
                    "estimated_expiry": False,
                }
            ],
        )

        assert failed == 0 and applied == 1
        assert errors == []
        assert client.store["inserts"][0]["estimated_expiry"] is False

    async def test_no_explicit_flag_falls_back_to_heuristic_estimate(self) -> None:
        repo, client = _repo()

        applied, failed, errors = await repo.apply_pantry_proposal(
            user_id="u1",
            actions=[
                {
                    "action": "add",
                    "name": "carrot",
                    "category": "produce",
                    "location": "fridge",
                    "quantity": 2,
                    "unit": "item",
                    # No expiry_date and no estimated_expiry override — the
                    # heuristic must run and its result must be persisted.
                }
            ],
        )

        assert failed == 0 and applied == 1
        assert errors == []
        # No expiry_date supplied → heuristic estimation kicks in → True.
        assert client.store["inserts"][0]["estimated_expiry"] is True

    async def test_explicit_expiry_date_without_flag_defaults_to_not_estimated(
        self,
    ) -> None:
        repo, client = _repo()

        applied, failed, errors = await repo.apply_pantry_proposal(
            user_id="u1",
            actions=[
                {
                    "action": "add",
                    "name": "yogurt",
                    "category": "dairy",
                    "location": "fridge",
                    "quantity": 1,
                    "unit": "item",
                    "expiry_date": "2026-09-20",
                    # A caller-supplied date with no estimated_expiry flag —
                    # treated as a real (non-estimated) date.
                }
            ],
        )

        assert failed == 0 and applied == 1
        assert errors == []
        assert client.store["inserts"][0]["estimated_expiry"] is False


# ---------------------------------------------------------------------------
# update_pantry_item — a client-driven expiry_date edit clears the flag
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestUpdatePantryItemEstimatedExpiry:
    async def test_expiry_date_alone_clears_estimated_expiry(self) -> None:
        repo, client = _repo()

        await repo.update_pantry_item(
            user_id="u1",
            item_id="11111111-1111-1111-1111-111111111111",
            updates={"expiry_date": "2026-09-20"},
        )

        payload = client.store["updates"][0]
        assert payload["expiry_date"] == "2026-09-20"
        assert payload["estimated_expiry"] is False

    async def test_unrelated_field_does_not_touch_estimated_expiry(self) -> None:
        repo, client = _repo()

        await repo.update_pantry_item(
            user_id="u1",
            item_id="11111111-1111-1111-1111-111111111111",
            updates={"name": "bananas", "quantity": 3},
        )

        payload = client.store["updates"][0]
        assert "estimated_expiry" not in payload

    async def test_explicit_estimated_expiry_true_with_date_is_respected(self) -> None:
        repo, client = _repo()

        await repo.update_pantry_item(
            user_id="u1",
            item_id="11111111-1111-1111-1111-111111111111",
            updates={"expiry_date": "2026-09-20", "estimated_expiry": True},
        )

        payload = client.store["updates"][0]
        assert payload["expiry_date"] == "2026-09-20"
        assert payload["estimated_expiry"] is True
