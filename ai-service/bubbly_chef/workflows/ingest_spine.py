"""Shared normalize → proposal tail for all pantry ingest workflows.

Both receipt_ingest and product_ingest (and future modality extractors) share
the same tail: take a list of normalized item dicts and produce a
ProposalEnvelope[PantryProposal].

Parameterization
----------------
- ``reasoning_for_item`` — callable that receives an item_data dict and returns
  the ``reasoning`` string for the PantryUpsertAction.  Each modality passes a
  different closure (receipt uses the original receipt line; product uses a
  fixed label).

Superset fields
---------------
``brand`` and ``barcode`` are always read from item_data (via ``item_data.get``),
so they are safe to omit for receipt items — they'll just be None.  Product
items carry them naturally.

Empty-list guard
----------------
If ``normalized_items`` is empty the function returns an empty actions list and
sets ``requires_review=True`` immediately (mirrors product_ingest behaviour).
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import date
from uuid import uuid4

from bubbly_chef.config import settings
from bubbly_chef.models.base import ProposalEnvelope
from bubbly_chef.models.pantry import (
    ActionType,
    PantryItem,
    PantryProposal,
    PantryUpsertAction,
)
from bubbly_chef.workflows.state import (
    WorkflowState,
    create_pantry_envelope,
    map_category,
)

logger = logging.getLogger(__name__)


def build_actions_from_normalized(
    state: WorkflowState,
    reasoning_for_item: Callable[[dict], str],
) -> WorkflowState:
    """LangGraph node: build PantryUpsertAction objects from normalized items.

    This is the shared tail used by both receipt_ingest and product_ingest
    (and any future extractor).  It replaces the per-workflow
    ``create_receipt_actions`` / ``create_product_action`` implementations.

    Args:
        state: Current workflow state.  Must have ``normalized_items`` and
            ``confidence`` populated by an upstream normalize node.
        reasoning_for_item: Callable that receives an item_data dict and
            returns the ``reasoning`` string for the upsert action.

    Returns:
        Updated state with ``actions``, ``field_confidences``, and
        ``requires_review`` set.
    """
    normalized_items: list[dict] = state.get("normalized_items", [])
    base_confidence: float = state.get("confidence", 0.5)

    # Empty-list guard (matches product_ingest behaviour)
    if not normalized_items:
        return {
            **state,
            "actions": [],
            "requires_review": True,
        }

    actions: list[PantryUpsertAction] = []
    field_confidences: dict[str, float] = {}

    for idx, item_data in enumerate(normalized_items):
        # Per-item confidence: the LLM emits a confidence for each item; the
        # batch value from state["confidence"] is used as a fallback so that
        # product-ingest (which has no per-item signal) keeps working unchanged.
        item_confidence: float = float(item_data.get("confidence", base_confidence))

        pantry_item = PantryItem(
            id=uuid4(),
            name=item_data.get("name", "unknown"),
            original_name=item_data.get("original_name"),
            category=map_category(item_data.get("category")),
            storage_location=item_data.get("storage_location", "pantry"),
            quantity=item_data.get("quantity", 1.0),
            unit=item_data.get("unit", "item"),
            quantity_base=item_data.get("quantity_base"),
            unit_base=item_data.get("unit_base"),
            # Superset fields — safe for receipt (None) and product (populated)
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
            confidence=item_confidence,
            reasoning=reasoning_for_item(item_data),
            # Receipt-specific provenance — None for non-receipt paths (product_ingest
            # items never set these keys, so .get() returns None safely).
            source_line=item_data.get("source_line"),
            price=item_data.get("price"),
        )
        actions.append(action)
        field_confidences[f"item_{idx}_name"] = item_confidence

    requires_review = (
        any(a.confidence < settings.auto_apply_confidence_threshold for a in actions)
        or len(state.get("errors", [])) > 0
        or len(actions) == 0
    )

    return {
        **state,
        "actions": actions,
        "field_confidences": field_confidences,
        "requires_review": requires_review,
    }


def build_proposal_envelope(
    final_state: WorkflowState,
    source_text: str | None,
) -> ProposalEnvelope[PantryProposal]:
    """Convert a completed WorkflowState into a ProposalEnvelope.

    Shared by all modalities: receipt, product, and future extractors.

    Args:
        final_state: State after the graph has finished executing.
        source_text: The raw input text (receipt OCR text, product
            description, etc.) stored on the proposal for traceability.

    Returns:
        A ``ProposalEnvelope[PantryProposal]``.
    """
    actions: list[PantryUpsertAction] = final_state.get("actions", [])

    proposal = PantryProposal(
        actions=actions,
        source_text=source_text,
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
