# Workflow improvements plan (approved by Ayush, 2026-09-27)

Source: §6 and the Day 2 section of `docs/plans/2026-09-23-loop-cost-report.md`. Ayush approved all six items (A–F) and a review-round cap of **3**.
Tracked as issues #622–#627.

## Items

### A (issue #622). Pre-implementation feasibility check. Unprotected: WORKFLOW.md + DEV-BRIEF. `.claude/skills/implement-issue` (not protected).
Before any dev agent is spawned, the orchestrator (or `/implement-issue`) checks three things:
- (1) The issue body and comments for "blocked by" / "depends on" pointing at an open issue.
- (2) Whether the likely files fall under CODEOWNERS paths.
- (3) Whether a product question is open in the triage comment with no answer.

Any hit means don't spawn. Route the issue to Ayush's pile instead, or pick the blocker.
**Why:** PR #617 was built on blocked issue #490. PR #614 and PR #616 needed product calls halfway through.
**Acceptance:** the WORKFLOW.md §5 checklist exists, the DEV-BRIEF hard stops point to it, and `implement-issue` runs it as step 0 (not protected; same PR).

### B (issue #623). Opus pre-PR edge-case review + round cap 3. Unprotected: WORKFLOW.md §7 + DEV-BRIEF.
- Before opening a PR, the dev agent runs a fresh-context Opus review. That means the `code-review` skill, or a general-purpose agent with `model: opus`, told to hunt for edge cases. Casing, duplicates, cross-user data, nulls and ordering are the #616 classes.
- When a finding lands, **fix the class, then sweep for siblings**: grep for the same pattern elsewhere in the diff before pushing.
- **Round cap:** after 3 Claude-review rounds that still produce new findings, stop. Post a summary comment listing the open findings, and escalate to Ayush. No 4th push without him.

**Why:** PR #616 took 5 rounds, each finding a new edge case from the same families.
**Acceptance:** WORKFLOW.md §7 states the cap and the sibling sweep, and the brief requires the Opus pass.

### C (issue #624). Merge scripts into the repo, with tests. Unprotected (`scripts/merge/`; only `scripts/agent-gates/` is in CODEOWNERS).
- Move `guarded-merge.sh`, `wait-review.sh` and `merge-queue-novercel.sh` into `scripts/merge/`. They currently sit in session scratchpads, listed under "Paths" in STATE.md.
- Base the verdict check on a structured marker rather than prose grep:
  - The review is asked to emit `<!-- verdict: looks-mergeable|needs-changes|needs-human -->`. That part touches `claude-review.yml` (protected), so pair it with D.
  - Meanwhile the script greps the `verdict` line only, which is the current fix.
- Add a fixture test covering: the #619 preamble ("auto-mergeable once checks pass" before a "needs changes" verdict) → must NOT merge; "looks mergeable" → merge; "needs a human" → hold.

**Why:** scripts in a scratchpad die with the session, and the #619 incident was an untested grep.

### D (issue #625). Re-review on every push for bot-authored PRs. PROTECTED (`.github/workflows/claude-review.yml`).
- Trigger `synchronize` when `github.event.pull_request.user.login == 'bubblychef-bot'`, not only for `agent-loop`-labelled PRs.
- Add the structured verdict marker from C.
- This retires the `close; sleep 25; reopen` workaround.
- Open as a PR for Ayush to review.

### E (issue #626, PR #628). Dev roles get the Skill tool. PROTECTED (`.claude/agents/*.md`).
- Add `Skill` to the `tools:` line for backend, frontend, ui-ux and qa-reviewer.
- Remove the backend role's "don't open PRs" line — none exists; the 2026-09-24 stall was agent caution, not a rule.
- Once merged, dev work can go back to role agents instead of `general-purpose`.
- Open as a PR for Ayush.

### F (issue #627). Fix-round hygiene + tooling. Mostly process; the Playwright part is existing issues.
- After 2 review rounds on a PR, the next fix goes to a **fresh** agent. It gets a narrow brief: the findings list, the diff, and the sibling-sweep instruction. It does not continue the long-lived implementer.
- Context: auto-compact is now 400k (Ayush set it via `/autocompact`). The orchestrator keeps STATE.md current so compaction is lossless enough. Manual handoff happens at a natural break when Ayush is present.
- Build the Playwright screenshot helper: issues #467 and #567. Check their current state first.

## Execution order
1. Commit this plan and file the six issues.
2. **One PR for A + B + F docs** (WORKFLOW.md §5 and §7, `implement-issue` §1.1 and §4.1). It's unprotected, so it merges under the ship-mode policy on "looks mergeable".
3. **PR for C.** Scripts + tests; the verdict marker is stubbed until D lands.
4. **PRs for D and E.** Protected, so they go to Ayush's pile.
5. F: update DEV-BRIEF / STATE.md now. Pick up #467 / #567 as normal queue work.
