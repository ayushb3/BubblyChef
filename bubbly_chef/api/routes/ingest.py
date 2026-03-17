"""Ingest endpoints for AI-powered parsing."""

import logging

from fastapi import APIRouter, HTTPException

from bubbly_chef.models.base import ProposalEnvelope
from bubbly_chef.models.pantry import PantryProposal
from bubbly_chef.models.recipe import RecipeCardProposal
from bubbly_chef.models.requests import (
    ChatIngestRequest,
    ProductIngestRequest,
    ReceiptIngestRequest,
    RecipeIngestRequest,
)
from bubbly_chef.repository.sqlite import get_repository
from bubbly_chef.workflows import (
    run_chat_ingest,
    run_product_ingest,
    run_receipt_ingest,
    run_recipe_ingest,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Ingest"])


@router.post(
    "/ingest/chat",
    response_model=ProposalEnvelope[PantryProposal],
    summary="Parse free-form text into pantry actions",
)
async def ingest_chat(request: ChatIngestRequest) -> ProposalEnvelope[PantryProposal]:
    """
    Parse free-form chat/voice text into pantry update proposals.

    Examples:
    - "I bought 2 gallons of milk and a dozen eggs"
    - "Used up the last of the bread"
    - "Threw away expired yogurt"

    Returns a proposal with confidence scores that must be reviewed
    before applying.
    """
    logger.info(f"Chat ingest request: {request.text[:100]}...")

    try:
        envelope = await run_chat_ingest(request.text)

        # Log the ingestion
        repo = await get_repository()
        await repo.log_ingestion(
            request_id=envelope.request_id,
            intent=envelope.intent.value,
            input_payload={"text": request.text, "context": request.context},
            proposal=envelope.proposal.model_dump() if envelope.proposal else None,
            errors=envelope.errors,
        )

        logger.info(
            f"Chat ingest completed: {len(envelope.proposal.actions)} actions, "
            f"confidence={envelope.confidence.overall:.2f}, "
            f"requires_review={envelope.requires_review}"
        )

        return envelope

    except Exception as e:
        logger.error(f"Chat ingest failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/ingest/receipt",
    response_model=ProposalEnvelope[PantryProposal],
    summary="Parse receipt OCR text into pantry actions",
)
async def ingest_receipt(request: ReceiptIngestRequest) -> ProposalEnvelope[PantryProposal]:
    """
    Parse OCR-extracted receipt text into pantry update proposals.

    For now, accepts ocr_text directly. Future versions will accept
    an image and perform OCR.

    Returns a proposal with confidence scores that must be reviewed
    before applying.
    """
    logger.info(f"Receipt ingest request: {len(request.ocr_text)} chars")

    try:
        envelope = await run_receipt_ingest(
            ocr_text=request.ocr_text,
            store_name=request.store_name,
            purchase_date=request.purchase_date,
        )

        # Log the ingestion
        repo = await get_repository()
        await repo.log_ingestion(
            request_id=envelope.request_id,
            intent=envelope.intent.value,
            input_payload={
                "ocr_text": request.ocr_text,
                "store_name": request.store_name,
                "purchase_date": request.purchase_date,
            },
            proposal=envelope.proposal.model_dump() if envelope.proposal else None,
            errors=envelope.errors,
        )

        logger.info(
            f"Receipt ingest completed: {len(envelope.proposal.actions)} actions, "
            f"confidence={envelope.confidence.overall:.2f}"
        )

        return envelope

    except Exception as e:
        logger.error(f"Receipt ingest failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/ingest/product",
    response_model=ProposalEnvelope[PantryProposal],
    summary="Parse product barcode or description",
)
async def ingest_product(request: ProductIngestRequest) -> ProposalEnvelope[PantryProposal]:
    """
    Parse a product barcode or description into a pantry item proposal.

    Tries barcode lookup first (OpenFoodFacts stub), then falls back
    to LLM parsing of the description.

    Returns a proposal with confidence scores that must be reviewed
    before applying.
    """
    if not request.barcode and not request.description:
        raise HTTPException(status_code=400, detail="Either barcode or description is required")

    logger.info(
        f"Product ingest request: barcode={request.barcode}, description={request.description}"
    )

    try:
        envelope = await run_product_ingest(
            barcode=request.barcode,
            description=request.description,
            quantity=request.quantity,
            unit=request.unit,
        )

        # Log the ingestion
        repo = await get_repository()
        await repo.log_ingestion(
            request_id=envelope.request_id,
            intent=envelope.intent.value,
            input_payload={
                "barcode": request.barcode,
                "description": request.description,
                "quantity": request.quantity,
                "unit": request.unit,
            },
            proposal=envelope.proposal.model_dump() if envelope.proposal else None,
            errors=envelope.errors,
        )

        logger.info(
            f"Product ingest completed: {len(envelope.proposal.actions)} actions, "
            f"confidence={envelope.confidence.overall:.2f}"
        )

        return envelope

    except Exception as e:
        logger.error(f"Product ingest failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/recipes/ingest",
    response_model=ProposalEnvelope[RecipeCardProposal],
    summary="Parse recipe URL or text into recipe card",
)
async def ingest_recipe(request: RecipeIngestRequest) -> ProposalEnvelope[RecipeCardProposal]:
    """
    Parse a recipe URL or text into a structured recipe card proposal.

    Accepts:
    - A URL to fetch and parse
    - Recipe text/transcript
    - Both (URL text will be used, caption as hint)

    Returns a proposal with confidence scores that must be reviewed
    before applying.
    """
    if not request.url and not request.text:
        raise HTTPException(status_code=400, detail="Either url or text is required")

    logger.info(f"Recipe ingest request: url={request.url}, text_len={len(request.text or '')}")

    try:
        envelope = await run_recipe_ingest(
            url=request.url,
            text=request.text,
            caption=request.caption,
        )

        # Log the ingestion
        repo = await get_repository()
        await repo.log_ingestion(
            request_id=envelope.request_id,
            intent=envelope.intent.value,
            input_payload={
                "url": request.url,
                "text": request.text,
                "caption": request.caption,
            },
            proposal=envelope.proposal.model_dump() if envelope.proposal else None,
            errors=envelope.errors,
        )

        logger.info(
            f"Recipe ingest completed: {envelope.proposal.recipe.title}, "
            f"confidence={envelope.confidence.overall:.2f}"
        )

        return envelope

    except Exception as e:
        logger.error(f"Recipe ingest failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
