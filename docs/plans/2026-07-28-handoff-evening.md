# Session Handoff — 2026-07-28 (evening)

_State check after the user did a batch of merges + review from mobile. Supersedes the earlier `2026-07-28-handoff.md` (which was written mid-session, before the merges)._

---

## Headline: the UI-overhaul stack shipped to main

**PR #74 (`feat/ui-overhaul` → main) is MERGED** (`175435b`), and so is the Playwright e2e harness (#59, `b6dc4bf`). `main` head is **`b6dc4bf`**, **CI green**. `feat/ui-overhaul` is now fully merged into main (0 unmerged commits) — it's a historical branch now; **new work should branch off `main`.**

The entire design system + cook flow + expiry/loading work is now on main and (presumably) deploying to https://bubbly-chef.vercel.app + Railway.

## What merged (all confirmed on origin/main)

Onto `feat/ui-overhaul` then up to main via #74:
- **#136** tenacity dep · **#126** recipe generate/refine wiring + lint pins
- **#137** title-case ingredient/pantry names · **#141** yuzu accent → forest green · **#142** category palette tokens
- **#148** "expiry→cook loop, seed chat from tip card, kill post-login dead air" — this is the big one that closed **#135** (loading), **#138** (seeded cook flow), **#143** (tip card), plus must-use ingredient hints in recipe grounding, route-level `loading.tsx` + progressive hero paint, and an a11y pass (44px tap targets, focus rings, tip label).
- Earlier waves (W1–W4): tokens, motion, Chip, ThemePicker, ThemeProvider, page transitions, scroll stagger, chat mascot, recipe action cluster, book page-turn, hero thumbnails, cook-with-deduction (#40), etc.

Verified on `origin/main`: yuzu `--color-accent: #A8D5A2` / `#4A8C45`; 10 `--color-cat-*` tokens; pantry `CATEGORY_BG` remapped off expiry/status tokens; cook-tracking migration `00006` present.

## Tracker cleanup done this check

**#133, #131, #110 were closed manually** — they were fixed by #141/#142 but never auto-closed, because those PRs targeted `feat/ui-overhaul`, not the default branch. GitHub only auto-closes "Closes #X" on merge to the **default branch (main)**. **Lesson for next time: PRs stacked onto a feature branch won't auto-close their issues; close them by hand when the umbrella PR hits main, or point "Closes #X" at the branch that actually merges to main.**

## Open right now — needs attention

### PR #150 (OPEN) → **main**, MERGEABLE — the rest of the expiry loop
`claude/subagents-setup-workflows-73v98n` — "close the expiry loop: resolve actions, Use Soon triage, real focus ring." Closes **#140** (resolve actions), **#139** (Use Soon triage), **#147** (focus ring).
- Adds **migration `supabase/migrations/00007_add_pantry_events.sql`** — an append-only `pantry_events` table. **⚠️ This migration must be applied to prod Supabase when #150 merges** (same as #74 needed `00006` — verify `00006` was actually applied to prod, unknown from here).
- New: `POST /api/pantry/[id]/resolve`, `/pantry/use-soon` page, `ResolveActions` component, `.focus-ring` utilities applied app-wide. Ships tests (`resolve-actions`, `use-soon`, `pantry-resolve-route`, `focus-ring`, `deep-link-entrypoints`).
- Also carries the `docs/plans/2026-07-28-expiring-soon-loop.md` design doc.
- **Next step: review + merge #150, then apply migration 00007 to prod.** It's the natural continuation of the expiry work the user cares about.

### PR #124 (OPEN) → main — `docs: plan for gamification + the live kitchen`. Docs-only plan; review when the kitchen-hub epic (#67–#75, #39) gets prioritized.

## Open issues worth knowing (full list via `gh issue list`)

**New this session, still open — the expiry follow-ups & findings:**
- **#144** Recipe constraints dropped on the brainstorm follow-up turn (was BubblyChef-747 in CLAUDE.md).
- **#145** must-use ingredient extraction has no live test — the #138 chain can degrade silently.
- **#146** Product call: should "Cook this" appear on already-expired items? (copy currently incoherent) — **needs a user decision**, not just code.
- **#147** focus ring (being closed by #150).
- **#149** eslint: 8 pre-existing errors, mostly `react-hooks/set-state-in-effect`.
- **#139 / #140** — being closed by #150.

**Standing tech-debt / backlog:** #128 (mypy 73 strict errors, not in CI), #129 (ruff 0.16 rules, pinned around — note lint pins were added in `839334b`), #134 (video demos — process note), #106 (tappable recipe cards in chat), #10 (a11y), #43 (notification center — the proactive half of expiry), #42/#45/#46 (phase-3+ features), the kitchen-hub epic #67–#75 + #39 + #87.

## Dev environment

- **Frontend: port 3100** was used this session (3000 taken by the user's _ExperienceGeneration_ project). `cd nextjs && npm run dev -- -p 3100`. AI service: `cd ai-service && uvicorn bubbly_chef.main:app --reload --port 8888`.
- `ai-service/.env` `BUBBLY_CORS_ORIGINS` was locally edited to include `http://localhost:3100`; that file is **gitignored (secrets)**, so the change is local-only. To make 3100 durable, add it to `ai-service/.env.example` (committed). Login: `test@bubbly.local` / `password`.
- Any background servers from the prior session are not guaranteed alive; restart as needed.

## GitHub / gh
Repo is **`ayushb3/BubblyChef` (public)** on **github.com** — always `GH_HOST=github.com` (the machine's default gh host is github.tools.sap / SAP).

## Carried-forward facts (still true)
- **Next.js 16.2.2** (App Router, Turbopack), NOT 14. Read `node_modules/next/dist/docs/` before Next code (`nextjs/AGENTS.md`).
- **Zustand is NOT a dependency.** React hooks/context for client state; React Query for server state.
- `ruff` pinned (see `839334b`); `mypy --strict` has 73 errors, not in CI (#128).
- Quality gates: `cd ai-service && pytest && ruff check bubbly_chef/`; `cd nextjs && npx tsc --noEmit`. Full pytest needs `BUBBLY_RUN_LIVE_TESTS=0` (else live-provider tests fail on env, not code → 113 passed / 10 skipped with it off). Note jest tests now exist under `nextjs/src/__tests__/`.
- 5-theme system in `nextjs/src/app/globals.css` as `[data-theme="*"]`; signal tokens (`--color-fresh/expiring/expired`) are theme-invariant; category tints are the new `--color-cat-*` tokens.

## Suggested next steps
1. **Review + merge PR #150**, then **apply migration `00007` to prod Supabase** (and confirm `00006` from #74 was applied).
2. Answer the product question in **#146** (Cook-this on expired items) — blocks polishing that copy.
3. Consider **#145** (test the must-use chain) and **#144** (constraints dropped on follow-up) — both are silent-degradation risks in the recipe flow.
4. Housekeeping: `git worktree prune` + remove `.claude/worktrees/agent-*` (stale subagent worktrees from the prior session). Delete merged branches if desired.
5. `main` is the base for all new work now; `feat/ui-overhaul` is done.
