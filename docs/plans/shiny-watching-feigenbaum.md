# Fix the agent-workflow tooling gap: vendor skills, reconcile docs, add a pickup skill

*Plan — 2026-08-30. Branch off `main`. Three commits (A/B/C), one draft PR.*

## Context

Planning-phase skills work; implementation stalls. Root cause: the mattpocock
skill set is a **pointer, not content**. `skills-lock.json` on `main` pins 12
skills by reference but nothing is committed under `.claude/skills/`, so a fresh
clone / CI job / Claude-on-web session resolves **zero** of them and every
`/tdd`, `/triage`, `/implement` silently no-ops. Planning is done locally (skills
present in `~/.claude/skills`); implementation gets kicked to remote sessions
(skills absent). That asymmetry is the stall.

Two more defects compound it:
- `main`'s lock has **drifted from upstream** — four renames missed
  (`to-prd`→`to-spec`, `to-issues`→`to-tickets`, `zoom-out`→`wayfinder`,
  `diagnose`→`diagnosing-bugs`) and the build/review skills (`implement`,
  `code-review`, `wayfinder`, `how`, `why`, …) never pinned at all.
- `WORKFLOW.md` §9 and `CLAUDE.md` document skills that don't exist in the lock,
  so the docs tell you to type commands that fail.

### Recon finding that changes the approach (verified, not assumed)

**A+B are already done** on `origin/claude/project-status-gamification-cpn7rg`
(vendor commit `8331eb8`, realign `3f63ae8`): 27 skills vendored to
`.claude/skills/` with support files, `skills-lock.json` regenerated (renames
applied, per-skill hashes, dual upstream sources `mattpocock/skills` +
`cursor/plugins`), and `WORKFLOW.md §9`/`CLAUDE.md` rewritten. **All 27
`SKILL.md` blobs on that branch hash-match their `computedHash` in its lock** —
verified this session, so the files are trustworthy to copy.

That branch **never merged to main** and bundles ~20 unrelated commits
(gamification, UI overhaul, Playwright CI, mypy-strict work). Merging it whole is
out of scope. **Decision (confirmed with owner): lift only the skill + doc files
from it onto a clean branch; leave the rest behind.** The branch named in the
original brief (`claude/math-pocox-workflow-re7v8d`) does not exist — ignore it.

