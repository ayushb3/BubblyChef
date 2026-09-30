"""The post-generation allergen guard (issue #500, spec B.8).

A profile allergy is a hard "never suggest". The prompt tells the model so, but
the model must not be the only line of defence, so every path that returns a
recipe card, a meal outline or a dish runs its output through this guard:

1. Generate.
2. If the result names an allergen, regenerate ONCE with the offence spelled out.
3. If it still does, raise `AllergenViolation` and let the caller say so honestly.
   Nothing that names an allergen is ever returned.

An explicit "do it anyway" in the message never reaches this module: the guard has
no override, by design. (A *dislike* is a different, soft rule; see
`workflows/recipe/exclusions.py`.)
"""

import logging
from collections.abc import Awaitable, Callable, Iterable
from typing import TypeVar

from bubbly_chef.domain.allergens import allergens_named

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Appended to the prompt on the single regeneration.
_RETRY_TEMPLATE = (
    "\n\nIMPORTANT: your previous answer named {allergens}, which the user is allergic to. "
    "Regenerate it with none of {allergens} anywhere -- not in the title, the ingredients "
    "or the steps."
)


class AllergenViolation(Exception):  # noqa: N818 — reads as a domain event, not an "Error"
    """Generation still named an allergen after the one regeneration."""

    def __init__(self, allergens: list[str]) -> None:
        super().__init__(f"generation still named an allergen: {', '.join(allergens)}")
        self.allergens = allergens


def card_allergens(
    allergies: Iterable[str], title: str, ingredient_names: Iterable[str]
) -> list[str]:
    """The allergies a card's title or ingredient lines name.

    Every field is checked alone (see `allergens_named`). Steps and notes are not
    read: a step like "no peanuts in this one" is not an ingredient, and the
    ingredient list is the contract the user shops and cooks from.
    """
    return allergens_named(allergies, title, *ingredient_names)


async def generate_allergen_safe(
    generate: Callable[[str], Awaitable[T]],
    violations: Callable[[T], list[str]],
    allergies: Iterable[str],
    *,
    salvage: Callable[[T], T | None] | None = None,
) -> T:
    """Run `generate` and return a result `violations` finds clean.

    `generate(extra)` builds and sends the prompt with `extra` appended (`""` on the
    first attempt). `violations(result)` returns the allergens the result names.
    With no allergies this is a single plain call. Otherwise a dirty first result
    is regenerated once; a dirty second result raises `AllergenViolation`.

    `salvage` is for results made of several independent parts (meal options, side
    alternatives): given the still-dirty second result it returns that result
    without its offending parts, or `None` when nothing clean is left, in which case
    the violation is raised. A salvaged result never names an allergen.
    """
    allergy_list = [a for a in allergies if a and a.strip()]
    first = await generate("")
    if not allergy_list:
        return first
    named = violations(first)
    if not named:
        return first

    logger.warning("Allergen guard: generation named %s; regenerating once", named)
    second = await generate(_RETRY_TEMPLATE.format(allergens=", ".join(named)))
    named_again = violations(second)
    if named_again:
        logger.warning("Allergen guard: regeneration still named %s", named_again)
        cleaned = salvage(second) if salvage is not None else None
        if cleaned is None:
            raise AllergenViolation(named_again)
        return cleaned
    return second


def allergen_refusal_message(allergens: list[str], what: str) -> str:
    """The honest reply when a dish can't be made without an allergen.

    Says what was refused and why, so the user isn't left guessing, and points at
    the one place an allergy can be changed.
    """
    listed = ", ".join(allergens)
    return (
        f"I couldn't put together {what} without {listed}, and "
        f"{'that is' if len(allergens) == 1 else 'those are'} on your allergy list, "
        "so I won't suggest it. Want to try a different dish? "
        "(You can change your allergies on your Profile page.)"
    )


def allergen_safe_note(allergies: list[str]) -> str:
    """One line for a card reply: what was checked, so the user can see why.

    Empty when the user has no allergies, so replies for everyone else are
    unchanged.
    """
    if not allergies:
        return ""
    return f" I kept out {', '.join(allergies)} because of your allergies."
