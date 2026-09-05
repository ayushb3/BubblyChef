"""Curated set of culinary staples assumed to be on hand (#305).

A staple absent from the pantry is tagged ``assumed`` rather than ``missing``,
so a recipe whose only unmatched ingredients are salt, pepper, and oil is not
reported as partially makeable.

**Scope intentionally narrow.** This is NOT a general "cheap ingredient" list.
It covers:
  - Salt (all common varieties)
  - Black pepper
  - Neutral and olive oils
  - Sugar and water
  - A short list of common dried spices that virtually every kitchen holds

Items are stored as normalized names — the same form ``normalize_food_name``
produces, so matching against the cook-matcher's ingredient index is exact.
"""

from __future__ import annotations

# Primary lookup set — normalized names. Keep conservative: a staple must be
# something a home cook would be surprised NOT to have. If in doubt, leave it
# out: a false positive ("we assumed X but you didn't have it") is worse than
# a false negative ("you had to confirm X was present").
CULINARY_STAPLES: frozenset[str] = frozenset({
    # Salt
    "salt",
    # Pepper
    "black pepper",
    "pepper",
    "white pepper",
    # Oils — "oil" is a bare common-name catch-all; recipe text like "cooking oil"
    # or "vegetable oil" normalizes to one of these. NOT specialty oils (truffle, sesame).
    "olive oil",
    "vegetable oil",
    "cooking oil",
    "canola oil",
    "oil",
    # Sugar — granulated/white only; brown sugar and honey are not universal
    "sugar",
    # Common dried spices every kitchen holds
    "garlic powder",
    "onion powder",
    "paprika",
    "cumin",
    "dried oregano",
    "oregano",
    "dried thyme",
    "thyme",
    "dried basil",
    "cinnamon",
    "chili powder",
    "red pepper flakes",
    "cayenne",
    "cayenne pepper",
    "bay leaf",
    "bay leaves",
    "turmeric",
    "dried parsley",
    # NB: bare "parsley" intentionally omitted — fresh parsley is produce a cook
    # frequently lacks; assuming it on hand is a false positive.
    # NB: "water" intentionally omitted — included in beverages category and
    # while water is universal, recipe ingredients listed as "water" often mean
    # a specific measured amount the cook may not have ready; safer not to assume.
    # Baking basics
    "baking powder",
    "baking soda",
})


def is_staple(normalized_name: str) -> bool:
    """Return True when *normalized_name* is in the curated staples set.

    The caller is expected to have already run ``normalize_food_name`` on the
    ingredient name so that synonyms collapse before reaching this check — the
    same contract the rest of the cook-matcher stack uses.
    """
    return normalized_name.lower().strip() in CULINARY_STAPLES
