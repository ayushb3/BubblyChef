"""Wire-format tests for AnthropicProvider and GeminiProvider tool calling.

These tests intercept the outgoing HTTP request using httpx.MockTransport so
they run fully offline and assert on:
  - the exact JSON body sent to each provider's endpoint
  - the auth headers on every request (regression guard for the SAP-proxy 401)
  - response parsing from the real provider parsing code (no mocking of
    complete_with_tools itself — that is the gap the existing suite left open)

Transport injection pattern
---------------------------
After constructing the provider, replace its internal HTTP client::

    transport = httpx.MockTransport(handler)
    provider._client = httpx.AsyncClient(transport=transport)

httpx.MockTransport accepts a *sync* handler ``(request) -> httpx.Response``
and bridges it to the async client internally.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from bubbly_chef.ai.anthropic import AnthropicProvider
from bubbly_chef.ai.gemini import GeminiProvider
from bubbly_chef.ai.provider import ToolCall, ToolCallResponse

# ---------------------------------------------------------------------------
# Shared tool schema fixture
# ---------------------------------------------------------------------------

_CHECK_PANTRY_SCHEMA: dict[str, Any] = {
    "name": "check_pantry",
    "description": "Check whether an ingredient is in the user's pantry.",
    "parameters": {
        "type": "object",
        "properties": {"ingredient": {"type": "string"}},
        "required": ["ingredient"],
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_anthropic(api_key: str = "tok123") -> AnthropicProvider:
    """Return an AnthropicProvider wired to a fake base URL."""
    return AnthropicProvider(base_url="http://test/anthropic", api_key=api_key)


def _inject_transport(
    provider: AnthropicProvider | GeminiProvider,
    handler: Any,
) -> None:
    """Replace the provider's _client with one backed by MockTransport."""
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))


# ===========================================================================
# AnthropicProvider
# ===========================================================================


class TestAnthropicWireFormat:
    """Assert on the exact JSON body sent over the wire for Anthropic calls."""

    @pytest.mark.asyncio
    async def test_tools_use_input_schema_not_parameters(self) -> None:
        """Anthropic wire format uses 'input_schema', not 'parameters'."""
        captured: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.content)
            return httpx.Response(
                200,
                json={
                    "stop_reason": "end_turn",
                    "content": [{"type": "text", "text": "no buttermilk"}],
                },
            )

        provider = _make_anthropic()
        _inject_transport(provider, handler)

        await provider.complete_with_tools(
            messages=[{"role": "user", "content": "do I have buttermilk?"}],
            tools=[_CHECK_PANTRY_SCHEMA],
        )

        body = captured["body"]
        assert "tools" in body, "request body must contain a top-level 'tools' key"
        tool_entry = body["tools"][0]

        # Anthropic uses 'input_schema' — NOT 'parameters'
        assert "input_schema" in tool_entry, (
            "Anthropic wire format must use 'input_schema', got keys: "
            + str(list(tool_entry.keys()))
        )
        assert "parameters" not in tool_entry, (
            "Anthropic wire format must NOT have 'parameters' (that is the neutral name)"
        )
        assert tool_entry["name"] == "check_pantry"
        assert tool_entry["description"] == _CHECK_PANTRY_SCHEMA["description"]
        assert tool_entry["input_schema"] == _CHECK_PANTRY_SCHEMA["parameters"]

    @pytest.mark.asyncio
    async def test_messages_user_content_is_text_block(self) -> None:
        """User messages must be translated to Anthropic text content blocks."""
        captured: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.content)
            return httpx.Response(
                200,
                json={
                    "stop_reason": "end_turn",
                    "content": [{"type": "text", "text": "ok"}],
                },
            )

        provider = _make_anthropic()
        _inject_transport(provider, handler)

        await provider.complete_with_tools(
            messages=[{"role": "user", "content": "do I have buttermilk?"}],
            tools=[_CHECK_PANTRY_SCHEMA],
        )

        messages = captured["body"]["messages"]
        assert len(messages) == 1
        first = messages[0]
        assert first["role"] == "user"
        # Content must be a list of content blocks, not a plain string
        assert isinstance(first["content"], list)
        assert first["content"][0]["type"] == "text"
        assert first["content"][0]["text"] == "do I have buttermilk?"


