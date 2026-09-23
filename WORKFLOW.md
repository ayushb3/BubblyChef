# Workflow — Doc of Record

This is the complete, standalone description of how this project runs agent-driven
work. It should be followable cold, without any other context. Project-specific
details (roles, stack, label renames) live in `CLAUDE.md` and `docs/agents/`; this
file describes the *process*, which is the same across every project that vendors
this template.

If this file and a project's `CLAUDE.md` disagree, `CLAUDE.md` wins for anything
project-specific (stack, file paths); this file wins for anything about the process
itself (lifecycle, gates, review layers).

For BubblyChef's own operational quick-reference (recovery commands, common
failure patterns, memory usage) see `docs/WORKFLOW.md` — that doc is project-scoped
and complements this one rather than duplicating it.

---

## 1. System of record

**GitHub Issues + PRs, full stop.** No secondary tracker (no beads/`bd`, no ad hoc
TODO files as the source of truth). This is deliberate: it needs to work identically
from a laptop or a phone browser, without a CLI or a locally-synced database.

Working notes, plans, and design docs still live in the repo (`docs/plans/`,
`docs/DECISIONS.md`, etc.) — those are detail that issues link to, not a competing
tracker.

## 2. Issue lifecycle

Every issue carries exactly one of these five labels, applied by the `triage` skill
(or by hand):

| Label | Meaning | Applied when |
|---|---|---|
| `needs-triage` | Not yet evaluated | New issue arrives |
| `needs-info` | Waiting on the reporter | Description is incomplete |
| `ready-for-agent` | Fully specified, agent can pick it up | Clear acceptance criteria, no blockers |
| `ready-for-human` | Needs a judgment call | Outside agent scope |
| `wontfix` | Declined | Out of scope |

`ready-for-agent` is the queue the agent team actually pulls from. See
`docs/agents/triage-labels.md` for the canonical mapping and any project-specific
category labels layered on top (type/priority).

## 3. Planning pipeline

Four entry points depending on how shaped the work already is:

1. **Loose idea, size unknown** → `/wayfinder`. Charts a map of decision tickets
   before anything is built — use this when you don't yet know the shape of the
   work.
2. **Idea already shaped by a conversation** (including an offline research/spec
   session) → `/to-spec`. Synthesizes straight to a spec issue, no interview needed.
3. **Spec exists** → `/to-tickets`. Slices the spec into vertical, agent-sized child
   issues — each one small enough for a single agent session to close.
4. **Any ticket, any time** → `/triage`. Moves it through the label state machine
   above.

Only `ready-for-agent` tickets are picked up for implementation. If a ticket sits in
`needs-triage` or `needs-info`, it isn't ready — the agent team should not start work
on it, even if it looks tractable.

## 4. Branch / PR convention

```
feat/issue-<n>-<slug>
fix/issue-<n>-<slug>
```

Every branch traces back to an issue number. Merge with **real merge commits** (not
squash, not rebase-merge) — this preserves the individual commit history for later
archaeology (the `why` skill depends on this).

BubblyChef's remote has legacy branches under other naming schemes (hash-suffixed,
`ui-wN-*`) — don't bulk-rename them. Just use the convention above for everything
new; retire old branches naturally as they come up for merge or cleanup.

### The PR body carries the review

Write every PR body on the assumption that **it is the only thing the reviewer
reads.** That is the real review surface here — the issue and the PR body get read;
the diff usually does not. A body that says "implements #123" pushes the entire
review onto a step that will not happen, and the change lands unexamined.

So the body must let someone approve or reject **without opening the diff**:

- **What changed, in plain language** — behaviour, not file names. "Approving a
  pantry proposal now writes to the pantry" beats "updated `useChat.ts`".
- **Evidence it works.** For anything visual, attach before/after screenshots or a
  short clip — drive the app and capture it; Chromium and Playwright are available
  in cloud sessions, so "I couldn't run it" is rarely true. For anything else, name
  the tests that cover it and show the relevant output.
- **What you verified, and how.** Distinguish "tests pass" from "I reproduced the
  original bug and watched it stop happening" — only the second is evidence the
  bug is fixed.
- **What this does *not* cover.** Known gaps, deferred cases, anything you chose
  not to handle. A reviewer who cannot see the diff cannot infer the edges, and
  an unstated gap reads as a claim it was handled.
