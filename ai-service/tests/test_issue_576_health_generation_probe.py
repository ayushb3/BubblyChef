"""Tests for the /health/ai generation probe (issue #576).

`is_available()` only proves a provider is reachable and its key is valid. A
spend-capped Gemini key passes that check while every generation returns 429,
so /health/ai stayed green through the outage. The probe runs a tiny real
generation (through AIManager and the provider abstraction), caches the result
for a TTL so health checks do not burn quota, and is single-flight so a burst
of concurrent health hits produces one provider call.
"""

import asyncio
from collections.abc import Iterator
from typing import Any
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from bubbly_chef.ai.manager import AIManager
from bubbly_chef.ai.provider import AIProvider, ProviderUnavailableError, StructuredOutputError
from bubbly_chef.config import settings
from bubbly_chef.main import app


class FakeProvider(AIProvider):
    """A provider whose reachability check is green and whose generation is scripted."""

    def __init__(
        self,
        name: str,
        *,
        fail_kind: str | None = None,
        delay: float = 0.0,
        empty_reply: bool = False,
    ) -> None:
        self._name = name
        self.empty_reply = empty_reply
        self.fail_kind = fail_kind
        self.delay = delay
        self.complete_calls: list[dict[str, Any]] = []
        self.available_calls = 0

    @property
    def name(self) -> str:
        return self._name

    async def complete(  # type: ignore[override]
        self,
        prompt: str,
        response_schema: Any = None,
        temperature: float = 0.7,
        max_output_tokens: int | None = None,
    ) -> Any:
        self.complete_calls.append({"prompt": prompt, "max_output_tokens": max_output_tokens})
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail_kind is not None:
            raise ProviderUnavailableError(
                f"{self._name} is failing",
                kind=self.fail_kind,  # type: ignore[arg-type]
                status_code=429,
            )
        if self.empty_reply:
            # What GeminiProvider raises for a 200 whose capped reply has no
            # text (finishReason MAX_TOKENS, no parts).
            raise StructuredOutputError("Unexpected Gemini response format: no parts")
        return "ok"

    async def is_available(self) -> bool:
        self.available_calls += 1
        return True


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock() -> Iterator[FakeClock]:
    fake = FakeClock()
    with patch("bubbly_chef.ai.manager._monotonic", fake):
        yield fake


class TestGenerationProbe:
    @pytest.mark.asyncio
    async def test_generate_failure_reads_unhealthy_with_the_failure_kind(
        self, clock: FakeClock
    ) -> None:
        # The exact outage: reachable (is_available is green) but every generation 429s.
        gemini = FakeProvider("gemini/test", fail_kind="quota_exhausted")
        manager = AIManager(providers=[gemini])

        status = await manager.health_check(generation_probe_ttl_seconds=900)

        assert status["healthy"] is False
        probe = status["generation_probe"]
        assert probe["healthy"] is False
        assert probe["failure_kind"] == "quota_exhausted"
        assert probe["provider"] is None
        assert probe["checked_at"] is not None
        # The reachability check alone would have said healthy.
        assert status["available_count"] == 1

    @pytest.mark.asyncio
    async def test_probe_is_a_tiny_capped_generation(self, clock: FakeClock) -> None:
        gemini = FakeProvider("gemini/test")
        manager = AIManager(providers=[gemini])

        await manager.health_check(
            generation_probe_ttl_seconds=900, generation_probe_max_output_tokens=3
        )

        assert len(gemini.complete_calls) == 1
        assert gemini.complete_calls[0]["max_output_tokens"] == 3
        assert len(gemini.complete_calls[0]["prompt"]) < 100

    @pytest.mark.asyncio
    async def test_success_reports_which_provider_served_it(self, clock: FakeClock) -> None:
        gemini = FakeProvider("gemini/test")
        ollama = FakeProvider("ollama/test")
        manager = AIManager(providers=[gemini, ollama])

        status = await manager.health_check(generation_probe_ttl_seconds=900)

        probe = status["generation_probe"]
        assert status["healthy"] is True
        assert probe["healthy"] is True
        assert probe["provider"] == "gemini/test"
        assert probe["fallback"] is False
        assert probe["failure_kind"] is None
        assert ollama.complete_calls == []

    @pytest.mark.asyncio
    async def test_healthy_on_the_fallback_says_so_and_keeps_the_primary_failure(
        self, clock: FakeClock
    ) -> None:
        gemini = FakeProvider("gemini/test", fail_kind="quota_exhausted")
        ollama = FakeProvider("ollama/test")
        manager = AIManager(providers=[gemini, ollama])

        status = await manager.health_check(generation_probe_ttl_seconds=900)

        probe = status["generation_probe"]
        assert status["healthy"] is True
        assert probe["healthy"] is True
        assert probe["provider"] == "ollama/test"
        assert probe["fallback"] is True
        assert probe["failures"] == [{"provider": "gemini/test", "kind": "quota_exhausted"}]

    @pytest.mark.asyncio
    async def test_all_providers_failing_reports_the_most_informative_kind(
        self, clock: FakeClock
    ) -> None:
        # Ollama unreachable ("network") must not mask Gemini's specific kind.
        gemini = FakeProvider("gemini/test", fail_kind="quota_exhausted")
        ollama = FakeProvider("ollama/test", fail_kind="network")
        manager = AIManager(providers=[gemini, ollama])

        status = await manager.health_check(generation_probe_ttl_seconds=900)

        assert status["healthy"] is False
        assert status["generation_probe"]["failure_kind"] == "quota_exhausted"
        assert len(status["generation_probe"]["failures"]) == 2

    @pytest.mark.asyncio
    async def test_no_providers_configured_is_unhealthy_without_a_kind(
        self, clock: FakeClock
    ) -> None:
        manager = AIManager(providers=[])

        status = await manager.health_check(generation_probe_ttl_seconds=900)

        assert status["healthy"] is False
        assert status["generation_probe"]["healthy"] is False
        assert status["generation_probe"]["failure_kind"] is None