class TestAnthropicAuthHeaders:
    """Regression guard for the SAP-proxy 401 bug.

    The provider must send BOTH Authorization and x-api-key when a key is
    configured, and neither when the key is empty.
    """

    @pytest.mark.asyncio
    async def test_auth_headers_present_when_api_key_set(self) -> None:
        """Both 'Authorization: Bearer <key>' and 'x-api-key: <key>' must be sent."""
        captured_headers: dict[str, str] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured_headers.update(request.headers)
            return httpx.Response(
                200,
                json={
                    "stop_reason": "end_turn",
                    "content": [{"type": "text", "text": "ok"}],
                },
            )

        provider = _make_anthropic(api_key="tok123")
        _inject_transport(provider, handler)

        await provider.complete_with_tools(
            messages=[{"role": "user", "content": "ping"}],
            tools=[_CHECK_PANTRY_SCHEMA],
        )

        assert captured_headers.get("authorization") == "Bearer tok123", (
            "SAP proxy requires 'Authorization: Bearer <key>' — missing or wrong value"
        )
        assert captured_headers.get("x-api-key") == "tok123", (
            "Direct Anthropic API requires 'x-api-key' header — missing or wrong value"
        )

    @pytest.mark.asyncio
    async def test_no_auth_headers_when_api_key_empty(self) -> None:
        """When api_key='' neither Authorization nor x-api-key should appear."""
        captured_headers: dict[str, str] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured_headers.update(request.headers)
            return httpx.Response(
                200,
                json={
                    "stop_reason": "end_turn",
                    "content": [{"type": "text", "text": "ok"}],
                },
            )

        provider = _make_anthropic(api_key="")
        _inject_transport(provider, handler)

        await provider.complete_with_tools(
            messages=[{"role": "user", "content": "ping"}],
            tools=[_CHECK_PANTRY_SCHEMA],
        )

        assert "authorization" not in captured_headers, (
            "No api_key → Authorization header must be absent"
        )
        assert "x-api-key" not in captured_headers, (
            "No api_key → x-api-key header must be absent"
        )


class TestAnthropicResponseParsing:
    """Assert that complete_with_tools correctly parses Anthropic response envelopes."""

    @pytest.mark.asyncio
    async def test_tool_use_stop_reason_returns_tool_calls(self) -> None:
        """stop_reason='tool_use' → ToolCallResponse.tool_calls populated, text is None."""

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "stop_reason": "tool_use",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "toolu_1",
                            "name": "check_pantry",
                            "input": {"ingredient": "buttermilk"},
                        }
                    ],
                },
            )

        provider = _make_anthropic()
        _inject_transport(provider, handler)

        result = await provider.complete_with_tools(
            messages=[{"role": "user", "content": "do I have buttermilk?"}],
            tools=[_CHECK_PANTRY_SCHEMA],
        )

        assert isinstance(result, ToolCallResponse)
        assert result.text is None
        assert len(result.tool_calls) == 1
        tc = result.tool_calls[0]
        assert isinstance(tc, ToolCall)
        assert tc.id == "toolu_1"
        assert tc.name == "check_pantry"
        assert tc.arguments == {"ingredient": "buttermilk"}

    @pytest.mark.asyncio
    async def test_end_turn_stop_reason_returns_text(self) -> None:
        """stop_reason='end_turn' → ToolCallResponse.text set, tool_calls is []."""

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "stop_reason": "end_turn",
                    "content": [{"type": "text", "text": "Use yogurt."}],
                },
            )

        provider = _make_anthropic()
        _inject_transport(provider, handler)

        result = await provider.complete_with_tools(
            messages=[{"role": "user", "content": "substitute for buttermilk?"}],
            tools=[_CHECK_PANTRY_SCHEMA],
        )

        assert isinstance(result, ToolCallResponse)
        assert result.text == "Use yogurt."
        assert result.tool_calls == []


