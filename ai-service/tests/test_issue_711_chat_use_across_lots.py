"""Issue #711 -- chat pantry `use` and `remove` acted on ONE lot of a food.

After #356 every add of a food is its own row (lot). Chat's `use` and `remove`
proposals went through `find_similar_item`, which returns the soonest lot only,
so "I used 5 onions" against lots of 2 and 3 used up the first lot and left 3
behind, and "remove onions" left the other lot on the shelf.

Settled in the issue: `use` consumes across lots the way the cook deduction does
(soonest expiry first, undated last, through the base unit); `remove` of a food
with several lots removes all of them, and the proposal card says so. `update`
is deliberately left on the soonest stocked lot (see TestUpdateStaysOnOneLot).
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import patch

import pytest

from bubbly_chef.models.base import NextAction
from bubbly_chef.models.pantry import (
    ActionType,
    FoodCategory,
    PantryItem,
    PantryUpsertAction,
)
from bubbly_chef.repository.supabase_repo import SupabaseRepository
from bubbly_chef.services.proposal_review import proposal_action_key, review_after_apply
from bubbly_chef.workflows.pantry import nodes as pantry_nodes
from tests.test_issue_356_pantry_lots import _Client, _day, _repo, _row


def _onions(*lots: tuple[float, Any]) -> list[dict[str, Any]]:
    """Onion lots of `(quantity, expiry)`, each in "item" with its own base."""
    return [
        _row("onion", qty, "item", base=qty, base_unit="count", expiry=expiry, age=10 - i)
        for i, (qty, expiry) in enumerate(lots)
    ]


def _stock(client: _Client, name: str = "onion") -> list[float]:
    """Remaining quantities of a food's rows, soonest expiry first."""
    rows = [r for r in client.rows if r["name"] == name]
    rows.sort(key=lambda r: (r["expiry_date"] is None, r["expiry_date"] or ""))
    return [r["quantity"] for r in rows]


async def _use(repo: SupabaseRepository, qty: float, unit: str = "item", name: str = "onion") -> Any:
    return await repo.apply_pantry_proposal_detailed(
        "u1", [{"action": "use", "name": name, "quantity": qty, "unit": unit}]
    )


