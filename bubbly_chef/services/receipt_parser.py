"""Receipt parsing service using AI."""

import uuid

from pydantic import BaseModel, Field

from bubbly_chef.ai import AIManager
from bubbly_chef.domain.defaults import get_default_quantity_and_unit
from bubbly_chef.domain.expiry import estimate_expiry_days, get_default_location
from bubbly_chef.domain.normalizer import detect_category, normalize_food_name
from bubbly_chef.models.pantry import FoodCategory, StorageLocation


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

    items: list[dict]


RECEIPT_PARSE_PROMPT = """You are a grocery receipt parser.
Extract food items from this receipt text.

CRITICAL RULES:
1. Only extract FOOD items - ignore non-food (bags, tax, totals, discounts, coupons)
2. IGNORE PRICES - Numbers with decimals (e.g., 6.17, 2.10) are PRICES, NOT quantities
3. Only extract quantity if explicitly mentioned BEFORE or IN the item name
   (e.g., "2X MILK", "3 Bananas", "Eggs 12pk")
4. If a number appears AFTER the item name, it is probably a price - IGNORE IT
5. Expand common abbreviations: ORG=Organic, GAL=Gallon, DZ=Dozen, PK=Pack, LB=Pound, OZ=Ounce
6. Clean up item names - remove store codes, PLU numbers, asterisks
7. If quantity is ambiguous or not clearly specified, return null

Receipt text:
```
{receipt_text}
```

For each food item, extract:
- name: Clean item name without quantity (e.g., "Large Eggs" not "Large Eggs 6.17")
- quantity: ONLY if explicitly part of the product (e.g., "12pk"). Return null if uncertain.
- unit: Unit ONLY if clearly specified in the product name (e.g., "gallon", "dozen", "lb", "pk")
- confidence: Your confidence 0.0-1.0 that this is a valid food item

EXAMPLES OF CORRECT PARSING:
✓ "Large Eggs      6.17" →
  {{"name": "Large Eggs", "quantity": null, "unit": null, "confidence": 0.95}}
✓ "Milk             1.80" → {{"name": "Milk", "quantity": null, "unit": null, "confidence": 0.95}}
✓ "2X Milk         3.80" → {{"name": "Milk", "quantity": 2, "unit": null, "confidence": 0.95}}
✓ "Bananas 1lb     0.68" → {{"name": "Bananas", "quantity": 1, "unit": "lb", "confidence": 0.90}}
✓ "Canned Tuna 12pk 11.98" →
  {{"name": "Canned Tuna", "quantity": 12, "unit": "item", "confidence": 0.92}}
✓ "Cheese Crackers 2.10" →
  {{"name": "Cheese Crackers", "quantity": null, "unit": null, "confidence": 0.90}}

WRONG - DO NOT DO THIS:
✗ "Eggs 6.17" should NOT become {{"quantity": 6}} - that's a price!
✗ "Crackers 2.10" should NOT become {{"quantity": 2}} - that's a price!

Return JSON with an "items" array. Only include items you're reasonably confident are food items."""


# Common non-food keywords to filter out
NON_FOOD_KEYWORDS = {
    "tax",
    "total",
    "subtotal",
    "change",
    "cash",
    "credit",
    "debit",
    "bag",
    "bags",
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


def is_likely_food(name: str) -> bool:
    """Check if item name is likely a food item."""
    name_lower = name.lower()
    for keyword in NON_FOOD_KEYWORDS:
        if keyword in name_lower:
            return False
    # Must have at least 2 characters
    return len(name.strip()) >= 2


async def parse_receipt(
    ocr_text: str,
    ai_manager: AIManager,
) -> ReceiptParseResult:
    """
    Parse receipt OCR text into structured items using AI.

    Args:
        ocr_text: Raw text from OCR
        ai_manager: AI manager for LLM calls

    Returns:
        Parsed items with confidence scores
    """
    warnings = []

    if not ocr_text.strip():
        return ReceiptParseResult(items=[], warnings=["Receipt appears to be empty or unreadable"])

    # Call AI to parse the receipt
    prompt = RECEIPT_PARSE_PROMPT.format(receipt_text=ocr_text)

    try:
        result = await ai_manager.complete(
            prompt=prompt,
            response_schema=LLMReceiptOutput,
            temperature=0.3,  # Lower temperature for more consistent parsing
        )
    except Exception as e:
        return ReceiptParseResult(items=[], warnings=[f"AI parsing failed: {str(e)}"])

    # Process each item
    parsed_items = []

    for item_data in result.items:
        name = item_data.get("name", "").strip()

        if not name:
            continue

        # Filter out non-food items
        if not is_likely_food(name):
            warnings.append(f"Filtered non-food item: {name}")
            continue

        # Get raw confidence from AI
        ai_confidence = item_data.get("confidence", 0.7)

        # Normalize the name
        name_normalized = normalize_food_name(name)

        # Detect category
        detected_cat = detect_category(name_normalized)
        category = FoodCategory(detected_cat) if detected_cat else FoodCategory.OTHER

        # Get default location
        location = StorageLocation(get_default_location(category.value))

        # Estimate expiry
        expiry_days = estimate_expiry_days(name_normalized, category.value, location.value)

        # Adjust confidence based on various factors
        confidence = ai_confidence

        # Penalize if category couldn't be detected
        if category == FoodCategory.OTHER:
            confidence -= 0.1

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
            # Small confidence penalty for missing quantity (but we filled it in)
            confidence -= 0.05

        # Clamp confidence
        confidence = max(0.0, min(1.0, confidence))

        parsed_item = ParsedReceiptItem(
            raw_text=name,  # Store original name as raw_text
            name=name,
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