class TestEmptyCappedReply:
    @pytest.mark.asyncio
    async def test_a_200_with_no_text_reads_as_healthy(self, clock: FakeClock) -> None:
        # A thinking model can spend a tiny cap before emitting text; the
        # request still succeeded, so the provider is healthy, not down.
        gemini = FakeProvider("gemini/test", empty_reply=True)
        manager = AIManager(providers=[gemini])

        status = await manager.health_check(generation_probe_ttl_seconds=900)

        assert status["healthy"] is True
        probe = status["generation_probe"]
        assert probe["healthy"] is True
        assert probe["provider"] == "gemini/test"
        assert probe["failure_kind"] is None
        assert probe["failures"] == []

    @pytest.mark.asyncio
    async def test_an_empty_reply_does_not_fall_through_to_the_fallback(
        self, clock: FakeClock
    ) -> None:
        gemini = FakeProvider("gemini/test", empty_reply=True)
        ollama = FakeProvider("ollama/test")
        manager = AIManager(providers=[gemini, ollama])

        status = await manager.health_check(generation_probe_ttl_seconds=900)

        assert status["generation_probe"]["provider"] == "gemini/test"
        assert status["generation_probe"]["fallback"] is False
        assert ollama.complete_calls == []

    @pytest.mark.asyncio
    async def test_gemini_max_tokens_response_without_parts_raises_structured_output_error(
        self,
    ) -> None:
        # Ties the manager's "healthy" branch to what Gemini really sends back
        # when a thinking model spends the cap before emitting text.
        from unittest.mock import AsyncMock, MagicMock

        from bubbly_chef.ai.gemini import GeminiProvider

        provider = GeminiProvider(api_key="test-key", model="gemini-3.1-flash-lite")
        response = MagicMock()
        response.raise_for_status = MagicMock()
        response.json = MagicMock(
            return_value={
                "candidates": [{"content": {"role": "model"}, "finishReason": "MAX_TOKENS"}],
                "usageMetadata": {"thoughtsTokenCount": 4},
            }
        )
        provider._client.post = AsyncMock(return_value=response)  # type: ignore[method-assign]

        with pytest.raises(StructuredOutputError):
            await provider.complete(prompt="hi", max_output_tokens=4)
        await provider.close()


class TestProbeDoesNotTouchCurrentProvider:
    @pytest.mark.asyncio
    async def test_a_probe_served_by_the_fallback_leaves_current_provider_alone(
        self, clock: FakeClock
    ) -> None:
        # chat reads `current_provider` to name the provider that handled the
        # last user request; a background probe must not change it.
        gemini = FakeProvider("gemini/test", fail_kind="quota_exhausted")
        ollama = FakeProvider("ollama/test")
        manager = AIManager(providers=[gemini, ollama])
        assert manager.current_provider is None

        status = await manager.health_check(generation_probe_ttl_seconds=900)

        assert status["generation_probe"]["provider"] == "ollama/test"
        assert manager.current_provider is None

    @pytest.mark.asyncio
    async def test_a_probe_keeps_the_provider_of_the_last_real_request(
        self, clock: FakeClock
    ) -> None:
        gemini = FakeProvider("gemini/test")
        ollama = FakeProvider("ollama/test")
        manager = AIManager(providers=[gemini, ollama])
        await manager.complete(prompt="hello")
        assert manager.current_provider is gemini

        gemini.fail_kind = "quota_exhausted"
        await manager.health_check(generation_probe_ttl_seconds=900)

        assert manager.current_provider is gemini


