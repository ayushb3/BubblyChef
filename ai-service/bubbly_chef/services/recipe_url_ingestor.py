"""Recipe URL ingestor service.

Extracts structured RecipeCard data from a URL. YouTube links (issue #528) skip
the tiers below: Gemini watches the video itself via ``AIManager.video_complete``.
Everything else uses a three-tier strategy:
1. recipe-scrapers scrape_html (known site via Schema.org, supported_only=True default)
2. recipe-scrapers scrape_html with supported_only=False (unknown site with Schema markup)
3. AI fallback via AIManager (Gemini → Ollama) from raw HTML
"""

import logging
import re
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx

from bubbly_chef.models.recipe import Ingredient, RecipeCard
from bubbly_chef.prompts.recipe_url import (
    _AI_EXTRACTION_PROMPT,
    _AI_NO_FETCH_PROMPT,
    _AI_VIDEO_PROMPT,
)
from bubbly_chef.services.recipe_import_errors import (
    classify_video_error,
    not_a_recipe,
    video_failed,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Re-exports that tests can patch at the module level
# ---------------------------------------------------------------------------

try:
    from recipe_scrapers import scrape_html, scrape_me  # type: ignore[import-untyped,unused-ignore]
except ImportError as _e:
    raise ImportError(
        "recipe-scrapers is not installed. Run: pip install recipe-scrapers"
    ) from _e


async def httpx_get(url: str) -> str:
    """Fetch raw HTML from a URL. Extracted so tests can patch it."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }
    async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as c:
        r = await c.get(url, headers=headers)
        r.raise_for_status()
        return r.text


def get_ai_manager() -> Any:  # noqa: ANN401
    """Return the singleton AIManager from deps."""
    from bubbly_chef.api.deps import get_ai_manager as _get
    return _get()


# ---------------------------------------------------------------------------
# Ingredient / servings parsing helpers
# ---------------------------------------------------------------------------

_YIELD_RE = re.compile(r"(\d+)")


def _parse_servings(yields_str: str | None) -> int | None:
    """Extract integer servings from a yields string like '4 servings'."""
    if not yields_str:
        return None
    m = _YIELD_RE.search(yields_str)
    return int(m.group(1)) if m else None


def _parse_ingredient(raw: str) -> Ingredient:
    """Convert a raw ingredient string to an Ingredient model."""
    return Ingredient(name=raw.strip())


def _scraper_to_recipe_card(scraper: Any, url: str) -> RecipeCard:  # noqa: ANN401
    """Convert a recipe-scrapers scraper object into a RecipeCard."""

    def _safe(fn: Any, default: Any = None) -> Any:  # noqa: ANN401
        try:
            return fn()
        except Exception:
            return default

    title: str = _safe(scraper.title) or "Untitled Recipe"
    raw_ingredients: list[str] = _safe(scraper.ingredients, [])
    instructions: list[str] = _safe(scraper.instructions_list, [])
    total_time: int | None = _safe(scraper.total_time)
    yields_str: str | None = _safe(scraper.yields)
    description: str | None = _safe(scraper.description)
    image: str | None = _safe(scraper.image)
    logger.info(f"[scraper] title={title!r} image={image!r}")

    return RecipeCard(
        title=title,
        description=description,
        source_url=url,
        source_type="url",
        image_url=image,
        thumbnail_url=image,
        total_time_minutes=total_time,
        servings=_parse_servings(yields_str),
        ingredients=[_parse_ingredient(i) for i in raw_ingredients],
        instructions=instructions,
    )


# ---------------------------------------------------------------------------
# YouTube video import (issue #528)
# ---------------------------------------------------------------------------

_YOUTUBE_HOSTS = frozenset({"youtube.com", "www.youtube.com", "m.youtube.com"})
_YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def youtube_video_id(url: str) -> str | None:
    """Return the video ID for a YouTube Shorts / watch / youtu.be link, else None.

    Only an exact host match counts (``notyoutube.com`` and
    ``youtube.com.evil.example`` do not), and only video links: a channel,
    playlist or the homepage return None and keep going down the scraper tiers.
    """
    try:
        parsed = urlparse(url.strip())
        host = (parsed.hostname or "").lower()
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    candidate: str | None = None
    if host == "youtu.be":
        candidate = parsed.path.lstrip("/").split("/")[0]
    elif host in _YOUTUBE_HOSTS:
        if parsed.path == "/watch":
            values = parse_qs(parsed.query).get("v")
            candidate = values[0] if values else None
        elif parsed.path.startswith("/shorts/"):
            candidate = parsed.path[len("/shorts/") :].split("/")[0]
    if candidate and _YOUTUBE_ID_RE.match(candidate):
        return candidate
    return None


async def ingest_recipe_from_video(url: str) -> RecipeCard:
    """Extract a RecipeCard from a YouTube video by letting Gemini watch it.

    Raises:
        RecipeImportError: with a sanitized ``reason`` — ``not_a_recipe`` when
            the video holds no recipe, ``video_unavailable`` for a private /
            removed / age-restricted video, ``video_timeout`` / ``video_failed``
            for provider trouble. Nothing from the underlying exception reaches
            the caller; it is logged here.
        ValueError: ``url`` is not a YouTube video link.
    """
    video_id = youtube_video_id(url)
    if video_id is None:
        raise ValueError(f"Not a YouTube video URL: {url!r}")

    ai_manager = get_ai_manager()
    try:
        # Gemini is handed the canonical watch URL whatever link shape the user
        # pasted (Shorts, youtu.be, mobile).
        result = await ai_manager.video_complete(
            prompt=_AI_VIDEO_PROMPT,
            video_url=f"https://www.youtube.com/watch?v={video_id}",
            response_schema=RecipeCard,
        )
    except Exception as e:
        logger.error(f"Video recipe import failed for {url!r}: {e}", exc_info=True)
        raise classify_video_error(e) from e

    if not isinstance(result, RecipeCard):
        logger.error(f"Video recipe import returned unexpected type: {type(result)}")
        raise video_failed()

    # The prompt tells the model to return an empty card for a non-recipe video.
    # A card with no ingredients and no steps is not a recipe whatever its title.
    if not result.ingredients and not result.instructions:
        logger.info(f"Video {video_id} is not a recipe (empty card): {result.title!r}")
        raise not_a_recipe()

    result.source_url = url
    result.source_type = "video"
    result.image_url = None
    result.thumbnail_url = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    logger.info(f"[video] title={result.title!r} ingredients={len(result.ingredients)}")
    return result


# ---------------------------------------------------------------------------
# Main extraction function
# ---------------------------------------------------------------------------


async def ingest_recipe_from_url(url: str) -> RecipeCard:
    """
    Extract a RecipeCard from a URL.

    Strategy (in order):
    1. recipe-scrapers strict mode (known sites, supported_only=True)
    2. recipe-scrapers with supported_only=False (unknown sites with Schema.org markup)
    3. AI extraction from raw HTML via AIManager

    YouTube links skip all of this and go to ``ingest_recipe_from_video``.
    """
    if youtube_video_id(url) is not None:
        return await ingest_recipe_from_video(url)

    # ── Tier 1: scraper strict (known sites) ─────────────────────────────
    # scrape_me fetches HTML internally; on failure we fall through.
    try:
        scraper = scrape_me(url)
        logger.info(f"recipe-scrapers (strict) succeeded for {url}")
        return _scraper_to_recipe_card(scraper, url)
    except Exception as e:
        logger.info(
            f"recipe-scrapers strict failed ({type(e).__name__}: {e}), trying wild_mode"
        )

    # ── Fetch HTML once — reused by Tiers 2 and 3 ────────────────────────
    html: str | None = None
    try:
        html = await httpx_get(url)
    except httpx.HTTPStatusError as e:
        logger.warning(
            f"HTTP {e.response.status_code} fetching {url} — skipping scraper tiers, "
            "falling directly to AI extraction"
        )
    except Exception as e:
        logger.warning(f"Failed to fetch {url}: {e} — falling directly to AI extraction")

    if html is not None:
        # ── Tier 2: scrape_html with supported_only=False (Schema.org fallback) ──
        try:
            scraper = scrape_html(html, org_url=url, supported_only=False)
            logger.info(f"recipe-scrapers (supported_only=False) succeeded for {url}")
            return _scraper_to_recipe_card(scraper, url)
        except Exception as e:
            logger.info(
                f"recipe-scrapers wild fallback failed ({type(e).__name__}: {e}), "
                "falling to AI"
            )

    # ── Tier 3: AI extraction ─────────────────────────────────────────────
    logger.info(f"Attempting AI extraction for {url}")
    if html is not None:
        prompt = _AI_EXTRACTION_PROMPT.format(source_url=url, html=html[:8000])
        no_fetch = False
    else:
        prompt = _AI_NO_FETCH_PROMPT.format(source_url=url)
        no_fetch = True
    ai_manager = get_ai_manager()
    result = await ai_manager.complete(prompt=prompt, response_schema=RecipeCard)

    if isinstance(result, RecipeCard):
        result.source_url = url
        result.source_type = "url"
        if no_fetch:
            # Gemini hallucinates CDN URLs for blocked sites — always invalid, never serve them
            result.image_url = None
            result.thumbnail_url = None
        else:
            if result.image_url and not result.thumbnail_url:
                result.thumbnail_url = result.image_url
        logger.info(f"[ai] title={result.title!r} image_url={result.image_url!r} thumbnail_url={result.thumbnail_url!r}")
        return result

    # Shouldn't happen but guard anyway
    raise RuntimeError(f"AI extraction returned unexpected type: {type(result)}")
