"""Kitchen decoration routes."""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from bubbly_chef.repository.sqlite import SQLiteRepository, get_repository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/decorations", tags=["Decorations"])

# Milestone definitions: (item_count_threshold, decoration_name)
MILESTONES: list[tuple[int, str]] = [
    (5, "flower_pot"),
    (10, "cactus"),
    (20, "herb_garden"),
]


async def run_milestone_check(repo: SQLiteRepository) -> list[str]:
    """Check pantry count against milestones and unlock decorations.

    Returns list of newly unlocked decoration names.
    """
    count = await repo.count_pantry_items()
    unlocked: list[str] = []
    for threshold, name in MILESTONES:
        if count >= threshold:
            if await repo.unlock_decoration(name):
                unlocked.append(name)
                logger.info("Decoration unlocked: %s (pantry count: %d)", name, count)
    return unlocked


@router.get("", summary="List all kitchen decorations")
async def list_decorations() -> list[dict[str, Any]]:
    """Return all decorations and their unlock status."""
    logger.info("GET /decorations")
    repo = await get_repository()
    return await repo.get_all_decorations()


@router.get("/milestone-check", summary="Check milestone and auto-unlock")
async def milestone_check() -> dict[str, Any]:
    """Check pantry count against milestones and unlock appropriate decorations."""
    logger.info("GET /decorations/milestone-check")
    repo = await get_repository()
    count = await repo.count_pantry_items()
    unlocked = await run_milestone_check(repo)
    return {"pantry_count": count, "newly_unlocked": unlocked}


KNOWN_DECORATIONS = {name for _, name in MILESTONES}


@router.post(
    "/{name}/unlock",
    summary="Unlock a kitchen decoration",
)
async def unlock_decoration(name: str) -> dict[str, Any]:
    """Unlock a decoration by name. Returns whether it was newly unlocked."""
    if name not in KNOWN_DECORATIONS:
        raise HTTPException(status_code=404, detail=f"Unknown decoration: {name}")
    logger.info("POST /decorations/%s/unlock", name)
    repo = await get_repository()
    newly_unlocked = await repo.unlock_decoration(name)
    return {"name": name, "newly_unlocked": newly_unlocked}
