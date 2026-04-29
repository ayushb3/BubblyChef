# BubblyChef — Active Work Items

## Summary

Overview of all active Phase 3 features and the AI Workflows Architecture Redesign as of 2026-04-29. Covers what each item is, why it matters, how the features connect to the redesign, and current beads issue status.

---

## Phase 3 Features

### A. Component Migration (Phase 4 of migration — blocks everything else)

The Next.js frontend exists but 3 core pages are still served by the old Vite app (`web/`). Pantry, Scan, and Chat all still run against the old FastAPI monolith, not the new Supabase stack. Until this is done, the new stack can't be used end-to-end.

**Work:** Port pages to Next.js, replace React Router with `next/link`, split the API client so CRUD calls go to `/api/*` and AI calls go to the microservice.

### B. AI Microservice Wiring (Phase 6 of migration)

The AI microservice (`ai-service/`) is built but the Next.js frontend doesn't talk to it yet.

**Work:** Wire JWT forwarding (Next.js reads Supabase session token, sends as `Authorization: Bearer` to microservice). SSE chat streaming must go direct browser → Railway (can't proxy through Vercel serverless — it'll timeout).

### C. URL Recipe Import

User pastes a URL (e.g. a recipe site). System fetches the page, cleans the HTML, and extracts a structured recipe card. Lands in the Ingest Sub-Graph (see AI Workflows Redesign below).

### D. Video Recipe Ingestion (TikTok, YouTube Shorts, Instagram Reels)

User shares a video URL or uploads a clip. System extracts a transcript (YouTube API / yt-dlp), optionally does visual ingredient detection via Gemini vision, and generates a recipe card. Stores metadata: creator, platform, thumbnail URL.

### E. Shopping List Generation

User picks a saved recipe. System compares recipe ingredients against current pantry, identifies what's missing, and generates a shopping list. Mostly frontend + a simple diff query.

### F. Chat References Saved Recipes

"Make that butter chicken from TikTok" — chat workflow queries the recipe library and surfaces the right recipe. The `saved-recipe-lookup` intent is already stubbed in the router but not fully implemented.

### G. Deploy to Vercel + Railway

Production env vars, CORS configuration, health checks, custom domain.

---

## AI Workflows Architecture Redesign

**Plan doc:** `docs/plans/2026-03-30-ai-workflows-architecture-redesign.md`

### The Problem

`chat_ingest.py` became a ~2400-line god file handling intent routing, pantry parsing, recipe generation, cooking help, and general chat all in one place. Recipe ingest is hardcoded to Ollama. Conversation state doesn't persist across turns ("yes" after "can I make pasta?" gets misclassified). Scan page and chat workflows duplicate logic.

### The Solution

Break the monolith into 5 composable LangGraph sub-graphs dispatched by a lightweight parent Router:

| Sub-graph | Source | Notes |
|---|---|---|
| Pantry | Extracted from `chat_ingest.py` | Deterministic — no LLM tool access |
| Recipe | Extracted from `chat_ingest.py` + `recipe_ingest.py` | Fixes Ollama-only bug |
| Cooking | New | ReAct-style with tool access (`suggest_substitution`, `explain_technique`) |
| Ingest | New — unifies 3 separate workflows | Handles photo, URL, video, receipt, text |
| General Chat | Extracted from `chat_ingest.py` | ReAct-style with tool access |

**Server-side conversation sessions** give the router context across turns (fixes misclassification).

**Shared tool registry** — plain Python `async` functions callable from sub-graph nodes, API routes, and LLM ToolNode (eliminates scan/chat duplication).

### Execution Phases

| Phase | Description | Status |
|---|---|---|
| R1 | Sub-graph decomposition — `router.py` (1391 lines) + `chat/`, `pantry/`, `recipe/` sub-graphs. `chat_ingest.py` is now a 23-line shim. | **Done** |
| R2 | Server-side conversation sessions + context-aware intent routing (`SessionMode`, `active_mode` transitions) | **Done** |
| R3 | Cooking Companion sub-graph (ReAct-style, tool access) | Pending |
| R4 | Unified multimodal ingest — absorbs URL import + video ingestion | Pending |
| R5 | LLM tools for general chat (proactive suggestions) | Pending |

---

## How They Connect

The AI workflows redesign is the engine that enables Phase 3 features C, D, and F:

- URL import → Phase R4 (unified Ingest sub-graph)
- Video ingestion → Phase R4 (unified Ingest sub-graph)
- Chat referencing saved recipes → Phase R2/R5

You could build URL import as a standalone hack first, or do the redesign properly and get all features on a solid foundation.

**Recommended order:**
1. Component Migration (A) — unblocks everything
2. AI Microservice Wiring (B) — makes the stack actually work end-to-end
3. R1 Refactor — clean up monolith before adding more on top
4. R2 Sessions — context-aware routing
5. Phase 3 features (C, D, E, F) — built on the clean foundation

---

## Current Beads Issues

| ID | Title | Status |
|---|---|---|
| `BubblyChef-3r5` | Supabase migration: add `source_url` + `source_platform` to recipes table | Ready |
| `BubblyChef-jjv` | URL classifier: detect recipe site vs video URL | Ready |
| `BubblyChef-xeo` | Custom icon & emoji system overhaul | Ready |

The first two are Phase 3 prereqs (URL/video import). The third is the icon system (separate concern).
