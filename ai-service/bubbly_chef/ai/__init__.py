# AI Module
"""
AI provider abstraction layer.

Supports multiple providers (Gemini, Ollama, Anthropic/SAP proxy) with automatic fallback.
"""

from .anthropic import AnthropicProvider
from .gemini import GeminiProvider
from .manager import AIManager, NoProviderAvailableError
from .ollama import OllamaProvider
from .provider import AIProvider, AIProviderError, ProviderUnavailableError, StructuredOutputError

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
    "AnthropicProvider",
    "GeminiProvider",
    "OllamaProvider",
]
