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

## Current Status: Phase 7 Complete — Live in Production

### Completed

| Phase | Description |
|---|---|
| Phase 1 | Pantry CRUD, receipt scanning, recipe generation, LangGraph workflows, 454+ tests |
| Phase 2 | Chat intent router, recipe grounding (constraint extraction + expiry scoring), conversation history, DOM kitchen scene + milestone decorations |
| Migration | Next.js + Supabase + FastAPI AI microservice (three-tier rewrite); component migration done; JWT wiring + SSE streaming done |
| Recipe library | Save, search, edit, delete, favourite recipes; `is_favorite` toggle; search auto-select; ingredients + instructions editing |
| AI workflows R1+R2 | Sub-graph decomposition (`chat/`, `pantry/`, `recipe/`), parent router, server-side conversation sessions + context-aware routing (`SessionMode`) |
| Phase 3 | URL recipe import (recipe-scrapers + LLM fallback, source attribution chip, confirmation flow); `source_url` + `source_platform` in DB |
| Phase 4 | Component migration complete — Pantry, Scan, Chat, Dashboard all on Next.js; old `web/` Vite app retired |
| Phase 6 | JWT forwarding from Next.js session to AI microservice; SSE streaming wired |
| Phase 7 | Deployed to Vercel (frontend) + Railway (AI service); Tesseract replaced with Gemini vision; receipt scan, chat, recipe import all working in production |

### Migration phases completed

- [x] Supabase schema + RLS (7 tables)
- [x] Next.js app + Supabase auth (cookie-based sessions)
- [x] 19 CRUD route handlers in Next.js
- [x] AI microservice extracted (`ai-service/`)
- [x] Recipe library UI (RecipeBook, edit modal with ingredients/instructions, delete confirm, favourites)
- [x] URL recipe import with confirmation step + source attribution
- [x] All pages (Pantry, Scan, Chat, Dashboard) on Next.js App Router

---

## Phase 3: Recipe Library + Multimodal Ingestion

**Goal:** Users can save, search, and reference recipes; import from URLs and video. Core pantry-to-recipe workflows become seamless.

### Features

- [x] URL recipe import (recipe-scrapers + LLM fallback, confirmation step, source attribution)
- [ ] Video recipe ingestion (TikTok, YouTube Shorts, Instagram Reels) — `BubblyChef-u1c`
  - [ ] Transcription + visual ingredient detection
  - [ ] Recipe card extraction from video
  - [ ] Video metadata storage (creator, platform, thumbnail)
- [ ] Shopping list generation from missing recipe ingredients
- [ ] Chat references saved recipes ("make that butter chicken from TikTok")
- [ ] #39 — Home screen: replace launcher cards with kawaii kitchen hub
- [ ] #40 — Cook a recipe: auto-deduct ingredients from pantry
- [ ] #41 — Unify scan and manual add into a single pantry add flow
- [ ] #42 — Auto-generate grocery list from depleted/low pantry items
- [ ] #43 — In-app notification center for expiry alerts and pantry nudges
- [ ] #45 — Recipe page: contextual step timers

### Success Criteria

| Check | Command |
|---|---|
| TypeScript | `cd nextjs && npx tsc --noEmit` |
| AI service tests | `cd ai-service && pytest --tb=no -q` |
| Recipe CRUD e2e | `pytest -k recipe_crud` |
| URL ingest | `pytest -k url_ingest` |
| Supabase migrations current | `supabase db status` |

---

## Phase 7: Deploy ← **Complete**

**Live at:** https://bubbly-chef.vercel.app (frontend) + https://bubblychef-production.up.railway.app (AI service)

### Completed
- [x] Connect GitHub repo to Vercel, root directory `nextjs/`
- [x] Set Next.js env vars in Vercel
- [x] Deploy `ai-service/` to Railway (Dockerfile, port 8888)
- [x] Update `BUBBLY_CORS_ORIGINS` on Railway to include Vercel production URL
- [x] Smoke test all pages + AI chat in production
- [x] Replace Tesseract OCR with Gemini vision (simpler Docker, better accuracy)
- [x] Fix recipe import fallback for sites that block datacenter IPs (Allrecipes etc.)

---

## Tech Debt

| # | Issue | Priority |
|---|---|---|
| #47 | RecipeBook: disable action buttons while mutation is in flight | Medium |
| #48 | RecipeBook: show error feedback when edit or delete mutation fails | Medium |
| #44 | Recipe page: replace emoji action icons with styled UI controls | Medium |
| #10 | Accessibility (ARIA labels, keyboard nav) | Medium |
| #11 | End-to-end tests with Playwright | Medium |

---

## Phase 5: Intelligence

| # | Issue |
|---|---|
| #46 | AI taste profiling: infer user preferences and suggest pantry staples |

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

*Last updated: 2026-05-03*
