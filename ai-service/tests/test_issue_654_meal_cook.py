"""Issue #654 PR A: one combined deduction for a whole meal cook.

- `merge_meal_matches` -- pure unit tests (contract §2b).
- `POST /v1/meals/cook` -- route-level tests (contract §2a).
- `POST /v1/meals/cook/confirm` -- route-level tests (contract §2c).

Follows `test_cook_routes.py`'s pattern: `get_current_user_id` overridden,
`get_repository`/`get_ai_manager` patched with AsyncMock stubs -- no live
provider or DB required.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.main import create_app
from bubbly_chef.models.cook import (
    CompoundSuggestion,
    CookProposal,
    IngredientMatch,
    MealCookClaim,
)
from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.services.cook_matcher import _alias_cache
from bubbly_chef.services.meal_cook import MealCookDishMeta, merge_meal_matches

TEST_USER_ID = "test-meal-cook-user-654"
MEAL_ID = str(uuid.uuid4())
RECIPE_A = uuid.uuid4()
RECIPE_B = uuid.uuid4()
RECIPE_C = uuid.uuid4()
PANTRY_ITEM = uuid.uuid4()

DISH_A = MealCookDishMeta(recipe_id=RECIPE_A, dish_title="Pasta")
DISH_B = MealCookDishMeta(recipe_id=RECIPE_B, dish_title="Salad")


# ---------------------------------------------------------------------------
# merge_meal_matches -- pure unit tests
# ---------------------------------------------------------------------------


def _match(**overrides: Any) -> IngredientMatch:
    base: dict[str, Any] = dict(
        ingredient_name="cheese",
        ingredient_qty=1.0,
        ingredient_unit="cup",
        pantry_item_id=PANTRY_ITEM,
        pantry_item_name="cheddar",
        pantry_qty_available=5.0,
        deduct_qty=1.0,
        base_unit="g",
        status="ready",
        match_type="exact",
        substitution_note=None,
    )
    base.update(overrides)
    return IngredientMatch(**base)


def _proposal(
    recipe_id: uuid.UUID,
    title: str,
    matches: list[IngredientMatch] | None = None,
    missing: list[str] | None = None,
    missing_notes: dict[str, str] | None = None,
    unit_conflicts: list[dict[str, str]] | None = None,
    compound_suggestions: list[CompoundSuggestion] | None = None,
) -> CookProposal:
    return CookProposal(
        recipe_id=recipe_id,
        recipe_title=title,
        matches=matches or [],
        missing=missing or [],
        missing_notes=missing_notes or {},
        unit_conflicts=unit_conflicts or [],
        compound_suggestions=compound_suggestions or [],
    )


class TestMergeMealMatches:
    def test_shared_ingredient_summed_sources_in_dish_order(self) -> None:
        match_a = _match(deduct_qty=2.0, pantry_qty_available=5.0)
        match_b = _match(deduct_qty=1.0, pantry_qty_available=5.0)
        proposal_a = _proposal(RECIPE_A, "Pasta", matches=[match_a])
        proposal_b = _proposal(RECIPE_B, "Salad", matches=[match_b])

        result = merge_meal_matches([(DISH_A, proposal_a), (DISH_B, proposal_b)])

        assert len(result.matches) == 1
        merged = result.matches[0]
        assert merged.status == "ready"
        assert merged.deduct_qty == 3.0
        assert [s.recipe_id for s in merged.sources] == [RECIPE_A, RECIPE_B]

    def test_two_ready_parts_become_shortfall(self) -> None:
        match_a = _match(deduct_qty=3.0, pantry_qty_available=5.0)
        match_b = _match(deduct_qty=4.0, pantry_qty_available=5.0)
        proposal_a = _proposal(RECIPE_A, "Pasta", matches=[match_a])
        proposal_b = _proposal(RECIPE_B, "Salad", matches=[match_b])

        result = merge_meal_matches([(DISH_A, proposal_a), (DISH_B, proposal_b)])

        merged = result.matches[0]
        assert merged.status == "shortfall"
        assert merged.deduct_qty == 5.0
        assert merged.shortfall == 2.0

    def test_shortfall_plus_ready_within_tolerance_is_not_a_shortfall(self) -> None:
        # required (deduct_qty + shortfall) = 4.99995; ready required = 0.00010.
        # total = 5.00005, available = 5.0 -> diff 0.00005 < 1e-4.
        match_a = _match(
            status="shortfall", deduct_qty=3.0, shortfall=1.99995, pantry_qty_available=5.0
        )
        match_b = _match(status="ready", deduct_qty=0.00010, pantry_qty_available=5.0)
        proposal_a = _proposal(RECIPE_A, "Pasta", matches=[match_a])
        proposal_b = _proposal(RECIPE_B, "Salad", matches=[match_b])

        result = merge_meal_matches([(DISH_A, proposal_a), (DISH_B, proposal_b)])

        merged = result.matches[0]
        assert merged.status != "shortfall"
        assert merged.shortfall is None

    def test_short_substitute_merged_with_ready_substitute_stays_substitute(self) -> None:
        match_a = _match(
            status="shortfall",
            match_type="substitute",
            deduct_qty=2.0,
            shortfall=1.0,
            pantry_qty_available=4.0,
            substitution_note="Used margarine instead.",
        )
        match_b = _match(
            status="ready", match_type="substitute", deduct_qty=1.0, pantry_qty_available=4.0
        )
        proposal_a = _proposal(RECIPE_A, "Pasta", matches=[match_a])
        proposal_b = _proposal(RECIPE_B, "Salad", matches=[match_b])

        result = merge_meal_matches([(DISH_A, proposal_a), (DISH_B, proposal_b)])

        merged = result.matches[0]
        assert merged.match_type == "substitute"
        assert merged.status == "substitute"
        assert merged.substitution_note == "Used margarine instead."

    def test_mixed_recipe_units_leave_qty_and_unit_none_but_sum_base_qty(self) -> None:
        match_a = _match(
            ingredient_qty=1.0, ingredient_unit="cup", deduct_qty=200.0, pantry_qty_available=300.0
        )
        match_b = _match(
            ingredient_qty=2.0, ingredient_unit="tbsp", deduct_qty=50.0, pantry_qty_available=300.0
        )
        proposal_a = _proposal(RECIPE_A, "Pasta", matches=[match_a])
        proposal_b = _proposal(RECIPE_B, "Salad", matches=[match_b])

        result = merge_meal_matches([(DISH_A, proposal_a), (DISH_B, proposal_b)])

        merged = result.matches[0]
        assert merged.ingredient_qty is None
        assert merged.ingredient_unit is None
        assert merged.deduct_qty == 250.0
        assert merged.base_unit == "g"

    def test_unit_conflict_stays_its_own_line_and_base_unit_is_first_source(self) -> None:
        match_a = _match(
            status="unit_conflict",
            ingredient_unit="oz",
            base_unit="oz",
            deduct_qty=None,
        )
        match_b = _match(
            status="unit_conflict",
            ingredient_unit="ml",
            base_unit="ml",
            deduct_qty=None,
        )
        proposal_a = _proposal(RECIPE_A, "Pasta", matches=[match_a])
        proposal_b = _proposal(RECIPE_B, "Salad", matches=[match_b])

        result = merge_meal_matches([(DISH_A, proposal_a), (DISH_B, proposal_b)])

        assert len(result.matches) == 1
        merged = result.matches[0]
        assert merged.status == "unit_conflict"
        assert merged.base_unit == "oz"
        assert merged.deduct_qty is None

    def test_staples_merge_by_name(self) -> None:
        match_a = _match(
            ingredient_name="Salt",
            pantry_item_id=None,
            pantry_item_name=None,
            pantry_qty_available=None,
            deduct_qty=None,
            base_unit=None,
            status="assumed",
            match_type="none",
        )
        match_b = _match(
            ingredient_name="salt",
            pantry_item_id=None,
            pantry_item_name=None,
            pantry_qty_available=None,
            deduct_qty=None,
            base_unit=None,
            status="assumed",
            match_type="none",
        )
        proposal_a = _proposal(RECIPE_A, "Pasta", matches=[match_a])
        proposal_b = _proposal(RECIPE_B, "Salad", matches=[match_b])

        result = merge_meal_matches([(DISH_A, proposal_a), (DISH_B, proposal_b)])

        assert len(result.matches) == 1
        merged = result.matches[0]
        assert merged.status == "assumed"
        assert len(merged.sources) == 2

    def test_missing_is_unioned_with_sources(self) -> None:
        proposal_a = _proposal(RECIPE_A, "Pasta", missing=["Truffle Oil"])
        proposal_b = _proposal(RECIPE_B, "Salad", missing=["truffle oil", "basil"])

        result = merge_meal_matches([(DISH_A, proposal_a), (DISH_B, proposal_b)])

        assert result.missing == ["Truffle Oil", "basil"]
        assert set(result.missing_sources["Truffle Oil"]) == {RECIPE_A, RECIPE_B}
        assert result.missing_sources["basil"] == [RECIPE_B]

    def test_missing_sources_names_one_dish_only_once(self) -> None:
        """One dish's own `missing` list repeating a normalized name (two
        recipe lines spelled "Truffle Oil" and "truffle oil") must not name
        that dish twice in `missing_sources` (issue #654, code review N4)."""
        proposal_a = _proposal(RECIPE_A, "Pasta", missing=["Truffle Oil", "truffle oil"])

        result = merge_meal_matches([(DISH_A, proposal_a)])

        assert result.missing_sources["Truffle Oil"] == [RECIPE_A]

    def test_missing_notes_rekeyed_to_kept_spelling(self) -> None:
        proposal_a = _proposal(RECIPE_A, "Pasta", missing=["Heavy cream"])
        proposal_b = _proposal(
            RECIPE_B,
            "Salad",
            missing=["heavy cream"],
            missing_notes={"heavy cream": "No good substitute found."},
        )

        result = merge_meal_matches([(DISH_A, proposal_a), (DISH_B, proposal_b)])

        assert result.missing == ["Heavy cream"]
        assert result.missing_notes == {"Heavy cream": "No good substitute found."}

    def test_compound_suggestions_deduped_by_normalized_name(self) -> None:
        proposal_a = _proposal(
            RECIPE_A,
            "Pasta",
            missing=["cream"],
            compound_suggestions=[
                CompoundSuggestion(ingredient_name="cream", components=["butter", "milk"], note="Mix.")
            ],
        )
        proposal_b = _proposal(
            RECIPE_B,
            "Salad",
            missing=["Cream "],
            compound_suggestions=[
                CompoundSuggestion(
                    ingredient_name="Cream ", components=["butter", "milk"], note="Mix differently."
                )
            ],
        )

        result = merge_meal_matches([(DISH_A, proposal_a), (DISH_B, proposal_b)])

        assert len(result.compound_suggestions) == 1
        kept = result.compound_suggestions[0]
        assert kept.note == "Mix."
        assert kept.ingredient_name == "cream"  # the kept `missing` spelling

    def test_deterministic(self) -> None:
        match_a = _match(deduct_qty=2.0, pantry_qty_available=5.0)
        match_b = _match(deduct_qty=1.0, pantry_qty_available=5.0)
        proposal_a = _proposal(RECIPE_A, "Pasta", matches=[match_a], missing=["basil"])
        proposal_b = _proposal(RECIPE_B, "Salad", matches=[match_b], missing=["basil"])

        first = merge_meal_matches([(DISH_A, proposal_a), (DISH_B, proposal_b)])
        second = merge_meal_matches([(DISH_A, proposal_a), (DISH_B, proposal_b)])

        assert [m.model_dump() for m in first.matches] == [m.model_dump() for m in second.matches]
        assert first.missing == second.missing
        assert first.missing_sources == second.missing_sources


# ---------------------------------------------------------------------------
# Route-level fixtures and builders
# ---------------------------------------------------------------------------

RECIPE_MAIN = str(uuid.uuid4())
RECIPE_SIDE = str(uuid.uuid4())
PANTRY_A = str(uuid.uuid4())
PANTRY_B = str(uuid.uuid4())
_ROUTE_MODULE = "bubbly_chef.api.routes.meals_ai"


@pytest.fixture
def app():
    from collections.abc import AsyncGenerator
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def _noop_lifespan(app: Any) -> AsyncGenerator[None, None]:
        yield

    _app = create_app()
    _app.router.lifespan_context = _noop_lifespan

    async def _fake_user() -> str:
        return TEST_USER_ID

    _app.dependency_overrides[get_current_user_id] = _fake_user
    return _app


@pytest_asyncio.fixture
async def client(app: Any) -> AsyncClient:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _recipe_row(recipe_id: str, title: str, servings: int = 2, ingredients: list[Any] | None = None) -> dict[str, Any]:
    return {
        "id": recipe_id,
        "title": title,
        "servings": servings,
        "ingredients": ingredients if ingredients is not None else [],
    }


def _dish_row(role: str, position: int, recipe_id: str, recipe_row: dict[str, Any] | None) -> dict[str, Any]:
    return {"role": role, "position": position, "recipe_id": recipe_id, "recipe": recipe_row or {}}


def _meal_with_dishes(
    dishes: list[dict[str, Any]],
    title: str = "Cozy Dinner",
    last_cook_ref: str | None = None,
    last_cook_status: str | None = None,
) -> dict[str, Any]:
    return {
        "meal": {
            "id": MEAL_ID,
            "user_id": TEST_USER_ID,
            "title": title,
            "last_cook_ref": last_cook_ref,
            "last_cook_status": last_cook_status,
        },
        "dishes": dishes,
    }


def _pantry_item(item_id: str, name: str, qty: float, unit: str, qty_base: float, unit_base: str) -> PantryItem:
    return PantryItem(
        id=uuid.UUID(item_id),
        name=name,
        category=FoodCategory.OTHER,
        storage_location=StorageLocation.PANTRY,
        quantity=qty,
        unit=unit,
        quantity_base=qty_base,
        unit_base=unit_base,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


def _repo_for_cook(meal_data: dict[str, Any] | None, pantry_items: list[PantryItem]) -> AsyncMock:
    repo = AsyncMock()
    repo.get_meal_with_dishes.return_value = meal_data
    repo.get_all_pantry_items.return_value = pantry_items
    return repo


@pytest.fixture(autouse=True)
def _clear_alias_cache() -> None:
    _alias_cache.clear()
    yield
    _alias_cache.clear()


# ---------------------------------------------------------------------------
# POST /v1/meals/cook
# ---------------------------------------------------------------------------


class TestMealCookRoute:
    @pytest.mark.asyncio
    async def test_returns_404_for_unknown_meal(self, client: AsyncClient) -> None:
        repo = _repo_for_cook(None, [])
        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook",
                json={"meal_id": MEAL_ID, "servings": 2, "dishes": [{"recipe_id": RECIPE_MAIN}]},
            )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_dish_mismatch_for_foreign_recipe(self, client: AsyncClient) -> None:
        meal_data = _meal_with_dishes(
            [_dish_row("main", 0, RECIPE_MAIN, _recipe_row(RECIPE_MAIN, "Pasta"))]
        )
        repo = _repo_for_cook(meal_data, [])
        foreign_recipe = str(uuid.uuid4())
        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook",
                json={"meal_id": MEAL_ID, "servings": 2, "dishes": [{"recipe_id": foreign_recipe}]},
            )
        assert response.status_code == 409
        assert response.json()["detail"]["error_kind"] == "dish_mismatch"

    @pytest.mark.asyncio
    async def test_dish_mismatch_for_deleted_recipe(self, client: AsyncClient) -> None:
        """A dish dict whose recipe came back `{}` doesn't count as a member."""
        meal_data = _meal_with_dishes([_dish_row("main", 0, RECIPE_MAIN, None)])
        repo = _repo_for_cook(meal_data, [])
        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook",
                json={"meal_id": MEAL_ID, "servings": 2, "dishes": [{"recipe_id": RECIPE_MAIN}]},
            )
        assert response.status_code == 409
        assert response.json()["detail"]["error_kind"] == "dish_mismatch"

    @pytest.mark.asyncio
    async def test_duplicate_recipe_ids_is_422(self, client: AsyncClient) -> None:
        response = await client.post(
            "/v1/meals/cook",
            json={
                "meal_id": MEAL_ID,
                "servings": 2,
                "dishes": [{"recipe_id": RECIPE_MAIN}, {"recipe_id": RECIPE_MAIN}],
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_summing_across_dishes_per_pantry_item(self, client: AsyncClient) -> None:
        pantry = [_pantry_item(PANTRY_A, "cheese", 500.0, "g", 500.0, "g")]
        meal_data = _meal_with_dishes(
            [
                _dish_row(
                    "main", 0, RECIPE_MAIN,
                    _recipe_row(RECIPE_MAIN, "Pasta", ingredients=[{"name": "cheese", "quantity": 100.0, "unit": "g"}]),
                ),
                _dish_row(
                    "side", 1, RECIPE_SIDE,
                    _recipe_row(RECIPE_SIDE, "Salad", ingredients=[{"name": "cheese", "quantity": 50.0, "unit": "g"}]),
                ),
            ]
        )
        repo = _repo_for_cook(meal_data, pantry)
        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook",
                json={
                    "meal_id": MEAL_ID,
                    "servings": 2,
                    "dishes": [{"recipe_id": RECIPE_MAIN}, {"recipe_id": RECIPE_SIDE}],
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert len(data["matches"]) == 1
        assert data["matches"][0]["status"] == "ready"
        assert data["matches"][0]["deduct_qty"] == 150.0
        assert len(data["matches"][0]["sources"]) == 2

    @pytest.mark.asyncio
    async def test_shortfall_after_summing(self, client: AsyncClient) -> None:
        pantry = [_pantry_item(PANTRY_A, "cheese", 100.0, "g", 100.0, "g")]
        meal_data = _meal_with_dishes(
            [
                _dish_row(
                    "main", 0, RECIPE_MAIN,
                    _recipe_row(RECIPE_MAIN, "Pasta", ingredients=[{"name": "cheese", "quantity": 80.0, "unit": "g"}]),
                ),
                _dish_row(
                    "side", 1, RECIPE_SIDE,
                    _recipe_row(RECIPE_SIDE, "Salad", ingredients=[{"name": "cheese", "quantity": 60.0, "unit": "g"}]),
                ),
            ]
        )
        repo = _repo_for_cook(meal_data, pantry)
        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook",
                json={
                    "meal_id": MEAL_ID,
                    "servings": 2,
                    "dishes": [{"recipe_id": RECIPE_MAIN}, {"recipe_id": RECIPE_SIDE}],
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["matches"][0]["status"] == "shortfall"
        assert data["matches"][0]["deduct_qty"] == 100.0
        assert data["matches"][0]["shortfall"] == 40.0

    @pytest.mark.asyncio
    async def test_servings_scaling_fallback(self, client: AsyncClient) -> None:
        """No supplied list; recipe servings 4, meal servings 2 halves the quantity."""
        pantry = [_pantry_item(PANTRY_A, "flour", 1000.0, "g", 1000.0, "g")]
        meal_data = _meal_with_dishes(
            [
                _dish_row(
                    "main", 0, RECIPE_MAIN,
                    _recipe_row(
                        RECIPE_MAIN, "Bread", servings=4,
                        ingredients=[{"name": "flour", "quantity": 200.0, "unit": "g"}],
                    ),
                ),
            ]
        )
        repo = _repo_for_cook(meal_data, pantry)
        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook",
                json={"meal_id": MEAL_ID, "servings": 2, "dishes": [{"recipe_id": RECIPE_MAIN}]},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["matches"][0]["deduct_qty"] == 100.0
        assert data["dishes"][0]["ingredients_source"] == "recipe"

    @pytest.mark.asyncio
    async def test_string_scale_garlic(self, client: AsyncClient) -> None:
        """A supplied "2 cloves garlic" with string_scale = 4/2 gives ingredient_qty
        4.0, ingredient_unit "cloves", and double the deduct_qty of string_scale=1."""
        pantry = [_pantry_item(PANTRY_A, "garlic", 20.0, "count", 20.0, "count")]
        meal_data = _meal_with_dishes(
            [_dish_row("main", 0, RECIPE_MAIN, _recipe_row(RECIPE_MAIN, "Pasta"))]
        )
        repo = _repo_for_cook(meal_data, pantry)

        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            baseline = await client.post(
                "/v1/meals/cook",
                json={
                    "meal_id": MEAL_ID,
                    "servings": 2,
                    "dishes": [
                        {"recipe_id": RECIPE_MAIN, "ingredients": ["2 cloves garlic"], "string_scale": 1.0}
                    ],
                },
            )
            scaled = await client.post(
                "/v1/meals/cook",
                json={
                    "meal_id": MEAL_ID,
                    "servings": 4,
                    "dishes": [
                        {"recipe_id": RECIPE_MAIN, "ingredients": ["2 cloves garlic"], "string_scale": 2.0}
                    ],
                },
            )
        assert baseline.status_code == 200
        assert scaled.status_code == 200
        baseline_match = baseline.json()["matches"][0]
        scaled_match = scaled.json()["matches"][0]
        assert scaled_match["ingredient_qty"] == 4.0
        assert scaled_match["ingredient_unit"] == "cloves"
        assert scaled_match["deduct_qty"] == baseline_match["deduct_qty"] * 2

    @pytest.mark.asyncio
    async def test_supplied_objects_verbatim_and_blank_name_dropped(self, client: AsyncClient) -> None:
        pantry = [_pantry_item(PANTRY_A, "eggs", 12.0, "count", 12.0, "count")]
        meal_data = _meal_with_dishes(
            [_dish_row("main", 0, RECIPE_MAIN, _recipe_row(RECIPE_MAIN, "Omelette"))]
        )
        repo = _repo_for_cook(meal_data, pantry)
        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook",
                json={
                    "meal_id": MEAL_ID,
                    "servings": 4,
                    "dishes": [
                        {
                            "recipe_id": RECIPE_MAIN,
                            "ingredients": [
                                {"name": "eggs", "quantity": 6.0, "unit": "count"},
                                {"name": "  ", "quantity": 1.0, "unit": "count"},
                            ],
                            "string_scale": 1.0,
                        }
                    ],
                },
            )
        assert response.status_code == 200
        data = response.json()
        # Verbatim: the meal is servings=4 but the object's quantity (6) is not
        # rescaled -- objects already travel at meal scale.
        assert len(data["matches"]) == 1
        assert data["matches"][0]["deduct_qty"] == 6.0
        assert data["missing"] == []

    @pytest.mark.asyncio
    async def test_string_scale_one_is_unrounded(self, client: AsyncClient) -> None:
        pantry = [_pantry_item(PANTRY_A, "milk", 1000.0, "ml", 1000.0, "ml")]
        meal_data = _meal_with_dishes(
            [_dish_row("main", 0, RECIPE_MAIN, _recipe_row(RECIPE_MAIN, "Pancakes"))]
        )
        repo = _repo_for_cook(meal_data, pantry)
        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook",
                json={
                    "meal_id": MEAL_ID,
                    "servings": 2,
                    "dishes": [
                        {
                            "recipe_id": RECIPE_MAIN,
                            "ingredients": ["0.333 cup milk"],
                            "string_scale": 1.0,
                        }
                    ],
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["matches"][0]["ingredient_qty"] == 0.333

    @pytest.mark.asyncio
    async def test_amended_list_overrides_db(self, client: AsyncClient) -> None:
        pantry = [_pantry_item(PANTRY_A, "basil", 50.0, "g", 50.0, "g")]
        meal_data = _meal_with_dishes(
            [
                _dish_row(
                    "main", 0, RECIPE_MAIN,
                    _recipe_row(RECIPE_MAIN, "Pasta", ingredients=[{"name": "cheese", "quantity": 10.0, "unit": "g"}]),
                )
            ]
        )
        repo = _repo_for_cook(meal_data, pantry)
        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook",
                json={
                    "meal_id": MEAL_ID,
                    "servings": 2,
                    "dishes": [
                        {
                            "recipe_id": RECIPE_MAIN,
                            "ingredients": [{"name": "basil", "quantity": 5.0, "unit": "g"}],
                            "string_scale": 1.0,
                        }
                    ],
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["dishes"][0]["ingredients_source"] == "supplied"
        # cheese only exists in the DB row, not the supplied list -- absent.
        names = {m["ingredient_name"] for m in data["matches"]}
        assert "basil" in names
        assert "cheese" not in names

    @pytest.mark.asyncio
    async def test_one_alias_call_for_two_dishes(self, client: AsyncClient) -> None:
        from bubbly_chef.services.cook_matcher import _LLMIngredientMatch, _LLMMatchBatch

        pantry = [_pantry_item(PANTRY_A, "greek yogurt", 500.0, "g", 500.0, "g")]
        meal_data = _meal_with_dishes(
            [
                _dish_row(
                    "main", 0, RECIPE_MAIN,
                    _recipe_row(RECIPE_MAIN, "Bowl", ingredients=[{"name": "labneh", "quantity": 100.0, "unit": "g"}]),
                ),
                _dish_row(
                    "side", 1, RECIPE_SIDE,
                    _recipe_row(RECIPE_SIDE, "Dip", ingredients=[{"name": "labneh", "quantity": 50.0, "unit": "g"}]),
                ),
            ]
        )
        repo = _repo_for_cook(meal_data, pantry)
        ai_manager = AsyncMock()
        ai_manager.complete = AsyncMock(
            return_value=_LLMMatchBatch(
                results=[
                    _LLMIngredientMatch(
                        ingredient_name="labneh",
                        best_match="greek yogurt",
                        match_type="substitute",
                        confidence=0.95,
                        substitution_note="Greek yogurt stands in for labneh.",
                    )
                ]
            )
        )
        with (
            patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo),
            patch(f"{_ROUTE_MODULE}.get_ai_manager", return_value=ai_manager),
        ):
            response = await client.post(
                "/v1/meals/cook",
                json={
                    "meal_id": MEAL_ID,
                    "servings": 2,
                    "dishes": [{"recipe_id": RECIPE_MAIN}, {"recipe_id": RECIPE_SIDE}],
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert len(data["matches"]) == 1
        assert data["matches"][0]["status"] == "substitute"
        assert data["matches"][0]["match_type"] == "substitute"
        ai_manager.complete.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_expired_items_once_per_pantry_item(self, client: AsyncClient) -> None:
        from datetime import date, timedelta as _td

        expired = PantryItem(
            id=uuid.UUID(PANTRY_A),
            name="milk",
            category=FoodCategory.DAIRY,
            storage_location=StorageLocation.FRIDGE,
            quantity=1.0,
            unit="litre",
            quantity_base=1000.0,
            unit_base="ml",
            expiry_date=date.today() - _td(days=2),
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        meal_data = _meal_with_dishes(
            [
                _dish_row(
                    "main", 0, RECIPE_MAIN,
                    _recipe_row(RECIPE_MAIN, "Latte", ingredients=[{"name": "milk", "quantity": 200.0, "unit": "ml"}]),
                ),
                _dish_row(
                    "side", 1, RECIPE_SIDE,
                    _recipe_row(RECIPE_SIDE, "Cocoa", ingredients=[{"name": "milk", "quantity": 100.0, "unit": "ml"}]),
                ),
            ]
        )
        repo = _repo_for_cook(meal_data, [expired])
        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook",
                json={
                    "meal_id": MEAL_ID,
                    "servings": 2,
                    "dishes": [{"recipe_id": RECIPE_MAIN}, {"recipe_id": RECIPE_SIDE}],
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert len(data["expired_items"]) == 1

    @pytest.mark.asyncio
    async def test_expired_row_split_across_measured_and_unit_conflict_lines_gives_one_entry(
        self, client: AsyncClient
    ) -> None:
        """One expired pantry row can back TWO merged lines of different
        kinds (a measured line from one dish, a unit_conflict line from
        another) -- correlate_expired's `dedupe=True` on the meal route still
        reports it once (issue #654, code review S2)."""
        from datetime import date, timedelta as _td

        expired = PantryItem(
            id=uuid.UUID(PANTRY_A),
            name="eggs",
            category=FoodCategory.OTHER,
            storage_location=StorageLocation.PANTRY,
            quantity=12.0,
            unit="count",
            quantity_base=12.0,
            unit_base="count",
            expiry_date=date.today() - _td(days=2),
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        meal_data = _meal_with_dishes(
            [
                _dish_row(
                    "main", 0, RECIPE_MAIN,
                    _recipe_row(RECIPE_MAIN, "Omelette", ingredients=[{"name": "eggs", "quantity": 3.0, "unit": "count"}]),
                ),
                _dish_row(
                    "side", 1, RECIPE_SIDE,
                    # A genuinely mismatched dimension (volume vs the pantry
                    # row's count base) -- a real unit_conflict, not a soft
                    # "imprecise" fallback.
                    _recipe_row(RECIPE_SIDE, "Custard", ingredients=[{"name": "eggs", "quantity": 50.0, "unit": "ml"}]),
                ),
            ]
        )
        repo = _repo_for_cook(meal_data, [expired])
        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook",
                json={
                    "meal_id": MEAL_ID,
                    "servings": 2,
                    "dishes": [{"recipe_id": RECIPE_MAIN}, {"recipe_id": RECIPE_SIDE}],
                },
            )
        assert response.status_code == 200
        data = response.json()
        statuses = {m["status"] for m in data["matches"]}
        assert "unit_conflict" in statuses  # confirms the two-line-kinds premise
        assert len(data["matches"]) == 2
        assert len(data["expired_items"]) == 1


# ---------------------------------------------------------------------------
# POST /v1/meals/cook/confirm
# ---------------------------------------------------------------------------


COOK_REF = "cook-ref-1"


def _confirm_repo(
    meal_data: dict[str, Any] | None,
    claim: MealCookClaim | None,
    *,
    deduct_returns: bool = True,
) -> AsyncMock:
    repo = AsyncMock()
    repo.get_meal_with_dishes.return_value = meal_data
    repo.claim_meal_cook.return_value = claim
    repo.deduct_pantry_item.return_value = deduct_returns
    repo.update_recipe_cooked.return_value = True
    repo.mark_meal_cook_applied.return_value = None
    return repo


class TestMealCookConfirmRoute:
    @pytest.mark.asyncio
    async def test_dedup_deduction_across_dishes(self, client: AsyncClient) -> None:
        meal_data = _meal_with_dishes(
            [_dish_row("main", 0, RECIPE_MAIN, _recipe_row(RECIPE_MAIN, "Pasta"))]
        )
        claim = MealCookClaim(outcome="claimed", times_cooked=1, cooked_on=datetime.now(UTC).date())
        repo = _confirm_repo(meal_data, claim)

        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook/confirm",
                json={
                    "meal_id": MEAL_ID,
                    "cook_ref": COOK_REF,
                    "recipe_ids": [RECIPE_MAIN],
                    "deductions": [
                        {"pantry_item_id": PANTRY_A, "deduct_qty": 2.0, "base_unit": "count"},
                        {"pantry_item_id": PANTRY_A, "deduct_qty": 3.0, "base_unit": "count"},
                    ],
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["deductions_applied"] == 1
        repo.deduct_pantry_item.assert_called_once_with(
            user_id=TEST_USER_ID, item_id=PANTRY_A, deduct_qty=5.0
        )

    @pytest.mark.asyncio
    async def test_update_recipe_cooked_for_every_recipe_id(self, client: AsyncClient) -> None:
        meal_data = _meal_with_dishes(
            [
                _dish_row("main", 0, RECIPE_MAIN, _recipe_row(RECIPE_MAIN, "Pasta")),
                _dish_row("side", 1, RECIPE_SIDE, _recipe_row(RECIPE_SIDE, "Salad")),
            ]
        )
        claim = MealCookClaim(outcome="claimed", times_cooked=1, cooked_on=datetime.now(UTC).date())
        repo = _confirm_repo(meal_data, claim)

        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook/confirm",
                json={
                    "meal_id": MEAL_ID,
                    "cook_ref": COOK_REF,
                    "recipe_ids": [RECIPE_MAIN, RECIPE_SIDE],
                    "deductions": [],
                },
            )
        assert response.status_code == 200
        assert repo.update_recipe_cooked.call_count == 2
        repo.mark_meal_cook_applied.assert_called_once_with(TEST_USER_ID, MEAL_ID, COOK_REF)
        data = response.json()
        assert set(data["recipes_marked_cooked"]) == {RECIPE_MAIN, RECIPE_SIDE}
        assert data["meal_times_cooked"] == 1
        assert data["cooked_on"] == claim.cooked_on.isoformat()

    @pytest.mark.asyncio
    async def test_replay_applied(self, client: AsyncClient) -> None:
        meal_data = _meal_with_dishes(
            [_dish_row("main", 0, RECIPE_MAIN, _recipe_row(RECIPE_MAIN, "Pasta"))]
        )
        claim = MealCookClaim(outcome="replay_applied", times_cooked=3, cooked_on=datetime.now(UTC).date())
        repo = _confirm_repo(meal_data, claim)

        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook/confirm",
                json={
                    "meal_id": MEAL_ID,
                    "cook_ref": COOK_REF,
                    "recipe_ids": [RECIPE_MAIN],
                    "deductions": [{"pantry_item_id": PANTRY_A, "deduct_qty": 1.0, "base_unit": "count"}],
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["already_confirmed"] is True
        assert data["deductions_applied"] == 0
        assert data["recipes_marked_cooked"] == []
        repo.deduct_pantry_item.assert_not_called()
        repo.update_recipe_cooked.assert_not_called()
        repo.mark_meal_cook_applied.assert_not_called()

    @pytest.mark.asyncio
    async def test_replay_in_progress_and_confirm_incomplete(self, client: AsyncClient) -> None:
        meal_data = _meal_with_dishes(
            [_dish_row("main", 0, RECIPE_MAIN, _recipe_row(RECIPE_MAIN, "Pasta"))]
        )
        for outcome, expected_kind in (
            ("replay_in_progress", "confirm_in_progress"),
            ("replay_claimed", "confirm_incomplete"),
        ):
            claim = MealCookClaim(outcome=outcome, times_cooked=1, cooked_on=datetime.now(UTC).date())
            repo = _confirm_repo(meal_data, claim)
            with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
                response = await client.post(
                    "/v1/meals/cook/confirm",
                    json={
                        "meal_id": MEAL_ID,
                        "cook_ref": COOK_REF,
                        "recipe_ids": [RECIPE_MAIN],
                        "deductions": [],
                    },
                )
            assert response.status_code == 409
            assert response.json()["detail"]["error_kind"] == expected_kind
            repo.deduct_pantry_item.assert_not_called()

    @pytest.mark.asyncio
    async def test_replay_after_dish_swap_skips_membership_check(self, client: AsyncClient) -> None:
        """last_cook_ref already matches -- the claim classifies the replay,
        even though `recipe_ids` no longer names a current dish."""
        meal_data = _meal_with_dishes(
            [_dish_row("main", 0, RECIPE_MAIN, _recipe_row(RECIPE_MAIN, "Pasta"))],
            last_cook_ref=COOK_REF,
            last_cook_status="applied",
        )
        swapped_recipe = str(uuid.uuid4())
        claim = MealCookClaim(outcome="replay_applied", times_cooked=2, cooked_on=datetime.now(UTC).date())
        repo = _confirm_repo(meal_data, claim)

        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook/confirm",
                json={
                    "meal_id": MEAL_ID,
                    "cook_ref": COOK_REF,
                    "recipe_ids": [swapped_recipe],
                    "deductions": [],
                },
            )
        assert response.status_code == 200
        assert response.json()["already_confirmed"] is True

    @pytest.mark.asyncio
    async def test_apply_collapsed_deductions_raising_logs_and_reraises(
        self, client: AsyncClient, caplog: pytest.LogCaptureFixture
    ) -> None:
        meal_data = _meal_with_dishes(
            [_dish_row("main", 0, RECIPE_MAIN, _recipe_row(RECIPE_MAIN, "Pasta"))]
        )
        claim = MealCookClaim(outcome="claimed", times_cooked=1, cooked_on=datetime.now(UTC).date())
        repo = _confirm_repo(meal_data, claim)
        repo.deduct_pantry_item = AsyncMock(side_effect=[True, RuntimeError("db exploded")])

        with (
            patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo),
            caplog.at_level("ERROR"),
        ):
            response = await client.post(
                "/v1/meals/cook/confirm",
                json={
                    "meal_id": MEAL_ID,
                    "cook_ref": COOK_REF,
                    "recipe_ids": [RECIPE_MAIN],
                    "deductions": [
                        {"pantry_item_id": PANTRY_A, "deduct_qty": 1.0, "base_unit": "count"},
                        {"pantry_item_id": PANTRY_B, "deduct_qty": 2.0, "base_unit": "count"},
                    ],
                },
            )
        assert response.status_code == 500
        assert any("already applied" in record.message for record in caplog.records)
        repo.mark_meal_cook_applied.assert_not_called()

    @pytest.mark.asyncio
    async def test_failure_after_claim_returns_500_status_stays_claimed(self, client: AsyncClient) -> None:
        meal_data = _meal_with_dishes(
            [_dish_row("main", 0, RECIPE_MAIN, _recipe_row(RECIPE_MAIN, "Pasta"))]
        )
        claim = MealCookClaim(outcome="claimed", times_cooked=1, cooked_on=datetime.now(UTC).date())
        repo = _confirm_repo(meal_data, claim)
        repo.deduct_pantry_item = AsyncMock(side_effect=RuntimeError("db down"))

        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook/confirm",
                json={
                    "meal_id": MEAL_ID,
                    "cook_ref": COOK_REF,
                    "recipe_ids": [RECIPE_MAIN],
                    "deductions": [{"pantry_item_id": PANTRY_A, "deduct_qty": 1.0, "base_unit": "count"}],
                },
            )
        assert response.status_code == 500
        # mark_meal_cook_applied never reached -- status is left at 'claimed'
        # (asserted by absence, since this fake repo has no DB of its own).
        repo.mark_meal_cook_applied.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_deductions_still_marks_cooked(self, client: AsyncClient) -> None:
        meal_data = _meal_with_dishes(
            [_dish_row("main", 0, RECIPE_MAIN, _recipe_row(RECIPE_MAIN, "Pasta"))]
        )
        claim = MealCookClaim(outcome="claimed", times_cooked=1, cooked_on=datetime.now(UTC).date())
        repo = _confirm_repo(meal_data, claim)

        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook/confirm",
                json={
                    "meal_id": MEAL_ID,
                    "cook_ref": COOK_REF,
                    "recipe_ids": [RECIPE_MAIN],
                    "deductions": [],
                },
            )
        assert response.status_code == 200
        repo.update_recipe_cooked.assert_called_once()
        repo.deduct_pantry_item.assert_not_called()

    @pytest.mark.asyncio
    async def test_bad_cook_ref_charset_is_422(self, client: AsyncClient) -> None:
        response = await client.post(
            "/v1/meals/cook/confirm",
            json={
                "meal_id": MEAL_ID,
                "cook_ref": "not a safe ref!",
                "recipe_ids": [RECIPE_MAIN],
                "deductions": [],
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_dish_mismatch_before_any_claim(self, client: AsyncClient) -> None:
        meal_data = _meal_with_dishes(
            [_dish_row("main", 0, RECIPE_MAIN, _recipe_row(RECIPE_MAIN, "Pasta"))]
        )
        repo = _confirm_repo(meal_data, None)
        foreign_recipe = str(uuid.uuid4())

        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook/confirm",
                json={
                    "meal_id": MEAL_ID,
                    "cook_ref": COOK_REF,
                    "recipe_ids": [foreign_recipe],
                    "deductions": [],
                },
            )
        assert response.status_code == 409
        assert response.json()["detail"]["error_kind"] == "dish_mismatch"
        repo.claim_meal_cook.assert_not_called()

    @pytest.mark.asyncio
    async def test_new_cook_ref_deducts_again(self, client: AsyncClient) -> None:
        meal_data = _meal_with_dishes(
            [_dish_row("main", 0, RECIPE_MAIN, _recipe_row(RECIPE_MAIN, "Pasta"))],
            last_cook_ref="old-ref",
            last_cook_status="applied",
        )
        claim = MealCookClaim(outcome="claimed", times_cooked=5, cooked_on=datetime.now(UTC).date())
        repo = _confirm_repo(meal_data, claim)

        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook/confirm",
                json={
                    "meal_id": MEAL_ID,
                    "cook_ref": "brand-new-ref",
                    "recipe_ids": [RECIPE_MAIN],
                    "deductions": [{"pantry_item_id": PANTRY_A, "deduct_qty": 1.0, "base_unit": "count"}],
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["already_confirmed"] is False
        assert data["deductions_applied"] == 1
        repo.claim_meal_cook.assert_called_once_with(TEST_USER_ID, MEAL_ID, "brand-new-ref")

    @pytest.mark.asyncio
    async def test_membership_rechecked_when_stale_read_looked_like_a_replay(
        self, client: AsyncClient
    ) -> None:
        """The first read's `last_cook_ref` matched our `cook_ref` (so the
        membership check was skipped as a presumed replay), but between that
        read and `claim_meal_cook`'s own read, another device already moved
        `last_cook_ref` on to a different ref -- so THIS call's claim comes
        back `claimed` (a fresh claim), not a replay outcome. The membership
        check we skipped must still run, against a recipe_id that never was
        one of this meal's dishes (issue #654, code review N1)."""
        meal_data = _meal_with_dishes(
            [_dish_row("main", 0, RECIPE_MAIN, _recipe_row(RECIPE_MAIN, "Pasta"))],
            last_cook_ref=COOK_REF,
            last_cook_status="applied",
        )
        not_a_dish = str(uuid.uuid4())
        # claim_meal_cook itself resolves "claimed" -- simulating that its own
        # (later) read no longer saw last_cook_ref == COOK_REF.
        claim = MealCookClaim(outcome="claimed", times_cooked=4, cooked_on=datetime.now(UTC).date())
        repo = _confirm_repo(meal_data, claim)

        with patch(f"{_ROUTE_MODULE}.get_repository", return_value=repo):
            response = await client.post(
                "/v1/meals/cook/confirm",
                json={
                    "meal_id": MEAL_ID,
                    "cook_ref": COOK_REF,
                    "recipe_ids": [not_a_dish],
                    "deductions": [],
                },
            )

        assert response.status_code == 409
        assert response.json()["detail"]["error_kind"] == "dish_mismatch"
        repo.deduct_pantry_item.assert_not_called()
        repo.update_recipe_cooked.assert_not_called()
        repo.mark_meal_cook_applied.assert_not_called()
