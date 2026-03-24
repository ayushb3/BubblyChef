"""
Chat API endpoints for the AI-first conversational interface.

This module provides:
- POST /v1/chat: Main chat endpoint for conversational pantry management

These endpoints use the ChatRouterGraph workflow to classify intent
and route appropriately.
"""

import json
import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

from bubbly_chef.models.base import ProposalEnvelope
from bubbly_chef.models.requests import ChatRequest
from bubbly_chef.repository.sqlite import get_repository
from bubbly_chef.workflows.chat_ingest import run_chat_workflow, run_chat_workflow_streaming

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Chat"])


@router.post(
    "/chat",
    response_model=ProposalEnvelope,
    summary="Conversational interface for pantry management",
    responses={
        200: {
            "description": "Successful response with proposal or chat message",
            "content": {
                "application/json": {
                    "examples": {
                        "pantry_update": {
                            "summary": "Pantry update intent",
                            "value": {
                                "request_id": "550e8400-e29b-41d4-a716-446655440000",
                                "workflow_id": "660e8400-e29b-41d4-a716-446655440001",
                                "schema_version": "1.0.0",
                                "intent": "pantry_update",
                                "assistant_message": "I found 2 items. Please review.",
                                "proposal": {
                                    "actions": [
                                        {
                                            "action_type": "add",
                                            "item": {"name": "milk"},
                                            "confidence": 0.9,
                                        }
                                    ]
                                },
                                "confidence": {"overall": 0.85},
                                "requires_review": True,
                                "next_action": "review_proposal",
                            },
                        },
                        "receipt_request": {
                            "summary": "Receipt scan request",
                            "value": {
                                "request_id": "550e8400-e29b-41d4-a716-446655440000",
                                "workflow_id": "660e8400-e29b-41d4-a716-446655440001",
                                "schema_version": "1.0.0",
                                "intent": "receipt_ingest_request",
                                "assistant_message": "Please upload a photo of your receipt.",
                                "proposal": {
                                    "kind": "receipt",
                                    "instructions": "Upload a photo...",
                                    "required_inputs": ["receipt_image"],
                                },
                                "confidence": {"overall": 1.0},
                                "requires_review": False,
                                "next_action": "request_receipt_image",
                            },
                        },
                        "general_chat": {
                            "summary": "General chat response",
                            "value": {
                                "request_id": "550e8400-e29b-41d4-a716-446655440000",
                                "workflow_id": "660e8400-e29b-41d4-a716-446655440001",
                                "schema_version": "1.0.0",
                                "intent": "general_chat",
                                "assistant_message": "I'm happy to help! You can track groceries.",
                                "proposal": None,
                                "confidence": {"overall": 1.0},
                                "requires_review": False,
                                "next_action": "none",
                            },
                        },
                    }
                }
            },
        }
    },
)
async def chat(request: ChatRequest) -> ProposalEnvelope[Any]:
    """
    Main conversational interface for the BubblyChef assistant.

    Send natural language messages to:
    - Add groceries: "I bought milk and eggs"
    - Remove items: "I used all the milk"
    - Request receipt scan: "I want to scan a receipt"
    - Request product lookup: "Scan this barcode"
    - General questions: "How long does cheese last?"

    The system classifies intent and returns an appropriate response:
    - Pantry updates return a proposal with actions to review
    - Ingest requests return handoff instructions for the UI
    - General chat returns a conversational response

    **Response Structure (Output Contract):**
    - `request_id`: Unique ID for this request
    - `workflow_id`: ID for workflow resumption (if paused)
    - `intent`: Classified intent type
    - `assistant_message`: Text to display to user
    - `proposal`: Structured proposal (type depends on intent)
    - `confidence`: Overall and per-item confidence scores
    - `requires_review`: Whether human review is needed
    - `next_action`: Hint for UI (NONE, REVIEW_PROPOSAL, REQUEST_RECEIPT_IMAGE, etc.)
    """
    start_time = datetime.now()
    conversation_id = str(request.conversation_id) if request.conversation_id else None

    logger.info(
        "Chat request received",
        extra={
            "message_preview": request.message[:100],
            "message_length": len(request.message),
            "conversation_id": conversation_id,
            "mode": request.mode,
            "has_pantry_snapshot": request.pantry_snapshot is not None,
        },
    )

    try:
        repo = await get_repository()

        # Load conversation history for context
        history: list[dict[str, Any]] = []
        if conversation_id:
            try:
                history = await repo.get_history(conversation_id, limit=20)
            except Exception as hist_err:
                logger.warning(f"Failed to load conversation history: {hist_err}")

        # Persist the user turn
        if conversation_id:
            try:
                await repo.save_message(
                    conversation_id=conversation_id,
                    role="user",
                    content=request.message,
                )
            except Exception as save_err:
                logger.warning(f"Failed to save user message: {save_err}")

        # Run the chat workflow
        envelope = await run_chat_workflow(
            message=request.message,
            conversation_id=conversation_id,
            mode=request.mode,
            pantry_snapshot=request.pantry_snapshot,
            history=history,
        )

        # Persist the assistant turn
        if conversation_id:
            try:
                await repo.save_message(
                    conversation_id=conversation_id,
                    role="assistant",
                    content=envelope.assistant_message,
                    intent=envelope.intent.value,
                )
            except Exception as save_err:
                logger.warning(f"Failed to save assistant message: {save_err}")

        # Log the interaction
        try:
            await repo.log_ingestion(
                request_id=envelope.request_id,
                intent=envelope.intent.value,
                input_payload={
                    "message": request.message,
                    "conversation_id": conversation_id,
                    "mode": request.mode,
                },
                proposal=envelope.proposal.model_dump() if envelope.proposal else None,
                errors=envelope.errors,
            )
        except Exception as log_error:
            logger.warning(f"Failed to log interaction: {log_error}")

        elapsed = (datetime.now() - start_time).total_seconds()
        logger.info(
            "Chat workflow completed",
            extra={
                "intent": envelope.intent.value,
                "requires_review": envelope.requires_review,
                "next_action": envelope.next_action.value,
                "confidence": envelope.confidence.overall,
                "has_proposal": envelope.proposal is not None,
                "workflow_id": str(envelope.workflow_id),
                "elapsed_seconds": elapsed,
                "warnings_count": len(envelope.warnings) if envelope.warnings else 0,
                "errors_count": len(envelope.errors) if envelope.errors else 0,
            },
        )

        return envelope

    except Exception as e:
        elapsed = (datetime.now() - start_time).total_seconds()
        logger.error(
            "Chat workflow failed",
            extra={
                "error": str(e),
                "error_type": type(e).__name__,
                "elapsed_seconds": elapsed,
                "message_preview": request.message[:100],
            },
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Chat processing failed: {str(e)}",
        )