- **The closing keyword** per the linking rules in `CLAUDE.md` — one per issue,
  each on its own line.

Screenshots are not decoration; for a UI change they are the review. A reviewer
glancing at a before/after pair catches a broken layout instantly and would never
have caught it in a diff.

## 5. Agent team shape

Every project gets a `pm` role (the human) plus 2–5 domain-specific dev roles. The
**file format is shared**; the **role list is per-project** — see
`docs/agents/roles/_role-template.md` for how to write a new one and
`docs/agents/roles/pm.md` for the PM role file itself. BubblyChef's team:
`pm`, `backend`, `frontend`, `ui-ux`, `qa-reviewer` — see `docs/agents/roles/`.

**Model tiers are pinned in each agent's frontmatter** (`.claude/agents/*.md`), not
left to the orchestrator's judgement: `pm` runs on Opus, the dev roles (`backend`,
`frontend`, `ui-ux`, `qa-reviewer`) on Sonnet.

**Isolation belongs to the session, not the role.** Subagent `isolation: worktree`
branches from the *default branch*, not the parent session's HEAD — so a dev role
delegated on a feature branch would not see the branch it is supposed to build on
(including a failing test written moments earlier). Parallel work is therefore
isolated one level up: one worktree per issue/session, with dev roles working inside
it.

**Utility agents** sit beside the roles. They own no files, have no role file, and
are invoked as tools: `explorer` (Haiku, low effort, Read/Grep/Glob only) answers
"where is X" and "how is Y wired" so no one spends an implementer on searching.
`loop-runner` (Bash/Read/Grep/Glob only) runs the agent loop's plumbing stages;
untyped agents load every tool the session has, about 40k tokens before doing
anything, which was the largest cost in the first full loop run. They
are leaves, so they don't count against the one-level cap below. See
`docs/plans/2026-09-17-autonomous-agent-loop.md` for the tiering rationale.

Role files are **committed to the repo, never gitignored.** A workflow that
disappears on a fresh clone doesn't survive switching machines — that's the whole
point of writing it down.

Each role file states, at minimum:
- What it owns (files/directories it may write to)
- What it may read but not write
- Its stack/domain context
- Any project-specific conventions it must follow

### Orchestration depth: one level, hard cap

The human drives the `pm` role directly (in-thread, no wrapper); `pm` spawns dev
roles as subagents; **dev roles do not spawn further subagents.** Two levels total
— human → PM → dev role — never three.

This is a hard constraint, not a style preference, for two reasons:

- **Cost.** If the PM session runs on an expensive model (this template is written
  with an eye toward using Fable as PM), every extra layer of nested delegation
  multiplies that model's token spend across a whole subtree instead of confining
  it to leaf-level cheaper agents.
- **Legibility.** A human supervising asynchronously can reconstruct "who did what"
  from PM → dev-role → result. Human → PM → dev-role → sub-dev-role → result is not
  something a person reviewing from a phone can audit at a glance.

If a dev role's task is big enough that it wants to fan out further, that's a
signal the ticket wasn't sliced small enough at `/to-tickets` time — split it into
another sibling ticket for the PM to delegate separately, don't let the dev role
grow a second layer underneath it.

### PM context hygiene

The PM's context is the scarcest, most expensive resource in this whole workflow —
doubly so if PM is running on a premium model. The PM does not explore the
codebase, read large diffs, or page through logs itself. It delegates that to a
dev-role subagent and consumes only the subagent's synthesized summary.

Concretely:
- PM reads ticket bodies, role files, and subagent summaries. It does not `Read`
  large source files, raw command output, or full test logs directly — that's a
  dev role's job, reported back as a summary.
- When the PM needs to understand "how does X work" before delegating, that's the
  `how` skill run as (or by) a subagent — not the PM reading the subsystem itself.
- A PM turn that's mostly tool output rather than orchestration decisions is a sign
  something should have been delegated instead.

## 6. Autonomy gate

The line used to sit at **merge**, and only at merge: an agent could do everything
up to opening a draft PR, and a human merged. That has moved. The gate now sits at
**risk**, judged by the paths a PR touches.

**Agents merge their own work** when the PR touches none of the protected paths and
every required check passes. Most work is here: UI, copy, deterministic
`ai-service/` code, tests, docs.

