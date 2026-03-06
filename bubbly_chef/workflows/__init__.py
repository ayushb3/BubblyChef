"""LangGraph workflow orchestration for BubblyChef."""

from bubbly_chef.workflows.chat_ingest import (
    run_chat_ingest,
    run_chat_workflow,
    get_chat_router_graph,
    build_chat_router_graph,
)
from bubbly_chef.workflows.receipt_ingest import (
    receipt_ingest_graph,
    run_receipt_ingest,
)
from bubbly_chef.workflows.product_ingest import (
    product_ingest_graph,
    run_product_ingest,
)
from bubbly_chef.workflows.recipe_ingest import recipe_ingest_graph, run_recipe_ingest

__all__ = [
    # Chat workflow (new API)
    "run_chat_workflow",
    "get_chat_router_graph",
    "build_chat_router_graph",
    # Legacy API (backward compat)
    "run_chat_ingest",
    # Other workflows
    "receipt_ingest_graph",
    "run_receipt_ingest",
    "product_ingest_graph",
    "run_product_ingest",
    "recipe_ingest_graph",
    "run_recipe_ingest",
]
