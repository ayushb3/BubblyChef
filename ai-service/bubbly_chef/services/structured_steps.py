"""Lazy-upgrade workflow for a recipe's structured steps (issue #648).

`ensure_structured_steps` backs `POST /v1/recipes/{recipe_id}/steps/ensure`:
idempotent, returns existing steps with no model call when present, and
otherwise asks the model for step *metadata only* -- the step text always
comes verbatim from the recipe's own `instructions`, never from the model
(issue #647's "Structured steps" section). A failed or invalid model call
persists nothing.
"""

import logging
from typing import Literal

from pydantic import BaseModel, Field

from bubbly_chef.ai import AIManager
from bubbly_chef.ai.manager import NoProviderAvailableError
from bubbly_chef.ai.provider import user_message_for_failure
from bubbly_chef.models.recipe import StepMetadata, StructuredStep, build_structured_steps
from bubbly_chef.prompts.recipe import STRUCTURED_STEPS_ENSURE_PROMPT
from bubbly_chef.repository.supabase_repo import SupabaseRepository

logger = logging.getLogger(__name__)

ErrorKind = Literal["model_unavailable", "invalid_output"]


class RecipeNotFoundError(Exception):
    """Raised when `recipe_id` doesn't exist or doesn't belong to `user_id`."""

    def __init__(self, recipe_id: str) -> None:
        self.recipe_id = recipe_id
        super().__init__(f"Recipe not found: {recipe_id}")


class StructuredStepsUnavailableError(Exception):
    """Raised when structured steps can't be derived. Nothing is persisted.

    `error_kind` distinguishes the two 502 cases the route reports:
    - "model_unavailable": no AI provider could be reached.
    - "invalid_output": the model responded, but its step metadata didn't
      validate (e.g. a count mismatch against `instructions`).
    """

    def __init__(self, error_kind: ErrorKind, message: str) -> None:
        self.error_kind: ErrorKind = error_kind
        self.message = message
        super().__init__(message)


class _StepsEnsureOutput(BaseModel):
    """Structured-output schema for the ensure route's model call.

    Metadata only, matched positionally to the recipe's `instructions` --
    the model is never asked for step text (see module docstring).
    """

    steps: list[StepMetadata] = Field(
        description=(
            "One entry per instruction, in the same order and count. Do not "
            "include the instruction text itself."
        )
    )


async def ensure_structured_steps(
    user_id: str,
    recipe_id: str,
    repo: SupabaseRepository,
    ai_manager: AIManager,
) -> tuple[list[StructuredStep], bool]:
    """Return `(steps, derived)` for one recipe, deriving and persisting on first use.

    `derived` is False when existing steps were returned with no model call,
    True when they were just derived and persisted. Raises `RecipeNotFoundError`
    when the recipe doesn't belong to `user_id`, and
    `StructuredStepsUnavailableError` when derivation fails -- in that case
    nothing is written.
    """
    recipe_row = await repo.get_recipe(user_id, recipe_id)
    if recipe_row is None:
        raise RecipeNotFoundError(recipe_id)

    existing_raw = recipe_row.get("steps")
    if existing_raw:
        return [StructuredStep.model_validate(s) for s in existing_raw], False

    instructions: list[str] = list(recipe_row.get("instructions") or [])
    if not instructions:
        # Nothing to derive metadata for -- not a failure, just an empty
        # recipe. No model call, and nothing new to persist.
        return [], False

    prompt = STRUCTURED_STEPS_ENSURE_PROMPT.format(
        title=recipe_row.get("title") or "",
        instructions_formatted="\n".join(
            f"{i + 1}. {step}" for i, step in enumerate(instructions)
        ),
    )

    try:
        result = await ai_manager.complete(
            prompt=prompt,
            response_schema=_StepsEnsureOutput,
            temperature=0.3,
        )
    except NoProviderAvailableError as e:
        raise StructuredStepsUnavailableError(
            "model_unavailable", user_message_for_failure(e.kind, e.configured)
        ) from e

    if not isinstance(result, _StepsEnsureOutput):
        raise StructuredStepsUnavailableError(
            "invalid_output", "The model returned an unexpected response."
        )

    steps = build_structured_steps(result.steps, instructions)
    if steps is None:
        raise StructuredStepsUnavailableError(
            "invalid_output",
            "The model's step metadata didn't match this recipe's instructions.",
        )

    await repo.update_recipe_steps(
        user_id, recipe_id, [s.model_dump(mode="json") for s in steps]
    )
    return steps, True
