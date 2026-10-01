"""Meal option variety and honesty (issue #852): pure text rules, no state, no model calls.

Two deterministic checks sit around the option stage's single structured call, so the
quality bar does not cost a second "critic" call:

* **Blurb vs ingredients.** An option's blurb that names an ingredient none of its dishes
  contains ("crispy chicken with garlic and lemon" over dishes with no garlic) has that
  claim dropped rather than shipped. The ingredient list is each dish's `key_ingredients`
  plus the dish names (a dish called "Garlic Bread" supports a blurb that says garlic).
* **Dishes to avoid.** The user's recent saved/cooked titles are rendered into the prompt,
  and an option whose main repeats one of them is dropped in code (never all of them, and
  never when the user's own message names the dish).

What counts as "an ingredient named in the text" is a curated vocabulary of common
ingredients, extended with the user's own pantry names. It is deliberately specific: generic
words (cheese, meat, herbs, vegetables) are not claims, and salt, pepper and oil never are,
since the seasoning rule puts them in every dish.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from typing import Protocol, TypeVar

from bubbly_chef.prompts.meal import MEAL_OPTIONS_AVOID_BLOCK

# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------

# Universal: the seasoning rule has every dish use them, so naming one is never a false claim.
_UNIVERSAL = frozenset(
    {
        "salt", "sea salt", "kosher salt", "table salt", "pepper", "black pepper", "white pepper",
        "ground pepper", "oil", "olive oil", "cooking oil", "vegetable oil", "canola oil", "water",
    }
)

# Generic category words are never claims, however they get into the vocabulary (the
# curated list, or a pantry row literally named "Cheese"): "a creamy cheese sauce" over a
# mozzarella dish is true, and "fresh herbs" over a dish with basil is too.
_GENERIC = frozenset(
    {
        "cheese", "herb", "spice", "vegetable", "veg", "green", "meat", "fish", "seafood",
        "fruit", "nut", "bean", "legume", "grain", "poultry", "produce", "protein", "seasoning",
        "sauce", "dairy", "oil", "salt", "pepper", "water", "other", "item", "food",
    }
)

# Spelling and regional variants collapsed to one form, on both sides of a comparison.
_SYNONYMS: dict[str, str] = {
    "scallion": "green onion",
    "spring onion": "green onion",
    "cilantro": "coriander",
    "garbanzo": "chickpea",
    "courgette": "zucchini",
    "aubergine": "eggplant",
    "chilli": "chili",
    "chile": "chili",
    "prawn": "shrimp",
    "capsicum": "bell pepper",
    "sweet pepper": "bell pepper",
    "green pepper": "bell pepper",
    "red pepper": "bell pepper",
    "yellow pepper": "bell pepper",
    "orange pepper": "bell pepper",
    "red pepper flake": "chili flake",
    "crushed red pepper": "chili flake",
    "rocket": "arugula",
    "mince": "ground beef",
    "yoghurt": "yogurt",
}

_CURATED = """
chicken, beef, pork, lamb, turkey, duck, bacon, ham, sausage, chorizo, steak, salmon, tuna, cod,
shrimp, tofu, tempeh, egg, chickpea, lentil, black bean, kidney bean, white bean, pea,
garlic, onion, green onion, shallot, leek, ginger, lemon, lime, orange, chili, jalapeno,
tomato, potato, sweet potato, carrot, celery, broccoli, cauliflower, spinach, kale, cabbage,
mushroom, zucchini, eggplant, bell pepper, cucumber, corn, avocado, squash, pumpkin, beet,
asparagus, arugula, lettuce, apple, banana, pineapple, mango, coconut, olive, caper,
chili pepper, cayenne pepper, sesame oil, coconut oil, peanut oil,
basil, parsley, coriander, mint, thyme, rosemary, oregano, sage, dill, chive, bay leaf,
cumin, paprika, turmeric, cinnamon, nutmeg, cardamom, curry, cayenne, chili flake, harissa,
butter, cream, milk, yogurt, sour cream, parmesan, cheddar, mozzarella, feta, ricotta,
halloumi, goat cheese, cream cheese, honey, maple syrup, soy sauce, miso, vinegar, mustard,
mayonnaise, ketchup, sriracha, tahini, peanut butter, peanut, almond, cashew, walnut, pine nut,
sesame, rice, pasta, spaghetti, noodle, quinoa, couscous, bread, tortilla, flour, oat,
wine, stock, broth
"""


def _singular(word: str) -> str:
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith(("oes", "ches", "shes", "sses")) and len(word) > 4:
        return word[:-2]
    if word.endswith("s") and not word.endswith(("ss", "us")) and len(word) > 3:
        return word[:-1]
    return word


def _tokens(text: str) -> list[str]:
    """Lower-cased words, singularised, with multi-word synonyms collapsed."""
    words = [_singular(w) for w in re.findall(r"[a-z]+", text.lower())]
    out: list[str] = []
    i = 0
    while i < len(words):
        # longest synonym first ("red pepper flake" before "red pepper"), then single words
        for width in (3, 2):
            gram = " ".join(words[i : i + width])
            if len(words[i : i + width]) == width and gram in _SYNONYMS:
                out.extend(_SYNONYMS[gram].split())
                i += width
                break
        else:
            out.extend(_SYNONYMS.get(words[i], words[i]).split())
            i += 1
    return out


def _phrase(name: str) -> tuple[str, ...]:
    return tuple(_tokens(name))


_CURATED_PHRASES: frozenset[tuple[str, ...]] = frozenset(
    p for raw in _CURATED.split(",") if (p := _phrase(raw.strip()))
)
_UNIVERSAL_PHRASES: frozenset[tuple[str, ...]] = frozenset(_phrase(n) for n in _UNIVERSAL)


def _is_generic(phrase: tuple[str, ...]) -> bool:
    return all(word in _GENERIC for word in phrase)


def _contains(haystack: Sequence[str], needle: Sequence[str]) -> bool:
    n = len(needle)
    return n > 0 and any(
        tuple(haystack[i : i + n]) == tuple(needle) for i in range(len(haystack) - n + 1)
    )


def _overlap(a: Sequence[str], b: Sequence[str]) -> bool:
    """Same ingredient, loosely: one is a whole-word part of the other."""
    return _contains(a, b) or _contains(b, a)


# ---------------------------------------------------------------------------
# Blurb vs ingredients
# ---------------------------------------------------------------------------


def claimed_ingredients(text: str, extra_names: Iterable[str] = ()) -> list[str]:
    """Ingredients `text` names, in order of appearance, de-duplicated ("tomatoes" is
    "tomato"; "scallions" is "green onion"). `extra_names` (the user's pantry) extend the
    curated vocabulary. Salt, pepper and oil are never claims."""
    claimable = {
        p for p in (*_CURATED_PHRASES, *(_phrase(n) for n in extra_names)) if p and not _is_generic(p)
    } - _UNIVERSAL_PHRASES
    words = _tokens(text)
    taken = [False] * len(words)
    found: list[tuple[int, tuple[str, ...]]] = []
    # One longest-first pass over claimable phrases AND the universal ones, so "sweet
    # potato" is one claim and not "potato", "bell pepper" is a claim and not a "pepper",
    # and "olive oil" is consumed whole instead of leaving an "olive". A universal match
    # takes its words but is not reported.
    for phrase in sorted(claimable | _UNIVERSAL_PHRASES, key=lambda p: (-len(p), p)):
        n = len(phrase)
        for i in range(len(words) - n + 1):
            if tuple(words[i : i + n]) == phrase and not any(taken[i : i + n]):
                taken[i : i + n] = [True] * n
                if phrase in claimable:
                    found.append((i, phrase))
    found.sort()
    names: list[str] = []
    for _, phrase in found:
        name = " ".join(phrase)
        if name not in names:
            names.append(name)
    return names


def unsupported_claims(
    text: str, supported: Iterable[str], extra_names: Iterable[str] = ()
) -> list[str]:
    """The ingredients `text` names that none of `supported` (ingredient or dish names)
    contains."""
    support = [_phrase(s) for s in supported]
    return [
        claim
        for claim in claimed_ingredients(text, extra_names)
        if not any(_overlap(claim.split(), s) for s in support)
    ]


_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
# Where a clause can be cut: a connector word, a comma, a dash or a semicolon.
_CLAUSE_BREAK_RE = re.compile(
    r"\s+(?:with|and|plus|topped\s+with|finished\s+with|served\s+with|alongside|featuring"
    r"|over|on|in|layered\s+with|tossed\s+(?:in|with))\s+|\s*[,;]\s*|\s+[-–—]+\s+",
    re.IGNORECASE,
)
_MIN_HEAD_WORDS = 2


def _trim_to_supported(
    sentence: str, supported: Sequence[str], extra_names: Sequence[str]
) -> str | None:
    """`sentence` cut back to its longest leading part that makes no unsupported claim, or
    None when even the shortest sensible part still does."""
    ending = sentence[-1] if sentence and sentence[-1] in ".!?" else ""
    body = sentence.rstrip(".!? ")
    for match in reversed(list(_CLAUSE_BREAK_RE.finditer(body))):
        head = body[: match.start()].strip(" ,;-–—")
        if len(head.split()) >= _MIN_HEAD_WORDS and not unsupported_claims(
            head, supported, extra_names
        ):
            return head + (ending or ".")
    return None


def strip_unsupported_claims(
    blurb: str | None, supported: Iterable[str], extra_names: Iterable[str] = ()
) -> str | None:
    """`blurb` with every claim of an ingredient no dish contains removed.

    A sentence that makes one is cut back to the part before it ("Crispy chicken thighs
    with garlic and lemon." becomes "Crispy chicken thighs."), or dropped when nothing
    sensible is left. All sentences gone gives None: no blurb beats a false one. A blurb
    that makes no unsupported claim is returned untouched.
    """
    if not blurb or not blurb.strip():
        return blurb
    support = list(supported)
    extra = list(extra_names)
    if not unsupported_claims(blurb, support, extra):
        return blurb
    kept: list[str] = []
    for sentence in _SENTENCE_SPLIT_RE.split(blurb.strip()):
        if not unsupported_claims(sentence, support, extra):
            kept.append(sentence)
        elif (trimmed := _trim_to_supported(sentence, support, extra)) is not None:
            kept.append(trimmed)
    return " ".join(kept) or None


# ---------------------------------------------------------------------------
# Dishes to avoid
# ---------------------------------------------------------------------------

_MAX_AVOID_TITLE_CHARS = 80


def _clean_title(title: str) -> str:
    cleaned = " ".join(title.replace('"', "'").split())
    return cleaned[:_MAX_AVOID_TITLE_CHARS].strip()


def avoid_titles_block(titles: Iterable[str]) -> str:
    """The prompt block naming dishes to avoid repeating, or "" for no usable titles.
    Titles are user text: collapsed to one line, quotes neutralised, length-capped."""
    cleaned = [c for t in titles if (c := _clean_title(t))]
    if not cleaned:
        return ""
    return MEAL_OPTIONS_AVOID_BLOCK.format(titles="; ".join(cleaned))


_TITLE_FILLER = frozenset({"a", "an", "the", "with", "and", "of", "in", "on", "style"})


def _title_words(text: str) -> frozenset[str]:
    return frozenset(w for w in _tokens(text) if w not in _TITLE_FILLER)


def _repeats(name: str, avoided: frozenset[str]) -> bool:
    """Same dish, or a variant that adds words to it ("Spicy Tomato Chickpea Stew" over
    "Tomato Chickpea Stew"). A one-word title only matches itself exactly, so "Salad" or
    "Soup" does not bar every dish that shares the word."""
    words = _title_words(name)
    if not words or not avoided:
        return False
    if words == avoided:
        return True
    smaller, larger = (words, avoided) if len(words) <= len(avoided) else (avoided, words)
    return len(smaller) >= 2 and smaller <= larger


class _DishLike(Protocol):
    @property
    def role(self) -> str: ...

    @property
    def name(self) -> str: ...


class _OptionLike(Protocol):
    """A `MealOption` or the option stage's raw `MealOptionLLM`."""

    @property
    def title(self) -> str: ...

    @property
    def dishes(self) -> Sequence[_DishLike]: ...


_O = TypeVar("_O", bound=_OptionLike)


def drop_repeated_options(options: Sequence[_O], avoid: Sequence[str], input_text: str) -> list[_O]:
    """`options` without those whose main dish (or title) repeats an avoided title.

    The user's own message wins: an avoided title whose every word is in `input_text` is
    not avoided this turn. When every option would be dropped, none is: a repeat beats an
    empty answer.
    """
    request_words = frozenset(_tokens(input_text))
    avoided = [
        w
        for title in avoid
        if (w := _title_words(title)) and not w <= request_words
    ]
    if not avoided:
        return list(options)

    def _is_repeat(option: _O) -> bool:
        names = [option.title] + [d.name for d in option.dishes if d.role == "main"]
        return any(_repeats(n, a) for n in names for a in avoided)

    kept = [o for o in options if not _is_repeat(o)]
    return kept or list(options)
