# BubblyChef — Signature PRD

**Date:** 2026-09-29 · **Status:** goals agreed with Ayush 2026-09-29. Each goal's details
get fleshed out in its own grilling session, then specced and ticketed autonomously.
**Replaces:** `docs/plans/2026-09-23-v1-friend-ready-prd.md` as the plan of record. The parts
listed under "Carries over" still hold.

## Why

The app works, has a theme and has some cool features. But it is still a chat app with a
scan feature and a nice cooking UI. Nothing is fleshed out enough to feel niche or unique.
The friend-ready PRD made the app complete, not distinctive: its two most unique ideas were
scoped down. The full kitchen went to "Later", and the meal object was left to M3. This PRD
moves those two to the centre, builds them properly, and adds a component language to
carry them.

## North-star demo

A friend opens the link and lands in a **pixel kitchen**. They scan a receipt and watch the
groceries unpack onto the shelves and into the fridge. They ask Bubbles for "dinner for two,
something cozy" and get a **real meal**: a main and sides, each as a recipe card, plus a
timeline for cooking them together. They cook along while the kitchen shows what is on the
stove. At the end, the meal is deducted from the pantry in one go, and they earn bubbles and
a decoration.

Every goal below exists to make that demo real, and the demo is the acceptance test for the
whole PRD.

## Goal 1 — Dinner, planned (the meal engine)

Chat to a full meal to a cook-along, end to end.

**Agreed**
- A meal is a **main plus up to two sides**. This supersedes the "entrée + sides" framing of
  issue #289.
- Chat proposes meal options as **cards**, not chat text. Picking one produces a **meal
  artifact**: a recipe card per dish, plus the combined timeline.
- **The timeline is a table with three columns** (main, side 1, side 2), and each row is a
  moment in time. Cues interleave across dishes. For example: "sear the meat" → "build the pan sauce" →
  "while the sauce reduces, start boiling the pasta" → "as the pasta simmers in the sauce,
  toss the salad".
- **No equipment model.** The timeline doesn't reason about burners or ovens. The user can
  state constraints ("I only have one pan") and the plan respects them.
- Implementation direction: the LLM supplies each step's duration, its dependencies and
  whether it's hands-on or hands-off. A deterministic scheduler builds the interleaved
  timeline. This follows the same LLM-plus-deterministic pattern as `score_and_rank`, and
  it keeps timings from being hallucinated.
- Cook-along follows the merged timeline and uses the timer dock that's already merged
  (PR #619).
- Missing ingredients for the meal feed the grocery list (issue #497).

**To flesh out (grilling session)**
- Entry points: chat only, or also a "plan dinner" action from the kitchen?
- The option cards: how many options, and what each card shows.
- Editing: swapping one side or regenerating one dish without losing the rest.
- Saving: is a meal saved as a unit, and do its dishes also land in the recipe library?
- Timing: start from "now" by default? Offer a "serve at 7" mode?
- Cook confirm and deduction for the whole meal, how it fits with the mid-cook amendments
  (issues #489, #490), and servings scaling.

## Goal 2 — The kitchen is the app

Home isn't a dashboard with a kitchen widget: it *is* the kitchen.

**Agreed**
- **A pixel-art world with readable kawaii UI around it.** The kitchen scene, Bubbles and
  the decorations are pixel art. Panels, cards and sheets get pixel-style framing but stay
  readable, with Nunito for body text. The UI is not literal pixel art throughout.
- The pantry lives in the scene: fridge items in the fridge, dry goods on the shelves.
  Tapping the fridge opens its contents, and expiring food visibly wilts.
- Bubbles is present in the scene: moving, reacting and pointing things out.
- Scanning unpacks the groceries into the scene. Cooking shows up at the stove.
  Decorations fill the slots.
- Implementation direction: layered sprites with Framer Motion, not a game engine, unless
  free movement turns out to be needed.

**To flesh out (grilling session)**
- Art direction: pixel scale, perspective (front-on or 3/4) and reference games. Does the
  Bubbles art from PR #592 get a pixel redraw? Who makes the pixel art, and with which tool?
- How roughly 80 pantry items map onto the scene without clutter (grouping, overflow).
- How Bubbles moves: idle wandering, or scripted moves between points of interest.
- Whether a plain list view of the pantry stays, for bulk edits and accessibility.
- What happens to the M1 kitchen work already shipped (slots, themes, the bubbles ledger,
  reactions): reuse it or rebuild it.

## Goal 3 — It looks like nothing else (component language)

Today many components feel generic: stock cards, sheets and buttons with pastel colours on
top. The goal is a small set of **signature components** shared by the kitchen and the meal
flow, not a restyle of everything.

**Agreed**
- The design happens in **Claude Design**, with Claude guiding Ayush through it. First a
  BubblyChef design system built from the codebase (tokens, fonts, Bubbles, pill shapes),
  then three hero screens: kitchen home, meal artifact, cook-along.
- Built work is checked against the designs: `verify` screenshots are compared with the
  hero screens.

**To flesh out (grilling session)**
- An audit of which components read as generic today.
- The signature set: likely the recipe card, the meal timeline table, panels and sheets,
  buttons and chat bubbles.
- Motion and feedback language: micro-reactions, and whether to use sound.

## Sequencing

1. **Now:** grill Goal 1, spec it and start building the meal engine backend. It doesn't
   depend on visuals.
2. **In parallel:** set up the Claude Design system and grill Goals 2 and 3 against real
   designs.
3. **Then:** build the kitchen and the signature components against the hero screens, and
   put the meal artifact's final look on the new components.

## Carries over from the friend-ready PRD

- Guest mode: no signup wall, state saved, 30-day cleanup of never-linked guests (PR #532).
- Quality bars for scan, recipe ideas and UI (LCP ≤ 2 s, screen changes ≤ 0.5 s, instant
  tap feedback).
- The gamification economy: bubbles 🫧 for every interaction, the most for rescuing food,
  pick-1-of-3 unlocks at milestones, themes as the big milestones, no bubbles ever taken
  away.
- The grocery list (issue #497), now also fed by meals.

## Deferred

- The YouTube Shorts import (issue #528).
- Minor recipe-quality fixes, unless they fall out of the meal work.
- Everything in the friend-ready PRD's "Explicitly not in v1" list.

## How we work (autonomous, from 2026-09-29)

Ayush sets goals and iterates on designs. Claude does everything else: specs, slicing,
triage, build, review and merge. PRs merge once the required checks are green, the latest
Claude review says mergeable, and `verify` passes for anything user-visible. Slices are
feature-sized. Claude decides reversible product calls itself and logs them in the sprint
doc. Changes to this PRD's goals go to Ayush.
