"""Ingest routes for the BubblyChef AI microservice.

Exposes:
- POST /v1/ingest/recipe-url — extract a RecipeCard from a recipe page URL
- POST /v1/ingest          — unified modality dispatcher (receipt in v1;
                             URL #205, barcode #206 as extension seams)
"""

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
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
        logger.info(
            f"Recipe URL ingest success: user={user_id}, title={recipe.title!r}, "
            f"thumbnail_url={recipe.thumbnail_url!r}"
        )
        return recipe

    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        logger.error(f"Recipe URL ingest failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=502,
            detail=f"Could not extract recipe from URL: {str(e)}",
        ) from e


# =============================================================================
# Unified /ingest dispatcher endpoint (Decision B + D)
# =============================================================================


@router.post(
    "",
    summary="Unified ingest dispatcher (receipt + barcode wired; URL #205 coming)",
    responses={
        200: {"description": "PantryProposal envelope"},
        400: {"description": "Could not detect modality or modality not yet supported"},
        401: {"description": "Missing or invalid JWT"},
        422: {"description": "Invalid or unreadable input"},
        500: {"description": "Ingest failed"},
    },
)
async def ingest(
    file: UploadFile | None = File(
        default=None,
        description="Receipt image (JPEG/PNG) — sets modality=receipt",
    ),
    ocr_text: str | None = Form(
        default=None,
        description="Pre-extracted receipt OCR text — sets modality=receipt",
    ),
    text: str | None = Form(
        default=None,
        description=(
            "Free-form text. Auto-detected: URL → recipe (#205 stub), "
            "8-14 digit string → barcode (#206 stub), else → receipt OCR text."
        ),
    ),
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """Unified entry point for all pantry ingest modalities.

    **v1 behaviour:** receipt and barcode/product are fully wired.

    - Supply ``file`` (image upload) or ``ocr_text`` (plain text) to trigger
      receipt parsing.
    - Supply ``text`` with an 8–14 digit barcode number to trigger the
      barcode/product extractor (routes to ``run_product_ingest``; lookup
      is a stub pending #191).
    - Supply ``text`` with a URL to get a 400 today (ticket #205).
    - Supply any other ``text`` to let the server treat it as receipt OCR text.

    The response is a ``ProposalEnvelope[PantryProposal]`` serialised as JSON.

    **Extension seam for #205 (URL):** register an extractor with
    ``dispatcher.register_url_extractor(fn)`` at app startup and the 400
    stub becomes live automatically.
    """
    from bubbly_chef.api.ingest_dispatcher import (
        IngestModality,
        IngestPayload,
        dispatcher,
    )

    logger.info("Unified ingest: user=%s", user_id)

    # Build a raw payload from whichever inputs were supplied
    image_bytes: bytes | None = None
    if file is not None:
        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(status_code=422, detail="File must be an image (JPEG/PNG)")
        image_bytes = await file.read()
        if not image_bytes:
            raise HTTPException(status_code=422, detail="Empty file")

    # Determine the explicit modality the caller wants, or leave UNKNOWN for
    # auto-detection.
    if image_bytes or ocr_text:
        # Caller explicitly targeting receipt path
        modality = IngestModality.RECEIPT
        effective_ocr_text = ocr_text  # may be None; extractor handles image path
    else:
        modality = IngestModality.UNKNOWN
        effective_ocr_text = text  # will be auto-detected

    payload = IngestPayload(
        modality=modality,
        image_bytes=image_bytes,
        ocr_text=effective_ocr_text,
        text=text if modality is IngestModality.UNKNOWN else None,
    )

    # If an image was uploaded but no OCR text provided, run OCR here so the
    # receipt extractor always receives text (mirrors scan.py behaviour).
    if image_bytes and not effective_ocr_text:
        try:
            from bubbly_chef.services.image_preprocessor import get_image_preprocessor
            from bubbly_chef.services.ocr import get_ocr_service

            preprocessor = get_image_preprocessor(mode="auto")
            processed = await preprocessor.preprocess(image_bytes, return_format="bytes")
            ocr = get_ocr_service()
            ocr_result = await ocr.extract_text(processed)
            payload = IngestPayload(
                modality=IngestModality.RECEIPT,
                ocr_text=ocr_result,
                image_bytes=image_bytes,
            )
        except Exception as e:
            logger.error("OCR failed: %s", e, exc_info=True)
            raise HTTPException(
                status_code=422,
                detail=f"Could not extract text from image: {e}",
            ) from e

    try:
        envelope = await dispatcher.dispatch(payload)
        return envelope.model_dump(mode="json")
    except NotImplementedError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        logger.error("Ingest dispatch failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Ingest failed: {e}") from e
