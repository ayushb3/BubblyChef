# AI Module
"""
AI provider abstraction layer.

Supports multiple providers (Gemini, Ollama) with automatic fallback.
"""

from .provider import AIProvider, AIProviderError, ProviderUnavailableError, StructuredOutputError
from .manager import AIManager, NoProviderAvailableError
from .gemini import GeminiProvider
from .ollama import OllamaProvider

__all__ = [
    # Base classes
    "AIProvider",
    "AIProviderError",
    "ProviderUnavailableError",
    "StructuredOutputError",
    # Manager
    "AIManager",
    "NoProviderAvailableError",
    # Providers
    "GeminiProvider",
    "OllamaProvider",
]
