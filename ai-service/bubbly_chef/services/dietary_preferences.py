"""Fetch a user's stored dietary preferences (issue #394).

Single call site for the "profile default" half of the recipe/chat dietary
rule: a stored preference stays in force and *combines* with whatever this
message (or, for recipe grounding, an earlier turn in the same session) asks
for — it is never silently dropped just because a turn didn't repeat it. A
stored preference is set aside, for that one reply only, when the message
explicitly asks for an ingredient it forbids (e.g. a meat dish despite a
stored "Vegetarian"). See `workflows/recipe/nodes.py`'s
`_combine_dietary_preferences` for the recipe-grounding implementation of
this rule, and `workflows/chat/nodes.py`'s `format_dietary_context` for the
prompt-text equivalent used in plain chat.

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
