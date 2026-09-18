"""Receipt parsing service using AI."""

import uuid
from typing import Any

from pydantic import BaseModel, Field

from bubbly_chef.ai import AIManager
from bubbly_chef.domain.defaults import get_default_quantity_and_unit
from bubbly_chef.domain.expiry import estimate_expiry_days, get_default_location
from bubbly_chef.domain.normalizer import (
    detect_category,
    normalize_food_name,
    normalize_to_library,
)
from bubbly_chef.models.pantry import FoodCategory, StorageLocation
from bubbly_chef.prompts.ingest import RECEIPT_PARSE_PROMPT


class ParsedReceiptItem(BaseModel):
    """A single item parsed from a receipt."""

    temp_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    raw_text: str = Field(description="Original text from OCR")
    name: str = Field(description="Cleaned item name")
    name_normalized: str = Field(default="")
    quantity: float | None = Field(default=None)
    unit: str | None = Field(default=None)
    category: FoodCategory = Field(default=FoodCategory.OTHER)
    location: StorageLocation = Field(default=StorageLocation.PANTRY)
    expiry_days: int | None = Field(default=None)
    confidence: float = Field(ge=0.0, le=1.0)


class ReceiptParseResult(BaseModel):
    """Result from AI parsing of receipt."""

    items: list[ParsedReceiptItem]
    warnings: list[str] = Field(default_factory=list)


class LLMReceiptOutput(BaseModel):
    """Schema for LLM structured output."""

    items: list[dict[str, Any]]


# Common non-food keywords to filter out
NON_FOOD_KEYWORDS = {
    "tax",
    "total",
    "subtotal",
    "change",
    "cash",
    "credit",
    "debit",
    "coupon",
    "discount",
    "savings",
    "member",
    "rewards",
    "receipt",
    "store",
    "thank",
    "visit",
    "date",
    "time",
    "cashier",
    "transaction",
    "balance",
    "payment",
    "card",
    "visa",
    "mastercard",
    "approved",
    "amount",
    "tender",
    "refund",
}

# Words that are only non-food when they appear alone or as a short descriptor
# e.g. "BAG", "PLASTIC BAG" → non-food; "Organic Spinach Bag" → food
NON_FOOD_STANDALONE = {"bag", "bags"}


def is_likely_food(name: str) -> bool:
    """Check if item name is likely a food item."""
    name_lower = name.lower()
    for keyword in NON_FOOD_KEYWORDS:
        if keyword in name_lower:
            return False
    # "bag/bags" are non-food when the whole name is just a bag descriptor
    # (1-2 words ending in bag/bags, no actual food context)
    words = name_lower.split()
    if words and words[-1] in NON_FOOD_STANDALONE and len(words) <= 2:
        return False
    # Must have at least 2 characters
    return len(name.strip()) >= 2


async def parse_receipt(
    ocr_text: str,
    ai_manager: AIManager,
) -> ReceiptParseResult:
    """Parse receipt OCR text into structured items using AI."""
    if not ocr_text.strip():
        return ReceiptParseResult(items=[], warnings=["Receipt appears to be empty or unreadable"])

    prompt = RECEIPT_PARSE_PROMPT.format(receipt_text=ocr_text)

    try:
        result = await ai_manager.complete(
            prompt=prompt,
            response_schema=LLMReceiptOutput,
            temperature=0.3,
        )
    except Exception as e:
        return ReceiptParseResult(items=[], warnings=[f"AI parsing failed: {str(e)}"])

    if isinstance(result, str):
        return ReceiptParseResult(
            items=[],
            warnings=[f"AI returned raw text instead of structured output: {result[:100]}"],
        )

    return parse_receipt_items(result)


def parse_receipt_items(llm_output: LLMReceiptOutput) -> ReceiptParseResult:
    """Convert LLMReceiptOutput (from either OCR+LLM or vision) into a ReceiptParseResult."""
    warnings: list[str] = []
    parsed_items = []

    for item_data in llm_output.items:
        name = item_data.get("name", "").strip()

        if not name:
            continue

        # Filter out non-food items
        if not is_likely_food(name):
            warnings.append(f"Filtered non-food item: {name}")
            continue

        # Get raw confidence from AI
        ai_confidence = item_data.get("confidence", 0.7)

        # Title-case for display (receipts often come in ALL CAPS)
        display_name = name.title()

        # Normalize: first basic cleanup, then try fuzzy match against food library
        name_basic = normalize_food_name(name)
        name_normalized = normalize_to_library(name_basic)

        # Detect category from the normalized name
        detected_cat = detect_category(name_normalized)
        category = FoodCategory(detected_cat) if detected_cat else FoodCategory.OTHER

        # Get default location
        location = StorageLocation(get_default_location(category.value))

        # Estimate expiry
        expiry_days = estimate_expiry_days(name_normalized, category.value, location.value)

        # Use AI confidence directly - it already reflects food item certainty
        confidence = ai_confidence

        # Get quantity and unit from AI or use smart defaults
        quantity = item_data.get("quantity")
        unit = item_data.get("unit")

        # If quantity or unit is missing, use smart defaults based on item type
        if quantity is None or unit is None:
            default_qty, default_unit = get_default_quantity_and_unit(
                name_normalized, category.value
            )
            quantity = quantity if quantity is not None else default_qty
            unit = unit if unit is not None else default_unit

        # Clamp confidence
        confidence = max(0.0, min(1.0, confidence))

        parsed_item = ParsedReceiptItem(
            raw_text=name,  # Store original name as raw_text
            name=display_name,
            name_normalized=name_normalized,
            quantity=quantity,
            unit=unit,
            category=category,
            location=location,
            expiry_days=expiry_days,
            confidence=confidence,
        )

        parsed_items.append(parsed_item)

    if not parsed_items:
        warnings.append("No food items could be extracted from receipt")

    return ReceiptParseResult(items=parsed_items, warnings=warnings)
