"""
Product barcode/description ingest workflow using LangGraph.

This graph handles product lookup via barcode (OpenFoodFacts stub)
or text description parsing.
"""

import logging
from datetime import date

from langgraph.graph import END, StateGraph

from bubbly_chef.domain.normalizer import normalize_food_name, resolve_category
from bubbly_chef.models.base import ProposalEnvelope
from bubbly_chef.models.pantry import (
    PantryProposal,
)
from bubbly_chef.tools.expiry import get_expiry_heuristics
from bubbly_chef.tools.llm_client import LLMError, get_ollama_client
from bubbly_chef.tools.product_lookup import get_product_lookup
from bubbly_chef.workflows.ingest_spine import (
    build_actions_from_normalized,
    build_proposal_envelope,
)
from bubbly_chef.workflows.state import (
    LLMParsedItem,
    WorkflowState,
    map_category,
)

logger = logging.getLogger(__name__)


# =============================================================================
# Extended State for Product Workflow
# =============================================================================


class ProductWorkflowState(WorkflowState):
    """Extended state for product ingest workflow."""

    barcode: str | None
    description: str | None
    quantity_override: float
    unit_override: str
    product_found: bool


# =============================================================================
# LLM Prompts
# =============================================================================

PRODUCT_PARSE_SYSTEM_PROMPT = """\
You are a helpful assistant that parses product descriptions \
into structured item data.

Given a product description, extract:
1. The product name
2. Any quantity information
3. The food category

Be concise and extract just the core product information."""


PRODUCT_PARSE_USER_PROMPT_TEMPLATE = """Parse this product description:

"{description}"

Extract:
- name: the product name
- quantity: amount if mentioned (default 1)
- unit: unit of measurement (default "item")
- category: food category (produce, dairy, meat, seafood, frozen, \
canned, dry_goods, condiments, beverages, snacks, bakery, other)"""


# =============================================================================
# Graph Nodes
# =============================================================================


async def lookup_barcode(state: ProductWorkflowState) -> ProductWorkflowState:
    """
    Node: Try to look up product by barcode.

    Uses the product lookup service (OpenFoodFacts stub).
    """
    barcode = state.get("barcode")

    if not barcode:
        return {
            **state,
            "product_found": False,
        }

    lookup = get_product_lookup()
    product_info = await lookup.lookup_barcode(barcode)

    if product_info.found:
        logger.info(f"Found product for barcode {barcode}: {product_info.name}")

        # OpenFoodFacts's own category is authoritative when present. When it
        # is not, fall back to resolve_category's head-noun/catalog matcher
        # (see normalize_product below) rather than guessing here — passing
        # the raw category through and deferring the fallback keeps category
        # resolution in one place.
        return {
            **state,
            "product_found": True,
            "parsed_items": [
                {
                    "name": product_info.name or "Unknown Product",
                    "quantity": state.get("quantity_override", 1.0),
                    "unit": state.get("unit_override", "item"),
                    "category": product_info.category,
                    "action": "add",
                    "brand": product_info.brand,
                    "barcode": barcode,
                }
            ],
            "confidence": 0.95,  # High confidence from database
        }
    else:
        logger.info(f"No product found for barcode {barcode}")
        return {
            **state,
            "product_found": False,
            "warnings": state.get("warnings", []) + [f"Barcode {barcode} not found in database"],
        }


async def parse_description_llm(state: ProductWorkflowState) -> ProductWorkflowState:
    """
    Node: Parse product description if barcode lookup failed.
    """
    # Skip if we already found the product
    if state.get("product_found"):
        return state

    description = state.get("description") or state.get("input_text", "")

    if not description.strip():
        return {
            **state,
            "parsed_items": [],
            "parse_error": "No description provided",
            "confidence": 0.0,
            "errors": state.get("errors", []) + ["No product description or barcode provided"],
        }

    llm = get_ollama_client()
    prompt = PRODUCT_PARSE_USER_PROMPT_TEMPLATE.format(description=description)

    try:
        result, error = await llm.generate_structured(
            prompt=prompt,
            response_model=LLMParsedItem,
            system_prompt=PRODUCT_PARSE_SYSTEM_PROMPT,
            temperature=0.1,
        )

        if error or result is None:
            logger.warning(f"LLM parse error: {error}")
            return {
                **state,
                "parsed_items": [],
                "parse_error": error or "No result from LLM",
                "confidence": 0.3,
                "errors": state.get("errors", []) + ["Could not parse product description"],
            }

        # Apply quantity/unit overrides if provided
        quantity = state.get("quantity_override", result.quantity)
        unit = state.get("unit_override", result.unit)

        return {
            **state,
            "parsed_items": [
                {
                    "name": result.name,
                    "quantity": quantity,
                    "unit": unit,
                    "category": result.category,
                    "action": "add",
                    "barcode": state.get("barcode"),
                }
            ],
            "confidence": 0.7,  # Lower confidence for LLM parsing
        }

    except LLMError as e:
        logger.error(f"LLM error: {e}")
        return {
            **state,
            "parsed_items": [],
            "parse_error": str(e),
            "confidence": 0.0,
            "errors": state.get("errors", []) + [f"LLM error: {e}"],
        }


