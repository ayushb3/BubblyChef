# Autonomous agent loop — plan

**Date:** 2026-09-17
**Status:** Agreed (design grilled to an empty frontier with Ayush); not yet started
**Supersedes:** the merge-only-by-human policy in `WORKFLOW.md` §6 and the local
review-gate design in §7, once step 3 lands

## Goal

Take the human out of the loop for low-risk work. Agents pick up issues, implement,
**prove the change works by running the app**, get an independent review, and merge
on their own. Ayush stays the gate only where a mistake is expensive or hard to undo:
migrations, auth, prompts, CI, the agents' own hooks, and dependencies.

## Why the current setup can't get there

- **Merge requires `thermo-nuclear-review`, which only Ayush can run** — every merge
  waits on him by design (`.claude/hooks/pr-review-gate.sh`).
- **Review markers are honor-system.** They are files in `.git/` that anything can
  `touch`. Tolerable while a human merges; not once agents do.
- **More same-model reviewers don't fix the §6 objection** (the reviewer shares the
  author's blind spots). *Different evidence* does: tests proven to fail on the base
  commit, and actually clicking through the app. The bug §6 cites — a chat action
  posting to a route that didn't exist — would have been caught by using the feature,
  not by reading it.
- **Nothing makes an agent run the app.** `nextjs/e2e/` exists but isn't in CI
  (issue #352, *full Playwright regression suite* — never wired up; issue #345,
  *cook-confirm + receipt specs fail on a production server* — masked by dev mode).

## Research basis (summary)

Eight background research passes, weighted by source quality:

- **Anthropic's first best practice is giving the agent a way to verify** (tests,
  build, screenshots), and every unattended run needs a check that can stop it.
- **Scaling parallel agents depends on cheap verification.** High-parallelism
  practitioners (Boris Cherny, 5–15 agents) and deliberate single-agent practitioners
  (Mitchell Hashimoto, who invests in screenshot/test scripts and a mistakes file)
  converge on the same thing: build verification first, add agents after. Without it,
  users report 2–3 agents is the ceiling because a human reviews everything.
- **Scripted orchestration beats model-driven orchestration for repeatable loops.**
  Workflow scripts pause at usage limits and resume — a good fit for Max.
- **Agent file frontmatter enforces tiers** (`model`, `effort`, `isolation: worktree`),
  so delegation doesn't depend on prompting.
- **Verification gaming is documented** — checks must be run by CI, not self-reported.
- **Native Claude Code features have largely replaced third-party agent managers**;
  Conductor, the most-cited one, is macOS-only.

## Decisions

### Tiers — what needs Ayush

CODEOWNERS (Ayush) on:

| Path | Why |
|---|---|
| `supabase/migrations/` | Irreversible; rollback doesn't undo schema |
| Auth: `nextjs/src/middleware.ts`, `nextjs/src/lib/supabase/`, `nextjs/src/app/login/`, `nextjs/src/lib/response-helpers.ts`, `ai-service/bubbly_chef/api/auth.py` | Security boundary |
| `ai-service/bubbly_chef/prompts/` (new, see step 2) | Tests pass while quality silently degrades |
| `.github/` | CI and agent workflows are the gates |
| `.claude/hooks/`, `.claude/settings.json` | An agent that can edit its gates can remove them |
| `nextjs/package.json` + lockfile, `ai-service/pyproject.toml` | Dependency changes |

Everything else — including deterministic `ai-service/` code (parsers, helpers, unit
conversion, expiry math) — is **auto-mergeable** once required checks pass.

Tests that *call* prompts need no approval. Only edits to `prompts/` do.

### Identity

Agent PRs and commits come from a bot identity (the Claude GitHub App,
`claude[bot]`), not Ayush's account. This lets Ayush approve protected-path PRs
normally and keeps "agent did this" separate from "Ayush approved this."

### Required evidence

- **Fail-to-pass (F2P):** required for `bug` issues. CI runs the PR's new or changed
  tests against the base commit and requires at least one to fail there.
- **Features:** must add tests; no failing-first proof needed.
- **Docs/refactor exemption:** allowed only if the diff touches docs only, or a CI
  check confirms no behaviour change. Exemptions are checked mechanically, not
  self-declared.
- **Test-count guard:** CI fails if the number of tests drops or tests get skipped.
- **Verify:** clickthrough on a local production build, screenshots saved under
  `docs/media/`, covering the issue's flow plus adjacent flows.
- **Prompt PRs:** live intent tests run on PRs touching `prompts/` or `workflows/`
  and post results to the PR. Informational, not required (LLM output varies).

### The loop

Saved Workflow script, run locally in desktop-app sessions while it's new:

```
pick issue (ready-for-agent, by priority)
 → F2P test first (bugs)
 → implement            (Sonnet dev role, isolation: worktree)
 → verify               (prod build, per-worktree ports, shared test user, screenshots)
 → fresh-context review (scaled to the diff)
 → open PR              (bot identity)
 → GitHub decides       (required checks + CODEOWNERS → auto-merge or wait for Ayush)
```

