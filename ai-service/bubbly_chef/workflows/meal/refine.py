"""Refining a meal in chat (issue #846): recognising the ask, and merging its constraints.

After the options (or a picked meal) are on screen, a typed follow-up like "no, something
quicker, I don't have butter" is a change to that meal, not a fresh question. The router
sends it to the meal option stage with `meal_refinement` set; this module holds the pure
text rules that decide it and the merge rules that apply it. No state, no model calls.

The recogniser is deliberately a small allow-list: a phrase it misses still reaches the
classifier, and a recipe edit read from the classifier is sent to the meal path too (the
meal on screen has no pinned recipe for an edit to land on). A question about the meal
("how spicy is it?", "what can I use instead of butter?") is never taken here.
"""

from __future__ import annotations

import re
from typing import Any

# Not a refinement, whatever else the message says: a question about the meal, or a
# substitution question, both of which the classifier answers (cooking help).
_QUESTION_LEAD_RE = re.compile(
    r"^\s*(?:how|what|why|when|where|which|who|whose|is(?!\s+there)|are(?!\s+there)|"
    r"was|were|does|did|will|would)\b",
    re.IGNORECASE,
)
_SUBSTITUTION_RE = re.compile(
    r"\b(?:substitut\w*|replac\w*|swap\w*|instead\s+of)\b", re.IGNORECASE
)

# "no X" / "without X" is an exclusion unless X is one of these (no thanks, no problem...).
_NO_NOT_AN_INGREDIENT = (
    r"thanks?|thank|problem|worries|need|idea|way|rush|big|that|that's|this|it|its|i|i'm|im|"
    r"we|you|more|thing|one|sure|wait"
)

_REFINE_RE = re.compile(
    r"\b(?:"
    # Comparatives: a different amount of the same meal.
    r"quicker|faster|simpler|easier|lighter|healthier|spicier|milder|cheaper|heartier|fewer"
    r"|less\s+(?:work|effort|time|prep|washing|spicy|salty|heavy|rich|carbs?|fat|oil|sugar"
    r"|dishes|cleanup|cooking)"
    r"|more\s+(?:protein|veg\w*|filling|hearty|substantial|flavou?r\w*|spice|spicy|greens)"
    r"|something\s+(?:quick|fast|easy|light|simple|cheap|different|else|new|healthy|spicy"
    r"|mild|fresh)"
    r"|(?:another|other|different)\s+(?:options?|meals?|ideas?|dinners?|dishes?|sides?)"
    r"|try\s+again"
    # A diet.
    r"|vegetarian|vegan|pescatarian|dairy[- ]free|gluten[- ]free|nut[- ]free|low[- ]carb|keto"
    r"|halal|kosher"
    # How many dishes.
    r"|(?:only|just)\s+(?:one|two|a|1|2)\s+(?:dish|dishes|side|sides|main)"
    r"|just\s+the\s+main"
    # Something the user lacks or doesn't want.
    r"|without\s+\w+"
    r"|(?:don'?t|do\s+not)\s+(?:have|use|want|like|eat)"
    r"|(?:ran|run|running|out|low)\s+(?:out\s+)?of"
    r"|actually,?\s+(?:use|add|include|put|(?:i|we)\s+(?:do\s+)?have|\w+\s+(?:is|are)\s+(?:fine|ok|okay))"
    rf"|no\s+(?!(?:{_NO_NOT_AN_INGREDIENT})\b)[a-z]"
    r")",
    re.IGNORECASE,
)


# A request for some other dish or its recipe, not a change to the meal on screen:
# "a recipe for banana pancakes", "show me the full recipe for the stew", "give me a
# vegetarian recipe", "make me a pancake batch".
_NEW_DISH_RE = re.compile(
    r"\brecipes?\s+(?:for|of|to)\b"
    r"|\b(?:full|whole|complete|entire)\s+recipe\b"
    r"|\b(?:give|show|get|find|send|tell)\s+me\s+(?:\w+\s+){0,4}?recipes?\b"
    r"|\b(?:make|cook|bake|prepare|fix)\s+(?:me\s+|us\s+)?(?:a|an|some)\s+"
    r"(?!(?:bit|little|lot|different|quicker|faster|simpler|easier|lighter|healthier|spicier"
    r"|milder|cheaper)\b)",
    re.IGNORECASE,
)


def is_about_the_meal(text: str) -> bool:
    """False for a question, a substitution question, or a request for another dish or
    recipe: whatever else it says, it is not a change to the meal on screen. The guards
    both entry points (the phrase list and the recipe-edit safety net) share."""
    return not (
        _QUESTION_LEAD_RE.search(text)
        or _SUBSTITUTION_RE.search(text)
        or _NEW_DISH_RE.search(text)
    )


