"""Receipt scanning API endpoints."""

import uuid
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from bubbly_chef.api.deps import get_ai_manager
from bubbly_chef.config import settings
from bubbly_chef.logger import get_logger
from bubbly_chef.models.pantry import FoodCategory, PantryItem, StorageLocation
from bubbly_chef.repository.sqlite import get_repository
from bubbly_chef.services.image_preprocessor import PreprocessMode, get_image_preprocessor
from bubbly_chef.services.ocr import get_ocr_service
from bubbly_chef.services.receipt_parser import ParsedReceiptItem, parse_receipt

logger = get_logger(__name__)

router = APIRouter(prefix="/scan", tags=["Scan"])

# In-memory storage for pending scans (for undo functionality)
# In production, this would be Redis or similar
_pending_scans: dict[str, "ScanSession"] = {}


class ScanSession(BaseModel):
    """Tracks a scan session for undo functionality."""

    request_id: str
    auto_added_ids: list[str] = Field(default_factory=list)
    pending_items: list[ParsedReceiptItem] = Field(default_factory=list)


class ParsedItemResponse(BaseModel):
    """Response model for a parsed item."""

    temp_id: str
    raw_text: str
    name: str
    name_normalized: str
    quantity: float | None
    unit: str | None
    category: str
    location: str
    expiry_date: str | None
    confidence: float


class ScanReceiptResponse(BaseModel):
    """Response from receipt scanning."""

    request_id: str
    ready_to_add: list[ParsedItemResponse]
    needs_review: list[ParsedItemResponse]
    skipped: list[ParsedItemResponse]
    warnings: list[str]


class ConfirmItem(BaseModel):
    """Item to confirm from review."""

    temp_id: str
    name: str
    quantity: float = 1.0
    unit: str = "item"
    category: FoodCategory = FoodCategory.OTHER
    location: StorageLocation = StorageLocation.PANTRY
    expiry_date: date | None = None


class ConfirmItemsRequest(BaseModel):
    """Request to confirm reviewed items."""

    request_id: str
    items: list[ConfirmItem]


class ConfirmItemsResponse(BaseModel):
    """Response after confirming items."""

    added: list[PantryItem]
    failed: list[str]


class UndoResponse(BaseModel):
    """Response after undoing auto-added items."""

    removed_count: int
    removed_ids: list[str]


