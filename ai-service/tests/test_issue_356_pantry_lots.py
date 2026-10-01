"""Issues #356 and #683 -- the same food held as several pantry lots.

#356 (Option A, decided 2026-09-13): each add of a food inserts its own row
with its own expiry, and everything that reads "how much do I have" sums the
rows. #683 (an add merging "1 dozen" onto "6 item" into a unit-blind 7) goes
away with the merge itself.

Covered here:
- the add path never merges, so no expiry is overwritten and no units are
  summed blind;
- the cook matcher sums every lot through the base unit, names the soonest
  lot as the match's row, and treats lots it can't convert explicitly;
- a deduction consumes the soonest lot first and carries any remainder into
  the next lot, which is what `apply_collapsed_deductions` (shared by
  /v1/recipes/cook/confirm and /v1/meals/cook/confirm) relies on.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest

from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.repository.supabase_repo import SupabaseRepository
from bubbly_chef.services.cook_matcher import match_ingredients
from bubbly_chef.services.meal_cook import apply_collapsed_deductions

RECIPE_ID = str(uuid.uuid4())
TODAY = date.today()


def _day(n: int) -> date:
    return TODAY + timedelta(days=n)


def _item(
    name: str,
    qty: float,
    unit: str,
    *,
    base: float | None = None,
    base_unit: str | None = None,
    expiry: date | None = None,
    age: int = 0,
) -> PantryItem:
    return PantryItem(
        id=uuid.uuid4(),
        name=name,
        category=FoodCategory.OTHER,
        storage_location=StorageLocation.PANTRY,
        quantity=qty,
        unit=unit,
        quantity_base=base,
        unit_base=base_unit,
        expiry_date=expiry,
        created_at=datetime.now(UTC) - timedelta(days=age),
        updated_at=datetime.now(UTC),
    )


def _match(pantry: list[PantryItem], ingredients: list[dict[str, Any]]) -> Any:
    return match_ingredients(RECIPE_ID, "Test", ingredients, pantry)


# ---------------------------------------------------------------------------
# In-memory pantry_items table behind the repository's PostgREST chain
# ---------------------------------------------------------------------------


class _Result:
    def __init__(self, data: list[dict[str, Any]]) -> None:
        self.data = data
        self.count = len(data)


class _Query:
    def __init__(self, rows: list[dict[str, Any]], log: dict[str, list[Any]]) -> None:
        self._rows = rows
        self._log = log
        self._op = "select"
        self._payload: dict[str, Any] = {}
        self._filters: list[tuple[str, Any]] = []
        self._limit: int | None = None

    def select(self, *_a: Any, **_k: Any) -> _Query:
        self._op = "select"
        return self

    def insert(self, payload: dict[str, Any]) -> _Query:
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, payload: dict[str, Any]) -> _Query:
        self._op = "update"
        self._payload = payload
        return self

    def delete(self) -> _Query:
        self._op = "delete"
        return self

    def eq(self, column: str, value: Any) -> _Query:
        self._filters.append((column, value))
        return self

    def limit(self, n: int) -> _Query:
        self._limit = n
        return self

    def order(self, *_a: Any, **_k: Any) -> _Query:
        return self

    def _matching(self) -> list[dict[str, Any]]:
        return [r for r in self._rows if all(r.get(c) == v for c, v in self._filters)]

    def execute(self) -> _Result:
        if self._op == "insert":
            row = {
                "id": str(uuid.uuid4()),
                "added_at": datetime.now(UTC).isoformat(),
                "updated_at": datetime.now(UTC).isoformat(),
                **self._payload,
            }
            self._rows.append(row)
            self._log["inserts"].append(dict(self._payload))
            return _Result([row])
        if self._op == "update":
            hit = self._matching()
            for row in hit:
                row.update(self._payload)
            self._log["updates"].append({"payload": dict(self._payload), "ids": [r["id"] for r in hit]})
            return _Result(hit)
        if self._op == "delete":
            hit = self._matching()
            for row in hit:
                self._rows.remove(row)
            return _Result(hit)
        hit = self._matching()
        return _Result(hit[: self._limit] if self._limit is not None else hit)


class _Client:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.log: dict[str, list[Any]] = {"inserts": [], "updates": []}

    def table(self, _name: str) -> _Query:
        return _Query(self.rows, self.log)


def _row(
    name: str,
    qty: float,
    unit: str,
    *,
    base: float | None = None,
    base_unit: str | None = None,
    expiry: date | None = None,
    age: int = 0,
    category: str = "other",
) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "user_id": "u1",
        "name": name,
        "name_normalized": name.lower().strip(),
        "category": category,
        "location": "pantry",
        "quantity": qty,
        "unit": unit,
        "quantity_base": base,
        "unit_base": base_unit,
        "expiry_date": expiry.isoformat() if expiry else None,
        "estimated_expiry": False,
        "slot_index": None,
        "added_at": (datetime.now(UTC) - timedelta(days=age)).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    }


def _repo(rows: list[dict[str, Any]]) -> tuple[SupabaseRepository, _Client]:
    repo = SupabaseRepository.__new__(SupabaseRepository)
    client = _Client(rows)
    repo.client = client  # type: ignore[assignment]
    return repo, client


# ---------------------------------------------------------------------------
# #356 half 1 / #683: adding a food that is already in the pantry
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestAddNeverMerges:
    async def test_new_add_keeps_its_own_expiry_and_leaves_the_old_lot_alone(self) -> None:
        old = _row("chicken", 1.0, "lb", base=453.6, base_unit="g", expiry=_day(7), age=6)
        repo, client = _repo([old])

        applied, failed, errors, ids = await repo.apply_pantry_proposal(
            "u1",
            [
                {
                    "action": "add",
                    "name": "chicken",
                    "quantity": 1,
                    "unit": "lb",
                    "expiry_date": _day(14).isoformat(),
                }
            ],
        )

        assert (applied, failed, errors) == (1, 0, [])
        assert client.log["updates"] == []  # the old lot is untouched
        assert len(client.rows) == 2
        assert client.rows[0]["expiry_date"] == _day(7).isoformat()
        new = client.rows[1]
        assert new["expiry_date"] == _day(14).isoformat()
        assert new["quantity"] == 1.0
        assert ids == [uuid.UUID(new["id"])]

    async def test_an_add_without_a_date_gets_its_own_estimate_not_the_old_lots(self) -> None:
        old = _row("chicken", 1.0, "lb", expiry=_day(1), age=6, category="meat")
        repo, client = _repo([old])

        await repo.apply_pantry_proposal(
            "u1", [{"action": "add", "name": "chicken", "quantity": 1, "unit": "lb", "category": "meat"}]
        )

        assert len(client.rows) == 2
        assert client.rows[0]["expiry_date"] == _day(1).isoformat()
        assert client.rows[1]["expiry_date"] != client.rows[0]["expiry_date"]

    async def test_a_dozen_onto_six_items_is_two_lots_not_a_blind_seven(self) -> None:
        old = _row("eggs", 6.0, "item", base=6.0, base_unit="count", category="dairy")
        repo, client = _repo([old])

        applied, failed, _errors, _ids = await repo.apply_pantry_proposal(
            "u1",
            [{"action": "add", "name": "eggs", "quantity": 1, "unit": "dozen", "category": "dairy"}],
        )

        assert (applied, failed) == (1, 0)
        assert client.log["updates"] == []
        assert [(r["quantity"], r["unit"]) for r in client.rows] == [(6.0, "item"), (1.0, "dozen")]
        # The new lot carries a base of its own, so a sum through the base is 18.
        assert client.rows[1]["quantity_base"] == pytest.approx(12.0)
        assert client.rows[1]["unit_base"] == "count"

    async def test_grams_next_to_kilograms_stay_separate_rows(self) -> None:
        old = _row("flour", 1.0, "kg", base=1000.0, base_unit="g")
        repo, client = _repo([old])

        await repo.apply_pantry_proposal(
            "u1", [{"action": "add", "name": "flour", "quantity": 500, "unit": "g"}]
        )

        assert client.log["updates"] == []
        assert [(r["quantity"], r["unit"]) for r in client.rows] == [(1.0, "kg"), (500.0, "g")]

    async def test_units_that_cannot_be_converted_do_not_make_a_garbage_sum(self) -> None:
        old = _row("spinach", 2.0, "bag")
        repo, client = _repo([old])

        await repo.apply_pantry_proposal(
            "u1", [{"action": "add", "name": "spinach", "quantity": 3, "unit": "cup"}]
        )

        assert client.log["updates"] == []
        assert [(r["quantity"], r["unit"]) for r in client.rows] == [(2.0, "bag"), (3.0, "cup")]


# ---------------------------------------------------------------------------
# #356 half 2: availability sums every lot
# ---------------------------------------------------------------------------


class TestAvailabilitySumsLots:
    def test_two_onion_rows_cover_a_recipe_for_five(self) -> None:
        pantry = [
            _item("onion", 2.0, "item", base=2.0, base_unit="count"),
            _item("onion", 3.0, "item", base=3.0, base_unit="count"),
        ]

        proposal = _match(pantry, [{"name": "onion", "quantity": 5.0, "unit": "item"}])

        (m,) = proposal.matches
        assert m.status == "ready"
        assert m.pantry_qty_available == pytest.approx(5.0)
        assert m.deduct_qty == pytest.approx(5.0)
        assert m.shortfall is None

    def test_a_shortfall_is_measured_against_the_total(self) -> None:
        pantry = [
            _item("onion", 2.0, "item", base=2.0, base_unit="count"),
            _item("onion", 3.0, "item", base=3.0, base_unit="count"),
        ]

        proposal = _match(pantry, [{"name": "onion", "quantity": 7.0, "unit": "item"}])

        (m,) = proposal.matches
        assert m.status == "shortfall"
        assert m.shortfall == pytest.approx(2.0)
        assert m.pantry_qty_available == pytest.approx(5.0)
        assert m.deduct_qty == pytest.approx(5.0)

    def test_lots_in_different_units_sum_through_the_base_unit(self) -> None:
        # 6 loose eggs + 1 dozen = 18 eggs, not 7 and not 12.
        pantry = [
            _item("eggs", 6.0, "item", base=6.0, base_unit="count"),
            _item("eggs", 1.0, "dozen", base=12.0, base_unit="count"),
        ]

        proposal = _match(pantry, [{"name": "eggs", "quantity": 15.0, "unit": "item"}])

        (m,) = proposal.matches
        assert m.status == "ready"
        assert m.pantry_qty_available == pytest.approx(18.0)
        assert m.deduct_qty == pytest.approx(15.0)
        assert m.base_unit == "count"

    def test_a_lot_with_no_stored_base_is_derived_like_any_other(self) -> None:
        pantry = [
            _item("flour", 1.0, "kg"),  # Next.js rows can carry no base values
            _item("flour", 500.0, "g", base=500.0, base_unit="g"),
        ]

        proposal = _match(pantry, [{"name": "flour", "quantity": 1400.0, "unit": "g"}])

        (m,) = proposal.matches
        assert m.status == "ready"
        assert m.pantry_qty_available == pytest.approx(1500.0)

    def test_the_match_names_the_soonest_expiring_lot(self) -> None:
        later = _item("milk", 500.0, "ml", base=500.0, base_unit="ml", expiry=_day(9))
        sooner = _item("milk", 500.0, "ml", base=500.0, base_unit="ml", expiry=_day(2))
        undated = _item("milk", 500.0, "ml", base=500.0, base_unit="ml")

        proposal = _match(
            [undated, later, sooner], [{"name": "milk", "quantity": 100.0, "unit": "ml"}]
        )

        assert proposal.matches[0].pantry_item_id == sooner.id

    def test_an_empty_lot_is_never_the_named_row_while_a_stocked_one_exists(self) -> None:
        empty = _item("milk", 0.0, "ml", base=0.0, base_unit="ml", expiry=_day(1))
        stocked = _item("milk", 500.0, "ml", base=500.0, base_unit="ml", expiry=_day(5))

        proposal = _match([empty, stocked], [{"name": "milk", "quantity": 100.0, "unit": "ml"}])

        assert proposal.matches[0].pantry_item_id == stocked.id
        assert proposal.matches[0].status == "ready"

    def test_two_recipe_lines_for_one_food_share_the_summed_stock(self) -> None:
        pantry = [
            _item("onion", 2.0, "item", base=2.0, base_unit="count"),
            _item("onion", 3.0, "item", base=3.0, base_unit="count"),
        ]

        proposal = _match(
            pantry,
            [
                {"name": "onion", "quantity": 3.0, "unit": "item"},
                {"name": "onion", "quantity": 3.0, "unit": "item"},
            ],
        )

        first, second = proposal.matches
        assert first.status == "ready" and first.deduct_qty == pytest.approx(3.0)
        assert second.status == "shortfall"
        assert second.pantry_qty_available == pytest.approx(2.0)
        assert second.shortfall == pytest.approx(1.0)

    def test_lots_the_matcher_cannot_convert_are_left_out_and_never_invented(self) -> None:
        # "a handful" of spinach has no base unit at all. The 200 g lot is measurable.
        bag = _item("spinach", 1.0, "handful")
        grams = _item("spinach", 200.0, "g", base=200.0, base_unit="g")

        covered = _match([bag, grams], [{"name": "spinach", "quantity": 150.0, "unit": "g"}])
        assert covered.matches[0].status == "ready"
        assert covered.matches[0].pantry_item_id == grams.id
        assert covered.matches[0].pantry_qty_available == pytest.approx(200.0)

        # Short on the measurable lots while an uncountable one exists: we can't
        # call that a shortfall, and nothing is auto-deducted.
        short = _match([bag, grams], [{"name": "spinach", "quantity": 300.0, "unit": "g"}])
        (m,) = short.matches
        assert m.status == "imprecise"
        assert m.deduct_qty is None
        assert m.shortfall is None

    def test_lots_with_a_different_base_unit_are_not_summed(self) -> None:
        # Eggs by count (soonest) next to a weighed lot. Grams and counts don't add.
        by_count = _item("eggs", 6.0, "item", base=6.0, base_unit="count", expiry=_day(3))
        by_weight = _item("eggs", 300.0, "g", base=300.0, base_unit="g", expiry=_day(6))

        proposal = _match([by_weight, by_count], [{"name": "eggs", "quantity": 4.0, "unit": "item"}])

        (m,) = proposal.matches
        assert m.status == "ready"
        assert m.pantry_qty_available == pytest.approx(6.0)  # not 306
        assert m.base_unit == "count"

    def test_single_row_behaviour_is_unchanged(self) -> None:
        pantry = [_item("eggs", 12.0, "count", base=12.0, base_unit="count")]

        proposal = _match(pantry, [{"name": "eggs", "quantity": 2.0, "unit": "count"}])

        (m,) = proposal.matches
        assert (m.status, m.deduct_qty, m.pantry_qty_available) == ("ready", 2.0, 12.0)
        assert m.pantry_item_id == pantry[0].id


# ---------------------------------------------------------------------------
# Deduction: soonest lot first, remainder carried to the next lot
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestDeductionAcrossLots:
    async def test_five_onions_take_the_sooner_lot_then_the_rest(self) -> None:
        sooner = _row("onion", 2.0, "item", base=2.0, base_unit="count", expiry=_day(2))
        later = _row("onion", 3.0, "item", base=3.0, base_unit="count", expiry=_day(9))
        repo, client = _repo([later, sooner])

        assert await repo.deduct_pantry_item("u1", sooner["id"], 4.0) is True

        assert sooner["quantity_base"] == pytest.approx(0.0)
        assert later["quantity_base"] == pytest.approx(1.0)
        assert later["quantity"] == pytest.approx(1.0)

    async def test_the_undated_lot_is_consumed_last(self) -> None:
        dated = _row("onion", 1.0, "item", base=1.0, base_unit="count", expiry=_day(4))
        undated = _row("onion", 5.0, "item", base=5.0, base_unit="count")
        third = _row("onion", 2.0, "item", base=2.0, base_unit="count", expiry=_day(8))
        repo, _client = _repo([undated, third, dated])

        await repo.deduct_pantry_item("u1", dated["id"], 3.0)

        assert dated["quantity_base"] == pytest.approx(0.0)
        assert third["quantity_base"] == pytest.approx(0.0)
        assert undated["quantity_base"] == pytest.approx(5.0)  # untouched

    async def test_a_remainder_is_carried_through_the_base_unit(self) -> None:
        # 6 loose eggs first, then a dozen: 10 eggs leaves 8 of the dozen's 12.
        loose = _row("eggs", 6.0, "item", base=6.0, base_unit="count", expiry=_day(2))
        dozen = _row("eggs", 1.0, "dozen", base=12.0, base_unit="count", expiry=_day(7))
        repo, _client = _repo([loose, dozen])

        await repo.deduct_pantry_item("u1", loose["id"], 10.0)

        assert loose["quantity_base"] == pytest.approx(0.0)
        assert dozen["quantity_base"] == pytest.approx(8.0)
        assert dozen["quantity"] == pytest.approx(8.0 / 12.0, abs=1e-3)

    async def test_lots_of_another_base_unit_or_food_are_never_touched(self) -> None:
        onion = _row("onion", 1.0, "item", base=1.0, base_unit="count", expiry=_day(2))
        weighed = _row("onion", 400.0, "g", base=400.0, base_unit="g", expiry=_day(3))
        shallot = _row("shallot", 4.0, "item", base=4.0, base_unit="count", expiry=_day(3))
        repo, _client = _repo([onion, weighed, shallot])

        await repo.deduct_pantry_item("u1", onion["id"], 3.0)

        assert onion["quantity_base"] == pytest.approx(0.0)
        assert weighed["quantity_base"] == pytest.approx(400.0)
        assert shallot["quantity_base"] == pytest.approx(4.0)

    async def test_a_deduction_that_fits_one_row_touches_only_that_row(self) -> None:
        sooner = _row("onion", 2.0, "item", base=2.0, base_unit="count", expiry=_day(2))
        later = _row("onion", 3.0, "item", base=3.0, base_unit="count", expiry=_day(9))
        repo, client = _repo([sooner, later])

        await repo.deduct_pantry_item("u1", sooner["id"], 1.0)

        assert [u["ids"] for u in client.log["updates"]] == [[sooner["id"]]]

    async def test_cook_confirm_and_meal_confirm_share_the_spill(self) -> None:
        # apply_collapsed_deductions is the one apply path for both confirm routes.
        sooner = _row("onion", 2.0, "item", base=2.0, base_unit="count", expiry=_day(2))
        later = _row("onion", 3.0, "item", base=3.0, base_unit="count", expiry=_day(9))
        repo, _client = _repo([sooner, later])
        from bubbly_chef.models.cook import DeductionItem

        applied, requested, skipped = await apply_collapsed_deductions(
            repo,
            "u1",
            [
                DeductionItem(pantry_item_id=uuid.UUID(sooner["id"]), deduct_qty=3.0, base_unit="count"),
                DeductionItem(pantry_item_id=uuid.UUID(sooner["id"]), deduct_qty=1.0, base_unit="count"),
            ],
        )

        assert (applied, requested, skipped) == (1, 1, [])
        assert sooner["quantity_base"] == pytest.approx(0.0)
        assert later["quantity_base"] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Rows that chat use/update/remove act on
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestFindSimilarItemPicksTheSoonestLot:
    async def test_the_sooner_stocked_lot_wins(self) -> None:
        later = _row("onion", 3.0, "item", expiry=_day(9))
        empty = _row("onion", 0.0, "item", expiry=_day(1))
        sooner = _row("onion", 2.0, "item", expiry=_day(2))
        repo, _client = _repo([later, empty, sooner])

        found = await repo.find_similar_item("u1", "onion")

        assert found is not None and str(found.id) == sooner["id"]


# ---------------------------------------------------------------------------
# Meal cook: two dishes drawing on the same food's lots
# ---------------------------------------------------------------------------


def _need(n: int) -> list[dict[str, Any]]:
    return [{"name": "onion", "quantity": float(n), "unit": "item"}]


class TestMealCookSumsLots:
    def test_two_dishes_share_the_total_across_a_foods_lots(self) -> None:
        from bubbly_chef.services.meal_cook import MealCookDishMeta, merge_meal_matches

        pantry = [
            _item("onion", 2.0, "item", base=2.0, base_unit="count", expiry=_day(2)),
            _item("onion", 3.0, "item", base=3.0, base_unit="count", expiry=_day(9)),
        ]
        dish_a = MealCookDishMeta(recipe_id=uuid.uuid4(), dish_title="A")
        dish_b = MealCookDishMeta(recipe_id=uuid.uuid4(), dish_title="B")

        merged = merge_meal_matches(
            [(dish_a, _match(pantry, _need(3))), (dish_b, _match(pantry, _need(2)))]
        )

        (line,) = merged.matches
        assert line.status == "ready"
        assert line.pantry_qty_available == pytest.approx(5.0)
        assert line.deduct_qty == pytest.approx(5.0)
        assert line.pantry_item_id == pantry[0].id  # the soonest lot

        over = merge_meal_matches(
            [(dish_a, _match(pantry, _need(3))), (dish_b, _match(pantry, _need(3)))]
        )
        assert over.matches[0].status == "shortfall"
        assert over.matches[0].shortfall == pytest.approx(1.0)
