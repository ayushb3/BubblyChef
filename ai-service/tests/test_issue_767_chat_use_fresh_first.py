"""Issue #767 -- chat `use` spent an expired lot before a fresh one.

Cook deduction spends unexpired lots soonest-expiry first and an expired lot only
after every fresh one (#756). Chat `use` (#711) sorted by expiry alone, so an
already-expired carton went first. Both now order lots with `fresh_first_key`,
and ONE table of lot scenarios is run through both paths, so they cannot drift.

Each scenario is `(lots, amount used, stock left per lot)`, where a lot is
`(quantity, expiry offset in days from today)`; a negative offset is expired,
0 is expiring today (still fresh) and `None` is undated.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from bubbly_chef.models.cook import DeductionItem
from bubbly_chef.services.cook_matcher import match_ingredients
from bubbly_chef.services.meal_cook import apply_collapsed_deductions
from tests.test_issue_356_pantry_lots import _day, _repo, _row

Lot = tuple[float, int | None]

SCENARIOS: dict[str, tuple[list[Lot], float, list[float]]] = {
    # The issue: an expired and a fresh carton, one use.
    "expired and fresh: the fresh one is spent": ([(6, -3), (6, 5)], 2, [6, 4]),
    "fresh listed first": ([(6, 5), (6, -3)], 2, [4, 6]),
    "fresh lots go soonest expiry first": ([(6, -3), (6, 9), (6, 4)], 2, [6, 6, 4]),
    "an overflow drains fresh lots before touching the expired one": (
        [(6, -3), (3, 5), (3, 8)],
        8,
        [4, 0, 0],
    ),
    "a lot expiring today is still fresh": ([(6, -1), (6, 0)], 2, [6, 4]),
    "an undated lot is spent before an expired one": ([(6, -3), (6, None)], 2, [6, 4]),
    "a dated fresh lot is spent before an undated one": ([(6, None), (6, 5)], 2, [6, 4]),
    "every lot expired: the soonest expiry goes first": ([(6, -2), (6, -9)], 2, [6, 4]),
    "the only lot being expired is still spent": ([(6, -3)], 2, [4]),
    "using more than all stock empties the expired lot last": ([(2, -3), (3, 5)], 5, [0, 0]),
}


def _fill(lots: list[Lot]) -> list[dict[str, Any]]:
    # `age` keeps a stable purchase order so only expiry decides the spend order.
    return [
        _row(
            "eggs",
            qty,
            "item",
            base=qty,
            base_unit="count",
            expiry=_day(offset) if offset is not None else None,
            age=10 - i,
        )
        for i, (qty, offset) in enumerate(lots)
    ]


def _left(rows: list[dict[str, Any]], original: list[dict[str, Any]]) -> list[float]:
    by_id = {r["id"]: r["quantity"] for r in rows}
    return [by_id.get(r["id"], 0.0) for r in original]  # a used-up lot may be deleted


@pytest.mark.asyncio
@pytest.mark.parametrize(("lots", "used", "left"), SCENARIOS.values(), ids=SCENARIOS.keys())
async def test_chat_use_spends_lots_in_the_expected_order(
    lots: list[Lot], used: float, left: list[float]
) -> None:
    rows = _fill(lots)
    original = [dict(r) for r in rows]
    repo, client = _repo(rows)

    result = await repo.apply_pantry_proposal_detailed(
        "u1", [{"action": "use", "name": "eggs", "quantity": used, "unit": "item"}]
    )

    assert (result.applied, result.failed) == (1, 0)
    assert _left(client.rows, original) == pytest.approx(left)


@pytest.mark.asyncio
@pytest.mark.parametrize(("lots", "used", "left"), SCENARIOS.values(), ids=SCENARIOS.keys())
async def test_cook_deduction_spends_lots_in_the_same_order(
    lots: list[Lot], used: float, left: list[float]
) -> None:
    rows = _fill(lots)
    original = [dict(r) for r in rows]
    repo, client = _repo(rows)
    pantry = [repo._row_to_pantry_item(r) for r in rows]

    proposal = match_ingredients(
        str(uuid.uuid4()),
        "Test",
        [{"name": "eggs", "quantity": used, "unit": "item"}],
        pantry,
        None,
    )
    deductions = [
        DeductionItem(pantry_item_id=m.pantry_item_id, deduct_qty=m.deduct_qty, base_unit="count")
        for m in proposal.matches
        if m.pantry_item_id is not None and m.deduct_qty is not None
    ]
    # More than the pantry holds is a shortfall for the matcher; the deduction
    # itself still floors at zero, which is what the scenario pins.
    if not deductions:
        pytest.skip("the matcher names no lot for a recipe larger than the pantry")
    await apply_collapsed_deductions(repo, "u1", deductions)

    assert _left(client.rows, original) == pytest.approx(left)
