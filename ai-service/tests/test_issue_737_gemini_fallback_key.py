"""Tests for the second Gemini key as a fallback provider (issue #737).

On 2026-10-01 the one Gemini key hit its spend cap and chat, scanning and
recipe generation all went down at once. A second key (its own Google project,
its own cap) is registered after the primary and before Ollama, and is tried
only when the primary failed for an *account* reason: quota, auth or rate
limit. Any other failure (a bad request, a timeout) must not burn it.

Everything here uses fake providers and fake keys; Gemini is never called.
"""

import json
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import patch

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from bubbly_chef.ai.gemini import GeminiProvider
from bubbly_chef.ai.manager import ACCOUNT_FAILURE_KINDS, AIManager, NoProviderAvailableError
from bubbly_chef.ai.provider import (
    AIProvider,
    ProviderUnavailableError,
    ToolCallResponse,
)
from bubbly_chef.config import Settings
from bubbly_chef.main import app

PRIMARY_KEY = "AIza-fake-primary-key-0000"
FALLBACK_KEY = "AIza-fake-fallback-key-1111"


class FakeProvider(AIProvider):
    """Scripted provider that records every call, whichever method it was."""

    def __init__(self, name: str, *, fail_kind: str | None = None) -> None:
        self._name = name
        self.fail_kind = fail_kind
        self.calls: list[str] = []

    @property
    def name(self) -> str:
        return self._name

    def _maybe_fail(self, method: str) -> None:
        self.calls.append(method)
        if self.fail_kind is not None:
            raise ProviderUnavailableError(
                f"{self._name} failing",
                kind=self.fail_kind,  # type: ignore[arg-type]
            )

    async def complete(  # type: ignore[override]
        self,
        prompt: str,
        response_schema: Any = None,
        temperature: float = 0.7,
        max_output_tokens: int | None = None,
    ) -> Any:
        self._maybe_fail("complete")
        return f"reply from {self._name}"

    async def vision_complete(  # type: ignore[override]
        self,
        prompt: str,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        response_schema: Any = None,
        temperature: float = 0.3,
        time_remaining: Any = None,
    ) -> Any:
        self._maybe_fail("vision_complete")
        return f"ocr from {self._name}"

    @property
    def supports_vision(self) -> bool:
        return True

    @property
    def supports_tool_calling(self) -> bool:
        return True

    async def complete_with_tools(  # type: ignore[override]
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        temperature: float = 0.7,
    ) -> ToolCallResponse:
        self._maybe_fail("complete_with_tools")
        return ToolCallResponse(text=f"tools from {self._name}")

    async def stream_complete(  # type: ignore[override]
        self, prompt: str, temperature: float = 0.7
    ) -> AsyncIterator[str]:
        self._maybe_fail("stream_complete")
        yield f"stream from {self._name}"

    async def is_available(self) -> bool:
        return True


def _manager(primary_kind: str | None) -> tuple[AIManager, FakeProvider, FakeProvider, FakeProvider]:
    """Primary Gemini, gated fallback Gemini, then Ollama: the production order."""
    primary = FakeProvider("gemini/primary", fail_kind=primary_kind)
    fallback = FakeProvider("gemini/fallback")
    ollama = FakeProvider("ollama/test")
    manager = AIManager()
    manager.add_provider(primary, label="gemini-primary")
    manager.add_provider(
        fallback, label="gemini-fallback", only_after_failure_kinds=ACCOUNT_FAILURE_KINDS
    )
    manager.add_provider(ollama)
    return manager, primary, fallback, ollama


async def _call(manager: AIManager, method: str) -> Any:
    if method == "complete":
        return await manager.complete(prompt="hi")
    if method == "vision_complete":
        return await manager.vision_complete(prompt="read", image_bytes=b"img")
    if method == "complete_with_tools":
        return await manager.complete_with_tools(messages=[], tools=[])
    chunks = [t async for t in manager.stream_complete(prompt="hi")]
    return "".join(chunks)


_METHODS = ["complete", "vision_complete", "complete_with_tools", "stream_complete"]


class TestFallbackOnAccountFailures:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("method", _METHODS)
    @pytest.mark.parametrize("kind", ["quota_exhausted", "auth", "rate_limited"])
    async def test_fallback_key_answers_when_primary_has_an_account_failure(
        self, method: str, kind: str
    ) -> None:
        manager, primary, fallback, ollama = _manager(kind)

        result = await _call(manager, method)

        assert "gemini/fallback" in str(getattr(result, "text", result))
        assert primary.calls == [method]
        assert fallback.calls == [method]
        assert ollama.calls == []
        assert manager.current_provider is fallback or method == "stream_complete"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("method", _METHODS)
    async def test_healthy_primary_never_touches_the_fallback(self, method: str) -> None:
        manager, primary, fallback, _ = _manager(None)

        await _call(manager, method)

        assert primary.calls == [method]
        assert fallback.calls == []


