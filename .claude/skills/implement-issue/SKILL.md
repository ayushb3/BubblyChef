---
name: implement-issue
description: Pick up and implement the next ready-for-agent GitHub issue end to end — choose the highest-priority ready-for-agent ticket, branch, delegate the coding to the right dev role, run the quality gates, and open a draft PR that closes the issue. Use when asked to "work the next issue", "pick up a ticket", "implement the ready-for-agent queue", "grab an issue and build it", or "start on the backlog".
---

# Implement an issue

Close one `ready-for-agent` GitHub issue, from queue pickup to draft PR. This
skill **codifies the workflow already written in `WORKFLOW.md`** (§2 lifecycle,
§4 branch/PR, §5 team shape, §6 autonomy gate) and `CLAUDE.md` — it does not
invent new process. When this skill and those docs disagree, the docs win; fix
the skill.

Do exactly one issue per invocation. If asked to "clear the queue", run this
skill once per issue, not as a batch.

## Run budget — check as you go, not at the end

Unattended, the failure mode is a run that never admits it's stuck. Stop and take
the give-up path below when any of these trips:

- **The same quality gate fails three times running.** Three failures on one gate
  means the diagnosis is wrong, and a fourth attempt is a guess. This is the
  common runaway.
- **More than eight delegation round trips**, counting every subagent spawned. A
  well-sliced ticket takes two or three. Eight means the ticket was under-sliced
  or the approach is wrong.
- **More than roughly an hour of wall clock**, or your context filling with tool
  output rather than orchestration decisions (§5 PM hygiene).
- **The ticket needs something you cannot do** — credentials, a production
  migration (see §3.1), or a judgment call the issue doesn't settle.

These are ceilings, not targets. Most tickets finish well under all of them.
Waiting on CI in §6 does not count against the wall clock.

### The give-up path

Quitting cleanly is a good outcome. A half-implemented ticket that silently
consumed a budget is not. In order:

1. Commit and **push the branch anyway**, even broken. Never delete it — the next
   run should start from what you learned, not from zero.
2. Comment on the issue: what you tried, where it stopped, what you'd need to
   continue. Specific enough to be a head start.
3. Unassign yourself, and relabel `needs-info` if the blocker is the ticket rather
   than the code.
4. Report to the human, naming the ceiling you hit.

Do **not** open a PR for abandoned work. A draft PR is a claim that something is
ready to look at — that's what §6 uses drafts for, and a stuck run must not look
like a run waiting on review.

## 1. Pick the issue

Pull the queue and take the **highest-priority open `ready-for-agent`** issue:

```bash
gh issue list --label ready-for-agent --state open \
  --json number,title,labels,createdAt --limit 50
```

Selection rules:
- **Only `ready-for-agent`.** Never start an issue labelled `needs-triage` or
  `needs-info` — "not ready" means not ready even if it looks tractable
  (WORKFLOW.md §2/§3). If nothing is `ready-for-agent`, stop and say so; do not
  reach into other labels.
- **Priority.** If the repo uses `priority:*` / `type:*` labels, honour them
  (highest priority first; bug over enhancement on a tie). Otherwise fall back to
  oldest `createdAt` (FIFO).
- **Skip work already in flight.** If an open PR or a `feat/issue-<n>-*` /
  `fix/issue-<n>-*` branch already references the issue, it's taken — pick the
  next one. Check with:
  ```bash
  gh pr list --state open --search "issue-<n>" --json number,headRefName
  git branch -a --list "*issue-<n>-*"
  ```

Read the chosen issue in full before touching code:

```bash
gh issue view <n> --comments
```

If the acceptance criteria are actually unclear once you read it, it was
mislabelled — comment saying why, relabel `needs-info`, and pick the next issue
instead of guessing.

## 2. Branch

Off the current default branch (`main`), per WORKFLOW.md §4:

```bash
git checkout main && git pull
git checkout -b feat/issue-<n>-<slug>   # or fix/issue-<n>-<slug> for a bug
```

