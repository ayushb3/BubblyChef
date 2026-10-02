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

* **Same protein, same cuisine (issue #877).** Two options whose mains share a main protein
  (a small keyword table over the main dish's ingredients) and a cuisine are the same option
  twice, and no protein takes a third option. The first are kept and ONE bounded replacement
  call asks for the rest; whatever can't be replaced ships as it is, so the set never drops
  below what the model gave us.

What counts as "an ingredient named in the text" is a curated vocabulary of common
ingredients, extended with the user's own pantry names. It is deliberately specific: generic
words (cheese, meat, herbs, vegetables) are not claims, and salt, pepper and oil never are,
since the seasoning rule puts them in every dish.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Generic, Protocol, TypeVar

from bubbly_chef.prompts.meal import MEAL_OPTIONS_AVOID_BLOCK, MEAL_OPTIONS_REPLACE_BLOCK

logger = logging.getLogger(__name__)

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


def _avoided_words(avoid: Sequence[str], input_text: str) -> list[frozenset[str]]:
    """The avoided titles (as word sets) this turn still bars: the user's own message wins,
    so a title whose every word is in `input_text` is not avoided."""
    request_words = frozenset(_tokens(input_text))
    return [w for title in avoid if (w := _title_words(title)) and not w <= request_words]


def _repeats_any(option: _OptionLike, avoided: Sequence[frozenset[str]]) -> bool:
    names = [option.title] + [d.name for d in option.dishes if d.role == "main"]
    return any(_repeats(n, a) for n in names for a in avoided)


def repeats_avoided_title(option: _OptionLike, avoid: Sequence[str], input_text: str) -> bool:
    """True when `option`'s main (or title) repeats a title the user should not see again."""
    return _repeats_any(option, _avoided_words(avoid, input_text))


def drop_repeated_options(options: Sequence[_O], avoid: Sequence[str], input_text: str) -> list[_O]:
    """`options` without those whose main dish (or title) repeats an avoided title.

    The user's own message wins: an avoided title whose every word is in `input_text` is
    not avoided this turn. When every option would be dropped, none is: a repeat beats an
    empty answer.
    """
    avoided = _avoided_words(avoid, input_text)
    if not avoided:
        return list(options)
    kept = [o for o in options if not _repeats_any(o, avoided)]
    return kept or list(options)


# ---------------------------------------------------------------------------
# Same main protein and cuisine (issue #877)
# ---------------------------------------------------------------------------

# Main protein, read from the main dish's ingredients. Deliberately small: the settled
# categories plus lamb and turkey/duck, so two lamb dishes are not mistaken for "no protein".
# Words are singular (`_tokens` singularises both sides).
_PROTEIN_WORDS: dict[str, frozenset[str]] = {
    "chicken": frozenset({"chicken"}),
    "beef": frozenset({"beef", "steak", "brisket", "sirloin", "ribeye", "veal"}),
    "pork": frozenset({"pork", "bacon", "ham", "sausage", "chorizo", "prosciutto", "pancetta"}),
    "lamb": frozenset({"lamb", "mutton"}),
    "turkey": frozenset({"turkey", "duck"}),
    "fish": frozenset(
        {
            "fish", "salmon", "tuna", "cod", "tilapia", "halibut", "trout", "haddock", "sardine",
            "anchovy", "snapper", "shrimp", "crab", "lobster", "scallop", "mussel", "clam",
            "squid", "seafood",
        }
    ),
    "tofu": frozenset({"tofu", "tempeh", "seitan"}),
    "beans": frozenset({"bean", "chickpea", "lentil", "dal", "dhal"}),
    "eggs": frozenset({"egg"}),
}
_WORD_TO_PROTEIN: dict[str, str] = {
    w: protein for protein, words in _PROTEIN_WORDS.items() for w in words
}
NO_PROTEIN = "none"
PROTEIN_LABELS: dict[str, str] = {
    "chicken": "chicken",
    "beef": "beef",
    "pork": "pork",
    "lamb": "lamb",
    "turkey": "turkey or duck",
    "fish": "fish or seafood",
    "tofu": "tofu or tempeh",
    "beans": "beans or lentils",
    "eggs": "eggs",
}

# A protein word that is not the protein: "chicken stock", "fish sauce", "bean sprouts",
# "egg noodles", "green beans" (eggplant is its own word and never matches).
_NOT_PROTEIN_NEXT = frozenset({"stock", "broth", "bouillon", "sauce", "sprout"})
_NOT_EGG_NEXT = frozenset({"noodle", "pasta", "roll"})
_NOT_BEAN_PREV = frozenset({"green", "string", "vanilla", "coffee", "cocoa", "jelly"})


def _proteins_in(text: str) -> list[str]:
    """The protein categories `text` names, in order of appearance."""
    words = _tokens(text)
    found: list[str] = []
    for i, word in enumerate(words):
        protein = _WORD_TO_PROTEIN.get(word)
        if protein is None:
            continue
        nxt = words[i + 1] if i + 1 < len(words) else ""
        prev = words[i - 1] if i > 0 else ""
        if nxt in _NOT_PROTEIN_NEXT:
            continue
        if protein == "eggs" and nxt in _NOT_EGG_NEXT:
            continue
        if protein == "beans" and prev in _NOT_BEAN_PREV:
            continue
        if protein not in found:
            found.append(protein)
    return found


def main_protein(dish_name: str, key_ingredients: Iterable[str]) -> str:
    """The protein category of a main dish: the first one its ingredients name, else the
    one its name does, else "none". Ingredient order is the model's, so the first listed
    protein is taken as the main one."""
    for ingredient in key_ingredients:
        if proteins := _proteins_in(ingredient):
            return proteins[0]
    if proteins := _proteins_in(dish_name):
        return proteins[0]
    return NO_PROTEIN


_CUISINE_FILLER = frozenset({"style", "cuisine", "food", "inspired", "and", "the"})


def _cuisine_words(cuisine: str | None) -> tuple[str, ...]:
    return tuple(w for w in _tokens(cuisine or "") if w not in _CUISINE_FILLER)


class _KeyedDish(Protocol):
    @property
    def role(self) -> str: ...

    @property
    def name(self) -> str: ...

    @property
    def key_ingredients(self) -> Sequence[str]: ...


class _KeyedOption(Protocol):
    """The raw `MealOptionLLM` the option stage gets back."""

    @property
    def title(self) -> str: ...

    @property
    def cuisine(self) -> str | None: ...

    @property
    def dishes(self) -> Sequence[_KeyedDish]: ...


_K = TypeVar("_K", bound=_KeyedOption)


def _main_dish(option: _KeyedOption) -> _KeyedDish | None:
    return next((d for d in option.dishes if d.role == "main"), None)


def option_key(option: _KeyedOption) -> tuple[str, str]:
    """(main protein, normalised cuisine) of an option; the cuisine is "" when unstated."""
    main = _main_dish(option)
    protein = main_protein(main.name, main.key_ingredients) if main else NO_PROTEIN
    return protein, " ".join(_cuisine_words(option.cuisine))


def _same_cuisine(a: str, b: str) -> bool:
    """Equal, or one a whole-word part of the other ("Italian" and "Italian American"). Two
    unstated cuisines match: with nothing to tell them apart, the protein decides."""
    wa, wb = set(a.split()), set(b.split())
    if not wa and not wb:
        return True
    return bool(wa) and bool(wb) and (wa <= wb or wb <= wa)


def _same_key(a: tuple[str, str], b: tuple[str, str]) -> bool:
    # A meatless main is never "the same protein twice": the failure this guards is three
    # chicken dinners, not two vegetable ones.
    return a[0] != NO_PROTEIN and a[0] == b[0] and _same_cuisine(a[1], b[1])


# The cuisine is the model's own free-text label and it is generous with them: live, three
# chicken mains came back as "American", "Asian-Inspired" and "Rustic" (#877). So the pair
# rule alone would let three of one protein through; no protein takes a third option.
_MAX_PER_PROTEIN = 2


def _clashes(key: tuple[str, str], settled: Sequence[tuple[str, str]]) -> bool:
    """Whether `key` repeats an option already settled: the same protein and cuisine, or a
    third option on a protein two settled ones already use."""
    if key[0] == NO_PROTEIN:
        return False
    if any(_same_key(key, seen) for seen in settled):
        return True
    return sum(seen[0] == key[0] for seen in settled) >= _MAX_PER_PROTEIN


@dataclass(frozen=True)
class VarietyOutcome(Generic[_K]):
    """`options` after the replace-once step, and the protein any option still shares
    with an earlier one (None when the set is varied)."""

    options: list[_K]
    shared_protein: str | None


def shared_protein_note(protein: str) -> str:
    """The honest line for a set that still leans on one protein."""
    label = PROTEIN_LABELS.get(protein, protein)
    return (
        f" Heads up: more than one of these is built around {label}. "
        "Ask for something different and I'll switch it up."
    )


def _describe(option: _KeyedOption) -> str:
    protein, cuisine = option_key(option)
    main = _main_dish(option)
    main_name = _clean_title(main.name) if main else "?"
    return (
        f'"{_clean_title(option.title)}" (main: {main_name}; '
        f"{PROTEIN_LABELS.get(protein, 'no set protein')}; {cuisine or 'cuisine unstated'})"
    )


def exempt_proteins(
    wanted_ingredients: Iterable[str], excluded_ingredients: Iterable[str] = ()
) -> frozenset[str]:
    """The proteins the user asked for ("use up my chicken"), which are not policed.

    Built from the turn's structured constraints (must-use and preferred ingredients), never
    from the raw message: "no chicken tonight" names chicken in order to refuse it. A protein
    the user excluded never exempts anything, even when it is also listed as wanted.
    """
    wanted = {p for text in wanted_ingredients for p in _proteins_in(text)}
    refused = {p for text in excluded_ingredients for p in _proteins_in(text)}
    return frozenset(wanted - refused)


def _exempt_key(option: _KeyedOption, exempt: frozenset[str]) -> tuple[str, str]:
    protein, cuisine = option_key(option)
    return (NO_PROTEIN if protein in exempt else protein), cuisine


def shared_protein_among(options: Sequence[_K], exempt: frozenset[str] = frozenset()) -> str | None:
    """The protein an option repeats from an earlier one in `options`, or None when the set
    is varied. Judged on the set as given, so callers pass what will actually ship."""
    keys: list[tuple[str, str]] = []
    for option in options:
        key = _exempt_key(option, exempt)
        if _clashes(key, keys):
            return key[0]
        keys.append(key)
    return None


async def replace_duplicate_options(
    options: Sequence[_K],
    *,
    wanted_ingredients: Iterable[str] = (),
    excluded_ingredients: Iterable[str] = (),
    propose: Callable[[str], Awaitable[Sequence[_K]]],
    accept: Callable[[_K], bool],
) -> VarietyOutcome[_K]:
    """Keep the first of every (main protein, cuisine) pair, and the first two on any one
    protein, and replace the repeats with ONE bounded `propose(extra)` call (`extra` is
    appended to the option prompt).

    `accept` vets a replacement for what the model is not trusted with (allergens, an
    avoided title). A replacement that is rejected, still a duplicate or never arrives
    leaves the original option in place and is reported in `shared_protein`: never a
    second call, never fewer options. A protein the user asked for is not policed (see
    `exempt_proteins`).
    """
    exempt = exempt_proteins(wanted_ingredients, excluded_ingredients)

    def _key(option: _K) -> tuple[str, str]:
        return _exempt_key(option, exempt)

    keys: list[tuple[str, str]] = []
    duplicates: list[int] = []
    for idx, option in enumerate(options):
        key = _key(option)
        if _clashes(key, keys):
            duplicates.append(idx)
        else:
            keys.append(key)
    result = list(options)
    if not duplicates:
        return VarietyOutcome(result, None)

    settled = [_describe(o) for i, o in enumerate(options) if i not in duplicates]
    avoid_proteins = list(
        dict.fromkeys(PROTEIN_LABELS.get(_key(options[i])[0], "") for i in duplicates)
    )
    extra = MEAL_OPTIONS_REPLACE_BLOCK.format(
        kept="; ".join(settled),
        count=len(duplicates),
        avoid=" or ".join(p for p in avoid_proteins if p) or "the settled mains",
    )
    try:
        replacements = list(await propose(extra))
    except Exception as e:  # a failed replacement must never fail the stage
        logger.warning("meal variety: replacement call failed (%s); keeping the repeats", e)
        replacements = []

    still_shared: str | None = None
    for idx in duplicates:
        for candidate in list(replacements):
            key = _key(candidate)
            if accept(candidate) and not _clashes(key, keys):
                result[idx] = candidate
                keys.append(key)
                replacements.remove(candidate)
                break
        else:
            still_shared = still_shared or _key(options[idx])[0]
    return VarietyOutcome(result, still_shared)


# ---------------------------------------------------------------------------
# Dishes to avoid: the recipe-generate path (issue #878)
# ---------------------------------------------------------------------------


def avoidable_titles(titles: Iterable[str], input_text: str) -> list[str]:
    """`titles` minus those the user's own message names, in order.

    The same "the request wins" rule `drop_repeated_options` applies after the fact, applied
    before the prompt is built: a title whose every word is in `input_text` ("make my tomato
    chickpea stew again") is not listed as a dish to avoid. A title the message only partly
    names ("a warming stew") stays listed.
    """
    request_words = frozenset(_tokens(input_text))
    return [t for t in titles if not (w := _title_words(t)) or not w <= request_words]
