"""FastAPI dependency injection."""

from functools import lru_cache

from bubbly_chef.config import settings
from bubbly_chef.ai import AIManager, GeminiProvider, OllamaProvider


@lru_cache()
def get_ai_manager() -> AIManager:
    """
    Get the AI manager singleton.

    Configures providers based on available credentials.
    Priority: Gemini (free tier) > Ollama (self-hosted)
    """
    manager = AIManager()

    # Add Gemini if API key is configured
    if settings.gemini_api_key:
        manager.add_provider(
            GeminiProvider(
                api_key=settings.gemini_api_key,
                model=settings.gemini_model,
                timeout=settings.gemini_timeout_seconds,
            )
        )

    # Add Ollama as fallback (always available locally)
    manager.add_provider(
        OllamaProvider(
            base_url=settings.ollama_base_url,
            model=settings.ollama_model,
            timeout=settings.ollama_timeout_seconds,
        )
    )

    return manager


def reset_ai_manager() -> None:
    """Reset the cached AI manager (useful for testing)."""
    get_ai_manager.cache_clear()
