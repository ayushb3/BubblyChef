# Receipt Scan Rework

**Date:** 2026-08-19
**Status:** Approved, ready to build
**Baseline:** `main` @ `7c7e8b1`
**Rendered version:** https://claude.ai/code/artifact/5c31019a-8a0e-46d1-a258-c58584f7a01e

A real six-item Trader Joe's receipt scanned cleanly, reached Gemini Vision, and
returned zero items. Six independent causes sit behind that zero. Two are fixed
by deleting code.

---

## Headline

`ai-service/bubbly_chef/services/image_preprocessor.py` still describes itself as
*"Preprocesses receipt images for optimal **Tesseract** OCR performance."*
Tesseract was replaced by Gemini Vision in `21af234`. The pipeline stayed, and
stayed on by default. Binarization, aggressive contrast, denoising, deskewing and
edge-detection cropping are classical-OCR techniques for an engine that is no
longer in this codebase — and a vision model reads an ordinary phone photo better
without any of them.

## What happened

`_preprocess_auto` crops the receipt, then delegates to `_preprocess_aggressive`,
which crops **again** — re-running edge detection on an image that is already
nothing but receipt.

| Stage | Height | Retained |
|---|---|---|
| Original | 3419 px | — |
| After crop #1 | 1944 px | 57% |
| After crop #2 | 992 px | **29%** |

The surviving 29% is the store header. The item list begins below that line and
never reached the model. Gemini behaved correctly on an image containing no
items and logged `parsed 0 items with confidence 0.0`. The `-15°` deskew applied
to a straight-on photo is the same bug's second symptom — the angle is computed
from a mis-cropped fragment.

---

## The six causes

### 1. Double crop discards the item list — FATAL

Two `_crop_receipt` calls on one image in the auto→aggressive path.

`image_preprocessor.py:159` (auto) → `:217` (aggressive)

### 2. The non-food filter eats real food — silent data loss

Substring matching against a keyword list:

```python
if any(kw in name for kw in filter_keywords):
```

`"bag"` kills **baguette**, **bagel**, **cabbage**. `"cash"` kills **cashews**.
`"date"` kills **dates**. It runs *after* the LLM, which the prompt already
instructs to skip non-food — so the cruder filter silently overrides the smarter
one.

`receipt_ingest.py:194`

### 3. The normalizer collapses distinct foods together — quality

Same disease, different file. `FoodNormalizer.normalize` does **bidirectional
substring** matching against the synonym table and returns the first dict hit,
so the result also depends on insertion order:

```python
for synonym, normalized in self._reverse_synonyms.items():
    if synonym in cleaned or cleaned in synonym:
        return normalized
```

Measured:

| Input | Output |
|---|---|
| `italian bomba hot pepper` | **black pepper** |
| `milk chocolate` | **milk** |
| `red pepper flakes` | **bell pepper** |
| `org cane sugar` | **sugar** |
| `cream cheese` | **cheese** |

`tools/normalizer.py:343` — used by receipt **and** product ingest.

**The codebase already solved this once.** `domain/normalizer.py`, written during
the #221 density work, uses head-noun matching precisely so `almond milk`
inherits milk's density while `milk chocolate` and `flour tortilla` resolve to
nothing. There are two normalizers with opposite philosophies and the receipt
path uses the naive one. The fix is to route through the careful matcher, not to
patch the substring loop.

### 4. Per-item confidence exists and is thrown away — design

`LLMParsedItem.confidence` is already in the schema, documented "Per-item
confidence", and survives `model_dump()` into the item dict. The shared spine
ignores it and stamps one batch-level number onto every action, so the three
tiers can never separate two items on one receipt.

`shared_state.py:48` defines it · `ingest_spine.py:71,110` discards it

### 5. The OCR penalty puts auto-add out of reach — design

