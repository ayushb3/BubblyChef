# BubblyChef v1 — friend-ready PRD

**Date:** 2026-09-23 · **Status:** agreed with Ayush 2026-09-23 (meal object design session pending)
**Replaces:** `ROADMAP.md` as the plan of record. Everything not in here is
"later" or closed.

## Goal

A fun, cute, genuinely useful chef assistant Ayush can send to friends and be proud of —
the thing that replaces his "ask Gemini what to cook" habit. Then the project is done
(or moves to casual, occasional work).

## What "friend-ready" means

1. A friend opens a link and is playing within seconds — no signup wall.
2. Scanning a receipt feels like magic: fast, nearly every item right, never a raw error.
3. "What can I make?" gives creative, appetising, pantry-aware ideas — including full meals.
4. Saving, cooking (guided, with timers) and building a grocery list all work end to end.
5. It looks and feels uniquely BubblyChef: Bubbles is alive, and the kitchen fills up as you use it.

## Features

### Fun / unique
| Feature | v1 scope | Later |
|---|---|---|
| **Bubbles comes alive** | One consistent art style across all screens (#401) with a small expression set (happy, thinking, surprised, worried); reacts to moments: scan done, cook finished, food about to expire | Personality/tone setting (#392) |
| **Kitchen + unlockables** | Illustrated kitchen scene where pantry items show up on shelves / in the fridge; decorations unlocked by cooking and scanning (existing `decorations` table + `GET /api/decorations`) | Full animated/game scene; Fluent Emoji icon set (licensing) |
| **Video recipe import** | YouTube Shorts link → recipe card. **Gemini watches the video directly from its URL** (visual + audio, so shown-not-spoken recipes work; ~half a cent per Short on Flash-Lite; no transcript scraping for YouTube to block). Goes through `AIManager` (new video-capable method), then the existing URL-import confirm flow | TikTok, Instagram Reels (#190) |
| **Smarter chat meals** | **A full meal object** (#289): a meal = main + sides as components with roles, saved, cooked and deducted as one unit with combined timing. Brainstorm offers meal ideas when asked for dinner / a full meal. Plus chat can reference saved recipes — "make that butter chicken again" (#493, #494). Plus quality fixes #513, #288, #443 | Proactive suggestions (#189) |

### Gamification design (agreed 2026-09-23)

- **The kitchen is the home screen's centrepiece, always visible.** One illustrated scene
  with ~12 fixed **slots** (wall shelf, window sill, counter, fridge door, rug, wall art,
  hanging plant, lights, …). A decoration is an image that sits in one slot. "Growing" =
  slots filling up. Fixed positions: no game engine, no free placement.
- **Currency: bubbles 🫧** (shown as "🫧 20"; lowercase in copy so it doesn't blur with the
  mascot's name). **Every interaction earns some**: scan, add item, save recipe, cook,
  daily visit. **Rescuing food earns the most**: using/cooking an item before its expiry
  date, and a weekly "nothing went to waste" streak.
- **Unlocks: at bubble milestones, pick 1 of 3 decorations.** Collecting feel with a real
  choice; no shop economy to balance.
- **Themes are the big milestones**: e.g. cozy cottage, pastel Sanrio, night kitchen,
  seasonal. A theme swaps the background/palette; decorations stay.
- **Food expires unused → Bubbles looks sad and the weekly streak resets. No bubbles are
  taken away.**
- **Build order:** agents build the system with emoji/placeholder art first (slots,
  bubbles ledger, milestones, pick-one unlock, home widget). The exact asset list falls out
  of that layout; then the Nano Banana prompt pack is written against it and Ayush generates
  art in the Gemini app; art is swapped in last.
- **Data:** builds on the existing `decorations` table + `GET /api/decorations`; needs new
  per-user progress/unlock tables → a migration (protected; Ayush approves).
- **Art pipeline:** style sheet first (Bubbles reference + one sample item), attached as a
  reference to every later prompt for consistency; items generated on a flat background
  and cut out by a small script. v1 target: ~6 Bubbles expressions, 3–4 kitchen
  backgrounds, ~20 decorations.
- **Bubbles' base design has no props** (plain apron, plain hat, empty paws). Props —
  spatula, rolling pin, whisk, apron patterns, hats — are **collectibles** unlocked through
  the same milestone system. The turnaround sheet is built as an animation model sheet so
  Bubbles can walk/turn in the kitchen later.

### Practical
| Feature | v1 scope | Later |
|---|---|---|
| **Try without signup** | A guest uses the whole app normally and their state is saved — no sign-in needed; sign-in only to keep data permanently / across devices, and linking keeps the guest's data (#389). First-run welcome (#390). Guest data never linked to an account is deleted after 30 days. No per-guest cost guard for now (#332) | Per-guest rate limits if usage demands |
| **Grocery list** | As specced in #497: `/grocery` page regenerated on demand from depleted + expiring stock, check-offs saved on the device (localStorage), manual add, share as text; recipes offer an explicit "add to list" for missing ingredients (never auto-add). No migration | Synced list across devices; per-item low-stock thresholds; store integrations |
| **Guided cooking polish** | Step-by-step cook mode end to end: **timers** (#495 — step ⏱ chips, multiple named timers, dock across the app); **correct deduction** incl. piece units (#222); **mid-cook amendments** that reach the deduction and survive reload (#489, #490). Gamification: bubbles for cooking, bonus when a cook uses soon-to-expire food | Compound substitutions (#284) |

### Explicitly not in v1
Taste profile (allergies, dislikes, household — #500, #501, #395), notifications (#496, #43),
meal planning calendar (#193), barcode scanning (#191), multi-household (#194), native app,
nutrition, social features.

## Quality bars

| Area | Bar (agreed 2026-09-23) |
|---|---|
| **Scan** | Typical receipt finishes in ≤ 15 s; ≥ 90 % of line items correct on the fixture receipts; failures always show a friendly message and never lock the UI |
| **Recipe ideas** | Ideas use what's in the pantry without forcing expiring items into dishes they don't suit (#288); never suggest expired / zero-quantity stock (#443); meal-shaped when asked for dinner |
| **UI** | First visit: main content visible in ≤ 2 s on a mid-range phone over 4G (Lighthouse mobile LCP; Google's "good" line is 2.5 s). Moving between screens in the app: ≤ 0.5 s. Every tap gives visible feedback instantly (< 100 ms). No empty bubbles, stuck spinners or lost input; smooth motion; mobile-first (≤ 480 px). Measure a baseline on production before tuning. |

## Milestones (target: this week, starting 2026-09-23)

| Milestone | Contents | Who |
|---|---|---|
| **M0 — Cleanup** | Turn the open cloud-session drafts into merged code; then v1-relevant bugs via the loop | Agents; Claude merges verified unprotected PRs |
| **M1 — Friends can open it** | Guest mode (full app, state saved, no sign-in; 30-day cleanup); Bubbles stylesheet + reactions; kitchen with placeholder art + bubbles ledger + milestones + pick-1-of-3 | Agents build; Ayush generates art |
| **M2 — The magic** | Scan reliability; recipe-quality fixes (#513, #288, #443); saved-recipe lookup (#493, #494); timers (#495); grocery list (#497); YouTube Shorts import | Agents from issues |
| → **Share with friends** | | |
| **M3 — The big one** | Full meal object (design session 2026-09-24 first); mid-cook amendments (#489, #490); piece-unit deduction (#222); final art swap | Design session, then agents |

Acceleration: 2–3 agent loops in parallel (one per Claude session/worktree; `stack.sh`
gives each worktree its own ports); daily loop cap raised; decisions batched to Ayush.
Honest estimate: M1+M2 by the weekend is realistic; M3 is ~50/50, meals most likely to slip.

## How we work (ship mode)
- Agents clear existing issues and drafts through the loop; Claude merges verified,
  unprotected PRs. Protected paths and product calls go to Ayush.
- New features: this PRD → small vertical-slice issues → loop or pair session.
- Cheap model everywhere (`gemini-3.1-flash-lite`), spend cap ~$10/month.

## Open questions
1. ~~Gamification~~ — agreed (see design above). Remaining detail: exact bubble amounts
   per action and milestone spacing — tune once it's playable.
2. ~~Guest mode~~ — agreed: a guest uses the whole app normally and their state is saved,
   with no sign-in required (sign-in only to keep data across devices / permanently).
   Guest data never linked to an account is deleted after 30 days. Cost guard: none for
   now, revisit based on real usage (the spend cap is the backstop).
3. ~~Art source~~ — Ayush generates with Nano Banana (Gemini Pro sub), after the
   placeholder build fixes the asset list.
4. Quality bar numbers above — agree or change.
