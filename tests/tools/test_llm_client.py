"""Tests for OllamaClient and circuit breaker logic."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from pydantic import BaseModel, Field

from bubbly_chef.tools.llm_client import (
    LLMConnectionError,
    LLMError,
    LLMTimeoutError,
    OllamaClient,
    get_ollama_client,
)


class SampleModel(BaseModel):
    """Test model for structured generation."""
    name: str
    value: int = 0


class TestOllamaClientInit:
    def test_default_values(self):
        client = OllamaClient()
        assert client.base_url is not None
        assert client.model is not None
        assert client._circuit_open is False
        assert client._consecutive_failures == 0

    def test_custom_values(self):
        client = OllamaClient(
            base_url="http://custom:1234",
            model="llama3",
            timeout=30.0,
            max_retries=5,
        )
        assert client.base_url == "http://custom:1234"
        assert client.model == "llama3"
        assert client.timeout == 30.0
        assert client.max_retries == 5


class TestCircuitBreaker:
    def test_record_success_resets(self):
        client = OllamaClient()
        client._consecutive_failures = 3
        client._record_success()
        assert client._consecutive_failures == 0
        assert client._circuit_open is False

    def test_record_failure_increments(self):
        client = OllamaClient()
        client._record_failure()
        assert client._consecutive_failures == 1
        assert client._circuit_open is False

    def test_circuit_opens_at_threshold(self):
        client = OllamaClient()
        for _ in range(5):
            client._record_failure()
        assert client._circuit_open is True

    def test_check_circuit_raises_when_open(self):
        client = OllamaClient()
        client._circuit_open = True
        with pytest.raises(LLMConnectionError, match="Circuit breaker open"):
            client._check_circuit()

    def test_check_circuit_passes_when_closed(self):
        client = OllamaClient()
        client._check_circuit()  # Should not raise

    def test_reset_circuit(self):
        client = OllamaClient()
        client._consecutive_failures = 10
        client._circuit_open = True
        client.reset_circuit()
        assert client._consecutive_failures == 0
        assert client._circuit_open is False


class TestOllamaClientGenerate:
    @pytest.mark.asyncio
    async def test_successful_generate(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"response": "Hello, world!"}
        mock_response.raise_for_status = MagicMock()
        mock_http.post.return_value = mock_response
        client._client = mock_http

        result = await client.generate("Say hello")
        assert result == "Hello, world!"
        assert client._consecutive_failures == 0

    @pytest.mark.asyncio
    async def test_generate_with_system_prompt(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {"response": "ok"}
        mock_response.raise_for_status = MagicMock()
        mock_http.post.return_value = mock_response
        client._client = mock_http

        await client.generate("test", system_prompt="Be helpful")
        call_args = mock_http.post.call_args
        payload = call_args[1]["json"]
        assert payload["system"] == "Be helpful"

    @pytest.mark.asyncio
    async def test_generate_timeout(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        mock_http.post.side_effect = httpx.TimeoutException("timeout")
        client._client = mock_http

        with pytest.raises((LLMTimeoutError, httpx.TimeoutException)):
            await client.generate("test")

    @pytest.mark.asyncio
    async def test_generate_connection_error(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        mock_http.post.side_effect = httpx.ConnectError("refused")
        client._client = mock_http

        with pytest.raises((LLMConnectionError, httpx.ConnectError)):
            await client.generate("test")

    @pytest.mark.asyncio
    async def test_generate_http_error(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.status_code = 500
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Server Error", request=MagicMock(), response=mock_response
        )
        mock_http.post.return_value = mock_response
        client._client = mock_http

        with pytest.raises(LLMError):
            await client.generate("test")

    @pytest.mark.asyncio
    async def test_generate_circuit_open_blocks(self):
        client = OllamaClient()
        client._circuit_open = True

        with pytest.raises(LLMConnectionError, match="Circuit breaker"):
            await client.generate("test")


class TestOllamaClientGenerateStructured:
    @pytest.mark.asyncio
    async def test_successful_structured(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {"response": json.dumps({"name": "test", "value": 42})}
        mock_response.raise_for_status = MagicMock()
        mock_http.post.return_value = mock_response
        client._client = mock_http

        result, error = await client.generate_structured("parse this", response_model=SampleModel)
        assert error is None
        assert result is not None
        assert result.name == "test"
        assert result.value == 42

    @pytest.mark.asyncio
    async def test_invalid_json_response(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {"response": "not valid json {"}
        mock_response.raise_for_status = MagicMock()
        mock_http.post.return_value = mock_response
        client._client = mock_http

        result, error = await client.generate_structured("parse", response_model=SampleModel)
        assert result is None
        assert "Invalid JSON" in error

    @pytest.mark.asyncio
    async def test_json_schema_mismatch(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        mock_response = MagicMock()
        # Valid JSON but missing required 'name' field
        mock_response.json.return_value = {"response": json.dumps({"value": 42})}
        mock_response.raise_for_status = MagicMock()
        mock_http.post.return_value = mock_response
        client._client = mock_http

        result, error = await client.generate_structured("parse", response_model=SampleModel)
        assert result is None
        assert "does not match schema" in error

    @pytest.mark.asyncio
    async def test_structured_timeout(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        mock_http.post.side_effect = httpx.TimeoutException("timeout")
        client._client = mock_http

        result, error = await client.generate_structured("test", response_model=SampleModel)
        assert result is None
        assert "timeout" in error.lower()

    @pytest.mark.asyncio
    async def test_structured_connection_error(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        mock_http.post.side_effect = httpx.ConnectError("refused")
        client._client = mock_http

        result, error = await client.generate_structured("test", response_model=SampleModel)
        assert result is None
        assert "connect" in error.lower()

    @pytest.mark.asyncio
    async def test_structured_http_error(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.status_code = 503
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Service Unavailable", request=MagicMock(), response=mock_response
        )
        mock_http.post.return_value = mock_response
        client._client = mock_http

        result, error = await client.generate_structured("test", response_model=SampleModel)
        assert result is None
        assert "503" in error

    @pytest.mark.asyncio
    async def test_structured_circuit_open(self):
        client = OllamaClient()
        client._circuit_open = True

        with pytest.raises(LLMConnectionError):
            await client.generate_structured("test", response_model=SampleModel)


class TestOllamaClientIsAvailable:
    @pytest.mark.asyncio
    async def test_available_with_model(self):
        client = OllamaClient(model="llama3.2:3b")
        mock_http = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "models": [{"name": "llama3.2:3b"}, {"name": "codellama:13b"}]
        }
        mock_http.get.return_value = mock_response
        client._client = mock_http

        assert await client.is_available() is True

    @pytest.mark.asyncio
    async def test_not_available_model_missing(self):
        client = OllamaClient(model="llama3.2:3b")
        mock_http = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"models": [{"name": "codellama:13b"}]}
        mock_http.get.return_value = mock_response
        client._client = mock_http

        assert await client.is_available() is False

    @pytest.mark.asyncio
    async def test_not_available_bad_status(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_http.get.return_value = mock_response
        client._client = mock_http

        assert await client.is_available() is False

    @pytest.mark.asyncio
    async def test_not_available_connection_error(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        mock_http.get.side_effect = httpx.ConnectError("refused")
        client._client = mock_http

        assert await client.is_available() is False


class TestOllamaClientClose:
    @pytest.mark.asyncio
    async def test_close_with_client(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        client._client = mock_http
        await client.close()
        mock_http.aclose.assert_awaited_once()
        assert client._client is None

    @pytest.mark.asyncio
    async def test_close_without_client(self):
        client = OllamaClient()
        await client.close()  # Should not raise


class TestGetOllamaClient:
    def test_returns_singleton(self):
        # Reset singleton
        import bubbly_chef.tools.llm_client as mod
        old = mod._ollama_client
        mod._ollama_client = None
        try:
            c1 = get_ollama_client()
            c2 = get_ollama_client()
            assert c1 is c2
        finally:
            mod._ollama_client = old


class TestTaskSpecificMethods:
    @pytest.mark.asyncio
    async def test_classify_intent_delegates(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {"response": json.dumps({"name": "test", "value": 1})}
        mock_response.raise_for_status = MagicMock()
        mock_http.post.return_value = mock_response
        client._client = mock_http

        result, error = await client.classify_intent("classify this", response_model=SampleModel)
        assert result is not None
        assert error is None

    @pytest.mark.asyncio
    async def test_parse_pantry_items_delegates(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {"response": json.dumps({"name": "milk", "value": 1})}
        mock_response.raise_for_status = MagicMock()
        mock_http.post.return_value = mock_response
        client._client = mock_http

        result, error = await client.parse_pantry_items("parse items", response_model=SampleModel)
        assert result is not None

    @pytest.mark.asyncio
    async def test_generate_chat_response_delegates(self):
        client = OllamaClient()
        mock_http = AsyncMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {"response": json.dumps({"name": "chat", "value": 0})}
        mock_response.raise_for_status = MagicMock()
        mock_http.post.return_value = mock_response
        client._client = mock_http

        result, error = await client.generate_chat_response("chat", response_model=SampleModel)
        assert result is not None
