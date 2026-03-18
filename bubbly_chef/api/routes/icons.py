"""Icon serving endpoint with 3-tier fallback.

GET /api/icons/{name}
  Tier 1: Fluent Emoji PNG for exact/fuzzy match  → FileResponse 200
  Tier 2: Fluent Emoji PNG for item's category    → FileResponse 200
  Tier 3: JSON {"emoji": "📦", "category": "other"} → JSONResponse 200

Never returns 404.
"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, JSONResponse

from bubbly_chef.domain.catalog import categorize
from bubbly_chef.domain.icon_map import CATEGORY_EMOJI_MAP, CATEGORY_ICON_MAP, FOOD_ICON_MAP
from bubbly_chef.domain.normalizer import normalize_food_name

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/icons", tags=["icons"])

# Path to the Fluent Emoji PNG directory.
# icons.py lives at bubbly_chef/api/routes/icons.py
# Three parents up = project root
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
FLUENT_DIR = _PROJECT_ROOT / "web" / "public" / "food-icons" / "fluent"


def _serve_png(slug: str) -> FileResponse | None:
    """Return a FileResponse for slug.png if the file exists, else None."""
    png = FLUENT_DIR / f"{slug}.png"
    try:
        if png.exists():
            return FileResponse(str(png), media_type="image/png")
    except OSError:
        pass
    return None


@router.get("/{name}", summary="Get icon for a food item", response_model=None)
async def get_icon(name: str) -> FileResponse | JSONResponse:
    """Return a Fluent Emoji PNG or emoji JSON for a food item. Never returns 404."""
    if not name.strip():
        return JSONResponse({"emoji": "📦", "category": "other"})

    normalized = normalize_food_name(name)

    # Tier 1: exact slug match in FOOD_ICON_MAP
    slug = FOOD_ICON_MAP.get(normalized)
    if slug:
        response = _serve_png(slug)
        if response is not None:
            return response

    # Tier 2: category PNG fallback
    category = categorize(normalized) or "other"
    cat_slug = CATEGORY_ICON_MAP.get(category, "package")
    response = _serve_png(cat_slug)
    if response is not None:
        return response

    # Tier 3: emoji JSON fallback — always succeeds
    emoji = CATEGORY_EMOJI_MAP.get(category, "📦")
    logger.debug("Icon tier-3 fallback for '%s' (category=%s)", normalized, category)
    return JSONResponse({"emoji": emoji, "category": category})
