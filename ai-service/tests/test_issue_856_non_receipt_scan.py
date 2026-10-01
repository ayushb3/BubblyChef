"""Tests for issue #856: a scan of something that is not a receipt must say so.

The receipt parse call (the one that already reads the OCR text) also returns a
document-kind signal, ``is_receipt``. It rides the proposal out through both
``POST /v1/scan/receipt`` and ``POST /v1/ingest``. No extra model call is made,
and a response that omits the field is treated as a receipt (the old behaviour).
All model output here is mocked.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from bubbly_chef.workflows.receipt_ingest import run_receipt_ingest
from bubbly_chef.workflows.state import LLMParsedItem, LLMParseResult

RECEIPT_TEXT = "TRADER JOES\nMILK 1.99\nEGGS 3.49\nTOTAL 5.48"
SCREENSHOT_TEXT = "BubblyChef\nPantry\nFresh bread\nExpires in 2 days\nAdd item"


def _manager(result: LLMParseResult) -> MagicMock:
    manager = MagicMock()
    manager.complete = AsyncMock(return_value=result)
    return manager


def _bread(confidence: float = 0.9) -> LLMParsedItem:
    return LLMParsedItem(name="Fresh bread", confidence=confidence, source_line="Fresh bread")


def test_schema_defaults_to_receipt_when_the_model_omits_the_field() -> None:
    """Older / sloppy model output without the field keeps the old behaviour."""
    assert LLMParseResult(items=[]).is_receipt is True
    assert LLMParseResult.model_validate({"items": [], "confidence": 0.7}).is_receipt is True


@pytest.mark.asyncio
async def test_workflow_carries_a_non_receipt_signal_onto_the_proposal() -> None:
    manager = _manager(LLMParseResult(is_receipt=False, items=[_bread()], confidence=0.9))
    with patch("bubbly_chef.workflows.receipt_ingest.get_ai_manager", return_value=manager):
        envelope = await run_receipt_ingest(SCREENSHOT_TEXT)

    assert envelope.proposal is not None
    assert envelope.proposal.is_receipt is False
    # The items are still there: "Use it anyway" needs something to use.
    assert [a.item.name for a in envelope.proposal.actions] == ["Fresh bread"]
    # Same call: parse is one model call, no classifier on top of it.
    assert manager.complete.await_count == 1


@pytest.mark.asyncio
async def test_workflow_marks_a_real_receipt_as_a_receipt() -> None:
    items = [LLMParsedItem(name="Milk", confidence=0.95), LLMParsedItem(name="Eggs", confidence=0.9)]
    manager = _manager(LLMParseResult(is_receipt=True, items=items, confidence=0.9))
    with patch("bubbly_chef.workflows.receipt_ingest.get_ai_manager", return_value=manager):
        envelope = await run_receipt_ingest(RECEIPT_TEXT)

    assert envelope.proposal is not None
    assert envelope.proposal.is_receipt is True


@pytest.mark.asyncio
async def test_failed_parse_is_not_called_a_non_receipt() -> None:
    """A provider failure says nothing about the document, so it must not warn
    'this is not a receipt'."""
    manager = MagicMock()
    manager.complete = AsyncMock(side_effect=RuntimeError("boom"))
    with patch("bubbly_chef.workflows.receipt_ingest.get_ai_manager", return_value=manager):
        envelope = await run_receipt_ingest(RECEIPT_TEXT)

    assert envelope.proposal is not None
    assert envelope.proposal.is_receipt is True


# --- HTTP surfaces ----------------------------------------------------------


def _app(*routers: Any) -> FastAPI:
    @asynccontextmanager
    async def no_op_lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        yield

    app = FastAPI(lifespan=no_op_lifespan)
    for r in routers:
        app.include_router(r)
    from bubbly_chef.api.auth import get_current_user_id

    app.dependency_overrides[get_current_user_id] = lambda: "test-user"
    return app


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("is_receipt", "ocr_text"), [(False, SCREENSHOT_TEXT), (True, RECEIPT_TEXT)]
)
async def test_scan_route_reports_is_receipt(is_receipt: bool, ocr_text: str) -> None:
    from bubbly_chef.api.routes.scan import router

    ocr = MagicMock()
    ocr.extract_text = AsyncMock(return_value=ocr_text)
    manager = _manager(LLMParseResult(is_receipt=is_receipt, items=[_bread()], confidence=0.9))

    async with AsyncClient(
        transport=ASGITransport(app=_app(router)), base_url="http://test"
    ) as ac:
        with (
            patch("bubbly_chef.services.ocr.get_ocr_service", return_value=ocr),
            patch("bubbly_chef.workflows.receipt_ingest.get_ai_manager", return_value=manager),
        ):
            resp = await ac.post(
                "/v1/scan/receipt",
                files={"file": ("scan.png", b"\x89PNG fake", "image/png")},
            )

    assert resp.status_code == 200
    data = resp.json()
    assert data["is_receipt"] is is_receipt
    # The items are returned either way so the user can still use them.
    assert data["total_items"] == 1
    assert manager.complete.await_count == 1


@pytest.mark.asyncio
async def test_scan_route_empty_ocr_does_not_claim_non_receipt() -> None:
    """No text at all already has its own warning; it is not a verdict on the document."""
    from bubbly_chef.api.routes.scan import router

    ocr = MagicMock()
    ocr.extract_text = AsyncMock(return_value="   ")
    async with AsyncClient(
        transport=ASGITransport(app=_app(router)), base_url="http://test"
    ) as ac:
        with patch("bubbly_chef.services.ocr.get_ocr_service", return_value=ocr):
            resp = await ac.post(
                "/v1/scan/receipt",
                files={"file": ("scan.png", b"\x89PNG fake", "image/png")},
            )

    assert resp.status_code == 200
    assert resp.json()["is_receipt"] is True


@pytest.mark.asyncio
async def test_ingest_route_proposal_carries_is_receipt() -> None:
    from bubbly_chef.api.routes.ingest import router

    manager = _manager(LLMParseResult(is_receipt=False, items=[_bread()], confidence=0.9))
    async with AsyncClient(
        transport=ASGITransport(app=_app(router)), base_url="http://test"
    ) as ac:
        with patch("bubbly_chef.workflows.receipt_ingest.get_ai_manager", return_value=manager):
            resp = await ac.post("/v1/ingest", data={"ocr_text": SCREENSHOT_TEXT})

    assert resp.status_code == 200
    assert resp.json()["proposal"]["is_receipt"] is False
