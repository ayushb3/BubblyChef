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

from bubbly_chef.api.routes import (
    chat,
    dashboard,
    grocery,
    ingest,
    meals_ai,
    pantry,
    recipes_ai,
    scan,
    workflows,
)
from bubbly_chef.config import settings
from bubbly_chef.repository.supabase_repo import get_repository

# Register URL extractor into the ingest dispatcher at import time.
# This module-level import triggers dispatcher.register_url_extractor() inside
# url_extractor.py, mirroring how ingest_dispatcher.py self-registers the receipt
# extractor.  Must come after bubbly_chef packages are importable.
import bubbly_chef.services.url_extractor as _url_extractor_registration  # noqa: F401

logging.basicConfig(level=logging.INFO)
# #515: httpx logs every outgoing request line (method + full URL, including
# query params) at INFO by default. The Gemini key now travels as a header
# rather than a `?key=...` query param, but this is a second, independent
# layer against the same class of leak — quieting httpx/httpcore to WARNING
# means neither library's own request logging can ever put a secret (this
# key or any other) into the service logs, regardless of how a future call
# site is written.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
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


def build_info() -> dict[str, str]:
    """Version/build block for health responses (agent-loop step 3).

    Lets a post-merge smoke test tell whether it's hitting the new deploy
    or a stale one still serving — read live from settings so a test can
    reload/patch `settings.git_sha` without restarting the app.
    """
    return {"git_sha": settings.resolved_git_sha, "app_version": "1.0.0"}


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
        return {"status": "ok", "version": build_info()}

    @app.get("/health/ai")
    async def health() -> dict:
        # Ask the actual AIManager which providers are registered and
        # reachable, rather than reconstructing from raw settings — this
        # reflects the real config (incl. the dev SAP-proxy provider).
        from bubbly_chef.api.deps import get_ai_manager

        # Always HTTP 200, even when the probe fails: Railway's deploy
        # healthcheck polls this path, and a spend cap must not block a deploy.
        # The outage shows in the body (`ai_available`, `generation_probe`).
        status = await get_ai_manager().health_check(
            generation_probe_ttl_seconds=settings.health_generation_probe_ttl_seconds,
            generation_probe_max_output_tokens=settings.health_generation_probe_max_output_tokens,
        )
        return {
            "status": "ok",
            "service": "ai-microservice",
            "ai_available": status["healthy"],
            "providers": status["providers"],
            "generation_probe": status.get("generation_probe"),
            "last_failure_kind": status.get("last_failure_kind"),
            "last_failure_at": status.get("last_failure_at"),
            "version": build_info(),
        }

    # AI routes
    app.include_router(chat.router)
    app.include_router(scan.router)
    app.include_router(recipes_ai.router)
    app.include_router(meals_ai.router)
    app.include_router(workflows.router)
    app.include_router(ingest.router)
    app.include_router(pantry.router)
    app.include_router(dashboard.router)
    app.include_router(grocery.router)

    return app


app = create_app()
