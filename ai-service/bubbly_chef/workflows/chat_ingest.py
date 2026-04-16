"""Backward-compatibility shim — all logic lives in workflows/router.py."""

from bubbly_chef.workflows.router import (  # noqa: F401
    build_chat_router_graph,
    classify_intent,
    get_chat_router_graph,
    initialize_state,
    route_by_intent,
    run_chat_ingest,
    run_chat_workflow,
    run_chat_workflow_streaming,
)

__all__ = [
    "build_chat_router_graph",
    "classify_intent",
    "get_chat_router_graph",
    "initialize_state",
    "route_by_intent",
    "run_chat_ingest",
    "run_chat_workflow",
    "run_chat_workflow_streaming",
]
