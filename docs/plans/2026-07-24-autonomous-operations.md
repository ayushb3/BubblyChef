# Autonomous Operations Plan

*Date: 2026-07-24 · Status: proposed · Companion to `WORKFLOW.md` (process) and
`docs/plans/2026-07-24-gamification-and-live-kitchen.md` (the feature)*

---

## 0. What this document is — and is not

`WORKFLOW.md` already describes the process model completely and well: issue
lifecycle, the five triage labels, the planning pipeline, branch/PR convention,
orchestration depth, the autonomy gate, three-layer review, and five house
rules. **This document does not restate any of that.**

What it does: close the gap between the workflow *as written* and the workflow
*as installed*, then define the closed loop that lets work run unattended —
implementation, review, redesign, and re-evaluation — across this feature and
the backlog behind it.

The finding that motivates it: **`WORKFLOW.md` §9 describes a skill set that is
not installed.** The doc of record is ahead of the machine.

---

## 1. Gap analysis — why autonomy doesn't currently work

### 1.1 The skill manifest is stale and unmaterialised

`skills-lock.json` pins 12 skills. Upstream `mattpocock/skills` has since
renamed several, and `WORKFLOW.md` §9 already refers to the **new** names —
so the doc, the lockfile, and the upstream repo disagree three ways.

| `WORKFLOW.md` §9 calls for | `skills-lock.json` has | Status |
|---|---|---|
| `to-spec` | `to-prd` | **renamed upstream** |
| `to-tickets` | `to-issues` | **renamed upstream** |
| `wayfinder` | `zoom-out` | **renamed upstream** |
| `diagnosing-bugs` | `diagnose` | **renamed upstream** |
| `implement` | — | **missing entirely** |
| `code-review` | — | **missing entirely** |
| `codebase-design` | — | **missing entirely** |
| `domain-modeling` | — | **missing entirely** |
| `handoff` | — | **missing entirely** |
| `research` | — | **missing entirely** |
| `prototype` | — | **missing entirely** |
| `resolving-merge-conflicts` | — | **missing entirely** |

`implement` and `code-review` are the two that matter most here — they are
precisely the autonomous build-and-check loop, and neither is installed.

Worse: **no `SKILL.md` files are vendored anywhere in the repo.** A search finds
exactly one (`nextjs/.claude/skills/supabase-postgres-best-practices/`). The
lockfile references skills that do not exist on disk, so a fresh clone — or a
cloud session like this one — has none of them.

### 1.2 The autonomy gate rests on a CI gate that doesn't cover the checks

`WORKFLOW.md` §6 permits agents to merge sub-PRs autonomously "once CI is
green." `CLAUDE.md` defines the quality gates as:

```
cd ai-service && pytest && ruff check bubbly_chef/ && mypy bubbly_chef/ --strict
cd nextjs && npx tsc --noEmit
```

`.github/workflows/ci.yml` runs on PRs to `main` and covers `tsc`, `jest`,
`ruff`, and `pytest`. It does **not** run:

- **`mypy --strict`** — a declared required gate, entirely absent from CI
- **Playwright e2e** — PR #59 (harness) unmerged, issue #55 (CI wiring) open

So "CI is green" currently means "four of six gates passed." An agent merging
autonomously on that signal can land a type error that the project's own rules
say must block. **This is the highest-priority fix in this document** — it is
the difference between autonomy and unsupervised breakage.

### 1.3 Ported skills won't exist in a cloud session

`WORKFLOW.md` §9 lists `interrogate`, `thermo-nuclear-code-quality-review`,
`how`, `why`, `blast-radius`, `show-me-your-work`, `figure-it-out`, and
`automate-me` as vendored by hand to `~/Code/.agents/skills/<name>/`.

That path is a **local machine home directory**. A GitHub Action, a Claude Code
web session, or any fresh container has no such directory. Every review layer
above `/code-review` silently no-ops in exactly the environments where
autonomous work runs.

Same class of problem for the `thermo-nuclear` `PreToolUse` hook: it fires on
`Bash` running `gh pr create`. This environment has **no `gh` CLI** (GitHub MCP
tools instead), so the hook never triggers here at all.

### 1.4 No unattended trigger

Everything today is human-initiated. There is no scheduled entry point that
picks up `ready-for-agent` work, and no mechanism to react to a PR going red
after the human has walked away.

---

## 2. Phase 0 — Make the workflow real (blocks everything else)

Ordered by what unblocks the most.

**0.1 — Fix the CI gate.** Add `mypy bubbly_chef/ --strict` as a job step. Land
PR #59 and wire Playwright per issue #55. Until CI covers all six gates,
autonomous merge is unsafe and should stay off.

**0.2 — Re-run `setup-matt-pocock-skills` and re-pin.** Regenerate
`skills-lock.json` against current upstream, adopting the renames and adding the
six missing skills (`implement`, `code-review`, `codebase-design`,
`domain-modeling`, `handoff`, `research`). Reconcile `WORKFLOW.md` §9 and
`CLAUDE.md` to whatever the lockfile actually resolves to.

