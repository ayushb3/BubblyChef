"""Pantry-access cooking tool for the ReAct agent."""

from __future__ import annotations

import logging
import re
from datetime import date

from bubbly_chef.domain.stock import is_usable_stock
from bubbly_chef.models.pantry import PantryItem
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


def _found_exact(item: PantryItem) -> str:
    """A usable row, reported as stock with its expiry countdown."""
    qty_str = f"{item.quantity} {item.unit}".strip()
    expiry_note = ""
    if item.expiry_date:
        expiry_note = f", expires in {(item.expiry_date - date.today()).days} day(s)"
    return f"Yes, the pantry has {item.name}: {qty_str}{expiry_note}."


def _unusable_note(item: PantryItem) -> str:
    """An expired or used-up row: present in the table, but not stock (#443)."""
    if item.expiry_date and item.expiry_date < date.today():
        reason = f"expired on {item.expiry_date.isoformat()}"
    else:
        reason = "used up (quantity 0)"
    return (
        f"No usable {item.name} in the pantry: the entry there is {reason}, "
        "so treat it as not available."
    )


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

        # Expired and used-up rows stay in the table (#443), and duplicates of
        # the same item can coexist (#127), so no single row is trusted as
        # "the" answer: collect every match, answer from a usable one, and only
        # mention an unusable one when nothing usable exists.
        unusable: list[PantryItem] = []

        # 1. Exact match via find_similar_item (normalized)
        match = await repo.find_similar_item(user_id, ingredient)
        if match:
            if is_usable_stock(match.quantity, match.expiry_date):
                return _found_exact(match)
            unusable.append(match)

        # 2. Fall back to a word-level scan of all items.  Match only on shared
        #    whole words, not raw substrings — otherwise "buttermilk" wrongly
        #    matches "butter" (butter ⊂ buttermilk) and "cream" matches
        #    "ice cream sandwich".  Splitting on non-alphanumerics and comparing
        #    word sets keeps "eggs" → "large free-range eggs" and
        #    "chicken" → "chicken breast" while rejecting the false positives.
        items = await repo.get_all_pantry_items(user_id)
        needle = ingredient.lower().strip()
        needle_words = _words(ingredient)
        candidates = [it for it in items if needle_words & _words(it.name)]
        # A fresh duplicate of the exact name beats a partial-word match.
        candidates.sort(key=lambda it: it.name.lower().strip() != needle)
        for item in candidates:
            if not is_usable_stock(item.quantity, item.expiry_date):
                unusable.append(item)
                continue
            if item.name.lower().strip() == needle:
                return _found_exact(item)
            qty_str = f"{item.quantity} {item.unit}".strip()
            return (
                f"The pantry has '{item.name}' which may match "
                f"'{ingredient}': {qty_str}."
            )

        if unusable:
            return _unusable_note(unusable[0])

        return f"'{ingredient}' was not found in the pantry."

    except Exception as e:
        logger.warning(f"check_pantry lookup failed for '{ingredient}': {e}")
        return f"Could not check pantry for '{ingredient}' right now."
