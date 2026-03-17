"""
Product barcode/description ingest workflow using LangGraph.

This graph handles product lookup via barcode (OpenFoodFacts stub)
or text description parsing.
"""

import logging
from datetime import date
from uuid import uuid4

from langgraph.graph import END, StateGraph

from bubbly_chef.config import settings
from bubbly_chef.models.base import ProposalEnvelope
from bubbly_chef.models.pantry import (
    ActionType,
    PantryItem,
    PantryProposal,
    PantryUpsertAction,
)
from bubbly_chef.tools.expiry import get_expiry_heuristics
from bubbly_chef.tools.llm_client import LLMError, get_ollama_client
from bubbly_chef.tools.normalizer import get_normalizer
from bubbly_chef.tools.product_lookup import get_product_lookup
from bubbly_chef.workflows.state import (
    LLMParsedItem,
    WorkflowState,
    create_pantry_envelope,
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

        # Determine category from product info
        normalizer = get_normalizer()
        category = normalizer.get_category(product_info.name or "")

        return {
            **state,
            "product_found": True,
            "parsed_items": [
                {
                    "name": product_info.name or "Unknown Product",
                    "quantity": state.get("quantity_override", 1.0),
                    "unit": state.get("unit_override", "item"),
                    "category": product_info.category or category.value,
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
    Node: Normalize product item (deterministic).
    """
    parsed_items = state.get("parsed_items", [])

    if not parsed_items:
        return {
            **state,
            "normalized_items": [],
        }

    normalizer = get_normalizer()
    expiry = get_expiry_heuristics()

    normalized = []

    for item in parsed_items:
        name = item.get("name", "")
        original_name = name

        # Normalize name
        normalized_name = normalizer.normalize(name)

        # Get category
        category = map_category(item.get("category"))

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
            "name": normalized_name,
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
    """
    normalized_items = state.get("normalized_items", [])
    base_confidence = state.get("confidence", 0.5)

    if not normalized_items:
        return {
            **state,
            "actions": [],
            "requires_review": True,
        }

    actions = []
    field_confidences = {}

    for idx, item_data in enumerate(normalized_items):
        pantry_item = PantryItem(
            id=uuid4(),
            name=item_data.get("name", "unknown"),
            original_name=item_data.get("original_name"),
            category=map_category(item_data.get("category")),
            storage_location=item_data.get("storage_location", "pantry"),
            quantity=item_data.get("quantity", 1.0),
            unit=item_data.get("unit", "item"),
            brand=item_data.get("brand"),
            barcode=item_data.get("barcode"),
            purchase_date=date.fromisoformat(item_data["purchase_date"])
            if item_data.get("purchase_date")
            else None,
            expiry_date=date.fromisoformat(item_data["expiry_date"])
            if item_data.get("expiry_date")
            else None,
            estimated_expiry=item_data.get("estimated_expiry", True),
        )

        action = PantryUpsertAction(
            action_type=ActionType.ADD,
            item=pantry_item,
            confidence=base_confidence,
            reasoning="From product scan/description",
        )
        actions.append(action)

        field_confidences[f"item_{idx}_name"] = base_confidence

    requires_review = (
        base_confidence < settings.auto_apply_confidence_threshold
        or len(state.get("errors", [])) > 0
    )

    return {
        **state,
        "actions": actions,
        "field_confidences": field_confidences,
        "requires_review": requires_review,
    }


# =============================================================================
# Graph Construction
# =============================================================================


def build_product_ingest_graph() -> StateGraph:
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
    final_state = await product_ingest_graph.ainvoke(initial_state)

    # Build proposal
    actions = final_state.get("actions", [])

    proposal = PantryProposal(
        actions=actions,
        source_text=description,
        dedup_applied=False,
        normalization_applied=True,
    )

    return create_pantry_envelope(
        proposal=proposal,
        confidence=final_state.get("confidence", 0.0),
        field_confidences=final_state.get("field_confidences", {}),
        warnings=final_state.get("warnings", []),
        errors=final_state.get("errors", []),
    )
