"""Tests for issue #510: a non-timeout receipt parse failure must be
user-visible.

Before this change ``parse_receipt_llm`` wrote a provider-side failure (a
non-structured LLM response, or any other exception from the AI call) only
into ``errors`` — which ``api/routes/scan.py`` never forwards to the client
(that's the #396 fix: raw provider detail must not reach the user). The
result was a 200 with zero items and an empty ``warnings`` list, byte
identical to a receipt that genuinely had nothing to parse.

The fix mirrors the #481/PR #509 timeout path: a provider-free warning is
appended to ``warnings`` (detail stays in ``errors`` for logs), so a scan
that failed to parse is distinguishable from one that succeeded with zero
items.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.workflows.receipt_ingest import (
    PARSE_FAILED_WARNING,
    parse_receipt_llm,
    run_receipt_ingest,
)
from bubbly_chef.workflows.state import WorkflowState

# Markers that must never reach a user-facing warning (#396).
_PROVIDER_MARKERS = ("gemini", "ollama", "model", "exception", "traceback")


@pytest.mark.asyncio
async def test_non_structured_response_surfaces_a_user_safe_warning() -> None:
    """The LLM returning something other than LLMParseResult (e.g. the
    provider handed back plain text) must not be a silent 0-item success."""
    manager = MagicMock()
    manager.complete = AsyncMock(return_value="not a structured result")

    state: WorkflowState = {
        "input_text": "MILK 1.99\nEGGS 3.49",
        "warnings": [],
        "errors": [],
    }
    with patch("bubbly_chef.workflows.receipt_ingest.get_ai_manager", return_value=manager):
        result = await parse_receipt_llm(state)

    assert result["parsed_items"] == []
    assert PARSE_FAILED_WARNING in result["warnings"]
    assert result["errors"], "internal errors list still records the detail for logs"
    for marker in _PROVIDER_MARKERS:
        assert marker not in PARSE_FAILED_WARNING.lower()


@pytest.mark.asyncio
async def test_provider_exception_surfaces_a_user_safe_warning() -> None:
    """A raised exception from the AI call (429, malformed response, etc.)
    must also produce a user-visible warning, not just an internal error."""
    manager = MagicMock()

    async def _boom(**_: Any) -> None:
        raise RuntimeError("gemini 429: rate limited by upstream provider")

    manager.complete = _boom

    state: WorkflowState = {
        "input_text": "MILK 1.99",
        "warnings": [],
        "errors": [],
    }
    with patch("bubbly_chef.workflows.receipt_ingest.get_ai_manager", return_value=manager):
        result = await parse_receipt_llm(state)

    assert result["parsed_items"] == []
    assert PARSE_FAILED_WARNING in result["warnings"]
    assert any("gemini" in e.lower() for e in result["errors"]), (
        "the raw detail must still be recorded internally for logs/debugging"
    )
    for marker in _PROVIDER_MARKERS:
        assert marker not in PARSE_FAILED_WARNING.lower()


@pytest.mark.asyncio
async def test_run_receipt_ingest_forwards_the_failure_warning_to_the_envelope() -> None:
    """The warning must reach the ProposalEnvelope the route forwards to the
    client — not just the raw node-level state."""
    manager = MagicMock()
    manager.complete = AsyncMock(return_value="not structured")

    with patch("bubbly_chef.workflows.receipt_ingest.get_ai_manager", return_value=manager):
        envelope = await run_receipt_ingest(ocr_text="MILK 1.99")

    assert envelope.proposal is not None
    assert envelope.proposal.actions == []
    assert PARSE_FAILED_WARNING in envelope.warnings


@pytest.mark.asyncio
async def test_empty_receipt_text_still_reports_no_warning() -> None:
    """Acceptance criterion: a genuinely empty receipt (empty input text)
    must not start reporting a failure — this behaviour is unchanged."""
    state: WorkflowState = {"input_text": "   ", "warnings": [], "errors": []}

    result = await parse_receipt_llm(state)

    assert result["parsed_items"] == []
    assert result.get("warnings", []) == []
    assert PARSE_FAILED_WARNING not in result.get("warnings", [])
