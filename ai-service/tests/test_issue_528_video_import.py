"""Tests for YouTube video recipe import (issue #528).

Covers: YouTube URL detection, ``GeminiProvider.video_complete`` request shape
(mocked httpx), ``AIManager.video_complete`` skipping non-video providers, the
ingestor's YouTube branch (mocked manager), and the sanitized error surface of
``POST /v1/ingest`` for non-recipe / private / failing videos.

No test here talks to a real model or the network.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bubbly_chef.ai.gemini import GeminiProvider
from bubbly_chef.ai.manager import AIManager, NoProviderAvailableError
from bubbly_chef.ai.provider import AIProvider, ProviderUnavailableError
from bubbly_chef.models.recipe import Ingredient, RecipeCard
from bubbly_chef.services.recipe_url_ingestor import (
    ingest_recipe_from_video,
    youtube_video_id,
)

VIDEO_ID = "dQw4w9WgXcQ"
SHORTS_URL = f"https://www.youtube.com/shorts/{VIDEO_ID}"
TEST_USER_ID = "test-user-528"


# ---------------------------------------------------------------------------
# URL detection
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        f"https://www.youtube.com/shorts/{VIDEO_ID}",
        f"https://youtube.com/shorts/{VIDEO_ID}?feature=share",
        f"https://m.youtube.com/shorts/{VIDEO_ID}",
        f"https://www.youtube.com/watch?v={VIDEO_ID}",
        f"https://www.youtube.com/watch?feature=share&v={VIDEO_ID}&t=10s",
        f"https://m.youtube.com/watch?v={VIDEO_ID}",
        f"https://youtu.be/{VIDEO_ID}",
        f"https://youtu.be/{VIDEO_ID}?si=abc123",
        f"http://youtu.be/{VIDEO_ID}",
    ],
)
def test_youtube_urls_yield_video_id(url: str) -> None:
    assert youtube_video_id(url) == VIDEO_ID


@pytest.mark.parametrize(
    "url",
    [
        "https://www.allrecipes.com/recipe/123/cookies/",
        "https://www.youtube.com/",
        "https://www.youtube.com/@somechannel",
        "https://www.youtube.com/playlist?list=PL123",
        "https://www.youtube.com/watch?list=PL123",
        "https://www.youtube.com/shorts/",
        "https://notyoutube.com/watch?v=" + VIDEO_ID,
        "https://youtube.com.evil.example/watch?v=" + VIDEO_ID,
        "https://example.com/?next=https://youtu.be/" + VIDEO_ID,
        "not a url",
        "",
    ],
)
def test_non_video_urls_yield_none(url: str) -> None:
    assert youtube_video_id(url) is None


# ---------------------------------------------------------------------------
# GeminiProvider.video_complete — request shape (mocked httpx)
# ---------------------------------------------------------------------------


def _ok_response(text: str) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.raise_for_status = MagicMock(return_value=None)
    resp.json = MagicMock(return_value={"candidates": [{"content": {"parts": [{"text": text}]}}]})
    return resp


def _recipe_json(title: str = "Garlic Noodles") -> str:
    card = RecipeCard(
        title=title,
        ingredients=[Ingredient(name="noodles", quantity=200, unit="g")],
        instructions=["Boil noodles", "Toss with garlic butter"],
    )
    return card.model_dump_json()


def test_gemini_supports_video_and_base_provider_does_not() -> None:
    class _Plain(AIProvider):
        @property
        def name(self) -> str:
            return "plain"

        async def complete(self, *a: Any, **k: Any) -> str:  # type: ignore[override]
            return ""

        async def is_available(self) -> bool:
            return True

    assert GeminiProvider(api_key="k").supports_video is True
    assert _Plain().supports_video is False


@pytest.mark.asyncio
async def test_base_provider_video_complete_raises_unavailable() -> None:
    class _Plain(AIProvider):
        @property
        def name(self) -> str:
            return "plain"

        async def complete(self, *a: Any, **k: Any) -> str:  # type: ignore[override]
            return ""

        async def is_available(self) -> bool:
            return True

    with pytest.raises(ProviderUnavailableError):
        await _Plain().video_complete(prompt="p", video_url="https://youtu.be/x")


@pytest.mark.asyncio
async def test_gemini_video_complete_request_shape() -> None:
    provider = GeminiProvider(api_key="secret-key", video_timeout=33.0)
    post = AsyncMock(return_value=_ok_response(_recipe_json()))
    provider._client.post = post  # type: ignore[method-assign]
    watch_url = f"https://www.youtube.com/watch?v={VIDEO_ID}"

    result = await provider.video_complete(
        prompt="extract the recipe", video_url=watch_url, response_schema=RecipeCard
    )

    assert isinstance(result, RecipeCard)
    assert result.title == "Garlic Noodles"
    assert post.await_count == 1, "video calls are not retried (slow and billed)"

    args, kwargs = post.await_args
    assert args[0].endswith(":generateContent")
    payload = kwargs["json"]
    parts = payload["contents"][0]["parts"]
    assert {"file_data": {"file_uri": watch_url}} in parts
    text_parts = [p["text"] for p in parts if "text" in p]
    assert len(text_parts) == 1 and "extract the recipe" in text_parts[0]
    gen = payload["generationConfig"]
    assert gen["responseMimeType"] == "application/json"
    assert gen["mediaResolution"] == "MEDIA_RESOLUTION_LOW"
    # Own timeout, not the 60s text default; key travels in a header, not the URL.
    assert kwargs["timeout"] == 33.0
    assert kwargs["headers"] == {"x-goog-api-key": "secret-key"}
    assert "secret-key" not in args[0]


@pytest.mark.asyncio
async def test_gemini_video_complete_without_schema_returns_text() -> None:
    provider = GeminiProvider(api_key="k")
    provider._client.post = AsyncMock(return_value=_ok_response("plain text"))  # type: ignore[method-assign]

    result = await provider.video_complete(prompt="p", video_url="https://youtu.be/x")

    assert result == "plain text"


@pytest.mark.asyncio
async def test_gemini_video_http_400_is_bad_request_kind() -> None:
    """Gemini answers 400 for a private / removed / age-restricted video."""
    provider = GeminiProvider(api_key="k")
    request = httpx.Request("POST", "https://example.test")
    bad = httpx.Response(400, text="Failed to fetch video", request=request)
    provider._client.post = AsyncMock(  # type: ignore[method-assign]
        side_effect=httpx.HTTPStatusError("400", request=request, response=bad)
    )

    with pytest.raises(ProviderUnavailableError) as exc_info:
        await provider.video_complete(prompt="p", video_url="https://youtu.be/x")

    assert exc_info.value.kind == "bad_request"
    assert provider._client.post.await_count == 1  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_gemini_video_timeout_is_timeout_kind() -> None:
    provider = GeminiProvider(api_key="k")
    provider._client.post = AsyncMock(side_effect=httpx.ReadTimeout("slow"))  # type: ignore[method-assign]

    with pytest.raises(ProviderUnavailableError) as exc_info:
        await provider.video_complete(prompt="p", video_url="https://youtu.be/x")

    assert exc_info.value.kind == "timeout"


def test_video_timeout_setting_exists_with_bubbly_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    from bubbly_chef.config import Settings

    assert Settings().gemini_video_timeout_seconds > 18.0  # longer than the vision default
    monkeypatch.setenv("BUBBLY_GEMINI_VIDEO_TIMEOUT_SECONDS", "77")
    assert Settings().gemini_video_timeout_seconds == 77.0


# ---------------------------------------------------------------------------
# AIManager.video_complete
# ---------------------------------------------------------------------------


class _FakeProvider(AIProvider):
    def __init__(self, label: str, video: bool, result: Any = "ok", exc: Exception | None = None):
        self._label = label
        self._video = video
        self._result = result
        self._exc = exc
        self.video_calls = 0

    @property
    def name(self) -> str:
        return self._label

    @property
    def supports_video(self) -> bool:
        return self._video

    async def complete(self, *a: Any, **k: Any) -> str:  # type: ignore[override]
        return "text"

    async def video_complete(self, *a: Any, **k: Any) -> Any:  # type: ignore[override]
        self.video_calls += 1
        if self._exc:
            raise self._exc
        return self._result

    async def is_available(self) -> bool:
        return True


@pytest.mark.asyncio
async def test_manager_video_complete_skips_non_video_providers() -> None:
    manager = AIManager()
    no_video = _FakeProvider("local", video=False)
    with_video = _FakeProvider("cloud", video=True, result="watched")
    manager.add_provider(no_video)
    manager.add_provider(with_video)

    result = await manager.video_complete(prompt="p", video_url="https://youtu.be/x")

    assert result == "watched"
    assert no_video.video_calls == 0
    assert with_video.video_calls == 1


@pytest.mark.asyncio
async def test_manager_video_complete_without_capable_provider_raises() -> None:
    manager = AIManager()
    manager.add_provider(_FakeProvider("local", video=False))

    with pytest.raises(NoProviderAvailableError):
        await manager.video_complete(prompt="p", video_url="https://youtu.be/x")


@pytest.mark.asyncio
async def test_manager_video_complete_carries_failure_kind() -> None:
    manager = AIManager()
    manager.add_provider(
        _FakeProvider(
            "cloud", video=True, exc=ProviderUnavailableError("nope", kind="bad_request")
        )
    )

    with pytest.raises(NoProviderAvailableError) as exc_info:
        await manager.video_complete(prompt="p", video_url="https://youtu.be/x")

    assert exc_info.value.kind == "bad_request"


# ---------------------------------------------------------------------------
# Ingestor YouTube branch (mocked manager)
# ---------------------------------------------------------------------------


def _manager_returning(result: Any = None, exc: Exception | None = None) -> MagicMock:
    manager = MagicMock()
    manager.video_complete = AsyncMock(return_value=result, side_effect=exc)
    manager.complete = AsyncMock(side_effect=AssertionError("text path must not run"))
    return manager


def _good_card() -> RecipeCard:
    return RecipeCard(
        title="Garlic Noodles",
        ingredients=[Ingredient(name="noodles", quantity=200, unit="g")],
        instructions=["Boil noodles", "Toss with garlic butter"],
    )


@pytest.mark.asyncio
async def test_youtube_url_goes_to_video_path_before_scraper_tiers() -> None:
    manager = _manager_returning(_good_card())
    with (
        patch("bubbly_chef.services.recipe_url_ingestor.get_ai_manager", return_value=manager),
        patch(
            "bubbly_chef.services.recipe_url_ingestor.scrape_me",
            side_effect=AssertionError("scraper must not run for YouTube"),
        ),
        patch(
            "bubbly_chef.services.recipe_url_ingestor.httpx_get",
            side_effect=AssertionError("html fetch must not run for YouTube"),
        ),
    ):
        from bubbly_chef.services.recipe_url_ingestor import ingest_recipe_from_url

        card = await ingest_recipe_from_url(SHORTS_URL)

    assert card.title == "Garlic Noodles"
    assert card.source_url == SHORTS_URL
    assert card.source_type == "video"
    assert card.thumbnail_url == f"https://i.ytimg.com/vi/{VIDEO_ID}/hqdefault.jpg"
    kwargs = manager.video_complete.await_args.kwargs
    assert kwargs["response_schema"] is RecipeCard
    # Gemini is handed the canonical watch URL for any YouTube link shape.
    assert kwargs["video_url"] == f"https://www.youtube.com/watch?v={VIDEO_ID}"
    assert "recipe" in kwargs["prompt"].lower()


@pytest.mark.asyncio
async def test_non_youtube_url_still_uses_scraper_tiers() -> None:
    scraper = MagicMock()
    scraper.title.return_value = "Cookies"
    scraper.ingredients.return_value = ["flour"]
    scraper.instructions_list.return_value = ["bake"]
    scraper.total_time.return_value = 10
    scraper.yields.return_value = "4 servings"
    scraper.description.return_value = "d"
    scraper.image.return_value = "https://example.com/i.jpg"
    manager = _manager_returning(exc=AssertionError("video path must not run"))
    with (
        patch("bubbly_chef.services.recipe_url_ingestor.get_ai_manager", return_value=manager),
        patch("bubbly_chef.services.recipe_url_ingestor.scrape_me", return_value=scraper),
    ):
        from bubbly_chef.services.recipe_url_ingestor import ingest_recipe_from_url

        card = await ingest_recipe_from_url("https://www.allrecipes.com/recipe/1/cookies/")

    assert card.source_type == "url"
    manager.video_complete.assert_not_awaited()


@pytest.mark.asyncio
async def test_empty_card_from_video_is_not_a_recipe() -> None:
    from bubbly_chef.services.recipe_import_errors import RecipeImportError

    manager = _manager_returning(RecipeCard(title="Not a recipe"))
    with patch("bubbly_chef.services.recipe_url_ingestor.get_ai_manager", return_value=manager):
        with pytest.raises(RecipeImportError) as exc_info:
            await ingest_recipe_from_video(SHORTS_URL)

    assert exc_info.value.reason == "not_a_recipe"


@pytest.mark.asyncio
async def test_unexpected_result_type_is_a_sanitized_failure() -> None:
    from bubbly_chef.services.recipe_import_errors import RecipeImportError

    manager = _manager_returning("some free text")
    with patch("bubbly_chef.services.recipe_url_ingestor.get_ai_manager", return_value=manager):
        with pytest.raises(RecipeImportError) as exc_info:
            await ingest_recipe_from_video(SHORTS_URL)

    assert exc_info.value.reason == "video_failed"


@pytest.mark.parametrize(
    ("kind", "reason", "status"),
    [
        ("bad_request", "video_unavailable", 422),
        ("timeout", "video_timeout", 504),
        ("quota_exhausted", "video_failed", 503),
        ("auth", "video_failed", 503),
        ("unknown", "video_failed", 503),
    ],
)
@pytest.mark.asyncio
async def test_provider_failures_map_to_typed_sanitized_errors(
    kind: str, reason: str, status: int
) -> None:
    from bubbly_chef.services.recipe_import_errors import RecipeImportError

    manager = _manager_returning(
        exc=NoProviderAvailableError(
            "No video-capable provider available. Errors: "
            "['gemini/gemini-3.1-flash-lite: Gemini API error 400: Traceback ...']",
            kind=kind,
        )
    )
    with patch("bubbly_chef.services.recipe_url_ingestor.get_ai_manager", return_value=manager):
        with pytest.raises(RecipeImportError) as exc_info:
            await ingest_recipe_from_video(SHORTS_URL)

    err = exc_info.value
    assert err.reason == reason
    assert err.status_code == status
    leaked = f"{err.reason} {err.message}".lower()
    for banned in ("gemini", "ollama", "traceback", "flash", "provider", "model"):
        assert banned not in leaked


@pytest.mark.asyncio
async def test_unconfigured_ai_is_a_sanitized_failure() -> None:
    from bubbly_chef.services.recipe_import_errors import RecipeImportError

    manager = _manager_returning(
        exc=NoProviderAvailableError("No AI providers", configured=False)
    )
    with patch("bubbly_chef.services.recipe_url_ingestor.get_ai_manager", return_value=manager):
        with pytest.raises(RecipeImportError) as exc_info:
            await ingest_recipe_from_video(SHORTS_URL)

    assert exc_info.value.reason == "video_failed"


@pytest.mark.asyncio
async def test_raw_httpx_timeout_maps_to_video_timeout() -> None:
    from bubbly_chef.services.recipe_import_errors import RecipeImportError

    manager = _manager_returning(exc=httpx.ReadTimeout("slow"))
    with patch("bubbly_chef.services.recipe_url_ingestor.get_ai_manager", return_value=manager):
        with pytest.raises(RecipeImportError) as exc_info:
            await ingest_recipe_from_video(SHORTS_URL)

    assert exc_info.value.reason == "video_timeout"


# ---------------------------------------------------------------------------
# POST /v1/ingest — the response the browser actually sees
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    from fastapi import FastAPI

    @asynccontextmanager
    async def no_op_lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        yield

    app = FastAPI(lifespan=no_op_lifespan)
    import bubbly_chef.services.url_extractor  # noqa: F401  (registers the extractor)
    from bubbly_chef.api.auth import get_current_user_id
    from bubbly_chef.api.routes.ingest import router

    app.include_router(router)
    app.dependency_overrides[get_current_user_id] = lambda: TEST_USER_ID
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_route_returns_recipe_envelope_for_a_recipe_short(client: AsyncClient) -> None:
    manager = _manager_returning(_good_card())
    with patch("bubbly_chef.services.recipe_url_ingestor.get_ai_manager", return_value=manager):
        resp = await client.post("/v1/ingest", data={"text": SHORTS_URL})

    assert resp.status_code == 200
    recipe = resp.json()["proposal"]["recipe"]
    assert recipe["title"] == "Garlic Noodles"
    assert recipe["source_type"] == "video"
    assert recipe["source_url"] == SHORTS_URL


@pytest.mark.asyncio
async def test_route_non_recipe_video_returns_not_a_recipe_reason(client: AsyncClient) -> None:
    manager = _manager_returning(RecipeCard(title="Cat video"))
    with patch("bubbly_chef.services.recipe_url_ingestor.get_ai_manager", return_value=manager):
        resp = await client.post("/v1/ingest", data={"text": SHORTS_URL})

    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail["reason"] == "not_a_recipe"
    assert detail["message"]


@pytest.mark.asyncio
async def test_route_private_video_error_leaks_no_internals(client: AsyncClient) -> None:
    manager = _manager_returning(
        exc=NoProviderAvailableError(
            "No video-capable provider available. Errors: "
            "['gemini/gemini-3.1-flash-lite: Gemini [gemini-3.1-flash-lite] video API error "
            "400: Traceback (most recent call last): ...']",
            kind="bad_request",
        )
    )
    with patch("bubbly_chef.services.recipe_url_ingestor.get_ai_manager", return_value=manager):
        resp = await client.post("/v1/ingest", data={"text": SHORTS_URL})

    assert resp.status_code == 422
    assert resp.json()["detail"]["reason"] == "video_unavailable"
    body = resp.text.lower()
    assert "gemini" not in body
    assert "traceback" not in body
    assert "flash" not in body


# ---------------------------------------------------------------------------
# 403 handling: unreachable video vs. real auth failure (live check on #764)
# ---------------------------------------------------------------------------

_GENERIC_403 = (
    '{"error": {"code": 403, "message": "The caller does not have permission", '
    '"status": "PERMISSION_DENIED"}}'
)


def _provider_failing_with(status: int, body: str) -> GeminiProvider:
    provider = GeminiProvider(api_key="k")
    request = httpx.Request("POST", "https://example.test")
    resp = httpx.Response(status, text=body, request=request)
    provider._client.post = AsyncMock(  # type: ignore[method-assign]
        side_effect=httpx.HTTPStatusError(str(status), request=request, response=resp)
    )
    return provider


async def _video_error_kind(status: int, body: str) -> tuple[str, int | None]:
    provider = _provider_failing_with(status, body)
    with pytest.raises(ProviderUnavailableError) as exc_info:
        await provider.video_complete(prompt="p", video_url="https://youtu.be/x")
    return exc_info.value.kind, exc_info.value.status_code


@pytest.mark.parametrize(
    "body",
    [
        _GENERIC_403,
        '{"error": {"code": 403, "message": "Video is private or unavailable", '
        '"status": "PERMISSION_DENIED"}}',
        '{"error": {"code": 403, "message": "Cannot fetch content from the provided URL; '
        'the file may be removed", "status": "PERMISSION_DENIED"}}',
    ],
)
@pytest.mark.asyncio
async def test_403_about_the_video_is_bad_request_not_auth(body: str) -> None:
    assert await _video_error_kind(403, body) == ("bad_request", 403)


@pytest.mark.parametrize(
    "body",
    [
        '{"error": {"code": 403, "message": "Your API key was reported as leaked. '
        'Please use another API key.", "status": "PERMISSION_DENIED"}}',
        '{"error": {"code": 403, "message": "Generative Language API has not been used in '
        'project 123 before or it is disabled.", "status": "PERMISSION_DENIED"}}',
        '{"error": {"code": 403, "message": "Method doesn\'t allow unregistered callers", '
        '"status": "PERMISSION_DENIED"}}',
        '{"error": {"code": 403, "message": "Permission denied: Consumer \'api_key:AIza\' has '
        'been suspended. The video could not be read.", "status": "PERMISSION_DENIED"}}',
        '{"error": {"code": 403, "message": "nope", "status": "PERMISSION_DENIED"}}',
    ],
)
@pytest.mark.asyncio
async def test_403_about_the_key_or_project_stays_auth(body: str) -> None:
    kind, _ = await _video_error_kind(403, body)
    assert kind == "auth"


@pytest.mark.asyncio
async def test_a_403_on_a_missing_video_reaches_the_user_as_video_unavailable() -> None:
    from bubbly_chef.services.recipe_import_errors import RecipeImportError

    manager = AIManager()
    manager.add_provider(_provider_failing_with(403, _GENERIC_403))
    with patch("bubbly_chef.services.recipe_url_ingestor.get_ai_manager", return_value=manager):
        with pytest.raises(RecipeImportError) as exc_info:
            await ingest_recipe_from_video(SHORTS_URL)

    assert exc_info.value.reason == "video_unavailable"
    assert exc_info.value.status_code == 422


@pytest.mark.asyncio
async def test_a_real_auth_403_is_not_reported_as_an_unavailable_video() -> None:
    from bubbly_chef.services.recipe_import_errors import RecipeImportError

    body = '{"error": {"code": 403, "message": "Your API key was reported as leaked."}}'
    manager = AIManager()
    manager.add_provider(_provider_failing_with(403, body))
    with patch("bubbly_chef.services.recipe_url_ingestor.get_ai_manager", return_value=manager):
        with pytest.raises(RecipeImportError) as exc_info:
            await ingest_recipe_from_video(SHORTS_URL)

    assert exc_info.value.reason == "video_failed"


# ---------------------------------------------------------------------------
# Fallback key (#737) applies to video the way it does to vision
# ---------------------------------------------------------------------------


def _gated_manager(primary: _FakeProvider, fallback: _FakeProvider) -> AIManager:
    from bubbly_chef.ai.manager import ACCOUNT_FAILURE_KINDS

    manager = AIManager()
    manager.add_provider(primary, label="gemini-primary")
    manager.add_provider(
        fallback, label="gemini-fallback", only_after_failure_kinds=ACCOUNT_FAILURE_KINDS
    )
    return manager


@pytest.mark.parametrize("kind", ["auth", "quota_exhausted", "rate_limited"])
@pytest.mark.asyncio
async def test_video_falls_over_to_the_fallback_key_on_account_failures(kind: str) -> None:
    primary = _FakeProvider(
        "p", video=True, exc=ProviderUnavailableError("x", kind=kind)  # type: ignore[arg-type]
    )
    fallback = _FakeProvider("f", video=True, result="from fallback")
    manager = _gated_manager(primary, fallback)

    result = await manager.video_complete(prompt="p", video_url="https://youtu.be/x")

    assert result == "from fallback"
    assert primary.video_calls == 1 and fallback.video_calls == 1


@pytest.mark.parametrize("kind", ["bad_request", "timeout", "network"])
@pytest.mark.asyncio
async def test_video_does_not_burn_the_fallback_key_on_other_failures(kind: str) -> None:
    """An unreadable video (bad_request) must not cost a second Gemini call."""
    primary = _FakeProvider(
        "p", video=True, exc=ProviderUnavailableError("x", kind=kind)  # type: ignore[arg-type]
    )
    fallback = _FakeProvider("f", video=True, result="from fallback")
    manager = _gated_manager(primary, fallback)

    with pytest.raises(NoProviderAvailableError) as exc_info:
        await manager.video_complete(prompt="p", video_url="https://youtu.be/x")

    assert fallback.video_calls == 0
    assert exc_info.value.kind == kind
