"""LangGraph workflow orchestration for BubblyChef."""

# Lazy imports to avoid circular dependencies.
# Use: from bubbly_chef.workflows.chat_ingest import run_chat_workflow

__all__ = [
    "run_chat_workflow",
    "get_chat_router_graph",
    "build_chat_router_graph",
    "run_chat_ingest",
    "receipt_ingest_graph",
    "run_receipt_ingest",
    "product_ingest_graph",
    "run_product_ingest",
    "recipe_ingest_graph",
    "run_recipe_ingest",
]


def __getattr__(name: str):  # noqa: N807
    """Lazy import to avoid circular imports."""
    if name in (
        "run_chat_workflow",
        "get_chat_router_graph",
        "build_chat_router_graph",
        "run_chat_ingest",
    ):
        from bubbly_chef.workflows.chat_ingest import (
            build_chat_router_graph,
            get_chat_router_graph,
            run_chat_ingest,
            run_chat_workflow,
        )
        return locals()[name]
    if name in ("receipt_ingest_graph", "run_receipt_ingest"):
        from bubbly_chef.workflows.receipt_ingest import (
            receipt_ingest_graph,
            run_receipt_ingest,
        )
        return locals()[name]
    if name in ("product_ingest_graph", "run_product_ingest"):
        from bubbly_chef.workflows.product_ingest import (
            product_ingest_graph,
            run_product_ingest,
        )
        return locals()[name]
    if name in ("recipe_ingest_graph", "run_recipe_ingest"):
        from bubbly_chef.workflows.recipe_ingest import (
            recipe_ingest_graph,
            run_recipe_ingest,
        )
        return locals()[name]
    raise AttributeError(f"module 'bubbly_chef.workflows' has no attribute {name!r}")
