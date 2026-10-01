"""The user's stored expiry-priority setting (issue #502, Spec B.10).

Reads `user_profiles.expiry_priority`. A profile that is missing, unreachable, or has
no such column yet (migration 00018 may not have run) degrades to Gentle, the level
every user had before the setting existed, and never raises: a settings lookup
failure must not break recipe generation.
"""

import logging

from bubbly_chef.domain.expiry_priority import (
    DEFAULT_EXPIRY_PRIORITY,
    ExpiryPriority,
    coerce_expiry_priority,
)
from bubbly_chef.repository.supabase_repo import get_repository

logger = logging.getLogger(__name__)


async def get_stored_expiry_priority(user_id: str) -> ExpiryPriority:
    """The user's saved expiry priority, or Gentle. Never raises."""
    if not user_id:
        return DEFAULT_EXPIRY_PRIORITY
    try:
        repo = await get_repository()
        profile = await repo.get_profile(user_id)
    except Exception as e:  # noqa: BLE001 — a settings lookup failure must degrade, not raise
        logger.warning("Could not fetch expiry priority for %s: %s", user_id, e)
        return DEFAULT_EXPIRY_PRIORITY
    if not profile:
        return DEFAULT_EXPIRY_PRIORITY
    return coerce_expiry_priority(profile.get("expiry_priority"))