**A human merges** when the PR touches a path in `.github/CODEOWNERS`: database
migrations, the auth boundary, `ai-service/bubbly_chef/prompts/`, `.github/`,
`.claude/` configuration and hooks, dependency manifests, and deploy config. GitHub
enforces this through "Require review from Code Owners" — not convention, not a
local hook an agent could satisfy by touching a file.

**Why this is not the same as trusting agents more.** §7's old text said CI green
plus an agent's own review is weaker evidence than it feels like, because the
reviewing agent shares the implementing agent's blind spots. That is still true, and
nothing here contradicts it. What changed is the *evidence*, not the confidence:

- A bug fix must ship a test that **failed on the base commit** — CI re-runs the
  PR's own tests against base and demands a failure there (§7).
- The suite may not shrink and tests may not be skipped (§7).
- The change is **exercised in a running app**, with screenshots attached.
- Review comes from a **fresh context** that never saw the implementation session.

The chat action that posted to a route which did not exist — the failure that
justified the human-only gate — is caught by the third of those, not by a second
reader of the diff.

**What makes this safe to get wrong:** a bad deploy on Vercel or Railway rolls back
in minutes, and a post-merge smoke test opens the revert automatically. The things
that *don't* roll back — schema, auth, the gates themselves — are exactly the
CODEOWNERS list. The tiering is not about how likely a mistake is; it is about
whether the mistake is undoable.

**Still irreversible, still human, regardless of path:** force-push to a shared
branch, deleting data, sending external messages, rotating credentials.

Because the human at merge may not read the diff — and on an auto-merged PR, will
not read it at all — **the PR body carries the review** (§4). That is what makes
this a gate rather than a rubber stamp.

**Guard the context window:** agents post *summaries* to the issue/PR, not full
transcripts or diffs. Detail lives in linked artifacts (a demo doc, a decisions log,
screenshots under `docs/media/`) — link to it, don't paste it inline.

**PR bodies stay reviewable at a glance.** The human reviews from whatever device is
at hand, including a phone browser — a PR body padded with pasted logs, full diffs,
or raw agent transcript pushes the actually-relevant Summary/What-lands/Demo below
the fold. Concretely: no pasted stack traces (link the CI run instead), no pasted
diffs (the PR already has one), no multi-paragraph narration of what was tried and
discarded. If a review surfaced findings, state the resolution in one line per
finding ("fixed", "won't fix — reason"), not the full back-and-forth.

## 7. Review, layered

Review is **enforced by GitHub**, not by a local hook. The previous design gated PR
creation and merge on marker files in `.git/` written by the reviewing session. Those
markers were honour-system: any agent could `touch` one. That was tolerable while a
human merged everything, and is not tolerable now that agents merge. The hook
(`.claude/hooks/pr-review-gate.sh`) is deleted.

### Required checks (branch protection on `main`)

| Check | What it proves |
|---|---|
| `Next.js (typecheck + test)` | Frontend compiles and its tests pass |
| `AI service (lint + typecheck + test)` | Backend lints, typechecks against the mypy baseline, tests pass |
| `Bug fix fails on base` | The PR's tests **fail on the base commit** — the fix is real, not a test written to match the code |
| `Test suite did not shrink` | No test deleted, no test skipped |
| `F2P exemption is legitimate` | A `no-f2p` label is only valid on a docs-only diff |
| Vercel preview build | The frontend actually builds |

Scripts live in `scripts/agent-gates/`, wired by `.github/workflows/agent-gates.yml`.
Both are CODEOWNERS-protected: an agent cannot weaken its own gates.

### Fail-to-pass, specifically

CI checks out the base commit, copies **the PR's test files** onto it, and runs them.
At least one must fail. A collection or import error counts — a test for code that
does not exist yet cannot run, which is the evidence we want.

It is required when the PR closes an issue labelled `bug`. Features must add tests
but have nothing to fail against first. Docs and refactors use the `no-f2p` label,
which the exemption check validates against the diff.

This is the counter to the documented failure mode where agents satisfy a benchmark
without solving the task: the check is re-run by CI, never self-reported.

### Human review layers

1. **`/code-review`** — on every PR, agent-invocable. Two axes: repo standards and
   the originating spec.
2. **PR review by the Claude GitHub Action** — fires on PR open in a fresh context
   that never saw the implementation session. This is the independent read.
