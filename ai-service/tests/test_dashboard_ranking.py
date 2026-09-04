"""Unit tests for deterministic dashboard recipe ranking (#225, #168).

No LLM anywhere in this file — `rank_recipes` is pure, synchronous, and the
whole point of the split described in
`docs/plans/2026-09-04-dashboard-daily-endpoint.md` is that this is testable
without mocking `AIManager`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest

from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.services.dashboard_ranking import dashboard_meal_time_bucket, rank_recipes

_WEIGHTS = {"weight_expiry": 0.6, "weight_pantry": 0.3, "weight_mealtime": 0.1}


def _uid(label: str) -> str:
    """Deterministic UUID from a short label — cook_matcher.match_ingredients()
    requires a real UUID string for CookProposal.recipe_id."""
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, label))


def _pantry_item(
    name: str,
    *,
    expiry_days: int | None = None,
    updated_at: datetime | None = None,
) -> PantryItem:
    expiry = (date.today() + timedelta(days=expiry_days)) if expiry_days is not None else None
    return PantryItem(
        id=uuid.uuid4(),
        name=name,
        category=FoodCategory.OTHER,
        storage_location=StorageLocation.PANTRY,
        quantity=1.0,
        unit="item",
        quantity_base=1.0,
        unit_base="count",
        expiry_date=expiry,
        created_at=datetime.now(UTC),
        updated_at=updated_at or datetime.now(UTC),
    )


def _recipe(
    recipe_id: str,
    title: str,
    ingredient_names: list[str],
    *,
    meal_type: str | None = None,
    total_time_minutes: int | None = 20,
    created_at: str = "2026-01-01T00:00:00+00:00",
) -> dict:
    return {
        "id": _uid(recipe_id),
        "title": title,
        "ingredients": [{"name": n, "quantity": 1, "unit": "count"} for n in ingredient_names],
        "meal_type": meal_type,
        "total_time_minutes": total_time_minutes,
        "created_at": created_at,
    }


# ---------------------------------------------------------------------------
# Time-of-day bucketing
# ---------------------------------------------------------------------------


def test_meal_time_bucket_breakfast() -> None:
    assert dashboard_meal_time_bucket(datetime(2026, 1, 1, 7, 0)) == "breakfast"


def test_meal_time_bucket_lunch() -> None:
    assert dashboard_meal_time_bucket(datetime(2026, 1, 1, 13, 0)) == "lunch"


def test_meal_time_bucket_dinner() -> None:
    assert dashboard_meal_time_bucket(datetime(2026, 1, 1, 19, 0)) == "dinner"


def test_meal_time_bucket_late_night_is_snack() -> None:
    assert dashboard_meal_time_bucket(datetime(2026, 1, 1, 23, 0)) == "snack"
    assert dashboard_meal_time_bucket(datetime(2026, 1, 1, 2, 0)) == "snack"


def test_meal_time_bucket_matches_recipe_tagger_rule_not_the_greeting() -> None:
    """15:00 is the disagreement window a review pass measured (#225/#168):
    HeroHome.tsx's greeting boundaries (5/12/18/22) call this "afternoon" ->
    would map to "lunch", but `_default_meal_type`'s boundaries (5/10/14/17/21)
    — the rule that actually tags `recipe.meal_type` — call it "snack".
    Ranking must agree with the tagger, since it compares against the tag.
    """
    assert dashboard_meal_time_bucket(datetime(2026, 1, 1, 15, 0)) == "snack"


# ---------------------------------------------------------------------------
# Core ranking behaviour
# ---------------------------------------------------------------------------


def test_no_recipes_returns_none() -> None:
    assert rank_recipes([], [], now=datetime(2026, 1, 1, 12, 0), **_WEIGHTS) is None


def test_expiring_ingredients_outrank_non_expiring_all_else_equal() -> None:
    """The load-bearing acceptance criterion from the design doc."""
    pantry = [
        _pantry_item("chicken", expiry_days=1),
        _pantry_item("rice", expiry_days=30),
    ]
    recipe_expiring = _recipe("r1", "Chicken and rice", ["chicken", "rice"])
    recipe_fresh = _recipe("r2", "Rice bowl", ["rice"])

    top = rank_recipes(
        [recipe_fresh, recipe_expiring], pantry, now=datetime(2026, 1, 1, 12, 0), **_WEIGHTS
    )

    assert top is not None
    assert top.recipe_id == _uid("r1")
    assert top.reason == "expiring"
    assert "chicken" in top.expiring_pantry_names


def test_pantry_coverage_breaks_a_tie_when_nothing_expiring() -> None:
    pantry = [_pantry_item("flour"), _pantry_item("sugar"), _pantry_item("eggs")]
    fully_covered = _recipe("r1", "Cookies", ["flour", "sugar", "eggs"])
    partially_covered = _recipe("r2", "Bread", ["flour", "yeast", "water", "salt"])

    top = rank_recipes(
        [partially_covered, fully_covered], pantry, now=datetime(2026, 1, 1, 12, 0), **_WEIGHTS
    )

    assert top is not None
    assert top.recipe_id == _uid("r1")
    assert top.reason == "pantry_match"


def test_meal_time_match_contributes_to_score() -> None:
    pantry: list[PantryItem] = []
    breakfast_recipe = _recipe("r1", "Pancakes", [], meal_type="breakfast")
    dinner_recipe = _recipe("r2", "Steak", [], meal_type="dinner")

    # 7am -> breakfast bucket
    top = rank_recipes(
        [dinner_recipe, breakfast_recipe], pantry, now=datetime(2026, 1, 1, 7, 0), **_WEIGHTS
    )

    assert top is not None
    assert top.recipe_id == _uid("r1")
    assert top.reason == "meal_time"


def test_ties_break_by_most_recently_saved() -> None:
    pantry: list[PantryItem] = []
    older = _recipe("r1", "Older", [], created_at="2025-01-01T00:00:00+00:00")
    newer = _recipe("r2", "Newer", [], created_at="2026-01-01T00:00:00+00:00")

    top = rank_recipes([older, newer], pantry, now=datetime(2026, 1, 1, 12, 0), **_WEIGHTS)

    assert top is not None
    assert top.recipe_id == _uid("r2")


def test_ranking_is_deterministic_across_repeated_calls() -> None:
    pantry = [_pantry_item("chicken", expiry_days=2), _pantry_item("rice", expiry_days=20)]
    recipes = [
        _recipe("r1", "Chicken rice", ["chicken", "rice"]),
        _recipe("r2", "Plain rice", ["rice"]),
        _recipe("r3", "Salad", ["lettuce"]),
    ]
    now = datetime(2026, 1, 1, 18, 30)

    results = [rank_recipes(recipes, pantry, now=now, **_WEIGHTS) for _ in range(5)]

    assert all(r is not None for r in results)
    assert len({r.recipe_id for r in results if r is not None}) == 1  # type: ignore[union-attr]


def test_suggestion_is_always_one_of_the_candidates_never_invented() -> None:
    pantry = [_pantry_item("basil", expiry_days=1)]
    recipes = [
        _recipe("r1", "Pesto pasta", ["basil", "pasta", "pine nuts"]),
        _recipe("r2", "Tomato soup", ["tomato"]),
    ]
    candidate_ids = {r["id"] for r in recipes}

    top = rank_recipes(recipes, pantry, now=datetime(2026, 1, 1, 12, 0), **_WEIGHTS)

    assert top is not None
    assert top.recipe_id in candidate_ids


def test_expired_items_do_not_count_as_expiring() -> None:
    """An item past its date is not promoted as 'expiring soon' — same rule as
    the recipe grounding workflow's score_and_rank (#239)."""
    pantry = [_pantry_item("old milk", expiry_days=-5)]
    recipe = _recipe("r1", "Milk toast", ["old milk"])

    top = rank_recipes([recipe], pantry, now=datetime(2026, 1, 1, 12, 0), **_WEIGHTS)

    assert top is not None
    assert top.expiring_pantry_names == []


def test_zero_signal_pick_is_labeled_fallback_not_pantry_match() -> None:
    """A recipe that matched nothing and has no meal_type still has to win by
    tie-break when it's the only candidate — but the UI must not be told this
    was a pantry match when it wasn't one."""
    pantry: list[PantryItem] = []
    recipe = _recipe("r1", "Mystery dish", ["unobtainium"])  # matches nothing

    top = rank_recipes([recipe], pantry, now=datetime(2026, 1, 1, 3, 0), **_WEIGHTS)

    assert top is not None
    assert top.score == 0.0
    assert top.reason == "fallback"


def test_expiry_thresholds_are_configurable() -> None:
    """Same pantry, tighter urgency window — a 5-day-out item stops counting
    as 'expiring soon' once `expiry_soon_days` is lowered below 5."""
    pantry = [_pantry_item("cream", expiry_days=5)]
    recipe = _recipe("r1", "Cream sauce", ["cream"])

    default_top = rank_recipes([recipe], pantry, now=datetime(2026, 1, 1, 12, 0), **_WEIGHTS)
    tight_top = rank_recipes(
        [recipe],
        pantry,
        now=datetime(2026, 1, 1, 12, 0),
        expiry_urgent_days=1,
        expiry_soon_days=3,
        **_WEIGHTS,
    )

    assert default_top is not None and tight_top is not None
    assert default_top.score > tight_top.score
    assert tight_top.score == pytest.approx(_WEIGHTS["weight_pantry"] * 1.0)


def test_plain_string_ingredients_are_handled() -> None:
    """Stored recipes genuinely have string-shaped ingredients (not just
    dicts) — `cook_matcher` handles both, but nothing previously exercised
    that shape through the dashboard ranking path."""
    pantry = [_pantry_item("flour"), _pantry_item("eggs")]
    recipe = {
        "id": _uid("r1"),
        "title": "Pancakes",
        "ingredients": ["2 cups flour", "3 eggs", "1 tsp vanilla"],
        "meal_type": None,
        "total_time_minutes": 20,
        "created_at": "2026-01-01T00:00:00+00:00",
    }

    top = rank_recipes([recipe], pantry, now=datetime(2026, 1, 1, 8, 0), **_WEIGHTS)

    assert top is not None
    assert top.recipe_id == _uid("r1")
    assert set(top.matched_pantry_names) == {"flour", "eggs"}