- **Failure handling:** 2 attempts per failing stage, 3 rounds of review fixes. Then
  open a draft PR labelled `agent-blocked` with what was tried and where it stuck;
  move the issue back to `needs-triage`.
- **Ambiguity:** the implementing agent writes up its view; an **Opus decision agent**
  (medium/high effort, full context) decides and records the reasoning in the PR body.
  Exception: questions touching a protected area or changing product behaviour
  beyond the issue → both views plus a recommendation go to Ayush, issue labelled
  `needs-decision`, push notification.
- **Protected path discovered mid-run:** finish the work; CODEOWNERS makes the PR need
  Ayush; the PR body highlights the protected change at the top. Don't split.
- **Budget:** per-run caps (max turns per agent, capped fix loops) and at most
  **3 loop runs/day** to start, so interactive work keeps headroom. Raise once real
  run costs are known.
- **Lessons:** the loop *proposes* lessons in the PR body; the nightly job curates them
  into `docs/agents/lessons.md` (merge good ones, trim duplicates). The loop reads the
  file; interactive sessions don't. Not appended to `CLAUDE.md`.

### Review

- **Claude GitHub Action** reviews every PR on open — fresh context, sees only the
  diff and the issue. **Opus, medium effort** during shadow mode; revisit scaling
  (Sonnet for small auto-tier diffs) only if usage becomes a constraint.
- The Action also answers `@claude` mentions (useful from GitHub mobile). It only
  responds to accounts with write access.
- The local `pr-review-gate.sh` hook is **deleted**. GitHub is the gate.

### Trust ramp

**Shadow mode for the first 5 PRs:** the loop does everything and marks PRs "would
auto-merge"; Ayush clicks merge. Auto-merge turns on only after 5 consecutive correct
calls. One wrong call resets the count and gets investigated.

### Issue intake

- **During shadow mode:** only Ayush applies `ready-for-agent`.
- **After:** a nightly Opus triage job promotes `needs-triage` issues that are clear
  enough to `ready-for-agent`. It never promotes protected-tier work (those go to
  `ready-for-human`). Promotions appear in the digest; Ayush can remove the label.

### Notifications

Channels: **GitHub mobile** and the **Claude app**.

- **Push** only when something needs Ayush: `agent-blocked`, `needs-decision`, a
  protected-path PR waiting, or a failed post-merge smoke test. Silent for successful
  auto-merges.
- **Nightly digest:** a comment on a pinned "Agent digest" issue — what merged, what's
  blocked, what needs Ayush — with one push linking to it.

### Scheduled jobs

Digest, triage and lesson curation run as **GitHub Actions scheduled workflows** using
the Claude GitHub Action on the Max OAuth token — versioned in `.github/workflows/`
and CODEOWNERS-protected, not configured in a web UI.

### Kill switch

1. Set repo variable `AGENTS_ENABLED=false` (every agent workflow and the local loop
   script check it first) — stops new runs.
2. Turn off "Allow auto-merge" in repo settings — nothing already open can merge.

Both are doable from a phone in under a minute. Document in `docs/WORKFLOW.md`.

### Deployment safety

**Before merge:**
- (a) Vercel preview build becomes a **required** check.
- (b) CI builds the `ai-service` Docker image — Railway otherwise finds a broken
  Dockerfile only after merge.
- (c) CI boots the built image with production env-var *names* (dummy values) and hits
  `/health` — catches import-time crashes from `Settings`' `extra_forbidden`, the
  config-drift class in issue #407 (*`.env` pins gemini-2.5-flash, overriding the
  newer default* — still needs triage).

**After merge:**
- (e) Both services' `/health` report the deployed git SHA.
- (f) Post-merge smoke test waits until both SHAs match the merge, then runs against
  production. On failure, an agent opens a **revert PR that may auto-merge** (a pure
  revert is always safe) and sends a push.

**Cross-service changes:** API changes must be backward-compatible (add, don't rename
or remove); cleanup lands in a follow-up PR after both sides deploy. Reviewer-checked
now; mechanised by (d) later.

**Later:** (d) OpenAPI contract diff at step 8; (g) error tracking (e.g. Sentry) with
the dev/staging/prod work.

**Skipped:** canary releases, feature-flag platforms, blue-green. Revert PR plus
instant rollback on Vercel and Railway covers the same risk far more cheaply for a
one-person app.

### Smoke suite scope

Small and stable over broad: sign in, pantry loads, add and delete an item, recipes
page loads, `/health` on both services, plus **one AI round trip** that asserts only
"a response arrived, no error", never the content. Fix issue #345 while building it.
Issue #352's full regression suite stays deferred and separate. Issue #438
(*flaky chat deep-link test*) shows why stability comes first — a flaky smoke test
would revert good merges.

### Verify environment

