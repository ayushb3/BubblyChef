"""Dashboard routes for the BubblyChef AI microservice.

Exposes:
- GET /v1/dashboard/daily — AI-generated, per-user daily tip plus a
  deterministically-ranked, pantry-aware recipe suggestion (#225, #168).

See `docs/plans/2026-09-04-dashboard-daily-endpoint.md` for the full design.
The route stays thin — everything lives in `services/dashboard_service.py`.
"""

import logging

from fastapi import APIRouter, Depends, Query

from bubbly_chef.api.auth import get_current_user_id
from bubbly_chef.api.deps import get_ai_manager
from bubbly_chef.models.dashboard import DashboardDailyResponse
from bubbly_chef.repository.supabase_repo import get_repository
from bubbly_chef.services.dashboard_service import get_dashboard_daily

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/dashboard", tags=["dashboard"])


@router.get(
    "/daily",
    response_model=DashboardDailyResponse,
    summary="AI-generated daily tip + pantry-aware recipe suggestion",
    responses={
        200: {"description": "Tip and (possibly null) recipe suggestion"},
        401: {"description": "Missing or invalid JWT"},
        422: {"description": "tz_offset_minutes out of range"},
    },
)
async def get_daily(
    user_id: str = Depends(get_current_user_id),
    tz_offset_minutes: int = Query(
        default=0,
        ge=-720,
        le=840,
        description=(
            "The client's local UTC offset in MINUTES, using the standard "
            "UTC-offset sign convention: the number of minutes to ADD to UTC "
            "to reach local time (UTC+2 -> 120, UTC-5 -> -300). "
            "IMPORTANT — this is the NEGATION of JavaScript's "
            "`Date.prototype.getTimezoneOffset()`, which returns the opposite "
            "sign: pass `-date.getTimezoneOffset()`, not the raw value. "
            "Used to bucket the meal-time ranking signal and to localize the "
            "per-day cache key, so the suggestion agrees with the user's own "
            "clock instead of the server's (UTC on Railway). Defaults to 0 "
            "(UTC) if the client omits it."
        ),
    ),
) -> DashboardDailyResponse:
    """Return today's tip and suggestion for the authenticated user.

    Never errors on AI unavailability — degrades to `source: "fallback"`.
    """
    repo = await get_repository()
    ai_manager = get_ai_manager()
    return await get_dashboard_daily(
        user_id, ai_manager=ai_manager, repo=repo, tz_offset_minutes=tz_offset_minutes
    )