def normalize_product(state: ProductWorkflowState) -> ProductWorkflowState:
    """
    Node: resolve category/expiry metadata for a product item (deterministic).

    The display name is written to the pantry unchanged — see issue #257.
    ``normalize_food_name`` is a *match key* for internal lookups (category,
    expiry heuristics), not a display-name rewriter: it used to overwrite
    "chicken" with "chicken breast" and similar, which is data loss the user
    never asked for. It is still used here, but only to resolve those internal
    lookups; ``normalized_name`` never reaches the ``name`` field written to
    the pantry row. Same reasoning as ``receipt_ingest.normalize_receipt_items``.
    """
    parsed_items = state.get("parsed_items", [])

    if not parsed_items:
        return {
            **state,
            "normalized_items": [],
        }

    expiry = get_expiry_heuristics()

    normalized = []

    for item in parsed_items:
        name = item.get("name", "")
        original_name = name

        # Match key only (category/expiry lookups below) — never written back
        # as the display name. See the node docstring.
        normalized_name = normalize_food_name(name)

        # Get category: prefer a known source (OpenFoodFacts's own category, or
        # the LLM's structured guess) over the deterministic matcher, same
        # precedence as receipt ingest. resolve_category is kept as a fallback
        # for when neither source names anything usable.
        source_category = item.get("category")
        if source_category and str(source_category).lower() != "other":
            category = map_category(source_category)
        else:
            resolved = resolve_category(normalized_name)
            category = map_category(resolved) if resolved else map_category(None)

        # Get storage and expiry
        storage = expiry.get_default_storage(category)
        expiry_date, is_estimated = expiry.estimate_expiry(
            category=category,
            storage=storage,
            name=normalized_name,
            purchase_date=date.today(),
        )

        normalized_item = {
            **item,
            "name": name,
            "original_name": original_name,
            "category": category.value,
            "storage_location": storage.value,
            "expiry_date": expiry_date.isoformat(),
            "estimated_expiry": is_estimated,
            "purchase_date": date.today().isoformat(),
        }
        normalized.append(normalized_item)

    return {
        **state,
        "normalized_items": normalized,
    }


def create_product_action(state: ProductWorkflowState) -> ProductWorkflowState:
    """
    Node: Create PantryUpsertAction for the product.

    Delegates to the shared ingest spine.  Product-specific reasoning
    string is passed as the ``reasoning_for_item`` factory.
    """

    def _reasoning(_item_data: dict) -> str:
        return "From product scan/description"

    return build_actions_from_normalized(state, reasoning_for_item=_reasoning)  # type: ignore[arg-type]


# =============================================================================
# Graph Construction
# =============================================================================


def build_product_ingest_graph() -> StateGraph[ProductWorkflowState]:
    """Build the product ingest LangGraph workflow."""

    workflow = StateGraph(ProductWorkflowState)

    # Add nodes
    workflow.add_node("lookup_barcode", lookup_barcode)
    workflow.add_node("parse_description", parse_description_llm)
    workflow.add_node("normalize", normalize_product)
    workflow.add_node("create_action", create_product_action)

    # Define edges
    workflow.set_entry_point("lookup_barcode")
    workflow.add_edge("lookup_barcode", "parse_description")
    workflow.add_edge("parse_description", "normalize")
    workflow.add_edge("normalize", "create_action")
    workflow.add_edge("create_action", END)

    return workflow


# Compiled graph
product_ingest_graph = build_product_ingest_graph().compile()


async def run_product_ingest(
    barcode: str | None = None,
    description: str | None = None,
    quantity: float = 1.0,
    unit: str = "item",
) -> ProposalEnvelope[PantryProposal]:
    """
    Run the product ingest workflow and return a proposal envelope.

    Args:
        barcode: Product barcode (EAN/UPC)
        description: Product description text
        quantity: Quantity to add
        unit: Unit of measurement

    Returns:
        ProposalEnvelope containing the pantry update proposal
    """
    initial_state: ProductWorkflowState = {
        "input_text": description or "",
        "input_type": "product",
        "barcode": barcode,
        "description": description,
        "quantity_override": quantity,
        "unit_override": unit,
        "product_found": False,
        "parsed_items": [],
        "normalized_items": [],
        "actions": [],
        "warnings": [],
        "errors": [],
        "confidence": 0.0,
        "field_confidences": {},
        "requires_review": True,
    }

    # Run the graph
    final_state = await product_ingest_graph.ainvoke(initial_state)  # type: ignore[arg-type]

    return build_proposal_envelope(final_state, source_text=description)
