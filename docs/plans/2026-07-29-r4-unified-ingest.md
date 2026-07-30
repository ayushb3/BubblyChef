# R4 — Unified multimodal Ingest sub-graph

**Status:** Design resolved — agent-ready (video deferred) · **Tracking:** #188
**Date:** 2026-07-29 · **Design resolved:** 2026-07-31

> Design session 2026-07-31 resolved the framing and the four open questions. The
> "Resolved design" section is the build spec; the original scoping stub is preserved
> after it. Independent of R3/R5 (no tool-calling foundation needed).

## Goal

One consistent "get stuff into the app" path — photo/receipt, barcode, recipe URL,
(later) video, pasted text — instead of today's separate, partially-wired workflows.

## Current state (the fragmentation)

| Path | Today | Shape |
|------|-------|-------|
| Receipt | `workflows/receipt_ingest.py` | LangGraph: `parse_llm → clean → normalize → create_actions` |
| Product/barcode | `workflows/product_ingest.py` | LangGraph: `lookup_barcode → parse_description → normalize → create_action` (built, no caller; lookup stub — #191) |
| Recipe URL | `services/recipe_url_ingestor.py` | Plain service (recipe-scrapers + Gemini fallback) → `RecipeCard`; wired to `/v1/ingest/recipe-url` |
| Recipe URL (old) | `workflows/recipe_ingest.py` | **Dead stub** — removed in #180 |
| Video | — | **Absent** (#190) |

**Key structural finding:** the two graph paths are the *same skeleton* —
`[modality-specific extraction] → normalize → create actions/proposal`. The **tails
already converge**; the **heads are irreducibly different** (parse image vs. lookup
barcode vs. scrape URL vs. transcribe video share nothing). So the real duplication is
the tail + the missing shared entry point, NOT the extraction.

---

## Resolved design (build spec)

### Decision A — Framing: shared spine + dispatcher, NOT a mega-graph

- Do **not** build one big LangGraph with a modality-branching entry node fanning to four
  extractor subtrees. That merges four flows whose only commonality is the tail, and pays
  conditional-edge complexity for the *appearance* of unity. Harder to read/test.
- **Instead:**
  1. Extract the common `normalize → proposal` **tail** into one shared module both graphs
     (and future extractors) call.
  2. Put a single **entry point + dispatcher** in front: detect modality → call the right
     extractor → shared tail → proposal.
  3. Keep per-modality extractors as separate focused units (they share nothing in the head).
- This delivers the real goal — "ingestion runs from one consistent place, not four
  half-wired paths" — at a fraction of the risk. (Same discipline as R3's `create_react_agent`
  call: match the structure to the actual shared surface, not the aspirational label.)

### Decision B — Modality detection: server-side, in the dispatcher

- Image/video arrive as uploaded bytes → the server must detect those regardless. URL vs.
  barcode-number vs. plain-text is cheap server-side string-sniffing. One place, testable,
  no client/server split-brain.
- The dead `nextjs/src/lib/url-classifier.ts` → **delete, or downgrade to an optimistic
  client hint**. The server dispatcher is the source of truth.

### Decision C — Video: deferred to #190 (plug-in extractor)

- **R4 v1 = receipt + recipe-URL + barcode.** Video is a new external subsystem with
  unknowns R4 shouldn't be held hostage to (transcription provider, per-item cost,
  yt-dlp fetch fragility + ToS).
- Once the dispatcher exists, video becomes "write one extractor + register it" — the
  cleanest home for it. Video pipeline direction (**description-first,
  transcription-on-demand**) is captured on **#190**.

### Decision D — Endpoint: single `/ingest`, old routes as shims

- One `/ingest` entry runs detect → dispatch. Keep existing per-modality routes working
  as **thin compatibility shims** during migration so nothing breaks mid-flight; retire
  them once callers move to `/ingest`.

### Build checklist (v1, no video)

1. Extract shared `normalize → proposal` spine from `receipt_ingest` + `product_ingest`
   into one module.
2. Server-side modality dispatcher + `/ingest` entry point.
3. Wire receipt, recipe-URL (`recipe_url_ingestor`), and barcode extractors behind it.
4. Old per-modality routes → thin compat shims.
5. Remove / downgrade `url-classifier.ts`.
6. Tests: dispatch to each modality, shared-tail behavior, compat shims still work.

### Dependencies (resolved)

- **Independent of R3/R5.**
- **#180** (dead URL stub removal) and **#191** (barcode) ship **standalone** — R4
  consolidates whatever exists when it runs.
- **#190** (video) folds in after, via the finished dispatcher.

---

## Original scoping stub (preserved for context)

> Scoping stub, not a finished design.

One multimodal Ingest sub-graph that handles every "get stuff into the app" path instead
of today's separate, partially-wired workflows. Per CONTEXT.md: *"Ingest — unified
multimodal: photo, URL, video, receipt, text."*

The same conceptual operation lives in 4+ places with inconsistent wiring, and the chat
router only emits "handoff" messages for most of them rather than running the graph.

### Open questions (all resolved 2026-07-31 — see Resolved design)

- Modality detection: client vs server? → **server-side dispatcher** (Decision B).
- Consolidate before or after video exists? → **before; video deferred to #190** (Decision C).
- Video pipeline (transcription provider, cost)? → **#190; description-first design** (Decision C).
- One `/ingest` endpoint vs per-modality routes? → **single `/ingest`, old routes as shims** (Decision D).

## Size

Medium (v1, consolidation only — video removed from scope). The consolidation is
controlled refactoring; the large/unknown part (video) is split to #190.
