"""Tests for the per-request receipt scan budget (issue #481).

A receipt scan is two AI calls in one HTTP request: vision/OCR (bounded per
attempt by #476) and a structured text parse of the OCR output. Before this
change the parse leg ran on the provider's general ~60s text timeout, times
``AIManager.complete``'s own structured-output retries (up to 2), plus the
Gemini -> Ollama fallback — so the Next.js client's fixed 45s abort
(``nextjs/src/lib/api/scan.ts``, not touched here) always won and the server
kept spending on a result nobody would receive.

These tests guard that:

- the route starts one wall-clock budget before OCR and hands the parse leg
  only what is left;
- the parse leg's ceiling is a single ``asyncio.wait_for`` around the whole
  ``AIManager.complete`` call, so internal retries and provider fallback live
  *inside* the budget rather than multiplying it, and the in-flight call is
  cancelled on expiry;
- an exhausted budget skips the AI call outright instead of starting one;
- a timed-out parse surfaces as a user-safe warning (no provider names —
  #396) rather than a silent "0 items";
- the worst-case arithmetic, using the real ``Settings`` defaults, fits under
  the client's 45s abort.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from bubbly_chef.config import settings
from bubbly_chef.services.scan_budget import RequestBudget
from bubbly_chef.workflows.receipt_ingest import (
    PARSE_TIMEOUT_WARNING,
    parse_receipt_llm,
    run_receipt_ingest,
)
from bubbly_chef.workflows.shared_state import LLMParseResult
from bubbly_chef.workflows.state import WorkflowState

# Markers that must never reach a user-facing warning (#396).
_PROVIDER_MARKERS = ("gemini", "ollama", "model", "exception", "traceback")


# ---------------------------------------------------------------------------
# RequestBudget — pure arithmetic with an injected clock
# ---------------------------------------------------------------------------


class _FakeClock:
    def __init__(self, start: float = 100.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def test_budget_draws_down_as_the_clock_advances() -> None:
    clock = _FakeClock()
    budget = RequestBudget(40.0, clock=clock)

    assert budget.elapsed() == 0.0
    assert budget.remaining() == 40.0
    assert not budget.exhausted

    clock.advance(12.5)
    assert budget.elapsed() == pytest.approx(12.5)
    assert budget.remaining() == pytest.approx(27.5)


def test_budget_remaining_clamps_at_zero_once_exhausted() -> None:
    """Overrun must read as exactly 0, not negative: the parse leg keys off
    "<= 0 means do not start an AI call", and a negative timeout handed to
    ``asyncio.wait_for`` would start-then-cancel a request, spending anyway."""
    clock = _FakeClock()
    budget = RequestBudget(40.0, clock=clock)

    clock.advance(41.0)
    assert budget.remaining() == 0.0
    assert budget.exhausted


def test_budget_rejects_negative_total() -> None:
    with pytest.raises(ValueError):
        RequestBudget(-1.0)


def test_budget_uses_monotonic_clock_by_default() -> None:
    budget = RequestBudget(5.0)
    assert 0.0 <= budget.elapsed() < 1.0
    assert 4.0 < budget.remaining() <= 5.0


# ---------------------------------------------------------------------------
# Worst-case arithmetic, from the real Settings defaults
# ---------------------------------------------------------------------------


def test_worst_case_two_leg_arithmetic_fits_under_client_deadline() -> None:
    """The whole request, both legs, must fit under the Next.js client's fixed
    45s ``SCAN_TIMEOUT_MS`` with transport headroom to spare.

    Uses the *configured* defaults rather than literals so a future change to
    any one knob that breaks the sum fails here, not in production.
    """
    client_abort_seconds = 45.0  # SCAN_TIMEOUT_MS in nextjs/src/lib/api/scan.ts
    transport_headroom_seconds = 5.0  # upload + Vercel -> Railway hop + JSON

    vision_worst_case = (
        (1 + settings.gemini_vision_max_retries) * settings.gemini_vision_timeout_seconds
        + settings.gemini_vision_max_retries * settings.gemini_vision_retry_backoff_seconds
    )
    assert vision_worst_case == pytest.approx(37.0)  # unchanged from #476

    # The parse leg is capped at whatever remains, so the server-side total
    # can never exceed the budget regardless of how the two legs split it.
    parse_worst_case = settings.scan_request_budget_seconds - vision_worst_case
    assert parse_worst_case > 0, "vision alone must not consume the whole budget"

    server_total = vision_worst_case + parse_worst_case
    assert server_total == pytest.approx(settings.scan_request_budget_seconds)
    assert server_total + transport_headroom_seconds <= client_abort_seconds


def test_parse_cap_encloses_internal_retries_rather_than_multiplying() -> None:
    """Regression guard for the hidden ceiling the issue calls out: the parse
    budget is a wall-clock cap around ``AIManager.complete``, so its internal
    structured-output retries (max 2) cannot stack a 60s timeout three times.

    We prove it by handing the node a manager whose ``complete`` never
    returns and measuring the wall clock: it must end at the cap, not at
    ``3 * <provider timeout>``.
    """
    import time

    cap = 0.2
    manager = MagicMock()

    async def _never_returns(**_: Any) -> LLMParseResult:
        await asyncio.sleep(60)  # stands in for provider timeout * retries
        return LLMParseResult()

    manager.complete = _never_returns

    async def _run() -> float:
        state: WorkflowState = {"input_text": "MILK 1.99", "parse_timeout_seconds": cap}
        with patch("bubbly_chef.workflows.receipt_ingest.get_ai_manager", return_value=manager):
            start = time.monotonic()
            await parse_receipt_llm(state)
            return time.monotonic() - start

    elapsed = asyncio.run(_run())
    assert cap <= elapsed < cap + 1.0


# ---------------------------------------------------------------------------
# parse_receipt_llm node — timeout, exhausted, unbounded, and happy paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_parse_times_out_and_cancels_the_in_flight_call() -> None:
    """A parse that overruns its remaining budget must (a) stop at the cap,
    (b) cancel the underlying AI call so nothing keeps spending, and (c)
    report a user-safe warning instead of a silent empty result."""
    cancelled = asyncio.Event()
    manager = MagicMock()

    async def _slow_complete(**_: Any) -> LLMParseResult:
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return LLMParseResult()

    manager.complete = _slow_complete

    state: WorkflowState = {
        "input_text": "MILK 1.99\nEGGS 3.49",
        "parse_timeout_seconds": 0.05,
        "warnings": [],
        "errors": [],
    }
    with patch("bubbly_chef.workflows.receipt_ingest.get_ai_manager", return_value=manager):
        result = await parse_receipt_llm(state)

    assert cancelled.is_set(), "the in-flight AI call must be cancelled on expiry"
    assert result["parsed_items"] == []
    assert "timed out" in (result.get("parse_error") or "")
    assert result["confidence"] == 0.0
    assert result["requires_review"] is True
    assert PARSE_TIMEOUT_WARNING in result["warnings"]
    assert result["errors"], "internal errors list records the timeout for the envelope"
    for marker in _PROVIDER_MARKERS:
        assert marker not in PARSE_TIMEOUT_WARNING.lower()


@pytest.mark.asyncio
async def test_exhausted_budget_skips_the_ai_call_entirely() -> None:
    """If OCR already spent the whole budget, do not start a parse whose
    result the client will never see — the point is to stop wasted spend."""
    manager = MagicMock()
    manager.complete = AsyncMock(return_value=LLMParseResult())

    state: WorkflowState = {"input_text": "MILK 1.99", "parse_timeout_seconds": 0.0}
    with patch("bubbly_chef.workflows.receipt_ingest.get_ai_manager", return_value=manager):
        result = await parse_receipt_llm(state)

    manager.complete.assert_not_awaited()
    assert result["parsed_items"] == []
    assert PARSE_TIMEOUT_WARNING in result["warnings"]


@pytest.mark.asyncio
async def test_parse_within_budget_succeeds_unchanged() -> None:
    """A parse that finishes inside its budget behaves exactly as before."""
    manager = MagicMock()
    manager.complete = AsyncMock(return_value=LLMParseResult(items=[], confidence=0.9))

    state: WorkflowState = {"input_text": "MILK 1.99", "parse_timeout_seconds": 5.0}
    with patch("bubbly_chef.workflows.receipt_ingest.get_ai_manager", return_value=manager):
        result = await parse_receipt_llm(state)

    manager.complete.assert_awaited_once()
    assert result["parse_error"] is None
    assert result["confidence"] == 0.9
    assert PARSE_TIMEOUT_WARNING not in result.get("warnings", [])


@pytest.mark.asyncio
async def test_no_budget_leaves_the_parse_unbounded() -> None:
    """Callers with no upstream leg to draw down (``/v1/ingest`` text path,
    direct ``run_receipt_ingest`` callers) pass ``None`` and keep today's
    unbounded behaviour — this change only budgets the scan request."""
    manager = MagicMock()

    async def _slowish(**_: Any) -> LLMParseResult:
        await asyncio.sleep(0.1)
        return LLMParseResult(confidence=0.8)

    manager.complete = _slowish

    state: WorkflowState = {"input_text": "MILK 1.99"}  # no parse_timeout_seconds key
    with patch("bubbly_chef.workflows.receipt_ingest.get_ai_manager", return_value=manager):
        result = await parse_receipt_llm(state)

    assert result["parse_error"] is None
    assert result["confidence"] == 0.8


@pytest.mark.asyncio
async def test_run_receipt_ingest_threads_budget_into_state() -> None:
    """``run_receipt_ingest(parse_timeout_seconds=...)`` must reach the node
    via workflow state, and a timeout there must reach the envelope as a
    warning the route will forward."""
    manager = MagicMock()

    async def _slow(**_: Any) -> LLMParseResult:
        await asyncio.sleep(30)
        return LLMParseResult()

    manager.complete = _slow

    with patch("bubbly_chef.workflows.receipt_ingest.get_ai_manager", return_value=manager):
        envelope = await run_receipt_ingest(ocr_text="MILK 1.99", parse_timeout_seconds=0.05)

    assert envelope.proposal is not None
    assert envelope.proposal.actions == []
    assert PARSE_TIMEOUT_WARNING in envelope.warnings


# ---------------------------------------------------------------------------
# Dispatcher seam — the remaining budget must survive the hop
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatcher_forwards_parse_budget_to_receipt_ingest() -> None:
    from bubbly_chef.api.ingest_dispatcher import IngestModality, IngestPayload, dispatcher

    run = AsyncMock(return_value=MagicMock())
    with patch("bubbly_chef.workflows.receipt_ingest.run_receipt_ingest", run):
        await dispatcher.dispatch(
            IngestPayload(
                modality=IngestModality.RECEIPT, ocr_text="MILK 1.99", parse_timeout_seconds=12.5
            )
        )

    run.assert_awaited_once_with(ocr_text="MILK 1.99", parse_timeout_seconds=12.5)


@pytest.mark.asyncio
async def test_dispatcher_defaults_parse_budget_to_none() -> None:
    """Existing callers that build a payload without a budget are unchanged."""
    from bubbly_chef.api.ingest_dispatcher import IngestModality, IngestPayload, dispatcher

    run = AsyncMock(return_value=MagicMock())
    with patch("bubbly_chef.workflows.receipt_ingest.run_receipt_ingest", run):
        await dispatcher.dispatch(IngestPayload(modality=IngestModality.RECEIPT, ocr_text="X"))

    run.assert_awaited_once_with(ocr_text="X", parse_timeout_seconds=None)


# ---------------------------------------------------------------------------
# Route — the budget starts before OCR and the parse gets what is left
# ---------------------------------------------------------------------------


@pytest.fixture
def app() -> FastAPI:
    @asynccontextmanager
    async def no_op_lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        yield

    app = FastAPI(lifespan=no_op_lifespan)

    from bubbly_chef.api.auth import get_current_user_id
    from bubbly_chef.api.routes.scan import router

    app.include_router(router)
    app.dependency_overrides[get_current_user_id] = lambda: "test-user"
    return app


def _empty_envelope() -> object:
    from bubbly_chef.models.base import (
        ConfidenceScore,
        Intent,
        NextAction,
        ProposalEnvelope,
        WorkflowStatus,
    )
    from bubbly_chef.models.pantry import PantryProposal

    return ProposalEnvelope[PantryProposal](
        schema_version="1.0.0",
        intent=Intent.PANTRY_UPDATE,
        proposal=PantryProposal(actions=[]),
        assistant_message="",
        confidence=ConfidenceScore(overall=0.0),
        requires_review=True,
        next_action=NextAction.REVIEW_PROPOSAL,
        workflow_status=WorkflowStatus.AWAITING_REVIEW,
    )


async def _post_receipt(app: FastAPI) -> Any:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        return await ac.post(
            "/v1/scan/receipt",
            files={"file": ("receipt.png", b"\x89PNG fake", "image/png")},
        )


@pytest.mark.asyncio
async def test_route_hands_parse_leg_the_remaining_budget(app: FastAPI) -> None:
    """With a fast OCR the parse leg gets (nearly) the whole budget — not a
    static residual sized for the worst-case OCR."""
    ocr = MagicMock()
    ocr.extract_text = AsyncMock(return_value="MILK 1.99")
    dispatch = AsyncMock(return_value=_empty_envelope())

    with (
        patch("bubbly_chef.services.ocr.get_ocr_service", return_value=ocr),
        patch("bubbly_chef.api.ingest_dispatcher.dispatcher.dispatch", dispatch),
    ):
        resp = await _post_receipt(app)

    assert resp.status_code == 200
    payload = dispatch.await_args.args[0]
    assert payload.parse_timeout_seconds is not None
    assert 0 < payload.parse_timeout_seconds <= settings.scan_request_budget_seconds
    # A mocked OCR is instantaneous, so the parse gets essentially everything.
    assert payload.parse_timeout_seconds > settings.scan_request_budget_seconds - 1.0


@pytest.mark.asyncio
async def test_route_budget_clock_starts_before_ocr(app: FastAPI) -> None:
    """OCR time must draw the budget down: simulate a slow OCR by advancing
    the injected clock from inside the OCR mock and check the parse leg is
    handed the *remainder*, not the full budget."""
    clock = _FakeClock()
    ocr_seconds = 30.0

    ocr = MagicMock()

    async def _slow_ocr(_: bytes) -> str:
        clock.advance(ocr_seconds)
        return "MILK 1.99"

    ocr.extract_text = _slow_ocr
    dispatch = AsyncMock(return_value=_empty_envelope())

    def _budget(total: float) -> RequestBudget:
        return RequestBudget(total, clock=clock)

    with (
        patch("bubbly_chef.services.ocr.get_ocr_service", return_value=ocr),
        patch("bubbly_chef.api.ingest_dispatcher.dispatcher.dispatch", dispatch),
        patch("bubbly_chef.api.routes.scan.RequestBudget", side_effect=_budget),
    ):
        resp = await _post_receipt(app)

    assert resp.status_code == 200
    payload = dispatch.await_args.args[0]
    assert payload.parse_timeout_seconds == pytest.approx(
        settings.scan_request_budget_seconds - ocr_seconds
    )


@pytest.mark.asyncio
async def test_route_passes_zero_when_ocr_exhausts_the_budget(app: FastAPI) -> None:
    """Worst case: OCR ate everything. The parse leg is told 0, never a
    negative number, so it skips the AI call rather than start-and-cancel."""
    clock = _FakeClock()
    ocr = MagicMock()

    async def _very_slow_ocr(_: bytes) -> str:
        clock.advance(settings.scan_request_budget_seconds + 5.0)
        return "MILK 1.99"

    ocr.extract_text = _very_slow_ocr
    dispatch = AsyncMock(return_value=_empty_envelope())

    with (
        patch("bubbly_chef.services.ocr.get_ocr_service", return_value=ocr),
        patch("bubbly_chef.api.ingest_dispatcher.dispatcher.dispatch", dispatch),
        patch(
            "bubbly_chef.api.routes.scan.RequestBudget",
            side_effect=lambda total: RequestBudget(total, clock=clock),
        ),
    ):
        resp = await _post_receipt(app)

    assert resp.status_code == 200
    assert dispatch.await_args.args[0].parse_timeout_seconds == 0.0


@pytest.mark.asyncio
async def test_route_end_to_end_timed_out_parse_is_not_silent(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Real dispatcher + real workflow, only the AI manager and OCR mocked:
    a parse that overruns returns 200 with the OCR text intact, zero items,
    and a user-safe warning — no provider detail in the body (#396)."""
    monkeypatch.setattr(settings, "scan_request_budget_seconds", 0.1)

    ocr = MagicMock()
    ocr.extract_text = AsyncMock(return_value="MILK 1.99\nEGGS 3.49")

    manager = MagicMock()

    async def _slow(**_: Any) -> LLMParseResult:
        await asyncio.sleep(30)
        return LLMParseResult()

    manager.complete = _slow

    with (
        patch("bubbly_chef.services.ocr.get_ocr_service", return_value=ocr),
        patch("bubbly_chef.workflows.receipt_ingest.get_ai_manager", return_value=manager),
    ):
        resp = await _post_receipt(app)

    assert resp.status_code == 200
    data = resp.json()
    assert data["ocr_text"] == "MILK 1.99\nEGGS 3.49"
    assert data["total_items"] == 0
    assert PARSE_TIMEOUT_WARNING in data["warnings"]
    body = resp.text.lower()
    for marker in ("gemini", "ollama", "traceback"):
        assert marker not in body