@pytest.mark.asyncio
class TestUseAcrossLots:
    async def test_used_5_of_2_and_3_leaves_nothing_in_either_lot(self) -> None:
        rows = _onions((2, _day(3)), (3, _day(10)))
        repo, client = _repo(rows)
        ids = {r["id"] for r in rows}

        result = await _use(repo, 5)

        assert (result.applied, result.failed, result.errors) == (1, 0, [])
        assert _stock(client) == []
        # #541: every row the action touched is reported, not only the first.
        assert {str(i) for i in result.affected_item_ids} == ids

    async def test_used_4_empties_the_soonest_lot_and_leaves_1_in_the_other(self) -> None:
        rows = _onions((2, _day(3)), (3, _day(10)))
        repo, client = _repo(rows)
        sooner, later = rows

        result = await _use(repo, 4)

        assert (result.applied, result.failed) == (1, 0)
        assert sooner not in client.rows  # used up
        assert later in client.rows and later["quantity"] == 1
        assert later["quantity_base"] == 1  # the base stays in step
        assert {str(i) for i in result.affected_item_ids} == {sooner["id"], later["id"]}

    async def test_the_soonest_lot_goes_first_whatever_order_the_database_returns(self) -> None:
        later, sooner = _onions((3, _day(10)), (2, _day(3)))[0], _onions((3, _day(3)))[0]
        repo, client = _repo([later, sooner])

        await _use(repo, 1)

        assert sooner["quantity"] == 2
        assert later["quantity"] == 3  # untouched

    async def test_a_small_use_touches_only_the_soonest_lot(self) -> None:
        rows = _onions((2, _day(3)), (3, _day(10)))
        repo, client = _repo(rows)

        result = await _use(repo, 1)

        assert _stock(client) == [1, 3]
        assert [str(i) for i in result.affected_item_ids] == [rows[0]["id"]]

    async def test_undated_lots_are_used_last(self) -> None:
        undated = _row("onion", 3, "item", base=3, base_unit="count", age=10)
        dated = _row("onion", 2, "item", base=2, base_unit="count", expiry=_day(5), age=1)
        repo, client = _repo([undated, dated])

        await _use(repo, 3)

        assert dated not in client.rows  # the dated lot first, though it is newer
        assert undated["quantity"] == 2

    async def test_using_more_than_everything_clears_the_food_without_failing(self) -> None:
        repo, client = _repo(_onions((2, _day(3)), (3, _day(10))))

        result = await _use(repo, 8)

        assert (result.applied, result.failed) == (1, 0)
        assert _stock(client) == []

    async def test_an_empty_leftover_lot_is_never_the_one_used(self) -> None:
        empty = _row("onion", 0, "item", base=0, base_unit="count", expiry=_day(1), age=20)
        stocked = _onions((3, _day(6)))[0]
        repo, client = _repo([empty, stocked])

        await _use(repo, 2)

        assert stocked["quantity"] == 1
        assert empty in client.rows  # not deleted, not touched

    async def test_a_different_food_is_left_alone(self) -> None:
        rows = _onions((2, _day(3)), (3, _day(10)))
        garlic = _row("garlic", 4, "item", base=4, base_unit="count", expiry=_day(2))
        repo, client = _repo([*rows, garlic])

        await _use(repo, 5)

        assert garlic["quantity"] == 4

    async def test_another_users_lots_are_never_touched(self) -> None:
        mine = _onions((2, _day(3)))
        theirs = _row("onion", 9, "item", base=9, base_unit="count", expiry=_day(1))
        theirs["user_id"] = "someone-else"
        repo, client = _repo([*mine, theirs])

        await _use(repo, 5)

        assert theirs in client.rows and theirs["quantity"] == 9

    async def test_lots_in_different_units_go_through_the_base_unit(self) -> None:
        dozen = _row("eggs", 1, "dozen", base=12, base_unit="count", expiry=_day(3))
        loose = _row("eggs", 6, "item", base=6, base_unit="count", expiry=_day(10))
        repo, client = _repo([dozen, loose])

        # 14 eggs: the dozen (12) goes, then 2 come off the loose ones.
        result = await _use(repo, 14, name="eggs")

        assert (result.applied, result.failed) == (1, 0)
        assert dozen not in client.rows
        assert loose["quantity"] == 4 and loose["quantity_base"] == 4

    async def test_a_partial_use_of_a_dozen_keeps_its_display_and_base_in_step(self) -> None:
        dozen = _row("eggs", 1, "dozen", base=12, base_unit="count", expiry=_day(3))
        loose = _row("eggs", 6, "item", base=6, base_unit="count", expiry=_day(10))
        repo, client = _repo([dozen, loose])

        await _use(repo, 2, name="eggs")

        assert dozen["quantity_base"] == 10
        assert dozen["quantity"] == pytest.approx(0.83, abs=0.01)
        assert loose["quantity"] == 6

    async def test_a_use_no_lot_can_absorb_fails_without_writing(self) -> None:
        a = _row("spinach", 1, "bag", expiry=_day(2))
        b = _row("spinach", 2, "bag", expiry=_day(5))
        repo, client = _repo([a, b])

        result = await _use(repo, 3, unit="cup", name="spinach")

        assert (result.applied, result.failed) == (0, 1)
        assert "Units don't match" in result.errors[0]
        assert result.failed_indices == [0]
        assert result.affected_item_ids == []
        assert client.log["updates"] == [] and len(client.rows) == 2

    async def test_a_single_lot_behaves_exactly_as_before(self) -> None:
        rows = _onions((5, _day(3)))
        repo, client = _repo(rows)

        result = await _use(repo, 2)

        assert _stock(client) == [3]
        assert [str(i) for i in result.affected_item_ids] == [rows[0]["id"]]

    async def test_an_unknown_food_still_fails_as_not_found(self) -> None:
        repo, _client = _repo(_onions((2, _day(3))))

        result = await _use(repo, 1, name="leek")

        assert (result.applied, result.failed) == (0, 1)
        assert result.errors == ["Item not found: leek"]


@pytest.mark.asyncio
class TestRemoveAcrossLots:
    async def test_removing_a_food_clears_every_lot(self) -> None:
        rows = _onions((2, _day(3)), (3, _day(10)))
        garlic = _row("garlic", 4, "item", expiry=_day(2))
        repo, client = _repo([*rows, garlic])

        result = await repo.apply_pantry_proposal_detailed(
            "u1", [{"action": "remove", "name": "onion"}]
        )

        assert (result.applied, result.failed, result.errors) == (1, 0, [])
        assert client.rows == [garlic]
        assert {str(i) for i in result.affected_item_ids} == {r["id"] for r in rows}

    async def test_an_empty_leftover_lot_is_cleared_too(self) -> None:
        empty = _row("onion", 0, "item", base=0, base_unit="count", expiry=_day(1))
        stocked = _onions((3, _day(6)))[0]
        repo, client = _repo([empty, stocked])

        await repo.apply_pantry_proposal("u1", [{"action": "remove", "name": "onion"}])

        assert client.rows == []

    async def test_a_single_lot_and_an_unknown_food_behave_as_before(self) -> None:
        only = _onions((2, _day(3)))[0]
        repo, client = _repo([only])

        ok = await repo.apply_pantry_proposal_detailed("u1", [{"action": "remove", "name": "onion"}])
        gone = await repo.apply_pantry_proposal_detailed("u1", [{"action": "remove", "name": "onion"}])

        assert (ok.applied, ok.failed, client.rows) == (1, 0, [])
        assert (gone.applied, gone.failed) == (0, 1)
        assert gone.errors == ["Item not found for removal: onion"]


