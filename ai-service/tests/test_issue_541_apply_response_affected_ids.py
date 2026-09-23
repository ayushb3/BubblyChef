"""Issue #541 — POST /v1/workflows/apply never populates
ApplyResponse.affected_item_ids.

What this fixes, precisely: `SupabaseRepository.apply_pantry_proposal` only
ever returned `(applied, failed, errors)`, with no way to report which
pantry rows it actually created, updated, or deleted. Every
`ApplyResponse(...)` in the route left `affected_item_ids` at its default
empty list, so the field was useless to any caller that wanted per-item ids
instead of just aggregate counts — which is exactly the "narrower ask"
issue #541 states: populate the field "so the frontend can swap its
synthesized ref_key for the real id".

What this does NOT fix (reviewed and confirmed on #604 — do not restate the
old, incorrect claim that the Next.js bubbles ledger already reads this
field): `nextjs/src/app/api/ai/workflows/apply/route.ts` does not read
`affected_item_ids` today. It synthesizes `` `${requestId}:${normalizedName}`
`` as its ref_key, and it gates the whole bubbles award on
`data.success === true`, which ai-service only sets when `failed == 0`. That
gate is untouched by this PR. A partial apply (some actions succeed, some
fail) still awards zero bubbles after this change — populating
`affected_item_ids` is a precondition for a frontend fix to that gap, not
the fix itself. See the route's own comment block for the tracked gap.

Fix in this PR: `apply_pantry_proposal` now returns a fourth value,
`affected_item_ids` — the id of every pantry row it created, updated, or
deleted, across all six append sites (add-fresh-insert, add-merge-into-
existing, use→delete, use→update, plain update, remove) — and the route
puts that list on `ApplyResponse.affected_item_ids`.
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

ROW_ID_1 = "11111111-1111-1111-1111-111111111111"
ROW_ID_2 = "22222222-2222-2222-2222-222222222222"
EXISTING_ROW_ID = "33333333-3333-3333-3333-333333333333"

_EXISTING_ROW: dict[str, Any] = {
    "id": EXISTING_ROW_ID,
    "name": "carrot",
    "category": "produce",
    "location": "fridge",
    "quantity": 3.0,
    "unit": "item",
    "added_at": "2026-09-05T00:00:00+00:00",
    "updated_at": "2026-09-05T00:00:00+00:00",
}


# ---------------------------------------------------------------------------
# Repository-level fake -- extends the insert/update/select pattern from
# test_issue_182_estimated_expiry.py with:
#   - a `select` chain that actually matches on name_normalized, so
#     find_similar_item can report a hit and the merge/update/use/remove
#     paths run (the #604 review found the original fake never did this --
#     every action silently took the fresh-insert path).
#   - a `delete` chain (none of the pre-existing fakes in this test suite
#     had one).
#   - an `update` chain that can simulate "no row matched" (empty data),
#     to exercise the `updated.id if updated else existing.id` fallback.
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
    """Records the update payload; `.eq("id", ...)` pins which row it
    targets. `simulate_no_match` makes `.execute()` return no rows, as if
    the update matched nothing (RLS mismatch, row already gone, etc)."""

    def __init__(self, store: dict[str, Any], simulate_no_match: bool = False) -> None:
        self._store = store
        self._payload: dict[str, Any] | None = None
        self._target_id: str | None = None
        self._simulate_no_match = simulate_no_match

    def update(self, payload: dict[str, Any]) -> "_FakeUpdateQuery":
        self._payload = payload
        self._store["updates"].append(payload)
        return self

    def eq(self, column: str, value: Any) -> "_FakeUpdateQuery":
        if column == "id":
            self._target_id = value
        return self

    def execute(self) -> Any:
        assert self._payload is not None
        if self._simulate_no_match:
            return type("Result", (), {"data": []})()
        row = {
            "id": self._target_id,
            "name": "carrot",
            "added_at": "2026-09-05T00:00:00+00:00",
            "updated_at": "2026-09-05T00:00:00+00:00",
            **self._payload,
        }
        return type("Result", (), {"data": [row]})()


class _FakeDeleteQuery:
    def __init__(self, store: dict[str, Any]) -> None:
        self._store = store
        self._target_id: str | None = None

    def delete(self) -> "_FakeDeleteQuery":
        return self

    def eq(self, column: str, value: Any) -> "_FakeDeleteQuery":
        if column == "id":
            self._target_id = value
        return self

    def execute(self) -> Any:
        self._store["deletes"].append(self._target_id)
        return type("Result", (), {"data": [{"id": self._target_id}]})()


class _FakeSelectQuery:
    """find_similar_item's chain: `.select("*").eq("user_id", ...)
    .eq("name_normalized", ...).limit(1).execute()`. Reports a match only
    if `existing_by_name` has an entry for the normalized name filtered on.
    """

    def __init__(self, existing_by_name: dict[str, dict[str, Any]]) -> None:
        self._existing_by_name = existing_by_name
        self._name_filter: str | None = None

    def select(self, *_args: Any, **_kwargs: Any) -> "_FakeSelectQuery":
        return self

    def eq(self, column: str, value: Any) -> "_FakeSelectQuery":
        if column == "name_normalized":
            self._name_filter = value
        return self

    def limit(self, *_args: Any, **_kwargs: Any) -> "_FakeSelectQuery":
        return self

    def execute(self) -> Any:
        row = self._existing_by_name.get(self._name_filter or "")
        return type("Result", (), {"data": [row] if row else []})()


class _FakeTableProxy:
    def __init__(
        self,
        store: dict[str, Any],
        row_ids: list[str],
        existing_by_name: dict[str, dict[str, Any]],
        simulate_update_no_match: bool,
    ) -> None:
        self._store = store
        self._row_ids = row_ids
        self._existing_by_name = existing_by_name
        self._simulate_update_no_match = simulate_update_no_match

    def insert(self, payload: dict[str, Any]) -> _FakeInsertQuery:
        row_id = self._row_ids.pop(0)
        return _FakeInsertQuery(self._store, row_id).insert(payload)

    def update(self, payload: dict[str, Any]) -> _FakeUpdateQuery:
        return _FakeUpdateQuery(
            self._store, simulate_no_match=self._simulate_update_no_match
        ).update(payload)

    def select(self, *args: Any, **kwargs: Any) -> _FakeSelectQuery:
        return _FakeSelectQuery(self._existing_by_name).select(*args, **kwargs)

    def delete(self) -> _FakeDeleteQuery:
        return _FakeDeleteQuery(self._store).delete()


class _FakeClient:
    """Dispatches insert/update/select/delete for 'pantry_items'.

    - `row_ids`: handed out in call order, one per insert (add-fresh path).
    - `existing_by_name`: normalized-name -> row, so find_similar_item
      reports a hit for merge/update/use/remove actions.
    - `simulate_update_no_match`: makes every update() report no matching
      row, to exercise the `updated.id if updated else existing.id`
      fallback.
    """

    def __init__(
        self,
        row_ids: list[str] | None = None,
        existing_by_name: dict[str, dict[str, Any]] | None = None,
        simulate_update_no_match: bool = False,
    ) -> None:
        self.store: dict[str, Any] = {"inserts": [], "updates": [], "deletes": []}
        self._row_ids = list(row_ids or [])
        self._existing_by_name = existing_by_name or {}
        self._simulate_update_no_match = simulate_update_no_match

    def table(self, _name: str) -> _FakeTableProxy:
        return _FakeTableProxy(
            self.store, self._row_ids, self._existing_by_name, self._simulate_update_no_match
        )


def _repo(
    row_ids: list[str] | None = None,
    existing_by_name: dict[str, dict[str, Any]] | None = None,
    simulate_update_no_match: bool = False,
) -> SupabaseRepository:
    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = _FakeClient(  # type: ignore[assignment]
        row_ids=row_ids,
        existing_by_name=existing_by_name,
        simulate_update_no_match=simulate_update_no_match,
    )
    return repo


@pytest.mark.asyncio
class TestApplyPantryProposalReturnsAffectedIds:
    """Every one of the six affected_item_ids.append(...) call sites in
    apply_pantry_proposal, exercised individually."""

    async def test_add_fresh_insert_returns_the_new_row_id(self) -> None:
        """add, no existing match -- inserts a new row."""
        repo = _repo(row_ids=[ROW_ID_1])

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

    async def test_add_merge_into_existing_returns_the_existing_row_id(self) -> None:
        """add, WITH an existing match (find_similar_item hits) -- merges
        quantity into the existing row via update_pantry_item instead of
        inserting."""
        repo = _repo(existing_by_name={"carrot": dict(_EXISTING_ROW)})

        applied, failed, errors, affected_ids = await repo.apply_pantry_proposal(
            user_id="u1",
            actions=[
                {"action": "add", "name": "carrot", "quantity": 2, "unit": "item"}
            ],
        )

        assert applied == 1 and failed == 0 and errors == []
        assert affected_ids == [UUID(EXISTING_ROW_ID)]
        assert len(repo.client.store["updates"]) == 1  # type: ignore[attr-defined]
        assert len(repo.client.store["inserts"]) == 0  # type: ignore[attr-defined]

    async def test_use_full_consumption_deletes_and_returns_the_id(self) -> None:
        """use, quantity >= what's on hand -- deletes the row. Deletions
        never get a row back from the DB, so this must use the id already
        known (existing.id) before calling delete."""
        repo = _repo(existing_by_name={"carrot": dict(_EXISTING_ROW)})

        applied, failed, errors, affected_ids = await repo.apply_pantry_proposal(
            user_id="u1",
            actions=[{"action": "use", "name": "carrot", "quantity": 100}],
        )

        assert applied == 1 and failed == 0 and errors == []
        assert affected_ids == [UUID(EXISTING_ROW_ID)]
        assert repo.client.store["deletes"] == [EXISTING_ROW_ID]  # type: ignore[attr-defined]

    async def test_use_partial_consumption_updates_and_returns_the_id(self) -> None:
        """use, quantity < what's on hand -- updates the remaining quantity
        instead of deleting."""
        repo = _repo(existing_by_name={"carrot": dict(_EXISTING_ROW)})

        applied, failed, errors, affected_ids = await repo.apply_pantry_proposal(
            user_id="u1",
            actions=[{"action": "use", "name": "carrot", "quantity": 1}],
        )

        assert applied == 1 and failed == 0 and errors == []
        assert affected_ids == [UUID(EXISTING_ROW_ID)]
        assert len(repo.client.store["updates"]) == 1  # type: ignore[attr-defined]
        assert repo.client.store["deletes"] == []  # type: ignore[attr-defined]

    async def test_update_action_returns_the_updated_row_id(self) -> None:
        """A plain 'update' action (not 'use') on an existing item."""
        repo = _repo(existing_by_name={"carrot": dict(_EXISTING_ROW)})

        applied, failed, errors, affected_ids = await repo.apply_pantry_proposal(
            user_id="u1",
            actions=[{"action": "update", "name": "carrot", "location": "pantry"}],
        )

        assert applied == 1 and failed == 0 and errors == []
        assert affected_ids == [UUID(EXISTING_ROW_ID)]

    async def test_remove_action_returns_the_deleted_row_id(self) -> None:
        repo = _repo(existing_by_name={"carrot": dict(_EXISTING_ROW)})

        applied, failed, errors, affected_ids = await repo.apply_pantry_proposal(
            user_id="u1",
            actions=[{"action": "remove", "name": "carrot"}],
        )

        assert applied == 1 and failed == 0 and errors == []
        assert affected_ids == [UUID(EXISTING_ROW_ID)]
        assert repo.client.store["deletes"] == [EXISTING_ROW_ID]  # type: ignore[attr-defined]

    async def test_update_with_no_matching_row_falls_back_to_existing_id(self) -> None:
        """The `updated.id if updated else existing.id` fallback: when
        update_pantry_item returns None (no row matched the update), the
        id reported must still be the one find_similar_item already
        resolved, not a crash or a dropped id."""
        repo = _repo(
            existing_by_name={"carrot": dict(_EXISTING_ROW)},
            simulate_update_no_match=True,
        )

        applied, failed, errors, affected_ids = await repo.apply_pantry_proposal(
            user_id="u1",
            actions=[{"action": "update", "name": "carrot", "location": "pantry"}],
        )

        assert applied == 1 and failed == 0 and errors == []
        assert affected_ids == [UUID(EXISTING_ROW_ID)]

    async def test_two_actions_return_both_ids_in_order(self) -> None:
        repo = _repo(row_ids=[ROW_ID_1, ROW_ID_2])

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
        item -- find_similar_item reports no match for it) -- the id for
        the action that DID apply must still come back."""
        repo = _repo(row_ids=[ROW_ID_1])

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
# Route-level: POST /v1/workflows/apply puts the ids on ApplyResponse.
# These mock the repo wholesale, so they only prove the tuple plumbing
# through the route -- the repo-level tests above are what exercise the six
# append sites themselves.
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
    """Plumbing check only: the route forwards whatever affected_item_ids
    the repo returns, including on a partial apply. This does NOT mean
    bubbles get awarded on a partial apply -- the Next.js ledger's
    `if (data.success === true)` gate is untouched by this PR and still
    blocks any award once `failed_count > 0`."""
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
        "the id of the action that DID apply must still be returned on the "
        "ApplyResponse even though the overall response is a partial "
        "failure -- whether that id actually gets used to award anything "
        "is a separate, still-open gap in the Next.js ledger (see module "
        "docstring)"
    )
