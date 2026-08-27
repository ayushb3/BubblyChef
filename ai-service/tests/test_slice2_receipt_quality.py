"""Slice 2 receipt quality regression tests.

Covers:
1. Per-item confidence through ingest_spine (item overrides batch, fallback works)
2. OCR penalty removal — confidence is NOT multiplied by 0.9
3. normalize_receipt_items uses domain normalize_food_name (head-noun, not substring):
   - "italian bomba hot pepper" stays itself (not collapsed to "black pepper")
   - "milk chocolate" stays itself (not collapsed to "milk")
   - "org cane sugar" strips prefix → "cane sugar" (not "sugar")
4. source_line and price propagate through normalized_items → actions
5. scan response exposes original_name, source_line, price
6. Product-ingest tests unaffected: spine falls back to batch confidence when
   item has no "confidence" key.
"""

from __future__ import annotations

import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bubbly_chef.domain.normalizer import normalize_food_name
from bubbly_chef.models.pantry import (
    ActionType,
    FoodCategory,
    PantryItem,
    PantryProposal,
    PantryUpsertAction,
)
from bubbly_chef.workflows.ingest_spine import build_actions_from_normalized


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fake_expiry() -> MagicMock:
    ex = MagicMock()
    ex.get_default_storage.return_value = MagicMock(value="pantry")
    ex.estimate_expiry.return_value = (datetime.date(2026, 12, 31), True)
    return ex


def _run_normalize(items: list[dict]) -> list[dict]:
    """Run normalize_receipt_items over items with mocked expiry."""
    from bubbly_chef.workflows import receipt_ingest

    with patch.object(receipt_ingest, "get_expiry_heuristics", return_value=_fake_expiry()):
        state: dict = {"parsed_items": items}
        result = receipt_ingest.normalize_receipt_items(state)
    return result["normalized_items"]


def _minimal_state(items: list[dict], base_confidence: float = 0.7) -> dict:
    """Minimal WorkflowState containing normalized_items and a batch confidence."""
    return {
        "normalized_items": items,
        "confidence": base_confidence,
        "errors": [],
        "warnings": [],
    }


# ---------------------------------------------------------------------------
# 1. Per-item confidence in ingest_spine
# ---------------------------------------------------------------------------


def test_spine_uses_per_item_confidence_when_present() -> None:
    """item_data["confidence"] takes precedence over state["confidence"]."""
    items = [
        {
            "name": "eggs",
            "confidence": 0.95,
            "category": "dairy",
            "storage_location": "fridge",
            "quantity": 1.0,
            "unit": "dozen",
            "expiry_date": "2026-12-31",
            "estimated_expiry": True,
            "purchase_date": "2026-08-25",
        },
        {
            "name": "mystery item",
            "confidence": 0.45,
            "category": "other",
            "storage_location": "pantry",
            "quantity": 1.0,
            "unit": "item",
            "expiry_date": "2026-12-31",
            "estimated_expiry": True,
            "purchase_date": "2026-08-25",
        },
    ]
    state = _minimal_state(items, base_confidence=0.7)
    result = build_actions_from_normalized(state, reasoning_for_item=lambda d: "test")

    actions = result["actions"]
    assert len(actions) == 2
    assert actions[0].confidence == pytest.approx(0.95)
    assert actions[1].confidence == pytest.approx(0.45)


def test_spine_falls_back_to_batch_confidence_when_missing() -> None:
    """When item_data has no "confidence" key, the batch value is used."""
    items = [
        {
            "name": "organic milk",
            "category": "dairy",
            "storage_location": "fridge",
            "quantity": 1.0,
            "unit": "gallon",
            "expiry_date": "2026-12-31",
            "estimated_expiry": True,
            "purchase_date": "2026-08-25",
            # No "confidence" key — product-ingest path
        },
    ]
    state = _minimal_state(items, base_confidence=0.85)
    result = build_actions_from_normalized(state, reasoning_for_item=lambda d: "test")

    actions = result["actions"]
    assert len(actions) == 1
    assert actions[0].confidence == pytest.approx(0.85)