class TestFallbackIsNotBurnedByOtherErrors:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("method", _METHODS)
    @pytest.mark.parametrize(
        "kind", ["bad_request", "timeout", "network", "overloaded", "model_not_found", "unknown"]
    )
    async def test_other_primary_failures_skip_the_fallback_and_reach_ollama(
        self, method: str, kind: str
    ) -> None:
        manager, primary, fallback, ollama = _manager(kind)

        result = await _call(manager, method)

        assert "ollama/test" in str(getattr(result, "text", result))
        assert fallback.calls == []
        assert ollama.calls == [method]

    @pytest.mark.asyncio
    async def test_a_bad_request_everywhere_still_fails_with_its_kind(self) -> None:
        primary = FakeProvider("gemini/primary", fail_kind="bad_request")
        fallback = FakeProvider("gemini/fallback")
        manager = AIManager()
        manager.add_provider(primary)
        manager.add_provider(fallback, only_after_failure_kinds=ACCOUNT_FAILURE_KINDS)

        with pytest.raises(NoProviderAvailableError) as exc_info:
            await manager.complete(prompt="hi")

        assert exc_info.value.kind == "bad_request"
        assert fallback.calls == []

    @pytest.mark.asyncio
    async def test_both_keys_spent_reports_the_quota_kind(self) -> None:
        primary = FakeProvider("gemini/primary", fail_kind="quota_exhausted")
        fallback = FakeProvider("gemini/fallback", fail_kind="quota_exhausted")
        manager = AIManager()
        manager.add_provider(primary)
        manager.add_provider(fallback, only_after_failure_kinds=ACCOUNT_FAILURE_KINDS)

        with pytest.raises(NoProviderAvailableError) as exc_info:
            await manager.complete(prompt="hi")

        assert exc_info.value.kind == "quota_exhausted"
        assert primary.calls == ["complete"]
        assert fallback.calls == ["complete"]


class TestKeyUnsetBehaviourUnchanged:
    @pytest.mark.asyncio
    async def test_without_a_fallback_the_cascade_is_primary_then_ollama(self) -> None:
        primary = FakeProvider("gemini/primary", fail_kind="quota_exhausted")
        ollama = FakeProvider("ollama/test")
        manager = AIManager()
        manager.add_provider(primary)
        manager.add_provider(ollama)

        assert await manager.complete(prompt="hi") == "reply from ollama/test"

    def test_settings_default_is_empty(self) -> None:
        assert Settings(_env_file=None).gemini_fallback_api_key == ""  # type: ignore[call-arg]

    def test_deps_registers_no_second_gemini_when_unset(self) -> None:
        manager = _build_manager_from_settings(primary_key=PRIMARY_KEY, fallback_key="")

        gemini = [p for p in manager.providers if isinstance(p, GeminiProvider)]
        assert [p.api_key for p in gemini] == [PRIMARY_KEY]


def _build_manager_from_settings(primary_key: str, fallback_key: str) -> AIManager:
    from bubbly_chef.api import deps
    from bubbly_chef.config import settings

    deps._ai_manager = None
    try:
        with (
            patch.object(settings, "gemini_api_key", primary_key),
            patch.object(settings, "gemini_fallback_api_key", fallback_key),
            patch.object(settings, "use_anthropic_proxy", False),
            patch.object(settings, "ollama_base_url", "http://127.0.0.1:1"),
        ):
            return deps.get_ai_manager()
    finally:
        deps._ai_manager = None


