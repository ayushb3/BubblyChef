"""Tests for R3 Cooking Companion — ReAct loop, tool registry, provider capability gate.

Patterns follow test_chat_router.py: unittest.mock + AsyncMock, pytest.mark.asyncio,
minimal state dicts, no live providers.
"""

from __future__ import annotations

import inspect
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.ai.provider import ToolCall, ToolCallResponse
from bubbly_chef.models.base import Intent, WorkflowStatus
from bubbly_chef.tools.registry import (
    _REGISTRY,
    get_registered_tools,
    get_tool,
    get_tool_schemas,
    tool,
)
from bubbly_chef.workflows.chat.nodes import (
    MAX_ITERATIONS,
    _COOKING_TOOL_NAMES,
    cooking_help_response,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _state(**kwargs):
    """Minimal WorkflowState for cooking_help_response tests."""
    base: dict = {
        "input_text": "I'm out of buttermilk, what can I substitute?",
        "user_id": "test-user-123",
        "errors": [],
        "warnings": [],
        "session_mode": None,
        "session": None,
        "conversation_history": [],
        "input_mode": "chat",
        "context": None,
    }
    base.update(kwargs)
    return base


def _make_manager(supports_tool_calling: bool = True):
    """Build a MagicMock AIManager.

    Returns (manager_instance, mock_provider) so tests can configure
    complete / complete_with_tools behaviour.
    """
    provider = MagicMock()
    provider.supports_tool_calling = supports_tool_calling
    provider.name = "mock/provider"

    manager = MagicMock()
    manager.providers = [provider]
    manager.current_provider = provider
    manager.complete = AsyncMock(return_value="Single-shot fallback answer.")
    manager.complete_with_tools = AsyncMock()
    return manager, provider


# ---------------------------------------------------------------------------
# Tool registry tests
# ---------------------------------------------------------------------------


class TestToolRegistry:
    def test_decorator_registers_tool(self):
        """@tool should register name, build schema, and keep fn callable."""
        # Use a fresh name to avoid polluting the real registry
        @tool(description="Test tool for pytest.")
        def _pytest_sample_tool(query: str, count: int = 5) -> str:
            """Ignored because description= is provided."""
            return f"{query}:{count}"

        fn, schema = get_tool("_pytest_sample_tool")
        assert schema["name"] == "_pytest_sample_tool"
        assert schema["description"] == "Test tool for pytest."
        assert "query" in schema["parameters"]["properties"]
        assert schema["parameters"]["properties"]["query"]["type"] == "string"
        assert "count" in schema["parameters"]["properties"]
        assert schema["parameters"]["properties"]["count"]["type"] == "integer"
        # 'count' has a default → should NOT be in required
        assert "count" not in schema["parameters"].get("required", [])
        # 'query' has no default → must be required
        assert "query" in schema["parameters"]["required"]
        # Direct call still works
        assert fn("hello") == "hello:5"

    def test_keyword_only_params_excluded_from_schema(self):
        """Keyword-only params (*, param) must be absent from the model-facing schema."""

        @tool
        def _pytest_kw_tool(ingredient: str, *, user_id: str) -> str:
            """A tool with a node-injected user_id."""
            return f"{ingredient}:{user_id}"

        _, schema = get_tool("_pytest_kw_tool")
        props = schema["parameters"]["properties"]
        assert "ingredient" in props
        assert "user_id" not in props
        required = schema["parameters"].get("required", [])
        assert "user_id" not in required

    def test_get_tool_raises_on_unknown(self):
        with pytest.raises(KeyError, match="not registered"):
            get_tool("_this_tool_does_not_exist")

    def test_get_tool_schemas_returns_subset(self):
        """get_tool_schemas should return only the requested names."""
        # Ensure check_pantry is registered (importing cooking tools triggers it)
        import bubbly_chef.tools.cooking  # noqa: F401

        schemas = get_tool_schemas(["check_pantry"])
        assert len(schemas) == 1
        assert schemas[0]["name"] == "check_pantry"
        # user_id must NOT appear in the schema
        assert "user_id" not in schemas[0]["parameters"]["properties"]

    def test_get_registered_tools_returns_copy(self):
        registry = get_registered_tools()
        assert isinstance(registry, dict)
        # Modifying the copy must not affect the real registry
        registry.pop(next(iter(registry)), None)
        assert len(get_registered_tools()) >= len(registry)

    def test_functools_wraps_preserves_metadata(self):
        @tool
        def _pytest_meta_tool(x: str) -> str:
            """Meta description."""
            return x

        fn, _ = get_tool("_pytest_meta_tool")
        assert fn.__name__ == "_pytest_meta_tool"
        assert inspect.getdoc(fn) == "Meta description."


# ---------------------------------------------------------------------------
# Provider capability gate tests
# ---------------------------------------------------------------------------


class TestProviderCapabilityGate:
    def test_base_provider_defaults_false(self):
        """AIProvider base default: supports_tool_calling = False."""
        from bubbly_chef.ai.provider import AIProvider

        class _Concrete(AIProvider):
            @property
            def name(self) -> str:
                return "test"

            async def complete(self, prompt, response_schema=None, temperature=0.7):
                return ""

            async def is_available(self) -> bool:
                return True

        p = _Concrete()
        assert p.supports_tool_calling is False

    def test_anthropic_provider_reports_true(self):
        from bubbly_chef.ai.anthropic import AnthropicProvider

        p = AnthropicProvider(base_url="http://localhost:6655/anthropic")
        assert p.supports_tool_calling is True

    def test_gemini_provider_reports_true(self):
        from bubbly_chef.ai.gemini import GeminiProvider

        p = GeminiProvider(api_key="fake-key")
        assert p.supports_tool_calling is True

    def test_ollama_provider_reports_false(self):
        from bubbly_chef.ai.ollama import OllamaProvider

        p = OllamaProvider()
        assert p.supports_tool_calling is False


# ---------------------------------------------------------------------------
# cooking_help_response — ReAct loop with a tool call
# ---------------------------------------------------------------------------


class TestCookingHelpReactLoop:
    @pytest.mark.asyncio
    async def test_react_loop_calls_tool_and_returns_final_answer(self):
        """Loop: first call returns a tool call; second call returns final text."""
        manager, provider = _make_manager(supports_tool_calling=True)

        tool_call = ToolCall(id="tc1", name="check_pantry", arguments={"ingredient": "buttermilk"})
        manager.complete_with_tools.side_effect = [
            ToolCallResponse(tool_calls=[tool_call]),  # first: tool call
            ToolCallResponse(text="Use yogurt instead — you have some!"),  # second: final
        ]

        with (
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager),
            patch(
                "bubbly_chef.workflows.chat.nodes._invoke_tool",
                new_callable=AsyncMock,
                return_value="Yes, buttermilk: 0.0 cup.",
            ) as mock_invoke,
        ):
            result = await cooking_help_response(_state())

        assert result["intent"] == Intent.COOKING_HELP.value
        assert result["workflow_status"] == WorkflowStatus.COMPLETED.value
        assert "yogurt" in result["assistant_message"]
        mock_invoke.assert_awaited_once_with(
            "check_pantry", {"ingredient": "buttermilk"}, "test-user-123"
        )
        assert manager.complete_with_tools.await_count == 2

    @pytest.mark.asyncio
    async def test_react_loop_no_tool_call_returns_direct_answer(self):
        """Loop: model answers directly without calling any tool."""
        manager, provider = _make_manager(supports_tool_calling=True)
        manager.complete_with_tools.return_value = ToolCallResponse(
            text="Just use plain yogurt — it works perfectly."
        )

        with (
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager),
            patch(
                "bubbly_chef.workflows.chat.nodes._invoke_tool",
                new_callable=AsyncMock,
            ) as mock_invoke,
        ):
            result = await cooking_help_response(_state())

        assert result["intent"] == Intent.COOKING_HELP.value
        assert "yogurt" in result["assistant_message"]
        mock_invoke.assert_not_called()
        manager.complete_with_tools.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_react_loop_max_iterations_cap(self):
        """Loop must stop at MAX_ITERATIONS even if model keeps requesting tool calls."""
        manager, provider = _make_manager(supports_tool_calling=True)

        # Always return a tool call — never a final answer
        tool_call = ToolCall(id="tc-inf", name="check_pantry", arguments={"ingredient": "milk"})
        manager.complete_with_tools.return_value = ToolCallResponse(tool_calls=[tool_call])

        with (
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager),
            patch(
                "bubbly_chef.workflows.chat.nodes._invoke_tool",
                new_callable=AsyncMock,
                return_value="Found: milk.",
            ),
        ):
            result = await cooking_help_response(_state())

        # Must not loop more than MAX_ITERATIONS times
        assert manager.complete_with_tools.await_count == MAX_ITERATIONS
        # Must still return a valid cooking_help response (not raise/crash)
        assert result["intent"] == Intent.COOKING_HELP.value
        assert result["workflow_status"] == WorkflowStatus.COMPLETED.value
        assert result["assistant_message"]  # non-empty fallback message

    @pytest.mark.asyncio
    async def test_degraded_fallback_when_no_tool_calling_provider(self):
        """When no provider supports tool calling, fall back to single-shot complete()."""
        manager, provider = _make_manager(supports_tool_calling=False)
        manager.complete.return_value = "Here's some cooking advice."

        with (
            patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager),
            patch(
                "bubbly_chef.workflows.chat.nodes.get_repository",
                new_callable=AsyncMock,
                return_value=MagicMock(
                    get_all_pantry_items=AsyncMock(return_value=[])
                ),
            ),
        ):
            result = await cooking_help_response(_state())

        assert result["intent"] == Intent.COOKING_HELP.value
        assert result["workflow_status"] == WorkflowStatus.COMPLETED.value
        assert result["assistant_message"] == "Here's some cooking advice."
        # complete() must have been used (single-shot), NOT complete_with_tools
        manager.complete.assert_awaited_once()
        manager.complete_with_tools.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_provider_available_error_handled(self):
        """NoProviderAvailableError returns a friendly error message, not an exception."""
        from bubbly_chef.ai.manager import NoProviderAvailableError

        manager, provider = _make_manager(supports_tool_calling=True)
        manager.complete_with_tools.side_effect = NoProviderAvailableError("no provider")

        with patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager):
            result = await cooking_help_response(_state())

        assert result["intent"] == Intent.COOKING_HELP.value
        assert "No AI provider" in result["assistant_message"]

    @pytest.mark.asyncio
    async def test_generic_exception_handled(self):
        """Unexpected exceptions return an error message and populate errors list."""
        manager, provider = _make_manager(supports_tool_calling=True)
        manager.complete_with_tools.side_effect = RuntimeError("boom")

        with patch("bubbly_chef.workflows.chat.nodes.get_ai_manager", return_value=manager):
            result = await cooking_help_response(_state())

        assert result["intent"] == Intent.COOKING_HELP.value
        assert "error" in result["assistant_message"].lower()
        assert any("boom" in e for e in result.get("errors", []))


