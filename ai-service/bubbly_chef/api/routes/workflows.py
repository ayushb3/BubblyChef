"""Workflow routes for the BubblyChef AI microservice.

Exposes:
- POST /v1/workflows/apply — apply a reviewed proposal (pantry or recipe)
- POST /v1/workflows/reject — record that a pantry proposal card was dismissed (#444)
"""

import logging

from fastapi import APIRouter, Depends, HTTPException

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.models.requests import (
    ApplyRequest,
    ApplyResponse,
    RejectRequest,
    RejectResponse,
)
from bubbly_chef.repository.supabase_repo import get_repository
from bubbly_chef.services.proposal_review import apply_pantry_with_review, reject_with_review

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/workflows", tags=["workflows"])


@router.post(
    "/apply",
    summary="Apply a reviewed proposal",
    response_model=ApplyResponse,
    responses={
        200: {"description": "Proposal applied successfully"},
        401: {"description": "Missing or invalid JWT"},
    },
)
async def apply_proposal(
    request: ApplyRequest,
    user_id: str = Depends(get_current_user_id),
) -> ApplyResponse:
    """Apply a pantry or recipe proposal that the user has reviewed."""
    logger.info(
        f"Apply proposal: user={user_id}, intent={request.intent}, "
        f"request_id={request.request_id}"
    )

    repo = await get_repository()

    if request.intent == "pantry_update":
        return await apply_pantry_with_review(repo, user_id, request)

    elif request.intent == "recipe_card":
        try:
            from bubbly_chef.models.recipe import RecipeCard

            recipe = RecipeCard(**request.proposal)
            await repo.add_recipe(user_id=user_id, recipe=recipe)

            return ApplyResponse(
                request_id=request.request_id,
                success=True,
                applied_count=1,
            )
        except Exception as e:
            logger.error(f"Failed to save recipe: {e}", exc_info=True)
            return ApplyResponse(
                request_id=request.request_id,
                success=False,
                failed_count=1,
                errors=[str(e)],
            )

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported intent: {request.intent}",
        )


@router.post(
    "/reject",
    summary="Record that a pantry proposal card was dismissed",
    response_model=RejectResponse,
    responses={
        200: {"description": "Recorded (ids that match nothing are ignored)"},
        401: {"description": "Missing or invalid JWT"},
    },
)
async def reject_proposal(
    request: RejectRequest,
    user_id: str = Depends(get_current_user_id),
) -> RejectResponse:
    """Mark the named chat turns `rejected`. No pantry write, no bubbles.

    Another user's conversation or request ids match zero rows, so nothing is
    recorded and nothing is revealed: the response just omits them.
    """
    logger.info(
        f"Reject proposal: user={user_id}, conversation_id={request.conversation_id}, "
        f"turns={len(request.turn_request_ids)}"
    )
    repo = await get_repository()
    return await reject_with_review(repo, user_id, request)