class TestDepsWiring:
    def test_fallback_key_registers_a_second_gemini_between_primary_and_ollama(self) -> None:
        manager = _build_manager_from_settings(PRIMARY_KEY, FALLBACK_KEY)

        kinds = [type(p).__name__ for p in manager.providers]
        assert kinds == ["GeminiProvider", "GeminiProvider", "OllamaProvider"]
        primary, fallback = manager.providers[0], manager.providers[1]
        assert isinstance(primary, GeminiProvider) and primary.api_key == PRIMARY_KEY
        assert isinstance(fallback, GeminiProvider) and fallback.api_key == FALLBACK_KEY

    def test_fallback_without_primary_is_not_registered(self) -> None:
        # A fallback with nothing to fall back from is just a misconfiguration;
        # don't quietly promote it to the primary.
        manager = _build_manager_from_settings(primary_key="", fallback_key=FALLBACK_KEY)

        assert not [p for p in manager.providers if isinstance(p, GeminiProvider)]

    def test_settings_accepts_the_env_var(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("BUBBLY_GEMINI_FALLBACK_API_KEY", FALLBACK_KEY)
        assert Settings(_env_file=None).gemini_fallback_api_key == FALLBACK_KEY  # type: ignore[call-arg]


class TestRealGeminiProvidersOverTheWire:
    """Real GeminiProvider objects, only the HTTP wire is faked: the primary key
    gets a spend-cap 429 and the second key answers. Covers vision and streaming
    through the real provider code, not just the manager's cascade."""

    @staticmethod
    def _wire() -> tuple[AIManager, list[str]]:
        seen_keys: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            key = request.headers["x-goog-api-key"]
            seen_keys.append(key)
            if key == PRIMARY_KEY:
                return httpx.Response(
                    429,
                    json={
                        "error": {
                            "code": 429,
                            "status": "RESOURCE_EXHAUSTED",
                            "message": "Your project has exceeded its monthly spending cap.",
                        }
                    },
                )
            if request.url.path.endswith(":streamGenerateContent"):
                chunk = {"candidates": [{"content": {"parts": [{"text": "hello"}]}}]}
                return httpx.Response(200, text=f"data: {json.dumps(chunk)}\n\n")
            body = {"candidates": [{"content": {"parts": [{"text": "from the second key"}]}}]}
            return httpx.Response(200, json=body)

        manager = AIManager()
        for key, label, gate in (
            (PRIMARY_KEY, "gemini-primary", None),
            (FALLBACK_KEY, "gemini-fallback", ACCOUNT_FAILURE_KINDS),
        ):
            provider = GeminiProvider(api_key=key, vision_max_retries=0)
            provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
            manager.add_provider(provider, label=label, only_after_failure_kinds=gate)
        return manager, seen_keys

    @pytest.mark.asyncio
    async def test_completion_falls_back_to_the_second_key(self) -> None:
        manager, seen = self._wire()
        assert await manager.complete(prompt="hi") == "from the second key"
        assert seen == [PRIMARY_KEY, FALLBACK_KEY]

    @pytest.mark.asyncio
    async def test_receipt_vision_ocr_falls_back_to_the_second_key(self) -> None:
        manager, seen = self._wire()
        result = await manager.vision_complete(prompt="read", image_bytes=b"\xff\xd8img")
        assert result == "from the second key"
        assert seen == [PRIMARY_KEY, FALLBACK_KEY]

    @pytest.mark.asyncio
    async def test_streaming_falls_back_to_the_second_key(self) -> None:
        manager, seen = self._wire()
        text = "".join([t async for t in manager.stream_complete(prompt="hi")])
        assert text == "hello"
        assert seen == [PRIMARY_KEY, FALLBACK_KEY]


class TestHealthAiLabelsTheKeyInUse:
    @pytest.mark.asyncio
    async def test_providers_are_labelled_without_any_key(self) -> None:
        manager, *_ = _manager(None)

        status = await manager.health_check()

        labels = [p["label"] for p in status["providers"]]
        assert labels == ["gemini-primary", "gemini-fallback", "ollama/test"]

    @pytest.mark.asyncio
    async def test_probe_reports_the_fallback_label_when_primary_is_capped(self) -> None:
        manager, *_ = _manager("quota_exhausted")

        status = await manager.health_check(generation_probe_ttl_seconds=3600)

        probe = status["generation_probe"]
        assert probe["healthy"] is True
        assert probe["label"] == "gemini-fallback"
        assert probe["fallback"] is True

    @pytest.mark.asyncio
    async def test_probe_does_not_burn_the_fallback_on_a_bad_request(self) -> None:
        manager, _, fallback, ollama = _manager("bad_request")

        status = await manager.health_check(generation_probe_ttl_seconds=3600)

        assert fallback.calls == []
        assert status["generation_probe"]["label"] == "ollama/test"

    @pytest.mark.asyncio
    async def test_endpoint_exposes_labels_and_never_a_key(self) -> None:
        manager = AIManager()
        for key, label, gate in (
            (PRIMARY_KEY, "gemini-primary", None),
            (FALLBACK_KEY, "gemini-fallback", ACCOUNT_FAILURE_KINDS),
        ):
            manager.add_provider(
                GeminiProvider(api_key=key), label=label, only_after_failure_kinds=gate
            )

        async def reachable(self: GeminiProvider) -> bool:
            return True

        with (
            patch("bubbly_chef.api.deps.get_ai_manager", return_value=manager),
            patch.object(GeminiProvider, "is_available", reachable),
            patch("bubbly_chef.main.settings.health_generation_probe_ttl_seconds", 0),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.get("/health/ai")

        body = response.json()
        assert [p["label"] for p in body["providers"]] == ["gemini-primary", "gemini-fallback"]
        assert PRIMARY_KEY not in response.text
        assert FALLBACK_KEY not in response.text