**0.3 — Vendor skills into the repo.** Commit resolved `SKILL.md` files under
`.claude/skills/` so a fresh clone has them. A workflow that only exists on one
laptop is the exact failure mode `WORKFLOW.md` §5 already calls out for role
files — apply the same rule to skills.

**0.4 — Port the ported skills properly.** Move the `~/Code/.agents/skills/`
set into `.claude/skills/` in-repo, or explicitly downgrade `WORKFLOW.md` §7 to
say those layers are local-only and do not run in CI or cloud sessions. Either
is fine; the current silent no-op is not.

**0.5 — Make the pre-merge review hook environment-agnostic.** The `gh pr
create` `PreToolUse` trigger doesn't fire where there's no `gh`. Either move
that review to a CI job (runs everywhere, no per-environment assumptions) or
add matching triggers for the MCP PR-creation path.

---

## 3. The autonomous loop

Once Phase 0 lands, this is the cycle. It runs without a human in the path
except at the two gates `WORKFLOW.md` §6 already defines.

```
        ┌─────────────────────────────────────────────────┐
        │  SELECT — pull one `ready-for-agent` issue      │
        │  (blocked-by deps satisfied, smallest first)    │
        └────────────────────┬────────────────────────────┘
                             ▼
        ┌─────────────────────────────────────────────────┐
        │  BUILD — /implement  (embeds tdd + code-review) │
        │  branch: feat/issue-<n>-<slug>                  │
        └────────────────────┬────────────────────────────┘
                             ▼
        ┌─────────────────────────────────────────────────┐
        │  VERIFY — all six gates locally, then push      │
        │  pytest · ruff · mypy --strict · tsc · jest · e2e│
        └────────────────────┬────────────────────────────┘
                             ▼
        ┌─────────────────────────────────────────────────┐
        │  REVIEW — /code-review; feature PRs add         │
        │  /interrogate. Draft PR + summary, no logs.     │
        └────────────────────┬────────────────────────────┘
                             ▼
                    ┌────────┴────────┐
             sub-PR │                 │ feature-level PR
                    ▼                 ▼
        ┌───────────────────┐  ┌──────────────────────────┐
        │ CI green → merge  │  │ WAIT for human review    │
        │ autonomously      │  │ (§6 autonomy gate)       │
        └────────┬──────────┘  └──────────┬───────────────┘
                 └───────────┬────────────┘
                             ▼
        ┌─────────────────────────────────────────────────┐
        │  WATCH — subscribe to PR activity.              │
        │  CI red → /diagnosing-bugs → push fix → repeat  │
        └────────────────────┬────────────────────────────┘
                             ▼
                      next issue ──┐
                                   │
        ┌──────────────────────────┴──────────────────────┐
        │  PERIODIC (every ~10 merges or 2 weeks)         │
        │  /improve-codebase-architecture → redesign       │
        │  /triage sweep → re-evaluate backlog            │
        │  /handoff → session continuity doc              │
        └─────────────────────────────────────────────────┘
```

### 3.1 Stop conditions — when the loop must halt and ask

Autonomy needs explicit brakes, not just permissions. Halt and escalate on:

| Condition | Why |
|---|---|
| Same CI failure twice after two fix attempts | Thrashing; a human should look |
| A fix requires touching another role's ownership boundary | `WORKFLOW.md` §5 |
| The issue turns out to need a schema migration not in its spec | Irreversible in prod |
| `/code-review` returns a finding the agent cannot resolve without changing the spec | Spec is wrong, not the code |
| Any destructive git operation (force-push, branch delete) | House rule: never-block-on-the-human exempts irreversible actions |
| Backlog has no `ready-for-agent` issue | Nothing to do — do not invent work |

That last row matters. **An idle autonomous loop should stop, not manufacture
tickets.**

### 3.2 Redesign and re-evaluation, on a cadence

Implementation loops accrete drift; without a scheduled counter-pressure the
codebase only ever grows. Two recurring passes:

- **`/improve-codebase-architecture`** every ~10 merged PRs or 2 weeks. Scans
  for architectural drift and reports visually. Its findings become
  `needs-triage` issues, entering the normal pipeline — never applied directly.
- **`/triage` sweep** on the same cadence. The current backlog is 43 open
  issues, ~30 of which are UI children already implemented on the unmerged
  `feat/ui-overhaul` branch. That is exactly the debris a periodic sweep exists
  to clear. Re-evaluate: still relevant? already done? superseded?

This satisfies the **subtract-before-you-add** house rule structurally rather
than relying on remembering it.

### 3.3 Applying the house rules to unattended runs

Two of the five need specific interpretation when nobody is watching:

