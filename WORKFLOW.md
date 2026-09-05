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

**Commit screenshots into `docs/media/` on the PR branch — always.** A PR body
that references an image by a local absolute path (or a `docs/media/…` path that
was never committed) renders as a broken link on GitHub: the reviewer sees the
alt text and a 404, not the screenshot. So capture into `docs/media/`, commit the
files on the same branch, and reference them from the body with the repo-relative
path (`![Loaded](docs/media/dash-loaded.png)`), which GitHub resolves against the
branch blob. Do not paste `file:///…` paths — those only work in the terminal that
made them. Committing the PNGs is not clutter: CI prunes orphaned media, so lean
toward committing over leaving them uncommitted. Note that pushing screenshots
advances the PR HEAD, so a merge-gate review keyed on HEAD sha must run against
the new HEAD.

## 5. Agent team shape

Every project gets a `pm` role (the human) plus 2–5 domain-specific dev roles. The
**file format is shared**; the **role list is per-project** — see
`docs/agents/roles/_role-template.md` for how to write a new one and
`docs/agents/roles/pm.md` for the PM role file itself. BubblyChef's team:
`pm`, `backend`, `frontend`, `ui-ux`, `qa-reviewer` — see `docs/agents/roles/`.

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

Not everything needs to wait for a human. The line sits at **merge**, and only at
merge:

- **Everything up to and including opening a draft PR is autonomous.** Picking up a
  `ready-for-agent` ticket, branching, implementing, running the quality gates,
  running `/code-review`, recording its marker, pushing, and opening a draft PR with
  a legible summary and demo — none of that waits for a human.
- **Merging always waits for a human.** `main` auto-deploys to Vercel and Railway, so
  a merge is a production deploy. The §7 gate enforces this mechanically: merge
  requires a `thermo-nuclear-review` marker, and that skill is user-invocation-only.
  An agent cannot produce it, by design.

This is still **never-block-on-the-human**, applied where it belongs: the expensive
thing to undo is a bad deploy, not a draft PR nobody has read yet. Work never
strands half-finished waiting for permission — it strands, if at all, in a reviewable
state with the diff, the demo and the review findings already attached.

> **Changed from the earlier policy.** This section previously allowed agents to
> merge sub-PRs autonomously once CI was green. That is no longer true and the gate
> now prevents it. The reason is honest rather than theoretical: CI green plus an
> agent's own review is weaker evidence than it feels like, because the reviewing
> agent shares the implementing agent's blind spots — their failures correlate. A
> defect that typechecks, passes tests, and reads plausibly is exactly the kind this
> repo has already shipped (a chat action posting to a route that did not exist,
> reporting success, and losing every item the user added). One human at the
> irreversible step is cheap; an unnoticed bad deploy is not.

Because the human at merge may not read the diff, **the PR body carries the review**
— see §4. That is what makes a merge-only gate safe rather than a rubber stamp.

**Guard the context window:** agents post *summaries* to the issue/PR, not full
transcripts or diffs. Detail lives in linked artifacts (a demo doc, a decisions log,
screenshots under `docs/media/`) — link to it, don't paste it inline.

