"""Tests for POST /v1/scan/receipt.

Guards the #204/#207 close-out: the scan route must run OCR itself and then
invoke the receipt ingest *through the unified dispatcher* rather than calling
``run_receipt_ingest`` directly. The route still owns OCR and confidence
bucketing; only the workflow invocation goes through the dispatcher seam.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def app() -> FastAPI:
    @asynccontextmanager
    async def no_op_lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        yield

    app = FastAPI(lifespan=no_op_lifespan)

    from bubbly_chef.api.routes.scan import router

    app.include_router(router)
    return app


@pytest.fixture
def _envelope() -> object:
    from bubbly_chef.models.base import (
        ConfidenceScore,
        Intent,
        NextAction,
        ProposalEnvelope,
        WorkflowStatus,
    )
    from bubbly_chef.models.pantry import (
        ActionType,
        FoodCategory,
        PantryItem,
        PantryProposal,
        PantryUpsertAction,
    )

    action = PantryUpsertAction(
        action_type=ActionType.ADD,
        item=PantryItem(name="milk", quantity=1, unit="carton", category=FoodCategory.DAIRY),
        confidence=0.95,
        source_line="MILK 1.99",
        price=1.99,
    )
    return ProposalEnvelope[PantryProposal](
        schema_version="1.0.0",
        intent=Intent.PANTRY_UPDATE,
        proposal=PantryProposal(actions=[action]),
        assistant_message="1 item found",
        confidence=ConfidenceScore(overall=0.95),
        requires_review=False,
        next_action=NextAction.REVIEW_PROPOSAL,
        workflow_status=WorkflowStatus.AWAITING_REVIEW,
    )


@pytest.mark.asyncio
async def test_scan_receipt_routes_through_dispatcher(app: FastAPI, _envelope: object) -> None:
    """OCR text is dispatched via the dispatcher, and items are bucketed by confidence."""
    from bubbly_chef.api.auth import get_current_user_id

    app.dependency_overrides[get_current_user_id] = lambda: "test-user"

    ocr = MagicMock()
    ocr.extract_text = AsyncMock(return_value="MILK 1.99")

    dispatch = AsyncMock(return_value=_envelope)

    with (
        patch("bubbly_chef.services.ocr.get_ocr_service", return_value=ocr),
        patch("bubbly_chef.api.ingest_dispatcher.dispatcher.dispatch", dispatch),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post(
                "/v1/scan/receipt",
                files={"file": ("receipt.png", b"\x89PNG fake", "image/png")},
            )

    app.dependency_overrides.clear()

    assert resp.status_code == 200
    # The workflow invocation went through the dispatcher, not a direct call.
    dispatch.assert_awaited_once()
    payload = dispatch.await_args.args[0]
    assert payload.ocr_text == "MILK 1.99"

    data = resp.json()
    assert data["total_items"] == 1
    assert len(data["ready_to_add"]) == 1  # confidence 0.95 >= 0.8
    assert data["ready_to_add"][0]["name"] == "milk"


@pytest.mark.asyncio
async def test_scan_receipt_sanitizes_provider_failure(
    app: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    """A raw provider failure (issue #396) must not leak into the response body.

    Regression guard for the leaked string observed in production:
    "Receipt scan failed: No vision-capable provider available. Errors:
    ['gemini/gemini-2.5-flash: Gemini [gemini-2.5-flash] vision connection
    error: ReadTimeout: ']" — none of that (provider name, model id,
    exception class) may appear in the HTTP error body. It must still be
    logged server-side at error level.
    """
    from bubbly_chef.ai.manager import NoProviderAvailableError
    from bubbly_chef.api.auth import get_current_user_id

    app.dependency_overrides[get_current_user_id] = lambda: "test-user"

    internal_detail = (
        "No vision-capable provider available. Errors: "
        "['gemini/gemini-2.5-flash: Gemini [gemini-2.5-flash] vision API error 429: quota']"
    )
    ocr = MagicMock()
    ocr.extract_text = AsyncMock(side_effect=NoProviderAvailableError(internal_detail))

    import logging

    with caplog.at_level(logging.ERROR, logger="bubbly_chef.api.routes.scan"):
        with patch("bubbly_chef.services.ocr.get_ocr_service", return_value=ocr):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/v1/scan/receipt",
                    files={"file": ("receipt.png", b"\x89PNG fake", "image/png")},
                )

    app.dependency_overrides.clear()

    assert resp.status_code == 503
    body = resp.text
    for leaked in ("gemini", "Gemini", "ReadTimeout", "gemini-2.5-flash"):
        assert leaked not in body, f"leaked internal detail {leaked!r} in response body: {body}"

    data = resp.json()
    assert set(data["detail"].keys()) == {"message", "code"}
    assert data["detail"]["code"] == "vision_provider_unavailable"
    assert "gemini" not in data["detail"]["message"].lower()

    # The full internal detail must still land in the server-side logs.
    assert any(internal_detail in record.message for record in caplog.records)


@pytest.mark.asyncio
async def test_scan_receipt_maps_timeout_to_timeout_code(app: FastAPI) -> None:
    """A timeout specifically should surface a distinct, stable code."""
    from bubbly_chef.ai.manager import NoProviderAvailableError
    from bubbly_chef.api.auth import get_current_user_id

    app.dependency_overrides[get_current_user_id] = lambda: "test-user"

    ocr = MagicMock()
    ocr.extract_text = AsyncMock(
        side_effect=NoProviderAvailableError(
            "No vision-capable provider available. Errors: "
            "['gemini/gemini-2.5-flash: Gemini vision connection error: ReadTimeout: ']"
        )
    )

    with patch("bubbly_chef.services.ocr.get_ocr_service", return_value=ocr):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post(
                "/v1/scan/receipt",
                files={"file": ("receipt.png", b"\x89PNG fake", "image/png")},
            )

    app.dependency_overrides.clear()

    assert resp.status_code == 504
    assert resp.json()["detail"]["code"] == "scan_timeout"


@pytest.mark.asyncio
async def test_scan_receipt_maps_unreadable_image_to_422(app: FastAPI) -> None:
    """A corrupt/undecodable image (ValueError from preprocessing) maps to a 422."""
    from bubbly_chef.api.auth import get_current_user_id

    app.dependency_overrides[get_current_user_id] = lambda: "test-user"

    ocr = MagicMock()
    ocr.extract_text = AsyncMock(side_effect=ValueError("Failed to preprocess image: cannot identify"))

    with patch("bubbly_chef.services.ocr.get_ocr_service", return_value=ocr):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post(
                "/v1/scan/receipt",
                files={"file": ("receipt.png", b"\x89PNG fake", "image/png")},
            )

    app.dependency_overrides.clear()

    assert resp.status_code == 422
    body = resp.json()
    assert body["detail"]["code"] == "unreadable_image"
    assert "cannot identify" not in body["detail"]["message"]
