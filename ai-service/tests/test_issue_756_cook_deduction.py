"""Issue #756 -- four ways the cook review and deduction got a plain meal wrong.

Found cooking "Modern European Brunch-for-Dinner" on production. The decisions
(triage comment on the issue), each covered below:

1. Count-like units are interchangeable (count, item, each, whole, piece, the
   container words loaf/head/bunch). Equal amounts are Ready, not "Not enough".
2. A seasoning line with no amount ("salt and pepper", "to taste") is never a
   unit conflict and is never substitute-matched; it is reported as `to_taste`,
   which the review shows as one quiet line and does not count.
3. A recipe amount with no unit ("1 lemon") is a count and is deducted from a
   row counted in units.
4. Cook deduction spends unexpired lots first (soonest expiry), and expired
   lots only after every fresh lot is spent.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app

from bubbly_chef.models.cook import DeductionItem
from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.services.cook_matcher import (
    ResolvedAlias,
    _unmatched_ingredient_names,
    match_ingredients,
)
from bubbly_chef.domain.lots import plan_lot_deduction
from bubbly_chef.services.meal_cook import (
    MealCookDishMeta,
    apply_collapsed_deductions,
    correlate_expired,
    merge_meal_matches,
)
from tests.test_issue_356_pantry_lots import _day, _repo, _row

RECIPE_ID = str(uuid.uuid4())


def _item(
    name: str,
    qty: float,
    unit: str,
    *,
    base: float | None = None,
    base_unit: str | None = None,
    expiry: date | None = None,
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
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


def _match(pantry: list[PantryItem], ingredients: list[Any], aliases: Any = None) -> Any:
    return match_ingredients(RECIPE_ID, "Test", ingredients, pantry, aliases)


# ---------------------------------------------------------------------------
# 1. Equal amounts are Ready
# ---------------------------------------------------------------------------

COUNT_LIKE = ["count", "item", "each", "whole", "piece", "loaf", "head", "bunch"]


class TestEqualAmountsAreReady:
    @pytest.mark.parametrize("pantry_unit", COUNT_LIKE)
    @pytest.mark.parametrize("recipe_unit", COUNT_LIKE)
    def test_one_count_like_unit_against_another_is_ready(
        self, recipe_unit: str, pantry_unit: str
    ) -> None:
        # Sourdough: the recipe says "1 count", the pantry holds "1 loaf".
        pantry = [_item("sourdough", 1.0, pantry_unit)]

        proposal = _match(pantry, [{"name": "sourdough", "quantity": 1.0, "unit": recipe_unit}])

        (m,) = proposal.matches
        assert m.status == "ready"
        assert m.deduct_qty == pytest.approx(1.0)
        assert m.shortfall is None

    def test_equal_amounts_that_differ_by_float_noise_are_ready(self) -> None:
        # 0.1 g + 0.7 g sums to 0.7999999999999999, which a strict compare calls
        # short of 0.8 g. The same amounts, so Ready.
        pantry = [
            _item("saffron", 0.1, "g", base=0.1, base_unit="g"),
            _item("saffron", 0.7, "g", base=0.7, base_unit="g"),
        ]

        proposal = _match(pantry, [{"name": "saffron", "quantity": 0.8, "unit": "g"}])

        (m,) = proposal.matches
        assert m.status == "ready"
        assert m.shortfall is None

    @pytest.mark.parametrize(("pantry_unit", "base_unit"), [("g", "g"), ("ml", "ml")])
    def test_whole_against_a_weighed_or_measured_row_stays_the_quiet_have_it(
        self, pantry_unit: str, base_unit: str
    ) -> None:
        # "1 whole block of tofu" vs "500 g": we have it, we can't say how much the
        # recipe uses. Not a unit conflict with an empty box to fill (#756 review).
        pantry = [_item("tofu", 500.0, pantry_unit, base=500.0, base_unit=base_unit)]

        proposal = _match(pantry, [{"name": "tofu", "quantity": 1.0, "unit": "whole"}])

        (m,) = proposal.matches
        assert m.status == "imprecise"
        assert m.deduct_qty is None
        assert proposal.unit_conflicts == []

    @pytest.mark.parametrize("recipe_unit", ["count", "item", "each", "piece"])
    @pytest.mark.parametrize(("pantry_unit", "base_unit"), [("g", "g"), ("ml", "ml")])
    def test_the_other_count_units_against_a_weighed_row_are_unchanged(
        self, recipe_unit: str, pantry_unit: str, base_unit: str
    ) -> None:
        # Pinned so the class is explicit (a food with no typical piece weight; a chicken
        # breast now converts, see test_unit_conversion_gaps.py): these were already a unit conflict on main
        # (test_mass_vs_count_stays_unit_conflict) and #756 does not touch that.
        pantry = [_item("tofu", 500.0, pantry_unit, base=500.0, base_unit=base_unit)]

        proposal = _match(pantry, [{"name": "tofu", "quantity": 1.0, "unit": recipe_unit}])

        (m,) = proposal.matches
        assert m.status == "unit_conflict"
        assert m.deduct_qty is None

    def test_a_genuinely_larger_amount_is_still_a_shortfall(self) -> None:
        pantry = [_item("sourdough", 1.0, "loaf")]

        proposal = _match(pantry, [{"name": "sourdough", "quantity": 2.0, "unit": "count"}])

        (m,) = proposal.matches
        assert m.status == "shortfall"
        assert m.shortfall == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# 2. A seasoning line with no amount
# ---------------------------------------------------------------------------


def _salt() -> PantryItem:
    return _item("salt", 500.0, "g", base=500.0, base_unit="g")


SALT_AND_PEPPER_ALIAS = {
    "salt and pepper": ResolvedAlias("salt", "substitute", "Salt is the closest thing you have")
}


class TestSeasoningWithNoAmount:
    @pytest.mark.parametrize(
        "ingredient",
        [
            {"name": "salt and pepper", "quantity": None, "unit": None},
            {"name": "salt and pepper", "quantity": None, "unit": "to taste"},
            {"name": "Salt and pepper", "quantity": None, "unit": ""},
            {"name": "salt, freshly ground black pepper", "quantity": None, "unit": None},
        ],
    )
    def test_is_to_taste_not_a_conflict_or_a_substitute(self, ingredient: Any) -> None:
        proposal = _match([_salt()], [ingredient], SALT_AND_PEPPER_ALIAS)

        (m,) = proposal.matches
        assert m.status == "to_taste"
        assert m.deduct_qty is None
        assert m.pantry_item_id is None  # not matched to the salt row
        assert m.match_type == "none"
        assert proposal.unit_conflicts == []
        assert proposal.missing == []

    def test_a_single_staple_with_no_amount_keeps_its_existing_handling(self) -> None:
        # #305: held -> ready (nothing to deduct); absent -> assumed. Not a compound.
        held = _match([_salt()], [{"name": "salt", "quantity": None, "unit": None}])
        absent = _match([], [{"name": "salt", "quantity": None, "unit": None}])

        assert (held.matches[0].status, held.matches[0].deduct_qty) == ("ready", None)
        assert absent.matches[0].status == "assumed"

    def test_a_compound_seasoning_is_never_sent_to_the_model_for_a_stand_in(self) -> None:
        names = _unmatched_ingredient_names(
            [{"name": "salt and pepper", "quantity": None, "unit": None}], [_salt()]
        )

        assert names == []

    def test_a_compound_seasoning_with_an_amount_is_not_a_unit_conflict(self) -> None:
        # "1 pinch salt and pepper" used to match salt and clash on the unit.
        proposal = _match(
            [_salt()],
            [{"name": "salt and pepper", "quantity": 1.0, "unit": "pinch"}],
            SALT_AND_PEPPER_ALIAS,
        )

        assert proposal.unit_conflicts == []
        assert all(m.status != "unit_conflict" for m in proposal.matches)
        assert proposal.missing == []

    def test_a_seasoning_with_an_amount_is_still_deducted(self) -> None:
        # "sea salt" is salt: 3 g comes off the salt row, as before.
        proposal = _match([_salt()], [{"name": "sea salt", "quantity": 3.0, "unit": "g"}])

        (m,) = proposal.matches
        assert m.status == "ready"
        assert m.deduct_qty == pytest.approx(3.0)

    def test_a_non_seasoning_with_no_amount_is_unchanged(self) -> None:
        basil = _item("basil", 1.0, "bunch")

        proposal = _match([basil], [{"name": "basil", "quantity": None, "unit": None}])

        (m,) = proposal.matches
        assert m.status == "ready"
        assert m.deduct_qty is None
        assert m.pantry_item_id == basil.id


class TestToTasteInAMeal:
    def test_two_dishes_asking_for_salt_and_pepper_share_one_quiet_line(self) -> None:
        dishes = [
            (
                MealCookDishMeta(recipe_id=uuid.uuid4(), dish_title=title),
                _match([_salt()], [{"name": "salt and pepper", "quantity": None, "unit": None}]),
            )
            for title in ("Eggs", "Salad")
        ]

        merged = merge_meal_matches(dishes)

        (line,) = merged.matches
        assert line.status == "to_taste"
        assert line.deduct_qty is None
        assert [src.dish_title for src in line.sources] == ["Eggs", "Salad"]
        assert merged.unit_conflicts == []


# ---------------------------------------------------------------------------
# 3. A unitless amount is a count
# ---------------------------------------------------------------------------


class TestUnitlessAmountIsACount:
    @pytest.mark.parametrize(
        "ingredient",
        [
            {"name": "lemon", "quantity": 1.0, "unit": None},
            {"name": "lemon", "quantity": 1.0, "unit": ""},
            "1 lemon",
        ],
    )
    def test_a_unitless_lemon_is_deducted_by_count(self, ingredient: Any) -> None:
        pantry = [_item("lemon", 3.0, "")]  # stored without a unit

        proposal = _match(pantry, [ingredient])

        (m,) = proposal.matches
        assert m.status == "ready"
        assert m.deduct_qty == pytest.approx(1.0)
        assert m.base_unit == "count"
        assert m.pantry_qty_available == pytest.approx(3.0)

    def test_a_unitless_amount_against_a_weighed_row_is_left_as_it_was(self) -> None:
        # No way to turn "2" into grams; this must not become a made-up deduction.
        # (Tofu has no typical piece weight; an onion does, and converts: see
        # test_unit_conversion_gaps.py.)
        pantry = [_item("tofu", 500.0, "g", base=500.0, base_unit="g")]

        proposal = _match(pantry, [{"name": "tofu", "quantity": 2.0, "unit": None}])

        (m,) = proposal.matches
        assert m.deduct_qty is None
        assert m.status != "shortfall"

    @pytest.mark.asyncio
    async def test_confirming_takes_the_lemon_down_by_one(self) -> None:
        lemon = _row("lemon", 3.0, "")
        repo, client = _repo([lemon])
        proposal = _match(
            [_item("lemon", 3.0, "")], [{"name": "lemon", "quantity": 1.0, "unit": None}]
        )
        (m,) = proposal.matches
        assert m.deduct_qty is not None

        applied, _requested, skipped = await apply_collapsed_deductions(
            repo,
            "u1",
            [
                DeductionItem(
                    pantry_item_id=uuid.UUID(lemon["id"]),
                    deduct_qty=m.deduct_qty,
                    base_unit=m.base_unit or "count",
                )
            ],
        )

        assert (applied, skipped) == (1, [])
        assert client.rows[0]["quantity"] == pytest.approx(2.0)


# ---------------------------------------------------------------------------
# 4. Fresh lots first
# ---------------------------------------------------------------------------


def _eggs(qty: float, expiry: date, **kw: Any) -> dict[str, Any]:
    return _row("eggs", qty, "item", base=qty, base_unit="count", expiry=expiry, **kw)


class TestFreshLotsFirst:
    def test_the_match_names_the_fresh_lot_not_the_expired_one(self) -> None:
        expired = _item("eggs", 6.0, "item", base=6.0, base_unit="count", expiry=_day(-3))
        fresh = _item("eggs", 6.0, "item", base=6.0, base_unit="count", expiry=_day(5))

        proposal = _match(
            [expired, fresh], [{"name": "eggs", "quantity": 2.0, "unit": "item"}]
        )

        (m,) = proposal.matches
        assert m.pantry_item_id == fresh.id
        # The expired lot is still stock, so it still counts toward the total.
        assert m.pantry_qty_available == pytest.approx(12.0)

    def test_a_lot_expiring_today_is_still_fresh(self) -> None:
        today = _item("eggs", 6.0, "item", base=6.0, base_unit="count", expiry=_day(0))
        expired = _item("eggs", 6.0, "item", base=6.0, base_unit="count", expiry=_day(-1))

        proposal = _match(
            [expired, today], [{"name": "eggs", "quantity": 2.0, "unit": "item"}]
        )

        assert proposal.matches[0].pantry_item_id == today.id

    def test_an_undated_lot_is_used_before_an_expired_one(self) -> None:
        expired = _item("eggs", 6.0, "item", base=6.0, base_unit="count", expiry=_day(-2))
        undated = _item("eggs", 6.0, "item", base=6.0, base_unit="count")

        proposal = _match(
            [expired, undated], [{"name": "eggs", "quantity": 2.0, "unit": "item"}]
        )

        assert proposal.matches[0].pantry_item_id == undated.id

    def test_fresh_lots_still_go_soonest_expiry_first(self) -> None:
        later = _item("eggs", 6.0, "item", base=6.0, base_unit="count", expiry=_day(9))
        sooner = _item("eggs", 6.0, "item", base=6.0, base_unit="count", expiry=_day(2))

        proposal = _match(
            [later, sooner], [{"name": "eggs", "quantity": 2.0, "unit": "item"}]
        )

        assert proposal.matches[0].pantry_item_id == sooner.id

    def test_when_every_lot_is_expired_the_soonest_is_still_used(self) -> None:
        # Never refusing an expired lot: a cook with only past-date stock still deducts.
        older = _item("eggs", 6.0, "item", base=6.0, base_unit="count", expiry=_day(-9))
        newer = _item("eggs", 6.0, "item", base=6.0, base_unit="count", expiry=_day(-2))

        proposal = _match(
            [newer, older], [{"name": "eggs", "quantity": 2.0, "unit": "item"}]
        )

        (m,) = proposal.matches
        assert m.status == "ready"
        assert m.pantry_item_id == older.id
        assert m.deduct_qty == pytest.approx(2.0)

    @pytest.mark.asyncio
    async def test_confirming_spends_the_fresh_lot_and_leaves_the_expired_one(self) -> None:
        expired = _eggs(6.0, _day(-3), age=10)
        fresh = _eggs(6.0, _day(5), age=1)
        repo, client = _repo([expired, fresh])
        pantry = [
            _item("eggs", 6.0, "item", base=6.0, base_unit="count", expiry=_day(-3)),
            _item("eggs", 6.0, "item", base=6.0, base_unit="count", expiry=_day(5)),
        ]
        # Same ids as the repo rows, so the match names a row the repo can deduct from.
        pantry[0] = pantry[0].model_copy(update={"id": uuid.UUID(expired["id"])})
        pantry[1] = pantry[1].model_copy(update={"id": uuid.UUID(fresh["id"])})

        proposal = _match(pantry, [{"name": "eggs", "quantity": 2.0, "unit": "item"}])
        (m,) = proposal.matches
        assert m.deduct_qty is not None and m.pantry_item_id is not None
        await apply_collapsed_deductions(
            repo,
            "u1",
            [DeductionItem(pantry_item_id=m.pantry_item_id, deduct_qty=m.deduct_qty, base_unit="count")],
        )

        by_id = {r["id"]: r for r in client.rows}
        assert by_id[fresh["id"]]["quantity"] == pytest.approx(4.0)
        assert by_id[expired["id"]]["quantity"] == pytest.approx(6.0)

    @pytest.mark.asyncio
    async def test_an_overflow_reaches_the_expired_lot_only_after_the_fresh_ones(self) -> None:
        expired = _eggs(6.0, _day(-3), age=10)
        fresh = _eggs(3.0, _day(5), age=1)
        fresher = _eggs(3.0, _day(8), age=1)
        repo, client = _repo([expired, fresh, fresher])

        # 8 eggs, named on the soonest fresh lot: the fresh lots (3 + 3) go first,
        # then 2 come off the expired one.
        await apply_collapsed_deductions(
            repo,
            "u1",
            [DeductionItem(pantry_item_id=uuid.UUID(fresh["id"]), deduct_qty=8.0, base_unit="count")],
        )

        by_id = {r["id"]: r for r in client.rows}
        assert by_id[fresh["id"]]["quantity"] == pytest.approx(0.0)
        assert by_id[fresher["id"]]["quantity"] == pytest.approx(0.0)
        assert by_id[expired["id"]]["quantity"] == pytest.approx(4.0)

    @pytest.mark.asyncio
    async def test_the_only_lot_being_expired_is_still_deducted(self) -> None:
        expired = _eggs(6.0, _day(-3))
        repo, client = _repo([expired])

        await apply_collapsed_deductions(
            repo,
            "u1",
            [DeductionItem(pantry_item_id=uuid.UUID(expired["id"]), deduct_qty=2.0, base_unit="count")],
        )

        assert client.rows[0]["quantity"] == pytest.approx(4.0)



def _lot(qty: float, expiry: date) -> PantryItem:
    return _item("eggs", qty, "item", base=qty, base_unit="count", expiry=expiry)


def _banner(pantry: list[PantryItem], ingredients: list[dict[str, Any]], **kw: Any) -> list[Any]:
    proposal = _match(pantry, ingredients)
    return correlate_expired(proposal.matches, pantry, **kw)


class TestExpiredBannerFollowsTheSpend:
    """The warning is about what the deduction will reach, not the lot a match names."""

    def test_an_overflow_into_the_expired_lot_still_warns(self) -> None:
        # Fresh 1 + expired 6, recipe needs 4: the named lot is the fresh one, but
        # confirm takes 3 off the expired lot (main warned here).
        pantry = [_lot(1.0, _day(5)), _lot(6.0, _day(-3))]

        items = _banner(pantry, [{"name": "eggs", "quantity": 4.0, "unit": "item"}])

        assert [(i.ingredient_name, i.pantry_item_name, i.days_expired) for i in items] == [
            ("eggs", "eggs", 3)
        ]

    def test_fresh_stock_alone_covering_the_recipe_has_no_banner(self) -> None:
        pantry = [_lot(6.0, _day(5)), _lot(6.0, _day(-3))]

        assert _banner(pantry, [{"name": "eggs", "quantity": 2.0, "unit": "item"}]) == []

    def test_a_recipe_using_exactly_the_fresh_stock_has_no_banner(self) -> None:
        pantry = [_lot(4.0, _day(5)), _lot(6.0, _day(-3))]

        assert _banner(pantry, [{"name": "eggs", "quantity": 4.0, "unit": "item"}]) == []

    def test_all_lots_expired_warns(self) -> None:
        pantry = [_lot(6.0, _day(-3)), _lot(6.0, _day(-9))]

        items = _banner(pantry, [{"name": "eggs", "quantity": 2.0, "unit": "item"}])

        assert len(items) == 1
        assert items[0].days_expired == 9  # the lot that will be spent first

    def test_a_second_line_for_the_same_food_is_judged_on_the_running_total(self) -> None:
        # Two lines of 4 against fresh 6 + expired 6: the first stays on fresh stock,
        # the second tips into the expired lot once confirm collapses them.
        pantry = [_lot(6.0, _day(5)), _lot(6.0, _day(-3))]

        proposal = _match(
            pantry,
            [
                {"name": "eggs", "quantity": 4.0, "unit": "item", "_": "a"},
                {"name": "eggs", "quantity": 4.0, "unit": "item", "_": "b"},
            ],
        )
        items = correlate_expired(proposal.matches, pantry)

        assert len(items) == 1

    def test_a_meal_reports_the_expired_lot_once(self) -> None:
        pantry = [_lot(1.0, _day(5)), _lot(6.0, _day(-3))]
        proposal = _match(pantry, [{"name": "eggs", "quantity": 4.0, "unit": "item"}])

        items = correlate_expired(proposal.matches * 2, pantry, dedupe=True)

        assert len(items) == 1

    def test_a_line_that_deducts_nothing_is_judged_on_its_named_lot_as_before(self) -> None:
        pantry = [_item("sourdough", 1.0, "loaf", expiry=_day(-2))]

        items = _banner(pantry, [{"name": "sourdough", "quantity": None, "unit": None}])

        assert [i.days_expired for i in items] == [2]

    @pytest.mark.asyncio
    async def test_the_planned_split_is_what_confirm_actually_does(self) -> None:
        expired = _eggs(6.0, _day(-3), age=10)
        fresh = _eggs(1.0, _day(5), age=1)
        repo, client = _repo([expired, fresh])
        pantry = [
            _item("eggs", 6.0, "item", base=6.0, base_unit="count", expiry=_day(-3)).model_copy(
                update={"id": uuid.UUID(expired["id"])}
            ),
            _item("eggs", 1.0, "item", base=1.0, base_unit="count", expiry=_day(5)).model_copy(
                update={"id": uuid.UUID(fresh["id"])}
            ),
        ]

        planned = plan_lot_deduction(pantry, fresh["id"], 4.0)
        await apply_collapsed_deductions(
            repo,
            "u1",
            [DeductionItem(pantry_item_id=uuid.UUID(fresh["id"]), deduct_qty=4.0, base_unit="count")],
        )

        by_id = {r["id"]: r for r in client.rows}
        assert planned == {fresh["id"]: pytest.approx(1.0), expired["id"]: pytest.approx(3.0)}
        assert by_id[fresh["id"]]["quantity"] == pytest.approx(0.0)
        assert by_id[expired["id"]]["quantity"] == pytest.approx(3.0)


# ---------------------------------------------------------------------------
# The scenario from the issue, through the real cook routes
# ---------------------------------------------------------------------------


class _NoModel:
    """An AI manager that fails the test if the cook route asks it anything.

    Every name in the scenario resolves from the synonym table or is a seasoning,
    so no stand-in lookup should be made (decision 2: a compound is never sent).
    """

    def __init__(self) -> None:
        self.calls = 0

    async def complete(self, **_kwargs: Any) -> Any:
        self.calls += 1
        raise AssertionError("the cook route must not call the model for this recipe")


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    @asynccontextmanager
    async def _noop_lifespan(_app: Any) -> AsyncGenerator[None, None]:
        yield

    app = create_app()
    app.router.lifespan_context = _noop_lifespan

    async def _fake_user() -> str:
        return "u1"

    app.dependency_overrides[get_current_user_id] = _fake_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_the_brunch_cook_end_to_end(client: AsyncClient) -> None:
    sourdough = _row("sourdough", 1.0, "loaf", base=1.0, base_unit="count")
    salt = _row("salt", 500.0, "g", base=500.0, base_unit="g")
    lemon = _row("lemon", 3.0, "")  # no unit, no base: as the Next.js CRUD routes write it
    expired_eggs = _eggs(6.0, _day(-3), age=10)
    fresh_eggs = _eggs(6.0, _day(5), age=1)
    repo, client_rows = _repo([sourdough, salt, lemon, expired_eggs, fresh_eggs])
    recipe = {
        "id": RECIPE_ID,
        "title": "Brunch-for-Dinner",
        "ingredients": [
            {"name": "sourdough", "quantity": 1, "unit": "count"},
            {"name": "salt and pepper", "quantity": None, "unit": "to taste"},
            {"name": "sea salt", "quantity": 3, "unit": "g"},
            {"name": "lemon", "quantity": 1, "unit": None},
            {"name": "eggs", "quantity": 2, "unit": "item"},
        ],
    }
    setattr(repo, "get_recipe", AsyncMock(return_value=recipe))
    setattr(repo, "update_recipe_cooked", AsyncMock(return_value=True))
    model = _NoModel()

    with (
        patch("bubbly_chef.api.routes.recipes_ai.get_repository", return_value=repo),
        patch("bubbly_chef.api.deps.get_ai_manager", return_value=model),
    ):
        proposal = (await client.post("/v1/recipes/cook", json={"recipe_id": RECIPE_ID})).json()

        status = {m["ingredient_name"]: m["status"] for m in proposal["matches"]}
        assert status == {
            "sourdough": "ready",  # was "Not enough"
            "salt and pepper": "to_taste",  # was "Unit conflict"
            "sea salt": "ready",
            "lemon": "ready",
            "eggs": "ready",
        }
        assert proposal["unit_conflicts"] == []
        assert proposal["missing"] == []
        assert model.calls == 0

        deductions = [
            {"pantry_item_id": m["pantry_item_id"], "deduct_qty": m["deduct_qty"], "base_unit": m["base_unit"]}
            for m in proposal["matches"]
            if m["deduct_qty"]
        ]
        confirmed = await client.post(
            "/v1/recipes/cook/confirm", json={"recipe_id": RECIPE_ID, "deductions": deductions}
        )

    assert confirmed.json()["deductions_skipped"] == []
    qty = {r["id"]: r["quantity"] for r in client_rows.rows}
    assert qty[sourdough["id"]] == pytest.approx(0.0)
    assert qty[salt["id"]] == pytest.approx(497.0)
    assert qty[lemon["id"]] == pytest.approx(2.0)  # was untouched
    assert qty[fresh_eggs["id"]] == pytest.approx(4.0)
    assert qty[expired_eggs["id"]] == pytest.approx(6.0)  # was the one spent
