"""Health check endpoint."""

from fastapi import APIRouter
from pydantic import BaseModel

from bubbly_chef import __version__
from bubbly_chef.config import settings
from bubbly_chef.tools.llm_client import get_ollama_client


router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    version: str
    ollama_available: bool
    ollama_model: str


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """
    Health check endpoint.

    Returns service status and dependency availability.
    """
    llm = get_ollama_client()
    ollama_available = await llm.is_available()

    return HealthResponse(
        status="healthy",
        version=__version__,
        ollama_available=ollama_available,
        ollama_model=settings.ollama_model,
    )
