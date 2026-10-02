"""Foods nobody counts: spices, powders, oils and other liquids (issue #892).

A recipe line for cinnamon is "1/4 tsp", "a pinch" or "to taste" -- never "0.25
count". A model asked for a numeric `quantity` and a unit sometimes answers with
`unit: "count"` for exactly these foods, and the amount is then meaningless. This
module says which foods are uncountable and cleans a line that counts one.

Deliberately conservative: a food is only listed when a count of it is never a
real amount. Countable lookalikes ("bell pepper", "cinnamon stick", "bay leaves")
stay countable, and anything unrecognised is left alone.

The same list is mirrored for display in
`nextjs/src/lib/ingredient-amount.ts` (stored recipes already carry the bad
amount); keep the two in step.
"""

from __future__ import annotations

import re

# Words that make a food uncountable wherever they sit in its name.
_SPICE_WORDS: frozenset[str] = frozenset(
    {
        "salt",
        "cinnamon",
        "cumin",
        "paprika",
        "turmeric",
        "cayenne",
        "nutmeg",
        "coriander",
        "cardamom",
        "allspice",
        "oregano",
        "thyme",
        "rosemary",
        "saffron",
        "sage",
    }
)

# Words that make a food uncountable when they are its head (last) word.
_HEAD_WORDS: frozenset[str] = frozenset(
    {
        "powder",
        "flake",
        "seasoning",
        "spice",
        "extract",
        "zest",
        "oil",
        "vinegar",
        "juice",
        "sauce",
        "broth",
        "stock",
        "wine",
        "water",
        "milk",
        "cream",
        "syrup",
        "honey",
        "molasses",
        "hummus",
        "mustard",
        "ketchup",
        "mayonnaise",
        "dressing",
        "paste",
        "marinade",
        "flour",
        "sugar",
        "starch",
        "cornstarch",
    }
)

# A head word that makes the food a countable piece again ("cinnamon stick").
_COUNTABLE_FORMS: frozenset[str] = frozenset(
    {"stick", "sprig", "leaf", "leave", "pod", "clove", "bulb", "head", "bunch"}
)

# "pepper" alone, or after one of these, is the seasoning; after anything else
# ("bell", "chili", "red", "jalapeno") it is a vegetable you count.
_PEPPER_SEASONING_PREFIXES: frozenset[str] = frozenset(
    {"black", "white", "ground", "cracked", "freshly", "lemon", "and"}
)

# The count units a model writes for a spice. "item"/"items" is deliberately absent: it is
# the pantry's default package unit, so "2 items" of milk is a real amount.
COUNT_LIKE_UNITS: frozenset[str] = frozenset({"count", "counts", "ct"})

# Words whose base form ends in "s": never singularised ("molasses" is not "molasse").
_BASE_FORM_S_WORDS: frozenset[str] = frozenset(
    {
        "molasses",
        "hummus",
        "couscous",
        "asparagus",
        "watercress",
        "lemongrass",
        "citrus",
        "swiss",
        "brussels",
        "harissa",
        "hibiscus",
    }
)

_NON_LETTERS = re.compile(r"[^a-z]+")
_PARENTHETICAL = re.compile(r"\([^)]*\)")


def _words(name: str) -> list[str]:
    """Lowercase singular-ish words of a food name, ignoring prep after a comma."""
    head = _PARENTHETICAL.sub(" ", name.lower()).split(",")[0]
    words = [w for w in _NON_LETTERS.split(head) if w]
    out: list[str] = []
    for word in words:
        if word == "leaves":
            out.append("leaf")
        elif word in _BASE_FORM_S_WORDS:
            out.append(word)
        elif len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            out.append(word[:-1])
        else:
            out.append(word)
    return out


def is_uncountable_food(name: str) -> bool:
    """True for a spice, powder, oil or other liquid -- a food whose "count" is nonsense."""
    words = _words(name or "")
    if not words:
        return False
    head = words[-1]
    if head in _COUNTABLE_FORMS:
        return False
    if any(w in _SPICE_WORDS for w in words):
        return True
    if head == "pepper":
        return len(words) == 1 or words[-2] in _PEPPER_SEASONING_PREFIXES
    return head in _HEAD_WORDS


def clean_ingredient_amount(
    name: str, quantity: float | None, unit: str | None
) -> tuple[float | None, str | None]:
    """Drop an amount that counts an uncountable food; leave every other line alone.

    "0.25 count cinnamon" has lost its real unit (tsp? a pinch?) and cannot be
    recovered, so both fields go and the line reads as "to taste" rather than as a
    made-up measure. A recipe's own unit ("tsp", "pinch", "tbsp") is never touched.
    """
    if not is_uncountable_food(name):
        return quantity, unit
    unit_word = (unit or "").strip().lower()
    if unit_word in COUNT_LIKE_UNITS:
        return None, None
    if not unit_word and quantity is not None and not float(quantity).is_integer():
        return None, None
    return quantity, unit