- Local production build (`next build && next start`), per-worktree ports.
- Signs in as the existing shared `TEST_USERNAME` user (`e2e/global-setup.ts` already
  does this).
- **Known gap, deferred by Ayush:** local `.env` files point at the hosted Supabase
  project. Revisit with the dev/staging/prod session before runs are fully unattended
  or parallel (then: per-run guest users or a separate project).

### Skills and agents

- **PR #445** (*vendor /start-work, /self-review and their agents* — draft) is
  **closed**. Reuse the six review agents and the skeptic-pass design from
  `/self-review` inside the loop. `/start-work` is not carried over: it's a prompt
  convention that keeps the human in the loop and depends on laptop-only setup.
- **Prune by evidence:** an agent counts skill usage in past session transcripts and
  proposes a keep/archive list; Ayush makes the final call. Archived skills move to a
  folder Claude Code doesn't load (reversible).
- **Pin tiers in frontmatter:** `explorer` → Haiku; dev roles → Sonnet with
  `isolation: worktree`; reviewers and the decision agent → Opus.

## Build order

One PR per step unless noted. Steps 1–6 go through the normal human merge, since the
gates don't exist yet.

| # | Step | Who | Unblocks |
|---|---|---|---|
| 1 | Close PR #445. Skill-usage evidence → archive list (Ayush approves). Pin model tiers in agent frontmatter. | Agent, Ayush approves list | Lean, enforced roster |
| 2 | Move prompts into `ai-service/bubbly_chef/prompts/` (mechanical). | Agent, Ayush merges | Clean CODEOWNERS path |
| 3 | **Gates:** CODEOWNERS; F2P, test-count guard and exemption checks; deploy checks (a)(b)(c)(e); delete `pr-review-gate.sh`; rewrite `WORKFLOW.md` §6–7. | Agent; **Ayush applies branch protection** | Real, unforgeable gates |
| 4 | **Claude Action:** review on PR open, `@claude` mentions, `AGENTS_ENABLED` check. | **Ayush installs app + token first**, then agent | Independent review on every later PR |
| 5 | **Verify tooling:** `verify` skill, per-worktree ports, Playwright smoke suite, fix issue #345, `docs/agents/lessons.md`. | Agent | Evidence the loop can produce |
| 6 | **Loop Workflow script** + Opus decision agent + failure/budget handling. | Agent | The loop |
| 7 | **Pilot in shadow mode (5 PRs):** issue #405 first, then issue #406. Then add (f) post-merge smoke + auto-revert, nightly digest, lesson curation. | Loop; Ayush merges | Trust evidence |
| 8 | **After shadow:** enable auto-merge for real → nightly triage → parallel agents → (d) contract check → revisit cloud routines. | Ayush flips settings | Full autonomy |

**Pilot issues:**
- **Issue #405**, *pantry filter bar shown on an empty pantry* — frontend-only, visible
  immediately on an empty account, clean F2P component test, obvious before/after
  screenshots. Tests the loop, not the bug.
- **Issue #406**, *unchecking a scanned item doesn't update "Add N Items"* — a harder
  second run: possible data bug (unchecked items may still be added), needs a receipt
  upload, and runs into issue #345's receipt spec.

## Setup only Ayush can do

**Before step 4:**
1. Install the Claude GitHub App: run `/install-github-app` in a `claude` terminal.
2. Run `claude setup-token`; add the result as repo secret `CLAUDE_CODE_OAUTH_TOKEN`
   (the install flow may offer this).
3. Settings → General → enable **Allow auto-merge** (inert until gates exist).
4. Repo secrets for CI verify: `TEST_USERNAME`, `TEST_PASSWORD`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`; confirm the Gemini
   key used by the live tests is set.
5. Create repo variable `AGENTS_ENABLED=true`.

**After step 3 merges — branch protection on `main`:**
6. Add the new required checks (F2P, test-count guard, exemption, Vercel build,
   Docker build, startup check).
7. Enable **Require review from Code Owners**.
8. Enable **Do not allow bypassing the above settings**. This binds Ayush too;
   switch it off in an emergency.

Current state for reference (2026-09-17): repo is public; `main` requires the Next.js
and AI-service CI checks; 0 required reviews; admins not bound; auto-merge disabled;
no CODEOWNERS; one workflow (`.github/workflows/ci.yml`).

## Explicitly not covered

- **Dev/staging/prod separation** — deferred; planned as a learning session.
  Prerequisite for fully unattended or parallel verify runs.
- **Error tracking (g)** — with the above.
- **Cloud routines** — revisited at step 8; scheduled jobs use GitHub Actions until then.
- **Issue #352's full regression suite** — stays deferred; the smoke suite is separate.
- **Canary releases, feature flags, blue-green** — skipped (see Deployment safety).
- **Multi-model review** (a non-Claude reviewer) — not planned; the independence comes
  from different evidence (F2P against the base commit, clickthrough) and a
  fresh-context reviewer.
