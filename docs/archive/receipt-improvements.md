# Receipt Scanning Improvements Plan

## Issues to Fix

### 1. Add "Skipped Items" Section
**Current Behavior:** Items with confidence < 0.5 are silently dropped
**Desired Behavior:** Show skipped items in UI with reason, allow user to manually add them

**Changes Required:**
- Backend: Add `skipped_items` to `ScanReceiptResponse`
- Backend: Track skipped items in scan session
- Frontend: Add "Skipped Items" section in results UI
- Frontend: Allow user to click on skipped item to move to "needs review"

### 2. Allow Editing Auto-Added Items
**Current Behavior:** Auto-added items shown with checkmark, no editing
**Desired Behavior:** Allow editing or removing auto-added items before finalizing

**Changes Required:**
- Frontend: Add edit/remove controls to auto-added items section
- Frontend: Track edited auto-added items
- Frontend: On confirm, update modified items via API
- Backend: Add batch update endpoint (optional) or use existing update endpoint

### 3. Fix AI Quantity Parsing (Confusing Prices)
**Current Behavior:** AI mistakes prices for quantities (6.17 → 6 dozen, 2.10 → 2 item)
**Desired Behavior:** AI ignores numbers after item name, defaults to quantity=null

**Changes Required:**
- Backend: Improve AI prompt to ignore numbers that look like prices
- Backend: Add price pattern detection (e.g., numbers with decimals near end of line)
- Backend: Be more explicit about quantity format

### 4. Default Quantity Logic
**Current Behavior:** Backend defaults to 1.0, but AI sometimes guesses wrong quantities
**Desired Behavior:** If AI returns null quantity, use smart defaults (eggs=1 dozen, milk=1 gallon, etc.)

**Changes Required:**
- Backend: Add `get_default_quantity(item_name, category)` function
- Backend: Apply default quantity based on item type

---

## Implementation Details

### Change 1: Add Skipped Items to Response

**File:** `bubbly_chef/api/routes/scan.py`

Add new response field:
```python
class ScanReceiptResponse(BaseModel):
    request_id: str
    auto_added: list[PantryItem]
    needs_review: list[ParsedItemResponse]
    skipped: list[ParsedItemResponse]  # NEW
    warnings: list[str]
```

Update endpoint logic (lines 136-147):
```python
auto_add_items = []
review_items = []
skipped_items = []  # NEW

for item in parse_result.items:
    if item.confidence >= auto_add_threshold:
        auto_add_items.append(item)
    elif item.confidence >= review_threshold:
        review_items.append(item)
    else:
        skipped_items.append(item)  # Don't drop them!
```

Return skipped items (after line 199):
```python
skipped_responses = []
for item in skipped_items:
    # Same conversion logic as review_responses
    skipped_responses.append(ParsedItemResponse(...))

return ScanReceiptResponse(
    request_id=request_id,
    auto_added=added_items,
    needs_review=review_responses,
    skipped=skipped_responses,  # NEW
    warnings=parse_result.warnings,
)
```

**File:** `web/src/types/index.ts`
```typescript
export interface ScanReceiptResponse {
  request_id: string;
  auto_added: PantryItem[];
  needs_review: ParsedItemResponse[];
  skipped: ParsedItemResponse[];  // NEW
  warnings: string[];
}
```

**File:** `web/src/pages/Scan.tsx`

Add state:
```typescript
const [skippedItems, setSkippedItems] = useState<ScannedItem[]>([]);
```

Map skipped items from response:
```typescript
setSkippedItems(
  result.skipped.map(item => ({
    id: item.temp_id,
    name: item.name,
    quantity: item.quantity || 1,
    unit: item.unit || 'item',
    confidence: getConfidenceLevel(item.confidence),
    rawText: item.raw_text,
  }))
);
```

Add UI section:
```typescript
{/* Skipped Items Section */}
{skippedItems.length > 0 && (
  <div className="bg-soft-charcoal/5 rounded-2xl p-4">
    <h3 className="font-bold text-soft-charcoal flex items-center gap-2 mb-3">
      <X className="text-soft-charcoal/40" size={20} />
      Skipped ({skippedItems.length})
    </h3>
    <p className="text-xs text-soft-charcoal/60 mb-3">
      These items were not recognized or had very low confidence
    </p>
    <div className="space-y-2">
      {skippedItems.map((item) => (
        <div key={item.id} className="flex items-center justify-between p-2 bg-white rounded-lg">
          <div>
            <p className="text-sm text-soft-charcoal">{item.name}</p>
            <p className="text-xs text-soft-charcoal/40">Original: {item.rawText}</p>
          </div>
          <button
            onClick={() => moveToReview(item.id)}
            className="text-xs text-pastel-pink hover:underline"
          >
            Add for Review
          </button>
        </div>
      ))}
    </div>
  </div>
)}
```

---

### Change 2: Allow Editing Auto-Added Items

**File:** `web/src/pages/Scan.tsx`