@pytest.mark.asyncio
class TestUpdateStaysOnOneLot:
    """Decision (#711): `update` edits the soonest stocked lot only."""

    async def test_update_quantity_rewrites_the_soonest_stocked_lot_and_no_other(self) -> None:
        rows = _onions((2, _day(3)), (3, _day(10)))
        repo, client = _repo(rows)

        result = await repo.apply_pantry_proposal_detailed(
            "u1", [{"action": "update", "name": "onion", "quantity": 4, "unit": "item"}]
        )

        assert (result.applied, result.failed) == (1, 0)
        assert _stock(client) == [4, 3]
        assert [str(i) for i in result.affected_item_ids] == [rows[0]["id"]]


@pytest.mark.asyncio
class TestProposalStateGuardWithMultiRowActions:
    """#444: `applied_keys` / failed rows are per proposal action, not per DB row."""

    @staticmethod
    def _turn() -> dict[str, Any]:
        names = ["onion", "garlic"]
        return {
            "request_id": "r1",
            "proposal": {"actions": [{"item": {"name": n}} for n in names]},
            "metadata": None,
        }

    async def test_one_action_over_two_lots_is_one_applied_key(self) -> None:
        from datetime import UTC, datetime

        repo, _client = _repo(_onions((2, _day(3)), (3, _day(10))))
        actions = [{"action": "use", "name": "onion", "quantity": 5, "unit": "item"}]

        result = await repo.apply_pantry_proposal_detailed("u1", actions)
        review = review_after_apply(
            self._turn(), actions, result.failed_indices, result.failed_errors, ["r1"],
            datetime.now(UTC),
        )

        assert result.applied == 1  # one action, although two rows changed
        assert review.applied_keys == [proposal_action_key("onion")]
        assert review.failed == []

    async def test_a_failing_multi_lot_action_keeps_its_index_and_does_not_hide_the_next(
        self,
    ) -> None:
        a = _row("spinach", 1, "bag", expiry=_day(2))
        b = _row("spinach", 2, "bag", expiry=_day(5))
        onions = _onions((2, _day(3)), (3, _day(10)))
        repo, client = _repo([a, b, *onions])
        actions = [
            {"action": "use", "name": "spinach", "quantity": 3, "unit": "cup"},
            {"action": "remove", "name": "onion"},
        ]

        result = await repo.apply_pantry_proposal_detailed("u1", actions)

        assert (result.applied, result.failed) == (1, 1)
        assert result.failed_indices == [0]
        assert [r["name"] for r in client.rows] == ["spinach", "spinach"]
        assert len(result.affected_item_ids) == 2  # both onion lots, nothing from spinach


def _remove_state(user_id: str = "u1") -> dict[str, Any]:
    item = PantryItem(
        id=uuid.uuid4(), name="onion", category=FoodCategory.PRODUCE, quantity=1, unit="item"
    )
    return {
        "user_id": user_id,
        "input_text": "I'm out of onions",
        "assistant_message": "I found 1 item to update: 1 item of onion.",
        "next_action": NextAction.NONE.value,
        "actions": [
            PantryUpsertAction(action_type=ActionType.REMOVE, item=item, confidence=0.9)
        ],
    }


@pytest.mark.asyncio
class TestRemoveProposalNamesTheLots:
    async def test_the_message_says_how_many_lots_a_remove_will_clear(self) -> None:
        rows = _onions((2, _day(3)), (3, _day(10)))
        repo, _client = _repo(rows)

        async def _get_repo() -> SupabaseRepository:
            return repo

        with patch.object(pantry_nodes, "get_repository", _get_repo):
            out = await pantry_nodes.finalize_pantry_proposal(_remove_state())

        message = out["assistant_message"]
        assert "2 lots" in message
        assert "2 item" in message and "3 item" in message
        assert out["proposal"] is not None

    async def test_a_single_lot_adds_nothing_to_the_message(self) -> None:
        repo, _client = _repo(_onions((2, _day(3))))

        async def _get_repo() -> SupabaseRepository:
            return repo

        state = _remove_state()
        with patch.object(pantry_nodes, "get_repository", _get_repo):
            out = await pantry_nodes.finalize_pantry_proposal(state)

        assert out["assistant_message"] == state["assistant_message"]

    async def test_a_failed_lookup_never_blocks_the_proposal(self) -> None:
        async def _boom() -> SupabaseRepository:
            raise RuntimeError("db down")

        state = _remove_state()
        with patch.object(pantry_nodes, "get_repository", _boom):
            out = await pantry_nodes.finalize_pantry_proposal(state)

        assert out["assistant_message"] == state["assistant_message"]
        assert len(out["proposal"].actions) == 1

    async def test_non_remove_proposals_never_touch_the_database(self) -> None:
        state = _remove_state()
        state["actions"][0].action_type = ActionType.ADD

        async def _boom() -> SupabaseRepository:
            raise AssertionError("must not be called")

        with patch.object(pantry_nodes, "get_repository", _boom):
            out = await pantry_nodes.finalize_pantry_proposal(state)

        assert out["assistant_message"] == state["assistant_message"]
