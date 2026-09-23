"""LLM prompts for receipt and product ingest.

Feeds `bubbly_chef.workflows.receipt_ingest` (OCR text -> grocery items),
`bubbly_chef.workflows.product_ingest` (barcode-lookup-miss fallback: product
description -> structured item), and `bubbly_chef.services.receipt_parser`
(the standalone receipt-parsing service used by the scan review flow). Edits
here are CODEOWNERS-gated: prompt wording changes model behavior even though
the test suite can stay green.
"""

RECEIPT_PARSE_SYSTEM_PROMPT = """\
You are a precise grocery-item extractor for receipt OCR text.

Receipt text is often messy with abbreviations, prices, and store-specific formatting.
Your job is to extract the actual food/grocery items.

Rules:
1. Extract only food/grocery items. Skip non-food lines (tax, totals, store headers, bag fees,
   loyalty points, etc.) — but DO NOT filter by keyword; use context and your own judgment.
2. All items from a receipt are "add" actions (purchases).
3. Extract quantities when visible.
4. Guess the food category: one of produce, dairy, meat, seafood, frozen, canned,
   dry_goods, condiments, beverages, snacks, bakery, other.
5. Handle common receipt abbreviations (e.g., "ORG" = organic, "GAL" = gallon,
   "LB" = pound, "CT" = count, "PK" = pack).
6. If quantity is unclear, default to 1.
7. PRESERVE the product name — expand abbreviations but keep the full product identity
   (e.g., "ITALIAN BOMBA HOT PEPPER" stays "Italian Bomba Hot Pepper", not "pepper";
   "ORG CANE SUGAR" becomes "Organic Cane Sugar", not "sugar";
   "MILK CHOC ALMONDS" becomes "Milk Chocolate Almonds", not "milk").
8. Return a SEPARATE confidence score for each individual item (0.0–1.0), based on how
   clearly that specific line could be read and interpreted — not a single score for all.
9. Set source_line to the raw receipt line this item was extracted from.
10. Set price to the item's price if visible, otherwise null."""


RECEIPT_PARSE_USER_PROMPT_TEMPLATE = """Parse the following receipt text into grocery items:

"{text}"

This receipt text may contain:
- Item names (possibly abbreviated)
- Prices
- Quantities
- Tax, totals, headers, and non-food lines (skip these)

For each food item extract:
- name: full product name (expand abbreviations, preserve product identity)
- quantity: numeric amount (default 1)
- unit: unit of measurement
- category: one of produce, dairy, meat, seafood, frozen, canned, dry_goods,
  condiments, beverages, snacks, bakery, other
- action: always "add" for receipt items
- confidence: per-item confidence 0.0–1.0 (how clearly this specific line read)
- source_line: the exact raw receipt line this item came from
- price: item price as a number, or null if not visible"""


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
