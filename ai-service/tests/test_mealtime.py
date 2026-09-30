"""Unit tests for the single shared hour->meal-type bucket rule (#225 review).

`domain/mealtime.py` exists because a review pass found the dashboard's
originally hand-rolled boundaries disagreed with the recipe tagger's for
7 of 24 hours — this file locks the one shared rule down directly.
"""

from bubbly_chef.domain.mealtime import meal_time_bucket


def test_breakfast_boundaries() -> None:
    assert meal_time_bucket(5) == "breakfast"
    assert meal_time_bucket(9) == "breakfast"


def test_lunch_boundaries() -> None:
    assert meal_time_bucket(10) == "lunch"
    assert meal_time_bucket(13) == "lunch"


def test_afternoon_snack_boundaries() -> None:
    assert meal_time_bucket(14) == "snack"
    assert meal_time_bucket(16) == "snack"


def test_dinner_boundaries() -> None:
    assert meal_time_bucket(17) == "dinner"
    assert meal_time_bucket(20) == "dinner"


def test_late_night_is_its_own_label() -> None:
    """Distinct from the daytime "snack" bucket — callers that need the
    4-value vocabulary (breakfast|lunch|dinner|snack) fold this themselves."""
    assert meal_time_bucket(21) == "late-night snack"
    assert meal_time_bucket(23) == "late-night snack"
    assert meal_time_bucket(0) == "late-night snack"
    assert meal_time_bucket(4) == "late-night snack"