- **`prove-it-works`** — "run the feature, not a proxy" is hard for a UI change
  with no human eye on it. For the kitchen work specifically, this means
  Playwright screenshots committed to `docs/media/` and linked from the PR, so
  the human reviews the *rendered result*, not a description of it. This is a
  concrete reason Phase 0.1 (Playwright in CI) blocks the kitchen phases.
- **`guard-the-context-window`** — in a long unattended run the PM thread is the
  thing that degrades first. `/handoff` at the end of each work session,
  committed, so the next session resumes from a document rather than a
  reconstructed conversation.

---

## 4. Applying this to what's next

Sequenced against the gamification plan and the standing backlog.

| Stage | Work | Mode | Gate |
|---|---|---|---|
| **0** | Phase 0 above (CI gates, skills, hooks) | Human-led — it's the tooling that makes autonomy safe | — |
| **1** | Land `feat/ui-overhaul` stack (PRs #74/#119/#120/#121) + #59 | Human-reviewed; 3k lines across ownership boundaries | Feature gate |
| **2** | Backlog sweep — close the ~30 UI children the branch resolved | Autonomous `/triage` | None (label-only) |
| **3** | PWA shell (Phase B) | Autonomous; self-contained, no design ambiguity | Sub-PR gate |
| **4** | Kitchen C0 art spike | **Human** — licence choice and art direction are judgment calls | Feature gate |
| **5** | Kitchen C1–C4 (room, zones, NPC, ambient) | Autonomous per vertical slice, screenshots to `docs/media/` | Sub-PR gate |
| **6** | Progression engine (Phase D) | Autonomous; schema migrations reviewed | Feature gate on migrations |
| **7** | Provider bake-off (Decision 4) | Autonomous — it's an eval run against existing snapshot fixtures | Human picks the winner |
| **8** | Kitchen evolution + Living Bubbles (E, F) | Autonomous | Feature gate |
| **9** | Push notifications (Phase G) | **Human** — sends external messages; house-rule exempt from autonomy | Feature gate |

Stages 4 and 9 are deliberately human. Everything else is reversible, scoped,
and CI-verifiable — which is the actual test `WORKFLOW.md` §6 applies.

### 4.1 Pipeline entry per stage

Following `WORKFLOW.md` §3, matched to how shaped each piece already is:

- Stages 3, 5, 6, 8 — the gamification plan is a shaped design doc, so
  **`/to-spec`** straight to spec issues, then **`/to-tickets`** for vertical
  slices. No `/wayfinder` needed; the shape is known.
- Stage 4 (art) — genuinely unknown shape. **`/wayfinder`** to chart the
  decisions (which tileset, custom Bubbles sprite or not, licence terms) before
  committing.
- Stage 7 (providers) — **`/research`** for the eval, since the output is
  findings against primary sources rather than a feature.
- Anything arriving from outside this plan — **`/triage`** as always.

---

## 5. Unattended triggering

Two mechanisms, both already available in this environment:

**Scheduled sweep.** A recurring routine that: pulls `ready-for-agent` issues,
runs one through the §3 loop, and stops on the §3.1 conditions. Cadence matched
to review appetite — daily is plenty for a solo project.

**PR reactivity.** Subscribe to PR activity on every PR the loop opens. CI
failures and review comments then wake the session directly rather than needing
a poll. This is what turns "opened a PR and stopped" into "drove it to green."

Both are configuration, not code — worth setting up only *after* Phase 0, since
a scheduled loop on incomplete CI gates automates the breakage rather than
the work.

---

## 6. How to verify this is working

Mirroring `WORKFLOW.md` §11's spirit:

1. `skills-lock.json`, `WORKFLOW.md` §9, and `.claude/skills/` on disk all name
   the same set. No fourth version of the truth.
2. A deliberately-introduced type error fails CI (proves `mypy --strict` is
   actually wired, not just listed).
3. One real issue completes SELECT → merged sub-PR with zero human messages,
   and the PR body is readable on a phone.
4. One issue hits a §3.1 stop condition and *stops*, with a legible reason —
   the loop failing safely is as important as the loop succeeding.
5. `/improve-codebase-architecture` findings appear as `needs-triage` issues,
   not as direct commits.

---

## 7. Open questions

1. **Which model runs PM?** `WORKFLOW.md` §5 is written "with an eye toward
   using Fable as PM" and justifies the one-level orchestration cap on that
   cost basis. Worth confirming — the cap's rationale weakens if PM runs
   cheaper, and the §3 loop's economics change with it.
2. **Does the `thermo-nuclear` review move to CI?** §1.3 says it must go
   somewhere environment-agnostic. CI is the obvious home but adds per-PR cost.
3. **Autonomous merge on sub-PRs — on from day one, or after a probation
   period?** Recommend probation: run the loop with merge disabled for the
   first ~5 issues, confirm the PRs would have been mergeable, then enable.
4. **Playwright screenshots in-repo or as CI artifacts?** `docs/media/` keeps
   them linkable from PR bodies forever but grows the repo. Artifacts are
   cheaper but expire.
