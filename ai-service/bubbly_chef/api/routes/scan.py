"""Scan/receipt HTTP routes for the BubblyChef AI microservice.

Exposes:
- POST /v1/scan/receipt — OCR + AI parse a receipt image
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from bubbly_chef.api.auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/scan", tags=["scan"])


@router.post(
    "/receipt",
    summary="OCR and parse a receipt image",
    responses={
        200: {"description": "Parsed receipt items with confidence scores"},
        401: {"description": "Missing or invalid JWT"},
        422: {"description": "Invalid or unreadable image"},
    },
)
async def scan_receipt(
    file: UploadFile = File(..., description="Receipt image (JPEG/PNG)"),
    preprocess: bool = False,
    preprocess_mode: str = "auto",
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Upload a receipt image, run OCR, and return parsed items.

    Each item has a confidence score:
    - >= 0.8: ready_to_add
    - 0.5–0.8: needs_review
    - < 0.5: skipped
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=422, detail="File must be an image (JPEG/PNG)")

    image_data = await file.read()
    if not image_data:
        raise HTTPException(status_code=422, detail="Empty file")

    logger.info(
        f"Receipt scan: user={user_id}, size={len(image_data)}, "
        f"preprocess={preprocess}, mode={preprocess_mode}"
    )

    try:
        # Optional preprocessing
        if preprocess:
            from bubbly_chef.services.image_preprocessor import get_image_preprocessor

            preprocessor = get_image_preprocessor(mode=preprocess_mode)
            image_data = await preprocessor.preprocess(image_data, return_format="bytes")

        # OCR
        from bubbly_chef.services.ocr import get_ocr_service

        ocr = get_ocr_service()
        ocr_text = await ocr.extract_text(image_data)

        if not ocr_text.strip():
            return {
                "ocr_text": "",
                "ready_to_add": [],
                "needs_review": [],
                "skipped": [],
                "total_items": 0,
                "warnings": ["No text detected in image. Try a clearer photo."],
            }

        # AI parse via receipt ingest workflow
        from bubbly_chef.workflows.receipt_ingest import run_receipt_ingest

        result = await run_receipt_ingest(ocr_text=ocr_text)

        # Extract items from the proposal envelope (Pydantic model)
        proposal = result.proposal
        actions = proposal.actions if proposal else []
        warnings = list(result.warnings or [])

        # Categorize by confidence
        ready = []
        review = []
        skipped = []
        for action in actions:
            confidence = action.confidence
            pantry_item = action.item
            item = {
                "name": pantry_item.name,
                "original_name": pantry_item.original_name or pantry_item.name,
                "source_line": action.source_line or "",
                "price": action.price,
                "quantity": pantry_item.quantity,
                "unit": pantry_item.unit,
                "category": pantry_item.category.value if hasattr(pantry_item.category, "value") else str(pantry_item.category),
                "location": pantry_item.storage_location or "pantry",
                "confidence": confidence,
            }
            if confidence >= 0.8:
                ready.append(item)
            elif confidence >= 0.5:
                review.append(item)
            else:
                skipped.append(item)

        return {
            "ocr_text": ocr_text,
            "ready_to_add": ready,
            "needs_review": review,
            "skipped": skipped,
            "total_items": len(actions),
            "warnings": warnings,
        }

    except Exception as e:
        logger.error(f"Receipt scan failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Receipt scan failed: {str(e)}") from e
