"""Issue #497 (Spec B.5, backend): the deterministic grocery-list derivation.

Pure-function tests for `bubbly_chef/domain/grocery.py` -- no DB, no LLM. The
two halves: `derive_candidates` (what the pantry + depletion events say the
user needs to buy) and `plan_regeneration` (how those candidates merge into the
lines already on the list without clobbering checked or manual ones).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

from bubbly_chef.domain.grocery import (
    Candidate,
    ExistingLine,
    derive_candidates,
    food_key,
    in_stock_keys,
    plan_meal_additions,
    plan_regeneration,
)
from bubbly_chef.models.pantry import FoodCategory, PantryItem

TODAY = date(2026, 9, 30)


def _item(
    name: str,
    quantity: float = 3.0,
    unit: str = "item",
    *,
    expires_in: int | None = None,
    category: FoodCategory = FoodCategory.OTHER,
    quantity_base: float | None = None,
    unit_base: str | None = None,
) -> PantryItem:
    return PantryItem(
        name=name,
        quantity=quantity,
        unit=unit,
        category=category,
        expiry_date=None if expires_in is None else TODAY + timedelta(days=expires_in),
        quantity_base=quantity_base,
        unit_base=unit_base,
    )


def _event(
    name: str,
    outcome: str = "used",
    quantity: float | None = 1.0,
    unit: str | None = "item",
    days_ago: int = 2,
) -> dict[str, Any]:
    created = datetime(2026, 9, 30, 12, tzinfo=UTC) - timedelta(days=days_ago)
    return {
        "item_name": name,
        "outcome": outcome,
        "quantity": quantity,
        "unit": unit,
        "created_at": created.isoformat(),
    }


def _by_key(cands: list[Candidate]) -> dict[str, Candidate]:
    return {c.name_key: c for c in cands}


class TestDeriveCandidates:
    def test_depleted_row_and_expiring_row_listed_fresh_row_not(self) -> None:
        items = [
            _item("eggs", 0, "item", category=FoodCategory.DAIRY),
            _item("milk", 1, "L", expires_in=1, category=FoodCategory.DAIRY),
            _item("rice", 3, "kg", expires_in=300),
        ]
        got = _by_key(derive_candidates(items, [], TODAY))
        assert set(got) == {"eggs", "milk"}
        assert got["eggs"].source == "depleted"
        assert got["eggs"].category == "dairy"
        assert got["milk"].source == "expiring"
        assert (got["milk"].quantity, got["milk"].unit) == (1.0, "L")

    def test_expired_row_with_stock_is_expiring(self) -> None:
        got = _by_key(derive_candidates([_item("spinach", 2, "bag", expires_in=-3)], [], TODAY))
        assert got["spinach"].source == "expiring"

    def test_expiring_boundary_is_one_day(self) -> None:
        items = [_item("yogurt", 2, expires_in=1), _item("cheese", 2, expires_in=2)]
        assert set(_by_key(derive_candidates(items, [], TODAY))) == {"yogurt"}

    def test_lots_aggregate_by_food_one_fresh_lot_means_not_needed(self) -> None:
        # Issue #356 Option A: separate rows that sum. A zero lot beside a full
        # lot is not a depleted food; an expiring lot beside a fresh one is not
        # an expiring food.
        items = [
            _item("eggs", 0, expires_in=None),
            _item("eggs", 12, expires_in=20),
            _item("milk", 1, "L", expires_in=0),
            _item("milk", 2, "L", expires_in=9),
        ]
        assert derive_candidates(items, [], TODAY) == []

    def test_lots_all_expiring_is_one_line(self) -> None:
        items = [_item("milk", 1, "L", expires_in=0), _item("milk", 2, "L", expires_in=1)]
        got = derive_candidates(items, [], TODAY)
        assert [c.name_key for c in got] == ["milk"]

    def test_dedupes_by_normalised_food_name(self) -> None:
        items = [_item("Eggs", 0), _item("eggs", 0)]
        got = derive_candidates(items, [], TODAY)
        assert len(got) == 1
        assert got[0].name_key == food_key("egg") == food_key("Eggs")

    def test_used_up_item_with_no_row_left_is_depleted_from_the_event(self) -> None:
        # Resolving an item ('used'/'cooked') deletes its pantry row, so the
        # only trace of the depletion is the pantry_events row.
        events = [_event("butter", "used", 250, "g", days_ago=3)]
        got = _by_key(derive_candidates([], events, TODAY))
        assert got["butter"].source == "depleted"
        assert (got["butter"].quantity, got["butter"].unit) == (250.0, "g")

    def test_cooked_event_counts_too(self) -> None:
        assert "onion" in _by_key(derive_candidates([], [_event("onion", "cooked")], TODAY))

    def test_tossed_event_is_not_a_depletion(self) -> None:
        assert derive_candidates([], [_event("lettuce", "tossed")], TODAY) == []

    def test_event_ignored_when_food_is_back_in_stock(self) -> None:
        events = [_event("butter", "used")]
        assert derive_candidates([_item("butter", 2, expires_in=30)], events, TODAY) == []

    def test_old_event_outside_the_window_is_ignored(self) -> None:
        assert derive_candidates([], [_event("butter", days_ago=90)], TODAY) == []

    def test_newest_event_with_a_quantity_supplies_the_suggestion(self) -> None:
        events = [
            _event("flour", "used", 1.0, "kg", days_ago=1),
            _event("flour", "used", None, None, days_ago=0),
            _event("flour", "used", 2.0, "kg", days_ago=9),
        ]
        got = _by_key(derive_candidates([], events, TODAY))
        assert (got["flour"].quantity, got["flour"].unit) == (1.0, "kg")

    def test_depleted_row_uses_latest_event_quantity_for_the_suggestion(self) -> None:
        items = [_item("eggs", 0, "item")]
        events = [_event("eggs", "cooked", 12, "item", days_ago=1)]
        got = _by_key(derive_candidates(items, events, TODAY))
        assert (got["eggs"].quantity, got["eggs"].unit) == (12.0, "item")

    def test_low_stock_by_base_unit_floor(self) -> None:
        items = [
            _item("lemons", 1, "item"),  # count <= 1
            _item("flour", 40, "g"),  # g <= 50
            _item("stock", 80, "ml"),  # ml <= 100
            _item("pasta", 500, "g"),  # plenty
            _item("limes", 4, "item"),  # plenty
        ]
        got = _by_key(derive_candidates(items, [], TODAY))
        assert {k: c.source for k, c in got.items()} == {
            "lemon": "low",  # keys are the normalised (singular) food name
            "flour": "low",
            "stock": "low",
        }

    def test_low_stock_sums_lots(self) -> None:
        items = [_item("flour", 40, "g"), _item("flour", 40, "g")]  # 80 g total > 50
        assert derive_candidates(items, [], TODAY) == []

    def test_unknown_unit_is_never_low(self) -> None:
        assert derive_candidates([_item("saffron", 1, "pinch-ish")], [], TODAY) == []

    def test_water_is_never_listed(self) -> None:
        assert derive_candidates([_item("water", 0)], [_event("ice", "used")], TODAY) == []

    def test_expiring_beats_low_for_one_food(self) -> None:
        items = [_item("milk", 1, "L", expires_in=-1)]
        assert derive_candidates(items, [], TODAY)[0].source == "expiring"

    def test_output_order_is_deterministic(self) -> None:
        items = [_item("zucchini", 0), _item("apples", 0), _item("milk", 0)]
        names = [c.name_key for c in derive_candidates(items, [], TODAY)]
        assert names == sorted(names)


class TestInStockKeys:
    def test_only_positive_unexpired_rows_count(self) -> None:
        items = [
            _item("eggs", 0),
            _item("milk", 2, expires_in=-1),
            _item("rice", 2, expires_in=1),  # expiring but still here
            _item("oats", 1),
        ]
        assert in_stock_keys(items, TODAY) == {"rice", "oats"}


def _line(
    key: str,
    source: str = "depleted",
    *,
    checked: bool = False,
    qty: float | None = None,
    line_id: str | None = None,
) -> ExistingLine:
    return ExistingLine(
        id=line_id or f"id-{key}",
        name=key,
        name_key=key,
        quantity=qty,
        unit=None,
        category="other",
        source=source,
        checked=checked,
    )


def _cand(key: str, source: str = "depleted", qty: float | None = 1.0) -> Candidate:
    return Candidate(
        name=key, name_key=key, category="other", quantity=qty, unit="item", source=source
    )


class TestPlanRegeneration:
    def test_new_candidates_are_inserted(self) -> None:
        plan = plan_regeneration([], [_cand("eggs")], set())
        assert [c.name_key for c in plan.inserts] == ["eggs"]
        assert plan.updates == [] and plan.deletes == []

    def test_manual_lines_survive_and_block_a_duplicate(self) -> None:
        existing = [_line("eggs", "manual")]
        plan = plan_regeneration(existing, [_cand("eggs"), _cand("milk")], set())
        assert [c.name_key for c in plan.inserts] == ["milk"]
        assert plan.updates == [] and plan.deletes == []

    def test_checked_lines_survive_whatever_their_source(self) -> None:
        existing = [_line("eggs", "depleted", checked=True), _line("kale", "low", checked=True)]
        plan = plan_regeneration(existing, [_cand("eggs")], {"kale"})
        assert plan.inserts == [] and plan.updates == [] and plan.deletes == []

    def test_unchecked_generated_line_is_refreshed_in_place(self) -> None:
        existing = [_line("milk", "low", qty=1.0, line_id="m1")]
        plan = plan_regeneration(existing, [_cand("milk", "expiring", qty=2.0)], set())
        assert plan.inserts == []
        assert [(i, c.source, c.quantity) for i, c in plan.updates] == [("m1", "expiring", 2.0)]

    def test_unchanged_generated_line_is_not_rewritten(self) -> None:
        existing = [ExistingLine("m1", "milk", "milk", 2.0, "item", "other", "expiring", False)]
        plan = plan_regeneration(existing, [_cand("milk", "expiring", qty=2.0)], set())
        assert plan.updates == []

    def test_stale_unchecked_generated_line_is_removed(self) -> None:
        existing = [_line("eggs", "depleted", line_id="e1")]
        plan = plan_regeneration(existing, [], set())
        assert plan.deletes == ["e1"]

    def test_meal_line_kept_until_the_food_is_in_stock(self) -> None:
        existing = [_line("basil", "meal", line_id="b1"), _line("lime", "meal", line_id="l1")]
        plan = plan_regeneration(existing, [], {"lime"})
        assert plan.deletes == ["l1"]

    def test_checked_meal_line_is_kept_even_when_in_stock(self) -> None:
        existing = [_line("lime", "meal", checked=True)]
        assert plan_regeneration(existing, [], {"lime"}).deletes == []


class TestPlanMealAdditions:
    def test_adds_unseen_foods_and_reports_the_rest(self) -> None:
        existing = [_line("basil", "manual"), _line("lime", "depleted", checked=True)]
        cands = [_cand("basil", "meal"), _cand("lime", "meal"), _cand("feta", "meal")]
        plan = plan_meal_additions(existing, cands)
        assert [c.name_key for c in plan.inserts] == ["feta"]
        assert plan.already_on_list == ["basil", "lime"]