`implement-issue` (task C) does **not** exist on the orphan branch. Upstream
`implement` is generic ("implement the spec/tickets, use /tdd, /code-review,
commit") — no queue pickup, no branch convention, no draft-PR/autonomy gate. C is
genuinely new and project-specific.

## Approach

New branch: `feat/workflow-vendor-skills` off `origin/main`. Three separate
commits, pushed, one **draft** PR.

### Commit A — vendor the skills (lift from orphan branch)

Restore exactly the skill tree + lock from the orphan branch, nothing else:

```bash
O=origin/claude/project-status-gamification-cpn7rg
git checkout $O -- .claude/skills/ skills-lock.json
```

- Brings in **85 files** under `.claude/skills/` (27 `SKILL.md` + 58 support
  files: `agents/openai.yaml`, `references/`, `tdd/mocking.md`, etc.) plus the
  regenerated root `skills-lock.json` (27 entries, dual-source, per-skill hashes).
- `nextjs/skills-lock.json` is byte-identical on main and orphan — leave it.
- **Post-restore verification** (must pass before commit): recompute
  `sha256(SKILL.md)` for each entry and diff against `computedHash` in the
  restored lock. Confirmed 0 mismatches / 0 missing this session; re-run as a
  guard.

Upstream reconciliation the lift already encodes (confirmed against the orphan
lock's `skillPath`s): renames done; `implement`, `wayfinder`, `how`, `why` now
exist upstream and are included (`how`/`why`/`blast-radius`/`interrogate`/
`thermo-nuclear-review` sourced from `cursor/plugins` `pstack/`+`thermos/`).

Commit message notes the lift provenance (orphan branch + upstream commit the
lock records) so drift stays traceable.

### Commit B — reconcile the docs

Lift the reconciled `WORKFLOW.md` and `CLAUDE.md` from the orphan branch, which
already rewrite the two stale sections:

```bash
git checkout $O -- WORKFLOW.md CLAUDE.md
```

Then reapply, on top of the lift, anything the orphan changed that is **out of
scope here** (gamification/ROADMAP wording) — i.e. do a *selective* checkout:
inspect `git diff origin/main..$O -- WORKFLOW.md CLAUDE.md`, take only the §9
skill-map rewrite + `CLAUDE.md` "Agent skills"/"For larger initiatives" edits,
and hand-merge if the orphan's copies carry unrelated drift. (Diff reviewed this
session — the WORKFLOW change is §9-only + a new §9.1; CLAUDE change is the
"Agent skills" block. Clean to take wholesale, but verify at apply time.)

What the reconciled docs assert (already written on the orphan branch):
- §9 skill map lists **only vendored skills**, each tagged `✅ vendored`.
- New **§9.1** explains why (pointer≠content) and flags the one thing still
  broken: the `thermo-nuclear` `PreToolUse` hook triggers on `gh pr create` and
  won't fire when PRs are made via GitHub MCP tools — move to CI or add an MCP
  trigger. Left as a documented gap, not fixed here.
- `CLAUDE.md` "Agent skills" + "For larger initiatives" name only skills that now
  exist; `/wayfinder`, `/to-spec`, `/to-tickets`, `/implement` all resolve.

**Additional edit for this task (not on orphan):** add `implement-issue` to §9's
map (Build layer, tagged as the project pickup skill) and note the C-skill
divergence in the WORKFLOW.md footer per its own instruction ("if it does, note
the divergence here rather than silently drifting").

### Commit C — author `.claude/skills/implement-issue/SKILL.md` (new)

A real project skill (not a doc) that closes the execution gap by codifying the
workflow already specified, not inventing process. Frontmatter `description`
tuned to trigger on "pick up an issue / work the ready-for-agent queue / implement
the next issue".

Body codifies:
1. **Pick** highest-priority open issue labelled `ready-for-agent`
   (`gh issue list --label ready-for-agent --state open`). Never touch
   `needs-triage`/`needs-info` (WORKFLOW §2).
2. **Branch** `feat/issue-<n>-<slug>` or `fix/issue-<n>-<slug>` (§4).
3. **Context then delegate** to `backend`/`frontend`/`ui-ux` subagents per
   ownership in `.claude/agents/` + `docs/agents/roles/`. Respect the
   one-level orchestration cap (§5) — dev roles do **not** spawn subagents.
4. **Quality gates before commit** (from CLAUDE.md):
   ```bash
   cd ai-service && pytest && ruff check bubbly_chef/
   cd nextjs && npx tsc --noEmit
   ```
   `mypy --strict` is **advisory, not a gate** — 73 known errors (#128), not in
   CI. State this explicitly in the skill (owner-confirmed).
5. **Draft PR** with `Fixes #<n>` on its own line, one keyword per issue
   (CLAUDE.md is emphatic; #251 regressed by burying numbers in prose).
6. **Autonomy gate (§6):** sub-PRs may merge on green; feature-level PRs wait for
   the human. Skill stops at draft PR + summary for feature-level work.

Worked-example sanity check (in-skill or PR body, **do not implement**): #223
"Size adjectives stored as units" — clean backend bug → branch
`fix/issue-223-size-adjective-units`, delegate to `backend`, gates =
pytest+ruff+tsc. Confirms the skill reads coherently end-to-end.

### Not in this PR — the Routine (task D, discussion only)

Task D is "tell me, don't build." Deliver as prose in the PR body / chat, not
code. Sketch: a scheduled Routine firing `/implement-issue` on a cadence against
the `ready-for-agent` queue. Risks to name: double-pickup / no lease on an issue
already in flight; unbounded fan-out if queue is deep; feature-level PRs piling up
awaiting human gate; a failing issue retried forever; branch/PR spam; acting on a
mislabeled issue; cost of unattended Opus runs. Recommend: single-flight lock,
skip issues with an open PR, cap N per run, and only auto-advance sub-PRs.

## Critical files

| File | Change |
|---|---|
| `.claude/skills/**` (85 files) | Commit A — restored from orphan branch |
| `skills-lock.json` | Commit A — restored (27 entries, hash-verified) |
| `WORKFLOW.md` | Commit B — §9 rewrite + §9.1 + footer divergence note + `implement-issue` in map |
| `CLAUDE.md` | Commit B — "Agent skills" + "For larger initiatives" reconciled |
| `.claude/skills/implement-issue/SKILL.md` | Commit C — new project skill |

## Verification

1. **Hash integrity (A):** re-run the sha256-vs-`computedHash` check over all 27
   entries — expect 0 mismatch, 0 missing (passed this session).
2. **Docs resolve (B):** every skill named in the reconciled `WORKFLOW.md §9` and
   `CLAUDE.md` has a matching `.claude/skills/<name>/SKILL.md`. Grep the doc for
   backticked skill names, assert each dir exists.
3. **Skill triggers (C):** `SKILL.md` frontmatter parses; description phrasing
   would trigger on "work the next ready-for-agent issue".
4. **Dry-run trace (C):** walk #223 through the skill's steps on paper — branch
   name, delegate target, gate set, PR body keyword — without implementing.
5. **No scope leak:** `git diff origin/main..HEAD --stat` shows only the five
   file groups above — no gamification/UI/CI files from the orphan branch.
6. **PR hygiene:** draft PR; body has `Fixes`/`Related to` per CLAUDE.md rules;
   no `Reviewers` section, no tracker IDs (per user's PR conventions).
