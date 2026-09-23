"""
Receipt OCR text ingest workflow using LangGraph.

This graph parses OCR-extracted receipt text into structured
pantry update proposals.
"""

import logging
from datetime import date

from langgraph.graph import END, StateGraph

from bubbly_chef.api.deps import get_ai_manager
from bubbly_chef.models.base import ProposalEnvelope
from bubbly_chef.models.pantry import (
    PantryProposal,
)
from bubbly_chef.domain.normalizer import normalize_food_name, normalize_to_base_unit, resolve_category
from bubbly_chef.prompts.ingest import (
    RECEIPT_PARSE_SYSTEM_PROMPT,
    RECEIPT_PARSE_USER_PROMPT_TEMPLATE,
)
from bubbly_chef.tools.expiry import get_expiry_heuristics
from bubbly_chef.workflows.ingest_spine import (
    build_actions_from_normalized,
    build_proposal_envelope,
)
from bubbly_chef.workflows.state import (
    LLMParseResult,
    WorkflowState,
    map_category,
)

logger = logging.getLogger(__name__)


# =============================================================================
# Graph Nodes
# =============================================================================


async def parse_receipt_llm(state: WorkflowState) -> WorkflowState:
    """
    Node: Use LLM to parse receipt OCR text into structured items.
    """
    input_text = state.get("input_text", "")

    if not input_text.strip():
        return {
            **state,
            "parsed_items": [],
            "parse_error": "Empty receipt text",
            "confidence": 0.0,
        }

    llm = get_ai_manager()
    prompt = (
        RECEIPT_PARSE_SYSTEM_PROMPT
        + "\n\n"
        + RECEIPT_PARSE_USER_PROMPT_TEMPLATE.format(text=input_text)
    )

    try:
        result = await llm.complete(
            prompt=prompt,
            response_schema=LLMParseResult,
            temperature=0.1,
        )

        if not isinstance(result, LLMParseResult):
            return {
                **state,
                "parsed_items": [],
                "parse_error": "LLM returned non-structured response",
                "errors": state.get("errors", []) + ["LLM returned non-structured response"],
                "confidence": 0.0,
                "requires_review": True,
            }

        # All receipt items are "add" actions
        parsed_items = []
        for item in result.items:
            item_dict = item.model_dump()
            item_dict["action"] = "add"  # Force add for receipts
            parsed_items.append(item_dict)

        # Use the batch confidence as-is — the OCR penalty (×0.9) has been removed.
        # Per-item confidence from the LLM already encodes readability at the line
        # level, so stamping an additional document-level penalty only pushes every
        # item below the 0.8 auto-add threshold regardless of quality.
        adjusted_confidence = result.confidence

        logger.info(
            f"Receipt LLM parsed {len(parsed_items)} items with confidence {adjusted_confidence}"
        )

        return {
            **state,
            "parsed_items": parsed_items,
            "parse_error": None,
            "confidence": adjusted_confidence,
        }

    except Exception as e:
        logger.error(f"LLM error: {e}")
        return {
            **state,
            "parsed_items": [],
            "parse_error": str(e),
            "errors": state.get("errors", []) + [f"LLM error: {e}"],
            "confidence": 0.0,
            "requires_review": True,
        }


def clean_receipt_items(state: WorkflowState) -> WorkflowState:
    """
    Node: Clean and filter receipt items (deterministic).

    Drops only degenerate rows (empty or absurdly long names). Non-food
    accounting lines (tax, total, cash, …) are left to the LLM parse and the
    per-item confidence tiers — a substring keyword filter here silently ate
    real food (``"bag"`` → baguette/cabbage, ``"cash"`` → cashews).
    """
    parsed_items = state.get("parsed_items", [])

    cleaned = []
    warnings = state.get("warnings", [])

    for item in parsed_items:
        name = item.get("name", "").lower()

        # Skip if name is too short or too long
        if len(name) < 2:
            warnings.append(f"Skipped item with too short name: {item.get('name')}")
            continue
        if len(name) > 100:
            warnings.append(f"Skipped item with too long name: {str(item.get('name', ''))[:50]}...")
            continue

        cleaned.append(item)

    return {
        **state,
        "parsed_items": cleaned,
        "warnings": warnings,
    }