class TestAnthropicMessageConversion:
    """Unit-test _messages_to_anthropic directly — no HTTP needed."""

    def test_tool_result_role_maps_to_user_role(self) -> None:
        """tool_result role must become Anthropic 'user' with pre-built content blocks."""
        provider = _make_anthropic()

        # Shape as the ReAct node builds it: pre-built Anthropic tool_result block
        tool_result_content = [
            {
                "type": "tool_result",
                "tool_use_id": "toolu_1",
                "content": [{"type": "text", "text": "Yes, buttermilk: 1.0 cup."}],
            }
        ]
        messages: list[dict[str, Any]] = [
            {"role": "user", "content": "do I have buttermilk?"},
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "toolu_1",
                        "name": "check_pantry",
                        "input": {"ingredient": "buttermilk"},
                    }
                ],
            },
            {"role": "tool_result", "content": tool_result_content},
        ]

        converted = provider._messages_to_anthropic(messages)

        assert len(converted) == 3

        # First message: user text block
        assert converted[0]["role"] == "user"
        assert converted[0]["content"][0]["type"] == "text"

        # Second message: assistant with pre-built tool_use block
        assert converted[1]["role"] == "assistant"
        assert converted[1]["content"][0]["type"] == "tool_use"

        # Third message: tool_result → Anthropic 'user' role, content preserved as-is
        assert converted[2]["role"] == "user", (
            "tool_result role must map to Anthropic 'user' — "
            f"got: {converted[2]['role']!r}"
        )
        assert converted[2]["content"] is tool_result_content, (
            "Pre-built tool_result content blocks must be passed through unchanged"
        )

    def test_assistant_text_becomes_text_block(self) -> None:
        """A plain-string assistant message should be wrapped in a text content block."""
        provider = _make_anthropic()
        converted = provider._messages_to_anthropic(
            [{"role": "assistant", "content": "Here is my answer."}]
        )
        assert converted[0]["role"] == "assistant"
        assert converted[0]["content"] == [{"type": "text", "text": "Here is my answer."}]

    def test_user_text_becomes_text_block(self) -> None:
        """A plain-string user message should be wrapped in a text content block."""
        provider = _make_anthropic()
        converted = provider._messages_to_anthropic(
            [{"role": "user", "content": "What can I make?"}]
        )
        assert converted[0]["role"] == "user"
        assert converted[0]["content"] == [{"type": "text", "text": "What can I make?"}]


# ===========================================================================
# GeminiProvider
# ===========================================================================


class TestGeminiWireFormat:
    """Assert on the exact JSON body sent over the wire for Gemini calls."""

    @pytest.mark.asyncio
    async def test_tools_wrapped_in_function_declarations(self) -> None:
        """Gemini wire format: tools=[{'functionDeclarations': [...]}]."""
        captured: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.content)
            return httpx.Response(
                200,
                json={
                    "candidates": [
                        {
                            "content": {
                                "parts": [{"text": "No buttermilk found."}]
                            }
                        }
                    ]
                },
            )

        provider = GeminiProvider(api_key="fake")
        _inject_transport(provider, handler)

        await provider.complete_with_tools(
            messages=[{"role": "user", "content": "do I have buttermilk?"}],
            tools=[_CHECK_PANTRY_SCHEMA],
        )

        body = captured["body"]
        assert "tools" in body, "request body must contain a top-level 'tools' key"
        tools_list = body["tools"]
        assert len(tools_list) == 1

        # Gemini wraps declarations in a 'functionDeclarations' envelope
        assert "functionDeclarations" in tools_list[0], (
            "Gemini wire format must wrap tools in 'functionDeclarations', "
            "got keys: " + str(list(tools_list[0].keys()))
        )

        decls = tools_list[0]["functionDeclarations"]
        assert len(decls) == 1
        decl = decls[0]
        assert decl["name"] == "check_pantry"
        assert decl["description"] == _CHECK_PANTRY_SCHEMA["description"]
        # Gemini uses 'parameters' (JSON Schema) — not 'input_schema'
        assert "parameters" in decl, (
            "Gemini function declaration must have 'parameters' key, "
            "got: " + str(list(decl.keys()))
        )
        assert decl["parameters"] == _CHECK_PANTRY_SCHEMA["parameters"]

    @pytest.mark.asyncio
    async def test_contents_uses_user_role_and_parts(self) -> None:
        """User messages must be sent as Gemini 'contents' with role='user' and parts."""
        captured: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.content)
            return httpx.Response(
                200,
                json={
                    "candidates": [
                        {"content": {"parts": [{"text": "ok"}]}}
                    ]
                },
            )

        provider = GeminiProvider(api_key="fake")
        _inject_transport(provider, handler)

        await provider.complete_with_tools(
            messages=[{"role": "user", "content": "do I have milk?"}],
            tools=[_CHECK_PANTRY_SCHEMA],
        )

        contents = captured["body"]["contents"]
        assert len(contents) == 1
        first = contents[0]
        assert first["role"] == "user"
        assert isinstance(first["parts"], list)
        assert first["parts"][0] == {"text": "do I have milk?"}


