---
name: implement-issue
description: "Pull the top issue off the ready-for-agent queue and take it to a draft PR: claim, branch, delegate to the backend/frontend/ui-ux roles, run the quality gates, open the PR with a closing keyword. Use for \"implement the next issue\", \"work the queue\", \"pick up a ticket\", \"what's next, build it\", or a named issue (\"implement #222\"). Not for triage, spec-writing, or ticket-slicing, which are /triage, /to-spec and /to-tickets."
---

# Implement an issue

Closes the gap between `/to-tickets`, which fills the queue, and a merged PR. The
upstream skills stop at the queue and assume a human hand-picks each ticket; this
does the pickup.

This skill runs in the **PM position**. It delegates implementation to dev-role
subagents and consumes their summaries. It does not write feature code itself.

## Before starting

Stop and say so if any of these is true:

- Working tree is dirty (`git status --porcelain` is non-empty). Never start on top
  of someone else's uncommitted work.
- The queue is empty. Report that; don't widen the filter to `needs-triage` or
  `needs-info` to find something to do. An untriaged issue is untriaged for a
  reason (`WORKFLOW.md` §2).
- The user named an issue that isn't `ready-for-agent`. Say what label it actually
  carries and ask. Don't relabel it yourself to unblock the skill.

## 1. Pick the issue

```bash
gh issue list --label ready-for-agent --state open --json number,title,labels --jq '.[] | "#\(.number) [\(.labels|map(.name)|join(","))] \(.title)"'
```

`--state open` is load-bearing. Closed issues keep their labels in this repo: as of
2026-08-30, #286 and #287 are both closed and both still carry `ready-for-agent`.
Omitting the filter hands you finished work.

**Ordering.** This repo has no priority label (no `P0`/`P1`/`priority:*` — check
`gh label list` before assuming otherwise). So "highest priority" is decided by this
rule, in order:

1. The issue the user named, if they named one.
2. `bug` before `enhancement` before `tech-debt`. A defect in shipped behaviour
   outranks new work.
3. Within a tier, **lowest issue number** — oldest first, so the queue drains
   instead of accumulating a stale tail.

Announce the pick and the reason in one line before doing anything else, so a wrong
pick is cheap to correct. If two issues tie and the choice is genuinely material,
ask rather than guess.

**Check it's still real** before committing to it: read the issue body, and look for
an existing open PR or branch (`gh pr list --search "<n>"`,
`git branch -a | grep issue-<n>`). Issues here sometimes describe work a
closed-stale PR already did once — #291 is explicitly that case. Prior art on a dead
branch is a gift; read it before rewriting it.

## 2. Claim it

```bash
gh issue comment <n> --body "Picking this up on branch feat/issue-<n>-<slug>."
```

Two sessions racing on one ticket is the failure this prevents, and it is not
hypothetical when implementation gets kicked to remote sessions.

## 3. Branch

```bash
git checkout main && git pull
git checkout -b feat/issue-<n>-<slug>
```

`feat/` for `enhancement`, `fix/` for `bug`, `feat/` for `tech-debt` unless it fixes
broken behaviour (`WORKFLOW.md` §4). Slug is two to four words from the title,
kebab-case.

## 4. Get context, delegated rather than read directly

The PM's context is the scarce resource (`WORKFLOW.md` §5). Do not read the
subsystem yourself. Send **one** `Explore` or dev-role subagent to answer: which
files change, what the existing patterns are, and what the prior art is if any.
Consume its summary.

Skip this only when the issue body already names the files and the change is
mechanical.

## 5. Delegate implementation

Route by ownership boundary (`.claude/agents/`, `docs/agents/roles/`):

| Scope | Role |
|---|---|
| `ai-service/` — routes, LangGraph, Pydantic models, services, migrations | `backend` |
| `nextjs/` — routing, `/api/*` CRUD, data fetching, client state, forms | `frontend` |
| `nextjs/src/components/` — design system, motion, a11y | `ui-ux` |
| Test suites, e2e, review against the DoD | `qa-reviewer` |

**One level of delegation, hard cap** (`WORKFLOW.md` §5). You spawn dev roles; dev
roles do not spawn subagents. Say so in the prompt you give them. If a role reports
its task is too big to do alone, that is a signal the ticket was sliced too coarsely
— stop and tell the user, don't let a second layer grow.

