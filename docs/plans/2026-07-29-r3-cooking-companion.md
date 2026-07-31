# R3 — Cooking Companion sub-graph

**Status:** Design resolved — agent-ready · **Tracking:** #187 (R5 #189 depends on this)
**Date:** 2026-07-29 · **Design resolved:** 2026-07-30

> Design session 2026-07-30 resolved all five open questions. Section "Resolved
> design" below is the build spec. The original scoping stub is preserved after it
> for context.

## Goal

A ReAct-style chat sub-graph the assistant enters when the user is cooking and asks
help questions — "I'm out of buttermilk, what do I use?", "how do I fold egg whites?".
The assistant reasons and calls **tools** to answer, rather than free-generating.

The essential distinction: today's `cooking_help_response` node is a **single-shot
pipeline** (fetch pantry → one giant prompt → one `complete()` call → text). R3 turns
it into an **agent**: a reason → act → observe → repeat loop where *the model decides*
what tool to call and when it has enough to answer. The loop — model-driven control
flow — is what makes it an agent, not the tools themselves.

---

## Resolved design (build spec)

### The shape: a node-internal swap

R3 does **not** touch intent classification, routing, or graph edges. It replaces what
happens *inside* the existing `cooking_help_response` node (`workflows/chat/nodes.py`).
Everything upstream (classifier) and downstream (`update_session` → END) is unchanged.
Minimal blast radius.

### Decision 1 — Loop: hand-rolled ReAct, inside a LangGraph node, over `AIManager`

- **Not** `create_react_agent` / LangChain `BaseChatModel`. That prebuilt loop wants
  LangChain's model protocol (`bind_tools`, message objects), which our `AIProvider`
  (`string in → str|BaseModel out`) does not speak. Adopting it would force either
  LangChain model wrappers (re-implementing tool-calling per provider) or LangChain's
  own Gemini/Ollama integrations — the latter **bypasses `AIManager`** and its
  Gemini→Ollama→… fallback, violating the "all AI calls through `AIManager`" rule.
- **Instead:** LangGraph stays for *structure* (router, sub-graph, state); the ReAct
  loop is a ~40-line hand-rolled `while` inside the node, calling `AIManager`. This is
  the documented best-practice choice for a **single agent + few tools + linear
  reasoning** (start with your own loop; add framework layers only when a specific pain
  — durable cross-session state, human-in-the-loop approvals, multi-agent topologies —
  actually appears). R3 has none of those pains.
- LangGraph's heavier multi-agent / sub-graph orchestration is explicitly **out of
  scope** for R3.
- **Hard safety valve:** `max_iterations` cap on the loop (best practice — models don't
  reliably stop themselves; an uncapped loop is a silent cost/latency leak). Cap ~5.

### Decision 2 — Tool registry: `@tool` decorator, auto-schema

- A `@tool` decorator that inspects signature + docstring to auto-build the tool schema
  and register `{name → (fn, schema)}`. Define a function → it's callable three ways:
  directly from routes, directly from graph nodes, and by the LLM via tool-calling.
- Auto-schema-from-signature kills schema drift (the reason frameworks default to it).
- Accept an optional `description=` override so the model-facing text can be tuned
  without changing the function's own docstring.
- Tools live in an **explicitly-imported package** (e.g. `tools/cooking/`) — no
  import-time-magic surprises about what's registered.
