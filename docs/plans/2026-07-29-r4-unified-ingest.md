# R4 — Unified multimodal Ingest sub-graph (design stub)

**Status:** Stub / not started · **Tracking:** #188 (epic over #190 video, #180 URL cleanup)
**Date:** 2026-07-29

> Scoping stub, not a finished design. Captures what R4 consolidates and the open
> questions before implementation.

## Goal

One multimodal **Ingest sub-graph** that handles every "get stuff into the app" path —
photo/receipt, product barcode, recipe URL, video, pasted text — instead of today's
separate, partially-wired workflows. Per CONTEXT.md: *"Ingest — unified multimodal:
photo, URL, video, receipt, text."*

## Current state (fragmented — the problem R4 solves)

Ingestion is scattered across `ai-service/bubbly_chef/workflows/`:

| Path | Today | Notes |
|------|-------|-------|
| Receipt | `receipt_ingest.py` | Live, wired to the scan route |
| Recipe URL | `services/recipe_url_ingestor.py` | Live (recipe-scrapers + Gemini fallback), wired to `/v1/ingest/recipe-url` |
| Recipe URL (old) | `recipe_ingest.py` | **Dead stub** — being removed in #180 |
| Product/barcode | `product_ingest.py` | Graph built but **no caller**; lookup is a stub (real work in #191) |
| Video | — | **Absent** (#190) |

So the same conceptual operation lives in 4+ places with inconsistent wiring, and the
chat router only emits "handoff" messages for most of them rather than running the graph.

## What R4 delivers

- A single Ingest sub-graph: **detect modality → route to the right extractor → normalize
  → proposal envelope** (the existing proposal/confidence pattern).
- Absorbs the concrete ingest issues as its extractors:
  - **#190 video ingestion** — the new subsystem (transcription + extraction).
  - **#180** URL stub removal — leaves `recipe_url_ingestor.py` as the URL extractor.
  - **#191 barcode** — product lookup + entry point (can ship standalone first, folded in later).
- Consistent entry point + router dispatch so ingestion actually runs from chat, not just handoff text.

## Dependencies

- **Independent of R3/R5** (no tool-calling foundation needed).
- Soft-consumes #190, #180, #191 — those can ship standalone; R4 consolidates them.
- The frontend URL classifier (`nextjs/src/lib/url-classifier.ts`) is currently dead code;
  R4's modality detection is where it would finally get consumed (or replaced server-side).

## Open questions (resolve before build)

- Modality detection: client-side (existing url-classifier) vs. server-side sniffing?
- Do we consolidate *before* or *after* video (#190) exists? (Building R4 first gives video a home;
  building video standalone first gives R4 a working extractor to fold in.)
- Video pipeline is the big unknown — transcription provider, cost, whether it's in v1 of R4 at all.
- One `/ingest` endpoint with a modality param vs. keeping per-modality routes behind a shared graph.

## Size

Large (consolidation + the video subsystem). Sequencing note: the individual extractors
(#180 cleanup, #191 barcode) are cheaper standalone; R4 is worth doing once ≥2 modalities
justify the shared graph, or when video (#190) needs a home.
