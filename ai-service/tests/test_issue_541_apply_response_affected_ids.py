"""Issue #541 — POST /v1/workflows/apply never populates
ApplyResponse.affected_item_ids.

The bubbles ledger (Next.js side, `nextjs/src/app/api/ai/workflows/apply/
route.ts`) reads `affected_item_ids` off the apply response to key which
pantry rows to award bubbles for. Every one of the route's `ApplyResponse(...)`
constructions left the field at its default (empty list), so on a partial
failure — some actions applied, some didn't — no bubbles were awarded even
for the items that did apply, because the ledger had no ids to key off.

Fix: `SupabaseRepository.apply_pantry_proposal` now returns the ids of every
pantry row it created, updated, or deleted, and the route puts them on the
response.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.repository.supabase_repo import SupabaseRepository

TEST_USER_ID = "test-user-541"


# ---------------------------------------------------------------------------
# Repository-level: apply_pantry_proposal returns the ids it touched
# ---------------------------------------------------------------------------


class _FakeInsertQuery:
    def __init__(self, store: dict[str, Any], row_id: str) -> None:
        self._store = store
        self._payload: dict[str, Any] | None = None
        self._row_id = row_id

    def insert(self, payload: dict[str, Any]) -> "_FakeInsertQuery":
        self._payload = payload
        self._store["inserts"].append(payload)
        return self

    def execute(self) -> Any:
        assert self._payload is not None
        row = {
            "id": self._row_id,
            "added_at": "2026-09-05T00:00:00+00:00",
            "updated_at": "2026-09-05T00:00:00+00:00",
            **self._payload,
        }
        return type("Result", (), {"data": [row]})()


class _FakeUpdateQuery:
    def __init__(self, store: dict[str, Any], row_id: str) -> None:
        self._store = store
        self._payload: dict[str, Any] | None = None
        self._row_id = row_id

    def update(self, payload: dict[str, Any]) -> "_FakeUpdateQuery":
        self._payload = payload
        self._store["updates"].append(payload)
        return self

    def eq(self, *_args: Any, **_kwargs: Any) -> "_FakeUpdateQuery":
        return self

    def execute(self) -> Any:
        assert self._payload is not None
        row = {
            "id": self._row_id,
            "name": "item",
            "added_at": "2026-09-05T00:00:00+00:00",
            "updated_at": "2026-09-05T00:00:00+00:00",
            **self._payload,
        }
        return type("Result", (), {"data": [row]})()


class _FakeSelectQuery:
    """find_similar_item — always reports no existing match, so every 'add'
    action in these tests takes the insert path."""

    def select(self, *_args: Any, **_kwargs: Any) -> "_FakeSelectQuery":
        return self

    def eq(self, *_args: Any, **_kwargs: Any) -> "_FakeSelectQuery":
        return self

    def limit(self, *_args: Any, **_kwargs: Any) -> "_FakeSelectQuery":
        return self

    def execute(self) -> Any:
        return type("Result", (), {"data": []})()


class _FakeTableProxy:
    def __init__(self, store: dict[str, Any], row_ids: list[str]) -> None:
        self._store = store
        self._row_ids = row_ids

    def insert(self, payload: dict[str, Any]) -> _FakeInsertQuery:
        row_id = self._row_ids.pop(0)
        return _FakeInsertQuery(self._store, row_id).insert(payload)

    def update(self, payload: dict[str, Any]) -> _FakeUpdateQuery:
        row_id = self._row_ids.pop(0)
        return _FakeUpdateQuery(self._store, row_id).update(payload)

    def select(self, *args: Any, **kwargs: Any) -> _FakeSelectQuery:
        return _FakeSelectQuery().select(*args, **kwargs)


class _FakeClient:
    """Dispatches insert/update/select for 'pantry_items', handing out ids
    from `row_ids` in call order (one per add/update action)."""

    def __init__(self, row_ids: list[str]) -> None:
        self.store: dict[str, Any] = {"inserts": [], "updates": []}
        self._row_ids = list(row_ids)

    def table(self, _name: str) -> _FakeTableProxy:
        return _FakeTableProxy(self.store, self._row_ids)


def _repo(row_ids: list[str]) -> SupabaseRepository:
    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = _FakeClient(row_ids)  # type: ignore[assignment]
    return repo


ROW_ID_1 = "11111111-1111-1111-1111-111111111111"
ROW_ID_2 = "22222222-2222-2222-2222-222222222222"


@pytest.mark.asyncio
class TestApplyPantryProposalReturnsAffectedIds:
    async def test_add_action_returns_the_new_row_id(self) -> None:
        repo = _repo([ROW_ID_1])

        applied, failed, errors, affected_ids = await repo.apply_pantry_proposal(
            user_id="u1",
            actions=[
                {
                    "action": "add",
                    "name": "carrot",
                    "category": "produce",
                    "location": "fridge",
                    "quantity": 2,
                    "unit": "item",
                }
            ],
        )

        assert applied == 1 and failed == 0 and errors == []
        assert affected_ids == [UUID(ROW_ID_1)]

    async def test_two_actions_return_both_ids_in_order(self) -> None:
        repo = _repo([ROW_ID_1, ROW_ID_2])

        applied, failed, errors, affected_ids = await repo.apply_pantry_proposal(
            user_id="u1",
            actions=[
                {"action": "add", "name": "carrot", "quantity": 2, "unit": "item"},
                {"action": "add", "name": "onion", "quantity": 1, "unit": "item"},
            ],
        )

        assert applied == 2 and failed == 0
        assert affected_ids == [UUID(ROW_ID_1), UUID(ROW_ID_2)]

    async def test_partial_failure_still_returns_ids_for_actions_that_applied(
        self,
    ) -> None:
        """One action applies (add), one fails (update on a nonexistent
        item, since find_similar_item always reports no match here) --
        the id for the action that DID apply must still come back, so the
        bubbles ledger can award credit for it."""
        repo = _repo([ROW_ID_1])

        applied, failed, errors, affected_ids = await repo.apply_pantry_proposal(
            user_id="u1",
            actions=[
                {"action": "add", "name": "carrot", "quantity": 2, "unit": "item"},
                {"action": "update", "name": "nonexistent", "quantity": 5},
            ],
        )

        assert applied == 1
        assert failed == 1
        assert affected_ids == [UUID(ROW_ID_1)]


# ---------------------------------------------------------------------------
# Route-level: POST /v1/workflows/apply puts the ids on ApplyResponse
# ---------------------------------------------------------------------------


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


@pytest.mark.asyncio
async def test_apply_route_returns_affected_item_ids(client: AsyncClient) -> None:
    mock_repo = MagicMock()
    mock_repo.apply_pantry_proposal = AsyncMock(
        return_value=(1, 0, [], [UUID(ROW_ID_1)])
    )
    mock_repo.log_ingestion = AsyncMock(return_value=None)

    with patch(
        "bubbly_chef.api.routes.workflows.get_repository",
        new_callable=AsyncMock,
        return_value=mock_repo,
    ):
        response = await client.post(
            "/v1/workflows/apply",
            json={
                "request_id": "550e8400-e29b-41d4-a716-446655440000",
                "intent": "pantry_update",
                "proposal": {
                    "actions": [
                        {
                            "action_type": "add",
                            "item": {"name": "milk", "quantity": 1, "unit": "gallon"},
                            "confidence": 0.95,
                        }
                    ]
                },
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["affected_item_ids"] == [ROW_ID_1]


@pytest.mark.asyncio
async def test_apply_route_partial_failure_still_returns_applied_ids(
    client: AsyncClient,
) -> None:
    """Reproduces the ledger-visible symptom directly: a partial apply
    (1 applied, 1 failed) must still carry the id of the one that applied,
    not an empty list."""
    mock_repo = MagicMock()
    mock_repo.apply_pantry_proposal = AsyncMock(
        return_value=(1, 1, ["Item not found: eggs"], [UUID(ROW_ID_1)])
    )
    mock_repo.log_ingestion = AsyncMock(return_value=None)

    with patch(
        "bubbly_chef.api.routes.workflows.get_repository",
        new_callable=AsyncMock,
        return_value=mock_repo,
    ):
        response = await client.post(
            "/v1/workflows/apply",
            json={
                "request_id": "550e8400-e29b-41d4-a716-446655440000",
                "intent": "pantry_update",
                "proposal": {
                    "actions": [
                        {
                            "action_type": "add",
                            "item": {"name": "milk", "quantity": 1, "unit": "gallon"},
                            "confidence": 0.95,
                        },
                        {
                            "action_type": "update",
                            "item": {"name": "eggs", "quantity": 12, "unit": "count"},
                            "confidence": 0.9,
                        },
                    ]
                },
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False
    assert data["applied_count"] == 1
    assert data["failed_count"] == 1
    assert data["affected_item_ids"] == [ROW_ID_1], (
        "the id of the action that DID apply must still be returned even "
        "though the overall response is a partial failure"
    )