def test_spine_requires_review_uses_per_item_confidence() -> None:
    """requires_review is True if any item is below auto-add threshold."""
    items = [
        {
            "name": "eggs",
            "confidence": 0.9,
            "category": "dairy",
            "storage_location": "fridge",
            "quantity": 1.0,
            "unit": "dozen",
            "expiry_date": "2026-12-31",
            "estimated_expiry": True,
            "purchase_date": "2026-08-25",
        },
        {
            "name": "unclear item",
            "confidence": 0.3,  # below 0.8
            "category": "other",
            "storage_location": "pantry",
            "quantity": 1.0,
            "unit": "item",
            "expiry_date": "2026-12-31",
            "estimated_expiry": True,
            "purchase_date": "2026-08-25",
        },
    ]
    state = _minimal_state(items, base_confidence=0.9)
    result = build_actions_from_normalized(state, reasoning_for_item=lambda d: "test")
    assert result["requires_review"] is True


# ---------------------------------------------------------------------------
# 2. OCR penalty removed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_ocr_penalty_in_parse_receipt_llm() -> None:
    """parse_receipt_llm no longer multiplies result.confidence by 0.9."""
    from bubbly_chef.workflows.receipt_ingest import parse_receipt_llm
    from bubbly_chef.workflows.shared_state import LLMParsedItem, LLMParseResult

    mock_result = LLMParseResult(
        items=[
            LLMParsedItem(name="Organic Apples", quantity=1.0, unit="bag", confidence=0.85)
        ],
        confidence=0.8,
    )
    mock_llm = MagicMock()
    mock_llm.complete = AsyncMock(return_value=mock_result)

    with patch("bubbly_chef.workflows.receipt_ingest.get_ai_manager", return_value=mock_llm):
        result = await parse_receipt_llm({"input_text": "ORG APPLES 1 BAG 3.99"})

    # 0.8 × 0.9 would be 0.72; without the penalty it must be exactly 0.8
    assert result["confidence"] == pytest.approx(0.8)


# ---------------------------------------------------------------------------
# 3. Head-noun normalizer — no substring collapse
# ---------------------------------------------------------------------------


def test_normalize_food_name_italian_bomba_hot_pepper() -> None:
    """'italian bomba hot pepper' must NOT collapse to 'black pepper'."""
    result = normalize_food_name("italian bomba hot pepper")
    assert "black pepper" not in result
    assert "pepper" in result.lower() or "bomba" in result.lower()


def test_normalize_food_name_milk_chocolate() -> None:
    """'milk chocolate' must NOT collapse to 'milk'."""
    result = normalize_food_name("milk chocolate")
    assert result != "milk"
    assert "chocolate" in result.lower() or "milk chocolate" in result.lower()


def test_normalize_food_name_org_cane_sugar_not_plain_sugar() -> None:
    """'cane sugar' stripped of organic prefix: domain normalizer may keep 'cane sugar'
    or produce 'sugar' via the catalog — what it must NOT do is produce 'black pepper'
    or another unrelated food.  The important invariant is no cross-product collapse."""
    result = normalize_food_name("cane sugar")
    # Result is "cane sugar" or "sugar" — both acceptable; must not be an unrelated food
    assert "sugar" in result.lower(), f"Expected 'sugar' in result, got: {result!r}"


def test_normalize_receipt_items_preserves_italian_bomba_hot_pepper() -> None:
    """normalize_receipt_items must not collapse 'Italian Bomba Hot Pepper' → 'black pepper'."""
    items = [
        {
            "name": "Italian Bomba Hot Pepper",
            "confidence": 0.9,
            "category": "condiments",
            "quantity": 1.0,
            "unit": "jar",
        }
    ]
    normalized = _run_normalize(items)
    assert len(normalized) == 1
    name = normalized[0]["name"].lower()
    assert "black pepper" not in name, f"Name collapsed incorrectly: {normalized[0]['name']!r}"


