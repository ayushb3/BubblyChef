"""Issue #677 -- chat pantry `use` and `update` proposals left `quantity_base`
stale (and "used 2 eggs" from "1 dozen" deleted the row).

`apply_pantry_proposal` is the AI service's write path for chat proposals
(`POST /v1/workflows/apply`). Its `use` branch subtracted the action's number
from the displayed quantity, ignoring the action's unit, and wrote only
`quantity`; its `update` branch never re-derived the base. The next cook then
deducted from the stale base. Same bug as issue #669, on this side of the wire.
"""

from __future__ import annotations

from typing import Any

import pytest

from bubbly_chef.prompts.pantry import PANTRY_PARSE_SYSTEM_PROMPT
from tests.test_issue_541_apply_response_affected_ids import _EXISTING_ROW, _repo


def _row(**over: Any) -> dict[str, Any]:
    return dict(_EXISTING_ROW, **over)


async def _apply(
    existing: dict[str, Any], action: dict[str, Any]
) -> tuple[int, int, list[str], dict[str, Any]]:
    repo = _repo(existing_by_name={existing["name"]: existing})
    applied, failed, errors, _ids = await repo.apply_pantry_proposal(user_id="u1", actions=[action])
    return applied, failed, errors, repo.client.store  # type: ignore[attr-defined,no-any-return]


@pytest.mark.asyncio
class TestUseSameUnit:
    async def test_writes_a_base_that_matches_the_new_quantity(self) -> None:
        existing = _row(
            name="eggs",
            category="dairy",
            quantity=12.0,
            unit="item",
            quantity_base=12.0,
            unit_base="count",
        )
        applied, failed, errors, store = await _apply(
            existing,
            {"action": "use", "name": "eggs", "quantity": 2, "unit": "item", "category": "dairy"},
        )

        assert (applied, failed, errors) == (1, 0, [])
        assert store["updates"] == [{"quantity": 10.0, "quantity_base": 10, "unit_base": "count"}]

    async def test_underivable_base_is_written_as_none_not_left_stale(self) -> None:
        existing = _row(
            name="matcha",
            quantity=3.0,
            unit="tbsp",
            quantity_base=99.0,
            unit_base="g",
        )
        applied, failed, _errors, store = await _apply(
            existing, {"action": "use", "name": "matcha", "quantity": 1, "unit": "tbsp"}
        )

        assert (applied, failed) == (1, 0)
        (payload,) = store["updates"]
        assert payload["quantity"] == 2.0
        assert "quantity_base" in payload and payload["quantity_base"] is None
        assert "unit_base" in payload and payload["unit_base"] is None


