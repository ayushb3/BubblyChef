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

**Prefer the scripted loop.** `.claude/workflows/agent-loop.js` runs the same
lifecycle with fixed control flow: it adds a failing-test-first step for bugs, an
Opus decision agent for ambiguity, a running-app `verify` step, a fresh-context
review, and it acts as `bubblychef-bot` so its PRs are attributable. Run it with the
Workflow tool (`name: "agent-loop"`, `args: {issue: <n>}`).
Use this skill instead only when working an issue interactively with Ayush, and in
that case still open the PR as the bot (`WORKFLOW.md` §7, "The agent loop").
The loop still tiers PRs by the deleted `.github/CODEOWNERS` and assumes the
retired fail-to-pass CI job — issue #645.

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
- **The ticket needs something you cannot do** — credentials, a destructive
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

### 1.1 Feasibility check — before any delegation (WORKFLOW.md §5)

Before spawning a dev role, answer two questions from the issue body and its
comments. Either "yes" means **don't spawn**:

1. **Blocked?** Does the issue or a comment say "blocked by", "depends on", or
   "after #N", where #N is still open? Check with `gh issue view N --json state`.
   If so, pick the blocker if it's `ready-for-agent`, otherwise skip.
2. **Needs the human?** Can it only be finished by changing v1 scope or spending
   money? If so, comment the question, relabel `needs-info`, and skip. Any other
   open product question is yours: decide it, log the decision and the
   alternative in the sprint doc, and build.

If the change touches CI, the gates or agent config (`.github/`,
`.claude/{settings.json,hooks,agents,workflows}`, `scripts/agent-gates/`,
`scripts/merge/`), build it and name the PR in the sprint doc. A migration still
follows §3.1.

Record the outcome in one line when you report ("feasibility: clear" or which
question stopped it).

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

- If an issue spans two roles, delegate each slice to its owning role, one at a
  time, and keep the boundaries clean. It is still one PR: one per vertical
  feature, not one per slice.
- **One level of delegation only** (WORKFLOW.md §5). Dev roles do **not** spawn
  their own subagents. If a role reports the task is too big to do in one session,
  that's a signal the ticket was under-sliced — say so and stop; don't grow a
  second layer.
- Where there's a natural test seam, tell the dev role to use `/tdd`. Reviewing
  is `/code-review` (§7), run before the PR.

### 3.1 Database migrations: apply before merge

**If the work adds or changes a file under `supabase/migrations/`, the migration
must be applied to the hosted database before the PR merges.** `main`
auto-deploys to Vercel. If the PR merges first, the code goes live against a
schema that lacks the column, and every affected request fails until the SQL
runs. PR #293 hit exactly this ordering problem with
`00007_add_pantry_events.sql`, and PR #655 would have broken every recipe save.