**Cross-boundary issues run in sequence, not in parallel** — backend first, then
frontend against the real API shape. #222 (piece-unit over-deduction) is labelled
both; the deduction logic settles first, or the frontend integrates against a
contract that then changes. Parallelise only genuinely independent slices.

Give each role: the issue number and acceptance criteria, the context summary from
step 4, its ownership boundary, and an instruction to write tests alongside.

## 6. Quality gates, before committing

```bash
cd ai-service && pytest tests/ -x -q && ruff check bubbly_chef/
```

```bash
cd nextjs && npx tsc --noEmit && npx eslint src/ --max-warnings=-1 && npm test -- --ci
```

These are exactly what CI enforces (`.github/workflows/ci.yml`). Run only the half
you touched. All must pass: a red gate is a stop, not a note in the PR body.

`eslint` is in this list and not in CLAUDE.md's summary. CI runs it, so it gates.

**`mypy --strict` is NOT a gate.** CLAUDE.md lists it, but it reports 73 known
errors, CI does not run it, and issue #128 tracks exactly that. Treat it as a
known-failing check: do not run it as pass/fail, and do not block on it. If you
changed types in `ai-service/` and want the signal, run it and compare the error
count against `main` — only a *new* error is worth raising, and it belongs in the PR
body, not in the gate.

## 7. Draft PR

Title: `<type>(<scope>): <what changed>`. Body:

```markdown
## Summary

Two to four sentences: the problem, and what now happens instead.

Fixes #<n>

## What lands

Bullets, grouped by the role boundary touched.

## Testing

Gate results, with actual numbers rather than "all green".

## Not covered

What a reviewer should not assume was verified.
```

Create it with `gh pr create --draft`. **Draft, always** — the human decides when
it's ready.

**The closing-keyword rules, verbatim from CLAUDE.md. This has regressed before:
#251 closed nothing because six issue numbers sat in prose.**

- One keyword per issue, each on **its own line**. `Fixes #239, #240` closes only
  #239; the second number is plain text.
- It must be in the **PR body**, not only in a commit message.
- A partial fix gets **no keyword**. Write `Related to #<n>` and comment on the
  issue saying what shipped and what remains. Closing it would lose the rest.

Verify after creating, rather than assuming:

```bash
gh pr view <pr> --json body --jq '.body' | grep -n "^\(Fixes\|Closes\|Resolves\) #"
```

Keep the body reviewable on a phone (`WORKFLOW.md` §6): no pasted diffs, stack
traces, or transcript. Link the CI run instead.

`gh pr create` fires the `thermo-nuclear-code-quality-review` PreToolUse hook
(`WORKFLOW.md` §7). Expect it, and resolve each finding in one line.

## 8. Autonomy gate: who merges

From `WORKFLOW.md` §6:

- **Sub-PR** — a scoped slice feeding a parent ticket, inside one role's boundary.
  May merge on green once a legible summary is on the PR. No human wait.
- **Feature-level PR** — closes a top-level ticket, or crosses more than one role's
  ownership boundary. **Stop and wait for the human.** Post the summary, say it's
  ready, leave it in draft.

Most things this skill picks up are feature-level, because a `ready-for-agent`
ticket is usually a top-level ticket. **When unsure, treat it as feature-level.**
Waiting costs a message; merging a wrong feature costs a revert.

When a merge is authorised, use a real merge commit (`gh pr merge --merge`), never
squash — `WORKFLOW.md` §4 depends on the individual commits surviving.

## Worked example: #291

`a11y: modals have no focus trap, and the app has no landmark structure`, labelled
`enhancement, frontend, ready-for-agent`.

1. **Pick.** Among the six open `ready-for-agent` issues on the day this was
   written, the `bug` tier holds #222 and #223, so one of those outranks it. If
   both were already taken, #291 is the lowest-numbered `enhancement`.
2. **Prior art.** The body says PR #150 built this once (`03fa196`, ~494 lines
   across 16 files) and was closed stale. Read that branch before writing anything.
3. **Branch.** `feat/issue-291-modal-focus-trap`.
4. **Route.** `useModalFocusTrap` and `role="dialog"` on the overlays live in
   `nextjs/src/components/` → **`ui-ux`**. The `<main>`/`<nav>` landmarks are page
   scaffolding → **`frontend`**. Two roles, so it is feature-level and waits for the
   human.
5. **Gates.** The `nextjs` half only. No `ai-service` change, so no pytest or ruff.
6. **PR.** Draft, with `Fixes #291` on its own line.

Do not also close #10: it was closed as a duplicate, and #291 is its home now.