@router.post(
    "/chat/stream",
    summary="Streaming conversational interface",
    responses={
        200: {
            "description": "SSE stream of chat tokens + final envelope",
            "content": {"text/event-stream": {}},
        }
    },
)
async def chat_stream(request: ChatRequest) -> StreamingResponse:
    """
    Streaming variant of the chat endpoint.

    Returns Server-Sent Events (SSE) with:
    - event: token  -- individual text chunks as they arrive
    - event: done   -- signals text streaming is complete
    - event: envelope -- the full ProposalEnvelope JSON for metadata

    For non-streamable intents (pantry_update, handoffs), the envelope
    is returned as a single chunk without preceding token events.
    """
    conversation_id = str(request.conversation_id) if request.conversation_id else None

    logger.info(
        "Chat stream request received",
        extra={
            "message_preview": request.message[:100],
            "conversation_id": conversation_id,
            "mode": request.mode,
        },
    )

    # Persist user message
    if conversation_id:
        try:
            repo = await get_repository()
            await repo.save_message(
                conversation_id=conversation_id,
                role="user",
                content=request.message,
            )
        except Exception as save_err:
            logger.warning(f"Failed to save user message: {save_err}")

    # Load conversation history
    history: list[dict[str, Any]] = []
    if conversation_id:
        try:
            repo = await get_repository()
            history = await repo.get_history(conversation_id, limit=20)
        except Exception as hist_err:
            logger.warning(f"Failed to load conversation history: {hist_err}")

    async def event_generator():  # type: ignore[return]
        """Generate SSE events from the streaming workflow."""
        assistant_message = ""
        envelope_data: dict[str, Any] | None = None

        try:
            async for chunk_json in run_chat_workflow_streaming(
                message=request.message,
                conversation_id=conversation_id,
                mode=request.mode,
                pantry_snapshot=request.pantry_snapshot,
                history=history,
            ):
                parsed = json.loads(chunk_json)
                event_type = parsed.get("type", "token")

                if event_type == "token":
                    assistant_message += parsed.get("content", "")

                if event_type == "envelope":
                    envelope_data = parsed.get("data", {})

                yield f"event: {event_type}\ndata: {chunk_json}\n\n"

        except Exception as e:
            logger.error(f"Streaming error: {e}", exc_info=True)
            error_event = json.dumps({"type": "error", "message": str(e)})
            yield f"event: error\ndata: {error_event}\n\n"
            return

        # Persist assistant message
        if conversation_id and assistant_message:
            try:
                repo = await get_repository()
                intent_str = (
                    envelope_data.get("intent", "general_chat")
                    if envelope_data
                    else "general_chat"
                )
                await repo.save_message(
                    conversation_id=conversation_id,
                    role="assistant",
                    content=assistant_message,
                    intent=intent_str,
                )
            except Exception as save_err:
                logger.warning(f"Failed to save assistant message: {save_err}")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get(
    "/conversations/{conversation_id}/history",
    summary="Get conversation history",
    responses={
        200: {"description": "List of conversation turns, oldest first"},
    },
)
async def get_conversation_history(
    conversation_id: str,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """
    Retrieve the stored message history for a conversation thread.

    Returns turns oldest-first so the client can restore the UI on page reload.
    """
    repo = await get_repository()
    return await repo.get_history(conversation_id, limit=limit)