`result.confidence * 0.9` means the model must return ≥ 0.889 to clear the 0.8
auto-add threshold. Gemini returned a sensible 0.8 → 0.72 → everything lands in
"needs review", every time.

`receipt_ingest.py:130`

### 6. The prompt never asks to keep the product — quality

It says "expand abbreviations" but never *preserve the product name*, and asks
for one confidence "based on how clear the receipt text is" — a document-level
number by construction. It also never carries the raw receipt line forward.

`receipt_ingest.py:38` `RECEIPT_PARSE_SYSTEM_PROMPT`

---

## The pipeline, after

| Stage | Today | Proposed |
|---|---|---|
| preprocess | on by default, crops twice | off by default; opt-in retry, single crop |
| OCR | Gemini Vision | unchanged |
| LLM parse | one confidence; genericizes; drops raw line | per-item confidence; keeps product; carries `source_line` |
| clean | substring non-food filter | deleted — the model does this with context |
| normalize | bidirectional substring collapse | head-noun matcher from `domain/normalizer.py` |
| tiering | batch × 0.9 → one tier for all | per-item → tiers actually separate |

---

## Review screen

Confident items arrive **pre-checked but still behind the Add button** — nothing
is written on sight, which keeps the proposal pattern intact. Uncertain items
arrive unchecked. Every card carries an **eye icon-button** that toggles a raw
face open *beneath* the parsed fields, so the guess and its evidence read
together.

- Tooltip and `aria-label`: **"See raw frame data"** / **"Hide raw frame data"**
- Raw face shows: receipt line, price, parsed-as name
- Reuse `Chip` tone tokens so scan review matches the chat surface

This matters most for a line like `T PREMIUM FILLER ASST.`, where the parsed name
is meaningless alone and the receipt line is the only thing that lets the user
judge it.

**Non-food is handled without asking.** The receipt contained actual flowers —
`T PREMIUM FILLER ASST.` is floral filler, and the model filed it as `dry_goods`.
Non-food detection stays entirely in the prompt, where the model has context, and
never becomes a user decision. A wrong call lands an odd item in the
low-confidence tier, which is exactly where the raw line makes it obvious and one
tap removes it.

---

## Pinned API contract

Frozen so the frontend slice can be built in parallel with the backend slice.
**Any change to this shape needs both agents notified.**

```ts
// nextjs/src/types/scan.ts
export interface ScannedItem {
  name:          string   // normalized display name  → "Italian Bomba Hot Pepper Spread"
  original_name: string   // LLM parse, pre-normalize → "italian bomba hot pepper"
  source_line:   string   // raw OCR receipt line     → "ITALIAN BOMBA HOT PEPPER"
  price:         number | null
  quantity:      number
  unit:          string
  category:      string
  location:      string
  confidence:    number   // PER ITEM — 0..1
}

export interface ScanResult {
  ocr_text:      string
  ready_to_add:  ScannedItem[]   // confidence >= 0.8  → pre-checked
  needs_review:  ScannedItem[]   // 0.5 .. 0.8         → unchecked
  skipped:       ScannedItem[]   // < 0.5              → unchecked, collapsed
  total_items:   number
  warnings:      string[]        // always present, may be empty
}
```

Two notes:

- `warnings` becomes part of the normal shape. Today the empty-OCR path returns a
  *different* object (`{ocr_text, items, warnings}`) that `ScanResult` never
  declared, so `ScanTab.tsx:51-53` sets three arrays to `undefined` and the
  message explaining why is never shown.
- `original_name` **already travels the whole pipeline** — `normalize_receipt_items`
  records it, `PantryItem.original_name` holds it, `ingest_spine` populates it. It
  is dropped only when `scan.py` hand-builds the response dict.

---

## Build plan

Wave 2's two slices touch disjoint trees (`ai-service/` vs `nextjs/`) and both
code to the pinned contract, so they run in parallel.

### Slice 1 — Restore the flow (wave 1, backend)

