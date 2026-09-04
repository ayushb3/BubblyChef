"""Regression tests for the pantry chat-add specificity gate.

Demo walkthrough that surfaced the bug: "add 2 apples and a dozen eggs" (specific,
proposal card renders fine) followed by "I just picked up some stuff at the
store, got a few veggies and some dairy things" — the second turn rendered an
actionable "Add to Pantry" card for the literal item names "Veggies" and
"Dairy Things" at 30% confidence. Clicking Add would have written a pantry row
that can't carry an expiry estimate or match a recipe ingredient, and the
response gave no indication the apples/eggs from the first turn were still
part of the conversation.

This file pins two fixes:
1. Category-level terms ("veggies", "dairy stuff") never reach `actions` —
   create_actions drops them, so there is no path to add them as a literal
   pantry item. review_gate turns them into a clarifying question instead.
2. review_gate reads `session.pending_proposal` (accumulated by
   update_session_node — see test_chat_router.py) to acknowledge items raised
   earlier in the conversation that are still unresolved.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from bubbly_chef.workflows.pantry.nodes import (
    _is_generic_pantry_term,
    create_actions,
    normalize_items,
    review_gate,
)


def _fake_expiry() -> MagicMock:
    ex = MagicMock()
    ex.get_default_storage.return_value = MagicMock(value="pantry")
    ex.estimate_expiry.return_value = (__import__("datetime").date(2026, 12, 31), True)
    return ex


APPLES = {"name": "apples", "quantity": 2, "unit": "item", "category": "produce", "confidence": 0.9}
EGGS = {"name": "eggs", "quantity": 12, "unit": "item", "category": "dairy", "confidence": 0.9}
VEGGIES = {"name": "veggies", "quantity": 1, "unit": "item", "category": "produce", "confidence": 0.6}
DAIRY_STUFF = {"name": "dairy things", "quantity": 1, "unit": "item", "category": "dairy", "confidence": 0.6}


def _run_pipeline(parsed_items: list[dict]) -> dict:
    """Run normalize -> create_actions -> review_gate, skipping the DB/LLM nodes."""
    state: dict = {
        "parsed_items": parsed_items,
        "warnings": [],
        "per_item_confidences": [item.get("confidence", 0.8) for item in parsed_items],
        "confidence": sum(i.get("confidence", 0.8) for i in parsed_items) / max(len(parsed_items), 1),
        "errors": [],
        "session": None,
    }
    with patch("bubbly_chef.workflows.pantry.nodes.get_expiry_heuristics", return_value=_fake_expiry()):
        state = normalize_items(state)  # type: ignore[arg-type]
    state = create_actions(state)  # type: ignore[arg-type]
    state["confidence"] = (
        sum(a.confidence for a in state["actions"]) / len(state["actions"])
        if state["actions"]
        else 0.1
    )
    return review_gate(state)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# _is_generic_pantry_term
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    ["veggies", "veggie", "vegetables", "dairy", "dairy stuff", "dairy things",
     "meat", "stuff", "things", "groceries", "food"],
)
def test_generic_terms_detected(name: str) -> None:
    assert _is_generic_pantry_term(name) is True


@pytest.mark.parametrize(
    "name",
    ["apples", "eggs", "greek yogurt", "cheddar cheese", "broccoli",
     "whole milk", "chicken breast", "onions"],
)
def test_specific_items_not_flagged(name: str) -> None:
    assert _is_generic_pantry_term(name) is False


# ---------------------------------------------------------------------------
# create_actions excludes generic terms
# ---------------------------------------------------------------------------


def test_generic_items_excluded_from_actions_mixed_batch() -> None:
    result = _run_pipeline([APPLES, VEGGIES])
    action_names = {a.item.name.lower() for a in result["actions"]}
    assert action_names == {"apples"}
    assert result["generic_pantry_terms"] == ["veggies"]


def test_all_generic_batch_produces_no_actions() -> None:
    result = _run_pipeline([VEGGIES, DAIRY_STUFF])
    assert result["actions"] == []
    assert set(result["generic_pantry_terms"]) == {"veggies", "dairy things"}


# ---------------------------------------------------------------------------
# review_gate: vague items never get an actionable card, always ask for specifics
# ---------------------------------------------------------------------------


def test_generic_only_turn_requires_review_and_asks_for_specifics() -> None:
    result = _run_pipeline([VEGGIES, DAIRY_STUFF])
    assert result["requires_review"] is True
    assert result["actions"] == []
    assert any("broad" in q or "specific" in q for q in result["clarifying_questions"])
    assert "veggies" in result["assistant_message"].lower()
    assert "dairy things" in result["assistant_message"].lower()


def test_specific_item_alongside_generic_still_proposes_the_specific_one() -> None:
    result = _run_pipeline([APPLES, VEGGIES])
    assert len(result["actions"]) == 1
    assert result["actions"][0].item.name.lower() == "apples"
    assert result["requires_review"] is True  # generic term still needs clarifying
    assert "veggies" in result["assistant_message"].lower()


# ---------------------------------------------------------------------------
# review_gate: context continuity via session.pending_proposal
# ---------------------------------------------------------------------------


def test_assistant_message_references_prior_pending_items() -> None:
    state: dict = {
        "parsed_items": [VEGGIES, DAIRY_STUFF],
        "warnings": [],
        "per_item_confidences": [0.6, 0.6],
        "confidence": 0.6,
        "errors": [],
        "session": {
            "pending_proposal": {"item_names": ["Apples", "Eggs"], "unclear_terms": []},
        },
    }
    with patch("bubbly_chef.workflows.pantry.nodes.get_expiry_heuristics", return_value=_fake_expiry()):
        state = normalize_items(state)  # type: ignore[arg-type]
    state = create_actions(state)  # type: ignore[arg-type]
    state["confidence"] = 0.1
    result = review_gate(state)  # type: ignore[arg-type]

    assert "apples" in result["assistant_message"].lower()
    assert "eggs" in result["assistant_message"].lower()


def test_no_stale_reference_once_items_are_in_the_current_batch() -> None:
    """Don't say 'still with apples' if this turn's own proposal already covers apples."""
    state: dict = {
        "parsed_items": [APPLES],
        "warnings": [],
        "per_item_confidences": [0.9],
        "confidence": 0.9,
        "errors": [],
        "session": {
            "pending_proposal": {"item_names": ["Apples"], "unclear_terms": []},
        },
    }
    with patch("bubbly_chef.workflows.pantry.nodes.get_expiry_heuristics", return_value=_fake_expiry()):
        state = normalize_items(state)  # type: ignore[arg-type]
    state = create_actions(state)  # type: ignore[arg-type]
    state["confidence"] = 0.9
    result = review_gate(state)  # type: ignore[arg-type]

    assert "still with" not in result["assistant_message"].lower()