@pytest.mark.asyncio
class TestUseDifferentUnits:
    async def test_two_items_from_a_dozen_keeps_the_row(self) -> None:
        existing = _row(
            name="eggs",
            category="dairy",
            quantity=1.0,
            unit="dozen",
            quantity_base=12.0,
            unit_base="count",
        )
        applied, failed, errors, store = await _apply(
            existing,
            {"action": "use", "name": "eggs", "quantity": 2, "unit": "item", "category": "dairy"},
        )

        assert (applied, failed, errors) == (1, 0, [])
        assert store["deletes"] == []
        (payload,) = store["updates"]
        assert payload["quantity"] == pytest.approx(0.8333, abs=1e-4)
        assert payload["quantity_base"] == pytest.approx(10.0)
        assert payload["unit_base"] == "count"

    async def test_null_stored_base_is_derived_from_the_display(self) -> None:
        existing = _row(
            name="eggs",
            category="dairy",
            quantity=1.0,
            unit="dozen",
            quantity_base=None,
            unit_base=None,
        )
        applied, failed, _errors, store = await _apply(
            existing,
            {"action": "use", "name": "eggs", "quantity": 2, "unit": "item", "category": "dairy"},
        )

        assert (applied, failed) == (1, 0)
        (payload,) = store["updates"]
        assert payload["quantity"] == pytest.approx(0.8333, abs=1e-4)
        assert payload["quantity_base"] == pytest.approx(10.0)
        assert payload["unit_base"] == "count"

    async def test_a_stale_stored_base_is_ignored_in_favour_of_the_display(self) -> None:
        # 0.5 dozen is 6 eggs; the stored 12 is drift from the old `use` path.
        existing = _row(
            name="eggs",
            category="dairy",
            quantity=0.5,
            unit="dozen",
            quantity_base=12.0,
            unit_base="count",
        )
        applied, failed, _errors, store = await _apply(
            existing,
            {"action": "use", "name": "eggs", "quantity": 2, "unit": "item", "category": "dairy"},
        )

        assert (applied, failed) == (1, 0)
        (payload,) = store["updates"]
        assert payload["quantity_base"] == pytest.approx(4.0)
        assert payload["quantity"] == pytest.approx(0.3333, abs=1e-4)

    async def test_one_then_eleven_from_a_dozen_deletes_the_row(self) -> None:
        """The display is stored rounded to 4 places; re-deriving the base from it
        must not leave 0.0004 dozen behind."""
        row = _row(
            name="eggs",
            category="dairy",
            quantity=1.0,
            unit="dozen",
            quantity_base=12.0,
            unit_base="count",
        )
        action = {"action": "use", "name": "eggs", "unit": "item", "category": "dairy"}

        _a, _f, _e, store = await _apply(row, dict(action, quantity=1))
        (payload,) = store["updates"]
        row.update(payload)
        assert row["quantity_base"] == pytest.approx(11.0)

        applied, failed, _errors, store = await _apply(row, dict(action, quantity=11))

        assert (applied, failed) == (1, 0)
        assert store["deletes"] == [row["id"]]
        assert store["updates"] == []

    async def test_twelve_single_uses_delete_the_row(self) -> None:
        row = _row(
            name="eggs",
            category="dairy",
            quantity=1.0,
            unit="dozen",
            quantity_base=12.0,
            unit_base="count",
        )
        action = {"action": "use", "name": "eggs", "quantity": 1, "unit": "item", "category": "dairy"}

        for i in range(11):
            applied, failed, _errors, store = await _apply(row, action)
            assert (applied, failed) == (1, 0)
            assert store["deletes"] == [], f"deleted early on use {i + 1}"
            row.update(store["updates"][0])
            assert row["quantity_base"] == pytest.approx(11 - i)

        applied, failed, _errors, store = await _apply(row, action)
        assert (applied, failed) == (1, 0)
        assert store["deletes"] == [row["id"]]

    async def test_a_sliver_of_base_left_is_treated_as_used_up(self) -> None:
        row = _row(
            name="eggs",
            category="dairy",
            quantity=0.0001,
            unit="dozen",
            quantity_base=0.0012,
            unit_base="count",
        )
        applied, failed, _errors, store = await _apply(
            row, {"action": "use", "name": "eggs", "quantity": 0.0005, "unit": "item"}
        )

        assert (applied, failed) == (1, 0)
        assert store["deletes"] == [row["id"]]

    async def test_using_the_whole_dozen_deletes_the_row(self) -> None:
        """Guard: main deletes here too."""
        existing = _row(
            name="eggs",
            category="dairy",
            quantity=1.0,
            unit="dozen",
            quantity_base=12.0,
            unit_base="count",
        )
        applied, failed, _errors, store = await _apply(
            existing,
            {"action": "use", "name": "eggs", "quantity": 12, "unit": "item", "category": "dairy"},
        )

        assert (applied, failed) == (1, 0)
        assert store["deletes"] == [existing["id"]]
        assert store["updates"] == []

    async def test_default_unit_falls_back_when_the_used_amount_cannot_convert(self) -> None:
        # The row's base derives (30 g); "2 item" of matcha has no piece weight.
        existing = _row(
            name="matcha", quantity=30.0, unit="g", quantity_base=30.0, unit_base="g"
        )
        applied, failed, errors, store = await _apply(
            existing, {"action": "use", "name": "matcha", "quantity": 2, "unit": "item"}
        )

        assert (applied, failed, errors) == (1, 0, [])
        (payload,) = store["updates"]
        assert payload["quantity"] == 28.0
        assert payload["quantity_base"] == 28.0
        assert payload["unit_base"] == "g"

    async def test_count_like_unit_falls_back_rather_than_refusing(self) -> None:
        existing = _row(
            name="carrots", quantity=500.0, unit="g", quantity_base=500.0, unit_base="g"
        )
        applied, failed, errors, store = await _apply(
            existing, {"action": "use", "name": "carrots", "quantity": 2, "unit": "pieces"}
        )

        assert (applied, failed, errors) == (1, 0, [])
        (payload,) = store["updates"]
        assert payload["quantity"] == 498.0
        assert payload["quantity_base"] == 498.0

    async def test_a_real_unit_that_cannot_convert_is_refused(self) -> None:
        existing = _row(
            name="spinach", quantity=200.0, unit="g", quantity_base=200.0, unit_base="g"
        )
        applied, failed, errors, store = await _apply(
            existing, {"action": "use", "name": "spinach", "quantity": 1, "unit": "handful"}
        )

        assert (applied, failed) == (0, 1)
        assert errors == ["Units don't match (handful vs g), edit the unit for: spinach"]
        assert store["updates"] == []
        assert store["deletes"] == []