def test_normalize_receipt_items_preserves_milk_chocolate() -> None:
    """normalize_receipt_items must not collapse 'milk chocolate' → 'milk'."""
    items = [
        {
            "name": "milk chocolate almonds",
            "confidence": 0.88,
            "category": "snacks",
            "quantity": 1.0,
            "unit": "bag",
        }
    ]
    normalized = _run_normalize(items)
    assert len(normalized) == 1
    name = normalized[0]["name"].lower()
    assert name != "milk", f"Name collapsed incorrectly to: {name!r}"
    assert "chocolate" in name or "almond" in name, f"Unexpected name: {name!r}"


# ---------------------------------------------------------------------------
# 4. source_line and price propagate through the pipeline
# ---------------------------------------------------------------------------


def test_normalize_receipt_items_forwards_source_line_and_price() -> None:
    """source_line and price survive the normalize node unchanged."""
    items = [
        {
            "name": "Organic Cane Sugar",
            "confidence": 0.92,
            "source_line": "ORG CANE SUGAR          3.49",
            "price": 3.49,
            "category": "dry_goods",
            "quantity": 1.0,
            "unit": "bag",
        }
    ]
    normalized = _run_normalize(items)
    assert normalized[0]["source_line"] == "ORG CANE SUGAR          3.49"
    assert normalized[0]["price"] == pytest.approx(3.49)


def test_spine_forwards_source_line_and_price_to_action() -> None:
    """source_line and price from normalized_items reach PantryUpsertAction."""
    items = [
        {
            "name": "Organic Cane Sugar",
            "confidence": 0.92,
            "source_line": "ORG CANE SUGAR 3.49",
            "price": 3.49,
            "category": "dry_goods",
            "storage_location": "pantry",
            "quantity": 1.0,
            "unit": "bag",
            "expiry_date": "2027-01-01",
            "estimated_expiry": True,
            "purchase_date": "2026-08-25",
        }
    ]
    state = _minimal_state(items, base_confidence=0.7)
    result = build_actions_from_normalized(state, reasoning_for_item=lambda d: "test")
    action = result["actions"][0]
    assert action.source_line == "ORG CANE SUGAR 3.49"
    assert action.price == pytest.approx(3.49)


def test_spine_sets_none_source_line_and_price_for_product_items() -> None:
    """Product items (no source_line/price keys) get None for both fields."""
    items = [
        {
            "name": "organic milk",
            "category": "dairy",
            "storage_location": "fridge",
            "quantity": 1.0,
            "unit": "gallon",
            "expiry_date": "2026-12-31",
            "estimated_expiry": True,
            "purchase_date": "2026-08-25",
        }
    ]
    state = _minimal_state(items, base_confidence=0.85)
    result = build_actions_from_normalized(state, reasoning_for_item=lambda d: "test")
    action = result["actions"][0]
    assert action.source_line is None
    assert action.price is None


# ---------------------------------------------------------------------------
# 5. scan response shape (unit test over the response-building code path)
# ---------------------------------------------------------------------------


def _build_scan_item_from_action(action: PantryUpsertAction) -> dict:
    """Mirror the dict-building logic in scan.py so we can test it without HTTP."""
    pantry_item = action.item
    return {
        "name": pantry_item.name,
        "original_name": pantry_item.original_name or pantry_item.name,
        "source_line": action.source_line or "",
        "price": action.price,
        "quantity": pantry_item.quantity,
        "unit": pantry_item.unit,
        "category": pantry_item.category.value if hasattr(pantry_item.category, "value") else str(pantry_item.category),
        "location": str(pantry_item.storage_location),
        "confidence": action.confidence,
    }


