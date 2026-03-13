"""FastAPI application factory and configuration."""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from bubbly_chef import __version__
from bubbly_chef.config import settings
from bubbly_chef.repository.sqlite import get_repository
from bubbly_chef.tools.llm_client import get_ollama_client


# Configure logging
logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application lifespan manager.

    Handles startup and shutdown tasks.
    """
    # Startup
    logger.info(f"Starting {settings.app_name} v{__version__}")

    # Initialize repository
    repo = await get_repository()
    logger.info("Database initialized")

    # Check Ollama availability
    llm = get_ollama_client()
    if await llm.is_available():
        logger.info(f"Ollama available with model: {llm.model}")
    else:
        logger.warning(
            f"Ollama not available at {llm.base_url} or model {llm.model} not found. "
            "LLM features will fail until Ollama is running."
        )

    yield

    # Shutdown
    logger.info("Shutting down...")
    await repo.close()
    await llm.close()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""

    app = FastAPI(
        title=settings.app_name,
        description="AI-first agentic workflow service for pantry and recipe management",
        version=__version__,
        lifespan=lifespan,
    )

    # CORS middleware for mobile app
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Configure appropriately for production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register routers
    from bubbly_chef.api.routes import health, ingest, pantry, apply, chat, recipes, scan, profile

    app.include_router(health.router)
    app.include_router(ingest.router)
    app.include_router(pantry.router)
    app.include_router(apply.router)
    app.include_router(chat.router)
    app.include_router(recipes.router)
    app.include_router(scan.router)
    app.include_router(profile.router)

    return app


# Create app instance
app = create_app()
