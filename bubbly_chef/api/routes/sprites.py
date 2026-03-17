"""Sprite endpoints — generate, serve, and approve food item pixel art sprites."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from bubbly_chef.domain.normalizer import normalize_food_name
from bubbly_chef.repository.sqlite import get_repository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sprites", tags=["Sprites"])


class GenerateSpriteRequest(BaseModel):
    item_name: str


class SpriteInfo(BaseModel):
    item_name: str
    status: str
    image_url: str


async def _generate_and_save(item_name: str) -> None:
    """Background task: generate sprite and persist as pending."""
    from bubbly_chef.services.sprite_generator import generate_sprite

    try:
        png_bytes = await generate_sprite(item_name)
        repo = await get_repository()
        await repo.save_sprite(item_name, png_bytes, status="approved")
        logger.info(f"Background sprite saved for '{item_name}'")
    except Exception as exc:
        logger.warning(f"Sprite generation failed for '{item_name}': {exc}")


@router.get(
    "/{item_name}",
    summary="Serve approved sprite PNG for an item",
    responses={
        200: {"content": {"image/png": {}}, "description": "64x64 PNG sprite"},
        404: {"description": "No approved sprite for this item"},
    },
)
async def get_sprite(item_name: str) -> Response:
    """Return the approved 64x64 PNG sprite for a food item, or 404."""
    normalized = normalize_food_name(item_name)
    repo = await get_repository()
    sprite = await repo.get_sprite(normalized)

    if sprite is None or sprite["status"] != "approved":
        raise HTTPException(status_code=404, detail="No approved sprite for this item")

    return Response(content=sprite["image_data"], media_type="image/png")


@router.post(
    "/generate",
    response_model=SpriteInfo,
    summary="Trigger sprite generation for an item",
)
async def generate_sprite_endpoint(
    body: GenerateSpriteRequest,
    background_tasks: BackgroundTasks,
) -> SpriteInfo:
    """
    Trigger background sprite generation for an item.

    If a sprite already exists (any status), returns its current info.
    Otherwise queues generation and returns status='queued'.
    """
    normalized = normalize_food_name(body.item_name)
    repo = await get_repository()
    existing = await repo.get_sprite(normalized)

    if existing:
        return SpriteInfo(
            item_name=normalized,
            status=existing["status"],
            image_url=f"/api/sprites/{normalized}",
        )

    background_tasks.add_task(_generate_and_save, normalized)
    logger.info(f"Queued sprite generation for '{normalized}'")

    return SpriteInfo(
        item_name=normalized,
        status="queued",
        image_url=f"/api/sprites/{normalized}",
    )


@router.post(
    "/{item_name}/approve",
    response_model=SpriteInfo,
    summary="Approve a pending sprite",
)
async def approve_sprite(item_name: str) -> SpriteInfo:
    """Set a pending sprite's status to approved, making it visible in the UI."""
    normalized = normalize_food_name(item_name)
    repo = await get_repository()
    approved = await repo.approve_sprite(normalized)

    if not approved:
        raise HTTPException(status_code=404, detail="No sprite found for this item")

    return SpriteInfo(
        item_name=normalized,
        status="approved",
        image_url=f"/api/sprites/{normalized}",
    )


@router.get(
    "/",
    summary="List all pending sprites awaiting approval",
)
async def list_pending() -> dict[str, Any]:
    """Return all sprites with status=pending (for admin review)."""
    repo = await get_repository()
    pending = await repo.list_pending_sprites()
    return {"pending": pending, "count": len(pending)}