`<slug>` is a short kebab-case summary of the issue title. Use `fix/` when the
issue is labelled `bug`, `feat/` otherwise.

**Keep the branch current by rebasing, not merging.** If `main` moves while you
work, `git fetch origin && git rebase origin/main` — do **not** `git merge main`
into the feature branch. WORKFLOW.md §4 merges PRs with real merge commits *at the
PR boundary*; a merge commit *inside* the feature branch pollutes its history and
defeats the linear-archaeology the `why` skill depends on.

## 3. Get context, then delegate

**You are the PM here — you orchestrate, you do not write the feature code
yourself.** Get just enough context to route, then hand the coding to the right
dev role as a subagent (Agent tool). Guard your own context (§5 PM hygiene): read
the ticket and role files, delegate exploration and diffs.

Route by ownership boundary (`.claude/agents/` + `docs/agents/roles/`):

| Issue touches | Delegate to |
|---|---|
| `ai-service/**` — FastAPI, LangGraph, AI providers, repository, domain | `backend` |
| `nextjs/src/app/**`, `/api/*` routes, data/state wiring | `frontend` |
| `nextjs/src/components/**`, design system, motion, a11y | `ui-ux` |
| Tests / e2e / DoD review | `qa-reviewer` |

- If an issue spans two roles, it's a **feature-level** change (see §6) — delegate
  each slice to its owning role, one at a time, and keep the boundaries clean.
- **One level of delegation only** (WORKFLOW.md §5). Dev roles do **not** spawn
  their own subagents. If a role reports the task is too big to do in one session,
  that's a signal the ticket was under-sliced — say so and stop; don't grow a
  second layer.
- Where there's a natural test seam, tell the dev role to use `/tdd`. Reviewing
  is `/code-review` (§7), run before the PR.

### 3.1 Hard stop: database migrations

**If the work adds or changes a file under `supabase/migrations/`, this PR cannot
merge from an agent session under any circumstance — including a sub-PR that §6
would otherwise let you mark ready and merge on green.**

Applying a migration needs a Postgres password or a Supabase personal access
token. An agent session has neither: `ai-service/.env` carries PostgREST API keys,
and PostgREST has no arbitrary-SQL endpoint. So the migration cannot be applied,
and therefore cannot be verified. Meanwhile `main` auto-deploys to Vercel —
merging first puts code live against a schema that lacks the table, and every
affected request 500s until a human runs the SQL.

This is not hypothetical. PR #293 hit exactly this ordering problem with
`00007_add_pantry_events.sql`.

When a migration is in scope:

1. Write it, and say so in the PR title or the first line of the summary.
2. Add a **Migration** section to the PR body: filename, what it does in two or
   three lines, and whether it is additive or destructive.
3. Treat the PR as feature-level regardless of how many role boundaries it
   touches.
4. Tell the human it needs applying **before** merge, and give both routes — the
   Supabase dashboard SQL Editor, or `supabase db push`.
5. Do not merge. Do not `gh pr ready`. Wait.

You can check whether a table already exists without any of the missing
credentials, which is worth doing before assuming the work is needed:

```bash
curl -s -o /dev/null -w "%{http_code}" \
  "$BUBBLY_SUPABASE_URL/rest/v1/<table>?select=id&limit=1" \
  -H "apikey: $BUBBLY_SUPABASE_SECRET_KEY" \
  -H "Authorization: Bearer $BUBBLY_SUPABASE_SECRET_KEY"
```

`200` means it exists; `404` with `PGRST205` means it does not. Read-only.

## 4. Quality gates (before any commit)

Run these from `CLAUDE.md`. All must pass:

```bash
cd ai-service && pytest && ruff check bubbly_chef/
cd nextjs && npx tsc --noEmit
```

