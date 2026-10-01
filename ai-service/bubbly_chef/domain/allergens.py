"""The allergen matcher (issue #500): "does this text name a food the user is allergic to".

A profile allergy is a hard "never suggest" (spec B.8, user story 18), not a
preference, so the model must not be the only line of defence: this pure module
is the deterministic check a post-generation guard runs on every card, meal
outline and dish. It reuses the shared diet matcher (`domain.diet_terms`) for
plural handling ("peanut" names "peanuts"), `-free` phrases ("peanut-free") and
the fixed false friends ("cream of tartar" is not cream, "flax egg" is not egg),
and adds one thing the diet table doesn't have: an allergy is free text, so a
few broad ones ("nuts", "dairy", "shellfish") expand into the foods they cover.

No imports from `workflows/` or `services/`, no I/O.

Deliberately conservative: this is a safety check, so it never applies the
diet matcher's plant-marker window (a "vegan cheese" still counts for a
milk-allergic user who typed "cheese"). The cost of a false positive is one
regeneration; the cost of a false negative is an allergen on a card.
"""

import re
from collections.abc import Iterable

from bubbly_chef.domain.diet_terms import DAIRY, NUTS, SEAFOOD, mentions, norm_label

_SHELLFISH = frozenset(
    {
        "shellfish",
        "shrimp",
        "prawn",
        "crab",
        "crawfish",
        "crayfish",
        "lobster",
        "clam",
        "mussel",
        "oyster",
        "scallop",
        "squid",
        "calamari",
        "octopus",
    }
)

# Broad allergy labels -> the foods they cover. Keys are `norm_label` of the
# singular form. Anything not listed here is matched as the literal term the user
# typed ("peanut", "sesame", "kiwi"), which is the right behaviour for a specific
# allergen.
ALLERGEN_GROUPS: dict[str, frozenset[str]] = {
    "nut": NUTS,
    "tree-nut": NUTS - {"peanut", "nut"},
    "dairy": DAIRY,
    "milk": DAIRY,
    "lactose": DAIRY,
    "egg": frozenset({"egg", "mayonnaise"}),
    "shellfish": _SHELLFISH,
    "fish": SEAFOOD - _SHELLFISH,
    "seafood": SEAFOOD,
    "soy": frozenset({"soy", "soya", "tofu", "tempeh", "edamame", "miso"}),
    "sesame": frozenset({"sesame", "tahini"}),
    "wheat": frozenset({"wheat", "flour", "bread", "breadcrumb", "pasta", "couscous", "semolina"}),
    "gluten": frozenset(
        {
            "wheat",
            "gluten",
            "barley",
            "rye",
            "semolina",
            "couscous",
            "seitan",
            "bread",
            "breadcrumb",
            "pasta",
            "spaghetti",
            "noodle",
            "tortilla",
            "flour",
        }
    ),
}


def _singular(label: str) -> str:
    """ "peanuts" -> "peanut" ("glass" and "hummus" keep their s)."""
    if len(label) > 3 and label.endswith("s") and not label.endswith(("ss", "us")):
        return label[:-1]
    return label


def allergen_terms(entry: str) -> frozenset[str]:
    """Every literal food term a single profile allergy entry stands for.

    Always includes the entry as typed (lowercased, trimmed) and its singular, so
    "Peanuts" matches "peanut butter". A broad label also brings in the foods it
    covers ("nuts" -> almond, cashew, ...).
    """
    cleaned = " ".join(entry.strip().lower().split())
    if not cleaned:
        return frozenset()
    terms = {cleaned, _singular(cleaned)}
    terms |= ALLERGEN_GROUPS.get(norm_label(_singular(cleaned)), frozenset())
    return frozenset(terms)


# ---------------------------------------------------------------------------
# "X-free" qualifiers on an expanded term
# ---------------------------------------------------------------------------
#
# `mentions` already rejects `peanut-free` for the literal term "peanut", but a broad
# allergy also matches the foods it expands to, and `gluten-free pasta` names "pasta"
# with nothing after it. A model told `NEVER include (allergy): gluten` writes exactly
# that, so without this the correct card is flagged, regenerated, flagged again and
# refused. The qualifier has to cover the *same ingredient phrase* it sits in front of
# (or in brackets after): "gluten-free bread and regular pasta" and "pasta (not
# gluten-free)" still name the pasta. This is a safety check, so every doubt flags.

# Labels whose "-free" says nothing about the allergen: lactose-free milk is still milk.
_NEVER_CLEARS = frozenset({"lactose"})

# Cereal labels clear only their own allergy, never a narrower or different one. Gluten-free
# products can contain wheat (Codex "gluten-free wheat starch"), so `gluten-free` does not
# clear a wheat allergy and `wheat-free` does not clear a gluten one.
_OWN_ONLY = frozenset({"gluten", "wheat"})

