"""Shared FastAPI dependencies for the AI microservice."""

import logging

from bubbly_chef.ai.manager import ACCOUNT_FAILURE_KINDS, AIManager
from bubbly_chef.config import settings

logger = logging.getLogger(__name__)

_ai_manager: AIManager | None = None


def get_ai_manager() -> AIManager:
    """Return a singleton AIManager configured from settings."""
    global _ai_manager
    if _ai_manager is not None:
        return _ai_manager

    manager = AIManager()

    # Dev-only: route all LLM calls through the local SAP proxy.
    # When this flag is set, only AnthropicProvider is registered (no Gemini/Ollama).
    if settings.use_anthropic_proxy:
        from bubbly_chef.ai.anthropic import AnthropicProvider

        provider = AnthropicProvider(
            base_url=settings.anthropic_base_url,
            api_key=settings.anthropic_api_key,
            model=settings.anthropic_model,
            max_tokens=settings.anthropic_max_tokens,
        )
        manager.add_provider(provider)
        logger.info(
            f"Registered Anthropic/SAP-proxy provider (model={settings.anthropic_model}, "
            f"base_url={settings.anthropic_base_url})"
        )
        _ai_manager = manager
        return _ai_manager

    from bubbly_chef.ai.gemini import GeminiProvider
    from bubbly_chef.ai.ollama import OllamaProvider

    def _gemini(api_key: str) -> GeminiProvider:
        return GeminiProvider(
            api_key=api_key,
            model=settings.gemini_model,
            vision_timeout=settings.gemini_vision_timeout_seconds,
            vision_max_retries=settings.gemini_vision_max_retries,
            vision_retry_backoff=settings.gemini_vision_retry_backoff_seconds,
            video_timeout=settings.gemini_video_timeout_seconds,
        )

    if settings.gemini_api_key:
        manager.add_provider(_gemini(settings.gemini_api_key), label="gemini-primary")
        logger.info(f"Registered Gemini provider (model={settings.gemini_model})")

        # #737: a second key, only ever tried after the primary hit a quota,
        # auth or rate-limit failure. Skipped entirely when unset, and never
        # promoted to primary when the primary key itself is missing.
        if settings.gemini_fallback_api_key:
            manager.add_provider(
                _gemini(settings.gemini_fallback_api_key),
                label="gemini-fallback",
                only_after_failure_kinds=ACCOUNT_FAILURE_KINDS,
            )
            logger.info("Registered Gemini fallback provider (second key)")

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
