"""Folding the profile's allergies and dislikes into a turn's constraints (issue #500).

The one place that decides what a stored allergy or dislike does to
`RecipeConstraints.excluded_ingredients`:

* An allergy is always excluded. Nothing in the message overrides it, and any
  `must_use` / `preferred` ingredient that names one is dropped so the prompt can't
  contradict itself ("make me peanut noodles" for a peanut-allergic user).
* A dislike is excluded unless this message explicitly asks for it ("add cilantro
  on top"). "Without cilantro" is not an ask, so it stays excluded.

Pure (no I/O): callers read the profile with `get_stored_food_exclusions`.
"""

from typing import Any, NamedTuple

from bubbly_chef.domain.allergens import drop_naming_allergen
from bubbly_chef.domain.diet_terms import mentions
from bubbly_chef.services.food_exclusions import FoodExclusions
from bubbly_chef.workflows.recipe.refine_diet import added_text


class AppliedExclusions(NamedTuple):
    """`apply_food_exclusions`'s result."""

    constraints: dict[str, Any]
    allergies: list[str]
    dislikes_set_aside: list[str]
    # Every profile-origin entry now in `constraints["excluded_ingredients"]`, so the
    # session never persists an exclusion the profile may later drop.
    profile_excluded: list[str]


def asks_for(term: str, message: str) -> bool:
    """True when `message` explicitly wants `term` (and doesn't just name it to reject it)."""
    return mentions(term, added_text(message), plant_markers=False)


def union_case_insensitive(base: list[str], extra: list[str]) -> list[str]:
    """`base` then any `extra` entries it doesn't already hold (case-insensitively)."""
    seen = {x.strip().lower() for x in base}
    merged = list(base)
    for item in extra:
        key = item.strip().lower()
        if key and key not in seen:
            seen.add(key)
            merged.append(item)
    return merged


def apply_food_exclusions(
    constraints: dict[str, Any], stored: FoodExclusions, message: str
) -> AppliedExclusions:
    """`constraints` with the profile's allergies and (un-overridden) dislikes excluded."""
    allergies = list(stored.allergies)
    active_dislikes = [d for d in stored.dislikes if not asks_for(d, message)]
    set_aside = [d for d in stored.dislikes if d not in active_dislikes]

    result = dict(constraints)
    profile_excluded = [*allergies, *active_dislikes]
    if profile_excluded or constraints.get("excluded_ingredients"):
        result["excluded_ingredients"] = union_case_insensitive(
            list(constraints.get("excluded_ingredients") or []), profile_excluded
        )
    if allergies:
        for key in ("must_use_ingredients", "preferred_ingredients"):
            if result.get(key):
                result[key] = drop_naming_allergen(result[key], allergies)
    return AppliedExclusions(result, allergies, set_aside, profile_excluded)