class TestDefaultProbeCap:
    @pytest.mark.asyncio
    async def test_default_cap_leaves_room_for_thinking_tokens(self, clock: FakeClock) -> None:
        gemini = FakeProvider("gemini/test")
        manager = AIManager(providers=[gemini])

        await manager.health_check(generation_probe_ttl_seconds=900)

        assert gemini.complete_calls[0]["max_output_tokens"] == 16
        assert settings.health_generation_probe_max_output_tokens == 16


class TestProbeCache:
    @pytest.mark.asyncio
    async def test_second_health_hit_within_the_ttl_makes_no_provider_call(
        self, clock: FakeClock
    ) -> None:
        gemini = FakeProvider("gemini/test")
        manager = AIManager(providers=[gemini])

        first = await manager.health_check(generation_probe_ttl_seconds=900)
        clock.now += 899
        second = await manager.health_check(generation_probe_ttl_seconds=900)

        assert len(gemini.complete_calls) == 1
        assert first["generation_probe"]["cached"] is False
        assert second["generation_probe"]["cached"] is True
        assert second["generation_probe"]["checked_at"] == first["generation_probe"]["checked_at"]

    @pytest.mark.asyncio
    async def test_a_failed_probe_is_cached_within_the_failure_ttl(
        self, clock: FakeClock
    ) -> None:
        gemini = FakeProvider("gemini/test", fail_kind="quota_exhausted")
        manager = AIManager(providers=[gemini])

        await manager.health_check(generation_probe_ttl_seconds=900)
        clock.now += 59
        await manager.health_check(generation_probe_ttl_seconds=900)

        assert len(gemini.complete_calls) == 1

    @pytest.mark.asyncio
    async def test_a_failed_probe_re_probes_after_60s_and_recovers(self, clock: FakeClock) -> None:
        # The outage ends: /health/ai must go green within the failure TTL, not
        # sit red for the full 15 min success TTL.
        gemini = FakeProvider("gemini/test", fail_kind="quota_exhausted")
        manager = AIManager(providers=[gemini])

        await manager.health_check(generation_probe_ttl_seconds=900)
        clock.now += 61
        gemini.fail_kind = None  # the cap was lifted
        status = await manager.health_check(generation_probe_ttl_seconds=900)

        assert len(gemini.complete_calls) == 2
        assert status["healthy"] is True
        assert status["generation_probe"]["cached"] is False

    @pytest.mark.asyncio
    async def test_a_successful_probe_is_not_repeated_until_900s(self, clock: FakeClock) -> None:
        gemini = FakeProvider("gemini/test")
        manager = AIManager(providers=[gemini])

        await manager.health_check(generation_probe_ttl_seconds=900)
        clock.now += 61  # past the failure TTL, which must not apply to a success
        await manager.health_check(generation_probe_ttl_seconds=900)
        assert len(gemini.complete_calls) == 1

        clock.now += 840  # 901s since the probe
        status = await manager.health_check(generation_probe_ttl_seconds=900)
        assert len(gemini.complete_calls) == 2
        assert status["generation_probe"]["cached"] is False

    @pytest.mark.asyncio
    async def test_failure_ttl_zero_re_probes_a_failure_on_every_call(
        self, clock: FakeClock
    ) -> None:
        gemini = FakeProvider("gemini/test", fail_kind="quota_exhausted")
        manager = AIManager(providers=[gemini])

        for _ in range(3):
            await manager.health_check(
                generation_probe_ttl_seconds=900, generation_probe_failure_ttl_seconds=0
            )

        assert len(gemini.complete_calls) == 3

    @pytest.mark.asyncio
    async def test_failure_ttl_zero_does_not_disable_the_probe_or_uncache_successes(
        self, clock: FakeClock
    ) -> None:
        gemini = FakeProvider("gemini/test")
        manager = AIManager(providers=[gemini])

        for _ in range(3):
            await manager.health_check(
                generation_probe_ttl_seconds=900, generation_probe_failure_ttl_seconds=0
            )

        assert len(gemini.complete_calls) == 1


class TestSingleFlight:
    @pytest.mark.asyncio
    async def test_concurrent_health_hits_on_a_cache_miss_trigger_one_probe(
        self, clock: FakeClock
    ) -> None:
        gemini = FakeProvider("gemini/test", delay=0.05)
        manager = AIManager(providers=[gemini])

        results = await asyncio.gather(
            *[manager.health_check(generation_probe_ttl_seconds=900) for _ in range(10)]
        )

        assert len(gemini.complete_calls) == 1
        assert all(r["healthy"] is True for r in results)

    @pytest.mark.asyncio
    async def test_concurrent_hits_share_one_probe_even_with_failure_ttl_zero(
        self, clock: FakeClock
    ) -> None:
        gemini = FakeProvider("gemini/test", fail_kind="quota_exhausted", delay=0.05)
        manager = AIManager(providers=[gemini])

        results = await asyncio.gather(
            *[
                manager.health_check(
                    generation_probe_ttl_seconds=900, generation_probe_failure_ttl_seconds=0
                )
                for _ in range(10)
            ]
        )

        assert len(gemini.complete_calls) == 1
        assert all(r["healthy"] is False for r in results)


