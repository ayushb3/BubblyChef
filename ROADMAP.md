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

## Current Status: Phase 7 shipped · design-system + cook flow landed

**Live at:** https://bubbly-chef.vercel.app

### Recently landed (2026-07-25)

| Area | What shipped |
|---|---|
| Design system | 5-palette theme switcher (`ThemePicker`), shared `Chip`, `EmptyState`, `lib/motion.ts` spring config + reduced-motion helper, semantic colour tokens |
| Recipes | Cook-a-recipe with pantry deduction (`CookModal`, `cook_matcher.py`, migration `00006`), action cluster (44px heart + pop, overflow menu), hero thumbnails, page-turn swipe |
| Chat | Bubble tails, post-message suggestion chips, mascot avatars, spring pop-in |
| Quality | **Six CI gates now enforced** — pytest, ruff, `mypy --strict`, tsc, jest, Playwright smoke |
| Tooling | 27 agent skills vendored into `.claude/skills/` (work in CI + cloud, not just locally) |

### Bugs found and fixed by the new gates

Adding `mypy --strict` immediately surfaced four live defects:

- `get_ai_manager` imported from the wrong module **and** awaited though synchronous — `/v1/recipes/generate` and `/refine` always returned HTTP 500
- `recipe.tags` used where `RecipeCard` defines `dietary_tags` — `AttributeError` on every recipe save
- `.not_()` called as a function when postgrest exposes it as a property — `TypeError` in `get_expiring_items()`
- `count="exact"` string where postgrest now requires the `CountMethod` enum

CI itself had also been red on every commit — `ruff>=0.4` was unpinned with no explicit rule set, so ruff 0.16's changed defaults broke the build with no code change. Rule set is now pinned explicitly.

### Completed phases

| Phase | Description |
|---|---|
| Phase 1 | Pantry CRUD, receipt scanning, recipe generation, LangGraph workflows |
| Phase 2 | Chat intent router, recipe grounding, conversation history |
| Migration | Next.js + Supabase + FastAPI three-tier rewrite |
| Recipe library | Save, search, edit, delete, favourite; URL import with source attribution |
| AI workflows R1+R2 | Sub-graph decomposition, parent router, server-side sessions |
| Phase 6 | JWT forwarding, SSE streaming |
| Phase 7 | Vercel + Railway deploy; Gemini Vision OCR |
| **Design system** | Theme switcher, shared primitives, motion config |
| **Cook flow** | Recipe → pantry deduction, cook tracking |

---

## Next up

Planned in `docs/plans/2026-07-24-gamification-and-live-kitchen.md` and
`docs/plans/2026-07-24-agent-team-execution.md`:

1. **PWA shell** — manifest, service worker, install prompt, push scaffolding
2. **Live kitchen** — pixel-art diorama home screen (DOM + Framer Motion, not Phaser)
3. **Progression** — `kitchen_events` ledger → XP, streaks, decoration unlocks
4. **Living Bubbles** — mascot with memory of your cooking history
5. **Push notifications** — expiry nudges, streak reminders

### Known not-done (verified, despite prior claims)

- `ScrollFadeIn` (#87) — commit message claimed it; the component was never added
- Chat input still `disabled={isStreaming}` (#105) — typing while streaming not implemented
- Category tinting still reuses expiry tokens (#110) — no dedicated palette

---

## Phase 3: Recipe Library + Multimodal Ingestion

**Goal:** Users can save, search, and reference recipes; import from URLs and video.

### Features

- [x] URL recipe import (recipe-scrapers + LLM fallback, confirmation step, source attribution)
- [ ] Video recipe ingestion (TikTok, YouTube Shorts, Instagram Reels) — `BubblyChef-u1c`
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

| # | Issue | Priority | Status |
|---|---|---|---|
| #125 | Duplicate recipe ingredients over-deduct the same pantry item | High | New — found in landing audit |
| #5 | Add pagination to pantry list | High | Open |
| #8 | Rate limiting for AI provider calls | High | Open — matters more once daily Bubbles lands |
| #10 | Accessibility (ARIA labels, keyboard nav) | Medium | Open |
| #6 | Unit conversion system (dozen eggs → individual) | Low | Open |
| — | `cook_matcher` + new repo methods have no behavioural test coverage | Medium | Tests mock the repo entirely |
| — | `interrogate` / `thermo-nuclear` hook only fires on `gh pr create` | Low | Never fires where PRs are made via MCP |

**Resolved:** `mutating` state in RecipeBook, error feedback on failed recipe mutations, e2e tests (#11), e2e in CI (#55).

---

## Open Bugs

| # | Issue | Priority |
|---|---|---|
| #1 | Receipt parsing confuses prices with quantities | Medium |
| #3 | Expiry date estimation for produce inaccurate | Medium |
| #2 | Long item names overflow on mobile | Low |
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

*Last updated: 2026-07-25*
