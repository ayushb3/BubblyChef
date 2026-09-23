"""Issue #515 — the Gemini API key was sent as a `?key=...` query param on
every request, so it landed in plaintext in any log of the outgoing request
URL (httpx's own INFO request logging, Railway's platform logs, etc).

Fix: send the key as the `x-goog-api-key` header instead (Google's API
accepts either) and quiet httpx/httpcore's own request logging in main.py as
a second, independent layer against the same class of leak.

Key rotation is out of scope for this PR and stays with Ayush -- the key has
already been exposed in logs and should be rotated after this fix lands.

Two groups of tests:

- `TestApiKeySentAsHeaderForEveryRequestSite` uses `httpx.MockTransport` for
  all five request sites, including `stream_complete` (whose
  `async with self._client.stream(...)` context manager the review on #602
  correctly flagged as untested by the original kwargs-mocking approach).
  Each asserts the header carries the key and the URL the transport actually
  received does not.
- `TestNoKeyInLogsAcrossARealRequestPath` implements issue #515's step 3
  directly: a `caplog`-based test that runs a real request through the
  `httpx`/`httpcore` logging path (bypassing the production WARNING
  suppression on purpose, to prove the fix holds even if that second layer
  is ever loosened) and asserts the key is absent from every captured log
  record. A second test pins the `main.py` suppression itself.
"""

from __future__ import annotations

import logging

import httpx
import pytest

from bubbly_chef.ai.gemini import GeminiProvider

_TEST_KEY = "super-secret-test-key"


def _make_provider(**overrides: object) -> GeminiProvider:
    defaults: dict[str, object] = {
        "api_key": _TEST_KEY,
        "model": "gemini-3.1-flash-lite",
    }
    defaults.update(overrides)
    return GeminiProvider(**defaults)  # type: ignore[arg-type]


def _inject_transport(provider: GeminiProvider, handler: object) -> None:
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))  # type: ignore[arg-type]


def _ok_json_response(text: str = "hello") -> httpx.Response:
    return httpx.Response(
        200,
        json={"candidates": [{"content": {"parts": [{"text": text}]}}]},
    )


class TestApiKeySentAsHeaderForEveryRequestSite:
    """MockTransport-backed behavioural tests for all five request sites —
    replaces the brittle source-grep regression guard from the first version
    of this PR (flagged on review: `>= 5` passes even if a sixth unauthenticated
    site is added, and the string check misses other spellings)."""

    @pytest.mark.asyncio
    async def test_complete_sends_key_as_header_not_url(self) -> None:
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["headers"] = request.headers
            return _ok_json_response()

        provider = _make_provider()
        _inject_transport(provider, handler)

        await provider.complete(prompt="hi")

        assert _TEST_KEY not in str(captured["url"])
        assert captured["headers"]["x-goog-api-key"] == _TEST_KEY  # type: ignore[index]

    @pytest.mark.asyncio
    async def test_complete_with_tools_sends_key_as_header_not_url(self) -> None:
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["headers"] = request.headers
            return _ok_json_response("ok")

        provider = _make_provider()
        _inject_transport(provider, handler)

        await provider.complete_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            tools=[],
        )

        assert _TEST_KEY not in str(captured["url"])
        assert captured["headers"]["x-goog-api-key"] == _TEST_KEY  # type: ignore[index]

    @pytest.mark.asyncio
    async def test_vision_complete_sends_key_as_header_not_url(self) -> None:
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["headers"] = request.headers
            return _ok_json_response("MILK 1.99")

        provider = _make_provider()
        _inject_transport(provider, handler)

        await provider.vision_complete(prompt="extract text", image_bytes=b"fake")

        assert _TEST_KEY not in str(captured["url"])
        assert captured["headers"]["x-goog-api-key"] == _TEST_KEY  # type: ignore[index]

    @pytest.mark.asyncio
    async def test_stream_complete_sends_key_as_header_not_url(self) -> None:
        """stream_complete uses `async with self._client.stream(...)`, not a
        plain post() -- the one site the original AsyncMock-based tests
        couldn't reach. MockTransport handles it the same as any other
        request; only the response body needs to look like an SSE stream."""
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["headers"] = request.headers
            body = b'data: {"candidates": [{"content": {"parts": [{"text": "hi"}]}}]}\n\n'
            return httpx.Response(200, content=body)

        provider = _make_provider()
        _inject_transport(provider, handler)

        chunks = [chunk async for chunk in provider.stream_complete(prompt="hi")]

        assert chunks == ["hi"]
        assert _TEST_KEY not in str(captured["url"])
        assert captured["headers"]["x-goog-api-key"] == _TEST_KEY  # type: ignore[index]
        # 'alt=sse' is not secret and stays a query param.
        assert "alt=sse" in str(captured["url"])

    @pytest.mark.asyncio
    async def test_is_available_sends_key_as_header_not_url(self) -> None:
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["headers"] = request.headers
            return httpx.Response(200, json={})

        provider = _make_provider()
        _inject_transport(provider, handler)

        result = await provider.is_available()

        assert result is True
        assert _TEST_KEY not in str(captured["url"])
        assert captured["headers"]["x-goog-api-key"] == _TEST_KEY  # type: ignore[index]