3. **`thermo-nuclear-review`** — user-invocation-only, still available, no longer a
   mechanical gate. Run it on anything large, cross-cutting, or security-shaped
   before approving a CODEOWNERS-protected PR.

### Reading the review is part of the job

A review nobody reads is the same as no review. The Claude GitHub Action posts
findings as a top-level comment **and** as inline comments on the diff. PRs have sat
with "needs changes" findings unread while the session that opened them moved on to
other work. So:

- **The session that opens or pushes to a PR owns every Claude review on it** until the
  PR merges or closes. That includes inline comments, not just the verdict line.
- **Each finding gets an outcome, in the reviewer's own words:** **fixed** (and pushed), or
  **disputed** with the reason it stands. A finding that is really a product or policy
  call goes to the human as a decision, and the comment says so. Silence is not an
  outcome. Post a resolutions comment that marks each finding "fixed" or "disputed". The
  re-review prompt in `claude-review.yml` and the Respond stage (§8) look for exactly
  those two words.
- **Watch actively; don't wait to be told.** From the first PR it opens, a session keeps a
  standing poll on the repo-wide comment feeds and re-arms it for as long as the session
  runs:
  `repos/{owner}/{repo}/issues/comments?since=<last>` and
  `repos/{owner}/{repo}/pulls/comments?since=<last>`, filtered to authors matching
  `^claude`. In Claude Code, that's a `Monitor` re-armed on each expiry.
- **A merge script's verdict check doesn't count as reading.** It sees one verdict on the PRs
  it was pointed at. It misses inline comments, and it misses PRs it wasn't given.
- **The desktop app's PR monitoring is a convenience, not the mechanism.** It isn't
  consistent enough to depend on, so the poll above is what the rule rests on.
- **Getting a fresh review after a fix:** `agent-loop`-labelled PRs re-review on push. For
  any other PR, close and reopen it. Don't add the label just to get a review. The label
  turns the `Claude review verdict` job into a blocking required check, which passes only
  on "looks mergeable" for the exact head commit or on a code owner's approval. So the
  PR can't merge on its checks alone. On a bot-authored PR from the last 24 hours, the
  label also counts toward the loop cap.
- **Handoffs list every PR with an unread or unresolved review.** The vendored `/handoff`
  skill doesn't know this rule (it's drift-tracked in `skills-lock.json` and has no PR
  step), so whoever writes the handoff adds the list by hand.

### Deploy-side checks

`main` auto-deploys to Vercel and Railway, so the last line of defence is after the
merge, not before it. Both services report their commit SHA from `/health`; the
post-merge smoke test waits until both match the merged commit, exercises core flows
against production, and on failure an agent opens a revert PR that may auto-merge —
a pure revert being the one change that is always safe.

### The agent loop

One `ready-for-agent` issue goes end to end through a saved Workflow script,
`.claude/workflows/agent-loop.js`, run with `{issue: <n>}`.
Control flow lives in the script so it behaves the same every run; judgement lives in
the agents it calls:

| Stage | Who | Way out |
|---|---|---|
| Preflight — step 0, environment | Sonnet probes; **the script decides** | Stops before anything else if `gh` is missing, or if the identity the bot config dir resolves to isn't `bubblychef-bot`. Writing as anyone else would skip code-owner review on protected paths, so the run never starts (issue #474) |
| Preflight — step 1, readiness | Sonnet gathers facts; **the script decides** | Stops if `AGENTS_ENABLED` isn't `true` or couldn't be read at all, 15 loop PRs were opened in the last 24 hours (raised from 3 to 6 on 2026-09-19, to 15 on 2026-09-23 for ship mode), the issue isn't open and `ready-for-agent`, or a PR is already on it |
| Setup | Sonnet, low effort | A fresh branch from `main` **in the session's own checkout** (never a separate worktree; see below). Refuses to start on uncommitted work |
| Plan | the dev role for the domain | Lists genuine ambiguities, each with its own take |
| Decide | **Opus, high effort** | Settles each ambiguity; escalates to Ayush (`needs-decision`) only for protected paths or product behaviour beyond the issue |
| Reproduce | dev role | Bugs only: a test that fails on the unfixed code, plus before-screenshots |
| Implement + Verify | dev role | Quality gates, then the `verify` skill; **2 attempts total** |
| Review | **Opus**, fresh context | Up to **3** fix rounds; if any fix happened, **verification re-runs on the final commit** before Ship, and a failed re-verification takes the blocked path |
| Ship | Sonnet | PR as `bubblychef-bot`, protected paths flagged at the top |
| Respond | Sonnet reads, dev role fixes | Waits for the **GitHub review** of the PR, and answers it: each finding fixed or disputed with a reason, a resolutions comment on the PR, and a push that triggers a fresh GitHub review. **Up to 2 rounds**; still unresolved → PR drafted and labelled `agent-blocked`. `needs a human` (e.g. a protected path) is left for Ayush |