Make auto-added items editable (similar to needs-review):
```typescript
{/* Auto-Added Section - NOW EDITABLE */}
{highConfidenceItems.length > 0 && (
  <div className="bg-pastel-mint/10 rounded-2xl p-4 border border-pastel-mint/30">
    <div className="flex items-center justify-between mb-3">
      <h3 className="font-bold text-soft-charcoal flex items-center gap-2">
        <CheckCircle className="text-pastel-mint" size={20} />
        Auto-Added ({highConfidenceItems.length})
      </h3>
      <button
        onClick={handleUndo}
        disabled={undoMutation.isPending}
        className="text-xs text-soft-charcoal/60 hover:text-soft-charcoal underline"
      >
        {undoMutation.isPending ? 'Undoing...' : 'Undo All'}
      </button>
    </div>

    <div className="space-y-2">
      {highConfidenceItems.map((item) => (
        <div key={item.id} className="bg-white rounded-xl p-3">
          <div className="flex items-start justify-between">
            <div className="flex-1 space-y-2">
              {/* Make these editable */}
              <input
                ref={(el) => {
                  if (!autoAddedRefs.current.has(item.id)) {
                    autoAddedRefs.current.set(item.id, { name: null, quantity: null, unit: null });
                  }
                  const refs = autoAddedRefs.current.get(item.id);
                  if (refs) refs.name = el;
                }}
                type="text"
                defaultValue={item.name}
                className="w-full px-3 py-2 rounded-lg border border-pastel-mint/20 focus:outline-none focus:border-pastel-mint focus:ring-2 focus:ring-pastel-mint/20 text-sm"
              />
              <div className="flex gap-2">
                <input
                  ref={(el) => {
                    const refs = autoAddedRefs.current.get(item.id);
                    if (refs) refs.quantity = el;
                  }}
                  type="number"
                  defaultValue={item.quantity}
                  className="w-20 px-3 py-1.5 rounded-lg border border-pastel-mint/20 focus:outline-none focus:border-pastel-mint text-sm"
                />
                <input
                  ref={(el) => {
                    const refs = autoAddedRefs.current.get(item.id);
                    if (refs) refs.unit = el;
                  }}
                  type="text"
                  defaultValue={item.unit}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-pastel-mint/20 focus:outline-none focus:border-pastel-mint text-sm"
                />
              </div>
            </div>
            <button
              onClick={() => removeAutoAddedItem(item.id)}
              className="ml-2 p-1 hover:bg-soft-charcoal/5 rounded-full"
            >
              <X size={16} className="text-soft-charcoal/60" />
            </button>
          </div>
        </div>
      ))}
    </div>
  </div>
)}
```

Update confirm logic to check for edits and update via API:
```typescript
const addSelectedItems = async () => {
  if (!requestId) {
    handleReset();
    return;
  }

  try {
    // 1. Handle edited auto-added items (update existing in DB)
    for (const item of highConfidenceItems) {
      const refs = autoAddedRefs.current.get(item.id);
      if (refs) {
        const editedName = refs.name?.value || item.name;
        const editedQuantity = Number(refs.quantity?.value || item.quantity);
        const editedUnit = refs.unit?.value || item.unit;

        // Check if anything changed
        if (editedName !== item.name || editedQuantity !== item.quantity || editedUnit !== item.unit) {
          await updateMutation.mutateAsync({
            id: item.id,
            item: {
              name: editedName,
              quantity: editedQuantity,
              unit: editedUnit,
            }
          });
        }
      }
    }

    // 2. Handle needs-review items (add new to DB)
    if (needsReviewItems.length > 0) {
      const itemsToConfirm = needsReviewItems.map(item => {
        const refs = needsReviewRefs.current.get(item.id);
        return {
          temp_id: item.id,
          name: refs?.name?.value || item.name,
          quantity: Number(refs?.quantity?.value || item.quantity),
          unit: refs?.unit?.value || item.unit,
        };
      });

      await confirmMutation.mutateAsync({
        requestId,
        items: itemsToConfirm,
      });
    }

    handleReset();
  } catch (error) {
    console.error('Failed to save items:', error);
    setErrorMessage(error instanceof Error ? error.message : 'Failed to save items');
  }
};
```

---

### Change 3: Fix AI Quantity Parsing

**File:** `bubbly_chef/services/receipt_parser.py`

