"""Fetch a user's stored dietary preferences (issue #394).

Single call site for the "profile default" half of the recipe/chat dietary
precedence rule:

- An explicit dietary ask made *in this message* (captured via
  ``RecipeConstraints.dietary`` extraction, or a plain-text ask in chat)
  always wins for that turn — a stored preference is a default, not a
  prohibition.
- The stored profile preference is the fallback used when the message (and,
  for recipe grounding, the constraints carried over from earlier turns in
  the session) say nothing about diet at all — it must never be silently
  dropped just because the user didn't repeat it this turn.

A profile row that is missing, empty, or unreachable (DB error, RLS denial,
etc.) degrades to "no stored preferences" and never raises — a dietary
lookup failure must not break recipe generation or chat.
"""

import logging

from bubbly_chef.repository.supabase_repo import get_repository

logger = logging.getLogger(__name__)


async def get_stored_dietary_preferences(user_id: str) -> list[str]:
    """Return the user's saved `profiles.dietary_preferences`, or `[]`.

    Never raises. Any failure (missing profile, unreachable DB, malformed
    column) is logged and treated the same as "the user has no preferences".
    """
    if not user_id:
        return []
    try:
        repo = await get_repository()
        profile = await repo.get_profile(user_id)
    except Exception as e:  # noqa: BLE001 — a profile lookup failure must degrade, not raise
        logger.warning("Could not fetch dietary preferences for %s: %s", user_id, e)
        return []

    if not profile:
        return []

    prefs = profile.get("dietary_preferences")
    if not isinstance(prefs, list):
        return []
    return [str(p) for p in prefs if p]