Any stage that can't finish takes the **blocked path**: a draft PR labelled
`agent-blocked` with the work so far and where it stopped, and the issue moved back to
`needs-triage` so it isn't picked up again until a human has looked. A stuck run is a
normal outcome; a silent half-done branch is not.

The loop never merges. In shadow mode (the default) it never requests auto-merge
either; it marks PRs that *would* auto-merge and Ayush merges. Outside shadow mode it
requests auto-merge only when **all** of these hold: the GitHub review says `looks
mergeable`, and the PR touches no protected path. GitHub then still waits for every
required check.

`claude-review.yml` re-reviews new pushes **only on PRs labelled `agent-loop`**, which
is what gives Respond a fresh review after each fix. Human PRs are reviewed once, on open. The script itself is
CODEOWNERS-protected: an agent that could edit it could raise its own limits.

**It runs in the calling session's own checkout,** switching it to a new branch and back at the end. The host only lets a session, and every agent it launches, write inside that session's own worktree, so a loop that created a separate worktree could read it but never write to it (the first pilot run blocked on exactly this). Running several issues at once therefore means several sessions, each in its own worktree, which is what §5 already says.

`dryRun: true` stops after Decide and deletes the issue branch: a cheap way to see how the
loop reads an issue before letting it write anything.


## 8. House rules

These aren't skills you invoke — they're standing behavior, folded into `CLAUDE.md`'s
house-rules section. Full source: pstack's `principle-*` skills in `cursor/plugins`.

- **guard-the-context-window** — route bulk output (large reads, fan-out planning,
  verbose tool results) to subagents; keep the main thread to summaries, not raw
  payloads.
- **never-block-on-the-human** — for reversible work, proceed and present the result
  rather than asking permission first. Reserve confirmation for irreversible actions
  (force-push, deleting data, sending external messages). See §6 for how this maps
  onto the PR autonomy gate specifically.
- **subtract-before-you-add** — when evolving a system, remove dead weight first,
  then build on the simpler base. No speculative validators/guards beyond what the
  spec demands.
- **prove-it-works** — after finishing a task, verify against the real artifact (run
  the feature, read the actual diff) — not a proxy, not a self-report, not "it
  compiles."
- **fix-root-causes** — when debugging, reproduce first, trace to the actual cause,
  and fix there. Resist guard-clauses that just silence a symptom.

## 9. Skill map

**Skills are vendored into `.claude/skills/`, committed to the repo.** Same rule as
role files (§5): a workflow that only exists on one laptop doesn't survive switching
machines — and, more sharply, doesn't exist at all in CI or a cloud session. See §9.1
for why this changed.

| Layer | Skills | Status |
|---|---|---|
| Planning/tracking | `wayfinder`, `triage`, `to-spec`, `to-tickets`, `handoff` | ✅ vendored |
| Build | `tdd`, `domain-modeling`, `prototype` | ✅ vendored |
| Verify (project) | `verify` — run a production build on this worktree's ports and walk the flow, with screenshots | 🏠 project-local |
| Build (project) | `implement-issue` | 🏠 project-local |
| Review | `code-review`, `thermo-nuclear-review` | ✅ vendored |
| Investigation | `diagnosing-bugs`, `research`, `resolving-merge-conflicts` | ✅ vendored |
| Design interviews | `grilling`, `grill-with-docs` | ✅ vendored |
| Understanding (PM-facing) | `how`, `why` | ✅ vendored |
| Setup | `setup-matt-pocock-skills` | ✅ vendored |
| Media | `prune-media` | 🏠 project-local |
| House rules | see §8 | folded into prose, not skills |

