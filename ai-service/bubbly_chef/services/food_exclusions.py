"""The user's stored allergies and disliked ingredients (issue #500, spec B.8).

Two profile fields with two very different strengths:

* `allergies` are a hard "never suggest" (safety, not preference). Nothing in a
  message overrides one, and every generation path runs `services.allergen_guard`
  on what the model returns, so the model is never the only line of defence.
* `disliked_ingredients` are a preference. They are left out of suggestions, but
  a message that explicitly asks for one ("add cilantro on top") wins for that
  one reply (see `workflows/recipe/exclusions.py`).

A profile row that is missing, unreachable, or has no such columns yet (the
migration for them may not have run) degrades to "nothing stored" and never
raises: an exclusions lookup failure must not break recipe generation or chat.
"""

import logging
from dataclasses import dataclass

from bubbly_chef.domain.diet_terms import norm_label
from bubbly_chef.prompts.recipe import ALLERGY_NEVER_TEMPLATE, DISLIKES_TEMPLATE
from bubbly_chef.repository.supabase_repo import get_repository

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FoodExclusions:
    """What the profile says to keep out of suggestions."""

    allergies: tuple[str, ...] = ()
    dislikes: tuple[str, ...] = ()


def _clean_list(raw: object) -> tuple[str, ...]:
    """A JSONB string list from a profile row: trimmed, de-duplicated, order kept."""
    if not isinstance(raw, list):
        return ()
    seen: set[str] = set()
    cleaned: list[str] = []
    for entry in raw:
        if not isinstance(entry, str):
            continue
        text = " ".join(entry.split())
        key = norm_label(text)
        if not key or key in seen:
            continue
        seen.add(key)
        cleaned.append(text)
    return tuple(cleaned)


async def get_stored_food_exclusions(user_id: str) -> FoodExclusions:
    """The user's saved allergies and dislikes, or an empty `FoodExclusions`.

    Never raises. A failure (missing profile, unreachable DB, malformed or absent
    column) is logged and treated as "the user has stored nothing". An entry that
    is both an allergy and a dislike is an allergy only.
    """
    if not user_id:
        return FoodExclusions()
    try:
        repo = await get_repository()
        profile = await repo.get_profile(user_id)
    except Exception as e:  # noqa: BLE001 — an exclusions lookup failure must degrade, not raise
        logger.warning("Could not fetch food exclusions for %s: %s", user_id, e)
        return FoodExclusions()

    if not profile:
        return FoodExclusions()

    allergies = _clean_list(profile.get("allergies"))
    allergy_keys = {norm_label(a) for a in allergies}
    dislikes = tuple(
        d for d in _clean_list(profile.get("disliked_ingredients")) if norm_label(d) not in allergy_keys
    )
    return FoodExclusions(allergies=allergies, dislikes=dislikes)


def allergy_never_block(allergies: list[str] | tuple[str, ...]) -> str:
    """The explicit "NEVER include (allergy)" block appended to a generation prompt.

    Empty when there are no allergies, so a prompt for a user without any is
    byte-identical to what it was before #500.
    """
    if not allergies:
        return ""
    return "\n\n" + ALLERGY_NEVER_TEMPLATE.format(allergens=", ".join(allergies))


def dislikes_block(dislikes: list[str] | tuple[str, ...]) -> str:
    """The soft "leave these out" line for prompts that have no `Exclude:` constraint line."""
    if not dislikes:
        return ""
    return "\n\n" + DISLIKES_TEMPLATE.format(dislikes=", ".join(dislikes))
