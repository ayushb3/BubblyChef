# Gamification + the Live Kitchen — Design Plan

*Date: 2026-07-24 · Status: proposed · Supersedes the gamification "Out of Scope → Phase 3" section of PRD #67*

---

## 0. Why this document exists

PRD #67 ("Kawaii Kitchen Hub") is a thorough spec for *a room*. It explicitly
deferred every progression mechanic — streaks, XP, badges, theme unlocks,
Bubbles' outfit system — to an unwritten "Phase 3." So we have a detailed plan
for the stage and no plan for the play.

This document specs the play, revisits three decisions the intervening months
have made questionable, and sequences the work.

---

## 1. Status snapshot (what this plan is building on)

**`main` has had no feature merge since 2026-05-04.** The only commit since is a
docs reconcile on 2026-07-11.

| Item | State |
|---|---|
| `feat/ui-overhaul` (PR #74) | 44 files, +3081/-197. Theme switcher (5 palettes), `lib/motion.ts` spring config, shared visual tokens, `Chip`, `ThemePicker`, CookModal, `00006_add_recipe_cook_tracking.sql`. **Unmerged since May 5.** |
| PRs #119, #120, #121 | Chat bubble tails, `EmptyState`, recipe action cluster. Stacked on `feat/ui-overhaul`, unmerged since May 20. |
| PR #59 | Playwright e2e harness. Unmerged since May 4. |
| Issues #76–#110 | ~30 UI issues, most already implemented *on the unmerged branch*. |
| Kitchen hub (#39 → PRD #67 → #68–#75) | **Zero code.** `phaser` not installed. No `KitchenScene`, no EventBus. `HeroHome.tsx` still ships. |
| `decorations` table | Exists in `00001_initial_schema.sql` with `milestone` + `unlocked_at`. `GET /api/decorations` exists. **Nothing in the frontend reads it.** |

Two things worth noting because they change the plan:

1. **`00006` already adds `recipes.times_cooked` and `recipes.last_cooked_at`.**
   The seed of a progression system is written but unshipped.
2. **The `decorations` table was designed for exactly this feature** and has been
   sitting dormant since the migration off the Vite app. We are not building
   from scratch; we are finishing something abandoned mid-flight.

---

## 2. Decision 1 — Stay on the web. Add a PWA shell.

**Question raised:** should the kitchen/gamification push move off the web app?

**Decision: no native rewrite. Ship a PWA shell instead.**

### Reasoning

What a native app would actually buy us, honestly:

| Native advantage | Does it matter here? |
|---|---|
| 60fps sprite/particle rendering | No. The scene is 4–5 static zones, one walking mascot, and occasional glow states. This is not a rendering-bound workload. |
| Camera quality for receipt scanning | Marginal. `getUserMedia` + Gemini Vision already works in production. |
| Home-screen presence | **Yes — and a PWA gets this.** |
| Push notifications | **Yes — and this is the real prize.** The whole return-loop (expiry alerts, streak reminders) depends on it. Installed PWAs support Web Push on iOS 16.4+ and everywhere else. |
| App store distribution | Not a goal for a personal-scale app. |

What a native rewrite would cost: the entire `nextjs/` frontend, every route
handler, the Supabase cookie-session auth, the Vercel deploy pipeline. We would
keep only `ai-service/` and the Postgres schema. That is throwing away the
majority of a working, deployed product to gain notification delivery we can
get from a manifest file and a service worker.

**The thing that makes an app feel like an app here is the notification loop and
the home-screen icon — not the renderer.** PWA delivers both. `ROADMAP.md`
already lists "Mobile PWA" under Phase 4+; this promotes it and makes it a
prerequisite for the gamification loop rather than a nice-to-have.

**Caveat, stated plainly:** iOS requires the user to explicitly "Add to Home
Screen" before Web Push works. That is real friction. It is still far cheaper
than a rewrite, and if usage ever justifies native, the API layer
(`/api/*` + the AI microservice) is already the right shape for a React
Native/Expo client to consume later. This decision is reversible; a rewrite now
is not.

---

## 3. Decision 2 — Land the existing overhaul. Do not restart it.

**Question raised:** finish what was specced, or start something all new?

**Decision: audit and land `feat/ui-overhaul`. Do not restart.**

Three thousand lines of implemented, PR-described work — the five-palette theme
system, the motion spring config, the shared tokens, CookModal — is not
speculative design debt. It is the design system the kitchen scene needs to be
built *on*. Restarting would discard it and then rebuild the same primitives
under new names.

The one legitimate concern is staleness: it is two months old and was never
reviewed to completion. So Phase A is an audit-and-land pass, not a blind merge.

Where "something all new" *is* right: the **home screen itself**. PRD #67
already calls for deleting `HeroHome.tsx` outright. That is the surface getting
a genuine ground-up redesign — and it is the subject of the rest of this doc.

---

## 4. Decision 3 — Build the kitchen in DOM + Framer Motion, not Phaser 3

**PRD #67 specs Phaser 3. I recommend overriding that.**

### The actual requirements

From the PRD's own user stories: two colour bands, four tappable furniture
zones, one mascot that patrols left/right and flips on turn, a fridge with
fullness states, a glow on expiry, a drop shadow under each object. The speech
bubble and chalkboard note are *already specced as React DOM overlays*.

That is not a game-engine workload. It is a styled div with tweens.

### The comparison

| | Phaser 3 | DOM + Framer Motion |
|---|---|---|
| Bundle cost | ~1MB min+gzip of new dependency | **Zero — `framer-motion` is already a dependency and deeply used** |
| Theme switching | Canvas can't read CSS custom properties. The 5-palette switcher would need `getComputedStyle` plumbing + a full re-render on every theme change. | **Free.** Palettes are CSS variables; the scene inherits all five automatically. |
| Accessibility (#10 is open tech debt) | Canvas is opaque to screen readers. Four nav zones become invisible to assistive tech. | Zones are real `<button>`/`<Link>` elements. Keyboard nav and labels work by default. |
| Reduced motion | Manual | `lib/motion.ts` on the overhaul branch **already has a reduced-motion helper** |
| SSR | Must be `{ ssr: false }`, needs a skeleton to avoid blank paint | Shell renders server-side; only animation is client |
| Sprite walk-cycle | Native spritesheet support | CSS `steps()` animation or a small sprite component — a solved, ~40-line problem |
| Particles / physics | Strong | Weak — but nothing in the spec needs them |

### Recommendation

**DOM + Framer Motion.** Phaser's genuine strengths (physics, particle systems,
hundreds of sprites) are things this scene does not use, while its weaknesses
(bundle size, theme isolation, accessibility) hit precisely the things this
project has just invested in. The PRD chose Phaser for the *feeling* of building
a game; the feeling comes from the animation quality and the loop, both of which
DOM delivers here.

**What survives from PRD #67 unchanged:** the side-view dollhouse perspective,
the two-band depth model, spatial stability (furniture never moves), the ≤5
zones rule, positive-framing-only, one primary metaphor (fridge fullness), the
placeholder-first asset strategy, and the strict data/render separation. The
EventBus becomes ordinary React props and context — simpler, same boundary.

**Consequence:** issues #68 (Phaser scaffold + EventBus) and #67's Phaser
sections need rewriting. #69–#75 survive largely intact with the renderer
swapped.

---

## 5. The gamification system

### 5.1 Design principle: one loop, not three features

Progression, a living Bubbles, and an evolving kitchen should not be three
bolted-on systems. They are three views of one loop:

```
    Real kitchen action          →   Kitchen XP + streak
  (cook, scan, rescue an item)         │
            ▲                          ▼
            │                    Unlocks decorations / room tier
            │                          │
            │                          ▼
     Return tomorrow      ←    Kitchen visibly changes
   (streak + push nudge)         Bubbles notices and comments
```

The critical design choice: **XP is only ever earned from real kitchen events.**
No daily-login XP, no tap-to-collect. The game rewards the behaviour the app
exists to encourage — cooking what you already own before it spoils.

### 5.2 The event ledger (foundation)

Everything derives from one append-only table. Not scattered counters —
counters drift, and Bubbles' "memory" needs the history anyway.

```sql
-- 00007_kitchen_events.sql
CREATE TABLE kitchen_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  xp INTEGER NOT NULL DEFAULT 0,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kitchen_events_user_time ON kitchen_events(user_id, occurred_at DESC);
CREATE INDEX idx_kitchen_events_type ON kitchen_events(user_id, event_type);
```

| Event | XP | Notes |
|---|---|---|
| `pantry_item_added` | +2 | Capped at 20 XP/day so a big receipt scan doesn't trivialise levelling |
| `receipt_scanned` | +10 | Once per confirmed scan |
| `recipe_saved` | +5 | Includes URL import |
| `recipe_cooked` | +25 | The hero event. Fires from CookModal confirm. |
| `item_rescued` | +15 | **Bonus** when a cooked recipe consumed an item expiring within 2 days |
| `item_expired` | 0 | Logged for Bubbles' context. **Never a penalty.** |

`item_rescued` is the mechanic that makes this BubblyChef's game rather than a
generic points skin. It is worth more per-item than adding one, and it is the
only event Bubbles celebrates loudly.

### 5.3 Progress + streaks

```sql
-- 00008_kitchen_progress.sql
CREATE TABLE kitchen_progress (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  total_xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  room_tier TEXT NOT NULL DEFAULT 'starter',
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_active_date DATE,
  grace_used_on DATE,
  items_rescued INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Streak definition:** a day counts if the user cooked a recipe *or* rescued an
item. Not "opened the app" — opening the app is not an achievement.

**Forgiveness is mandatory.** Nobody cooks 365 days a year, and a streak that
shatters on the first busy Tuesday is a churn mechanic, not a retention one.
One automatic grace day per rolling 7 days (`grace_used_on`), and the UI frames
a broken streak as "let's start a new one!" — never a red zero. This is the
PRD's positive-framing principle applied to progression.

**Levels:** `level = floor(sqrt(total_xp / 50)) + 1` — fast early levels, a
gentle curve after. Every level grants an unlock; every 5th grants something
visible in the room.

### 5.4 Kitchen evolution

Three distinct tracks, deliberately separated so the room never looks empty
*and* never looks static:

**a) Earned decorations** — the dormant `decorations` table finally does its job.

```sql
ALTER TABLE decorations
  ADD COLUMN IF NOT EXISTS slot TEXT,           -- 'shelf' | 'wall' | 'floor' | 'counter'
  ADD COLUMN IF NOT EXISTS unlock_level INTEGER,
  ADD COLUMN IF NOT EXISTS rarity TEXT NOT NULL DEFAULT 'common';
```

Each decoration binds to a named slot in the room. Per PRD story #29, an
unfilled slot renders as *nothing* — never a dashed placeholder box. A new
user's kitchen must look complete, just plain.

**b) Room tier** — a whole-room restyle at levels 5 / 10 / 20
(`starter` → `cozy` → `chefs`). Wall colour, floor material, window dressing.
This is the "wow, my kitchen changed" beat, and it needs to be rare enough to
stay special.

**c) Ambient state** — *not earned*, reflects live data, recomputed every visit:
fridge fullness from pantry count, a glow on the fridge when items are expiring,
dishes on the counter derived from `recipes.times_cooked` (which `00006` gives
us), and seasonal dressing keyed off the date.

Track (c) is what makes the room feel alive on day one, before any progression
exists. It is also the PRD's original "absence loop" — the scene has changed
since you last looked, because your kitchen has.

### 5.5 Living Bubbles

Bubbles today is `tips[new Date().getDay() % tips.length]` — seven hardcoded
strings on rotation.

**The upgrade is memory, not a bigger model.** Bubbles gets a compact profile
derived from the event ledger and pantry state, and speaks from it:

```
BubblesContext {
  streak_days, level, room_tier,
  cooked_recently: [recipe titles, last 5],
  favourite_cuisines: [derived from cooked recipe tags],
  rescued_recently: [item names],
  expiring_now: [item names, ≤3 days],
  pantry_size, days_since_last_cook,
  unlocked_today: decoration | null
}
```

That structured context goes through `AIManager` with a Pydantic response schema
— the same grounding pattern the recipe workflow already uses (structured
context, never a raw data dump). It produces her line of the day plus a mood
enum the scene renders.

**Three constraints that keep this cheap and safe:**

1. **One generation per user per day, cached.** Not per render, not per
   navigation. This matters given issue #8 (no rate limiting on AI calls) is
   still open — the daily line must not become a per-pageview API call.
2. **Templated fallback always present.** If Gemini is rate-limited and Ollama
   is unavailable, Bubbles falls back to a deterministic templated line built
   from the same context. The scene must never render an empty mascot.
3. **Positive framing enforced in the prompt.** Expiring items are adventures,
   broken streaks are fresh starts. This is a product rule, not a stylistic one.

**Reactions** (the mood animation) stay fully deterministic — derived in a pure
function from pantry state, exactly as PRD #67 specced. Only *language* is
generated. A mascot whose facial expression depends on an API call is a mascot
that looks broken when the API is down.

---

## 6. Sequencing

Each phase is independently shippable and leaves the app in a working state.

### Phase A — Unblock (prerequisite for everything)
- Audit and land `feat/ui-overhaul` (PR #74) → `main`; land stacked #119/#120/#121
- Apply `00006` to production Supabase
- Land PR #59 (Playwright harness) — the kitchen work wants regression cover
- Close the ~30 UI child issues the branch already resolved
- Rewrite `ROADMAP.md` (stamped 2026-05-02, pre-dates the whole UI wave)
- Delete `MODEL-OPTIONS-SUMMARY.md` — it claims Gemini 3.0 doesn't exist and
  recommends `gemini-2.0-flash-exp`, while `ai-service/bubbly_chef/ai/gemini.py`
  pins `gemini-2.5-flash`

### Phase B — PWA shell
- `manifest.json`, maskable icons, standalone display, theme-colour per palette
- Service worker: app-shell caching, offline fallback page
- Install prompt (dismissible, non-nagging)
- Web Push subscription plumbing — *scaffolding only*, no sends yet

### Phase C — Live kitchen v1 (no progression yet)
- Rewrite the renderer sections of PRD #67 for DOM; close/rewrite #68
- Room: two-band dollhouse layout on CSS custom properties, all 5 palettes
- 4 zones as accessible links: fridge → `/pantry`, stove → `/chat?mode=recipe`,
  bookshelf → `/recipes`, scan poster → `/scan`
- Bubbles NPC: patrol, direction flip, idle bob, deterministic mood
- Ambient state track (5.4c): fridge fullness, expiry glow, counter dishes
- Delete `HeroHome.tsx`
- **Ships a better home screen with zero backend work.**

### Phase D — Progression engine
- `00007_kitchen_events` + `00008_kitchen_progress` + RLS
- Emit events from existing write paths: scan confirm, cook confirm, pantry add,
  recipe save
- XP / level / streak computation with the grace-day rule
- Minimal HUD in the kitchen: level, streak, XP toward next level

### Phase E — Kitchen evolution
- Extend `decorations`, seed the unlock catalogue
- Render decorations into room slots; wire the dormant `GET /api/decorations`
- Room tiers at 5 / 10 / 20
- Unlock celebration moment (Framer Motion, respects reduced-motion)

### Phase F — Living Bubbles
- `BubblesContext` builder in `ai-service/` off the event ledger
- Daily line generation via `AIManager` + Pydantic schema, cached per user/day
- Templated fallback path
- Wire into the scene's speech bubble overlay

### Phase G — The return loop
- Push notifications: expiry nudges, streak-at-risk reminder, unlock earned
- Satisfies issue #43 (notification centre) with real delivery
- Frequency caps and a genuine off switch

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Phase A audit finds `feat/ui-overhaul` needs real rework | Time-box the audit. If it exceeds ~2 days, land it behind the theme picker as opt-in and fix forward rather than blocking C–G. |
| Overriding PRD #67's Phaser decision invalidates #68–#75 | Only #68 dies outright. Rewrite #67's renderer section; #69–#75 keep their scope with the renderer swapped. |
| Daily Bubbles generation trips free-tier limits | One call/user/day, cached, with a deterministic fallback. Resolve issue #8 (rate limiting) during Phase F. |
| Gamification feels bolted on | XP comes exclusively from real kitchen events. No login rewards, no tap-to-collect. If a mechanic doesn't map to a kitchen action, it doesn't ship. |
| iOS PWA push friction (requires Add to Home Screen) | Accepted. Ship an install prompt in Phase B; measure before considering native. |
| Streak mechanics drive churn instead of retention | Grace day, positive framing on break, streak defined by cooking rather than app-opening. |

---

## 8. Open questions

1. **Art assets.** Phases C–E ship placeholder-first per PRD #67. Real sprites
   are an independent track — commission, generate, or stay stylised-CSS
   permanently? The DOM decision makes "stay stylised" genuinely viable.
2. **Does the Scan tab leave the bottom nav** once the scan poster exists in the
   kitchen? PRD #67 flagged this as a separate UX decision; still unresolved.
3. **Retro-seeding.** Should existing cook/scan history backfill the event
   ledger so a returning user isn't level 1? Recommend yes, one-time, capped.
4. **Video recipe ingestion (`BubblyChef-u1c`)** and shopping lists (#42) are
   still open Phase 3 scope. This plan does not sequence them; they slot after
   Phase C or run parallel on the backend track.