def normalize_receipt_items(state: WorkflowState) -> WorkflowState:
    """
    Node: resolve category/expiry/unit metadata for receipt items (deterministic).

    The display name the LLM produced is written to the pantry unchanged — see
    issue #257. ``normalize_food_name`` is a *match key* for internal lookups
    (category, expiry heuristics, unit/density resolution), not a display-name
    rewriter: it used to overwrite "chicken" with "chicken breast" and similar,
    which is data loss the user never asked for. It is still used here, but
    only to resolve those internal lookups; ``normalized_name`` never reaches
    the ``name`` field written to the pantry row.

    ``source_line`` and ``price`` from the LLM parse are forwarded as-is so they
    reach the scan response without any additional plumbing.
    """
    parsed_items = state.get("parsed_items", [])
    expiry = get_expiry_heuristics()

    normalized = []

    for item in parsed_items:
        name = item.get("name", "")
        original_name = name

        # Match key only (category/expiry/unit lookups below) — never written
        # back as the display name. See the node docstring.
        normalized_name = normalize_food_name(name)

        # Get category: prefer the LLM's answer over the deterministic
        # catalog/keyword matcher. The schema now constrains LLMParsedItem.category
        # to the FoodCategory enum (see shared_state.py), so the LLM can no longer
        # emit unmatchable free-form strings like "dairy & eggs" — the vocabulary
        # mismatch that used to justify preferring the deterministic path is gone.
        # resolve_category's substring/keyword matching is still weak on its own
        # (e.g. "italian bomba hot pepper" -> "produce" via "pepper"), so it is
        # kept only as a fallback for when the LLM returns nothing or "other".
        llm_category = item.get("category")
        if llm_category and str(llm_category).lower() != "other":
            category = map_category(llm_category)
        else:
            resolved = resolve_category(normalized_name)
            category = map_category(resolved) if resolved else map_category(None)

        # Get storage location
        storage = expiry.get_default_storage(category)

        # Estimate expiry
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
            # source_line and price pass through from the LLM parse via **item
        }

        # Unit normalization (dual-store: display unit + base unit)
        qty = item.get("quantity", 1.0)
        unit = item.get("unit", "item")
        base_qty, base_unit = normalize_to_base_unit(normalized_name, qty, unit, category.value)
        normalized_item["quantity_base"] = base_qty
        normalized_item["unit_base"] = base_unit

        normalized.append(normalized_item)

    return {
        **state,
        "normalized_items": normalized,
    }


def create_receipt_actions(state: WorkflowState) -> WorkflowState:
    """
    Node: Create PantryUpsertAction objects from receipt items.

    Delegates to the shared ingest spine so logic is not duplicated
    with product_ingest.  Receipt-specific reasoning string is passed
    as the ``reasoning_for_item`` factory.
    """

    def _reasoning(item_data: dict) -> str:
        return f"From receipt: '{item_data.get('original_name', item_data.get('name', 'unknown'))}'"

    return build_actions_from_normalized(state, reasoning_for_item=_reasoning)


# =============================================================================
# Graph Construction
# =============================================================================


def build_receipt_ingest_graph() -> StateGraph[WorkflowState]:
    """Build the receipt ingest LangGraph workflow."""

    workflow = StateGraph(WorkflowState)

    # Add nodes
    workflow.add_node("parse_llm", parse_receipt_llm)
    workflow.add_node("clean", clean_receipt_items)
    workflow.add_node("normalize", normalize_receipt_items)
    workflow.add_node("create_actions", create_receipt_actions)

    # Define edges
    workflow.set_entry_point("parse_llm")
    workflow.add_edge("parse_llm", "clean")
    workflow.add_edge("clean", "normalize")
    workflow.add_edge("normalize", "create_actions")
    workflow.add_edge("create_actions", END)

    return workflow


# Compiled graph
receipt_ingest_graph = build_receipt_ingest_graph().compile()


async def run_receipt_ingest(
    ocr_text: str,
    store_name: str | None = None,
    purchase_date: str | None = None,
) -> ProposalEnvelope[PantryProposal]:
    """
    Run the receipt ingest workflow and return a proposal envelope.

    Args:
        ocr_text: OCR-extracted text from receipt
        store_name: Optional store name for context
        purchase_date: Optional purchase date (YYYY-MM-DD)

    Returns:
        ProposalEnvelope containing the pantry update proposal
    """
    # Add store context to the text if provided
    context_text = ocr_text
    if store_name:
        context_text = f"Store: {store_name}\n\n{ocr_text}"

    # Initialize state
    initial_state: WorkflowState = {
        "input_text": context_text,
        "input_type": "receipt",
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
    final_state = await receipt_ingest_graph.ainvoke(initial_state)  # type: ignore[arg-type]

    return build_proposal_envelope(final_state, source_text=ocr_text)