**PR bodies stay reviewable at a glance.** The human reviews feature-level PRs from
whatever device is at hand, including a phone browser — a PR body padded with
pasted logs, full diffs, or raw agent transcript pushes the actually-relevant
Summary/What-lands/Demo below the fold. Concretely: no pasted stack traces (link the
CI run instead), no pasted diffs (the PR already has one), no multi-paragraph
narration of what was tried and discarded (that belongs in a linked decisions log,
not the PR body). If `/interrogate` or `thermo-nuclear-review` surfaced
findings, state the resolution in one line per finding ("fixed", "won't fix —
reason"), not the full back-and-forth.

## 7. Review, layered

Three layers, increasing in cost and decreasing in frequency:

1. **`/code-review`** — on every PR. Cheap, always on, standard.
2. **`/interrogate`** — a multi-model adversarial pass. Run before merging any
   feature-level PR (not sub-PRs).
3. **`thermo-nuclear-review`** — wired as a Claude Code `PreToolUse` hook, not a
   GitHub Action. It fires once per PR, at the moment the PR is about to become
   real, not on every commit or file edit inside it. This applies to both sub-PRs
   and feature PRs.

   The hook is `.claude/hooks/pr-review-gate.sh`, registered in
   `.claude/settings.json` — both committed, so it exists in a fresh clone rather
   than on one laptop. It keys on the **action, not the transport**: a `Bash`
   command running `gh pr create`/`gh pr merge`, *and* the `mcp__github__*` PR
   create/merge tools, since a cloud session opens PRs through the MCP tools and
   never touches the `gh` CLI. Matching only the CLI is how this layer came to be
   documented-but-absent everywhere except one machine.

   Mechanically it is a gate, not a notifier: it denies the call unless a marker
   for the current HEAD exists, which the review records once it has run. Markers
   are per-commit, so a later push re-arms the gate, and they live in `.git/` so
   they are never committed. Bypass deliberately (`touch` the marker) only when
   you have a reason you would defend in review.

   **Two tiers, because create and merge differ in risk and in who can satisfy
   them.** `thermo-nuclear-review` is user-invocation-only — an agent cannot run
   it. Gating PR *creation* on it therefore deadlocked every autonomous session at
   the exact moment its work would have become visible, which is the worst possible
   place to stop: the work is finished, and stranded.

   | Action | Satisfied by |
   |---|---|
   | PR **create** | `.git/code-review-<sha>` *or* `.git/thermo-nuclear-review-<sha>` |
   | PR **merge** | `.git/thermo-nuclear-review-<sha>` only |

   Opening a draft PR is not the dangerous act — it is how work becomes reviewable.
   Merging is the irreversible one, and `main` auto-deploys to Vercel and Railway,
   so merge keeps the strong gate. `/code-review` **is** agent-invocable, which is
   what makes the create tier satisfiable without a human in the loop.

   In practice this means **every merge needs a thermo-nuclear pass**. On a major
   PR that is obviously worth it. On a small bug fix it is quick — a small diff is
   cheap to validate, so the gate costs little; it is not a reason to skip it.

   Kept as a local hook rather than a GitHub Actions bot because the latter needs
   API-key plumbing and per-repo billing setup — worth revisiting later, not bundled
   into this template.

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
| Build | `implement`, `tdd`, `codebase-design`, `domain-modeling`, `prototype` | ✅ vendored |
| Build (project) | `implement-issue` | 🏠 project-local |
| Review | `code-review` | ✅ vendored |
| Investigation | `diagnosing-bugs`, `research`, `improve-codebase-architecture`, `resolving-merge-conflicts` | ✅ vendored |
| Design interviews | `grill-with-docs`, `grill-me`, `grilling` | ✅ vendored |
| Setup | `setup-matt-pocock-skills` | ✅ vendored |
| Review (extra layers) | `interrogate`, `thermo-nuclear-review` | ✅ vendored |
| Understanding (PM-facing) | `how`, `why`, `blast-radius` | ✅ vendored |
| Process hygiene | `show-me-your-work`, `figure-it-out` | ✅ vendored |
| Self-tuning | `automate-me` | ✅ vendored |
| House rules | see §8 | folded into prose, not skills |

27 skills total — 19 from `mattpocock/skills`, 8 from `cursor/plugins`
(`pstack/` and `thermos/`). `skills-lock.json` records the upstream commit per
source plus a per-skill hash, so drift stays detectable against both.

`implement-issue` (🏠) is authored in this repo, not vendored from upstream —
it has no upstream source and is deliberately absent from `skills-lock.json`.
It codifies the pickup loop this document already specifies (§2 queue → §4
branch → §5 delegation → §6 autonomy gate) as one invocable skill; upstream
`implement` is the generic spec/ticket builder it delegates the actual coding to.

**Naming note:** the skill is `thermo-nuclear-review` upstream, not
`thermo-nuclear-code-quality-review` as earlier drafts of this doc called it.

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
