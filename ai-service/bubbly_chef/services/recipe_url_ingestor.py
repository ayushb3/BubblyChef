"""Recipe URL ingestor service.

Extracts structured RecipeCard data from a URL using a three-tier strategy:
1. recipe-scrapers scrape_html (known site via Schema.org, supported_only=True default)
2. recipe-scrapers scrape_html with supported_only=False (unknown site with Schema markup)
3. AI fallback via AIManager (Gemini → Ollama) from raw HTML
"""

import logging
import re
from typing import Any

import httpx

from bubbly_chef.models.recipe import Ingredient, RecipeCard

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Re-exports that tests can patch at the module level
# ---------------------------------------------------------------------------

try:
    from recipe_scrapers import scrape_html, scrape_me
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
# AI extraction prompt
# ---------------------------------------------------------------------------

_AI_EXTRACTION_PROMPT = """\
You are a recipe extraction assistant. Extract the recipe from the HTML below and return \
a structured JSON object matching the RecipeCard schema exactly.

Rules:
- title: string (required)
- description: string or null
- ingredients: list of objects with "name" (required), "quantity" (float|null), \
"unit" (str|null), "preparation" (str|null), "optional" (bool), "substitutes" (list[str])
- instructions: list of strings, each a single step
- prep_time_minutes: integer or null
- cook_time_minutes: integer or null
- total_time_minutes: integer or null
- servings: integer or null
- cuisine: string or null (e.g. "Italian", "Mexican")
- dietary_tags: list of strings (e.g. ["vegan", "gluten-free"])
- image_url: string or null (the recipe's primary image URL, if present in the page)
- source_type: "url"
- source_url: "{source_url}"

HTML (truncated to first 8000 chars):
{html}
"""

_AI_NO_FETCH_PROMPT = """\
Extract the recipe at the URL below. The page could not be fetched directly, so use your
training knowledge of this specific recipe page to fill in details accurately.

Return a JSON object with these fields:
- title: string (required)
- description: string or null
- ingredients: list of objects with "name" (required), "quantity" (float|null), \
"unit" (str|null), "preparation" (str|null), "optional" (bool), "substitutes" (list[str])
- instructions: list of strings, each a single step
- prep_time_minutes: integer or null
- cook_time_minutes: integer or null
- total_time_minutes: integer or null
- servings: integer or null
- cuisine: string or null
- dietary_tags: list of strings
- source_type: "url"
- source_url: "{source_url}"

Do NOT include image_url — omit it entirely or set it to null.

URL: {source_url}
"""


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
    """
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
        logger.info(
            f"[ai] title={result.title!r} image_url={result.image_url!r} "
            f"thumbnail_url={result.thumbnail_url!r}"
        )
        return result

    # Shouldn't happen but guard anyway
    raise RuntimeError(f"AI extraction returned unexpected type: {type(result)}")