def is_meal_refinement_phrase(text: str) -> bool:
    """True when `text` reads as a change to the meal on screen ("something quicker",
    "no butter", "make it vegetarian", "fewer dishes"). Only meaningful with a meal on
    screen; the router checks that."""
    return is_about_the_meal(text) and _REFINE_RE.search(text) is not None


# ---------------------------------------------------------------------------
# What the user doesn't have / doesn't want
# ---------------------------------------------------------------------------

_ABSENT_RE = re.compile(
    r"\b(?:(?:don'?t|do\s+not|dont)\s+have|(?:ran|run|running)\s+out\s+of|out\s+of|no|without"
    r"|skip|hold\s+the)\s+"
    r"(?P<names>[a-z][a-z' -]{0,60}?)"
    r"(?=\s*(?:[,.;:!?]|\b(?:but|so|please|though|since|because|then|for|tonight|today)\b|$))",
    re.IGNORECASE,
)
_NAME_LEAD_RE = re.compile(
    r"^(?:no|without|any|the|a|an|some|my|more|of|enough|any\s+more)\s+", re.IGNORECASE
)
# Time, quantity and filler words: a part holding one of these ("much time", "a lot of
# time", "enough") is not an ingredient.
_NOT_FOOD_WORDS = frozenset(
    {
        "much", "many", "time", "long", "lot", "lots", "enough", "anything", "everything",
        "nothing", "spare", "extra", "space", "room", "patience", "energy", "hurry", "minute",
        "minutes", "hour", "hours", "money", "budget", "clue", "idea",
    }
)
_MAX_NAME_WORDS = 3
_NAME_SPLIT_RE = re.compile(r"\s*(?:,|\band\b|\bor\b|&|/)\s*", re.IGNORECASE)
_NOT_AN_INGREDIENT = frozenset(
    {
        "side", "sides", "dish", "dishes", "side dish", "side dishes", "extras", "fuss", "mess",
        "time", "thanks", "thank", "problem", "worries", "need", "idea", "one", "it", "that",
        "this", "more", "less", "rush", "way", "big", "thing", "things", "sure", "wait",
        "main", "mains", "i", "we", "you",
    }
)


def absent_ingredients(text: str) -> list[str]:
    """Ingredients the message says the user lacks or wants out: "I don't have butter",
    "I'm out of eggs", "no mushrooms", "without cream". Lower-cased, de-duplicated, in
    the order given. A deterministic backstop to the constraint extraction, which does
    not reliably read "I don't have X" as an exclusion."""
    found: list[str] = []
    for match in _ABSENT_RE.finditer(text):
        raw = match.group("names").strip().lower()
        raw = _NAME_LEAD_RE.sub("", raw)
        for part in _NAME_SPLIT_RE.split(raw):
            name = part.strip()
            while (stripped := _NAME_LEAD_RE.sub("", name)) != name:
                name = stripped
            name = re.sub(r"\s+(?:please|thanks|anymore|left|now)$", "", name).strip(" -'")
            words = name.split()
            if (
                name
                and name not in _NOT_AN_INGREDIENT
                and len(words) <= _MAX_NAME_WORDS
                and not _NOT_FOOD_WORDS.intersection(words)
                and name not in found
            ):
                found.append(name)
    return found


_REINSTATE_LEAD = (
    r"(?:use|using|add|adding|include|including|put\s+in|bring\s+back|keep|with|"
    r"(?<!n't\s)(?<!not\s)(?<!no\s)have|got|bought)"
)


def reinstated_ingredients(text: str, saved_excluded: list[str], turn_excluded: list[str]) -> list[str]:
    """Saved exclusions this message takes back: "actually, use butter", "with butter is
    fine", "I do have butter". An ingredient the same message also rules out stays out."""
    back: list[str] = []
    for name in saved_excluded:
        if any(names_overlap(name, other) for other in turn_excluded):
            continue
        words = r"\s+".join(re.escape(w) for w in name.lower().split())
        pattern = (
            rf"\b{_REINSTATE_LEAD}\s+(?:(?:the|some|any|more)\s+)?{words}s?\b"
            rf"|\b{words}s?\s+(?:is|are)\s+(?:fine|ok|okay|good|back)\b"
        )
        if re.search(pattern, text, re.IGNORECASE):
            back.append(name)
    return back


# ---------------------------------------------------------------------------
# Merging this turn's change into the saved constraints
# ---------------------------------------------------------------------------

