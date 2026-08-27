"""Unit tests for SupabaseRepository.deduct_pantry_item.

The cook-route tests mock this method out entirely, so its own arithmetic was
never exercised. It matters because `deduct_qty` arrives in the item's *base*
unit while the row stores a display quantity — and rows created through the
Next.js CRUD routes carry no base values at all.
"""

from __future__ import annotations

from typing import Any

import pytest

from bubbly_chef.repository.supabase_repo import SupabaseRepository


class _FakeQuery:
    """Records update payloads and replays a canned select result."""

    def __init__(self, store: dict[str, Any], row: dict[str, Any] | None) -> None:
        self._store = store
        self._row = row

    def select(self, *_args: Any, **_kwargs: Any) -> _FakeQuery:
        return self

    def update(self, payload: dict[str, Any]) -> _FakeQuery:
        self._store["updates"].append(payload)
        return self

    def eq(self, *_args: Any, **_kwargs: Any) -> _FakeQuery:
        return self

    def single(self) -> _FakeQuery:
        return self

    def execute(self) -> Any:
        return type("Result", (), {"data": self._row})()


class _FakeClient:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self.store: dict[str, Any] = {"updates": []}
        self._row = row

    def table(self, _name: str) -> _FakeQuery:
        return _FakeQuery(self.store, self._row)


def _repo_for(row: dict[str, Any] | None) -> tuple[SupabaseRepository, _FakeClient]:
    """Build a repository around a fake client, bypassing create_client()."""
    repo = SupabaseRepository.__new__(SupabaseRepository)
    client = _FakeClient(row)
    repo.client = client  # type: ignore[assignment]
    return repo, client


@pytest.mark.asyncio
class TestDeductPantryItem:
    async def test_deducts_against_recorded_base_quantity(self) -> None:
        """The straightforward case: base values already on the row."""
        repo, client = _repo_for(
            {
                "name": "butter",
                "quantity": 250.0,
                "unit": "g",
                "quantity_base": 250.0,
                "unit_base": "g",
            }
        )

        await repo.deduct_pantry_item(user_id="u1", item_id="i1", deduct_qty=50.0)

        assert client.store["updates"] == [{"quantity": 200.0, "quantity_base": 200.0}]

    async def test_derives_base_units_when_row_has_none(self) -> None:
        """Rows written by the Next.js routes have quantity_base NULL.

        Deducting 100 g from "2 kg" must not compute 2 - 100. The base quantity is
        derived (2 kg -> 2000 g), the deduction applied there, and the display
        quantity scaled by the same ratio.
        """
        repo, client = _repo_for(
            {
                "name": "salt",
                "quantity": 2.0,
                "unit": "kg",
                "quantity_base": None,
                "unit_base": None,
            }
        )

        await repo.deduct_pantry_item(user_id="u1", item_id="i1", deduct_qty=100.0)

        assert len(client.store["updates"]) == 1
        update = client.store["updates"][0]
        # 2 kg = 2000 g; 2000 - 100 = 1900 g remaining -> display 2 kg * 0.95 = 1.9 kg
        assert update["quantity_base"] == pytest.approx(1900.0)
        assert update["quantity"] == pytest.approx(1.9)
        assert update["unit_base"] == "g"
        # The whole point: the row is not wiped out.
        assert update["quantity"] > 0

    async def test_floors_at_zero_without_going_negative(self) -> None:
        repo, client = _repo_for(
            {
                "name": "butter",
                "quantity": 100.0,
                "unit": "g",
                "quantity_base": 100.0,
                "unit_base": "g",
            }
        )

        await repo.deduct_pantry_item(user_id="u1", item_id="i1", deduct_qty=500.0)

        update = client.store["updates"][0]
        assert update["quantity_base"] == 0.0
        assert update["quantity"] == 0.0

    async def test_skips_update_when_base_unit_is_underivable(self) -> None:
        """An ambiguous deduction unit must leave the row untouched.

        Writing the deduction against the display quantity would only be right by
        coincidence; an unchanged row is recoverable, a zeroed one is not.
        """
        repo, client = _repo_for(
            {
                "name": "mystery condiment",
                "quantity": 3.0,
                "unit": "splashes",
                "quantity_base": None,
                "unit_base": None,
            }
        )

        applied = await repo.deduct_pantry_item(user_id="u1", item_id="i1", deduct_qty=2.0)

        assert client.store["updates"] == []
        # The caller has to be able to tell a refusal from a success, or it will
        # report "Pantry updated!" over a row it deliberately left alone.
        assert applied is False

    async def test_missing_row_is_a_no_op(self) -> None:
        repo, client = _repo_for(None)

        applied = await repo.deduct_pantry_item(user_id="u1", item_id="nope", deduct_qty=1.0)

        assert client.store["updates"] == []
        assert applied is False

    async def test_applied_deduction_reports_true(self) -> None:
        repo, _client = _repo_for(
            {
                "name": "butter",
                "quantity": 250.0,
                "unit": "g",
                "quantity_base": 250.0,
                "unit_base": "g",
            }
        )

        assert await repo.deduct_pantry_item(user_id="u1", item_id="i1", deduct_qty=50.0) is True

    async def test_base_is_derived_from_the_normalized_name(self) -> None:
        """The row name must be normalized the way cook_matcher normalizes it.

        The matcher computes deduct_qty against a base derived from
        normalize_food_name(row.name); deriving here from the raw name can pick a
        different density, so the amount would be applied against a base it was
        never computed from. Whatever normalize_food_name() maps a name to, both
        sides must agree — this pins them together without asserting a particular
        density value.
        """
        from bubbly_chef.domain.normalizer import normalize_food_name, normalize_to_base_unit

        raw = "Organic Extra Virgin Olive Oil"
        expected_base, expected_unit = normalize_to_base_unit(
            name=normalize_food_name(raw).lower().strip(),
            quantity=500.0,
            unit="g",
        )
        assert expected_base is not None and expected_unit is not None

        repo, client = _repo_for(
            {
                "name": raw,
                "quantity": 500.0,
                "unit": "g",
                "quantity_base": None,
                "unit_base": None,
            }
        )

        assert await repo.deduct_pantry_item(user_id="u1", item_id="i1", deduct_qty=10.0) is True

        update = client.store["updates"][0]
        assert update["quantity_base"] == pytest.approx(expected_base - 10.0)
        assert update["unit_base"] == expected_unit
