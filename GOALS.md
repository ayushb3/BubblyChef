# BubblyChef — Goals

> AgentOps objective function. `/evolve` measures fitness against these gates.
> `ao goals measure` checks pass/fail. `ao goals steer` manages directives.

---

## Mission

Bubbly Chef is a **recipe assistant grounded in your actual pantry**. Core experience: casual, low-friction recipe discovery ("I have chicken and broccoli, suggest an Asian recipe") enhanced by knowing what ingredients you actually have.

**Primary flow:** Chat with AI about recipes → AI knows your pantry → suggests what you can make

---

## Current Phase: 2 — Dashboard + Chat

### Phase 2 Exit Criteria

| Gate | Check | Weight |
|------|-------|--------|
| python-tests | `pytest` passes | 5 |
| type-check | `mypy bubbly_chef/ --strict` passes | 3 |
| lint | `ruff check bubbly_chef/` passes | 3 |
| frontend-types | `cd web && npx tsc --noEmit` passes | 2 |
| dashboard-renders | Dashboard renders expiring widget + quick actions; Recent Activity pulls from real DB (not hardcoded) | 4 |
| chat-ui | Chat page exists with input + message thread; routes to `/chat` in nav | 4 |
| chat-routes | Chat intent router correctly classifies: `recipe-generate` / `pantry-add` / `cooking-question` / `saved-recipe-lookup` | 4 |
| coverage | `pytest --cov=bubbly_chef` ≥ 80% on core modules | 2 |

---

## Continuous Fitness Gates

Always true regardless of phase:

### Quality
- `pytest` passes with no failures
- `ruff check bubbly_chef/` clean
- No direct Gemini SDK calls outside `bubbly_chef/ai/gemini.py`
- No business logic in `api/routes/` (routes stay thin)
- All DB access through `repository/sqlite.py`
- All AI calls through `AIManager`

### UX Integrity
- Sanrio/kawaii design system consistent (pastel palette, rounded corners, emoji-driven)
- Mobile-first layout maintained (max-width 480px)
- Receipt scan: nothing written to DB without explicit user confirm

---

## Strategic Directives

> Guide `/evolve` when generating productive work from validation gaps.

1. **Recipe-first, pantry-supporting** — Pantry exists to improve recipes, not as the primary feature
2. **Zero-cost AI** — Free cloud tiers (Gemini) → self-hosted Ollama → never require paid API calls
3. **Simple over clever** — Straightforward request/response, no over-engineered proposal systems
4. **Web-first, mobile-later** — Build fast on web, refactor to mobile when ready

---

## North Stars

- Users can ask "what can I make tonight?" and get pantry-grounded recipe suggestions
- Scanning a receipt takes < 30 seconds from photo to pantry update
- No wasted food — expiring items always surfaced prominently

## Anti Stars

- Untested changes reaching main
- Business logic leaking into API routes
- AI calls outside AIManager abstraction
- Features that require paid API keys

---

## Backlog Phases

### Phase K1: Fluent Emoji Icon System

Replace broken HF-generated sprites with polished Microsoft Fluent Emoji 3D PNGs. Zero latency, MIT license, consistent style.

**Exit gates:**
- `GET /api/icons/{name}` always returns an image (never 404 — falls back to category icon)
- Pantry grid and kitchen scene use `/api/icons/` — no more HEAD-request flicker pattern
- HF background generation removed from pantry/scan routes
- `pytest` passes, `tsc --noEmit` passes

**Key deliverables:** `scripts/download_fluent_emoji.py`, `bubbly_chef/domain/icon_map.py`, `bubbly_chef/api/routes/icons.py`, ~150 food PNGs committed to `web/public/food-icons/fluent/`

See `docs/plans/2026-03-17-kitchen-phase-plan.md` for full spec.

---

### Phase K2: Phaser Kitchen Game Scene

Replace the DOM kitchen scene with a Phaser 3 game scene supporting drag-and-drop item placement, progression/decoration unlocks, and expiry animations.

**Exit gates:**
- Phaser scene mounts without console errors; items load in correct locations
- Drag-and-drop: item snaps to slot, position persists across reload (`slot_index` in DB)
- At least one decoration unlocks after triggering a milestone (5 pantry items)
- Feature flag `VITE_KITCHEN_V2=true` enables Phaser scene; DOM scene still works without flag
- `tsc --noEmit` passes

**Key deliverables:** `KitchenGame.tsx`, Tiled `.tmj` maps, food icon texture atlas, `decorations` backend routes + DB table, item slot persistence

**Depends on:** Phase K1 (icon atlas reused as Phaser spritesheet)

See `docs/plans/2026-03-17-kitchen-phase-plan.md` for full spec.

---

### Phase 3: Recipe Library + Multimodal Ingestion

The core goal: users can save recipes from any source — website URL, TikTok/Reels short-form video, or longer YouTube content — and the system parses, extracts, and indexes them for fast lookup later. "Remember that matcha lemonade TikTok?" should work.

- **Recipe CRUD** — save, edit, delete, search generated recipes
- **Shopping list** — generate missing ingredient list from any saved recipe
- **URL ingestion** — scrape traditional recipe websites, extract structured recipe
- **Short-form video ingestion** — TikTok, Instagram Reels, YouTube Shorts: download → transcribe → AI extract ingredients + steps + metadata
- **Long-form video ingestion** — YouTube videos: same pipeline with timestamp-aware step extraction
- **Recipe index** — unified search across all sources (generated, URL, video) with source badge (🎵 TikTok, 📺 YouTube, 🔗 URL, ✨ AI)
- **Saved-recipe-lookup intent** — chat can surface saved recipes by name/description ("that butter chicken recipe", "the matcha drink")

### Phase 4: Mobile PWA
- PWA with offline support
- Push notifications for expiring items
- Camera integration for receipt scanning

---

## Technical Debt (resolve before Phase 3)

- Database migrations (Alembic)
- Rate limiting for AI provider calls
- ~~Product catalog system (name → emoji mapping)~~ — resolved by K1 (Fluent Emoji icon system)
- Unit conversion (dozen eggs → individual eggs)
- Pagination for pantry list

---

## What We Are NOT Building

- Social features or recipe sharing
- Nutrition tracking
- Grocery store integrations
- Multi-household sync
- Native mobile app (until web is solid)

---

*Last updated: 2026-03-17 — Added Phase K1 (Fluent Emoji icons) and Phase K2 (Phaser kitchen game) to Backlog Phases; struck through resolved tech debt item*