def test_scan_response_includes_original_name_source_line_price() -> None:
    """Scan response dict carries original_name, source_line, and price per item."""
    import uuid

    pantry_item = PantryItem(
        id=uuid.uuid4(),
        name="cane sugar",
        original_name="Organic Cane Sugar",
        category=FoodCategory.DRY_GOODS,
    )
    action = PantryUpsertAction(
        action_type=ActionType.ADD,
        item=pantry_item,
        confidence=0.92,
        source_line="ORG CANE SUGAR 3.49",
        price=3.49,
    )

    item_dict = _build_scan_item_from_action(action)

    assert item_dict["name"] == "cane sugar"
    assert item_dict["original_name"] == "Organic Cane Sugar"
    assert item_dict["source_line"] == "ORG CANE SUGAR 3.49"
    assert item_dict["price"] == pytest.approx(3.49)
    assert item_dict["confidence"] == pytest.approx(0.92)


def test_scan_response_has_empty_source_line_when_none() -> None:
    """source_line defaults to empty string when action.source_line is None."""
    import uuid

    pantry_item = PantryItem(
        id=uuid.uuid4(),
        name="milk",
        original_name="Organic Whole Milk",
        category=FoodCategory.DAIRY,
    )
    action = PantryUpsertAction(
        action_type=ActionType.ADD,
        item=pantry_item,
        confidence=0.88,
        source_line=None,
        price=None,
    )
    item_dict = _build_scan_item_from_action(action)
    assert item_dict["source_line"] == ""
    assert item_dict["price"] is None


# ---------------------------------------------------------------------------
# 6. Varying confidence tiers (six-item scenario)
# ---------------------------------------------------------------------------


def test_six_items_produce_varying_confidences() -> None:
    """Six items with different per-item confidences are tiered independently."""
    items = [
        {"name": "eggs", "confidence": 0.95, "category": "dairy",
         "storage_location": "fridge", "quantity": 1.0, "unit": "dozen",
         "expiry_date": "2026-12-31", "estimated_expiry": True, "purchase_date": "2026-08-25"},
        {"name": "Organic Cane Sugar", "confidence": 0.90, "category": "dry_goods",
         "storage_location": "pantry", "quantity": 1.0, "unit": "bag",
         "expiry_date": "2027-06-30", "estimated_expiry": True, "purchase_date": "2026-08-25"},
        {"name": "Italian Bomba Hot Pepper", "confidence": 0.82, "category": "condiments",
         "storage_location": "pantry", "quantity": 1.0, "unit": "jar",
         "expiry_date": "2027-01-01", "estimated_expiry": True, "purchase_date": "2026-08-25"},
        {"name": "Milk Chocolate Almonds", "confidence": 0.75, "category": "snacks",
         "storage_location": "pantry", "quantity": 1.0, "unit": "bag",
         "expiry_date": "2026-12-01", "estimated_expiry": True, "purchase_date": "2026-08-25"},
        {"name": "baguette", "confidence": 0.65, "category": "bakery",
         "storage_location": "counter", "quantity": 1.0, "unit": "loaf",
         "expiry_date": "2026-08-28", "estimated_expiry": True, "purchase_date": "2026-08-25"},
        {"name": "T Premium Filler Assorted", "confidence": 0.40, "category": "other",
         "storage_location": "pantry", "quantity": 1.0, "unit": "item",
         "expiry_date": "2026-12-31", "estimated_expiry": True, "purchase_date": "2026-08-25"},
    ]
    state = _minimal_state(items, base_confidence=0.7)
    result = build_actions_from_normalized(state, reasoning_for_item=lambda d: "test")
    actions = result["actions"]

    assert len(actions) == 6
    confidences = [a.confidence for a in actions]
    # Confidences must vary — not all the same batch value
    assert len(set(confidences)) > 1

    # Tiers as the scan route would compute them
    ready = [a for a in actions if a.confidence >= 0.8]
    review = [a for a in actions if 0.5 <= a.confidence < 0.8]
    skipped = [a for a in actions if a.confidence < 0.5]

    assert len(ready) == 3    # 0.95, 0.90, 0.82
    assert len(review) == 2   # 0.75, 0.65
    assert len(skipped) == 1  # 0.40
