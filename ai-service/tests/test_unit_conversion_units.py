"""Unit-conversion gaps (follow-up to #6): the pieces under the fixture suite.

`test_unit_conversion_gaps.py` runs 82 recipe-line / pantry-row pairs through the
whole matcher and deduction path. This file pins the parts it is built from, and
the one thing the fixture cannot show: the real cook routes, JSON in and out, with
the pantry rows read back after the confirm.

Nothing here calls a model. The route test hands the cook route an AI manager that
fails the test if it is asked anything.
"""

from __future__ import annotations

import itertools
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.domain.conversion import convert_amount, juice_as_fruit, juice_fruit, unit_kind
from bubbly_chef.domain.normalizer import (
    _UNIT_ALIASES,
    PACKAGE_UNITS,
    PIECE_UNITS,
    effective_unit,
    is_package_unit,
    is_piece_unit,
    is_estimated_size,
    normalize_to_base_unit,
    normalize_unit,
    parse_sized_container,
    to_base_unit,
)
from bubbly_chef.main import create_app
from bubbly_chef.services.cook_matcher import _parse_ingredient_string
from tests.test_issue_356_pantry_lots import _repo, _row

# ---------------------------------------------------------------------------
# Unit spellings
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "canonical"),
    [
        ("tbsps", "tbsp"),
        ("tbs", "tbsp"),
        ("Tbsp.", "tbsp"),
        ("tsps", "tsp"),
        ("doz", "dozen"),
        ("half dozen", "half dozen"),
        ("half-dozen", "half dozen"),
        ("pairs", "pair"),
        ("lbs", "lb"),
        ("packs", "package"),
        ("packet", "package"),
        ("bulb", "head"),
        ("bulbs", "head"),
    ],
)
def test_unit_spellings_resolve(raw: str, canonical: str) -> None:
    assert normalize_unit(raw) == canonical


@pytest.mark.parametrize(
    ("unit", "kind"),
    [
        ("g", "mass"),
        ("lb", "mass"),
        ("cup", "volume"),
        ("fl oz", "volume"),
        ("dozen", "each"),
        ("pair", "each"),
        ("can", "container"),
        ("28 oz can", "sized"),
        ("clove", "piece"),
        ("", None),
        ("furlong", None),
    ],
)
def test_unit_kind(unit: str, kind: str | None) -> None:
    assert unit_kind(unit) == kind


def test_every_synonym_of_a_piece_or_package_unit_is_guarded_like_it() -> None:
    """ADR 0003 guard sees the same unit normalize_unit() does (#866).

    A spelling that resolves to a piece/package unit but slips the guard turns
    "2 cloves shallots" against "3 bulb" into a deduction of 2 whole bulbs.
    """
    for raw in _UNIT_ALIASES:
        canonical = normalize_unit(raw)
        if canonical == "count":  # "item"/"items" are guarded as the package "item"
            continue
        assert is_piece_unit(raw) == (canonical in PIECE_UNITS), raw
        assert is_package_unit(raw) == (canonical in PACKAGE_UNITS), raw


# ---------------------------------------------------------------------------
# Sized containers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "parsed"),
    [
        ("28 oz can", (28.0, "oz", "can")),
        ("14.5-oz can", (14.5, "oz", "can")),
        ("(14.5 oz) can", (14.5, "oz", "can")),
        ("can (14.5 oz)", (14.5, "oz", "can")),
        ("400 g tin", (400.0, "g", "can")),
        ("can", None),
        ("28 oz", None),
        ("", None),
        (None, None),
    ],
)
def test_parse_sized_container(text: str | None, parsed: tuple[float, str, str] | None) -> None:
    assert parse_sized_container(text) == parsed


def test_a_size_in_the_pantry_name_is_read_through_effective_unit_as_an_estimate() -> None:
    assert effective_unit("tomatoes 28 oz", "can") == "~28 oz can"
    assert is_estimated_size(effective_unit("tomatoes 28 oz", "can"))
    assert effective_unit("tomatoes", "can") == "can"
    # A size the unit states is left alone, and is not an estimate.
    assert effective_unit("tomatoes", "14.5 oz can") == "14.5 oz can"
    assert not is_estimated_size("14.5 oz can")


@pytest.mark.parametrize("unit", ["pack", "package", "box", "bag"])
def test_a_multipack_never_takes_a_size_from_its_name(unit: str) -> None:
    """"yogurt 5.3 oz" held as 1 pack: 5.3 oz is per cup, not the pack's weight."""
    assert effective_unit("yogurt 5.3 oz", unit) == unit
    assert to_base_unit("yogurt 5.3 oz", 1, unit, target_unit="g") is None


