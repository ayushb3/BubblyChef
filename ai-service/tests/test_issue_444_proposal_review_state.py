"""Issue #444 (backend slice) -- a pending pantry proposal's outcome is stored
server side, against the persisted chat turn.

Contract: docs/plans/2026-09-30-issue-444-proposal-state-contract.md (R3),
sections 1-4 and 7 (B1-B14). Fakes only: a fake `conversation_history` table
that holds rows for two users and records every filter it is given, plus
stubs for the pantry write.

The new symbols (`bubbly_chef.services.proposal_review`, `PantryApplyResult`)
are imported inside the tests that need them, so each test fails on its own on
the unmodified code instead of the whole file failing at collection.
"""

from __future__ import annotations

import copy
import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.repository.supabase_repo import SupabaseRepository
from tests.test_issue_541_apply_response_affected_ids import _EXISTING_ROW, _repo

USER_A = "user-a-444"
USER_B = "user-b-444"
CONV = "550e8400-e29b-41d4-a716-4466554400aa"
RID_A = "a1000000-0000-4000-8000-000000000001"
RID_B = "b2000000-0000-4000-8000-000000000002"
RID_C = "c3000000-0000-4000-8000-000000000003"
NOW = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)

_STREAM_PATCH = "bubbly_chef.workflows.router.run_chat_workflow_streaming"


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def _nested(name: str, qty: float = 1, action_type: str = "add") -> dict[str, Any]:
    """An action in the persisted `proposal.actions` shape."""
    return {
        "action_type": action_type,
        "item": {"name": name, "quantity": qty, "unit": "whole"},
        "confidence": 0.9,
    }


def _flat(name: str, qty: float = 1, unit: str = "whole", action: str = "add") -> dict[str, Any]:
    """An action in the shape `POST /v1/workflows/apply` receives."""
    return {"action": action, "name": name, "quantity": qty, "unit": unit}


