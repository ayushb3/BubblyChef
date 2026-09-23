"""Tests for GeminiProvider's HTTP error → ProviderFailureKind classification
(issue #514).

``_classify_http_error`` and the retry/raise sites in ``ai/gemini.py`` are
what feed ``ProviderUnavailableError.kind`` — everything downstream (chat
messages, /health/ai) depends on this being right at the source.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from bubbly_chef.ai.gemini import GeminiProvider, _classify_http_error
from bubbly_chef.ai.provider import ProviderUnavailableError


def _make_provider(**overrides: object) -> GeminiProvider:
    defaults: dict[str, object] = {
        "api_key": "test-key",
        "model": "gemini-3.1-flash-lite",
    }
    defaults.update(overrides)
    return GeminiProvider(**defaults)  # type: ignore[arg-type]


def _http_error(status_code: int, body: str) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://example.test")
    response = httpx.Response(status_code=status_code, text=body, request=request)
    return httpx.HTTPStatusError(f"{status_code} error", request=request, response=response)


# ---------------------------------------------------------------------------
# _classify_http_error unit coverage
# ---------------------------------------------------------------------------


class TestClassifyHttpError:
    def test_429_with_per_minute_quota_id_is_rate_limited(self) -> None:
        # Real Gemini free-tier per-minute throttle: RESOURCE_EXHAUSTED status
        # and "quota"/"billing details" in the message, same as a daily cap.
        # Only the quotaId detail tells them apart.
        body = (
            '{"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", '
            '"message": "You exceeded your current quota, please check your '
            'plan and billing details.", "details": [{'
            '"@type": "type.googleapis.com/google.rpc.QuotaFailure", '
            '"violations": [{'
            '"quotaMetric": "generativelanguage.googleapis.com/generate_requests_per_model", '
            '"quotaId": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"'
            "}]}]}}"
        )
        assert _classify_http_error(429, body) == "rate_limited"

    def test_429_with_per_day_quota_id_is_quota_exhausted(self) -> None:
        # Same RESOURCE_EXHAUSTED status and message as the per-minute case
        # above — only quotaId ("PerDay" vs "PerMinute") differs.
        body = (
            '{"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", '
            '"message": "You exceeded your current quota, please check your '
            'plan and billing details.", "details": [{'
            '"@type": "type.googleapis.com/google.rpc.QuotaFailure", '
            '"violations": [{'
            '"quotaMetric": "generativelanguage.googleapis.com/generate_requests_per_model", '
            '"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"'
            "}]}]}}"
        )
        assert _classify_http_error(429, body) == "quota_exhausted"

    def test_plain_429_with_no_quota_id_is_rate_limited(self) -> None:
        # No QuotaFailure detail at all — the real Gemini "exceeded your
        # current quota ... billing details" message shows up on both a
        # per-minute throttle and a daily/spend cap, so it must NOT default
        # to quota_exhausted just because "quota"/"billing"/
        # "RESOURCE_EXHAUSTED" appear in the body.
        body = (
            '{"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", '
            '"message": "You exceeded your current quota, please check your '
            'plan and billing details."}}'
        )
        assert _classify_http_error(429, body) == "rate_limited"

    def test_401_is_auth(self) -> None:
        assert _classify_http_error(401, "unauthenticated") == "auth"

    def test_403_is_auth(self) -> None:
        assert _classify_http_error(403, "permission denied") == "auth"

    def test_404_is_model_not_found(self) -> None:
        assert _classify_http_error(404, "model not found") == "model_not_found"

    def test_400_is_bad_request(self) -> None:
        assert _classify_http_error(400, "invalid argument") == "bad_request"

    def test_400_with_api_key_invalid_reason_is_auth(self) -> None:
        # A missing/revoked Gemini API key comes back as HTTP 400
        # INVALID_ARGUMENT with reason API_KEY_INVALID, not 401/403 — the
        # most common real-world auth failure. Must not land in the generic
        # bad_request bucket.
        body = (
            '{"error": {"code": 400, "message": "API key not valid. Please pass a '
            'valid API key.", "status": "INVALID_ARGUMENT", "details": [{'
            '"@type": "type.googleapis.com/google.rpc.ErrorInfo", '
            '"reason": "API_KEY_INVALID"}]}}'
        )
        assert _classify_http_error(400, body) == "auth"

    def test_400_with_bare_api_key_not_valid_message_is_auth(self) -> None:
        assert _classify_http_error(400, "API key not valid") == "auth"

    def test_5xx_is_overloaded(self) -> None:
        for status in (500, 502, 503, 504):
            assert _classify_http_error(status, "internal error") == "overloaded"


# ---------------------------------------------------------------------------
# complete() raise sites carry the classified kind
# ---------------------------------------------------------------------------


class TestCompleteRaisesClassifiedKind:
    @pytest.mark.asyncio
    async def test_quota_429_sets_kind_quota_exhausted(self) -> None:
        provider = _make_provider()
        body = (
            '{"error": {"status": "RESOURCE_EXHAUSTED", "details": [{'
            '"@type": "type.googleapis.com/google.rpc.QuotaFailure", '
            '"violations": [{'
            '"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"'
            "}]}]}}"
        )
        error = _http_error(429, body)
        response = MagicMock()
        response.raise_for_status = MagicMock(side_effect=error)
        provider._client.post = AsyncMock(return_value=response)  # type: ignore[method-assign]

        with pytest.raises(ProviderUnavailableError) as exc_info:
            await provider.complete(prompt="hi")

        assert exc_info.value.kind == "quota_exhausted"
        assert exc_info.value.status_code == 429

    @pytest.mark.asyncio
    async def test_per_minute_429_sets_kind_rate_limited(self) -> None:
        provider = _make_provider()
        body = (
            '{"error": {"status": "RESOURCE_EXHAUSTED", "message": '
            '"You exceeded your current quota, please check your plan and '
            'billing details.", "details": [{'
            '"@type": "type.googleapis.com/google.rpc.QuotaFailure", '
            '"violations": [{'
            '"quotaId": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"'
            "}]}]}}"
        )
        error = _http_error(429, body)
        response = MagicMock()
        response.raise_for_status = MagicMock(side_effect=error)
        provider._client.post = AsyncMock(return_value=response)  # type: ignore[method-assign]

        with pytest.raises(ProviderUnavailableError) as exc_info:
            await provider.complete(prompt="hi")

        assert exc_info.value.kind == "rate_limited"
        assert exc_info.value.status_code == 429

    @pytest.mark.asyncio
    async def test_auth_401_sets_kind_auth(self) -> None:
        provider = _make_provider()
        error = _http_error(401, "unauthenticated")
        response = MagicMock()
        response.raise_for_status = MagicMock(side_effect=error)
        provider._client.post = AsyncMock(return_value=response)  # type: ignore[method-assign]

        with pytest.raises(ProviderUnavailableError) as exc_info:
            await provider.complete(prompt="hi")

        assert exc_info.value.kind == "auth"
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_timeout_sets_kind_timeout(self) -> None:
        provider = _make_provider()
        provider._client.post = AsyncMock(  # type: ignore[method-assign]
            side_effect=httpx.TimeoutException("timed out")
        )

        with pytest.raises(ProviderUnavailableError) as exc_info:
            await provider.complete(prompt="hi")

        assert exc_info.value.kind == "timeout"

    @pytest.mark.asyncio
    async def test_connection_error_sets_kind_network(self) -> None:
        provider = _make_provider()
        provider._client.post = AsyncMock(  # type: ignore[method-assign]
            side_effect=httpx.ConnectError("connection refused")
        )

        with pytest.raises(ProviderUnavailableError) as exc_info:
            await provider.complete(prompt="hi")

        assert exc_info.value.kind == "network"


# ---------------------------------------------------------------------------
# vision_complete: same classification, on the (non-retried) failure path
# ---------------------------------------------------------------------------


class TestVisionCompleteRaisesClassifiedKind:
    @pytest.mark.asyncio
    async def test_5xx_overload_sets_kind_overloaded_after_retries_exhausted(self) -> None:
        provider = _make_provider(vision_max_retries=0)
        error = _http_error(500, "internal error")
        response = MagicMock()
        response.raise_for_status = MagicMock(side_effect=error)
        provider._client.post = AsyncMock(return_value=response)  # type: ignore[method-assign]

        with pytest.raises(ProviderUnavailableError) as exc_info:
            await provider.vision_complete(prompt="extract text", image_bytes=b"fake")

        assert exc_info.value.kind == "overloaded"

    @pytest.mark.asyncio
    async def test_404_model_not_found(self) -> None:
        provider = _make_provider(vision_max_retries=0)
        error = _http_error(404, "model not found")
        response = MagicMock()
        response.raise_for_status = MagicMock(side_effect=error)
        provider._client.post = AsyncMock(return_value=response)  # type: ignore[method-assign]

        with pytest.raises(ProviderUnavailableError) as exc_info:
            await provider.vision_complete(prompt="extract text", image_bytes=b"fake")

        assert exc_info.value.kind == "model_not_found"

    @pytest.mark.asyncio
    async def test_quota_id_past_500_char_truncation_still_classifies(self) -> None:
        # Regression: classification must use the full response body, not
        # the 500-char prefix used for the display message — a long
        # preceding "message" field can push the QuotaFailure detail (and
        # its quotaId) past that prefix.
        provider = _make_provider(vision_max_retries=0)
        padding = "x" * 600
        body = (
            '{"error": {"status": "RESOURCE_EXHAUSTED", "message": "'
            + padding
            + '", "details": [{'
            '"@type": "type.googleapis.com/google.rpc.QuotaFailure", '
            '"violations": [{'
            '"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"'
            "}]}]}}"
        )
        error = _http_error(429, body)
        response = MagicMock()
        response.raise_for_status = MagicMock(side_effect=error)
        provider._client.post = AsyncMock(return_value=response)  # type: ignore[method-assign]

        with pytest.raises(ProviderUnavailableError) as exc_info:
            await provider.vision_complete(prompt="extract text", image_bytes=b"fake")

        assert exc_info.value.kind == "quota_exhausted"
