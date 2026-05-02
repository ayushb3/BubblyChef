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
    from recipe_scrapers import scrape_html, scrape_me  # type: ignore[import-untyped,unused-ignore]
except ImportError as _e:
    raise ImportError(
        "recipe-scrapers is not installed. Run: pip install recipe-scrapers"
    ) from _e


async def httpx_get(url: str) -> str:
    """Fetch raw HTML from a URL. Extracted so tests can patch it."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (compatible; BubblyChef/1.0; +https://bubbly-chef.app)"
        )
    }
    async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as c:
        r = await c.get(url, headers=headers)
        r.raise_for_status()
        return r.text


def get_ai_manager() -> Any:  # noqa: ANN401
    """Return the configured AIManager. Extracted so tests can patch it."""
    from bubbly_chef.ai.manager import AIManager
    from bubbly_chef.ai.provider import AIProvider
    from bubbly_chef.config import settings

    providers: list[AIProvider] = []
    if settings.gemini_api_key:
        from bubbly_chef.ai.gemini import GeminiProvider

        providers.append(GeminiProvider(api_key=settings.gemini_api_key))
    return AIManager(providers=providers)


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

    return RecipeCard(
        title=title,
        description=description,
        source_url=url,
        source_type="url",
        image_url=image,
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
- source_type: "url"
- source_url: "{source_url}"

HTML (truncated to first 8000 chars):
{html}
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
    # If we have HTML, extract from it. If the site blocked us, ask Gemini
    # to recall the recipe from its training data using the URL as context.
    logger.info(f"Attempting AI extraction for {url}")
    if html is not None:
        prompt = _AI_EXTRACTION_PROMPT.format(source_url=url, html=html[:8000])
    else:
        prompt = (
            f"Extract the recipe from this URL: {url}\n\n"
            "The page could not be fetched directly. Use your knowledge of this recipe "
            "to fill in the details as accurately as possible.\n\n"
            + _AI_EXTRACTION_PROMPT.split("HTML")[0].replace("{source_url}", url).replace("{html}", "")
        )
    ai_manager = get_ai_manager()
    result = await ai_manager.complete(prompt=prompt, response_schema=RecipeCard)

    if isinstance(result, RecipeCard):
        result.source_url = url
        result.source_type = "url"
        return result

    # Shouldn't happen but guard anyway
    raise RuntimeError(f"AI extraction returned unexpected type: {type(result)}")