@router.post("/receipt", response_model=ScanReceiptResponse)
async def scan_receipt(
    image: UploadFile = File(..., description="Receipt image (PNG, JPEG)"),
    preprocess: bool = False,
    preprocess_mode: PreprocessMode = "auto",
) -> ScanReceiptResponse:
    """
    Scan a receipt image and extract grocery items.

    - High confidence items (>0.8) are marked as "ready to add"
    - Lower confidence items are returned for review
    - Nothing is added to the database until confirmed
    - Returns a request_id for confirming items

    **Optional Preprocessing:**
    Set `preprocess=True` to automatically preprocess the image before OCR.
    This can improve accuracy for poor quality images (low lighting, blurry, skewed).

    - `preprocess_mode='auto'`: Automatically detect quality and apply appropriate preprocessing
    - `preprocess_mode='light'`: Minimal preprocessing for good quality images
    - `preprocess_mode='aggressive'`: Full preprocessing for challenging images
    """
    # Validate file type
    if image.content_type not in ["image/png", "image/jpeg", "image/jpg", "image/webp"]:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image type: {image.content_type}. Use PNG, JPEG, or WebP.",
        )

    # Read image data
    image_data = await image.read()

    if len(image_data) == 0:
        raise HTTPException(status_code=400, detail="Empty image file")

    # Preprocess image if requested
    if preprocess:
        try:
            preprocessor = get_image_preprocessor(mode=preprocess_mode)
            image_data = await preprocessor.preprocess(image_data, return_format="bytes")
            logger.info(f"Applied preprocessing with mode: {preprocess_mode}")
        except Exception as e:
            logger.warning(f"Preprocessing failed, using original image: {e}")
            # Continue with original image if preprocessing fails

    # Get OCR service
    ocr = get_ocr_service()

    if not ocr.is_available():
        raise HTTPException(
            status_code=503, detail="OCR service is not available. Please install Tesseract."
        )

    # Extract text from image
    try:
        ocr_text = await ocr.extract_text(image_data)
    except Exception as e:
        logger.error(f"OCR failed: {e}")
        raise HTTPException(status_code=500, detail=f"OCR failed: {str(e)}")

    if not ocr_text.strip():
        raise HTTPException(
            status_code=400,
            detail="Could not extract any text from the image. Try a clearer photo.",
        )

    # Parse receipt with AI
    ai_manager = get_ai_manager()
    parse_result = await parse_receipt(ocr_text, ai_manager)

    # Split into ready-to-add, needs-review, and skipped
    auto_add_threshold = settings.auto_add_confidence_threshold
    review_threshold = settings.review_confidence_threshold

    ready_to_add_items = []
    review_items = []
    skipped_items = []

    for item in parse_result.items:
        if item.confidence >= auto_add_threshold:
            ready_to_add_items.append(item)
        elif item.confidence >= review_threshold:
            review_items.append(item)
        else:
            # Items below review_threshold - show to user as skipped
            skipped_items.append(item)

    # Create request ID and store session (no database writes yet)
    request_id = str(uuid.uuid4())
    _pending_scans[request_id] = ScanSession(
        request_id=request_id,
        auto_added_ids=[],  # Empty - nothing added yet
        pending_items=ready_to_add_items + review_items,  # All items pending
    )

    # Convert ready-to-add items to response format
    ready_to_add_responses = []
    for item in ready_to_add_items:
        expiry_date = None
        if item.expiry_days:
            expiry_date = (date.today() + timedelta(days=item.expiry_days)).isoformat()

        ready_to_add_responses.append(
            ParsedItemResponse(
                temp_id=item.temp_id,
                raw_text=item.raw_text,
                name=item.name,
                name_normalized=item.name_normalized,
                quantity=item.quantity,
                unit=item.unit,
                category=item.category.value,
                location=item.location.value,
                expiry_date=expiry_date,
                confidence=item.confidence,
            )
        )

    # Convert review items to response format
    review_responses = []
    for item in review_items:
        expiry_date = None
        if item.expiry_days:
            expiry_date = (date.today() + timedelta(days=item.expiry_days)).isoformat()

        review_responses.append(
            ParsedItemResponse(
                temp_id=item.temp_id,
                raw_text=item.raw_text,
                name=item.name,
                name_normalized=item.name_normalized,
                quantity=item.quantity,
                unit=item.unit,
                category=item.category.value,
                location=item.location.value,
                expiry_date=expiry_date,
                confidence=item.confidence,
            )
        )

    # Convert skipped items to response format
    skipped_responses = []
    for item in skipped_items:
        expiry_date = None
        if item.expiry_days:
            expiry_date = (date.today() + timedelta(days=item.expiry_days)).isoformat()

        skipped_responses.append(
            ParsedItemResponse(
                temp_id=item.temp_id,
                raw_text=item.raw_text,
                name=item.name,
                name_normalized=item.name_normalized,
                quantity=item.quantity,
                unit=item.unit,
                category=item.category.value,
                location=item.location.value,
                expiry_date=expiry_date,
                confidence=item.confidence,
            )
        )

    return ScanReceiptResponse(
        request_id=request_id,
        ready_to_add=ready_to_add_responses,
        needs_review=review_responses,
        skipped=skipped_responses,
        warnings=parse_result.warnings,
    )


@router.post("/confirm", response_model=ConfirmItemsResponse)
async def confirm_items(request: ConfirmItemsRequest) -> ConfirmItemsResponse:
    """
    Confirm reviewed items and add them to pantry.

    Use the temp_id from needs_review items to identify which items to add.
    You can modify name, quantity, category, etc. before confirming.
    """
    _pending_scans.get(request.request_id)

    # Even if session expired, we can still add items
    repo = await get_repository()
    added = []
    failed = []

    for item in request.items:
        try:
            from bubbly_chef.domain.normalizer import normalize_food_name

            pantry_item = PantryItem(
                name=item.name,
                name_normalized=normalize_food_name(item.name),
                category=item.category,
                location=item.location,
                quantity=item.quantity,
                unit=item.unit,
                expiry_date=item.expiry_date,
            )

            saved = await repo.add_pantry_item(pantry_item)
            added.append(saved)

        except Exception as e:
            failed.append(f"{item.name}: {str(e)}")

    return ConfirmItemsResponse(added=added, failed=failed)


