# Phase 1B: Receipt Scanning Module

## Goal
Scan/upload receipts, extract items via OCR + AI, auto-add high confidence items and review low confidence ones.

**Exit Criteria:** Can photograph/upload receipt and have items added to pantry with minimal manual work.

---

## Dependencies
- Phase 0 complete
- Phase 1A complete (pantry API works)

---

## Tasks

### 1B.1 OCR Integration

- [ ] Research OCR options:
  - Tesseract (local, free)
  - Google Cloud Vision (free tier: 1000/month)
  - AWS Textract (free tier: 1000/month)
- [ ] Implement OCR service abstraction
- [ ] `POST /api/scan/ocr` - upload image, return raw text
- [ ] Handle image preprocessing (rotation, contrast)

### 1B.2 Receipt Parsing (AI)

- [ ] Create receipt parsing prompt
- [ ] Extract: item name, quantity, unit (ignore prices)
- [ ] Return confidence score per item
- [ ] Handle common OCR errors (abbreviations, typos)
- [ ] Schema for parsed items:
  ```python
  class ParsedItem(BaseModel):
      raw_text: str           # Original OCR text
      name: str               # Cleaned name
      quantity: float | None
      unit: str | None
      confidence: float       # 0.0 - 1.0
  ```

### 1B.3 Post-Processing

- [ ] Normalize parsed item names
- [ ] Auto-assign categories
- [ ] Estimate expiry dates
- [ ] Split into: `auto_add` (confidence > 0.8) and `needs_review` (< 0.8)

### 1B.4 Scan API

- [ ] `POST /api/scan/receipt` - full flow:
  - Accept image upload
  - Run OCR
  - Parse with AI
  - Normalize + categorize
  - Return split results
- [ ] `POST /api/scan/confirm` - confirm reviewed items
- [ ] `POST /api/scan/undo` - undo auto-added items (within session)

### 1B.5 Scan UI - Upload

- [ ] Scan page with upload zone
- [ ] Drag & drop or click to upload
- [ ] Camera capture (for mobile/PWA later)
- [ ] Loading state while processing
- [ ] Error handling (bad image, OCR failed, etc.)

### 1B.6 Scan UI - Results

- [ ] Show two sections:
  1. **Auto-added** - items added to pantry (with "Undo" option)
  2. **Needs Review** - items requiring confirmation
- [ ] For review items:
  - Show original OCR text vs. parsed name
  - Allow edit before confirming
  - Checkbox to select/deselect
  - "Add Selected" button
- [ ] Success state: "X items added to pantry"
- [ ] Link to view pantry

---

## API Contracts

### ScanReceiptRequest
```typescript
// multipart/form-data
{
  image: File
}
```

### ScanReceiptResponse
```typescript
interface ScanReceiptResponse {
  request_id: string;
  auto_added: PantryItem[];        // Already added to DB
  needs_review: ParsedItem[];       // Awaiting confirmation
  warnings: string[];               // Any issues encountered
}

interface ParsedItem {
  temp_id: string;                  // For tracking during review
  raw_text: string;
  name: string;
  name_normalized: string;
  quantity: number | null;
  unit: string | null;
  category: Category;
  expiry_date: string | null;
  confidence: number;
}
```

### ConfirmItemsRequest
```typescript
interface ConfirmItemsRequest {
  request_id: string;
  items: ConfirmItem[];
}

interface ConfirmItem {
  temp_id: string;
  name: string;           // May be edited by user
  quantity: number;
  unit: string;
  category: Category;
  location: Location;
  expiry_date: string | null;
}
```

---

## Confidence Scoring

| Scenario | Confidence Adjustment |
|----------|----------------------|
| Clean OCR match | Base confidence |
| Abbreviation expanded | -0.1 |
| Fuzzy name match | -0.15 |
| Missing quantity | -0.1 |
| Unknown category | -0.1 |

**Thresholds:**
- `>= 0.8`: Auto-add
- `0.5 - 0.8`: Needs review
- `< 0.5`: Likely noise, show but mark as uncertain

---

## Verification

Phase 1B complete when:

1. Can upload receipt image
2. OCR extracts text correctly
3. AI parses items with reasonable accuracy
4. High confidence items auto-add to pantry
5. Low confidence items can be reviewed and confirmed
6. Can undo auto-added items
7. Works with at least 2 different receipt formats

---

## Time Estimate

~3-4 sessions (OCR integration can be tricky)

---

## Notes

- Start with Tesseract (free, local) for MVP
- Receipt parsing is the hardest part - expect iteration
- Consider storing raw OCR text for debugging
- Mobile camera support can come later (PWA APIs)
