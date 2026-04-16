"""Shared FastAPI dependencies for the AI microservice."""

import logging

from bubbly_chef.ai.manager import AIManager
from bubbly_chef.config import settings

logger = logging.getLogger(__name__)

_ai_manager: AIManager | None = None


def get_ai_manager() -> AIManager:
    """Return a singleton AIManager configured from settings."""
    global _ai_manager
    if _ai_manager is not None:
        return _ai_manager

    from bubbly_chef.ai.gemini import GeminiProvider
    from bubbly_chef.ai.ollama import OllamaProvider

    manager = AIManager()

    if settings.gemini_api_key:
        manager.add_provider(
            GeminiProvider(
                api_key=settings.gemini_api_key,
                model=settings.gemini_model,
            )
        )
        logger.info(f"Registered Gemini provider (model={settings.gemini_model})")

    if settings.ollama_base_url:
        manager.add_provider(
            OllamaProvider(
                base_url=settings.ollama_base_url,
                model=settings.ollama_model,
            )
        )
        logger.info(f"Registered Ollama provider (model={settings.ollama_model})")

    if not manager.providers:
        logger.warning("No AI providers configured — AI features will fail")

    _ai_manager = manager
    return _ai_manager
