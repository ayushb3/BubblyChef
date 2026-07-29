# Session Handoff — 2026-07-28 (late / demos session)

_For the next session, written with clean context. Supersedes both earlier
2026-07-28 handoffs. This session ran demos of common flows, which surfaced two
real bugs (one already fixed, one filed with a recommended architecture)._

---

## TL;DR

- The **UI-overhaul stack (#74) is merged to main**; `main` head was `b6dc4bf`, CI green. `feat/ui-overhaul` is history — **branch all new work off `main`.**
- This session recorded **5 demo videos** of common flows and, in doing so, found and **fixed a mobile-blocking bug** (#152, PR #153) and **filed a context bug** (#155) with a recommended clean fix.
- **4 PRs open against main**, none merged this session. See table below.

## Dev environment

- **Frontend on port 3100** (3000 is taken by the user's _ExperienceGeneration_ project). `cd nextjs && npm run dev -- -p 3100`. AI service: `cd ai-service && uvicorn bubbly_chef.main:app --reload --port 8888` (was running as pid 59556 this session).
- `ai-service/.env` `BUBBLY_CORS_ORIGINS` locally includes `http://localhost:3100`; that file is **gitignored (secrets)** — local-only, not on any branch. Durable version would go in `ai-service/.env.example`.
- Login: `test@bubbly.local` / `password`.
- Both servers may still be running in the background; a fresh session starts its own.

## GitHub / gh
Repo is **`ayushb3/BubblyChef` (public)** on **github.com** — always `GH_HOST=github.com` (machine default host is github.tools.sap / SAP).

## Open PRs (all → main)

| PR | Branch | State | What | Action |
|---|---|---|---|---|
| **#150** | `claude/subagents-setup-workflows-73v98n` | MERGEABLE | Closes the expiry loop — resolve actions (#140), Use Soon triage (#139), focus ring (#147). **Adds migration `00007_add_pantry_events.sql`.** | Review + merge, then **apply migration 00007 to prod Supabase**. |
| **#153** | `fix/issue-152-modal-zindex-above-nav` | (new) | **The z-index fix — modals were covered by the bottom nav on mobile.** Closes #152. Raises 6 modal overlays to `z-[60]`. | Merge — it's a mobile-blocking fix, low risk. |
| **#154** | `docs/demos-common-flows` | MERGEABLE | The 5 demo videos in `demos/`. | See "demo caveat" below before merging. |
| **#151** | `docs/handoff-2026-07-28-evening` | UNKNOWN | The previous (evening) handoff doc. | Superseded by THIS doc — consider closing #151 without merge, or merge whichever handoff you prefer to keep. |
| **#124** | `claude/project-status-gamification-cpn7rg` | UNKNOWN | Gamification + live-kitchen plan (docs). | Review when the kitchen-hub epic (#67–#75, #39) is prioritized. |

_(A `docs/handoff-2026-07-28-demos` branch carries THIS doc — open its PR or merge as you like.)_

## The demos (PR #154) and what they proved

Recorded on mobile viewport (430×932) against live Supabase via `playwright-cli`, in `demos/` (~3.8 MB, `.webm`):
- `01-auth-dashboard` — login → dashboard with real data ✅
- `02-cook-chat-handoff` — recipe → Cook → modal → Confirm → chat "COOKING NOW" card. **⚠️ see caveat.**
- `03-recipe-library` — search, page-turn, favourite ✅
- `04-pantry-tip-chat` — pantry + category tints, tip card → seeded chat (Bubbles auto-explains the tip) ✅ (this is the #143/#148 feature working)
- `05-theme-switch` — all 5 palettes incl. the retuned yuzu forest-green ✅

**Demo caveat (`02`):** the cook→chat handoff *routes* correctly and the "COOKING NOW" card renders, but the chat is **not actually recipe-aware** due to bug #155 (below). So `02` demonstrates the routing, not working context. Options for the next session: re-record `02` after #155 is fixed, or add a note to `demos/README.md` on the #154 branch. Don't present `02` as proof the context works.

## Bugs found this session

### #152 — CookModal buttons covered by bottom nav on mobile — FIXED (PR #153)
Modal overlay and `BottomNav` both `z-50`; equal z-index + DOM order (nav renders after `{children}` in `layout.tsx`) meant the nav painted over the modal's bottom-anchored Confirm/Cancel. On mobile, tapping Confirm hit the "Chat" nav tab — **you could not confirm a cook.** Verified via `document.elementFromPoint()`. Fixed all 6 modals (CookModal, AddItemModal, PantryAddSheet, RecipeEditModal, RecipeImportModal, RecipeRefinementModal — the last was `z-40`, even worse) → `z-[60]`. Convention established: nav=50, modals=60.

### #155 — cook→chat handoff can land with NO recipe context — FILED (recommended fix included)
The plumbing is correct end-to-end (frontend builds `{cooking_recipe}`, sends on first message; `router.py:559-571` pins the session). **But `cookingContext` is null until an async `fetchRecipe` resolves**, and the quick-prompt chips/Send are tappable before then. Send first message before the fetch wins → no context → and it's one-shot (`contextSentRef`) so *every* later turn is context-free too. The card is cosmetic and hides the failure. Also a silent fetch-fail mode.

**Recommended fix (in the issue): resolve the recipe server-side from the id.** The id is already in the URL (`/chat?cooking=<id>`), and `run_chat_workflow` already has `user_id` + a `SupabaseRepository`. Send only `{cooking_recipe_id}` (known synchronously — no fetch race), and have the backend call `repo.get_recipe(user_id, recipe_id)` (confirmed to exist at `supabase_repo.py:294`, returns `RecipeCard | None`) before pinning. Keep accepting the legacy full dict for non-breaking rollout. `fetchRecipe` stays only to render the card. This kills the race by construction. Fallback: gate the first send on context readiness.

## Open issues worth knowing (full list via `gh issue list`)

**Cook/chat correctness (silent-degradation risks):**
- **#155** cook→chat context race (above).
- **#144** recipe constraints dropped on brainstorm follow-up turn (was BubblyChef-747).
- **#145** must-use ingredient extraction has no live test — the #138 chain can degrade silently.

**Expiry loop (mostly in PR #150):** #139, #140 (in #150); #146 needs a **product decision** — should "Cook this" show on already-expired items? copy is incoherent.

**A11y / lint:** #147 focus ring (in #150), #149 (8 eslint errors, react-hooks/set-state-in-effect), #10 (ARIA/keyboard).

**Tech debt:** #128 (mypy 73 strict errors, not in CI), #129 (ruff 0.16 rules, pinned around — lint pins were added on the branch).

**Backlog / phases:** #106 (tappable recipe cards in chat), #87 (ScrollFadeIn), #43 (notification center = proactive expiry half), #42/#45/#46, kitchen-hub epic #67–#75 + #39.

## Carried-forward facts (still true)
- **Next.js 16.2.2** (App Router, Turbopack), NOT 14. Read `node_modules/next/dist/docs/` before Next code (`nextjs/AGENTS.md`).
- **Zustand is NOT a dependency.** React hooks/context for client state; React Query for server state.
- `ruff` pinned `<0.16`; `mypy --strict` has 73 errors, not in CI (#128).
- Quality gates: `cd ai-service && pytest && ruff check bubbly_chef/`; `cd nextjs && npx tsc --noEmit`. Full pytest needs `BUBBLY_RUN_LIVE_TESTS=0` or live-provider tests fail on env (→ 113 passed / 10 skipped). Jest tests live under `nextjs/src/__tests__/`. **Note: `npx tsc` reports 5 pre-existing errors in `e2e/*` + `playwright.config.ts` (missing `@playwright/test` types, from the #59 harness) — those are NOT from your changes; filter them out.**
- 5-theme system in `globals.css` (`[data-theme="*"]`); signal tokens theme-invariant; category tints are `--color-cat-*`.
- **playwright-cli quirk:** `run-code` return values sometimes don't surface as `### Result` when a large/animated modal is open — screenshots are the reliable signal in that case. Sessions: `playwright-cli -s=demo ...`; must `open` first; `run-code` takes `async (page) => {}`.

## Suggested next steps
1. **Merge PR #153** (z-index fix — mobile-blocking, low risk).
2. **Review + merge PR #150**, then **apply migration `00007` to prod Supabase** (and confirm `00006` from #74 was applied).
3. **Fix #155** with the server-side recipe-resolution approach (recommended in the issue) — then re-record demo `02` and update PR #154 (or annotate `demos/README.md`).
4. Decide **#146** (Cook-this on expired items) — product call.
5. Housekeeping: `git worktree prune` + remove `.claude/worktrees/agent-*` (stale subagent worktrees).
6. Close/merge whichever handoff PR you want to keep (#151 vs this one).