- **This registry is the load-bearing R3 deliverable** — R5 (#189) reuses it wholesale.

### Decision 3 — Provider parity: capability gate (mirrors `supports_vision`)

- Add to the `AIProvider` ABC:
  - `supports_tool_calling: bool` property (defaults False; mirrors the existing
    `supports_vision` pattern).
  - `complete_with_tools(...)` method — takes the prompt + registered tool schemas,
    returns either a text answer or a structured tool-call request.
- Per-provider tool-calling support:
  - **Anthropic (SAP proxy)** — first-class; **current dev default**. Already raw
    `httpx` to the Messages API → add `tools` to the body. `supports_tool_calling = True`.
  - **Gemini** — first-class (v1beta `tools → functionDeclarations`, JSON Schema).
    Already raw REST via httpx → natural extension. `True`.
  - **Ollama** — tool-calling is emergent/model-dependent (prompt-and-parse, flaky).
    `supports_tool_calling = False` for now.
- The loop checks the active provider's flag. If **False**, the node degrades to
  **today's single-shot behavior** (grounded prompt, one `complete()`), so cooking help
  never breaks — it just loses the tool loop on weak providers.
- Production provider choice + whether to build Ollama emulation → deferred to **#202**.

### Decision 4 — Intent boundary: reuse `cooking_help` as-is

- The router already classifies `cooking_help` vs `recipe_generation` vs `general_chat`
  with working prompt rules (`router.py:107–137`). R3 changes nothing here.
  - "how do I fold egg whites?" → `cooking_help` → **R3 ReAct node** (new internals)
  - "what can I make for dinner?" → `recipe_generation` → existing grounding workflow
  - "what's the weather?" → `general_chat` → unchanged

### Decision 5 — v1 tools: `check_pantry` only

- **Principle applied:** a capability earns a tool only if the model can't reliably *do*
  it (live/private data, exact computation, or a curated authoritative source) — not
  merely because it's cooking-related. Don't instrument knowledge the model already has.
- **`check_pantry(ingredient)` — the one v1 tool.** The model cannot know the user's
  kitchen; this is live private data. It's what turns "generic cooking chatbot" into
  "assistant that knows *your* pantry" ("you've got yogurt — use that instead of
  buttermilk"). The substitution reasoning stays in the model's head; the *grounding*
  comes from this tool.
- **Cut from v1** (model knowledge, no tool needed): `explain_technique` (models are
  excellent at this), `suggest_substitution` (model knows substitutions; grounded by
  `check_pantry`), timing questions. A valid loop outcome is the model answering
  directly with *no* tool call.
- **Deferred:** curated `suggest_substitution` table (add later only if substitution
  quality visibly disappoints — reactively, with evidence). Unit conversion → issue #6
  (real need, but bigger than R3).

### Build checklist

1. `AIProvider`: add `supports_tool_calling` property + `complete_with_tools`.
   Implement for Anthropic (proxy) + Gemini; Ollama returns False.
2. `@tool` decorator + registry (the R5-shared foundation).
3. `check_pantry(ingredient)` tool (reads pantry via `SupabaseRepository`).
4. Hand-rolled ReAct loop with `max_iterations` cap → new `cooking_help_response`
   internals; graceful fallback to the existing single-shot path when
   `supports_tool_calling` is False.
5. Tests: loop with a tool call, loop with no tool call (direct answer), degraded-path
   fallback, `max_iterations` cap.

### Dependencies (resolved)

- **Blocks R5 (#189)** — R5 reuses this tool registry + ReAct base.
- **Independent of R4.**
- Provider parity handled by the capability gate; production-provider decision → **#202**.

---

## Original scoping stub (preserved for context)

> This is a scoping stub, not a finished design. It captures what R3 delivers, the
> foundation it must build, and the open questions to resolve before implementation.

Per CONTEXT.md, the Cooking sub-graph is "ReAct-style with tool access
(substitutions, techniques)". Initial tools named in `docs/plans/2026-04-29-active-work-items.md`:
`suggest_substitution`, `explain_technique`.

### The foundation this phase must build (load-bearing)

There is **no tool-calling / ReAct infrastructure in the codebase today** — confirmed
no `ToolNode`, `bind_tools`, or `create_react_agent` anywhere. The `tools/` directory
holds plain async functions (`expiry`, `normalizer`, `product_lookup`, `web_search`)
but none are bound to an LLM.

R3 is therefore where the **shared tool registry** gets built — the piece the docs
describe as: *"plain Python async functions callable from sub-graph nodes, API routes,
and LLM ToolNode (eliminates scan/chat duplication)."* This registry is the shared
dependency that **R5 (#189) also needs** — build it once here.

### Open questions (all resolved 2026-07-30 — see Resolved design above)

- LangGraph prebuilt (`create_react_agent`/`ToolNode`) vs. a hand-rolled loop? →
  **hand-rolled** (Decision 1).
- Tool-registry shape — decorator vs. explicit registration? → **decorator** (Decision 2).
- Which model tier runs the loop, and Gemini-vs-Ollama tool-calling parity? →
  **capability gate**; dev on Anthropic-via-proxy; production → #202 (Decision 3).
- Intent boundary — cooking help vs recipe-generate/general-chat? → **reuse
  `cooking_help`** (Decision 4).
- Tool scope for v1? → **`check_pantry` only** (Decision 5).

## Size

Medium. The value is the reusable foundation (registry + provider tool-calling + ReAct
loop); the one tool is small.
