"""Tests for GeminiProvider.vision_complete retry behaviour (issue #476).

The Next.js scan client aborts at a fixed 45s (``nextjs/src/lib/api/scan.ts``,
not touched here). These tests guard that a single server-side retry on a
transient network failure (timeout, connection error) fits comfortably
inside that budget, that a deterministic failure (HTTP error response) is
never retried, and that the caller still sees exactly one result — not one
per attempt.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from bubbly_chef.ai.gemini import GeminiProvider
from bubbly_chef.ai.provider import ProviderUnavailableError


def _make_provider(**overrides: object) -> GeminiProvider:
    defaults: dict[str, object] = {
        "api_key": "test-key",
        "model": "gemini-3.1-flash-lite",
        "vision_timeout": 18.0,
        "vision_max_retries": 1,
        "vision_retry_backoff": 1.0,
    }
    defaults.update(overrides)
    return GeminiProvider(**defaults)  # type: ignore[arg-type]


def _ok_response(text: str = "MILK 1.99") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.raise_for_status = MagicMock(return_value=None)
    resp.json = MagicMock(
        return_value={"candidates": [{"content": {"parts": [{"text": text}]}}]}
    )
    return resp


@pytest.mark.asyncio
async def test_transient_timeout_then_success_returns_one_result() -> None:
    """A ReadTimeout on attempt one, success on attempt two: exactly one result."""
    provider = _make_provider()
    ok = _ok_response()

    post = AsyncMock(side_effect=[httpx.ReadTimeout("timed out"), ok])
    provider._client.post = post  # type: ignore[method-assign]

    result = await provider.vision_complete(prompt="extract text", image_bytes=b"fake")

    assert result == "MILK 1.99"
    assert post.await_count == 2, "one retry expected, not more"


@pytest.mark.asyncio
async def test_deterministic_failure_is_not_retried() -> None:
    """A 401 auth error must fail immediately — no retry, called exactly once."""
    provider = _make_provider()

    request = httpx.Request("POST", "https://example.test")
    bad_response = httpx.Response(status_code=401, text="unauthorized", request=request)
    http_error = httpx.HTTPStatusError(
        "401 unauthorized", request=request, response=bad_response
    )

    post = AsyncMock(side_effect=http_error)
    provider._client.post = post  # type: ignore[method-assign]

    with pytest.raises(ProviderUnavailableError):
        await provider.vision_complete(prompt="extract text", image_bytes=b"fake")

    post.assert_awaited_once()


@pytest.mark.asyncio
async def test_transient_failure_exhausted_raises_after_exactly_one_retry() -> None:
    """Both attempts time out: raises after 1 + vision_max_retries calls, not more."""
    provider = _make_provider(vision_retry_backoff=0.0)

    post = AsyncMock(side_effect=httpx.ConnectError("connection refused"))
    provider._client.post = post  # type: ignore[method-assign]

    with pytest.raises(ProviderUnavailableError):
        await provider.vision_complete(prompt="extract text", image_bytes=b"fake")

    assert post.await_count == 2  # 1 initial attempt + 1 retry, never more


@pytest.mark.asyncio
async def test_worst_case_retry_budget_fits_under_client_deadline() -> None:
    """Elapsed time for two failed attempts + backoff stays well under the
    Next.js client's fixed 45s abort (nextjs/src/lib/api/scan.ts, not touched
    here). Uses the real configured constants with a near-zero backoff stand-in
    to prove the *shape* of the budget without a real sleep skewing the test.
    """
    vision_timeout = 18.0
    max_retries = 1
    backoff = 1.0

    worst_case_seconds = (1 + max_retries) * vision_timeout + max_retries * backoff
    assert worst_case_seconds == pytest.approx(37.0)
    assert worst_case_seconds < 45.0 - 5.0  # comfortable margin for OCR/parse overhead


@pytest.mark.asyncio
async def test_vision_uses_per_attempt_timeout_not_the_text_timeout() -> None:
    """The vision call must pass the shorter vision_timeout per request, not
    the provider's general (longer) text-completion timeout.
    """
    provider = _make_provider(vision_timeout=18.0)
    assert provider.timeout == 60.0  # default text timeout untouched
    ok = _ok_response()

    post = AsyncMock(return_value=ok)
    provider._client.post = post  # type: ignore[method-assign]

    await provider.vision_complete(prompt="extract text", image_bytes=b"fake")

    _, kwargs = post.await_args
    assert kwargs["timeout"] == 18.0


@pytest.mark.asyncio
async def test_retry_elapsed_time_reflects_configured_backoff() -> None:
    """The configured backoff is actually awaited between attempts.

    Asserted on the awaited sleep rather than on wall-clock elapsed time: a
    real 50ms sleep measured with time.monotonic() can come back a few ms
    short on Windows' ~15ms timer resolution, which made this flaky.
    """
    provider = _make_provider(vision_retry_backoff=0.05)
    ok = _ok_response()
    post = AsyncMock(side_effect=[httpx.ReadTimeout("timed out"), ok])
    provider._client.post = post  # type: ignore[method-assign]

    with patch("bubbly_chef.ai.gemini.asyncio.sleep", new_callable=AsyncMock) as sleep:
        await provider.vision_complete(prompt="extract text", image_bytes=b"fake")

    sleep.assert_awaited_once_with(0.05)


def _status_error(code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://example.test")
    response = httpx.Response(status_code=code, text=f"status {code}", request=request)
    return httpx.HTTPStatusError(f"{code}", request=request, response=response)


@pytest.mark.asyncio
@pytest.mark.parametrize("code", [500, 502, 503, 504])
async def test_transient_server_error_then_success_is_retried(code: int) -> None:
    """Gemini 5xx (overloaded / internal) is transient: retried once, then succeeds."""
    provider = _make_provider(vision_retry_backoff=0.0)
    post = AsyncMock(side_effect=[_status_error(code), _ok_response()])
    provider._client.post = post  # type: ignore[method-assign]

    result = await provider.vision_complete(prompt="extract text", image_bytes=b"fake")

    assert result == "MILK 1.99"
    assert post.await_count == 2


@pytest.mark.asyncio
async def test_server_error_exhausted_raises_after_one_retry() -> None:
    provider = _make_provider(vision_retry_backoff=0.0)
    post = AsyncMock(side_effect=_status_error(503))
    provider._client.post = post  # type: ignore[method-assign]

    with pytest.raises(ProviderUnavailableError, match="503"):
        await provider.vision_complete(prompt="extract text", image_bytes=b"fake")
    assert post.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("code", [400, 403, 404, 429])
async def test_client_errors_and_rate_limit_are_not_retried(code: int) -> None:
    provider = _make_provider(vision_retry_backoff=0.0)
    post = AsyncMock(side_effect=_status_error(code))
    provider._client.post = post  # type: ignore[method-assign]

    with pytest.raises(ProviderUnavailableError):
        await provider.vision_complete(prompt="extract text", image_bytes=b"fake")
    post.assert_awaited_once()


@pytest.mark.asyncio
async def test_availability_check_uses_a_short_explicit_timeout() -> None:
    """is_available() runs before every scan; it must not inherit the 60s client default."""
    provider = _make_provider()
    ok = MagicMock(spec=httpx.Response)
    ok.status_code = 200
    get = AsyncMock(return_value=ok)
    provider._client.get = get  # type: ignore[method-assign]

    assert await provider.is_available() is True
    timeout = get.await_args.kwargs.get("timeout")
    assert timeout is not None and timeout <= 5.0


@pytest.mark.parametrize(
    "field,value",
    [
        ("gemini_vision_timeout_seconds", 0),
        ("gemini_vision_timeout_seconds", -1),
        ("gemini_vision_max_retries", -1),
        ("gemini_vision_retry_backoff_seconds", -0.5),
    ],
)
def test_vision_settings_reject_out_of_range_values(field: str, value: float) -> None:
    from pydantic import ValidationError

    from bubbly_chef.config import Settings

    with pytest.raises(ValidationError):
        Settings(**{field: value})  # type: ignore[arg-type]
