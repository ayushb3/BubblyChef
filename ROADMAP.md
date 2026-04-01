# BubblyChef — Roadmap & Goals

## Vision

A Sanrio-inspired pantry + recipe assistant grounded in your actual kitchen.
- "What can I make tonight?" → pantry-aware AI recipe suggestions
- Scan a receipt → pantry updated in under 30 seconds
- Expiring items always surfaced — zero wasted food

## Guiding Principles

1. **Recipe-first** — Pantry management supports recipes, not the other way around
2. **Zero cost AI** — Gemini free tier → Ollama self-hosted fallback → never require paid keys
3. **Simple over clever** — Straightforward request/response; no over-engineered pipelines
4. **Human-in-the-loop** — High-confidence items auto-add; low-confidence gets reviewed
5. **Web-first** — Build fast on web, mobile later

---

## Current Status: Phase 2 Complete

All Phase 2 exit gates pass as of 2026-03-18:
- `pytest` passes (454+ tests)
- `mypy --strict` clean
- `ruff` clean
- `tsc --noEmit` clean
- Chat intent router works (recipe-generate, pantry-add, cooking-question, saved-recipe-lookup)
- Dashboard renders with real DB data
- DOM kitchen scene with drag-and-drop + milestones

---

## Phase 3: Recipe Library + Multimodal Ingestion

**Goal:** Users can save, search, and reference recipes; import from URLs and video.

### Features
- [ ] Recipe CRUD (save, edit, delete, favorite)
- [ ] Recipe search and filtering
- [ ] Shopping list generation from missing recipe ingredients
- [ ] URL recipe import (scrape structured data from recipe sites)
- [ ] Video recipe ingestion (TikTok, YouTube Shorts, Instagram Reels)
  - [ ] Transcription + visual ingredient detection
  - [ ] Recipe card extraction from video
  - [ ] Video metadata storage (creator, platform, thumbnail)
- [ ] Chat references saved recipes ("make that butter chicken from TikTok")

### Success Criteria

| Check | Command | Description |
|-------|---------|-------------|
| `python-tests` | `pytest --tb=no -q` | All tests pass |
| `type-check` | `mypy bubbly_chef/ --strict` | No type errors |
| `lint` | `ruff check bubbly_chef/` | No lint errors |
| `frontend-types` | `cd web && npx tsc --noEmit` | TypeScript clean |
| `recipe-crud` | `pytest tests/ -k recipe_crud` | Recipe CRUD end-to-end |
| `url-ingest` | `pytest tests/ -k url_ingest` | URL → recipe card |
| `alembic-migrations` | `alembic current` | Migrations current |
| `coverage` | `pytest --cov=bubbly_chef` | ≥80% coverage |

### Prerequisite Tech Debt (block Phase 3)
- **#5** Pagination on pantry list endpoint
- **#8** Rate limiting on AI provider calls

---

## Phase K1/K2: Kitchen Scene (Parallel)

- [x] K2B complete — DOM-only kitchen, drag-and-drop, milestone decorations
- [ ] K1: Fluent Emoji icon system (blocked by icon licensing decisions)
- [ ] K2: Phaser game scene upgrade (depends on K1) — deferred

---

## Phase 4+: Future

- [ ] Mobile PWA
- [ ] Barcode scanning (OpenFoodFacts integration)
- [ ] Meal planning calendar
- [ ] Multi-user / household support
- [ ] Auth (currently single-user, no auth)
- [ ] Alembic migrations for schema evolution (Phase 3 prerequisite)

---

## Open Issues

### Bugs
| # | Issue | Priority |
|---|-------|----------|
| #1 | Receipt parsing confuses prices with quantities | Medium |
| #2 | Long item names overflow on mobile | Low |
| #3 | Expiry date estimation for produce inaccurate | Medium |
| #4 | Bottom nav doesn't stay fixed on iOS Safari | Low |

### Enhancements
| # | Issue | Priority |
|---|-------|----------|
| #5 | Add pagination to pantry list | High (Phase 3 blocker) |
| #6 | Unit conversion system (dozen eggs → individual) | Low |
| #8 | Rate limiting for AI provider calls | High (Phase 3 blocker) |
| #15 | Mode-switch pill: context-aware suggestion | Medium |
| #17 | "Search online" sub-mode for recipe suggestions | Low |
| #18 | Hybrid intent routing (AI overrides mode hint) | Medium |

### Tech Debt
| # | Issue | Priority |
|---|-------|----------|
| #10 | Accessibility (ARIA labels, keyboard nav) | Medium |
| #11 | End-to-end tests with Playwright | Medium |

---

## What We're NOT Building

- Social features (sharing, ratings) — maybe Phase 4+
- Nutrition tracking
- Grocery store integrations
- Complex meal planning calendars
- Native mobile app (until web is solid)

---

## Known Limitations

- No unit conversion (`3 eggs` can't deduct from `1 dozen eggs`)
- Single-user, no auth
- SQLite only — Alembic needed before schema changes
- Receipt quality depends heavily on image quality
- No pagination on pantry list
- No rate limiting on AI calls
