"""The shared forbidden-food matcher (issues #684, #685).

One deep, pure module owns "does this text ask for a food this diet forbids",
with the plant-based guard inside it, so every caller (first-turn constraint
extraction, brainstorm picks, chat and library refine, the meal flows) reads the
same table and the same false-friend rules. No imports from `workflows/`, no I/O.

Two kinds of data live here and are treated differently:

* Literal text: `FORBIDDEN_FOODS` terms, `IRREGULAR_PLURALS` values and
  `NO_PLURAL`. `term_pattern` escapes them with `re.escape`.
* Regex fragments: every guard tuple and every false-friend phrase. They are
  joined with `|` unescaped (`plant[- ]based`, `dairy[- ]free`).

A guard rejects one *occurrence* of a term; it never strips whole phrases. So
"almond milk" still names almond for Nut-free while it doesn't name milk for
Vegan.
"""

import re
from functools import lru_cache

# ---------------------------------------------------------------------------
# Labels and haystacks
# ---------------------------------------------------------------------------

# Every haystack that joins more than one field joins them with this, never a
# space. `|` is in neither `[\s-]` nor `[\w']`, so no guard regex can read across
# it: ["pasta", "mushrooms", "bacon"] must not turn into "mushrooms bacon" (which
# the imitation guard would hide), nor ["tofu", "chicken thighs"] into "tofu
# chicken" (which the plant-marker window would hide).
FIELD_SEP = " | "


def join_fields(*parts: str) -> str:
    """Join separate text fields into one haystack the guards can't read across."""
    return FIELD_SEP.join(parts)


def norm_label(label: str) -> str:
    """Case, space, underscore and hyphen-insensitive form of a diet label (#544)."""
    return re.sub(r"[\s_-]+", "-", label.strip().lower())


# ---------------------------------------------------------------------------
# The table (literal text, singular; plurals come from `term_pattern`)
# ---------------------------------------------------------------------------

MEAT = frozenset(
    {
        "meat", "beef", "pork", "chicken", "turkey", "lamb", "mutton", "veal", "venison",
        "duck", "goose", "quail", "bacon", "ham", "sausage", "steak", "brisket", "jerky",
        "pancetta", "prosciutto", "chorizo", "salami", "pepperoni", "guanciale", "pastrami",
        "mortadella", "nduja", "bratwurst", "kielbasa", "andouille", "foie gras", "meatball",
        "lard", "lardon", "tallow", "gelatin", "gelatine",
        "liver", "suet", "bresaola", "speck", "oxtail", "tripe",
    }
)
SEAFOOD = frozenset(
    {
        "fish", "shellfish", "seafood", "salmon", "tuna", "cod", "haddock", "halibut",
        "tilapia", "catfish", "swordfish", "monkfish", "sea bass", "snapper", "herring", "eel",
        "anchovy", "sardine", "mackerel", "trout", "bonito", "caviar", "roe", "lox",
        "shrimp", "prawn", "crab", "crawfish", "crayfish", "lobster", "clam", "mussel",
        "oyster", "scallop", "squid", "calamari", "octopus",
    }
)
# "rib" and "rabbit" are deliberately not terms: "rib of celery", "Welsh rabbit".
DAIRY = frozenset(
    {"dairy", "milk", "buttermilk", "cream", "butter", "ghee", "cheese", "yogurt", "yoghurt"}
)
NUTS = frozenset(
    {
        "nut", "peanut", "almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut",
        "macadamia",
    }
)

FORBIDDEN_FOODS: dict[str, frozenset[str]] = {
    "vegetarian": MEAT | SEAFOOD,
    "vegan": MEAT | SEAFOOD | DAIRY | {"egg", "honey"},
    "pescatarian": MEAT,
    "dairy-free": DAIRY,
    "nut-free": NUTS,
}

IRREGULAR_PLURALS: dict[str, str] = {"goose": "geese", "octopus": "octopi"}
# Literal terms `term_pattern` leaves unpluralised ("specks of pepper" isn't speck).
NO_PLURAL: frozenset[str] = frozenset({"speck"})


def _words(text: str) -> str:
    return r"[\s-]+".join(re.escape(w) for w in text.split())


def _plural_tail(word: str) -> str:
    """The regex for the last word of a term, plus its regular plural."""
    if len(word) > 1 and word.endswith("y") and word[-2] not in "aeiou":
        return re.escape(word[:-1]) + r"(?:y|ies)"
    if word.endswith(("s", "x", "z", "ch", "sh")):
        return re.escape(word) + r"(?:es)?"
    if word.endswith("o"):
        return re.escape(word) + r"(?:e?s)?"
    return re.escape(word) + r"s?"


