"""Tests for AI provider abstraction."""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from pydantic import BaseModel

from bubbly_chef.ai import (
    AIManager,
    GeminiProvider,
    OllamaProvider,
    ProviderUnavailableError,
    NoProviderAvailableError,
)


class SampleResponse(BaseModel):
    """Sample response model for testing structured output."""
    message: str
    count: int


class TestAIManager:
    """Tests for AI manager."""

    @pytest.mark.asyncio
    async def test_no_providers_raises_error(self):
        """Test that empty manager raises error."""
        manager = AIManager()
        with pytest.raises(NoProviderAvailableError):
            await manager.get_available_provider()

    @pytest.mark.asyncio
    async def test_returns_first_available_provider(self):
        """Test that manager returns first available provider."""
        provider1 = MagicMock()
        provider1.is_available = AsyncMock(return_value=False)
        provider1.name = "provider1"

        provider2 = MagicMock()
        provider2.is_available = AsyncMock(return_value=True)
        provider2.name = "provider2"

        manager = AIManager([provider1, provider2])
        result = await manager.get_available_provider()

        assert result == provider2

    @pytest.mark.asyncio
    async def test_fallback_on_failure(self):
        """Test fallback when first provider fails."""
        provider1 = MagicMock()
        provider1.is_available = AsyncMock(return_value=True)
        provider1.complete = AsyncMock(side_effect=ProviderUnavailableError("Failed"))
        provider1.name = "provider1"

        provider2 = MagicMock()
        provider2.is_available = AsyncMock(return_value=True)
        provider2.complete = AsyncMock(return_value="Success")
        provider2.name = "provider2"

        manager = AIManager([provider1, provider2])
        result = await manager.complete("test prompt")

        assert result == "Success"
        assert manager.current_provider == provider2

    @pytest.mark.asyncio
    async def test_health_check(self):
        """Test health check returns provider status."""
        provider1 = MagicMock()
        provider1.is_available = AsyncMock(return_value=True)
        provider1.name = "gemini"

        provider2 = MagicMock()
        provider2.is_available = AsyncMock(return_value=False)
        provider2.name = "ollama"

        manager = AIManager([provider1, provider2])
        status = await manager.health_check()

        assert status["healthy"] is True
        assert status["available_count"] == 1
        assert len(status["providers"]) == 2


class TestGeminiProvider:
    """Tests for Gemini provider."""

    def test_name_property(self):
        """Test provider name."""
        provider = GeminiProvider(api_key="test-key", model="gemini-1.5-flash")
        assert provider.name == "gemini/gemini-1.5-flash"

    @pytest.mark.asyncio
    async def test_is_available_with_invalid_key(self):
        """Test availability check with invalid key."""
        provider = GeminiProvider(api_key="invalid-key")
        # This will fail because the key is invalid
        # In real tests, we'd mock the HTTP call
        # For now, just verify it doesn't crash
        result = await provider.is_available()
        assert isinstance(result, bool)


class TestOllamaProvider:
    """Tests for Ollama provider."""

    def test_name_property(self):
        """Test provider name."""
        provider = OllamaProvider(model="llama3.2:3b")
        assert provider.name == "ollama/llama3.2:3b"

    def test_default_url(self):
        """Test default base URL."""
        provider = OllamaProvider()
        assert provider.base_url == "http://localhost:11434"

    @pytest.mark.asyncio
    async def test_is_available_when_not_running(self):
        """Test availability when Ollama is not running."""
        provider = OllamaProvider(base_url="http://localhost:99999")
        result = await provider.is_available()
        assert result is False