@pytest.mark.asyncio
class TestUpdate:
    async def test_new_amount_and_unit_carry_a_current_base(self) -> None:
        existing = _row(
            name="flour",
            category="dry_goods",
            quantity=500.0,
            unit="g",
            quantity_base=500.0,
            unit_base="g",
        )
        applied, failed, _errors, store = await _apply(
            existing, {"action": "update", "name": "flour", "quantity": 1, "unit": "kg"}
        )

        assert (applied, failed) == (1, 0)
        (payload,) = store["updates"]
        assert payload["quantity"] == 1
        assert payload["unit"] == "kg"
        assert payload["quantity_base"] == pytest.approx(1000.0)
        assert payload["unit_base"] == "g"

    async def test_underivable_base_is_written_as_none(self) -> None:
        existing = _row(
            name="matcha", quantity=30.0, unit="g", quantity_base=30.0, unit_base="g"
        )
        applied, failed, _errors, store = await _apply(
            existing, {"action": "update", "name": "matcha", "quantity": 3, "unit": "tbsp"}
        )

        assert (applied, failed) == (1, 0)
        (payload,) = store["updates"]
        assert "quantity_base" in payload and payload["quantity_base"] is None
        assert "unit_base" in payload and payload["unit_base"] is None

    async def test_location_only_update_stays_base_neutral(self) -> None:
        """Guard: no quantity/unit key, so no base key."""
        existing = _row(
            name="carrot", quantity=3.0, unit="item", quantity_base=3.0, unit_base="count"
        )
        applied, failed, _errors, store = await _apply(
            existing, {"action": "update", "name": "carrot", "location": "pantry"}
        )

        assert (applied, failed) == (1, 0)
        (payload,) = store["updates"]
        assert "quantity_base" not in payload
        assert "unit_base" not in payload


class TestParsePrompt:
    def test_parse_prompt_reserves_remove_for_gone_items(self) -> None:
        prompt = PANTRY_PARSE_SYSTEM_PROMPT
        assert 'quantity = the amount used; unit as in rule 3, so "item" when' in prompt
        assert '"remove" only when the item is gone entirely' in prompt
        assert "all of it, the rest, or the last of it" in prompt
        assert 'Default unit to "item" if not specified' in prompt
        assert '"remove" for items used' not in prompt
        assert "as the user said it" not in prompt
