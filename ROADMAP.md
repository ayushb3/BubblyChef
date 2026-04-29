# BubblyChef — Roadmap

## Vision

A Sanrio-inspired pantry + recipe assistant grounded in your actual kitchen.
- "What can I make tonight?" → pantry-aware AI recipe suggestions, prioritising expiring items
- Scan a receipt → pantry updated in under 30 seconds
- Save recipes from chat, URLs, or videos — reference them later

---

## Guiding Principles

1. **Recipe-first** — Pantry management supports recipes, not the other way around
2. **Zero cost AI** — Gemini free tier → Ollama self-hosted fallback
3. **Human-in-the-loop** — AI returns proposals; nothing writes to DB without user confirmation
4. **Web-first** — Build fast on web, mobile later

---

## Current Status: Migration Complete, Phase 3 Next

### Completed

| Phase | Description |
|---|---|
| Phase 1 | Pantry CRUD, receipt scanning, recipe generation, LangGraph workflows, 454+ tests |
| Phase 2 | Chat intent router, recipe grounding (constraint extraction + expiry scoring), conversation history, DOM kitchen scene + milestone decorations |
| Migration | Next.js + Supabase + FastAPI AI microservice (three-tier rewrite); component migration done; JWT wiring + SSE streaming done |
| Recipe library | Save, search, edit, delete, favourite recipes; `is_favorite` toggle; search auto-select |
| AI workflows R1+R2 | Sub-graph decomposition (`chat/`, `pantry/`, `recipe/`), parent router, server-side conversation sessions + context-aware routing (`SessionMode`) |

### Migration phases completed

- [x] Supabase schema + RLS (7 tables)
- [x] Next.js app + Supabase auth (cookie-based sessions)
- [x] 19 CRUD route handlers in Next.js
- [x] AI microservice extracted (`ai-service/`)
- [x] Recipe library UI (RecipeBook, edit modal, delete confirm, favourites)

### Migration phases remaining

- [ ] **Phase 4 — Component migration**: port Pantry, Scan, Chat, Dashboard pages to Next.js; replace React Router with `next/link`; split API client for CRUD vs AI calls
- [ ] **Phase 6 — AI wiring**: JWT forwarding from Next.js session to AI microservice; SSE streaming direct browser → Railway
- [ ] **Phase 7 — Deploy**: Next.js → Vercel, AI microservice → Railway, production env vars + CORS

---

## Phase 3: Recipe Library + Multimodal Ingestion

**Goal:** Users can save, search, and reference recipes; import from URLs and video.

### Features

- [ ] Finish component migration (Phase 4 above — blocks everything else)
- [ ] URL recipe import (scrape structured data from recipe sites)
- [ ] Video recipe ingestion (TikTok, YouTube Shorts, Instagram Reels)
  - [ ] Transcription + visual ingredient detection
  - [ ] Recipe card extraction from video
  - [ ] Video metadata storage (creator, platform, thumbnail)
- [ ] Shopping list generation from missing recipe ingredients
- [ ] Chat references saved recipes ("make that butter chicken from TikTok")

### Success Criteria

| Check | Command |
|---|---|
| TypeScript | `cd nextjs && npx tsc --noEmit` |
| AI service tests | `cd ai-service && pytest --tb=no -q` |
| Recipe CRUD e2e | `pytest -k recipe_crud` |
| URL ingest | `pytest -k url_ingest` |
| Supabase migrations current | `supabase db status` |

### Known Blockers

- **Pagination** — pantry list endpoint has no pagination (Next.js route handler, issue #5)
- **Rate limiting** — no rate limiting on AI provider calls (issue #8)
- **Component migration** — Pantry, Scan, Chat pages still served from old `web/` Vite app

---

## Tech Debt

| # | Issue | Priority |
|---|---|---|
| #5 | Add pagination to pantry list | High (Phase 3 blocker) |
| #8 | Rate limiting for AI provider calls | High (Phase 3 blocker) |
| — | `mutating` state in RecipeBook — buttons not `disabled={mutating}` yet | Medium |
| — | No error feedback on failed recipe mutations | Medium |
| #10 | Accessibility (ARIA labels, keyboard nav) | Medium |
| #11 | End-to-end tests with Playwright | Medium |
| #6 | Unit conversion system (dozen eggs → individual) | Low |

---

## Open Bugs

| # | Issue | Priority |
|---|---|---|
| #1 | Receipt parsing confuses prices with quantities | Medium |
| #2 | Long item names overflow on mobile | Low |
| #3 | Expiry date estimation for produce inaccurate | Medium |
| #4 | Bottom nav not fixed on iOS Safari | Low |

---

## Phase 4+: Future

- [ ] Mobile PWA
- [ ] Barcode scanning (OpenFoodFacts integration)
- [ ] Meal planning calendar
- [ ] Multi-household support
- [ ] K1: Fluent Emoji icon system (blocked by icon licensing)
- [ ] K2: Phaser game scene upgrade (depends on K1)

---

## What We're NOT Building

- Social features (sharing, ratings) — maybe Phase 4+
- Nutrition tracking
- Grocery store integrations
- Native mobile app (until web is solid)

---

*Last updated: 2026-04-29*
