"""BubblyChef AI Microservice — slimmed FastAPI app.

Serves only AI-powered endpoints:
- Chat (streaming + non-streaming)
- Receipt scanning (OCR + parsing)
- Recipe generation, suggestions, refinement
- Workflow events (approve/reject proposals)
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from bubbly_chef.api.routes import chat, ingest, recipes_ai, scan, workflows
from bubbly_chef.config import settings
from bubbly_chef.repository.supabase_repo import get_repository

import logging

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
    async def health_root() -> dict[str, Any]:
        return {"status": "ok"}

    @app.get("/health/ai")
    async def health() -> dict[str, Any]:
        providers = []
        if settings.gemini_api_key:
            providers.append({"name": "gemini", "available": True})
        if settings.ollama_base_url:
            providers.append({"name": "ollama", "available": True})
        return {
            "status": "ok",
            "service": "ai-microservice",
            "ai_available": len(providers) > 0,
            "providers": providers,
        }

    # AI routes
    app.include_router(chat.router)
    app.include_router(scan.router)
    app.include_router(recipes_ai.router)
    app.include_router(workflows.router)
    app.include_router(ingest.router)

    return app


app = create_app()
