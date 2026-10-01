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

from collections.abc import Iterable

from bubbly_chef.domain.diet_terms import DAIRY, NUTS, SEAFOOD, mentions, norm_label

_SHELLFISH = frozenset(
    {
        "shellfish", "shrimp", "prawn", "crab", "crawfish", "crayfish", "lobster", "clam",
        "mussel", "oyster", "scallop", "squid", "calamari", "octopus",
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
            "wheat", "gluten", "barley", "rye", "semolina", "couscous", "seitan", "bread",
            "breadcrumb", "pasta", "spaghetti", "noodle", "tortilla",
        }
    ),
}


def _singular(label: str) -> str:
    """"peanuts" -> "peanut" ("glass" and "hummus" keep their s)."""
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


def allergens_named(allergies: Iterable[str], *fields: str) -> list[str]:
    """The allergies (as the user spelled them) that any of `fields` names.

    Each field is checked on its own, so an ingredient line can never be read
    together with the next one. Order follows `allergies`; no duplicates.
    """
    named: list[str] = []
    seen: set[str] = set()
    for allergy in allergies:
        key = norm_label(allergy)
        if not key or key in seen:
            continue
        terms = allergen_terms(allergy)
        if any(mentions(term, field, plant_markers=False) for term in terms for field in fields):
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
