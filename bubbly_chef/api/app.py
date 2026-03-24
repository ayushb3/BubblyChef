"""FastAPI application factory and configuration."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from bubbly_chef import __version__
from bubbly_chef.config import settings
from bubbly_chef.logger import get_logger, setup_logging
from bubbly_chef.repository.sqlite import get_repository
from bubbly_chef.tools.llm_client import get_ollama_client

# Initialize structured logging (replaces basicConfig)
setup_logging()

logger = get_logger(__name__)


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

    # Check Gemini availability
    from bubbly_chef.api.deps import get_ai_manager

    if settings.gemini_api_key:
        ai_manager = get_ai_manager()
        gemini_providers = [p for p in ai_manager.providers if "gemini" in p.name]
        for p in gemini_providers:
            if await p.is_available():
                logger.info(f"Gemini available: {p.name}")
            else:
                logger.warning(
                    f"Gemini not available ({p.name}). Check that the model name is valid "
                    "and that the API key has access. LLM features will fall back to Ollama."
                )
    else:
        logger.warning(
            "BUBBLY_GEMINI_API_KEY not set. Gemini provider disabled. "
            "LLM features require Ollama to be running."
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
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Request/response logging middleware
    from bubbly_chef.api.middleware import LoggingMiddleware

    app.add_middleware(LoggingMiddleware)

    # Global exception handler — catches unhandled errors and logs them
    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.error(
            "Unhandled exception",
            extra={
                "method": request.method,
                "path": request.url.path,
                "error": str(exc),
                "error_type": type(exc).__name__,
            },
            exc_info=True,
        )
        return JSONResponse(
            status_code=500,
            content={
                "detail": f"Internal server error: {type(exc).__name__}: {exc}",
            },
        )

    # Register routers
    from bubbly_chef.api.routes import (  # noqa: E402
        apply,
        chat,
        decorations,
        health,
        icons,
        pantry,
        profile,
        recipes,
        scan,
    )

    app.include_router(health.router)
    app.include_router(pantry.router)
    app.include_router(apply.router)
    app.include_router(chat.router)
    app.include_router(recipes.router)
    app.include_router(scan.router)
    app.include_router(profile.router)
    app.include_router(icons.router)
    app.include_router(decorations.router)

    return app


# Create app instance
app = create_app()