@pytest.mark.parametrize("unit", ["can", "jar", "bottle", "container"])
def test_a_size_in_the_name_converts_for_a_single_container_but_is_approximate(
    unit: str,
) -> None:
    got = to_base_unit("sauce 24 oz", 1, unit)
    assert got is not None
    assert got[0] == pytest.approx(24 * 28.35, rel=2e-3)
    assert got[2] is True


def test_the_same_size_written_in_the_unit_is_exact() -> None:
    got = to_base_unit("sauce", 1, "24 oz jar")
    assert got is not None
    assert got[2] is False


# ---------------------------------------------------------------------------
# to_base_unit: the approximate flag
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "qty", "unit", "expected", "approximate"),
    [
        # Same dimension and definitions are exact.
        ("eggs", 1, "dozen", (12.0, "count"), False),
        ("water", 2, "cup", (480.0, "ml"), False),
        ("sugar", 1, "lb", (453.59, "g"), False),
        ("butter", 1, "stick", (113.0, "g"), False),
        ("tomatoes", 1, "28 oz can", (793.8, "g"), False),
        # Anything that leans on a typical figure is flagged.
        ("flour", 1, "cup", (127.2, "g"), True),
        ("garlic", 2, "clove", (10.0, "g"), True),
    ],
)
def test_to_base_unit_flags_estimates(
    name: str, qty: float, unit: str, expected: tuple[float, str], approximate: bool
) -> None:
    got = to_base_unit(name, qty, unit)
    assert got is not None
    assert got[0] == pytest.approx(expected[0], rel=2e-3)
    assert got[1] == expected[1]
    assert got[2] is approximate


def test_normalize_to_base_unit_still_returns_the_two_tuple() -> None:
    assert normalize_to_base_unit("eggs", 1, "dozen") == (12.0, "count")
    assert normalize_to_base_unit("matcha", 1, "tbsp") == (None, None)


# ---------------------------------------------------------------------------
# convert_amount
# ---------------------------------------------------------------------------


def test_count_comes_off_a_dozen_exactly() -> None:
    got = convert_amount("egg", 3, "item", "count", pantry_name="egg", pantry_unit="dozen")
    assert got is not None
    assert (got.quantity, got.unit, got.approximate) == (3, "count", False)


def test_cup_of_flour_off_a_bag_is_an_estimate_in_grams() -> None:
    got = convert_amount("flour", 1, "cup", "g", pantry_unit="bag")
    assert got is not None
    assert got.quantity == pytest.approx(127.2, rel=2e-3)
    assert got.approximate is True


@pytest.mark.parametrize(
    ("name", "qty", "unit", "target"),
    [
        ("matcha", 1, "tbsp", "g"),  # no density: a volume cannot become a mass
        ("tofu", 1, "item", "g"),  # no typical piece weight
        ("flour", 1, "furlong", "g"),  # not a unit
    ],
)
def test_refuses_without_an_honest_figure(name: str, qty: float, unit: str, target: str) -> None:
    assert convert_amount(name, qty, unit, target) is None


def test_four_slices_of_bread_stay_imprecise_against_a_loaf() -> None:
    assert convert_amount("bread", 4, "slice", "count", pantry_unit="loaf") is None


_MASS = ["g", "kg", "oz", "lb"]
_VOLUME = ["ml", "l", "tsp", "tbsp", "fl oz", "cup", "pint", "quart", "gallon"]


@pytest.mark.parametrize(
    ("src", "dst"),
    list(itertools.permutations(_MASS, 2)) + list(itertools.permutations(_VOLUME, 2)),
)
def test_every_unit_pair_inside_a_dimension_converts_for_a_food_with_no_tables(
    src: str, dst: str
) -> None:
    """Unknown food, so only same-dimension arithmetic can answer, and it always does."""
    base = "g" if src in _MASS else "ml"
    one = normalize_to_base_unit("zzz-unlisted", 1, src, target_unit=base)
    other = normalize_to_base_unit("zzz-unlisted", 1, dst, target_unit=base)
    assert one[0] is not None
    assert other[0] is not None
    assert one[1] == other[1] == base
    got = convert_amount("zzz-unlisted", 1, src, base)
    assert got is not None
    assert got.quantity == pytest.approx(one[0])
    assert got.approximate is False