- Default `preprocess` to **false** in the scan route; keep the pipeline
  reachable as an explicit opt-in retry
- Remove the duplicate `_crop_receipt` call so the opt-in path is not broken either
- Delete `clean_receipt_items`'s substring filter entirely
- Make the empty-OCR path return the normal `ScanResult` shape with populated `warnings`

Files: `api/routes/scan.py` · `services/image_preprocessor.py` · `workflows/receipt_ingest.py`

**Acceptance:** the Trader Joe's fixture returns its six items, baguette included.
A deliberately blank image returns an empty `ScanResult` with a warning, not
undefined arrays.

### Slice 2 — Parse and normalize quality (wave 2, backend)

- Read `item["confidence"]` in `build_actions_from_normalized`, falling back to the batch value
- Re-tune or drop the `× 0.9` penalty so the top tier is reachable
- Prompt: emit confidence *per item*, preserve the product name, return `source_line` and `price`
- Route receipt normalization through `domain/normalizer.py`'s head-noun matcher
- Expose `original_name`, `source_line`, `price` in the scan response

Files: `workflows/ingest_spine.py` · `workflows/receipt_ingest.py` · `tools/normalizer.py` · `domain/normalizer.py` · `api/routes/scan.py`

**Acceptance:** six items with *varying* confidence; `ORG CANE SUGAR` stays cane
sugar; `ITALIAN BOMBA HOT PEPPER` is not black pepper; `milk chocolate` does not
become milk. Product-ingest tests still pass — the spine is shared.

### Slice 3 — Review screen (wave 2, frontend)

- Tier sections with header pills; confident items pre-checked, others unchecked
- One consistent item card; eye icon-button toggling the raw face open beneath the fields
- Tooltip + `aria-label`: "See raw frame data" / "Hide raw frame data"
- Reuse `Chip` tone tokens

Files: `components/scan/ScanResults.tsx` · `components/pantry/ScanTab.tsx` · `types/scan.ts`

**Acceptance:** against a stubbed `ScanResult` matching the pinned contract —
tiers render, confident rows start checked, the eye toggles the raw face,
keyboard focus is visible, and the Add button count tracks the checked set.

### Slice 4 — Fixture corpus + regression tests (wave 3)

- Receipts committed with an expected-items JSON beside each
- Deterministic tests at the parse seam so the suite stays CI-safe
- The Trader Joe's receipt is fixture #1 and pins every case above

Files: `nextjs/e2e/fixtures/receipts/` · `ai-service/tests/`

**Acceptance:** each fixture's parse output matches its expected JSON within a
tolerance for confidence values. Blocked on receipt collection.

---

## Deliberately not doing

- **Deleting the preprocessor outright.** Demoted, not removed. A genuinely dark
  or skewed photo may still benefit, and an explicit "didn't work? try enhanced"
  retry costs nothing once it stops running by default.
- **Writing items to the pantry on high confidence.** Pre-checked, not
  auto-written. `CLAUDE.md`'s rule that nothing reaches the database without
  explicit confirmation stands.
- **Unifying the two normalizers.** Slice 2 routes the receipt path to the good
  matcher. Actually merging `tools/normalizer.py` into `domain/normalizer.py`
  touches the chat and product paths too and deserves its own issue.
- **Routing receipts through the `/ingest` dispatcher.** Unrelated to this
  failure, tracked under the R4 issues (#204/#207/#188). Nothing here depends on it.

---

## Provenance

Every claim was reproduced against `main` @ `7c7e8b1`:

- Crop ratios from the production Railway logs for the failing scan
- Parse and normalizer behavior by replaying the receipt through
  `run_receipt_ingest` and `FoodNormalizer.normalize` with the live Gemini key
- Filter collisions by running the keyword list against real food names

Corrected since the first draft: an earlier version stated the normalizer was
innocent. That came from testing `domain/normalizer.py` when the workflow
actually calls `tools/normalizer.py`.
