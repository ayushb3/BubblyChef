"""Issue #711, follow-up to #444 -- a write that fails part-way through a chat
`use` spread over several lots.

The use is planned in full first, then written lot by lot. If a write fails after
earlier ones landed, those are put back and the action fails with nothing applied
(a retry spends once). If putting them back fails as well, the stock is already
part-spent, so the action is recorded as applied and the proposal-state guard
(#444) refuses the retry: under-reporting stock beats spending it twice.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from bubbly_chef.repository.supabase_repo import SupabaseRepository, _PantryUsePlan
from bubbly_chef.services.proposal_review import proposal_action_key, review_after_apply
from tests.test_issue_356_pantry_lots import _Client, _day, _repo
from tests.test_issue_711_chat_use_across_lots import _onions, _stock, _use


def _fail_writes_for(repo: SupabaseRepository, row_id: str, *, times: int = 1_000) -> None:
    """Make update/delete of one row raise (the first `times` calls)."""
    budget = {"left": times}
    real_update = repo.update_pantry_item
    real_delete = repo.delete_pantry_item

    async def _update(user_id: str, item_id: str, updates: dict[str, Any]) -> Any:
        if item_id == row_id and budget["left"] > 0:
            budget["left"] -= 1
            raise RuntimeError("write blew up")
        return await real_update(user_id, item_id, updates)

    async def _delete(user_id: str, item_id: str) -> bool:
        if item_id == row_id and budget["left"] > 0:
            budget["left"] -= 1
            raise RuntimeError("write blew up")
        return await real_delete(user_id, item_id)

    repo.update_pantry_item = _update  # type: ignore[method-assign]
    repo.delete_pantry_item = _delete  # type: ignore[method-assign]


def _fail_inserts(client: _Client) -> None:
    """Make re-inserting a row fail, so a rollback can't put a deleted lot back."""
    real_table = client.table

    def _table(name: str) -> Any:
        query = real_table(name)

        def _insert(_payload: dict[str, Any]) -> Any:
            raise RuntimeError("insert blew up")

        query.insert = _insert  # type: ignore[method-assign]
        return query

    client.table = _table  # type: ignore[method-assign]


@pytest.mark.asyncio
class TestFailedWriteRollsBack:
    async def test_a_failure_on_lot_2_restores_lot_1_exactly(self) -> None:
        rows = _onions((2, _day(3)), (3, _day(10)))
        first, second = rows
        first_before = dict(first)
        second_before = dict(second)
        repo, client = _repo(rows)
        _fail_writes_for(repo, second["id"])

        result = await _use(repo, 4)  # lot 1 is deleted, then lot 2's write fails

        assert (result.applied, result.failed) == (0, 1)
        assert result.failed_indices == [0]
        assert "write blew up" in result.errors[0]
        assert result.affected_item_ids == []
        by_id = {r["id"]: r for r in client.rows}
        assert by_id[first["id"]] == first_before  # re-inserted with its id and every field
        assert by_id[second["id"]] == second_before
        assert len(client.rows) == 2

    async def test_a_lot_that_was_only_reduced_is_written_back(self) -> None:
        rows = _onions((2, _day(3)), (3, _day(10)))
        first, second = rows
        repo, client = _repo(rows)
        lots = await repo.find_food_lots("u1", "onion")
        raw = {lot.id: dict(r) for lot, r in zip(lots, rows, strict=True)}
        plan = [
            (
                lots[0],
                _PantryUsePlan(updates={"quantity": 1, "quantity_base": 1, "unit_base": "count"}),
            ),
            (lots[1], _PantryUsePlan()),
        ]
        _fail_writes_for(repo, second["id"])

        with pytest.raises(RuntimeError, match="write blew up"):
            await repo._write_use_plan("u1", plan, raw)

        assert first["quantity"] == 2 and first["quantity_base"] == 2
        assert second in client.rows and second["quantity"] == 3

    async def test_a_failed_rollback_is_recorded_as_applied_and_logged(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        rows = _onions((2, _day(3)), (3, _day(10)))
        first, second = rows
        repo, client = _repo(rows)
        _fail_writes_for(repo, second["id"])
        _fail_inserts(client)
        actions = [{"action": "use", "name": "onion", "quantity": 4, "unit": "item"}]

        with caplog.at_level("ERROR"):
            result = await repo.apply_pantry_proposal_detailed("u1", actions)

        # Part-spent and not restorable: applied, so a retry is refused, never re-spent.
        assert (result.applied, result.failed) == (1, 0)
        assert result.failed_indices == []
        assert {str(i) for i in result.affected_item_ids} == {first["id"], second["id"]}
        assert any(first["id"] in r.getMessage() for r in caplog.records)
        turn = {
            "request_id": "r1",
            "proposal": {"actions": [{"item": {"name": "onion"}}]},
            "metadata": None,
        }
        review = review_after_apply(
            turn, actions, result.failed_indices, result.failed_errors, ["r1"], datetime.now(UTC)
        )
        assert review.status == "applied"
        assert review.applied_keys == [proposal_action_key("onion")]

    async def test_a_retry_after_a_clean_rollback_applies_once(self) -> None:
        rows = _onions((2, _day(3)), (3, _day(10)))
        repo, client = _repo(rows)
        _fail_writes_for(repo, rows[1]["id"], times=1)  # only the first attempt fails

        first = await _use(repo, 4)
        assert (first.applied, first.failed) == (0, 1)
        assert _stock(client) == [2, 3]  # rolled back, nothing spent

        second = await _use(repo, 4)
        assert (second.applied, second.failed) == (1, 0)
        assert _stock(client) == [1]  # 4 spent once, from 5
