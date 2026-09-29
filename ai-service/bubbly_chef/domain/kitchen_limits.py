"""Map user-stated kitchen limits to exclusive-resource tags (issue #650).

A kitchen limit is a short phrase the user stated about shared equipment
("one pan", "only one pot", "no oven") -- extracted onto
``RecipeConstraints.kitchen_limits`` by the existing constraint-extraction
LLM call, never invented here. This module is the deterministic, LLM-free
step that turns those phrases into short tags (``pan``, ``pot``, ``oven``,
...) the meal scheduler treats as exclusive resources: two steps sharing a
tag never overlap. Deliberately NOT an equipment model -- only what the user
actually said.
"""

from __future__ import annotations

import re

# Quantity/negation words that carry no equipment identity on their own --
# stripped before matching so "one pan", "only one pan", and "no oven" all
# resolve on their equipment noun.
_QUANTIFIERS: frozenset[str] = frozenset(
    {"one", "only", "just", "a", "an", "the", "single", "no", "not"}
)

# Canonical tag per equipment phrase. Keys are space-joined, lowercased,
# quantifier-stripped phrases (or a single word within one) -- matched by
# exact phrase first, then by substring containment, so "one large pan" and
# "one non-stick skillet" both still resolve. Keep this small and additive:
# an unmatched phrase still gets a tag (see `_fallback_tag`), so nothing is
# ever silently dropped -- it just won't share a tag with a differently
# worded mention of the same equipment.
_TAG_ALIASES: dict[str, str] = {
    "pan": "pan",
    "skillet": "pan",
    "frying pan": "pan",
    "saute pan": "pan",
    "sauté pan": "pan",
    "wok": "pan",
    "pot": "pot",
    "saucepan": "pot",
    "stockpot": "pot",
    "dutch oven": "pot",
    "oven": "oven",
    "burner": "burner",
    "stovetop": "burner",
    "stove": "burner",
    "hob": "burner",
    "ring": "burner",
    "cutting board": "board",
    "board": "board",
    "chopping board": "board",
    "knife": "knife",
    "bowl": "bowl",
    "mixing bowl": "bowl",
    "baking sheet": "sheet_pan",
    "sheet pan": "sheet_pan",
    "tray": "sheet_pan",
    "baking dish": "baking_dish",
    "casserole dish": "baking_dish",
    "blender": "blender",
    "food processor": "food_processor",
    "microwave": "microwave",
    "grill": "grill",
    "air fryer": "air_fryer",
}

# Longest phrase first, so "cutting board" matches before the bare "board"
# inside it would.
_TAG_ALIASES_BY_LENGTH = sorted(_TAG_ALIASES.items(), key=lambda kv: len(kv[0]), reverse=True)

_WORD_RE = re.compile(r"[a-z]+")


def _strip_quantifiers(phrase: str) -> str:
    words = [w for w in _WORD_RE.findall(phrase.lower()) if w not in _QUANTIFIERS]
    return " ".join(words)


def _fallback_tag(remainder: str) -> str:
    """A short, stable tag for a phrase the alias table doesn't recognise.

    Not a guess at what the equipment is -- just a deterministic slug so two
    mentions of the same unrecognised phrase ("only one griddle" twice)
    still land on the same tag, and one mention still produces *a* tag
    rather than being silently dropped.
    """
    words = remainder.split()
    return "_".join(words[:3])[:30] or "limited"


def map_kitchen_limits_to_tags(phrases: list[str]) -> list[str]:
    """Map kitchen-limit phrases to exclusive-resource tags, in order, deduped.

    Each phrase produces exactly one tag: an exact or substring match against
    `_TAG_ALIASES` when the phrase names known equipment, otherwise a
    deterministic slug of the phrase (`_fallback_tag`) so an unrecognised
    limit is still respected as *some* exclusive resource rather than
    dropped. Never raises; an empty or unparseable phrase is skipped.
    """
    tags: list[str] = []
    seen: set[str] = set()

    for phrase in phrases:
        remainder = _strip_quantifiers(phrase)
        if not remainder:
            continue

        tag = _TAG_ALIASES.get(remainder)
        if tag is None:
            for alias, mapped in _TAG_ALIASES_BY_LENGTH:
                if alias in remainder:
                    tag = mapped
                    break
        if tag is None:
            tag = _fallback_tag(remainder)

        if tag not in seen:
            seen.add(tag)
            tags.append(tag)

    return tags