Update prompt (lines 40-70):
```python
RECEIPT_PARSE_PROMPT = """You are a grocery receipt parser. Extract food items from this receipt text.

IMPORTANT RULES:
1. Only extract FOOD items - ignore non-food (bags, tax, totals, discounts, coupons)
2. IGNORE PRICES - Numbers with decimal points (e.g., 6.17, 2.10) are prices, NOT quantities
3. Only extract quantity if explicitly mentioned BEFORE the item name (e.g., "2X MILK", "3 Bananas")
4. Common abbreviations: ORG=Organic, GAL=Gallon, DZ=Dozen, LB=Pound, OZ=Ounce
5. Clean up item names - remove store codes, PLU numbers, asterisks
6. If quantity is ambiguous or looks like a price, return null for quantity

Receipt text:
```
{receipt_text}
```

For each food item, extract:
- name: Clean item name (e.g., "Large Eggs")
- quantity: ONLY if explicitly stated and NOT a price. Return null if uncertain.
- unit: Unit of measurement ONLY if clearly specified (e.g., "gallon", "dozen", "lb")
- confidence: Your confidence 0.0-1.0 that this is a valid food item

EXAMPLES:
✓ "Large Eggs      6.17" → {{"name": "Large Eggs", "quantity": null, "unit": null, "confidence": 0.95}}
✓ "2X Milk        3.80" → {{"name": "Milk", "quantity": 2, "unit": null, "confidence": 0.95}}
✓ "Bananas 1lb    0.68" → {{"name": "Bananas", "quantity": 1, "unit": "lb", "confidence": 0.90}}
✗ "Eggs 6.17" should NOT become "quantity": 6

Return JSON with an "items" array."""
```

---

### Change 4: Smart Default Quantities

**File:** `bubbly_chef/domain/defaults.py` (new file)

```python
"""Default quantity and unit inference."""

from bubbly_chef.models.pantry import Category

# Common default quantities for items when not specified
DEFAULT_QUANTITIES = {
    # Dairy
    "milk": {"quantity": 1, "unit": "gallon"},
    "eggs": {"quantity": 1, "unit": "dozen"},
    "butter": {"quantity": 1, "unit": "lb"},
    "cheese": {"quantity": 1, "unit": "lb"},
    "yogurt": {"quantity": 1, "unit": "container"},

    # Produce
    "bananas": {"quantity": 1, "unit": "bunch"},
    "lettuce": {"quantity": 1, "unit": "head"},
    "tomatoes": {"quantity": 1, "unit": "lb"},

    # Meat
    "chicken": {"quantity": 1, "unit": "lb"},
    "beef": {"quantity": 1, "unit": "lb"},

    # Bakery
    "bread": {"quantity": 1, "unit": "loaf"},

    # Default fallback
    "default": {"quantity": 1, "unit": "item"},
}

def get_default_quantity_and_unit(name: str, category: str) -> tuple[float, str]:
    """
    Get smart default quantity and unit for an item.

    Args:
        name: Normalized item name
        category: Item category

    Returns:
        Tuple of (quantity, unit)
    """
    name_lower = name.lower()

    # Check for specific item matches
    for key, defaults in DEFAULT_QUANTITIES.items():
        if key in name_lower:
            return defaults["quantity"], defaults["unit"]

    # Fallback to category-based defaults
    if category == Category.DAIRY.value:
        return 1, "item"
    elif category == Category.PRODUCE.value:
        return 1, "lb"
    elif category == Category.MEAT.value:
        return 1, "lb"

    # Ultimate fallback
    return DEFAULT_QUANTITIES["default"]["quantity"], DEFAULT_QUANTITIES["default"]["unit"]
```

**File:** `bubbly_chef/services/receipt_parser.py`

Update item processing (after line 183):
```python
# If quantity/unit is missing, use smart defaults
if quantity is None or unit is None:
    from bubbly_chef.domain.defaults import get_default_quantity_and_unit
    default_qty, default_unit = get_default_quantity_and_unit(
        name_normalized,
        category.value
    )
    quantity = quantity or default_qty
    unit = unit or default_unit

parsed_item = ParsedReceiptItem(
    raw_text=name,
    name=name,
    name_normalized=name_normalized,
    quantity=quantity,  # Now guaranteed to have a value
    unit=unit,          # Now guaranteed to have a value
    category=category,
    location=location,
    expiry_days=expiry_days,
    confidence=confidence,
)
```

---

## Summary of Changes

### Backend Changes:
1. `api/routes/scan.py` - Add skipped_items to response
2. `services/receipt_parser.py` - Improve AI prompt to ignore prices
3. `domain/defaults.py` - New file with smart default quantities
4. `types/index.ts` - Add skipped field to ScanReceiptResponse

### Frontend Changes:
1. `pages/Scan.tsx` - Add skipped items section
2. `pages/Scan.tsx` - Make auto-added items editable
3. `pages/Scan.tsx` - Add move-to-review functionality for skipped items

### Expected Results:
- ✅ User sees all items (auto-added, needs review, skipped)
- ✅ User can edit ANY item before finalizing
- ✅ AI doesn't confuse prices with quantities
- ✅ Items without quantities get smart defaults (eggs→1 dozen, milk→1 gallon)

---

## Testing Checklist

- [ ] Upload same receipt and verify Eggs shows "1 dozen" not "6 dozen"
- [ ] Verify Cheese Crackers shows "1 item" not "2 item"
- [ ] Verify skipped items section appears with low-confidence items
- [ ] Edit an auto-added item and confirm change persists in pantry
- [ ] Move a skipped item to review and add it
- [ ] Verify Milk appears in results (not filtered out)