**21 skills loaded.** `skills-lock.json` records the upstream commit per source plus
a per-skill hash, so drift stays detectable against both.

### 9.1 Why vendoring, and what's still broken

Previously `skills-lock.json` pinned skills by *reference* and nothing was committed.
A lockfile is a pointer, not content — so a fresh clone, a GitHub Action, or a cloud
session resolved **zero** skills and every invocation silently no-opped. The lockfile
had also drifted from upstream (four renames: `to-prd`→`to-spec`, `to-issues`→
`to-tickets`, `zoom-out`→`wayfinder`, `diagnose`→`diagnosing-bugs`) and was missing
six skills this document depends on, including `implement` and `code-review` — the
two that *are* the build-and-review loop.

The `cursor/plugins` set previously lived at `~/Code/.agents/skills/<name>/` — a
local home directory that CI, cloud sessions, and a phone have no access to, making
§7's "three-layer review" **one layer** everywhere but one configured laptop. Those
are now vendored here too, so all three layers work anywhere the repo does.

**Also fixed here:** the `thermo-nuclear` `PreToolUse` hook had the same class of
problem from a different angle. It was described in this document but configured
nowhere in the repo, and the trigger it described — `Bash` running `gh pr create` —
would not have fired in a session that opens PRs through the GitHub MCP tools. It
now exists as a committed script + `settings.json` entry covering both paths; see
§7 layer 3.

### 9.2 Archived skills

Nine skills moved to `.claude/skills-archive/` on 2026-09-17 (step 1 of
`docs/plans/2026-09-17-autonomous-agent-loop.md`). Claude Code does not load that
directory, so they cost no context and cannot be invoked; moving a directory back
into `.claude/skills/` restores it. Their `skills-lock.json` entries stay, so drift
against upstream is still detectable if one is restored.

| Archived | Why |
|---|---|
| `implement` | The agent loop replaces it; `implement-issue` is the pickup path |
| `interrogate` | The plan drops multi-model review — independence comes from evidence (F2P against base, clickthrough) and a fresh-context reviewer |
| `grill-me` | One-line alias for `grilling` |
| `figure-it-out`, `show-me-your-work` | The loop is the standing playbook and the PR is the decision trail; archived together since the first invokes the second |
| `blast-radius`, `codebase-design`, `improve-codebase-architecture` | Never used here; `how`/`why`/`diagnosing-bugs` cover the same ground |
| `automate-me` | Authors a personal mode skill — a laptop-level concern, not a repo one |

Known inert references: vendored upstream text in `diagnosing-bugs` still suggests
handing off to `/improve-codebase-architecture`. The files are left unedited so they
keep matching their lockfile hashes; the suggestion simply won't resolve.

`implement-issue` (🏠) is authored in this repo, not vendored from upstream —
it has no upstream source and is deliberately absent from `skills-lock.json`.
It codifies the pickup loop this document already specifies (§2 queue → §4
branch → §5 delegation → §6 autonomy gate) as one invocable skill; upstream
`implement` is the generic spec/ticket builder it delegates the actual coding to.

**Naming note:** the skill is `thermo-nuclear-review` upstream, not
`thermo-nuclear-code-quality-review` as earlier drafts of this doc called it.

## 10. What's explicitly skipped

`arena`, `orchestrate`, the `benny` automation pack, and the remaining
`principle-*` maxims beyond the five in §8. These either assume Cursor-SDK/Slack
infra this setup doesn't have, or are redundant with the Workflow tool /
already-adopted principles. Revisit if the gap becomes real.

## 11. How to verify this doc is working

- A cold read of this file, with no other context, should be enough to explain the
  full lifecycle of an issue from idea to merged PR.
- Run a throwaway issue through `/triage` → `/to-spec` → `/to-tickets` once, confirm
  the issue/PR templates render correctly in GitHub's UI.
- Manually trigger the Stop-hook condition once (end a session after editing a
  source file without reviewing) and confirm the nudge fires and is non-blocking.

---

*Vendored from `~/Code/.project-template/WORKFLOW.md`. This project may diverge
deliberately over time — if it does, note the divergence here rather than silently
drifting.*

**Divergences from the template:**
- §9 adds `implement-issue`, a project-local Build skill with no upstream source
  (see §9). The template's skill map assumes every skill is vendored from
  `mattpocock/skills` or `cursor/plugins`; this one is ours.
