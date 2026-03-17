"""
Chat API endpoints for the AI-first conversational interface.

This module provides:
- POST /v1/chat: Main chat endpoint for conversational pantry management
- POST /v1/workflows/{workflow_id}/events: Resume paused workflows

These endpoints use the ChatRouterGraph workflow to classify intent
and route appropriately.
"""

import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from bubbly_chef.models.base import Intent, ProposalEnvelope
from bubbly_chef.models.requests import ChatRequest, WorkflowEventRequest
from bubbly_chef.repository.sqlite import get_repository
from bubbly_chef.workflows.chat_ingest import run_chat_workflow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Chat"])


# In-memory workflow state store (TODO: persist to SQLite)
# Maps workflow_id -> workflow state for resumption
_workflow_states: dict[str, dict[str, Any]] = {}


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

        # Store workflow state if it requires future resumption
        if envelope.requires_review:
            _workflow_states[str(envelope.workflow_id)] = {
                "envelope": envelope.model_dump(),
                "request": request.model_dump(),
            }

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
    "/workflows/{workflow_id}/events",
    response_model=ProposalEnvelope,
    summary="Submit events to resume a paused workflow",
    responses={
        200: {"description": "Workflow resumed successfully"},
        404: {"description": "Workflow not found"},
        400: {"description": "Invalid event for workflow state"},
    },
)
async def submit_workflow_event(
    workflow_id: UUID,
    event: WorkflowEventRequest,
) -> ProposalEnvelope[Any]:
    """
    Submit an event to resume a paused workflow.

    Use this endpoint to:
    - Approve a proposal: `event_type: "submit_review", decision: "approve"`
    - Approve with edits: `event_type: "submit_review",
      decision: "approve_with_edits", edits: {...}`
    - Reject a proposal: `event_type: "submit_review", decision: "reject"`
    - Provide clarification: `event_type: "provide_clarification", clarification_response: "..."`
    - Cancel workflow: `event_type: "cancel"`

    **Idempotency:**
    Include `idempotency_key` to prevent duplicate submissions.
    """
    workflow_id_str = str(workflow_id)

    logger.info(
        "Workflow event received",
        extra={
            "workflow_id": workflow_id_str,
            "event_type": event.event_type,
            "decision": getattr(event, "decision", None),
            "has_edits": getattr(event, "edits", None) is not None,
            "idempotency_key": getattr(event, "idempotency_key", None),
        },
    )

    # Check if workflow exists
    if workflow_id_str not in _workflow_states:
        logger.warning(f"Workflow {workflow_id_str} not found")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found or already completed",
        )

    stored_state = _workflow_states[workflow_id_str]

    # TODO: Implement idempotency check using event.idempotency_key

    try:
        if event.event_type == "cancel":
            # Remove workflow from pending state
            del _workflow_states[workflow_id_str]

            # Return a cancelled status envelope
            from bubbly_chef.config import settings
            from bubbly_chef.models.base import ConfidenceScore, NextAction, WorkflowStatus

            return ProposalEnvelope(
                request_id=stored_state["envelope"]["request_id"],
                workflow_id=workflow_id,
                schema_version=settings.schema_version,
                intent=Intent(stored_state["envelope"]["intent"]),
                proposal=None,
                assistant_message="Workflow cancelled.",
                confidence=ConfidenceScore(overall=0.0),
                requires_review=False,
                next_action=NextAction.NONE,
                workflow_status=WorkflowStatus.CANCELLED,
            )

        elif event.event_type == "submit_review":
            if event.decision == "approve":
                logger.info(f"Proposal approved for workflow {workflow_id}")

                envelope_data = stored_state["envelope"]
                del _workflow_states[workflow_id_str]

                from bubbly_chef.config import settings
                from bubbly_chef.models.base import ConfidenceScore, NextAction, WorkflowStatus

                # Apply pantry actions to the database
                applied_count = 0
                failed_count = 0
                apply_errors: list[str] = []
                proposal_data = envelope_data.get("proposal")
                if proposal_data and envelope_data.get("intent") == "pantry_update":
                    actions = proposal_data.get("actions", [])
                    try:
                        repo = await get_repository()
                        (
                            applied_count,
                            failed_count,
                            apply_errors,
                        ) = await repo.apply_pantry_proposal(actions)
                        logger.info(
                            "Pantry proposal applied",
                            extra={
                                "workflow_id": workflow_id_str,
                                "applied": applied_count,
                                "failed": failed_count,
                            },
                        )
                    except Exception as apply_err:
                        logger.error(f"Failed to apply pantry proposal: {apply_err}", exc_info=True)
                        apply_errors.append(str(apply_err))

                success_msg = (
                    f"Added {applied_count} item{'s' if applied_count != 1 else ''} to your pantry!"
                    if applied_count > 0
                    else "Proposal approved! Your pantry has been updated."
                )
                if failed_count > 0:
                    n = failed_count
                    success_msg += f" ({n} item{'s' if n != 1 else ''} could not be added.)"

                return ProposalEnvelope(
                    request_id=envelope_data["request_id"],
                    workflow_id=workflow_id,
                    schema_version=settings.schema_version,
                    intent=Intent(envelope_data["intent"]),
                    proposal=envelope_data.get("proposal"),
                    assistant_message=success_msg,
                    confidence=ConfidenceScore(**envelope_data.get("confidence", {"overall": 1.0})),
                    requires_review=False,
                    next_action=NextAction.NONE,
                    workflow_status=WorkflowStatus.COMPLETED,
                    errors=apply_errors,
                )

            elif event.decision == "approve_with_edits":
                if not event.edits:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="edits field required for approve_with_edits decision",
                    )

                logger.info(f"Proposal approved with edits for workflow {workflow_id}")

                envelope_data = stored_state["envelope"]
                del _workflow_states[workflow_id_str]

                from bubbly_chef.config import settings
                from bubbly_chef.models.base import ConfidenceScore, NextAction, WorkflowStatus

                # Apply the edited proposal (if it contains pantry actions)
                applied_count = 0
                failed_count = 0
                apply_errors_edits: list[str] = []
                if envelope_data.get("intent") == "pantry_update":
                    actions = event.edits.get("actions", [])
                    if actions:
                        try:
                            repo = await get_repository()
                            (
                                applied_count,
                                failed_count,
                                apply_errors_edits,
                            ) = await repo.apply_pantry_proposal(actions)
                        except Exception as apply_err:
                            logger.error(
                                f"Failed to apply edited proposal: {apply_err}",
                                exc_info=True,
                            )
                            apply_errors_edits.append(str(apply_err))

                success_msg = (
                    f"Added {applied_count} item{'s' if applied_count != 1 else ''}"
                    " to your pantry with your changes!"
                    if applied_count > 0
                    else "Proposal approved with your changes!"
                )

                return ProposalEnvelope(
                    request_id=envelope_data["request_id"],
                    workflow_id=workflow_id,
                    schema_version=settings.schema_version,
                    intent=Intent(envelope_data["intent"]),
                    proposal=event.edits,
                    assistant_message=success_msg,
                    confidence=ConfidenceScore(overall=1.0),
                    requires_review=False,
                    next_action=NextAction.NONE,
                    workflow_status=WorkflowStatus.COMPLETED,
                    errors=apply_errors_edits,
                )

            elif event.decision == "reject":
                # Reject and clean up
                logger.info(f"Proposal rejected for workflow {workflow_id}")
                del _workflow_states[workflow_id_str]

                from bubbly_chef.config import settings
                from bubbly_chef.models.base import ConfidenceScore, NextAction, WorkflowStatus

                return ProposalEnvelope(
                    request_id=stored_state["envelope"]["request_id"],
                    workflow_id=workflow_id,
                    schema_version=settings.schema_version,
                    intent=Intent(stored_state["envelope"]["intent"]),
                    proposal=None,
                    assistant_message="Proposal rejected. Let me know if you'd like to try again!",
                    confidence=ConfidenceScore(overall=0.0),
                    requires_review=False,
                    next_action=NextAction.NONE,
                    workflow_status=WorkflowStatus.COMPLETED,
                )

            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid decision: {event.decision}",
                )

        elif event.event_type == "provide_clarification":
            if not event.clarification_response:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="clarification_response required for provide_clarification event",
                )

            # Re-run workflow with clarification as additional context
            original_request = stored_state["request"]
            clarified_message = (
                f"{original_request['message']} (Clarification: {event.clarification_response})"
            )

            envelope = await run_chat_workflow(
                message=clarified_message,
                conversation_id=original_request.get("conversation_id"),
                mode=original_request.get("mode", "text"),
                pantry_snapshot=original_request.get("pantry_snapshot"),
            )

            # Update stored state if still needs review
            if envelope.requires_review:
                _workflow_states[str(envelope.workflow_id)] = {
                    "envelope": envelope.model_dump(),
                    "request": {**original_request, "message": clarified_message},
                }
            else:
                # Clean up old workflow
                del _workflow_states[workflow_id_str]

            return envelope

        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown event type: {event.event_type}",
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Workflow event processing failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Event processing failed: {str(e)}",
        )


