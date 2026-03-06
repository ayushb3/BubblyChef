"""FastAPI application factory and configuration."""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from bubbly_chef.config import settings
from bubbly_chef.logger import setup_logging, get_logger

# Initialize logging first
setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application lifespan manager.

    Handles startup and shutdown tasks.
    """
    from bubbly_chef.api.deps import get_ai_manager
    from bubbly_chef.repository.sqlite import get_repository

    # Startup
    logger.info(f"Starting {settings.app_name} v{settings.app_version}")

    # Initialize repository
    repo = await get_repository()
    logger.info("Database initialized")

    # Check AI provider availability
    ai_manager = get_ai_manager()
    status = await ai_manager.health_check()

    if status["healthy"]:
        available = [p["name"] for p in status["providers"] if p["available"]]
        logger.info(f"AI providers available: {available}")
    else:
        logger.warning(
            "No AI providers available! "
            "Set BUBBLY_GEMINI_API_KEY or run Ollama locally."
        )

    yield

    # Shutdown
    logger.info("Shutting down...")
    await repo.close()
    await ai_manager.close()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""

    app = FastAPI(
        title=settings.app_name,
        description="AI-powered pantry and recipe assistant",
        version=settings.app_version,
        lifespan=lifespan,
    )

    # Logging middleware (should be first)
    from bubbly_chef.api.middleware import LoggingMiddleware

    app.add_middleware(LoggingMiddleware)

    # CORS middleware for web app
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register routers
    from bubbly_chef.api.routes import health, pantry, scan

    # Health routes (no prefix)
    app.include_router(health.router)

    # API routes
    app.include_router(pantry.router, prefix=settings.api_v1_prefix)
    app.include_router(scan.router, prefix=settings.api_v1_prefix)

    # TODO: Add these as they're implemented
    # app.include_router(recipes.router, prefix=settings.api_v1_prefix)
    # app.include_router(chat.router, prefix=settings.api_v1_prefix)

    return app


# Create app instance
app = create_app()
