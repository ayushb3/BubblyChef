# R5 — LLM tools for General Chat (proactive suggestions)

**Status:** Design resolved — blocked on R3 (#187) · **Tracking:** #189
**Date:** 2026-07-31

> R5 gives the general-chat path tool access so it can ground replies in the user's
> live data. Architecturally it **reuses R3's foundation wholesale** — the design work
> here is product/behavioral, not architectural. Design session 2026-07-31 resolved it.

## Goal

Upgrade the `general_chat_response` node (`workflows/chat/nodes.py`) from a single-shot
pipeline (peek at pantry names → one prompt → one `complete()`) into a ReAct agent that
can call read-only tools to ground its answers.

Mechanically this is **the same node-internal swap R3 makes** on the cooking node — the
general-chat node today is structurally identical to the old cooking node. By the time
R5 runs, all the machinery exists.

## Hard dependency

**Blocked on R3 (#187).** R5 reuses, unchanged:
- the `@tool` decorator + registry,
- `complete_with_tools` on `AIProvider`,
- the hand-rolled ReAct loop (with `max_iterations` cap),
- the `supports_tool_calling` capability gate + graceful single-shot fallback.

R5 does **not** re-design any of that. It adds two tools and swaps one node's internals.

## Resolved design

### Decision A — "Proactive" means reactive-with-tools, NOT unprompted nudges

The issue's wording ("proactive suggestions... surface expiring items unprompted") names
a **goal**, not a delivery mechanism. Injecting unprompted messages into the chat box
("by the way, your spinach expires tomorrow!") is an anti-pattern: it nags, fires at the
wrong moment, and uses the loud conversational channel for ambient info.

**R5 = reactive-with-tools:** the assistant answers when asked, but can call read-only
tools to ground its reply and volunteer *relevant* context within a response it was
already giving. It does not spontaneously interrupt.

Genuine ambient expiry alerts belong on the **dashboard** (the existing expiring-items
widget) or a **notification** feature — split off from R5 as separate work.

### Decision B — Tools: three read-only lookups

Same principle as R3 (tool only what the model can't know — live/private data, exact
compute, or curated authority):

- **`check_pantry(ingredient)`** — reused directly from R3.
- **`get_expiring_items()`** — the data behind grounded expiry-aware suggestions; the
  model cannot know dates.
- **`list_saved_recipes()`** — "what have I saved that uses chicken?"; live user data.

No write tools.

### Decision C — Suggest, never act

Honors the app-wide **Proposal pattern**: tools are read-only; any "want me to add X?"
is a suggestion the user acts on, never an auto-write. v1 suggestions are **plain text**
— a tappable structured-action UI is its own project, deferred.

## Build checklist (small, given R3)

1. Two new tools: `get_expiring_items()`, `list_saved_recipes()` (read via `SupabaseRepository`).
2. Swap `general_chat_response` internals to the ReAct loop (mirror R3's cooking node),
   with the same `supports_tool_calling` degraded fallback to single-shot.
3. Tests: tool-grounded answer, no-tool direct answer, degraded-path fallback.

## Out of scope / deferred

- **Unprompted expiry notifications** → separate dashboard/notification feature.
- **Tappable structured suggestion actions** → separate UI project.
- **Write tools** → excluded by the Proposal pattern.

## Size

Small — once R3 lands. Two read-only tools + one node swap. The heavy lifting (registry,
provider tool-calling, loop, gate) is all R3.
