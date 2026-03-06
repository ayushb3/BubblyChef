"""Health check endpoints."""

from fastapi import APIRouter
from pydantic import BaseModel

from bubbly_chef.config import settings

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    """Basic health check response."""

    status: str
    version: str


class AIHealthResponse(BaseModel):
    """AI provider health check response."""

    healthy: bool
    available_count: int
    providers: list[dict]


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Basic health check endpoint."""
    return HealthResponse(
        status="healthy",
        version=settings.app_version,
    )


@router.get("/health/ai", response_model=AIHealthResponse)
async def ai_health_check() -> AIHealthResponse:
    """
    Check AI provider availability.

    Returns status of all configured AI providers.
    """
    from bubbly_chef.api.deps import get_ai_manager

    manager = get_ai_manager()
    status = await manager.health_check()

    return AIHealthResponse(
        healthy=status["healthy"],
        available_count=status["available_count"],
        providers=status["providers"],
    )