# Plain non-wheat flours: "almond flour" is not the wheat the group expansion means.
_NON_WHEAT_FLOUR = (
    "almond|coconut|rice|corn|maize|chickpea|gram|tapioca|potato|cassava|buckwheat|sorghum|"
    "millet|teff|quinoa|arrowroot|lentil|banana|hazelnut|cashew|pea|soy|soya|tigernut"
)

# The qualified phrase ends at a delimiter, a coordinator or a new clause, so a second
# food in the same line is never covered by the first one's qualifier.
_PHRASE_END = r"(?=\s+(?:and|or|with|plus|but|then|without|&)\s|[,;()/]|$)"
_NEGATED = r"(?<!\bnot\s)(?<!\bnon[\s-])"


def _qualifier_labels(allergy: str) -> frozenset[str]:
    """The labels whose `<label>-free` clears a match of `allergy`'s terms."""
    cleaned = " ".join(allergy.strip().lower().split())
    own = {cleaned, _singular(cleaned)}
    mine = allergen_terms(allergy)
    labels = set(own)
    for key, group in ALLERGEN_GROUPS.items():
        if key in _NEVER_CLEARS or key in _OWN_ONLY:
            continue
        if mine <= group | {key}:
            labels.add(key.replace("-", " "))
    return frozenset(label for label in labels if label)


def _label_re(labels: Iterable[str]) -> str:
    return "|".join(
        re.escape(label).replace(r"\ ", r"[\s-]") for label in sorted(labels, key=len, reverse=True)
    )


def _scrub_qualified(allergy: str, field: str) -> str:
    """`field` with the phrases an `<allergen>-free` qualifier clears taken out.

    Covers a leading qualifier ("gluten-free pasta", "free of gluten pasta", "no-gluten
    pasta") and a bracketed or comma one right after the phrase ("pasta (gluten-free)").
    """
    text = field.lower().replace("\u2019", "'")
    labels = _qualifier_labels(allergy)
    if not labels:
        return text
    lab = _label_re(labels)
    leading = (
        rf"{_NEGATED}(?<![\w-])(?:certified\s+)?"
        rf"(?:(?:{lab})[\s-]free|free\s+of\s+(?:{lab})|(?:no|without)[\s-](?:{lab}))"
        rf"\s+[^,;()/]+?{_PHRASE_END}"
    )
    trailing = (
        rf"[^,;()/]+?\s*(?:\(\s*|,\s*)(?:certified\s+)?"
        rf"(?:(?:{lab})[\s-]free|free\s+of\s+(?:{lab}))\s*\)?"
    )
    text = re.sub(leading, " ", text)
    text = re.sub(trailing, " ", text)
    # The broad expansion of wheat/gluten reaches "flour"; a plain non-wheat flour isn't it.
    if "flour" in allergen_terms(allergy) and norm_label(_singular(allergy.strip().lower())) != (
        "flour"
    ):
        text = re.sub(rf"\b(?:{_NON_WHEAT_FLOUR})\s+flours?\b", " ", text)
    return text


def allergens_named(allergies: Iterable[str], *fields: str) -> list[str]:
    """The allergies (as the user spelled them) that any of `fields` names.

    Each field is checked on its own, so an ingredient line can never be read
    together with the next one. Order follows `allergies`; no duplicates. A phrase
    carrying an `<allergen>-free` qualifier for the allergy being checked
    ("gluten-free pasta") doesn't name it; see `_scrub_qualified`.
    """
    named: list[str] = []
    seen: set[str] = set()
    for allergy in allergies:
        key = norm_label(allergy)
        if not key or key in seen:
            continue
        terms = allergen_terms(allergy)
        scrubbed = [_scrub_qualified(allergy, field) for field in fields]
        if any(mentions(term, field, plant_markers=False) for term in terms for field in scrubbed):
            named.append(allergy)
            seen.add(key)
    return named


def allergies_behind_diet_label(label: str, allergies: Iterable[str]) -> list[str]:
    """The allergies a "X-free" diet label stands in front of ("nut-free" -> peanut, almond).

    A chat diet label like "nut-free" or "no dairy" and a profile allergy are the same
    fact said two ways, and the allergy is the one that is hard (#500). A label that
    isn't an exclusion label ("vegan", "keto") stands in front of no allergy. Used so
    a chat message dropping such a label can't be read as dropping the allergy.
    """
    key = norm_label(label)
    for prefix in ("no-", "without-"):
        key = key.removeprefix(prefix)
    for suffix in ("-free", "-allergy", "-allergic", "-intolerant"):
        key = key.removesuffix(suffix)
    if key == norm_label(label):
        return []
    label_terms = allergen_terms(key.replace("-", " "))
    named: list[str] = []
    for allergy in allergies:
        if not norm_label(allergy):
            continue
        if allergen_terms(allergy) & label_terms:
            named.append(allergy)
    return named


def drop_naming_allergen(items: Iterable[str], allergies: Iterable[str]) -> list[str]:
    """`items` without any entry that names one of `allergies`, order preserved."""
    allergy_list = list(allergies)
    if not allergy_list:
        return list(items)
    return [item for item in items if not allergens_named(allergy_list, item)]