# ---------------------------------------------------------------------------
# check_pantry tool — unit tests with mocked repository
# ---------------------------------------------------------------------------


class TestCheckPantryTool:
    @pytest.mark.asyncio
    async def test_returns_found_when_item_exists(self):
        """check_pantry returns a 'Yes, the pantry has ...' string on exact match."""
        import bubbly_chef.tools.cooking  # noqa: F401 — ensure registered

        from bubbly_chef.tools.cooking.pantry_tools import check_pantry

        mock_item = MagicMock()
        mock_item.name = "Buttermilk"
        mock_item.quantity = 1.0
        mock_item.unit = "cup"
        mock_item.expiry_date = None

        mock_repo = MagicMock()
        mock_repo.find_similar_item = AsyncMock(return_value=mock_item)

        with patch(
            "bubbly_chef.tools.cooking.pantry_tools.get_repository",
            new_callable=AsyncMock,
            return_value=mock_repo,
        ):
            result = await check_pantry("buttermilk", user_id="u1")

        assert "Buttermilk" in result
        assert "1.0" in result
        assert "cup" in result

    @pytest.mark.asyncio
    async def test_returns_not_found_when_absent(self):
        """check_pantry returns a clear 'not found' message when absent."""
        import bubbly_chef.tools.cooking  # noqa: F401

        from bubbly_chef.tools.cooking.pantry_tools import check_pantry

        mock_repo = MagicMock()
        mock_repo.find_similar_item = AsyncMock(return_value=None)
        mock_repo.get_all_pantry_items = AsyncMock(return_value=[])

        with patch(
            "bubbly_chef.tools.cooking.pantry_tools.get_repository",
            new_callable=AsyncMock,
            return_value=mock_repo,
        ):
            result = await check_pantry("unicorn dust", user_id="u1")

        assert "not found" in result.lower()

    @pytest.mark.asyncio
    async def test_repo_error_returns_graceful_message(self):
        """check_pantry swallows repo errors and returns a safe fallback."""
        import bubbly_chef.tools.cooking  # noqa: F401

        from bubbly_chef.tools.cooking.pantry_tools import check_pantry

        with patch(
            "bubbly_chef.tools.cooking.pantry_tools.get_repository",
            new_callable=AsyncMock,
            side_effect=RuntimeError("DB down"),
        ):
            result = await check_pantry("butter", user_id="u1")

        assert "Could not check pantry" in result
