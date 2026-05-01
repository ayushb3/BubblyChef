"""Ingest routes for the BubblyChef AI microservice.

Exposes:
- POST /v1/ingest/recipe-url — extract a RecipeCard from a recipe page URL
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import AnyHttpUrl, BaseModel, field_validator

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.models.recipe import RecipeCard

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/ingest", tags=["ingest"])


class RecipeUrlRequest(BaseModel):
    """Request body for recipe URL ingestion."""

    url: str

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        """Reject obviously malformed URLs early."""
        # AnyHttpUrl is stricter than we need (requires scheme + host), so use
        # it just for validation then return the original string.
        try:
            AnyHttpUrl(v)
        except Exception as exc:
            raise ValueError(f"Invalid URL: {v!r}") from exc
        return v


@router.post(
    "/recipe-url",
    response_model=RecipeCard,
    summary="Extract a recipe from a URL",
    responses={
        200: {"description": "Extracted RecipeCard"},
        401: {"description": "Missing or invalid JWT"},
        422: {"description": "Invalid URL or extraction failed"},
        502: {"description": "Could not fetch or extract recipe from URL"},
    },
)
async def ingest_recipe_url(
    request: RecipeUrlRequest,
    user_id: str = Depends(get_current_user_id),
) -> RecipeCard:
    """Extract a structured RecipeCard from a recipe page URL.

    Extraction strategy (in order):
    1. recipe-scrapers — handles 500+ known sites via Schema.org
    2. recipe-scrapers wild_mode=True — unknown sites with Schema markup
    3. Gemini AI extraction from raw HTML (via AIManager)
    """
    logger.info(f"Recipe URL ingest: user={user_id}, url={request.url}")

    try:
        from bubbly_chef.services.recipe_url_ingestor import ingest_recipe_from_url

        recipe = await ingest_recipe_from_url(request.url)
        logger.info(f"Recipe URL ingest success: user={user_id}, title={recipe.title!r}")
        return recipe

    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        logger.error(f"Recipe URL ingest failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=502,
            detail=f"Could not extract recipe from URL: {str(e)}",
        ) from e
