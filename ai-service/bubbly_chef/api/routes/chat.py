"""Chat HTTP routes for the BubblyChef AI microservice.

Exposes four endpoints under /v1/chat:
- POST /v1/chat/stream  — SSE streaming chat
- POST /v1/chat         — Non-streaming fallback
- GET  /v1/chat/history/{conversation_id} — Fetch history
- GET  /v1/chat/sessions — List user's conversation sessions
"""

import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.models.requests import ChatRequest
from bubbly_chef.repository.supabase_repo import get_repository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/chat", tags=["chat"])


@router.post(
    "/stream",
    summary="Streaming chat endpoint (SSE)",
    responses={
        200: {
            "description": "SSE stream of chat tokens + final envelope",
            "content": {"text/event-stream": {}},
        },
        401: {"description": "Missing or invalid JWT"},
    },
)
async def chat_stream(
    request: ChatRequest,
    user_id: str = Depends(get_current_user_id),
) -> StreamingResponse:
    """SSE streaming variant of the chat endpoint.

    Yields Server-Sent Events:
    - event: token    — individual text chunks as they arrive
    - event: done     — signals text streaming complete
    - event: envelope — full structured response JSON
    - event: error    — error payload on failure
    """
    conversation_id = str(request.conversation_id) if request.conversation_id else None

    logger.info(
        f"Chat stream: user={user_id}, conversation_id={conversation_id}, mode={request.mode}"
    )

    # Load conversation history for context BEFORE saving user message
    history: list[dict[str, Any]] = []
    if conversation_id:
        try:
            repo = await get_repository()
            history = await repo.get_history(user_id=user_id, conversation_id=conversation_id)
        except Exception as hist_err:
            logger.warning(f"Failed to load conversation history: {hist_err}")

    # Persist user message after loading history (avoids duplicate in LLM context)
    if conversation_id:
        try:
            repo = await get_repository()
            await repo.save_message(
                user_id=user_id,
                conversation_id=conversation_id,
                role="user",
                content=request.message,
            )
        except Exception as save_err:
            logger.warning(f"Failed to save user message: {save_err}")

    async def event_generator() -> AsyncGenerator[str, None]:
        """Wrap workflow streaming output as SSE events."""
        from bubbly_chef.workflows.router import run_chat_workflow_streaming  # lazy

        assistant_message = ""
        envelope_data: dict[str, Any] | None = None

        try:
            async for chunk_json in run_chat_workflow_streaming(
                message=request.message,
                conversation_id=conversation_id,
                mode=request.mode,
                pantry_snapshot=request.pantry_snapshot,
                history=history,
                user_id=user_id,
                context=request.context,
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
            error_payload = json.dumps({"type": "error", "message": str(e)})
            yield f"event: error\ndata: {error_payload}\n\n"
            return

        # Persist assistant message after stream completes.
        # Fall back to envelope message for non-streaming intents (recipe_card, brainstorm)
        # so they are still saved to history.
        save_content = assistant_message or (
            envelope_data.get("assistant_message", "") if envelope_data else ""
        )
        if conversation_id and save_content:
            try:
                repo = await get_repository()
                intent_str = (
                    envelope_data.get("intent", "general_chat") if envelope_data else "general_chat"
                )
                await repo.save_message(
                    user_id=user_id,
                    conversation_id=conversation_id,
                    role="assistant",
                    content=save_content,
                    intent=intent_str,
                )
                logger.info(
                    f"Saved assistant message: intent={intent_str}, "
                    f"length={len(save_content)}"
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


@router.post(
    "",
    summary="Non-streaming chat (collects full response)",
    responses={
        200: {"description": "Full chat response as JSON"},
        401: {"description": "Missing or invalid JWT"},
    },
)
async def chat_non_streaming(
    request: ChatRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Non-streaming fallback: collects all SSE events and returns the envelope.

    Useful for clients that don't support SSE (e.g., server-side callers).
    """
    conversation_id = str(request.conversation_id) if request.conversation_id else None

    logger.info(f"Chat non-streaming: user={user_id}, conversation_id={conversation_id}")

    # Load history
    history: list[dict[str, Any]] = []
    if conversation_id:
        try:
            repo = await get_repository()
            history = await repo.get_history(user_id=user_id, conversation_id=conversation_id)
        except Exception as hist_err:
            logger.warning(f"Failed to load conversation history: {hist_err}")

    # Collect all events, capture envelope
    envelope_data: dict[str, Any] | None = None
    assistant_message = ""

    try:
        from bubbly_chef.workflows.router import run_chat_workflow_streaming  # lazy

        async for chunk_json in run_chat_workflow_streaming(
            message=request.message,
            conversation_id=conversation_id,
            mode=request.mode,
            pantry_snapshot=request.pantry_snapshot,
            history=history,
            user_id=user_id,
            context=request.context,
        ):
            parsed = json.loads(chunk_json)
            event_type = parsed.get("type", "token")
            if event_type == "token":
                assistant_message += parsed.get("content", "")
            elif event_type == "envelope":
                envelope_data = parsed.get("data", {})
    except Exception as e:
        logger.error(f"Non-streaming workflow error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Chat processing failed: {str(e)}") from e

    if envelope_data is None:
        raise HTTPException(status_code=500, detail="Workflow did not return an envelope")

    # Persist both messages
    if conversation_id:
        try:
            repo = await get_repository()
            await repo.save_message(
                user_id=user_id,
                conversation_id=conversation_id,
                role="user",
                content=request.message,
            )
            save_content = assistant_message or envelope_data.get("assistant_message", "")
            if save_content:
                await repo.save_message(
                    user_id=user_id,
                    conversation_id=conversation_id,
                    role="assistant",
                    content=save_content,
                    intent=envelope_data.get("intent", "general_chat"),
                )
        except Exception as save_err:
            logger.warning(f"Failed to persist messages: {save_err}")

    return envelope_data


@router.get(
    "/history/{conversation_id}",
    summary="Fetch conversation history",
    responses={
        200: {"description": "List of messages ordered by created_at"},
        401: {"description": "Missing or invalid JWT"},
    },
)
async def get_history(
    conversation_id: str,
    user_id: str = Depends(get_current_user_id),
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Return conversation history for a given conversation_id."""
    try:
        repo = await get_repository()
        return await repo.get_history(
            user_id=user_id,
            conversation_id=conversation_id,
            limit=limit,
        )
    except Exception as e:
        logger.error(f"Failed to fetch history: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch conversation history") from e


@router.get(
    "/sessions",
    summary="List user's conversation sessions",
    responses={
        200: {"description": "List of conversation sessions"},
        401: {"description": "Missing or invalid JWT"},
    },
)
async def list_sessions(
    user_id: str = Depends(get_current_user_id),
) -> list[dict[str, Any]]:
    """Return all conversation sessions for the authenticated user."""
    try:
        repo = await get_repository()
        result = (
            repo.client.table("conversation_sessions")
            .select("conversation_id, active_mode, metadata, created_at, updated_at")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .execute()
        )
        return result.data  # type: ignore[return-value]
    except Exception as e:
        logger.error(f"Failed to list sessions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to list sessions") from e
