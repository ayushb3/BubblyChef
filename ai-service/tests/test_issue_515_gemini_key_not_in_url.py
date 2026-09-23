"""Issue #515 — the Gemini API key was sent as a `?key=...` query param on
every request, so it landed in plaintext in any log of the outgoing request
URL (httpx's own INFO request logging, Railway's platform logs, etc).

Fix: send the key as the `x-goog-api-key` header instead (Google's API
accepts either) and quiet httpx/httpcore's own request logging in main.py as
a second, independent layer against the same class of leak.

Key rotation is out of scope for this PR and stays with Ayush -- the key has
already been exposed in logs and should be rotated after this fix lands.
"""

from __future__ import annotations

import re
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from bubbly_chef.ai.gemini import GeminiProvider

_GEMINI_SOURCE = Path(__file__).parent.parent / "bubbly_chef" / "ai" / "gemini.py"


def _make_provider(**overrides: object) -> GeminiProvider:
    defaults: dict[str, object] = {
        "api_key": "super-secret-test-key",
        "model": "gemini-3.1-flash-lite",
    }
    defaults.update(overrides)
    return GeminiProvider(**defaults)  # type: ignore[arg-type]


def _ok_json_response(text: str = "hello") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.raise_for_status = MagicMock(return_value=None)
    resp.json = MagicMock(
        return_value={"candidates": [{"content": {"parts": [{"text": text}]}}]}
    )
    return resp


def _get_response(status_code: int = 200) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    return resp


class TestApiKeySentAsHeaderNotQueryParam:
    """Direct reproduction: for each request site, the key must be in
    `headers`, and `params` (if present at all) must not carry it."""

    @pytest.mark.asyncio
    async def test_complete_sends_key_as_header(self) -> None:
        provider = _make_provider()
        post = AsyncMock(return_value=_ok_json_response())
        provider._client.post = post  # type: ignore[method-assign]

        await provider.complete(prompt="hi")

        _, kwargs = post.await_args
        assert kwargs["headers"].get("x-goog-api-key") == "super-secret-test-key"
        assert "super-secret-test-key" not in str(kwargs.get("params", {}))
        assert "key" not in kwargs.get("params", {})

    @pytest.mark.asyncio
    async def test_complete_with_tools_sends_key_as_header(self) -> None:
        provider = _make_provider()
        post = AsyncMock(
            return_value=MagicMock(
                spec=httpx.Response,
                raise_for_status=MagicMock(return_value=None),
                json=MagicMock(
                    return_value={"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}
                ),
            )
        )
        provider._client.post = post  # type: ignore[method-assign]

        await provider.complete_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            tools=[],
        )

        _, kwargs = post.await_args
        assert kwargs["headers"].get("x-goog-api-key") == "super-secret-test-key"
        assert "super-secret-test-key" not in str(kwargs.get("params", {}))

    @pytest.mark.asyncio
    async def test_vision_complete_sends_key_as_header(self) -> None:
        provider = _make_provider()
        post = AsyncMock(return_value=_ok_json_response("MILK 1.99"))
        provider._client.post = post  # type: ignore[method-assign]

        await provider.vision_complete(prompt="extract text", image_bytes=b"fake")

        _, kwargs = post.await_args
        assert kwargs["headers"].get("x-goog-api-key") == "super-secret-test-key"
        assert "super-secret-test-key" not in str(kwargs.get("params", {}))

    @pytest.mark.asyncio
    async def test_is_available_sends_key_as_header(self) -> None:
        provider = _make_provider()
        get = AsyncMock(return_value=_get_response(200))
        provider._client.get = get  # type: ignore[method-assign]

        result = await provider.is_available()

        assert result is True
        _, kwargs = get.await_args
        assert kwargs["headers"].get("x-goog-api-key") == "super-secret-test-key"
        assert "super-secret-test-key" not in str(kwargs.get("params", {}))


class TestNoKeyLeftInAnyQueryParam:
    """Source-level regression guard covering every request site, including
    stream_complete (its `async with self._client.stream(...)` context
    manager isn't easily mocked the way the plain post()/get() calls above
    are). Fails before the fix -- `params={"key": self.api_key}` is grep-able
    on main -- and passes after."""

    def test_no_call_site_puts_key_in_params(self) -> None:
        source = _GEMINI_SOURCE.read_text(encoding="utf-8")
        assert '"key": self.api_key' not in source
        assert "'key': self.api_key" not in source

    def test_every_request_call_site_sends_auth_headers(self) -> None:
        source = _GEMINI_SOURCE.read_text(encoding="utf-8")
        # Every outgoing request (post/get/stream) in this file must carry
        # the auth header. Five call sites as of #515: complete,
        # complete_with_tools, vision_complete, stream_complete, is_available.
        assert len(re.findall(r"headers=self\._auth_headers", source)) >= 5
