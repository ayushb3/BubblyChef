"""Workflow routes for the BubblyChef AI microservice.

Exposes:
- POST /v1/workflows/apply — apply a reviewed proposal (pantry or recipe)
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.models.requests import ApplyRequest, ApplyResponse
from bubbly_chef.repository.supabase_repo import get_repository

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
        actions = request.proposal.get("actions", [])
        if not actions:
            return ApplyResponse(
                request_id=request.request_id,
                success=True,
                applied_count=0,
            )

        applied, failed, errors = await repo.apply_pantry_proposal(
            user_id=user_id,
            actions=actions,
        )

        # Log the ingestion
        try:
            await repo.log_ingestion(
                user_id=user_id,
                request_id=str(request.request_id),
                intent="pantry_update",
                input_payload={"actions_count": len(actions)},
                proposal=request.proposal,
                errors=errors,
            )
        except Exception as log_err:
            logger.warning(f"Failed to log ingestion: {log_err}")

        return ApplyResponse(
            request_id=request.request_id,
            success=failed == 0,
            applied_count=applied,
            failed_count=failed,
            errors=errors,
        )

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
