"""Never ship a recipe with nothing to cook (issue #720).

A small local model answering with a grammar-constrained schema is free to leave
out any field the schema marks optional, and `LLMRecipeResult` used to mark the
ingredients and instructions optional. The result was a card with a title and
times, zero ingredients, zero steps and a Cook button. The schema now requires
both; this module is the second line of defence for a provider that returns an
empty list anyway (an unconstrained provider, or an explicit `[]`): the result is
treated as a failed generation, asked for once more, and then refused with
`BlankRecipeError` so the caller can say so honestly instead of showing a blank
card.
"""

import logging
from typing import Any

from bubbly_chef.workflows.shared_state import LLMRecipeResult

logger = logging.getLogger(__name__)

_RETRY_NOTE = (
    "\n\n[RETRY: Your previous answer had no ingredients or no instructions. "
    "Return the complete recipe: every ingredient with its amount, and every step.]"
)


class BlankRecipeError(ValueError):
    """The model returned a recipe card with no ingredients or no instructions twice."""


def is_blank_recipe(result: LLMRecipeResult) -> bool:
    """True when the result has no ingredients or no instructions to cook from."""
    return not result.ingredients or not result.instructions


async def complete_recipe(
    ai_manager: Any,
    *,
    prompt: str,
    response_schema: type[LLMRecipeResult],
    temperature: float,
) -> LLMRecipeResult:
    """`ai_manager.complete` for a recipe, retried once if the card comes back blank.

    Raises:
        BlankRecipeError: both answers had no ingredients or no instructions.
        ValueError: the provider returned something that is not an `LLMRecipeResult` (a plain one is fine for a subclass schema).
        Anything `ai_manager.complete` raises (e.g. `NoProviderAvailableError`) is
        left to the caller, unchanged.
    """
    for attempt in (1, 2):
        result = await ai_manager.complete(
            prompt=prompt if attempt == 1 else prompt + _RETRY_NOTE,
            response_schema=response_schema,
            temperature=temperature,
        )
        if not isinstance(result, LLMRecipeResult):
            raise ValueError("Unexpected response type from AI provider")
        if not is_blank_recipe(result):
            return result
        logger.warning(
            "Recipe %r came back with %d ingredients and %d instructions (attempt %d of 2)",
            result.title,
            len(result.ingredients),
            len(result.instructions),
            attempt,
        )
    raise BlankRecipeError(f"Recipe {result.title!r} had no ingredients or instructions")