class TestProbeDisabled:
    @pytest.mark.asyncio
    async def test_ttl_zero_never_generates_and_keeps_the_reachability_behaviour(
        self, clock: FakeClock
    ) -> None:
        gemini = FakeProvider("gemini/test", fail_kind="quota_exhausted")
        manager = AIManager(providers=[gemini])

        status = await manager.health_check(generation_probe_ttl_seconds=0)

        assert gemini.complete_calls == []
        assert status["healthy"] is True  # today's is_available() behaviour
        assert status["generation_probe"] is None

    @pytest.mark.asyncio
    async def test_default_health_check_does_not_probe(self, clock: FakeClock) -> None:
        gemini = FakeProvider("gemini/test")
        manager = AIManager(providers=[gemini])

        status = await manager.health_check()

        assert gemini.complete_calls == []
        assert status["generation_probe"] is None


class TestSpendCapClassification:
    def test_the_real_monthly_spending_cap_429_is_quota_exhausted_not_rate_limited(self) -> None:
        # Verbatim shape of the body Gemini returned for this project's cap
        # (2026-09-30): RESOURCE_EXHAUSTED, no QuotaFailure/quotaId detail, so
        # it used to fall through to "rate_limited" ("try again in a minute").
        from bubbly_chef.ai.gemini import _classify_http_error

        body = (
            '{"error": {"code": 429, "message": "Your project has exceeded its '
            "monthly spending cap. Please go to AI Studio at https://ai.studio/spend "
            "to manage your project spend cap. Learn more at "
            'https://ai.google.dev/gemini-api/docs/billing#project-spend-caps. ", '
            '"status": "RESOURCE_EXHAUSTED"}}'
        )
        assert _classify_http_error(429, body) == "quota_exhausted"

    def test_a_plain_429_without_a_spend_cap_is_still_rate_limited(self) -> None:
        from bubbly_chef.ai.gemini import _classify_http_error

        body = '{"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "slow down"}}'
        assert _classify_http_error(429, body) == "rate_limited"


class TestTokenCapReachesTheWire:
    @pytest.mark.asyncio
    async def test_gemini_sends_max_output_tokens_only_when_asked(self) -> None:
        from unittest.mock import AsyncMock, MagicMock

        from bubbly_chef.ai.gemini import GeminiProvider

        provider = GeminiProvider(api_key="test-key", model="gemini-3.1-flash-lite")
        response = MagicMock()
        response.raise_for_status = MagicMock()
        response.json = MagicMock(
            return_value={"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}
        )
        provider._client.post = AsyncMock(return_value=response)  # type: ignore[method-assign]

        await provider.complete(prompt="hi", max_output_tokens=4)
        capped = provider._client.post.call_args.kwargs["json"]  # type: ignore[attr-defined]
        await provider.complete(prompt="hi")
        uncapped = provider._client.post.call_args.kwargs["json"]  # type: ignore[attr-defined]

        assert capped["generationConfig"]["maxOutputTokens"] == 4
        assert "maxOutputTokens" not in uncapped["generationConfig"]
        await provider.close()


class TestHealthRoutes:
    @pytest.mark.asyncio
    async def test_health_ai_reports_unhealthy_and_the_kind_while_health_never_probes(
        self, clock: FakeClock
    ) -> None:
        gemini = FakeProvider("gemini/test", fail_kind="quota_exhausted")
        manager = AIManager(providers=[gemini])

        with (
            patch("bubbly_chef.api.deps.get_ai_manager", return_value=manager),
            patch.object(settings, "health_generation_probe_ttl_seconds", 900),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                plain = await client.get("/health")
                assert gemini.complete_calls == []
                ai = await client.get("/health/ai")

        assert plain.status_code == 200
        # Always HTTP 200: Railway's deploy healthcheck polls this path and a
        # spend cap must not block a deploy.
        assert ai.status_code == 200
        body = ai.json()
        assert body["ai_available"] is False
        assert body["generation_probe"]["failure_kind"] == "quota_exhausted"

    @pytest.mark.asyncio
    async def test_health_ai_with_ttl_zero_does_not_generate(self, clock: FakeClock) -> None:
        gemini = FakeProvider("gemini/test", fail_kind="quota_exhausted")
        manager = AIManager(providers=[gemini])

        with (
            patch("bubbly_chef.api.deps.get_ai_manager", return_value=manager),
            patch.object(settings, "health_generation_probe_ttl_seconds", 0),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                ai = await client.get("/health/ai")

        assert gemini.complete_calls == []
        assert ai.json()["ai_available"] is True
