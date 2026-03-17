"""Health check endpoint."""

from fastapi import APIRouter
from pydantic import BaseModel

from bubbly_chef import __version__
from bubbly_chef.api.deps import get_ai_manager

router = APIRouter(tags=["Health"])


class AIProviderStatus(BaseModel):
    name: str
    available: bool


class HealthResponse(BaseModel):
    status: str
    version: str
    ai_available: bool
    ai_providers: list[AIProviderStatus]


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Health check — returns service status and AI provider availability."""
    ai_manager = get_ai_manager()
    health = await ai_manager.health_check()

    providers = [
        AIProviderStatus(name=p["name"], available=p["available"]) for p in health["providers"]
    ]

    return HealthResponse(
        status="healthy",
        version=__version__,
        ai_available=health["healthy"],
        ai_providers=providers,
    )


@router.get("/health/ai", response_model=HealthResponse)
async def ai_health_check() -> HealthResponse:
    """Detailed AI provider health — used by frontend to surface configuration warnings."""
    return await health_check()
