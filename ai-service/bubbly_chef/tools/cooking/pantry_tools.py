"""Pantry-access cooking tool for the ReAct agent."""

from __future__ import annotations

import logging
import re
from datetime import date

from bubbly_chef.repository.supabase_repo import get_repository
from bubbly_chef.tools.registry import tool

logger = logging.getLogger(__name__)

# Split a name into lowercase alphanumeric words, dropping possessive/plural
# noise is unnecessary here — a simple word-set intersection is enough to match
# "eggs" against "large free-range eggs" without matching "butter" ⊂ "buttermilk".
_WORD_RE = re.compile(r"[a-z0-9]+")


def _words(text: str) -> set[str]:
    """Return the set of lowercase alphanumeric words in ``text``."""
    return set(_WORD_RE.findall(text.lower()))


@tool
async def check_pantry(ingredient: str, *, user_id: str) -> str:
    """Check whether a specific ingredient is in the user's pantry.

    Returns the quantity and unit if found, or a clear "not found" message.
    Use this when the user asks about substitutions, whether they have
    something on hand, or what they can cook given their current pantry.
    Do NOT use this for general cooking knowledge the model already has.

    Args:
        ingredient: The ingredient to look up (e.g. "butter", "buttermilk").

    Note:
        ``user_id`` is node-injected and is NOT visible to the model.
    """
    try:
        repo = await get_repository()

        # 1. Try exact match via find_similar_item (normalized)
        match = await repo.find_similar_item(user_id, ingredient)
        if match:
            days_until_expiry: str | None = None
            if match.expiry_date:
                days_left = (match.expiry_date - date.today()).days
                days_until_expiry = (
                    f", expires in {days_left} day(s)"
                    if days_left >= 0
                    else ", EXPIRED"
                )
            qty_str = f"{match.quantity} {match.unit}".strip()
            expiry_note = days_until_expiry or ""
            return f"Yes, the pantry has {match.name}: {qty_str}{expiry_note}."

        # 2. Fall back to a word-level scan of all items.  Match only on shared
        #    whole words, not raw substrings — otherwise "buttermilk" wrongly
        #    matches "butter" (butter ⊂ buttermilk) and "cream" matches
        #    "ice cream sandwich".  Splitting on non-alphanumerics and comparing
        #    word sets keeps "eggs" → "large free-range eggs" and
        #    "chicken" → "chicken breast" while rejecting the false positives.
        items = await repo.get_all_pantry_items(user_id)
        needle_words = _words(ingredient)
        for item in items:
            if needle_words & _words(item.name):
                qty_str = f"{item.quantity} {item.unit}".strip()
                return (
                    f"The pantry has '{item.name}' which may match "
                    f"'{ingredient}': {qty_str}."
                )

        return f"'{ingredient}' was not found in the pantry."

    except Exception as e:
        logger.warning(f"check_pantry lookup failed for '{ingredient}': {e}")
        return f"Could not check pantry for '{ingredient}' right now."
