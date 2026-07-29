# Plan: Dev AI-provider routing + brainstorm follow-up fix + clickable recipe cards

**Date:** 2026-07-29
**Branch (suggested):** `feat/dev-anthropic-proxy-and-brainstorm-cards`

## Context

Three separate issues surfaced together while testing the chat flow against the
SAP proxy dev setup:

1. **Dev provider routing** — The terminal Claude Code session already runs
   through an SAP proxy at `http://localhost:6655/anthropic/` (Anthropic Messages
   API, no key needed for localhost). For dev testing we want the AI microservice
   to route its LLM calls through that same proxy instead of burning Gemini
   free-tier quota. Today `get_ai_manager()` only knows Gemini + Ollama.

2. **"Tell me more that" bug** — After a `recipe_brainstorm` reply, clicking the
   "Tell me more" chip (or typing a non-selection follow-up) gets caught by
   `detect_brainstorm_followup` and mangled: `extract_selected_recipe` either
   fuzzy-matches at a too-low `>50` threshold or falls through to
   `return user_text`, so the literal phrase *"Tell me more about that"* becomes
   the recipe title. Root cause: `recipe/nodes.py:288-292`.

3. **Clickable recipe cards** — Brainstorm options ("Cheesy Chicken Bites", …)
   render as plain bold markdown text inside one bubble. They should be tappable
   cards that select that recipe. The structured data already exists server-side
   (`brainstorm_ideas: list[str]` in `WorkflowState`, `shared_state.py:367`) — it
   just isn't surfaced in the response envelope.

Outcome: dev runs on the free proxy; conversational follow-ups after a brainstorm
behave correctly; brainstorm options are selectable cards.

---

## Part 1 — Anthropic/SAP-proxy provider (dev only)

**Decision (confirmed):** proxy-only when the flag is set (no Gemini/Ollama
fallback while active); no API key; default model `anthropic--claude-4.6-sonnet`.

### Files
- **New:** `ai-service/bubbly_chef/ai/anthropic.py` — `AnthropicProvider(AIProvider)`,
  modeled on `ai/gemini.py`. Speaks Anthropic Messages API:
  - `POST {base_url}/v1/messages`, headers `anthropic-version: 2023-06-01`
    (+ `x-api-key` only if a key is configured), JSON body
    `{model, max_tokens, temperature, system, messages:[{role:"user",content:[...]}]}`.
  - `complete()` — text + structured output. For structured output, reuse
    Gemini's approach: append the JSON-schema instruction to the prompt, then
    strip ``` ```json fences and `model_validate`. Raise `StructuredOutputError`
    / `ProviderUnavailableError` exactly as Gemini does so the manager's retry +
    cascade logic (`manager.py:99-160`) works unchanged.
  - `vision_complete()` — `supports_vision = True`; image goes as a content block
    `{"type":"image","source":{"type":"base64","media_type":mime,"data":b64}}`
    followed by a `{"type":"text","text":prompt}` block.
  - `stream_complete()` — SSE via `client.stream(...)`; parse
    `content_block_delta` events (`data:` lines, `delta.text`). Fall back to
    `complete()` on non-streaming errors, matching Gemini.
  - `is_available()` — cheap reachability check against the proxy; return True on
    200/429 for cascade parity.
- `ai-service/bubbly_chef/config.py` — add settings:
  - `anthropic_base_url: str = "http://localhost:6655/anthropic"`
  - `anthropic_api_key: str = ""`
  - `anthropic_model: str = "anthropic--claude-4.6-sonnet"`
  - `use_anthropic_proxy: bool = False`
- `ai-service/bubbly_chef/api/deps.py` — in `get_ai_manager()`: **if
  `settings.use_anthropic_proxy` is True, register ONLY `AnthropicProvider` and
  return** (skip Gemini/Ollama). Otherwise keep current behavior untouched.
- `ai-service/bubbly_chef/ai/__init__.py` — export `AnthropicProvider`.
- `.env.example` — document the four new `BUBBLY_*` vars under the AI Microservice
  section with a short "dev only" note.

### Notes
- max_tokens is required by the Anthropic API — set a sane default (e.g. 4096),
  optionally a `anthropic_max_tokens` setting.
- Do NOT commit `use_anthropic_proxy=true` anywhere except `.env` locally; default
  stays `False` so prod/CI are unaffected.

---

## Part 2 — Fix brainstorm follow-up misrouting

The bug is that *any* message after a brainstorm is treated as a recipe
selection. Fix in two spots:

