"""BubblyChef AI Microservice — slimmed FastAPI app.

Serves only AI-powered endpoints:
- Chat (streaming + non-streaming)
- Receipt scanning (OCR + parsing)
- Recipe generation, suggestions, refinement
- Workflow events (approve/reject proposals)
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from bubbly_chef.api.routes import chat, dashboard, ingest, pantry, recipes_ai, scan, workflows
from bubbly_chef.config import settings
from bubbly_chef.repository.supabase_repo import get_repository

# Register URL extractor into the ingest dispatcher at import time.
# This module-level import triggers dispatcher.register_url_extractor() inside
# url_extractor.py, mirroring how ingest_dispatcher.py self-registers the receipt
# extractor.  Must come after bubbly_chef packages are importable.
import bubbly_chef.services.url_extractor as _url_extractor_registration  # noqa: F401

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup and shutdown."""
    logger.info(f"Starting {settings.app_name}")

    # Initialize repository (Supabase — just validates connection)
    await get_repository()
    logger.info("Supabase repository initialized")

    # Check AI providers
    if settings.gemini_api_key:
        logger.info("Gemini API key configured")
    else:
        logger.warning("No Gemini API key — AI features may be limited")

    yield

    logger.info("Shutting down AI service")


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        description="AI microservice for BubblyChef — chat, recipes, OCR",
        version="1.0.0",
        lifespan=lifespan,
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Health check
    @app.get("/health")
    async def health_root() -> dict:
        return {"status": "ok"}

    @app.get("/health/ai")
    async def health() -> dict:
        # Ask the actual AIManager which providers are registered and
        # reachable, rather than reconstructing from raw settings — this
        # reflects the real config (incl. the dev SAP-proxy provider).
        from bubbly_chef.api.deps import get_ai_manager

        status = await get_ai_manager().health_check()
        return {
            "status": "ok",
            "service": "ai-microservice",
            "ai_available": status["healthy"],
            "providers": status["providers"],
        }

    # AI routes
    app.include_router(chat.router)
    app.include_router(scan.router)
    app.include_router(recipes_ai.router)
    app.include_router(workflows.router)
    app.include_router(ingest.router)
    app.include_router(pantry.router)
    app.include_router(dashboard.router)

    return app


app = create_app()
