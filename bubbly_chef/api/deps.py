"""FastAPI dependency injection."""

from functools import lru_cache

from bubbly_chef.ai import AIManager, GeminiProvider, OllamaProvider
from bubbly_chef.config import settings


@lru_cache
def get_ai_manager() -> AIManager:
    """
    Get the AI manager singleton.

    Configures providers based on available credentials.
    Priority: Gemini primary → Gemini fallback models → Ollama

    Each Gemini model has its own free-tier rate-limit bucket (RPD/RPM).
    When one model hits 429, AIManager cascades to the next provider.
    """
    manager = AIManager()

    # Add Gemini providers — each model ID has its own rate-limit bucket
    if settings.gemini_api_key:
        # Primary model
        manager.add_provider(
            GeminiProvider(
                api_key=settings.gemini_api_key,
                model=settings.gemini_model,
                timeout=settings.gemini_timeout_seconds,
            )
        )
        # Fallback models (separate rate-limit buckets)
        for fallback_model in settings.gemini_fallback_models:
            if fallback_model != settings.gemini_model:
                manager.add_provider(
                    GeminiProvider(
                        api_key=settings.gemini_api_key,
                        model=fallback_model,
                        timeout=settings.gemini_timeout_seconds,
                    )
                )

    # Add Ollama as final fallback (always available locally)
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
