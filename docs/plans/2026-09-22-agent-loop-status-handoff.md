# Agent loop — status handoff

**Date:** 2026-09-22
**Purpose:** hand the agent loop to a session that did not build it. Design rationale
lives in `docs/plans/2026-09-17-autonomous-agent-loop.md`; this is where it actually
stands and how to run it.

## What it is

`.claude/workflows/agent-loop.js` — a Workflow script that takes ONE `ready-for-agent`
GitHub issue to a reviewed PR, opened as the machine user **bubblychef-bot**:

```
Workflow({ scriptPath: "<checkout>/.claude/workflows/agent-loop.js", args: { issue: <n> } })
```

Stages: **Preflight** (an agent gathers facts, the script decides stop/go) → **Setup**
(branch off `origin/main`, in the session's own checkout) → **Plan** → **Decide** (Opus;
escalates protected paths and product-behaviour questions to Ayush) → **Reproduce**
(bugs: a fail-to-pass test plus before-screenshots) → **Implement + Verify** (max 2
attempts; Verify runs the real app via the `verify` skill) → **Review** (Opus, max 3 fix
rounds, then re-verify on the final commit) → **Ship** (PR labelled `agent-loop`) →
**Respond** (reads the GitHub Action review pinned to the final commit, fixes or disputes
each finding, max 2 rounds) → **Finish** (labels, optional auto-merge, returns the
checkout to its original branch).

Caps: `DAILY_CAP = 6` loop PRs per 24h; `SHADOW = true`.

## Guard rails — do not loosen without Ayush

- **Shadow mode: the loop never merges.** Auto-merge stays off until 5 clean shadow PRs.
  Tally: **1 of 5**.
- **Protected paths need Ayush's review**, enforced by `.github/CODEOWNERS`: migrations,
  `supabase/`, auth, `ai-service/bubbly_chef/prompts/`, `.github/`, `.claude/` config
  (settings, hooks, agents, workflows), `scripts/agent-gates/`, dependency manifests,
  `railway.json`, `Dockerfile`.
- **Any user-visible behaviour change beyond the issue forces "needs a human"**, even if
  the new behaviour is better.
- **Agent commits and PRs are bubblychef-bot, never ayushb3.** GitHub skips code-owner
  review when the author is the sole code owner, which is the whole reason the bot
  exists. Bot gh profile: `GH_CONFIG_DIR="$HOME/.config/gh-bubblychef-bot"`; never run
  `gh auth setup-git` under it. Its token expires around 2026-12-17.
- **Kill switch:** set the repo variable `AGENTS_ENABLED` to anything but `true`. That
  stops the loop's own preflight and the GitHub review workflow.

## Gates on every PR

- `.github/workflows/agent-gates.yml` — the loop-limit harness
  (`scripts/agent-gates/agent-loop-harness.cjs`, ~58 checks run against the real script),
  fail-to-pass (a bug fix's test must fail on the base commit), test-count guard,
  exemption check.
- `.github/workflows/claude-review.yml` — an independent Opus review from a fresh
  context, re-running on pushes to `agent-loop` PRs so the loop's fixes get re-reviewed.

## Pilot results

| PR | Issue | Outcome |
|---|---|---|
| PR #464 | issue #405 | Clean, merged. The one clean shadow PR so far. |
| PR #468 | issue #406 | Correct, but changed behaviour beyond the issue (medium-confidence scanned items need a tick). Ayush reviewed and merged. Not counted clean. |
| PR #471 | issue #402 | Blocked after 3 review fix rounds — stale evidence, and a mid-scan tab switch losing the scan result. Closed. |

Cost: roughly 20 minutes and 6–8M tokens processed for a small fix; the #402 attempt ran
37 minutes and 13.5M.

## Where it stands (2026-09-22)

- **Issue #402** (*Add-to-Pantry: switching Scan/Type tabs wipes typed input but the
  "ready to add" count survives*) is the next run. Two runs have been started and
  stopped before publishing anything.
- The **current decision is recorded on the issue** (comment of 2026-09-19): while a
  receipt scan is processing, the Type tab is not offered at all, which replaces the
  earlier "the scan keeps running and its result appears when you return". The same
  comment adds a hard prerequisite — the scan needs a client-side `AbortController`
  timeout in the same PR, or a hung Gemini scan locks the Type tab forever (see issue
  #396, *scan failures show raw error logs; receipt scan failing on Gemini vision
  timeout*).

## Two environment traps, both hit on 2026-09-22

1. **The agent registry is read once, at session start, and it resolves from the main
   checkout — not from a worktree.** The main checkout was parked on an old branch that
   predates `.claude/agents/loop-runner.md` and `explorer.md`, so every
   `agentType: 'loop-runner'` call failed instantly with "agent type not found". Copying
   the files back does not help the running session; the session has to be restarted.
   Keep the main checkout on a branch that has those agent files.
2. **CRLF line endings in the script break the launch.** On Windows the checked-out
   `agent-loop.js` has CRLF, and the permission layer rejects it: "script contains
   control characters that would be hidden in the approval dialog". Launch from an LF
   copy (`tr -d '\r'`) — same code, and worth diffing against the committed file so the
   run is provably the approved script.

## Still open

- Issue #467 — loop optimisations: production before-screenshots, and a Playwright helper.
- Post-merge production smoke with auto-revert, plus the nightly digest.
- Deploy checks: Docker build and startup.
- Scheduled triggers (cron or GitHub Actions). The loop is launched by hand today.
- Dev/staging/prod separation — deliberately deferred.
- Pilot follow-ups: issue #458 (sign-out spec AC2 fails), issue #465 (stale facets on an
  empty pantry), issue #470 (scan item identity).

## If you are picking this up

Do not launch the loop from two sessions at once — the daily cap and the shared checkout
are not coordinated between sessions.
