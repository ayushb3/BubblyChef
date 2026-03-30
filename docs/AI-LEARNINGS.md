# AI Tooling Learnings

A running log of observations, surprises, and decisions from building BubblyChef with AI-assisted development. Captures the *narrative* — the why, the failures, the things that surprised me. Actionable tasks live in GitHub Issues.

---

## Format

Each entry:
- **Date** — when it happened
- **Context** — what I was trying to do
- **What happened** — the observation or outcome
- **Key takeaway** — the transferable lesson

---

## 2026-03-18 — Delete, don't fix (Phaser → DOM kitchen scene)

**Context:** The Phase K2 kitchen scene used Phaser.js, a canvas-based game engine. It kept conflicting with React's lifecycle in subtle ways — the canvas wouldn't unmount cleanly, animations fought with React state updates, and fixing one issue surfaced another.

**What happened:** Rather than patching Phaser to coexist with React, I deleted it entirely and rebuilt the kitchen scene with DOM elements + Framer Motion. The result was simpler, no dependency conflicts, and matched the visual quality.

**Key takeaway:** When a library needs 3+ patches to coexist with your framework, the right move is usually to delete it. DOM-native solutions with animation libraries are often good enough and don't carry hidden coupling costs.

*Source: `.agents/learnings/2026-03-18-k2b-dom-kitchen-dnd.md`*

---

## 2026-03-17 — Agentic workflow: Claude Code as coordinator

**Context:** Used Claude Code's agent team feature (pm → dev1/dev2) to implement the food catalog system (304-entry USDA-backed JSON, icon API, fuzzy matching).

**What happened:** The PM agent decomposed the work, spawned dev agents for backend and frontend separately, and coordinated without me having to context-switch between layers. The agents worked in parallel on non-conflicting files.

**Key takeaway:** Agent teams work well when work can be decomposed along clear file/layer boundaries (backend vs frontend). The PM handoff structure (triage → plan → implement → validate) prevents the "just code it" trap where implementation starts before the approach is agreed on.

---

## 2026-03-17 — React Query cache key identity

**Context:** Optimistic updates to pantry items weren't reflecting in the UI after drag-and-drop slot changes.

**What happened:** The query key used by the optimistic update was `['pantry']` but the actual hook registered `['pantry', {}]`. These are reference-unequal in React Query — the update silently missed.

**Key takeaway:** React Query uses deep equality for cache keys, but object literals like `{}` are new references each render. Always store the params object in a variable or use `useMemo` so the key identity is stable. When debugging stale cache, log the exact key from `useQueryClient().getQueryCache()`.

---

## 2026-03-17 — Fuzzy match thresholds matter (WRatio false positives)

**Context:** Building the food catalog fuzzy matcher. Used `rapidfuzz` WRatio at threshold=80 to match item names to catalog entries.

**What happened:** Short words like "oil", "rice", "salt" were matching unrelated catalog entries because WRatio at 80 is too lenient for short strings — substring overlap inflates the score.

**Key takeaway:** Use different thresholds for different operations: 80 is fine for "did you mean X?" suggestions, but use 95+ for authoritative categorization where false positives cause wrong data. Always test fuzzy matchers against your actual short-word cases.

---

## 2026-03-24 — DOM kitchen scene: pointer-events on decorative images

**Context:** Decoration PNG overlays (flower pots, herb garden) were placed over the interactive kitchen zones. Clicking the zone sometimes did nothing.

**What happened:** The PNGs were intercepting click events silently — no console error, no visual feedback, just dead clicks. The fix was `pointer-events: none` on the `<img>` elements.

**Key takeaway:** Any `<img>` overlay on an interactive element must have `pointer-events: none` at authoring time, not as a fix later. Silent click interception has no console error and is hard to debug by feel alone. Make it a rule: decorative images always get `pointer-events-none`.

---

## 2026-03 — LangGraph for chat intent routing

**Context:** Chat needed to route between 4 intents (recipe-generate, pantry-add, cooking-question, saved-recipe-lookup) and handle multi-step workflows (e.g. pantry proposals requiring user approval).

**What happened:** LangGraph worked well for the state machine structure — each intent is a node, transitions are explicit, and the workflow resumption system (`POST /v1/workflows/{id}/events`) let the frontend pause and resume mid-flow cleanly.

**What was awkward:** Testing LangGraph workflows requires mocking the AI provider carefully. If the mock isn't wired correctly, tests hang waiting for real API calls. The failure mode is silent (test just times out).

**Key takeaway:** LangGraph is a good fit for multi-step AI workflows with user approval gates. Always mock the AI manager at the `AIManager.complete()` level, not deeper in the provider chain — that's the stable seam.

---

*Add new entries at the top of the log, below this line.*
