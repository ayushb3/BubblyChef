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

Not everything needs to wait for a human. The split:

- **Sub-PRs** (scoped implementation slices feeding a parent feature/ticket) — agents
  may merge autonomously once CI is green and a legible summary/demo is posted to the
  PR. No human wait.
- **Feature-level or large PRs** (anything closing a top-level spec ticket, or
  touching more than one role's ownership boundary) — always wait for human review of
  the posted summary/demo before merge.

This is a deliberate application of **never-block-on-the-human**: reversible,
scoped work proceeds without a permission pause; only the things that are expensive
to undo (a feature landing wrong, ownership boundaries blurring) wait for a human.

**Guard the context window:** agents post *summaries* to the issue/PR, not full
transcripts or diffs. Detail lives in linked artifacts (a demo doc, a decisions log,
screenshots under `docs/media/`) — link to it, don't paste it inline.

**PR bodies stay reviewable at a glance.** The human reviews feature-level PRs from
whatever device is at hand, including a phone browser — a PR body padded with
pasted logs, full diffs, or raw agent transcript pushes the actually-relevant
Summary/What-lands/Demo below the fold. Concretely: no pasted stack traces (link the
CI run instead), no pasted diffs (the PR already has one), no multi-paragraph
narration of what was tried and discarded (that belongs in a linked decisions log,
not the PR body). If `/interrogate` or `thermo-nuclear-code-quality-review` surfaced
findings, state the resolution in one line per finding ("fixed", "won't fix —
reason"), not the full back-and-forth.

## 7. Review, layered

Three layers, increasing in cost and decreasing in frequency:

1. **`/code-review`** — on every PR. Cheap, always on, standard.
2. **`/interrogate`** — a multi-model adversarial pass. Run before merging any
   feature-level PR (not sub-PRs).
3. **`thermo-nuclear-code-quality-review`** — wired as a Claude Code `PreToolUse`
   hook, not a GitHub Action. It fires specifically when the `Bash` tool is about to
   run `gh pr create` or `gh pr merge` — i.e., once per PR, at the moment the PR is
   about to become real, not on every commit or file edit inside it. This applies to
   both sub-PRs and feature PRs.

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

| Layer | Skills | Source |
|---|---|---|
| Planning/tracking | `wayfinder`, `triage`, `to-spec`, `to-tickets`, `handoff` | mattpocock |
| Build | `implement`, `tdd`, `codebase-design`, `domain-modeling` | mattpocock |
| Debugging | `diagnosing-bugs` | mattpocock |
| Review | `code-review` (mattpocock) + `interrogate`, `thermo-nuclear-code-quality-review` (ported) | both |
| Understanding (PM-facing) | `how` (codebase walkthroughs), `why` (decision archaeology), `blast-radius` (pre-emptive break-check) | ported from `cursor/plugins` (pstack) |
| Process hygiene | `show-me-your-work` (legible decision trail on long/unattended runs), `figure-it-out` (fallback for one-off asks outside the ticket pipeline) | ported from `cursor/plugins` (pstack) |
| Self-tuning | `automate-me` (mines your own conversations to keep this doc/`CLAUDE.md` accurate as your style evolves) | ported from `cursor/plugins` (pstack) |
| Setup / authoring | `setup-matt-pocock-skills`, `writing-for-agents`, `grill-me`, `grill-with-docs`, `improve-codebase-architecture` | mattpocock |
| House rules | see §8 | `cursor/plugins` `principle-*`, folded into prose, not installed as skills |

Every skill named above is **vendored into this repo** at `.claude/skills/<name>/`
and committed. That is the whole point: a lock file installs nothing, and skills
that live only in `~/.claude/skills/` do not exist in a fresh clone or in Claude
Code on the web. Anything in this table that isn't in `.claude/skills/` is a bug in
this table.

`skills-lock.json` records, per skill, where it came from and a sha256 of its
`SKILL.md` (LF endings --- `.gitattributes` pins that, or a Windows checkout
invalidates every hash). To update a mattpocock skill, re-fetch the `skillPath`
recorded in the lock and update its hash.

- **mattpocock skills** are pinned to `mattpocock/skills@6654f6b`.
- **Ported skills** came from `cursor/plugins` (pstack) at commit
  `a8145426e541afa424a403e3866496216c1b8142`. They have no upstream installer, so
  the vendored copy here is the only source of record --- they are not re-fetchable.

**Renamed and removed upstream** (the lock pinned a dead generation until
2026-08-30): `to-prd` is now `to-spec`, `to-issues` is `to-tickets`, `diagnose` is
`diagnosing-bugs`, `write-a-skill` is `writing-for-agents`. `caveman` and `zoom-out`
were removed with no successor and are gone. Don't reintroduce the old names ---
`/to-prd` and `/to-issues` are not commands any more.


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

**Divergences from the template, as of 2026-08-30:**

- **Skills are vendored in-repo** (§9) rather than installed per-machine via
  `setup-matt-pocock-skills`. The template assumes every operator installs the
  skills locally; that assumption breaks the moment work is handed to a remote or
  web session, which is most of the implementation work here.