**`mypy --strict` is NOT a gate.** It reports 73 known errors and is not run by
CI (issue #128). Run it only if the issue is specifically about clearing mypy
errors; otherwise skip it — do not block the PR on it.

Only run the gates relevant to what changed (a `nextjs`-only change doesn't need
`pytest`), but never skip a gate that covers touched code. If a gate fails, the
issue is **not** done — keep the dev role on it; do not open the PR.

## 5. Open a draft PR

```bash
git push -u origin <branch>
gh pr create --draft --title "<type>: <summary> (#<n>)" --body "$(cat <<'BODY'
## Summary
<one-paragraph what-and-why>

## What lands
- <bullet per meaningful change>

## Tests
- <gates run + result: pytest / ruff / tsc>

## Linked
Fixes #<n>

## Out of scope
- <anything deliberately deferred, or "none">
BODY
)"
```

PR body rules (`CLAUDE.md` is emphatic — #251 regressed by burying issue numbers
in prose):
- **`Fixes #<n>` on its own line**, in the PR body (not the commit, not prose).
  One keyword per issue — `Fixes #1, #2` only closes #1. Use `Closes`/`Resolves`
  interchangeably.
- **Partial fix?** Use `Related to #<n>` (no closing keyword) and say in the body
  what shipped and what remains — closing it would lose the rest.
- Sections: Summary / What lands / Tests / Linked / Out of scope. **No**
  `Reviewers` section, **no** internal tracker IDs.
- Keep it reviewable on a phone (§6): no pasted logs, diffs, or transcripts —
  link the CI run and artifacts instead.

Open it as **draft**. It stays draft until you have *watched CI finish* — see §6.
Creating the PR is not the end of the run.

## 6. Autonomy gate (WORKFLOW.md §6)

**Wait for CI before deciding anything.** Pushing and opening the PR takes
seconds; the checks take minutes. Do not end the run at `gh pr create` — poll
until the checks on the head commit have actually completed:

```bash
gh pr checks <n> --watch    # blocks until every check finishes
```

Then:

- **Sub-PR** (a scoped slice of a larger parent ticket, one role's ownership):
  CI green + a legible summary on the PR → `gh pr ready <n>`, and it may merge
  autonomously. No human wait.
- **Feature-level / large PR** (closes a top-level spec ticket, or crosses more
  than one role's ownership boundary): leave it as **draft**, post the summary,
  and **stop for the human**. Do not merge.
- **CI red, either bucket:** it is not done. Back to §3 with the failure; fix and
  push. Never mark ready on red.

When unsure which bucket an issue is in, treat it as feature-level and wait.

**A migration overrides all three bullets.** If the diff touches
`supabase/migrations/`, it stays draft and waits for the human however small,
single-boundary or green it is. See §3.1.

**If the run ends before CI finishes** — the session is cut short, the watch
times out — leave the PR as draft and say so explicitly in the handoff: *"draft
pending CI, sub-PR, ready to flip when green."* A draft PR left silently behind
green CI reads as "the agent judged this needs a human", which is the opposite of
what happened. Only the deliberate cases above — feature-level, CI red, and a
migration — may leave a PR in draft on purpose.

## Worked example (do not implement here)

Issue **#223** "Size adjectives stored as units (`2 medium avocado`) produce
spurious unit conflicts" — labelled `bug`, `backend`, `ready-for-agent`.

1. Pick: top of the `ready-for-agent` bug list, no open PR/branch for it.
2. Branch: `fix/issue-223-size-adjective-units` off `main`.
3. Delegate to **`backend`** — it's entirely in `ai-service/**` (the
   normalizer / cook-matcher unit handling). Single role → not feature-level.
4. Gates: `cd ai-service && pytest && ruff check bubbly_chef/`. No `nextjs`
   change, so `tsc` is not needed; `mypy --strict` skipped (not a gate).
5. Draft PR titled `fix: don't treat size adjectives as units (#223)`, body has
   `Fixes #223` on its own line.
6. Single role, bounded bug → this is a **sub-PR**: watch `gh pr checks --watch`,
   then `gh pr ready` + auto-merge on green. If the run ends first, the PR stays
   draft and the handoff says "pending CI".