def term_pattern(term: str) -> str:
    """Regex for `term` and its plural, built from the singular, `\\b`-wrapped.

    It never stems the input text, which is how "tomatoes" and "berries" match
    without a bad stem ("tomatoe", "berrie"). Only the last word of a multi-word
    term is pluralised ("sea bass" -> "sea basses"). Not `(?:e?s)?` everywhere:
    that makes "cod" match "codes" and "ham" match "hames".
    """
    words = term.split()
    head = "".join(re.escape(w) + r"[\s-]+" for w in words[:-1])
    last = words[-1]
    tail = re.escape(last) if term in NO_PLURAL else _plural_tail(last)
    body = head + tail
    irregular = IRREGULAR_PLURALS.get(term)
    if irregular is not None:
        body = rf"(?:{body}|{_words(irregular)})"
    return rf"\b{body}\b"


@lru_cache(maxsize=None)
def _compiled_term(term: str) -> "re.Pattern[str]":
    return re.compile(term_pattern(term))


# ---------------------------------------------------------------------------
# Guards (regex fragments)
# ---------------------------------------------------------------------------

# Moved verbatim from workflows/recipe/refine_diet.py (#681). regex fragments.
PLANT_COMPOUND_BASES = (
    "coconut", "oat", "almond", "soy", "cashew", "rice", "hemp", "pea",
    "plant[- ]based", "vegan", "dairy[- ]free", "non[- ]dairy",
)
PLANT_COMPOUND_NOUNS = (
    "milk", "cream", "butter", "cheese", "yogurt", "yoghurt", "mayo", "mayonnaise",
)
PLANT_MARKER_WORDS = (
    "vegan", "veggie", "vegetarian", "plant[- ]based", "meatless", "mock", "faux",
    "tofu", "tempeh", "seitan",
)

# Markers that make a dairy noun, egg or honey imitation. A vegetarian or meatless
# dish can still hold cheese, eggs or honey. regex fragments.
DAIRY_EGG_MARKERS = ("vegan", "plant[- ]based", "dairy[- ]free", "tofu", "tempeh", "seitan")

# Guard 3: a non-dairy base directly before a dairy noun. regex fragments.
MILK_BASES = (
    *PLANT_COMPOUND_BASES,
    "soya", "hazelnut", "macadamia", "flax", "walnut", "pistachio", "peanut", "nut", "seed",
    "sunflower", "sesame",
)
# Apply to `butter` only, so "pumpkin cream" and "apple cheese" still count as dairy.
BUTTER_ONLY_BASES = ("apple", "cocoa", "cacao", "shea", "pumpkin")
_DAIRY_NOUNS = frozenset({"milk", "cream", "butter", "cheese", "yogurt", "yoghurt", "buttermilk"})

# Guard 4: a vegetable imitation ("cauliflower steak"). The narrow term set is
# deliberate: "mushroom chicken" and "coconut shrimp" are real meat dishes.
IMITATED_TERMS = (
    "steak", "bacon", "chorizo", "sausage", "meatball", "meat", "pork", "tuna", "jerky",
    "brisket", "caviar",
)
# regex fragments.
IMITATION_BASES = (
    "cauliflower", "mushroom", "portobello", "eggplant", "aubergine", "cabbage", "celeriac",
    "beet", "beetroot", "squash", "jackfruit", "carrot", "coconut", "watermelon", "lentil",
    "bean", "chickpea",
)

# Guard 1(b): the closed set a coordinated `-free` list may hold. regex fragments.
FREE_LIST_ITEMS = (
    "meat", "dairy", "egg", "nut", r"tree[\s-]nut", "peanut", "gluten", "wheat", "soy",
    "lactose", "fish", "shellfish", "sugar",
)

# Guard 2: fixed false friends per term. regex fragments.
_FALSE_FRIENDS: dict[str, tuple[str, ...]] = {
    "butter": (r"butter[\s-]+beans?", r"butter[\s-]+lettuce"),
    "cream": (r"cream[\s-]+of[\s-]+tartar", r"cream[\s-]+soda"),
    "egg": (r"(?:flax|chia)[\s-]*eggs?", r"eggs?[\s-]+(?:replacer|substitute)s?"),
    "duck": (r"duck[\s-]+(?:eggs?|sauce)",),
    "quail": (r"quail[\s-]+eggs?",),
    "oyster": (r"oyster[\s-]+(?:mushrooms?|crackers?)",),
    "lobster": (r"lobster[\s-]+mushrooms?",),
    "beef": (r"beef[\s-]*(?:steak[\s-]+)?tomato(?:e?s)?",),
    "steak": (r"steak[\s-]+(?:cut[\s-]+)?fries", r"steak-cut[\s-]+fries"),
    "crab": (r"crab[\s-]?apples?",),
    "lamb": (r"lamb'?s?[\s-]+lettuce",),
    "chicken": (r"chicken[\s-]+of[\s-]+the[\s-]+woods",),
    "dairy": (r"non[\s-]?dairy",),
    "suet": (r"vegetable[\s-]+suet",),
    "speck": (r"speck[\s-]+of",),
}


