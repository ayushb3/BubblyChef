"""DuckDuckGo recipe search + snippet extraction.

Per CLAUDE.md workaround: uses the DuckDuckGo HTML endpoint (no API key needed).
Fetch URL format: https://duckduckgo.com?q=your+query+separated+with+plus
"""

import logging
import re
from urllib.parse import quote_plus

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)

_TIME_PATTERN = re.compile(r"(\d+)\s*(hour|hr|minute|min)s?", re.IGNORECASE)
_BOLD_PATTERN = re.compile(r"<b>(.*?)</b>", re.IGNORECASE)
_STRIP_TAGS = re.compile(r"<[^>]+>")
# DuckDuckGo result snippet block
_SNIPPET_PATTERN = re.compile(
    r'class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</(?:a|div|span)>',
    re.IGNORECASE | re.DOTALL,
)
_RESULT_URL_PATTERN = re.compile(
    r'class="[^"]*result__url[^"]*"[^>]*>\s*(.*?)\s*</(?:a|div|span)>',
    re.IGNORECASE | re.DOTALL,
)
_RESULT_TITLE_PATTERN = re.compile(
    r'class="[^"]*result__a[^"]*"[^>]*>(.*?)</a>',
    re.IGNORECASE | re.DOTALL,
)

# Simple heuristic: common ingredient nouns found in snippets
_INGREDIENT_WORDS = {
    "chicken", "beef", "pork", "lamb", "tofu", "shrimp", "fish", "salmon",
    "garlic", "onion", "ginger", "tomato", "potato", "carrot", "celery",
    "rice", "pasta", "noodles", "bread", "flour", "butter", "oil",
    "egg", "eggs", "milk", "cream", "cheese", "yogurt",
    "soy sauce", "olive oil", "sesame oil", "vinegar",
    "salt", "pepper", "cumin", "paprika", "turmeric", "basil", "thyme",
    "lemon", "lime", "orange", "apple", "banana",
    "beans", "lentils", "chickpeas", "spinach", "broccoli", "mushroom",
}

# Technique words extracted from snippet
_TECHNIQUE_WORDS = {
    "stir-fry", "stir fry", "bake", "roast", "grill", "simmer", "sauté",
    "saute", "steam", "broil", "poach", "fry", "deep-fry", "braise",
    "pressure cook", "slow cook",
}


class RecipeSearchResult(BaseModel):
    """Extracted recipe info from a web search snippet."""

    title: str
    source_url: str
    snippet: str
    key_ingredients: list[str]
    estimated_time_minutes: int | None
    technique_hint: str | None


def _extract_time(text: str) -> int | None:
    """Return estimated total minutes from free text, or None."""
    total = 0
    found = False
    for match in _TIME_PATTERN.finditer(text):
        val = int(match.group(1))
        unit = match.group(2).lower()
        if unit.startswith("hour") or unit.startswith("hr"):
            total += val * 60
        else:
            total += val
        found = True
    return total if found else None


def _extract_ingredients(text: str) -> list[str]:
    """Heuristically extract ingredient names from snippet text."""
    text_lower = text.lower()
    found = []
    for ing in _INGREDIENT_WORDS:
        if ing in text_lower:
            found.append(ing)
    return found[:10]  # cap to keep payload small


def _extract_technique(text: str) -> str | None:
    """Return first cooking technique found in text, or None."""
    text_lower = text.lower()
    for technique in _TECHNIQUE_WORDS:
        if technique in text_lower:
            return technique
    return None


def _strip_html(text: str) -> str:
    """Strip HTML tags and decode common entities."""
    text = _BOLD_PATTERN.sub(r"\1", text)
    text = _STRIP_TAGS.sub("", text)
    return (
        text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ")
        .strip()
    )


async def search_recipe(
    query: str,
    cuisine_tag: str | None = None,
) -> RecipeSearchResult | None:
    """
    Fetch DuckDuckGo search results for a recipe query.

    Uses the DuckDuckGo HTML endpoint (no API key needed).
    Returns None if the search fails or no results are found.
    """
    search_query = f"{query} recipe"
    if cuisine_tag:
        search_query = f"{cuisine_tag} {search_query}"

    url = f"https://duckduckgo.com/html/?q={quote_plus(search_query)}"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    }

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=5.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            html = response.text
    except httpx.TimeoutException:
        logger.warning("DuckDuckGo search timed out for query: %s", query)
        return None
    except httpx.HTTPError as exc:
        logger.warning("DuckDuckGo search HTTP error: %s", exc)
        return None

    # Extract first result title
    title_match = _RESULT_TITLE_PATTERN.search(html)
    raw_title = _strip_html(title_match.group(1)) if title_match else query

    # Extract first result URL
    url_match = _RESULT_URL_PATTERN.search(html)
    source_url = _strip_html(url_match.group(1)) if url_match else ""
    if not source_url.startswith("http"):
        source_url = "https://" + source_url if source_url else ""

    # Extract first snippet
    snippet_match = _SNIPPET_PATTERN.search(html)
    raw_snippet = _strip_html(snippet_match.group(1)) if snippet_match else ""

    if not raw_snippet:
        logger.debug("No snippet found in DuckDuckGo results for: %s", query)
        return None

    combined_text = f"{raw_title} {raw_snippet}"

    return RecipeSearchResult(
        title=raw_title or query,
        source_url=source_url,
        snippet=raw_snippet,
        key_ingredients=_extract_ingredients(combined_text),
        estimated_time_minutes=_extract_time(combined_text),
        technique_hint=_extract_technique(combined_text),
    )