class TestNoKeyInLogsAcrossARealRequestPath:
    """Issue #515 step 3: capture log output across a real request and
    assert the key never appears in it."""

    @pytest.mark.asyncio
    async def test_key_absent_from_every_log_record_during_a_real_request(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Force httpx/httpcore's own request logging to DEBUG -- the
        opposite of what main.py does in production -- so this proves the
        fix holds on the header/URL split itself, independent of (and in
        addition to) the WARNING suppression covered by the next test. If
        the key were still in the URL, httpx's INFO "HTTP Request: ..." log
        line would contain it; forcing DEBUG also exercises httpcore's more
        verbose connection/header logging."""
        provider = _make_provider()

        def handler(request: httpx.Request) -> httpx.Response:
            return _ok_json_response()

        _inject_transport(provider, handler)

        with caplog.at_level(logging.DEBUG, logger="httpx"), caplog.at_level(
            logging.DEBUG, logger="httpcore"
        ):
            await provider.complete(prompt="hi")

        assert caplog.records, (
            "expected httpx/httpcore to emit at least one log record at DEBUG "
            "-- if this is empty the test isn't exercising real request logging"
        )
        for record in caplog.records:
            message = record.getMessage()
            assert _TEST_KEY not in message, (
                f"API key leaked into a log record: {record.name} — {message!r}"
            )

    def test_main_quiets_httpx_and_httpcore_loggers(self) -> None:
        """Pins the two setLevel(WARNING) lines in main.py -- without them,
        this test fails, and it's the only test that would notice if they
        were ever deleted or reverted to INFO."""
        import importlib

        import bubbly_chef.main as main_module

        importlib.reload(main_module)

        assert logging.getLogger("httpx").level == logging.WARNING
        assert logging.getLogger("httpcore").level == logging.WARNING

    @pytest.mark.asyncio
    async def test_no_log_records_at_all_under_production_logging_config(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """With the production config actually applied (httpx/httpcore at
        WARNING, as main.py sets), a normal 200 request must produce zero
        httpx/httpcore log records -- the second, independent layer against
        the same class of leak."""
        import bubbly_chef.main  # noqa: F401 -- applies the setLevel(WARNING) calls

        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("httpcore").setLevel(logging.WARNING)

        provider = _make_provider()

        def handler(request: httpx.Request) -> httpx.Response:
            return _ok_json_response()

        _inject_transport(provider, handler)

        with caplog.at_level(logging.DEBUG):
            await provider.complete(prompt="hi")

        httpx_records = [r for r in caplog.records if r.name in ("httpx", "httpcore")]
        assert httpx_records == []