@router.get(
    "/workflows/{workflow_id}",
    response_model=ProposalEnvelope,
    summary="Get current state of a workflow",
)
async def get_workflow_state(workflow_id: UUID) -> ProposalEnvelope[Any]:
    """
    Retrieve the current state of a workflow.

    Useful for:
    - Checking if a workflow is still pending review
    - Retrieving proposal details for display
    """
    workflow_id_str = str(workflow_id)

    if workflow_id_str not in _workflow_states:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Workflow {workflow_id} not found"
        )

    stored_state = _workflow_states[workflow_id_str]
    envelope_data = stored_state["envelope"]

    from bubbly_chef.config import settings
    from bubbly_chef.models.base import ConfidenceScore, NextAction, WorkflowStatus

    return ProposalEnvelope(
        request_id=envelope_data["request_id"],
        workflow_id=workflow_id,
        schema_version=settings.schema_version,
        intent=Intent(envelope_data["intent"]),
        proposal=envelope_data.get("proposal"),
        assistant_message=envelope_data.get("assistant_message", ""),
        confidence=ConfidenceScore(**envelope_data.get("confidence", {"overall": 0.0})),
        requires_review=envelope_data.get("requires_review", True),
        next_action=NextAction(envelope_data.get("next_action", "none")),
        workflow_status=WorkflowStatus(envelope_data.get("workflow_status", "awaiting_review")),
        clarifying_questions=envelope_data.get("clarifying_questions", []),
        warnings=envelope_data.get("warnings", []),
        errors=envelope_data.get("errors", []),
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