@router.post("/undo/{request_id}", response_model=UndoResponse)
async def undo_auto_added(request_id: str) -> UndoResponse:
    """
    Undo auto-added items from a scan.

    Must be called with the request_id from the scan response.
    Only works for items from the same session.
    """
    session = _pending_scans.get(request_id)

    if not session:
        raise HTTPException(status_code=404, detail="Scan session not found or expired")

    repo = await get_repository()
    removed_ids = []

    for item_id in session.auto_added_ids:
        try:
            deleted = await repo.delete_pantry_item(item_id)
            if deleted:
                removed_ids.append(item_id)
        except Exception as e:
            logger.warning(f"Failed to undo item {item_id}: {e}")

    # Remove session
    del _pending_scans[request_id]

    return UndoResponse(
        removed_count=len(removed_ids),
        removed_ids=removed_ids,
    )


@router.get("/ocr-status")
async def ocr_status() -> dict[str, Any]:
    """Check if OCR service is available."""
    ocr = get_ocr_service()
    available = ocr.is_available()

    return {
        "available": available,
        "service": "tesseract" if available else None,
        "message": "OCR ready" if available else "Tesseract not installed",
    }


class PreprocessReceiptRequest(BaseModel):
    """Request model for receipt preprocessing."""

    mode: PreprocessMode = Field(
        default="auto", description="Preprocessing mode: 'auto' (default), 'light', or 'aggressive'"
    )


class PreprocessReceiptResponse(BaseModel):
    """Response from receipt preprocessing."""

    success: bool
    message: str
    original_size: tuple[int, int]
    preprocessed_size: tuple[int, int]
    preprocessing_mode: str
    image_data: str = Field(description="Base64-encoded preprocessed image")


@router.post("/preprocess", response_model=PreprocessReceiptResponse)
async def preprocess_receipt(
    image: UploadFile = File(..., description="Receipt image (PNG, JPEG)"),
    mode: PreprocessMode = "auto",
) -> PreprocessReceiptResponse:
    """
    Preprocess a receipt image for optimal OCR performance.

    This endpoint accepts a receipt image and applies various preprocessing techniques
    to improve OCR accuracy:

    - **Grayscale conversion**: Simplifies image for OCR
    - **Contrast enhancement**: Makes text more readable
    - **Noise reduction**: Removes artifacts and grain
    - **Sharpening**: Improves edge definition
    - **Deskewing**: Corrects rotation (if needed)
    - **Binarization**: Converts to pure black & white

    **Preprocessing Modes:**
    - `auto` (default): Automatically selects preprocessing level based on image quality
    - `light`: Minimal processing for high-quality images (grayscale + contrast)
    - `aggressive`: Full pipeline for challenging images (low quality, poor lighting)

    **Usage:**
    1. Upload an image to this endpoint to preprocess it
    2. Use the returned preprocessed image with the `/scan/receipt` endpoint for better OCR results

    **Returns:**
    - `image_data`: Base64-encoded preprocessed image (PNG format)
    - `preprocessing_mode`: The mode that was applied
    - Image size information and status
    """
    import base64
    import io

    from PIL import Image

    # Validate file type
    if image.content_type not in ["image/png", "image/jpeg", "image/jpg", "image/webp"]:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image type: {image.content_type}. Use PNG, JPEG, or WebP.",
        )

    # Read image data
    image_data = await image.read()

    if len(image_data) == 0:
        raise HTTPException(status_code=400, detail="Empty image file")

    # Get original image size
    try:
        original_image = Image.open(io.BytesIO(image_data))
        original_size = original_image.size
    except Exception as e:
        logger.error(f"Failed to load original image: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid image file: {str(e)}")

    # Get preprocessor
    preprocessor = get_image_preprocessor(mode=mode)

    # Preprocess image
    try:
        preprocessed_bytes = await preprocessor.preprocess(image_data, return_format="bytes")

        # Get preprocessed image size
        preprocessed_image = Image.open(io.BytesIO(preprocessed_bytes))
        preprocessed_size = preprocessed_image.size

        # Encode as base64 for JSON response
        image_base64 = base64.b64encode(preprocessed_bytes).decode("utf-8")

        logger.info(
            f"Preprocessed receipt image: "
            f"mode={mode}, "
            f"original_size={original_size}, "
            f"preprocessed_size={preprocessed_size}"
        )

        return PreprocessReceiptResponse(
            success=True,
            message=f"Image preprocessed successfully using '{mode}' mode",
            original_size=original_size,
            preprocessed_size=preprocessed_size,
            preprocessing_mode=mode,
            image_data=image_base64,
        )

    except ValueError as e:
        logger.error(f"Preprocessing failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected preprocessing error: {e}")
        raise HTTPException(status_code=500, detail=f"Image preprocessing failed: {str(e)}")