_QUICKER_RE = re.compile(
    r"\b(?:quick(?:er)?|fast(?:er)?|in\s+a\s+hurry|less\s+time|short(?:er)?\s+time)\b",
    re.IGNORECASE,
)
QUICK_CAP_MINUTES = 30
QUICK_FLOOR_MINUTES = 15
QUICK_STEP_MINUTES = 10


def asks_for_quicker(text: str) -> bool:
    return _QUICKER_RE.search(text) is not None


def _quicker_limit(saved_minutes: Any) -> int:
    """A tighter time limit than the one the meal was built under: half an hour when it
    had none (or a longer one), else ten minutes less, never below a quarter hour."""
    if isinstance(saved_minutes, int) and 0 < saved_minutes <= QUICK_CAP_MINUTES:
        return max(QUICK_FLOOR_MINUTES, saved_minutes - QUICK_STEP_MINUTES)
    return QUICK_CAP_MINUTES


def _singular(word: str) -> str:
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith("oes") and len(word) > 4:
        return word[:-2]
    if word.endswith("s") and not word.endswith("ss") and len(word) > 3:
        return word[:-1]
    return word


def _name_words(name: str) -> list[str]:
    return [_singular(w) for w in re.findall(r"[a-z]+", name.lower())]


def names_overlap(a: str, b: str) -> bool:
    """Same ingredient, loosely: equal, or one a whole-word part of the other
    ("butter" / "unsalted butter"; "tomatoes" / "tomato")."""
    wa, wb = _name_words(a), _name_words(b)
    if not wa or not wb:
        return False
    if wa == wb:
        return True
    short, long_ = (wa, wb) if len(wa) <= len(wb) else (wb, wa)
    n = len(short)
    return any(long_[i : i + n] == short for i in range(len(long_) - n + 1))


def _union(first: list[str], second: list[str]) -> list[str]:
    merged = list(first)
    for name in second:
        if not any(names_overlap(name, existing) for existing in merged):
            merged.append(name)
    return merged


def _without(names: list[str], removed: list[str]) -> list[str]:
    return [n for n in names if not any(names_overlap(n, r) for r in removed)]


def merge_refinement_constraints(
    retained: dict[str, Any], merged: dict[str, Any], input_text: str
) -> tuple[dict[str, Any], list[str]]:
    """What this turn changes in the saved constraints, plus the ingredients it names as
    unavailable or unwanted.

    `retained` is what the meal was built under; `merged` is the extraction's own
    inherit-and-override result, so a list in `merged` that differs from `retained` is what
    this turn asked for (its `excluded_ingredients` is this turn's alone: the caller
    blanks the saved ones before extracting). Returns only the keys this rule owns
    (`excluded_ingredients`, `must_use_ingredients`, `preferred_ingredients`, and
    `max_time_minutes` when it moved) for the caller to lay over the merged constraints.

    - New exclusions are added to the saved ones; an exclusion this turn contradicts
      ("actually, use butter": butter is now wanted) is replaced, and a saved want the
      turn rules out ("no butter") is dropped.
    - "Quicker" with no time given tightens the saved limit; an explicit time wins.
    """
    turn_excluded = _union(
        list(merged.get("excluded_ingredients") or []), absent_ingredients(input_text)
    )

    wants_before = [
        *(retained.get("must_use_ingredients") or []),
        *(retained.get("preferred_ingredients") or []),
    ]
    wants_now = [
        *(merged.get("must_use_ingredients") or []),
        *(merged.get("preferred_ingredients") or []),
    ]
    new_wants = [w for w in wants_now if not any(names_overlap(w, old) for old in wants_before)]
    # "actually, use butter" brings a saved exclusion back even if the extraction missed it.
    new_wants += reinstated_ingredients(
        input_text, list(retained.get("excluded_ingredients") or []), turn_excluded
    )
    # A turn that both wants and excludes the same food has asked for it: the want stands.
    turn_excluded = _without(turn_excluded, new_wants)

    updates: dict[str, Any] = {
        "excluded_ingredients": _without(
            _union(list(retained.get("excluded_ingredients") or []), turn_excluded), new_wants
        ),
        "must_use_ingredients": _without(list(merged.get("must_use_ingredients") or []), turn_excluded),
        "preferred_ingredients": _without(
            list(merged.get("preferred_ingredients") or []), turn_excluded
        ),
    }
    if asks_for_quicker(input_text) and merged.get("max_time_minutes") == retained.get(
        "max_time_minutes"
    ):
        updates["max_time_minutes"] = _quicker_limit(retained.get("max_time_minutes"))

    return updates, turn_excluded