Agent sessions can apply additive migrations themselves through the Supabase
CLI. Ayush asked for this on 2026-09-29 ("install supabase cli so you can
handle it going forward"), then installed the CLI and linked the project with
his own login. The CLI runs on that login token, so it needs no password.

**Push as late as possible.** Write the migration with the code, but apply it
only once gates are green and `/code-review` and the Claude review say
mergeable, then run `verify`. Verify usually needs the new schema, so the push
normally happens just before verify, after review. If anything after the push
asks for a schema change (a verify finding, or a later review round), step 6
applies: fix forward, never edit.

1. **Say so up front.** Put it in the PR title or the summary's first line, and
   add a **Migration** section to the PR body: the filename, what it does in two
   or three lines, and whether it is **additive** (new table, new nullable column,
   new index, or a function whose name doesn't exist yet) or **destructive**
   (drops, renames, type changes, data rewrites, new NOT NULL columns without a
   default, or `CREATE OR REPLACE` of an existing function, view or policy — with
   one shared database, replacing a body is a live behaviour change).
2. **Link the worktree** if it isn't linked yet:
   ```bash
   supabase link --project-ref obmbwuqwpvntxhhbdfsg < /dev/null
   ```
3. **Dry run**, and confirm that only your migration would be pushed:
   ```bash
   supabase db push --linked --dry-run
   ```
   If older migrations show up as pending, the history has drifted. Check each
   one's footprint with a read-only query before running
   `supabase migration repair --status applied <versions> --linked`. Never
   repair a migration you haven't confirmed is really in the database.
4. **Apply it, additive migrations only:**
   ```bash
   supabase db push --linked --yes
   ```
   Then confirm with `supabase migration list`, and with a read-only
   `supabase db query --linked -f check.sql` (a subcommand in CLI 2.118+), that
   the change exists. Record in the PR body's Migration section that it was
   applied, and when.
5. **Destructive migrations stay with the human.** Deleting or rewriting data is
   still a human call (ADR 0004). Don't push one. Put the SQL in the PR body, say
   what it would destroy, and wait.
6. **Never edit a migration that has been pushed.** Re-pushing the same version
   does nothing, so an edited file would silently drift from the live schema.
   If review wants a change after the push, add a new migration
   (`000NN_fix_...`) that makes it. If the PR is abandoned after the push, land
   the migration file itself on `main` in a one-file PR, so the repo describes
   the live schema. Reverting it instead (dropping what it added) is destructive,
   so that choice is the human's under step 5: propose it in the PR, don't push
   it. Either way, the migrations in `main` and the live schema must end up
   agreeing.

There is one database. Local development and the deployed app share it, so an
applied migration is live for both at once. That's why only additive changes are
applied from an agent session.

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

### 4.1 Pre-PR edge-case review (WORKFLOW.md §7)

Before opening the PR, **you** (the orchestrator, not the dev role) get a
**fresh-context Opus review** of the branch's diff. Run the `code-review` skill, or
spawn a reviewer with `model: opus` that has seen none of the implementation. The
dev role can't do this itself: `code-review` spawns two sub-agents, and dev roles
have no `Agent` tool. Send the findings back to the dev role to fix. Tell it to hunt edge cases, not style. The classes that cost
review rounds before: key casing, duplicates, cross-user data leaking through
caches, null or missing fields, and ordering. For every finding, fix the class,
then grep the diff for siblings of the same pattern before pushing.

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

Open it as **draft**. It stays draft until CI on it is green — see §6.
Creating the PR is not the end of the run.

## 6. Autonomy gate (WORKFLOW.md §6)

**Wait for CI before doing anything else.** Pushing and opening the PR takes
seconds; the checks take minutes. Do not end the run at `gh pr create` — poll
until the checks on the head commit have actually completed:

```bash
gh pr checks <n> --watch    # blocks until every check finishes
```

**Then mark it ready.** `claude-review.yml`'s review job requires `draft ==
false` — a draft PR is never reviewed, however green its checks are. Once checks
are green:

```bash
gh pr ready <n>
```

**Wait for the `claude[bot]` review** that going ready triggers, then read it in
full, inline comments included (§7 "Reading the review"). `needs changes`: fix
the findings, sweep for the same pattern elsewhere, push — a bot-authored PR
re-reviews on every push, so nothing extra is needed to get a fresh look.
`needs a human`: stop and report why.

Once the review says `looks mergeable` for the head — or for an earlier commit
where everything since only merged `main` in — **merge it yourself**; nothing
waits for the human. All three must hold:

- every required check is green;
- the latest `claude[bot]` review says `looks mergeable` for the head, or for an
  earlier commit where everything since only merged `main` in;
- for anything a user could see or trigger, `verify` passed on the final commit.

Merge with a real merge commit, one PR at a time: if `main` has moved, update the
branch, wait for CI again, then `gh pr merge <n> --merge`.

**A migration adds one condition to this.** If the diff touches
`supabase/migrations/`, the migration must already be applied to the hosted
database (§3.1 steps 3–4) before you merge. A destructive migration stays draft
and waits for the human however small or green it is (§3.1 step 5).

**If the run ends before it can merge** — the session is cut short, the watch
times out, the review hasn't landed — leave the PR as draft (or ready but still
awaiting review) and say so explicitly in the handoff: *"pending CI/review,
ready to merge when green."* A draft PR left silently behind green CI reads as
"the agent judged this needs a human", which is the opposite of what happened.

## Worked example (do not implement here)

Issue **#223** "Size adjectives stored as units (`2 medium avocado`) produce
spurious unit conflicts" — labelled `bug`, `backend`, `ready-for-agent`.

1. Pick: top of the `ready-for-agent` bug list, no open PR/branch for it.
2. Branch: `fix/issue-223-size-adjective-units` off `main`.
3. Delegate to **`backend`** — it's entirely in `ai-service/**` (the
   normalizer / cook-matcher unit handling).
4. Gates: `cd ai-service && pytest && ruff check bubbly_chef/`. No `nextjs`
   change, so `tsc` is not needed; `mypy --strict` skipped (not a gate).
5. Draft PR titled `fix: don't treat size adjectives as units (#223)`, body has
   `Fixes #223` on its own line.
6. Watch `gh pr checks --watch` until green, run `verify` since the fix is
   user-visible, then `gh pr ready` — that's what triggers the Claude review.
   Read it, fix or dispute any findings, then merge once it says `looks
   mergeable`. If the run ends first, the PR stays draft (or ready, pending
   review) and the handoff says "pending CI/review".