class TestGeminiResponseParsing:
    """Assert that complete_with_tools correctly parses Gemini response envelopes."""

    @pytest.mark.asyncio
    async def test_function_call_part_returns_tool_call(self) -> None:
        """A functionCall part → ToolCallResponse.tool_calls populated, text is None."""

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "candidates": [
                        {
                            "content": {
                                "parts": [
                                    {
                                        "functionCall": {
                                            "name": "check_pantry",
                                            "args": {"ingredient": "milk"},
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                },
            )

        provider = GeminiProvider(api_key="fake")
        _inject_transport(provider, handler)

        result = await provider.complete_with_tools(
            messages=[{"role": "user", "content": "do I have milk?"}],
            tools=[_CHECK_PANTRY_SCHEMA],
        )

        assert isinstance(result, ToolCallResponse)
        assert result.text is None
        assert len(result.tool_calls) == 1
        tc = result.tool_calls[0]
        assert isinstance(tc, ToolCall)
        assert tc.name == "check_pantry"
        assert tc.arguments == {"ingredient": "milk"}
        # Gemini doesn't supply a call ID — provider generates a UUID
        assert tc.id  # non-empty

    @pytest.mark.asyncio
    async def test_text_part_returns_text_response(self) -> None:
        """A text-only part → ToolCallResponse.text set, tool_calls is []."""

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "candidates": [
                        {
                            "content": {
                                "parts": [
                                    {"text": "Use plain yogurt as a substitute."}
                                ]
                            }
                        }
                    ]
                },
            )

        provider = GeminiProvider(api_key="fake")
        _inject_transport(provider, handler)

        result = await provider.complete_with_tools(
            messages=[{"role": "user", "content": "substitute for buttermilk?"}],
            tools=[_CHECK_PANTRY_SCHEMA],
        )

        assert isinstance(result, ToolCallResponse)
        assert result.text == "Use plain yogurt as a substitute."
        assert result.tool_calls == []

    @pytest.mark.asyncio
    async def test_api_key_sent_as_query_param(self) -> None:
        """Gemini authenticates via ?key=... query param, not a header."""
        captured_url: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            captured_url.append(str(request.url))
            return httpx.Response(
                200,
                json={
                    "candidates": [
                        {"content": {"parts": [{"text": "ok"}]}}
                    ]
                },
            )

        provider = GeminiProvider(api_key="my-gemini-key")
        _inject_transport(provider, handler)

        await provider.complete_with_tools(
            messages=[{"role": "user", "content": "ping"}],
            tools=[_CHECK_PANTRY_SCHEMA],
        )

        url = captured_url[0]
        assert "key=my-gemini-key" in url, (
            f"Gemini must pass API key as ?key= query param, got URL: {url}"
        )