@pytest.mark.parametrize(
    ("qty", "unit", "count"),
    [(1, "dozen", 12), (0.5, "dozen", 6), (1, "half dozen", 6), (2, "pair", 4), (3, "item", 3)],
)
def test_counts_convert_for_a_food_with_no_tables(qty: float, unit: str, count: float) -> None:
    got = convert_amount("zzz-unlisted", qty, unit, "count")
    assert got is not None
    assert got.quantity == pytest.approx(count)
    assert got.approximate is False


# ---------------------------------------------------------------------------
# Juice as fruit
# ---------------------------------------------------------------------------


def test_juice_fruit_names_the_fruit_only_for_a_known_yield() -> None:
    assert juice_fruit("lemon juice") == "lemon"
    assert juice_fruit("Lime Juice") == "lime"
    assert juice_fruit("apple juice") is None
    assert juice_fruit("lemon") is None


def test_juice_as_fruit_is_a_fraction_of_a_fruit() -> None:
    assert juice_as_fruit("lemon", 30, "ml") == pytest.approx(2 / 3)
    assert juice_as_fruit("lemon", 1, "g") is None


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("line", "name", "qty", "unit", "qty_max"),
    [
        ("a pinch of salt", "salt", 1.0, "pinch", None),
        ("2 dashes bitters", "bitters", 2.0, "dashes", None),
        ("3 pinches saffron", "saffron", 3.0, "pinches", None),
        ("salt, to taste", "salt", None, "to taste", None),
        ("1-2 cloves garlic", "garlic", 1.5, "clove", 2.0),
        ("1 (14.5 oz) can tomatoes", "tomatoes", 1.0, "14.5 oz can", None),
        ("juice of 1 lime", "lime", 1.0, None, None),
        ("half a dozen eggs", "eggs", 0.5, "dozen", None),
        ("1 1/2 cups flour", "flour", 1.5, "cup", None),
    ],
)
def test_ingredient_line_parsing(
    line: str, name: str, qty: float | None, unit: str | None, qty_max: float | None
) -> None:
    parsed = _parse_ingredient_string(line)
    assert parsed["name"] == name
    assert parsed.get("quantity") == qty
    if unit is not None:
        assert normalize_unit(str(parsed.get("unit"))) == normalize_unit(unit) or parsed.get(
            "unit"
        ) == unit
    assert parsed.get("quantity_max") == qty_max


def test_a_single_number_has_no_quantity_max() -> None:
    assert "quantity_max" not in _parse_ingredient_string("2 cups flour")


# ---------------------------------------------------------------------------
# The real routes: /v1/recipes/cook then /v1/recipes/cook/confirm
# ---------------------------------------------------------------------------

RECIPE_ID = "7d6c1f0e-3f6a-4f1e-9d7c-0a1b2c3d4e5f"