def _alt(fragments: tuple[str, ...]) -> str:
    return "|".join(fragments)


_FALSE_FRIEND_RES = {
    term: re.compile(rf"(?<!\w)(?:{_alt(fragments)})(?!\w)")
    for term, fragments in _FALSE_FRIENDS.items()
}

_ITEM = rf"(?:{_alt(FREE_LIST_ITEMS)})s?-?"
_SEP = r"(?:\s*,\s*(?:(?:and|or|&)\s+)?|\s+(?:and|or|&)\s+|\s*/\s*)"
# A coordinating separator or a slash, never a bare comma: "fish, dairy free" isn't a list.
_LAST = r"(?:\s*,\s*(?:and|or|&)\s+|\s+(?:and|or|&)\s+|\s*/\s*)"
_FREE_DIRECT = re.compile(r"[\s-]?free\b")
_FREE_LIST = re.compile(rf"-?(?:{_SEP}{_ITEM})*{_LAST}{_ITEM}[\s-]?free\b")
_FREE_ITEM_TERM = re.compile(rf"(?:{_alt(FREE_LIST_ITEMS)})")

_MILK_BASE = re.compile(rf"(?<!\w)(?:{_alt(MILK_BASES)})[\s-]+$")
_BUTTER_BASE = re.compile(rf"(?<!\w)(?:{_alt((*MILK_BASES, *BUTTER_ONLY_BASES))})[\s-]+$")
_IMITATION = re.compile(rf"(?<!\w)(?:{_alt(IMITATION_BASES)})s?[\s-]+(?:pulled[\s-]+)?$")

_WINDOW_STOPS = r"(?:and|or|with|plus|n|but|then|also|except)"


def _marker_window(markers: tuple[str, ...]) -> "re.Pattern[str]":
    # A marker directly preceded by `non`/`non-`/`not ` doesn't count.
    return re.compile(
        r"(?<!non-)(?<!non\s)(?<!non)(?<!not\s)"
        rf"\b(?:{_alt(markers)})"
        rf"(?:[\s-]+(?!{_WINDOW_STOPS}\b)[\w']+){{0,2}}[\s-]+$"
    )


_FULL_WINDOW = _marker_window(PLANT_MARKER_WORDS)
_DAIRY_EGG_WINDOW = _marker_window(DAIRY_EGG_MARKERS)
_DAIRY_EGG_TERMS = DAIRY | {"egg", "honey"}


def _normalise(text: str) -> str:
    return text.lower().replace("’", "'")


def _rejected(term: str, text: str, match: "re.Match[str]", plant_markers: bool) -> bool:
    """True when this occurrence of `term` doesn't count as asking for the food."""
    after = text[match.end() :]
    before = text[: match.start()]

    # 1. `-free`: direct, or a coordinated list from the closed set.
    if _FREE_DIRECT.match(after):
        return True
    if _FREE_ITEM_TERM.fullmatch(term) and _FREE_LIST.match(after):
        return True

    # 2. Fixed false friends.
    friends = _FALSE_FRIEND_RES.get(term)
    if friends is not None and any(
        f.start() <= match.start() and match.end() <= f.end() for f in friends.finditer(text)
    ):
        return True

    # 3. A non-dairy base before a dairy noun.
    if term in _DAIRY_NOUNS and (_BUTTER_BASE if term == "butter" else _MILK_BASE).search(before):
        return True

    # 4. A vegetable imitation.
    if term in IMITATED_TERMS and _IMITATION.search(before):
        return True

    # 5. A plant marker window (animal terms only; a vegan almond cake has almonds).
    if plant_markers and term not in NUTS:
        window = _DAIRY_EGG_WINDOW if term in _DAIRY_EGG_TERMS else _FULL_WINDOW
        if window.search(before):
            return True

    return False


def _mentions(term: str, text: str, plant_markers: bool) -> bool:
    return any(
        not _rejected(term, text, m, plant_markers) for m in _compiled_term(term).finditer(text)
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def mentions(term: str, text: str, *, plant_markers: bool = True) -> bool:
    """True if `text` asks for `term` (or its plural) and no guard rejects every occurrence."""
    return _mentions(term.strip().lower(), _normalise(text), plant_markers)


def names_forbidden_food(label: str, text: str, *, plant_markers: bool = True) -> bool:
    """True if `text` names a food the diet `label` forbids.

    `text` is lowercased and `’` becomes `'` here, so callers may pass raw text.
    `label` goes through `norm_label`, so "Dairy Free" and "dairy_free" reach
    `dairy-free`. `plant_markers=False` skips guard 5 for callers whose text has
    already had plant-marker phrases stripped clause by clause (refine).
    """
    terms = FORBIDDEN_FOODS.get(norm_label(label), frozenset())
    haystack = _normalise(text)
    return any(_mentions(term, haystack, plant_markers) for term in terms)