def _turn_row(
    rid: str,
    names: list[str],
    *,
    row_id: str | None = None,
    user_id: str = USER_A,
    review: dict[str, Any] | None = None,
    extra_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata: dict[str, Any] = {"request_id": rid, **(extra_meta or {})}
    if review is not None:
        metadata["proposal_review"] = review
    return {
        "id": row_id or f"row-{rid[:2]}",
        "user_id": user_id,
        "conversation_id": CONV,
        "role": "assistant",
        "intent": "pantry_update",
        "content": "ok",
        "proposal": {"actions": [_nested(n) for n in names]},
        "metadata": metadata,
    }


# ---------------------------------------------------------------------------
# Fake conversation_history table (holds rows for several users)
# ---------------------------------------------------------------------------


class _Query:
    def __init__(self, client: _FakeClient, op: str, payload: dict[str, Any] | None = None) -> None:
        self._client = client
        self._op = op
        self._payload = payload
        self._filters: dict[str, Any] = {}
        self._cols: list[str] | None = None

    def select(self, cols: str = "*", **_kw: Any) -> _Query:
        self._cols = None if cols == "*" else [c.strip() for c in cols.split(",")]
        return self

    def eq(self, column: str, value: Any) -> _Query:
        self._filters[column] = ("eq", value)
        return self

    def in_(self, column: str, values: list[str]) -> _Query:
        self._filters[column] = ("in", list(values))
        return self

    def order(self, *_a: Any, **_k: Any) -> _Query:
        return self

    def limit(self, *_a: Any, **_k: Any) -> _Query:
        return self

    def _matches(self, row: dict[str, Any]) -> bool:
        for column, (kind, value) in self._filters.items():
            if column == "metadata->>request_id":
                rid = row.get("_rid")
                if rid is None and isinstance(row.get("metadata"), dict):
                    rid = row["metadata"].get("request_id")
                if kind == "in" and rid not in value:
                    return False
                continue
            if kind == "eq" and row.get(column) != value:
                return False
        return True

    def execute(self) -> Any:
        self._client.ops.append(
            {"op": self._op, "filters": {k: v[1] for k, v in self._filters.items()}}
        )
        matched = [r for r in self._client.rows if self._matches(r)]
        if self._op == "update":
            assert self._payload is not None
            for row in matched:
                if row["id"] in self._client.raise_on_update_ids:
                    raise RuntimeError("write blew up")
                row.update(self._payload)
            return type("R", (), {"data": [{"id": r["id"]} for r in matched]})()
        if self._client.raise_on_select:
            raise RuntimeError("read blew up")
        cols = self._cols
        out = [
            {k: copy.deepcopy(v) for k, v in r.items() if cols is None or k in cols}
            for r in matched
        ]
        return type("R", (), {"data": out})()


class _Table:
    def __init__(self, client: _FakeClient) -> None:
        self._client = client

    def select(self, *a: Any, **k: Any) -> _Query:
        return _Query(self._client, "select").select(*a, **k)

    def update(self, payload: dict[str, Any]) -> _Query:
        return _Query(self._client, "update", payload)


class _FakeClient:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.ops: list[dict[str, Any]] = []
        self.raise_on_update_ids: set[str] = set()
        self.raise_on_select = False

    def table(self, name: str) -> _Table:
        assert name == "conversation_history", f"unexpected table {name}"
        return _Table(self)


def _make_repo(
    rows: list[dict[str, Any]],
    *,
    failed_indices: list[int] | None = None,
    failed_errors: dict[int, str] | None = None,
) -> tuple[SupabaseRepository, _FakeClient, list[list[dict[str, Any]]]]:
    """A real repository over the fake history table. The pantry write is
    stubbed: `sent` records each list it was handed, and the listed indices
    (into that list) fail."""
    client = _FakeClient(rows)
    repo = SupabaseRepository.__new__(SupabaseRepository)
    repo.client = client  # type: ignore[assignment]
    sent: list[list[dict[str, Any]]] = []

    async def _detailed(user_id: str, actions: list[dict[str, Any]]) -> Any:
        from bubbly_chef.repository.supabase_repo import PantryApplyResult

        sent.append(list(actions))
        idx = list(failed_indices or [])
        return PantryApplyResult(
            applied=len(actions) - len(idx),
            failed=len(idx),
            errors=[(failed_errors or {}).get(i, "boom") for i in idx],
            affected_item_ids=[],
            failed_indices=idx,
            failed_errors=dict(failed_errors or {}),
        )

    repo.apply_pantry_proposal_detailed = _detailed  # type: ignore[attr-defined]
    repo.apply_pantry_proposal = AsyncMock(  # type: ignore[method-assign]
        return_value=(len(sent), 0, [], [])
    )
    repo.log_ingestion = AsyncMock(return_value=None)  # type: ignore[method-assign]
    return repo, client, sent


# ---------------------------------------------------------------------------
# App fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def app() -> Any:
    _app = create_app()

    async def _uid() -> str:
        return USER_A

    _app.dependency_overrides[get_current_user_id] = _uid
    return _app


@pytest_asyncio.fixture
async def client(app: Any) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _apply_body(
    actions: list[dict[str, Any]],
    turn_ids: list[str] | None = None,
    conversation_id: str | None = CONV,
    request_id: str = RID_A,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "request_id": request_id,
        "intent": "pantry_update",
        "proposal": {"actions": actions},
    }
    if turn_ids is not None:
        body["turn_request_ids"] = turn_ids
    if conversation_id is not None:
        body["conversation_id"] = conversation_id
    return body


def _patch_repo(repo: Any) -> Any:
    return patch(
        "bubbly_chef.api.routes.workflows.get_repository",
        new_callable=AsyncMock,
        return_value=repo,
    )


def _row_by_id(rows: list[dict[str, Any]], row_id: str) -> dict[str, Any]:
    return next(r for r in rows if r["id"] == row_id)


# ===========================================================================
# Pure proposal_review logic (B1-B6)
# ===========================================================================


def test_b1_all_rows_applied_gives_applied_with_own_keys() -> None:
    from bubbly_chef.services.proposal_review import review_after_apply

    turn = _turn_row(RID_A, ["lemon", "spinach"])
    review = review_after_apply(
        turn, [_flat("lemon"), _flat("spinach")], [], {}, [RID_A], NOW
    )

    assert review.status == "applied"
    assert sorted(review.applied_keys) == ["lemon", "spinach"]
    assert review.failed == []
    assert review.error is None
    assert review.chain_request_ids == [RID_A]


def test_b2_partial_result_records_sent_values_of_the_failed_row() -> None:
    from bubbly_chef.services.proposal_review import review_after_apply

    turn = _turn_row(RID_A, ["lemon", "spinach"])
    sent = [_flat("lemon"), _flat("Spinach", qty=3, unit="cup")]
    review = review_after_apply(
        turn, sent, [1], {1: "Units don't match (cup vs bag), edit the unit for: spinach"},
        [RID_A], NOW,
    )

    assert review.status == "failed"
    assert review.applied_keys == ["lemon"]
    assert len(review.failed) == 1
    row = review.failed[0]
    assert (row.key, row.name, row.quantity, row.unit) == ("spinach", "Spinach", 3, "cup")
    assert review.error == "Units don't match (cup vs bag), edit the unit for: spinach"


def test_b3_retry_accumulates_applied_keys_and_completes() -> None:
    from bubbly_chef.services.proposal_review import review_after_apply

    turn = _turn_row(RID_A, ["lemon", "spinach"])
    first = review_after_apply(
        turn, [_flat("lemon"), _flat("spinach", qty=3)], [1], {1: "nope"}, [RID_A], NOW
    )
    turn["metadata"]["proposal_review"] = first.model_dump(mode="json")

    second = review_after_apply(turn, [_flat("spinach", qty=3)], [], {}, [RID_A], NOW)

    assert second.applied_keys == ["lemon", "spinach"]
    assert second.status == "applied"
    assert second.failed == []
    assert second.error is None


def test_b4_keys_normalise_whitespace_and_case() -> None:
    from bubbly_chef.services.proposal_review import proposal_action_key

    assert proposal_action_key("  Spinach ") == "spinach"


def test_b5_merged_chain_splits_by_each_turns_own_keys() -> None:
    from bubbly_chef.services.proposal_review import review_after_apply

    turn_a = _turn_row(RID_A, ["lemon", "spinach"])
    turn_b = _turn_row(RID_B, ["carrot", "lemon"])
    sent = [_flat("lemon"), _flat("spinach"), _flat("carrot")]
    chain = [RID_A, RID_B]

    a = review_after_apply(turn_a, sent, [1], {1: "nf"}, chain, NOW)
    b = review_after_apply(turn_b, sent, [1], {1: "nf"}, chain, NOW)

    assert a.status == "failed"
    assert a.applied_keys == ["lemon"]
    assert [f.key for f in a.failed] == ["spinach"]
    assert b.status == "applied"
    assert sorted(b.applied_keys) == ["carrot", "lemon"]


def test_b5b_repeated_failed_row_is_recorded_on_both_turns() -> None:
    from bubbly_chef.services.proposal_review import review_after_apply

    turn_a = _turn_row(RID_A, ["lemon", "spinach"])
    turn_b = _turn_row(RID_B, ["spinach", "carrot"])
    sent = [_flat("lemon"), _flat("spinach"), _flat("carrot")]
    chain = [RID_A, RID_B]

    a = review_after_apply(turn_a, sent, [1], {1: "nf"}, chain, NOW)
    b = review_after_apply(turn_b, sent, [1], {1: "nf"}, chain, NOW)

    assert (a.status, b.status) == ("failed", "failed")
    assert [f.key for f in a.failed] == ["spinach"] == [f.key for f in b.failed]
    assert a.chain_request_ids == chain == b.chain_request_ids
    assert a.applied_keys == ["lemon"]
    assert b.applied_keys == ["carrot"]


def test_b6_reject_keeps_applied_keys_and_records_the_chain() -> None:
    from bubbly_chef.services.proposal_review import review_after_apply, review_after_reject

    turn = _turn_row(RID_A, ["lemon", "spinach"])
    first = review_after_apply(
        turn, [_flat("lemon"), _flat("spinach")], [1], {1: "nf"}, [RID_A], NOW
    )
    turn["metadata"]["proposal_review"] = first.model_dump(mode="json")

    rejected = review_after_reject(turn, [RID_A, RID_B], NOW)

    assert rejected.status == "rejected"
    assert rejected.applied_keys == ["lemon"]
    assert [f.key for f in rejected.failed] == ["spinach"]
    assert rejected.error is None
    assert rejected.chain_request_ids == [RID_A, RID_B]


def test_own_keys_is_tolerant_of_malformed_turns() -> None:
    from bubbly_chef.services.proposal_review import own_keys

    assert own_keys({"proposal": "garbage"}) == set()
    assert own_keys({"proposal": {"actions": "x"}}) == set()
    assert own_keys({"proposal": {"actions": [{"item": None}]}}) == set()
    assert own_keys({"proposal": {"actions": [{"item": {"name": ""}}, 7, None]}}) == set()
    assert own_keys(
        {"proposal": {"actions": [_nested(" Lemon "), {"item": {"name": 5}}]}}
    ) == {"lemon"}


# ===========================================================================
# Repository (B13)
# ===========================================================================


@pytest.mark.asyncio
class TestB13FailedIndices:
    """`apply_pantry_proposal_detailed` reports failed_indices at four code
    sites, tested as five cases. Each case puts a passing action first so the
    index is not trivially 0."""

    async def test_update_not_found(self) -> None:
        repo = _repo(row_ids=["11111111-1111-1111-1111-111111111111"])
        result = await repo.apply_pantry_proposal_detailed(  # type: ignore[attr-defined]
            "u1",
            [
                {"action": "add", "name": "carrot", "quantity": 1, "unit": "item"},
                {"action": "update", "name": "ghost", "quantity": 5},
            ],
        )
        assert (result.applied, result.failed) == (1, 1)
        assert result.failed_indices == [1]
        assert result.failed_errors == {1: "Item not found: ghost"}

    async def test_use_not_found(self) -> None:
        repo = _repo(existing_by_name={"carrot": dict(_EXISTING_ROW)})
        result = await repo.apply_pantry_proposal_detailed(  # type: ignore[attr-defined]
            "u1",
            [
                {"action": "use", "name": "carrot", "quantity": 1},
                {"action": "use", "name": "ghost", "quantity": 1},
            ],
        )
        assert result.failed_indices == [1]
        assert result.failed_errors == {1: "Item not found: ghost"}

    async def test_use_refusal(self) -> None:
        spinach = dict(
            _EXISTING_ROW,
            name="spinach",
            quantity=200.0,
            unit="g",
            quantity_base=200.0,
            unit_base="g",
        )
        repo = _repo(existing_by_name={"spinach": spinach, "carrot": dict(_EXISTING_ROW)})
        result = await repo.apply_pantry_proposal_detailed(  # type: ignore[attr-defined]
            "u1",
            [
                {"action": "use", "name": "carrot", "quantity": 1},
                {"action": "use", "name": "spinach", "quantity": 1, "unit": "handful"},
            ],
        )
        assert result.failed_indices == [1]
        assert result.failed_errors == {
            1: "Units don't match (handful vs g), edit the unit for: spinach"
        }

    async def test_remove_not_found(self) -> None:
        repo = _repo(existing_by_name={"carrot": dict(_EXISTING_ROW)})
        result = await repo.apply_pantry_proposal_detailed(  # type: ignore[attr-defined]
            "u1",
            [
                {"action": "remove", "name": "carrot"},
                {"action": "remove", "name": "ghost"},
            ],
        )
        assert result.failed_indices == [1]
        assert result.failed_errors == {1: "Item not found for removal: ghost"}

    async def test_generic_exception(self) -> None:
        repo = _repo(existing_by_name={"carrot": dict(_EXISTING_ROW)})
        original = repo.find_similar_item

        async def _boom(user_id: str, name: str) -> Any:
            if name == "kaboom":
                raise RuntimeError("db down")
            return await original(user_id, name)

        repo.find_similar_item = _boom  # type: ignore[method-assign]
        result = await repo.apply_pantry_proposal_detailed(  # type: ignore[attr-defined]
            "u1",
            [
                {"action": "remove", "name": "carrot"},
                {"action": "remove", "name": "kaboom"},
            ],
        )
        assert result.failed_indices == [1]
        assert 1 in result.failed_errors
        assert "db down" in result.failed_errors[1]

    async def test_wrapper_still_returns_the_four_tuple(self) -> None:
        repo = _repo(existing_by_name={"carrot": dict(_EXISTING_ROW)})
        out = await repo.apply_pantry_proposal(
            "u1", [{"action": "remove", "name": "carrot"}, {"action": "remove", "name": "x"}]
        )
        applied, failed, errors, ids = out
        assert (applied, failed) == (1, 1)
        assert errors == ["Item not found for removal: x"]
        assert ids == [UUID(_EXISTING_ROW["id"])]


# ===========================================================================
# Apply route (B7, B8, B9, B10, B11, B14)
# ===========================================================================


@pytest.mark.asyncio
async def test_b7_apply_records_review_and_failed_names_come_from_the_index(
    client: AsyncClient,
) -> None:
    row = _turn_row(
        RID_A, ["lemon", "Spinach"], extra_meta={"clarification_suggestions": [{"term": "x"}]}
    )
    repo, _fake, sent = _make_repo(
        [row],
        failed_indices=[1],
        failed_errors={1: "Error processing {'action': 'add', 'name': 'Spinach'}: boom"},
    )

    with _patch_repo(repo):
        resp = await client.post(
            "/v1/workflows/apply",
            json=_apply_body([_flat("lemon"), _flat("Spinach", qty=3)], turn_ids=[RID_A]),
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert data["failed_names"] == ["spinach"]
    assert data["already_applied_names"] == []
    assert data["recorded_turn_request_ids"] == [RID_A]
    assert len(sent) == 1 and len(sent[0]) == 2

    meta = row["metadata"]
    assert meta["request_id"] == RID_A
    assert meta["clarification_suggestions"] == [{"term": "x"}]
    review = meta["proposal_review"]
    assert review["status"] == "failed"
    assert review["applied_keys"] == ["lemon"]
    assert review["failed"] == [
        {"key": "spinach", "name": "Spinach", "quantity": 3, "unit": "whole"}
    ]
    assert review["chain_request_ids"] == [RID_A]
    assert "updated_at" in review
    # the offer itself is left pristine
    assert row["proposal"] == {"actions": [_nested("lemon"), _nested("Spinach")]}


@pytest.mark.asyncio
async def test_b7b_chain_apply_records_every_turn_with_the_whole_chain(
    client: AsyncClient,
) -> None:
    turn_a = _turn_row(RID_A, ["lemon", "spinach"])
    turn_b = _turn_row(RID_B, ["spinach", "carrot"])
    repo, _fake, _sent = _make_repo([turn_a, turn_b], failed_indices=[1], failed_errors={1: "nf"})

    with _patch_repo(repo):
        resp = await client.post(
            "/v1/workflows/apply",
            json=_apply_body(
                [_flat("lemon"), _flat("spinach"), _flat("carrot")],
                turn_ids=[RID_A, RID_B],
                request_id=RID_B,
            ),
        )

    data = resp.json()
    assert data["recorded_turn_request_ids"] == [RID_A, RID_B]
    assert data["failed_names"] == ["spinach"]
    ra = turn_a["metadata"]["proposal_review"]
    rb = turn_b["metadata"]["proposal_review"]
    assert (ra["status"], rb["status"]) == ("failed", "failed")
    assert ra["chain_request_ids"] == [RID_A, RID_B] == rb["chain_request_ids"]
    assert ra["applied_keys"] == ["lemon"] and rb["applied_keys"] == ["carrot"]


@pytest.mark.asyncio
async def test_b8_guard_drops_rows_already_applied(client: AsyncClient) -> None:
    review = {
        "status": "failed",
        "applied_keys": ["lemon"],
        "failed": [{"key": "carrot", "name": "carrot", "quantity": 1, "unit": "whole"}],
        "error": "x",
        "chain_request_ids": [RID_A],
        "updated_at": "2026-09-30T12:00:00+00:00",
    }
    row = _turn_row(RID_A, ["lemon", "carrot"], review=review)
    repo, _fake, sent = _make_repo([row])

    with _patch_repo(repo):
        resp = await client.post(
            "/v1/workflows/apply",
            json=_apply_body([_flat("lemon"), _flat("carrot")], turn_ids=[RID_A]),
        )

    data = resp.json()
    assert resp.status_code == 200
    assert [a["name"] for a in sent[0]] == ["carrot"]
    assert data["already_applied_names"] == ["lemon"]
    assert data["success"] is True
    assert row["metadata"]["proposal_review"]["status"] == "applied"
    assert row["metadata"]["proposal_review"]["applied_keys"] == ["lemon", "carrot"]


@pytest.mark.asyncio
async def test_b8_failure_indices_refer_to_the_post_guard_list(client: AsyncClient) -> None:
    review = {
        "status": "failed",
        "applied_keys": ["lemon"],
        "failed": [],
        "error": None,
        "chain_request_ids": [RID_A],
        "updated_at": "2026-09-30T12:00:00+00:00",
    }
    row = _turn_row(RID_A, ["lemon", "carrot"], review=review)
    # index 0 of the POST-guard list is carrot
    repo, _fake, sent = _make_repo([row], failed_indices=[0], failed_errors={0: "carrot broke"})

    with _patch_repo(repo):
        resp = await client.post(
            "/v1/workflows/apply",
            json=_apply_body([_flat("lemon"), _flat("carrot", qty=2)], turn_ids=[RID_A]),
        )

    data = resp.json()
    assert [a["name"] for a in sent[0]] == ["carrot"]
    assert data["failed_names"] == ["carrot"]
    assert data["success"] is False
    got = row["metadata"]["proposal_review"]
    assert got["status"] == "failed"
    assert got["applied_keys"] == ["lemon"]
    assert [f["key"] for f in got["failed"]] == ["carrot"]
    assert got["failed"][0]["quantity"] == 2


@pytest.mark.asyncio
async def test_b8_everything_already_applied_skips_the_pantry_write(
    client: AsyncClient,
) -> None:
    review = {
        "status": "applied",
        "applied_keys": ["lemon"],
        "failed": [],
        "error": None,
        "chain_request_ids": [RID_A],
        "updated_at": "2026-09-30T12:00:00+00:00",
    }
    row = _turn_row(RID_A, ["lemon"], review=review)
    repo, _fake, sent = _make_repo([row])

    with _patch_repo(repo):
        resp = await client.post(
            "/v1/workflows/apply", json=_apply_body([_flat("lemon")], turn_ids=[RID_A])
        )

    data = resp.json()
    assert resp.status_code == 200
    assert sent == []
    repo.apply_pantry_proposal.assert_not_called()  # type: ignore[attr-defined]
    assert data["success"] is True and data["applied_count"] == 0
    assert data["already_applied_names"] == ["lemon"]


@pytest.mark.asyncio
async def test_b9_a_user_cannot_mark_or_guard_on_another_users_turn(app: Any) -> None:
    review = {
        "status": "applied",
        "applied_keys": ["lemon"],
        "failed": [],
        "error": None,
        "chain_request_ids": [RID_A],
        "updated_at": "2026-09-30T12:00:00+00:00",
    }
    victim = _turn_row(RID_A, ["lemon"], user_id=USER_A, review=review)
    before = json.dumps(victim, sort_keys=True)
    repo, fake, sent = _make_repo([victim])

    async def _uid_b() -> str:
        return USER_B

    app.dependency_overrides[get_current_user_id] = _uid_b

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        with _patch_repo(repo):
            apply_resp = await ac.post(
                "/v1/workflows/apply",
                json=_apply_body([_flat("lemon"), _flat("carrot")], turn_ids=[RID_A]),
            )
            reject_resp = await ac.post(
                "/v1/workflows/reject",
                json={"conversation_id": CONV, "turn_request_ids": [RID_A]},
            )

    assert apply_resp.status_code == 200
    data = apply_resp.json()
    assert data["recorded_turn_request_ids"] == []
    assert data["already_applied_names"] == []  # user A's applied_keys never leaked in
    assert [a["name"] for a in sent[0]] == ["lemon", "carrot"]  # caller's own pantry write ran
    assert reject_resp.status_code == 200
    assert reject_resp.json()["recorded_turn_request_ids"] == []
    assert json.dumps(victim, sort_keys=True) == before
    assert fake.ops, "expected the service to touch history"
    for op in fake.ops:
        assert op["filters"].get("user_id") == USER_B, op


@pytest.mark.asyncio
async def test_b10_scan_path_makes_no_history_calls_and_response_has_new_fields(
    client: AsyncClient,
) -> None:
    repo, fake, _sent = _make_repo([_turn_row(RID_A, ["lemon"])])
    repo.apply_pantry_proposal = AsyncMock(return_value=(1, 0, [], []))  # type: ignore[method-assign]

    with _patch_repo(repo):
        resp = await client.post(
            "/v1/workflows/apply",
            json=_apply_body([_flat("lemon")], turn_ids=None, conversation_id=None),
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["applied_count"] == 1
    assert data["failed_names"] == []
    assert data["already_applied_names"] == []
    assert data["recorded_turn_request_ids"] == []
    assert fake.ops == []
    repo.apply_pantry_proposal.assert_awaited_once()  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_b11_reject_records_rejected(client: AsyncClient) -> None:
    turn_a = _turn_row(RID_A, ["lemon", "spinach"])
    turn_b = _turn_row(RID_B, ["carrot"])
    repo, _fake, sent = _make_repo([turn_a, turn_b])

    with _patch_repo(repo):
        resp = await client.post(
            "/v1/workflows/reject",
            json={"conversation_id": CONV, "turn_request_ids": [RID_A, RID_B, RID_C]},
        )

    assert resp.status_code == 200
    assert resp.json() == {"recorded_turn_request_ids": [RID_A, RID_B]}  # RID_C unknown: ignored
    assert sent == []
    for row in (turn_a, turn_b):
        review = row["metadata"]["proposal_review"]
        assert review["status"] == "rejected"
        assert review["chain_request_ids"] == [RID_A, RID_B, RID_C]


@pytest.mark.asyncio
async def test_b11_reject_requires_auth_and_a_nonempty_list(app: Any, client: AsyncClient) -> None:
    empty = await client.post(
        "/v1/workflows/reject", json={"conversation_id": CONV, "turn_request_ids": []}
    )
    assert empty.status_code == 422

    too_many = await client.post(
        "/v1/workflows/reject",
        json={
            "conversation_id": CONV,
            "turn_request_ids": [f"00000000-0000-4000-8000-{i:012d}" for i in range(201)],
        },
    )
    assert too_many.status_code == 422

    app.dependency_overrides.clear()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        unauth = await ac.post(
            "/v1/workflows/reject",
            json={"conversation_id": CONV, "turn_request_ids": [RID_A]},
        )
    assert unauth.status_code == 401


@pytest.mark.asyncio
async def test_b11_apply_turn_ids_without_conversation_id_is_422(client: AsyncClient) -> None:
    repo, _fake, sent = _make_repo([])  # never a real repository, even on unmodified code
    with _patch_repo(repo):
        resp = await client.post(
            "/v1/workflows/apply",
            json=_apply_body([_flat("lemon")], turn_ids=[RID_A], conversation_id=None),
        )
    assert resp.status_code == 422
    assert sent == []


@pytest.mark.asyncio
async def test_apply_turn_request_ids_cap_is_200(client: AsyncClient) -> None:
    def ids(n: int) -> list[str]:
        return [f"00000000-0000-4000-8000-{i:012d}" for i in range(n)]

    repo, _fake, _sent = _make_repo([])
    with _patch_repo(repo):
        ok = await client.post(
            "/v1/workflows/apply", json=_apply_body([_flat("lemon")], turn_ids=ids(200))
        )
        over = await client.post(
            "/v1/workflows/apply", json=_apply_body([_flat("lemon")], turn_ids=ids(201))
        )
    assert ok.status_code == 200
    assert over.status_code == 422


@pytest.mark.asyncio
async def test_b14_malformed_turns_never_break_the_apply(client: AsyncClient) -> None:
    rids = [f"d{i}000000-0000-4000-8000-00000000000{i}" for i in range(1, 8)]
    garbage, actions_str, item_null, bad_review, non_dict_meta, write_raises, sibling = rids

    def _row(rid: str, rid_row_id: str) -> dict[str, Any]:
        return _turn_row(rid, ["lemon"], row_id=rid_row_id)

    r_garbage = _row(garbage, "row-garbage")
    r_garbage["proposal"] = "garbage"
    r_actions = _row(actions_str, "row-actions")
    r_actions["proposal"] = {"actions": "x"}
    r_item = _row(item_null, "row-item")
    r_item["proposal"] = {"actions": [{"item": None}]}
    r_review = _row(bad_review, "row-review")
    r_review["metadata"]["proposal_review"] = {"status": 7}
    r_meta = _row(non_dict_meta, "row-meta")
    r_meta["metadata"] = ["x"]
    r_meta["_rid"] = non_dict_meta  # surfaced by the fake even though real Postgres would not
    r_write = _row(write_raises, "row-write")
    r_sib = _row(sibling, "row-sib")

    rows = [r_garbage, r_actions, r_item, r_review, r_meta, r_write, r_sib]
    repo, fake, _sent = _make_repo(rows, failed_indices=[], failed_errors={})
    fake.raise_on_update_ids = {"row-write"}
    meta_before = json.dumps(r_meta, sort_keys=True)

    with _patch_repo(repo):
        resp = await client.post(
            "/v1/workflows/apply",
            json=_apply_body([_flat("lemon")], turn_ids=rids, request_id=sibling),
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True and data["applied_count"] == 1
    assert set(data["recorded_turn_request_ids"]) == {
        garbage,
        actions_str,
        item_null,
        bad_review,
        sibling,
    }
    for row in (r_garbage, r_actions, r_item):
        assert row["metadata"]["proposal_review"]["status"] == "applied"
    # a malformed review is read as absent and replaced by a fresh one (lemon is an own key)
    assert r_review["metadata"]["proposal_review"]["status"] == "applied"
    assert r_review["metadata"]["proposal_review"]["applied_keys"] == ["lemon"]
    assert json.dumps(r_meta, sort_keys=True) == meta_before
    assert "proposal_review" not in r_write["metadata"]
    assert r_sib["metadata"]["proposal_review"]["status"] == "applied"


@pytest.mark.asyncio
async def test_b14_a_failing_history_read_still_returns_the_pantry_result(
    client: AsyncClient,
) -> None:
    row = _turn_row(RID_A, ["lemon"])
    repo, fake, sent = _make_repo([row], failed_indices=[1], failed_errors={1: "nf"})
    fake.raise_on_select = True

    with _patch_repo(repo):
        resp = await client.post(
            "/v1/workflows/apply",
            json=_apply_body([_flat("lemon"), _flat("spinach")], turn_ids=[RID_A]),
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["applied_count"] == 1 and data["failed_count"] == 1
    assert data["failed_names"] == ["spinach"]
    assert data["recorded_turn_request_ids"] == []
    assert len(sent) == 1
    assert "proposal_review" not in row["metadata"]


# ===========================================================================
# Stream and non-stream save timing (B12)
# ===========================================================================


def _envelope(intent: str, request_id: str, proposal: Any, metadata: Any = None) -> dict[str, Any]:
    env: dict[str, Any] = {
        "request_id": request_id,
        "workflow_id": "wf",
        "conversation_id": CONV,
        "intent": intent,
        "assistant_message": "Got it! Adding 2 lemons.",
        "proposal": proposal,
        "confidence": {"overall": 0.9},
        "requires_review": proposal is not None,
        "next_action": "review_proposal" if proposal else "none",
    }
    if metadata is not None:
        env["metadata"] = metadata
    return env


def _logging_repo(log: list[Any]) -> MagicMock:
    repo = MagicMock()

    async def _save(**kwargs: Any) -> None:
        log.append(("save", kwargs["role"], kwargs))

    repo.save_message = _save
    repo.get_history = AsyncMock(return_value=[])
    return repo


def _stream_for(envelope: dict[str, Any], log: list[Any]) -> Any:
    async def _fake(*_a: Any, **_k: Any) -> AsyncIterator[str]:
        yield json.dumps({"type": "token", "content": "Got it! "})
        yield json.dumps({"type": "token", "content": "Adding 2 lemons."})
        yield json.dumps({"type": "done"})
        yield json.dumps({"type": "envelope", "data": envelope})
        # Runs once the route has consumed (and forwarded) the envelope event.
        log.append(("after_envelope",))

    return _fake


def _assistant_saves(log: list[Any]) -> list[dict[str, Any]]:
    return [e[2] for e in log if e[0] == "save" and e[1] == "assistant"]


@pytest.mark.asyncio
async def test_b12_stream_saves_a_pantry_turn_before_its_envelope_is_sent(
    client: AsyncClient,
) -> None:
    log: list[Any] = []
    env = _envelope(
        "pantry_update", RID_A, {"actions": [_nested("lemon", 2)]}, {"clarification_suggestions": []}
    )
    with patch(_STREAM_PATCH, side_effect=_stream_for(env, log)), patch(
        "bubbly_chef.api.routes.chat.get_repository",
        new_callable=AsyncMock,
        return_value=_logging_repo(log),
    ):
        resp = await client.post(
            "/v1/chat/stream", json={"message": "I bought 2 lemons", "conversation_id": CONV}
        )

    assert resp.status_code == 200
    assert "event: envelope" in resp.text
    saves = _assistant_saves(log)
    assert len(saves) == 1, "exactly one assistant save"
    assert saves[0]["metadata"]["request_id"] == RID_A
    assert saves[0]["metadata"]["clarification_suggestions"] == []
    assert saves[0]["proposal"] == {"actions": [_nested("lemon", 2)]}
    assert saves[0]["content"] == "Got it! Adding 2 lemons."
    save_pos = next(i for i, e in enumerate(log) if e[0] == "save" and e[1] == "assistant")
    assert save_pos < log.index(("after_envelope",)), (
        "the assistant turn must be saved before the envelope reaches the client"
    )


@pytest.mark.asyncio
async def test_b12_zero_action_pantry_turn_is_stamped_and_saved_early(
    client: AsyncClient,
) -> None:
    log: list[Any] = []
    env = _envelope("pantry_update", RID_B, {"actions": []})
    with patch(_STREAM_PATCH, side_effect=_stream_for(env, log)), patch(
        "bubbly_chef.api.routes.chat.get_repository",
        new_callable=AsyncMock,
        return_value=_logging_repo(log),
    ):
        await client.post("/v1/chat/stream", json={"message": "veggies", "conversation_id": CONV})

    saves = _assistant_saves(log)
    assert len(saves) == 1
    assert saves[0]["metadata"] == {"request_id": RID_B}
    save_pos = next(i for i, e in enumerate(log) if e[0] == "save" and e[1] == "assistant")
    assert save_pos < log.index(("after_envelope",))


@pytest.mark.asyncio
async def test_b12_other_intents_keep_the_tail_save_and_get_no_request_id(
    client: AsyncClient,
) -> None:
    log: list[Any] = []
    env = _envelope("general_chat", RID_C, None)
    with patch(_STREAM_PATCH, side_effect=_stream_for(env, log)), patch(
        "bubbly_chef.api.routes.chat.get_repository",
        new_callable=AsyncMock,
        return_value=_logging_repo(log),
    ):
        await client.post("/v1/chat/stream", json={"message": "hi", "conversation_id": CONV})

    saves = _assistant_saves(log)
    assert len(saves) == 1
    assert saves[0]["metadata"] is None
    save_pos = next(i for i, e in enumerate(log) if e[0] == "save" and e[1] == "assistant")
    assert save_pos > log.index(("after_envelope",))


@pytest.mark.asyncio
async def test_b12_a_pantry_turn_without_a_proposal_is_not_stamped(client: AsyncClient) -> None:
    log: list[Any] = []
    env = _envelope("pantry_update", RID_C, None)
    with patch(_STREAM_PATCH, side_effect=_stream_for(env, log)), patch(
        "bubbly_chef.api.routes.chat.get_repository",
        new_callable=AsyncMock,
        return_value=_logging_repo(log),
    ):
        await client.post("/v1/chat/stream", json={"message": "hi", "conversation_id": CONV})

    saves = _assistant_saves(log)
    assert len(saves) == 1
    assert saves[0]["metadata"] is None


@pytest.mark.asyncio
async def test_b12_a_failed_early_save_does_not_break_the_stream(client: AsyncClient) -> None:
    log: list[Any] = []
    env = _envelope("pantry_update", RID_A, {"actions": [_nested("lemon", 2)]})
    repo = MagicMock()
    repo.get_history = AsyncMock(return_value=[])

    async def _save(**kwargs: Any) -> None:
        if kwargs["role"] == "assistant":
            raise RuntimeError("db down")

    repo.save_message = _save
    with patch(_STREAM_PATCH, side_effect=_stream_for(env, log)), patch(
        "bubbly_chef.api.routes.chat.get_repository", new_callable=AsyncMock, return_value=repo
    ):
        resp = await client.post(
            "/v1/chat/stream", json={"message": "lemons", "conversation_id": CONV}
        )

    assert resp.status_code == 200
    assert "event: envelope" in resp.text
    assert "event: error" not in resp.text


@pytest.mark.asyncio
async def test_b12_non_streaming_stamps_request_id_on_pantry_turns_only(
    client: AsyncClient,
) -> None:
    for env, expect in (
        (_envelope("pantry_update", RID_A, {"actions": [_nested("lemon")]}), RID_A),
        (_envelope("pantry_update", RID_B, {"actions": []}), RID_B),
        (_envelope("general_chat", RID_C, None), None),
    ):
        log: list[Any] = []
        with patch(_STREAM_PATCH, side_effect=_stream_for(env, log)), patch(
            "bubbly_chef.api.routes.chat.get_repository",
            new_callable=AsyncMock,
            return_value=_logging_repo(log),
        ):
            resp = await client.post("/v1/chat", json={"message": "x", "conversation_id": CONV})

        assert resp.status_code == 200
        assert resp.json()["request_id"] == env["request_id"]
        (save,) = _assistant_saves(log)
        if expect is None:
            assert save["metadata"] is None
        else:
            assert save["metadata"]["request_id"] == expect