- **`ai-service/bubbly_chef/workflows/recipe/nodes.py`**
  - `extract_selected_recipe()` (line 254): return `None` (not `user_text`) when
    nothing confidently matches, and raise the fuzzy threshold from `>50` to a
    stricter value (e.g. `>=80`, matching the catalog `lookup` convention noted in
    project memory). Change signature to `-> str | None`.
  - Add an explicit "informational follow-up" guard: if the user text matches
    phrases like *"tell me more", "more info", "explain", "what's in", "how do I
    make"* WITHOUT naming/ordinal-selecting a specific idea, do NOT treat it as a
    selection.
- **`ai-service/bubbly_chef/workflows/router.py`** (`detect_brainstorm_followup`
  branch, ~line 334-351): when `extract_selected_recipe` returns `None`, fall
  through to normal LLM intent classification (→ `cooking_help` / `general_chat`)
  instead of forcing `recipe_card` with a junk title. Same treatment for the
  session-mode path at lines 309-324.
- **Frontend chip:** `PostMessageChips` "Tell me more" (`onTellMore`) sends a
  canned message that triggers this. Once the backend guard is in, "Tell me more"
  will route to `cooking_help` and expand on the brainstorm — the intended
  behavior. No frontend change strictly required, but verify the canned text
  contains a clear "tell me more" phrase the guard recognizes.

### Tests
- `ai-service/tests/` — add cases to the router/recipe-node tests: after a
  brainstorm turn, inputs "tell me more about that" / "explain the first one" /
  "make the pasta one" route to cooking_help / recipe_card(first idea) /
  recipe_card(fuzzy pasta) respectively, and NEVER produce a recipe titled with
  the raw follow-up phrase.

---

## Part 3 — Clickable recipe option cards

Surface the already-computed `brainstorm_ideas` to the client and render them as
selectable cards.

### Backend
- **`ai-service/bubbly_chef/workflows/router.py`** — in the `else` branch that
  builds the brainstorm envelope (~line 950-960), attach the ideas:
  `envelope.metadata["brainstorm_ideas"] = final_state.get("brainstorm_ideas", [])`.
  Do the same in the streaming builder `_build_envelope_from_state` for parity.
  (Ideas are already extracted at `recipe/nodes.py:557,563`.)

### Frontend
- **`nextjs/src/types/chat.ts`** — `metadata` already exists on `ChatResponse`;
  read `metadata.brainstorm_ideas` as `string[]`. Optionally add a typed helper.
- **New:** `nextjs/src/components/chat/BrainstormOptions.tsx` — renders each idea
  as a Sanrio pill/card (reuse `Chip` or `ChatRecipeCard` styling), each calling
  `onSelect(ideaName)`.
- **`nextjs/src/app/chat/page.tsx`** — in `MessageRenderer`, add a branch: when
  `intent === 'recipe_brainstorm'` and `metadata.brainstorm_ideas?.length`,
  render the text bubble + `<BrainstormOptions ideas={...} onSelect={sendSelect}/>`.
  `onSelect(name)` sends `name` as the next chat message (reuses the existing send
  path; the backend's `extract_selected_recipe` fuzzy-matches it exactly → correct
  recipe card). Falls back to plain markdown if no ideas present (older messages).

> Next.js caveat (`nextjs/AGENTS.md`): this is a modified Next.js — check
> `node_modules/next/dist/docs/` before adding routes/APIs. This change is
> client-component only (no new route), so low risk, but frontend dev should
> confirm.

---

## Verification (end-to-end)

Run in the **primary checkout** (worktrees have no dev env):

1. **Proxy provider**
   - Set `BUBBLY_USE_ANTHROPIC_PROXY=true` in `ai-service/.env`.
   - `cd ai-service && uvicorn bubbly_chef.main:app --reload --port 8888`
   - `curl localhost:8888/health/ai` → provider list shows `anthropic/...` only.
   - Send a chat message; confirm logs show the anthropic provider handling it and
     no Gemini calls.
2. **Brainstorm follow-up**
   - Chat: "what can I make with my chicken breast?" → brainstorm list.
   - Click "Tell me more" → response EXPANDS on the ideas, no recipe titled
     "Tell me more about that".
   - "make the first one" / "the pasta one" → correct recipe card.
3. **Clickable cards**
   - Same brainstorm → options render as tappable cards; tapping one generates
     that recipe's card.
4. **Gates:** `cd ai-service && pytest && ruff check bubbly_chef/` and
   `cd nextjs && npx tsc --noEmit`. (`mypy --strict` is known-red, issue #128 —
   don't block on it, but keep the new provider type-clean.)

## Out of scope
- Prod provider changes (proxy is dev-only, default off).
- Reworking the intent classifier prompt beyond the follow-up guard.
- Persisting brainstorm selections / analytics.
