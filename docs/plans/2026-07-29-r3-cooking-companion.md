# R3 — Cooking Companion sub-graph (design stub)

**Status:** Stub / not started · **Tracking:** #187 (R5 #189 depends on this)
**Date:** 2026-07-29

> This is a scoping stub, not a finished design. It captures what R3 delivers, the
> foundation it must build, and the open questions to resolve before implementation.

## Goal

A ReAct-style chat sub-graph the assistant enters when the user is cooking and asks
help questions — "I'm out of buttermilk, what do I use?", "how do I fold egg whites?".
The assistant reasons and calls **tools** to answer, rather than free-generating.

Per CONTEXT.md, the Cooking sub-graph is "ReAct-style with tool access
(substitutions, techniques)". Initial tools named in `docs/plans/2026-04-29-active-work-items.md`:
`suggest_substitution`, `explain_technique`.

## The foundation this phase must build (load-bearing)

There is **no tool-calling / ReAct infrastructure in the codebase today** — confirmed
no `ToolNode`, `bind_tools`, or `create_react_agent` anywhere. The `tools/` directory
holds plain async functions (`expiry`, `normalizer`, `product_lookup`, `web_search`)
but none are bound to an LLM.

R3 is therefore where the **shared tool registry** gets built — the piece the docs
describe as: *"plain Python async functions callable from sub-graph nodes, API routes,
and LLM ToolNode (eliminates scan/chat duplication)."* This registry is the shared
dependency that **R5 (#189) also needs** — build it once here.

Concretely R3 delivers:
1. A tool-registry pattern (decorate/register plain async fns; expose them as LLM tools).
2. The ReAct loop wired into a LangGraph sub-graph (model ↔ ToolNode).
3. First two tools: `suggest_substitution`, `explain_technique`.
4. Router wiring: a Cooking intent that dispatches into this sub-graph.
5. No data mutation (read-only cooking help).

## Dependencies

- **Blocks R5 (#189)** — R5 reuses this tool registry + ReAct base for proactive general chat.
- **Independent of R4** (ingest consolidation).
- Provider caveat: tool-calling must work through `AIManager` (Gemini primary, Ollama
  fallback) — verify both providers support the tool-calling path, or gate by provider.

## Open questions (resolve before build)

- LangGraph prebuilt (`create_react_agent`/`ToolNode`) vs. a hand-rolled loop?
- Tool-registry shape — decorator vs. explicit registration; how routes reuse it.
- Which model tier runs the loop, and Gemini-vs-Ollama tool-calling parity.
- Intent boundary: how does the router decide "cooking help" vs. recipe-generate/general-chat?
- Tool scope for v1 — just substitution + technique, or more (unit help, timing)?

## Size

Medium–large. The value is mostly the reusable foundation; the two tools themselves are small.
