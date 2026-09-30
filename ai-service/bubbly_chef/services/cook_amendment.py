"""Applying a confirmed mid-cook amendment (issues #489 and #490).

A `RecipeAmendmentProposal` is the model's FULL replacement ingredient list for
the recipe the user is cooking. Confirming it does three things, and only
these:

1. Writes the amended list into the conversation's pinned
   `SessionContext.cooking_recipe` snapshot, so the NEXT amendment is detected
   against it instead of the original (stacking). The snapshot is the
   conversation's record of "the recipe I'm cooking".
2. Records the amendment turn as applied (`metadata.proposal_review`, the same
   record #444 keeps for pantry cards), so a restored thread shows the card as
   applied, never as a live button that would re-apply.
3. Nothing else. In particular it never writes the `recipes` table: a saved
   library recipe is not silently mutated by a one-off cook amendment. What
   gets deducted is decided by the client handing the amended list to
   `POST /v1/recipes/cook` (`ingredients`), not by anything stored here.
"""

import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from pydantic import ValidationError

from bubbly_chef.models.proposals import ProposalReview, RecipeAmendmentProposal
from bubbly_chef.models.requests import ApplyRequest, ApplyResponse
from bubbly_chef.repository.supabase_repo import SupabaseRepository
from bubbly_chef.services.proposal_review import _write_reviews
from bubbly_chef.workflows.chat.nodes import normalize_cooking_recipe

logger = logging.getLogger(__name__)


class InvalidAmendmentError(ValueError):
    """The request's proposal is not a usable amendment (maps to HTTP 422)."""


class AmendmentNotApplicableError(Exception):
    """The conversation is not cooking the amended recipe (maps to HTTP 409)."""


def _amended_lines(proposal: RecipeAmendmentProposal) -> list[str]:
    """The amended list flattened to the display lines the snapshot stores.

    Same flattening `normalize_cooking_recipe` applies to any pin, so a stored
    amendment reads exactly like the original pin did.
    """
    usable = [
        {
            "name": ing.name,
            # 30.0 reads as "30", not "30.0", in the stored line.
            "quantity": int(ing.quantity) if float(ing.quantity).is_integer() else ing.quantity,
            "unit": ing.unit,
        }
        for ing in proposal.amended_ingredients
        if ing.name.strip()
    ]
    lines = normalize_cooking_recipe({"ingredients": usable})["ingredients"]
    return [str(line) for line in lines]


def _parse_proposal(raw: dict[str, Any]) -> RecipeAmendmentProposal:
    try:
        proposal = RecipeAmendmentProposal.model_validate(raw)
    except ValidationError as err:
        raise InvalidAmendmentError("Not a recipe amendment proposal") from err
    if not proposal.is_amendment or not proposal.recipe_id:
        raise InvalidAmendmentError("An amendment must name the recipe it amends")
    return proposal


async def apply_cooking_amendment(
    repo: SupabaseRepository, user_id: str, request: ApplyRequest
) -> ApplyResponse:
    """Apply `request.proposal` (a `RecipeAmendmentProposal`) to the conversation's cook pin."""
    if not request.conversation_id:
        raise InvalidAmendmentError("An amendment is applied to a conversation")
    proposal = _parse_proposal(request.proposal)
    lines = _amended_lines(proposal)
    if not lines:
        raise InvalidAmendmentError("The amendment has no usable ingredient lines")

    # Read-only lookup: a rejected apply (409) must not leave a session row behind.
    session = await repo.get_session(user_id, request.conversation_id)
    snapshot = session.metadata.cooking_recipe if session is not None else None
    if session is None or snapshot is None or snapshot.id != proposal.recipe_id:
        raise AmendmentNotApplicableError(
            f"Conversation is not cooking recipe {proposal.recipe_id}"
        )

    session.metadata.cooking_recipe = snapshot.model_copy(update={"ingredients": lines})
    await repo.update_session(user_id, session)

    recorded: list[UUID] = []
    turn_ids = [str(rid) for rid in request.turn_request_ids]
    if turn_ids:
        try:
            turns = await repo.get_turns_by_request_ids(user_id, request.conversation_id, turn_ids)
            now = datetime.now(UTC)
            recorded = await _write_reviews(
                repo,
                user_id,
                turns,
                turn_ids,
                lambda _row: ProposalReview(
                    status="applied", chain_request_ids=turn_ids, updated_at=now
                ),
            )
        except Exception as err:
            # The snapshot is what the next turn reads; a missing record only means a
            # restored card can't tell it was applied. Never fail the apply over it.
            logger.warning(f"Could not record the amendment turn as applied: {err}")

    logger.info(
        f"Cook amendment applied: conversation={request.conversation_id}, "
        f"recipe_id={proposal.recipe_id}, lines={len(lines)}"
    )
    return ApplyResponse(
        request_id=request.request_id,
        success=True,
        applied_count=len(lines),
        recorded_turn_request_ids=recorded,
    )
