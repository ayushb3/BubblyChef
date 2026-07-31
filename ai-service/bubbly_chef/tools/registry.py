"""Tool registry for the BubblyChef ReAct agent.

Usage
-----
Decorate any async or sync function with ``@tool`` and it is automatically
registered.  The decorator inspects the function's signature and docstring to
build a provider-neutral JSON Schema tool spec.

    from bubbly_chef.tools.registry import tool

    @tool
    async def my_tool(query: str) -> str:
        \"\"\"Search for something useful.\"\"\"
        return f"result for {query}"

Keyword-only parameters (those after ``*``) are **node-injected** and are
**excluded** from the model-facing schema.  The canonical node-injected param
is ``user_id``:

    @tool
    async def check_pantry(ingredient: str, *, user_id: str) -> str:
        ...

When invoking through the registry the caller must pass node-injected params
as keyword arguments:

    fn, schema = get_tool("check_pantry")
    result = await fn("butter", user_id="abc-123")

The model only ever sees ``ingredient`` in the schema — ``user_id`` is
invisible to it.

Public API
----------
- ``tool``                 — decorator
- ``get_tool(name)``       — returns (callable, schema_dict)
- ``get_tool_schemas(names)`` — returns list of schema dicts for named tools
- ``get_registered_tools()``  — returns copy of the full registry dict
"""

from __future__ import annotations

import functools
import inspect
from collections.abc import Callable
from typing import Any

# ---------------------------------------------------------------------------
# Internal registry
# ---------------------------------------------------------------------------

# Maps tool name → (callable, schema dict)
_REGISTRY: dict[str, tuple[Callable[..., Any], dict[str, Any]]] = {}

# ---------------------------------------------------------------------------
# Type → JSON Schema helpers
# ---------------------------------------------------------------------------

_PYTHON_TO_JSON_TYPE: dict[type, str] = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
}

# String-form annotations (from `from __future__ import annotations` or PEP 563)
_STRING_TO_JSON_TYPE: dict[str, str] = {
    "str": "string",
    "int": "integer",
    "float": "number",
    "bool": "boolean",
}


def _annotation_to_json_type(annotation: Any) -> str:
    """Return a JSON Schema type string for a simple Python annotation.

    Handles both runtime type objects (``int``) and string-form annotations
    produced by ``from __future__ import annotations`` (``"int"``).
    """
    if isinstance(annotation, str):
        return _STRING_TO_JSON_TYPE.get(annotation, "string")
    return _PYTHON_TO_JSON_TYPE.get(annotation, "string")


# ---------------------------------------------------------------------------
# Schema builder
# ---------------------------------------------------------------------------


def _build_schema(
    fn: Callable[..., Any],
    description_override: str | None,
) -> dict[str, Any]:
    """Build a provider-neutral tool schema dict from a function.

    Keyword-only parameters are excluded from the model-facing schema (they
    are node-injected at invocation time, not supplied by the LLM).

    Returns a dict with:
        name        – function __name__
        description – docstring or override
        parameters  – JSON Schema object with positional params only
    """
    sig = inspect.signature(fn)
    description = description_override or (inspect.getdoc(fn) or "").strip()

    properties: dict[str, Any] = {}
    required: list[str] = []

    for param_name, param in sig.parameters.items():
        # Skip keyword-only params — these are node-injected (e.g. user_id)
        if param.kind == inspect.Parameter.KEYWORD_ONLY:
            continue
        # Skip *args / **kwargs
        if param.kind in (
            inspect.Parameter.VAR_POSITIONAL,
            inspect.Parameter.VAR_KEYWORD,
        ):
            continue

        annotation = (
            param.annotation
            if param.annotation is not inspect.Parameter.empty
            else str
        )
        json_type = _annotation_to_json_type(annotation)
        properties[param_name] = {"type": json_type}

        if param.default is inspect.Parameter.empty:
            required.append(param_name)

    parameters: dict[str, Any] = {
        "type": "object",
        "properties": properties,
    }
    if required:
        parameters["required"] = required

    return {
        "name": fn.__name__,
        "description": description,
        "parameters": parameters,
    }


# ---------------------------------------------------------------------------
# @tool decorator
# ---------------------------------------------------------------------------


def tool(
    fn: Callable[..., Any] | None = None,
    *,
    description: str | None = None,
) -> Any:
    """Register a function as a callable tool.

    Can be used as a bare decorator or with a ``description=`` override::

        @tool
        async def my_tool(x: str) -> str: ...

        @tool(description="Override description here")
        async def my_tool(x: str) -> str: ...

    Keyword-only parameters (``*, param``) are **excluded** from the
    model-facing JSON Schema and must be supplied by the caller at invocation
    time (node-injected context, e.g. ``user_id``).

    The wrapper is transparent (``functools.wraps``) so direct calls work
    normally.
    """

    def _decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        schema = _build_schema(func, description)

        @functools.wraps(func)
        def _wrapper(*args: Any, **kwargs: Any) -> Any:
            return func(*args, **kwargs)

        _REGISTRY[func.__name__] = (_wrapper, schema)
        return _wrapper

    if fn is not None:
        # Called as @tool (no parens)
        return _decorator(fn)

    # Called as @tool(...) with keyword args
    return _decorator


# ---------------------------------------------------------------------------
# Public look-up / invocation helpers
# ---------------------------------------------------------------------------


def get_tool(name: str) -> tuple[Callable[..., Any], dict[str, Any]]:
    """Return ``(callable, schema)`` for a registered tool.

    Raises:
        KeyError: if the tool name is not registered.
    """
    if name not in _REGISTRY:
        raise KeyError(f"Tool '{name}' is not registered. Known: {list(_REGISTRY)}")
    return _REGISTRY[name]


def get_tool_schemas(names: list[str]) -> list[dict[str, Any]]:
    """Return schema dicts for a subset of registered tools.

    Raises:
        KeyError: if any name is not registered.
    """
    return [get_tool(n)[1] for n in names]


def get_registered_tools() -> dict[str, tuple[Callable[..., Any], dict[str, Any]]]:
    """Return a shallow copy of the full registry (name → (fn, schema))."""
    return dict(_REGISTRY)
