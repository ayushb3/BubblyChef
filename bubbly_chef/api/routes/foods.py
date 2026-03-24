"""Food library search endpoint for typeahead suggestions."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Query
from pydantic import BaseModel

from bubbly_chef.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/foods", tags=["Foods"])

_LIBRARY_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "food_library.json"


class FoodSearchResult(BaseModel):
    """A single food library entry for typeahead."""

    canonical: str
    category: str
    icon_slug: str | None
    valid_units: list[str]
    expiry_days: int
    default_location: str
    emoji: str


# Module-level cache: loaded once on first request.
_library: list[dict] | None = None


def _load_library() -> list[dict]:
    """Load food_library.json, caching for subsequent calls."""
    global _library
    if _library is not None:
        return _library

    if not _LIBRARY_PATH.is_file():
        logger.warning("food_library.json not found at %s", _LIBRARY_PATH)
        _library = []
        return _library

    try:
        with open(_LIBRARY_PATH) as f:
            _library = json.load(f)
        logger.info("Loaded food library: %d entries", len(_library))
    except (json.JSONDecodeError, OSError) as e:
        logger.error("Failed to load food library: %s", e)
        _library = []

    return _library


def _to_result(entry: dict) -> FoodSearchResult:
    return FoodSearchResult(
        canonical=entry["canonical"],
        category=entry["category"],
        icon_slug=entry.get("icon_slug"),
        valid_units=entry.get("valid_units", []),
        expiry_days=entry.get("expiry_days", 14),
        default_location=entry.get("default_location", "pantry"),
        emoji=entry.get("emoji", ""),
    )


@router.get("/search", response_model=list[FoodSearchResult])
async def search_foods(
    q: str = Query(default="", description="Search query (prefix or fuzzy)"),
    limit: int = Query(default=8, ge=1, le=50, description="Max results"),
) -> list[FoodSearchResult]:
    """
    Search the food library for typeahead suggestions.

    Returns items matching the query, sorted by relevance:
    1. Exact prefix matches on canonical name (highest priority)
    2. Fuzzy matches on canonical name + synonyms (using rapidfuzz WRatio)
    """
    library = _load_library()
    if not library:
        return []

    query = q.strip().lower()
    if not query:
        return [_to_result(e) for e in library[:limit]]

    # Phase 1: Exact prefix matches
    prefix_matches: list[dict] = []
    remaining: list[dict] = []

    for entry in library:
        canonical = entry["canonical"].lower()
        if canonical.startswith(query) or canonical == query:
            prefix_matches.append(entry)
        else:
            remaining.append(entry)

    # If we already have enough prefix matches, return early
    if len(prefix_matches) >= limit:
        return [_to_result(e) for e in prefix_matches[:limit]]

    # Phase 2: Fuzzy matches on remaining entries
    fuzzy_matches: list[tuple[float, dict]] = []
    try:
        from rapidfuzz.fuzz import WRatio
    except ImportError:
        logger.warning("rapidfuzz not installed; fuzzy search disabled")
        return [_to_result(e) for e in prefix_matches[:limit]]

    for entry in remaining:
        # Check canonical name
        canonical = entry["canonical"].lower()
        score = WRatio(query, canonical)
        if score >= 60:
            fuzzy_matches.append((score, entry))
            continue

        # Check synonyms
        synonyms: list[str] = entry.get("synonyms", [])
        best_syn_score = 0.0
        for syn in synonyms:
            syn_score = WRatio(query, syn.lower())
            if syn_score > best_syn_score:
                best_syn_score = syn_score
        if best_syn_score >= 60:
            fuzzy_matches.append((best_syn_score, entry))

    # Sort fuzzy by score descending
    fuzzy_matches.sort(key=lambda x: x[0], reverse=True)

    # Combine: prefix matches first, then fuzzy
    seen = {e["canonical"] for e in prefix_matches}
    results = [_to_result(e) for e in prefix_matches]

    for _, entry in fuzzy_matches:
        if entry["canonical"] not in seen and len(results) < limit:
            seen.add(entry["canonical"])
            results.append(_to_result(entry))

    return results[:limit]