class _NoModel:
    """An AI manager that fails the test if the route asks it anything."""

    async def complete(self, **_kwargs: Any) -> Any:
        raise AssertionError("unit conversion must not call a model")


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
async def test_a_real_kitchen_cook_end_to_end(client: AsyncClient) -> None:
    """Rows as the Next.js CRUD routes write them (no base), lines as a recipe writes them."""
    eggs = _row("eggs", 1.0, "dozen")
    onions = _row("onion", 1.0, "lb")
    flour = _row("flour", 1.0, "bag")
    garlic = _row("garlic", 1.0, "head")
    tomatoes = _row("tomatoes", 2.0, "28 oz can")
    salt = _row("salt", 500.0, "g")
    tofu = _row("tofu", 1.0, "block")
    repo, rows = _repo([eggs, onions, flour, garlic, tomatoes, salt, tofu])
    recipe = {
        "id": RECIPE_ID,
        "title": "Everything pot",
        "ingredients": [
            "3 eggs",
            "1 onion",
            "1 cup flour",
            "2 cloves garlic",
            "1 (14.5 oz) can tomatoes",
            "a pinch of salt",
            "2 tbsp tofu",
        ],
    }
    setattr(repo, "get_recipe", AsyncMock(return_value=recipe))
    setattr(repo, "update_recipe_cooked", AsyncMock(return_value=True))

    with (
        patch("bubbly_chef.api.routes.recipes_ai.get_repository", return_value=repo),
        patch("bubbly_chef.api.deps.get_ai_manager", return_value=_NoModel()),
    ):
        proposal = (await client.post("/v1/recipes/cook", json={"recipe_id": RECIPE_ID})).json()
        by_name = {m["ingredient_name"]: m for m in proposal["matches"]}

        assert by_name["eggs"]["status"] == "ready"
        assert by_name["eggs"]["deduct_qty"] == pytest.approx(3.0)
        assert by_name["eggs"]["approximate"] is False

        assert by_name["onion"]["status"] == "ready"
        assert by_name["onion"]["approximate"] is True  # a typical onion weighs 150 g

        assert by_name["flour"]["status"] == "ready"
        assert by_name["flour"]["deduct_qty"] == pytest.approx(127.2, rel=2e-3)
        assert by_name["flour"]["approximate"] is True

        assert by_name["garlic"]["status"] == "ready"
        assert by_name["garlic"]["approximate"] is True

        assert by_name["tomatoes"]["status"] == "ready"
        assert by_name["tomatoes"]["deduct_qty"] == pytest.approx(14.5 * 28.35, rel=2e-3)

        assert by_name["salt"]["status"] == "to_taste"
        assert not by_name["salt"]["deduct_qty"]

        # No honest figure for a spoonful of tofu: the line says so and deducts nothing.
        assert by_name["tofu"]["status"] == "imprecise"
        assert by_name["tofu"]["deduct_qty"] is None

        deductions = [
            {
                "pantry_item_id": m["pantry_item_id"],
                "deduct_qty": m["deduct_qty"],
                "base_unit": m["base_unit"],
            }
            for m in proposal["matches"]
            if m["deduct_qty"]
        ]
        confirmed = await client.post(
            "/v1/recipes/cook/confirm", json={"recipe_id": RECIPE_ID, "deductions": deductions}
        )

    assert confirmed.json()["deductions_skipped"] == []
    qty = {r["id"]: r["quantity"] for r in rows.rows}
    assert qty[eggs["id"]] == pytest.approx(0.75)  # 9 of 12 left, shown as dozen
    assert qty[onions["id"]] == pytest.approx(1.0 - 150.0 / 453.59, rel=5e-3)
    assert qty[flour["id"]] < 1.0  # a bag, less a cup
    assert qty[garlic["id"]] == pytest.approx(0.8)  # 10 g of a 50 g head
    assert qty[tomatoes["id"]] == pytest.approx(2.0 - 14.5 / 28.0, rel=5e-3)
    assert qty[salt["id"]] == pytest.approx(500.0)
    assert qty[tofu["id"]] == pytest.approx(1.0)


@pytest.mark.asyncio
async def test_normalize_base_unit_route_reads_a_canned_size(client: AsyncClient) -> None:
    resp = await client.post(
        "/v1/pantry/normalize-base-unit",
        json={"name": "tomatoes", "quantity": 2, "unit": "28 oz can", "category": "canned"},
    )
    body = resp.json()
    assert body["unit_base"] == "g"
    assert body["quantity_base"] == pytest.approx(2 * 28 * 28.35, rel=2e-3)


# ---------------------------------------------------------------------------
# A meal: one dish's estimate makes the merged line an estimate
# ---------------------------------------------------------------------------


def _flour_dishes(*lines: tuple[str, dict[str, Any]]) -> Any:
    import uuid

    from bubbly_chef.services.meal_cook import MealCookDishMeta, merge_meal_matches
    from tests.test_issue_356_pantry_lots import _item, _match

    pantry = [_item("flour", 2.0, "kg")]  # weighed, so the pantry side is exact
    return merge_meal_matches(
        [
            (MealCookDishMeta(recipe_id=uuid.uuid4(), dish_title=title), _match(pantry, [line]))
            for title, line in lines
        ]
    )


def test_a_merged_meal_line_is_approximate_when_any_dish_needed_an_estimate() -> None:
    merged = _flour_dishes(
        ("Exact", {"name": "flour", "quantity": 100, "unit": "g"}),
        ("Guessed", {"name": "flour", "quantity": 1, "unit": "cup"}),
    )

    (line,) = merged.matches
    assert line.status == "ready"
    assert line.approximate is True
    assert {s.dish_title: s.approximate for s in line.sources} == {"Exact": False, "Guessed": True}
    assert line.deduct_qty == pytest.approx(100 + 127.2, rel=2e-3)


def test_a_merged_meal_line_of_exact_dishes_is_exact() -> None:
    merged = _flour_dishes(("Exact", {"name": "flour", "quantity": 100, "unit": "g"}))

    assert merged.matches[0].approximate is False
