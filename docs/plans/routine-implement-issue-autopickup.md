# Routine: auto-pickup of the `ready-for-agent` queue via `/implement-issue`

*Spec / design — 2026-08-30. Discussion doc, not yet built. Companion to
`docs/plans/shiny-watching-feigenbaum.md` (which shipped the `/implement-issue`
skill in PR #294) and to task D of that work.*

## Context

`/implement-issue` (`.claude/skills/implement-issue/SKILL.md`) closes the
execution gap: it picks the top `ready-for-agent` issue, branches, delegates to a
dev role, runs the gates, and opens a draft PR. Today it's invoked by hand. This
doc specs the **Routine** that would fire it on a cadence so the queue drains
without a human kicking each run — and, more importantly, the guardrails without
which an unattended loop is a footgun.

The skill already self-limits (only `ready-for-agent`; skips issues with an
existing PR/branch; leaves feature-level PRs as draft for the human). The Routine
adds the missing pieces: concurrency control, an atomic claim so two runs can't
grab the same issue, and a reaper so a dead run doesn't strand an issue.

**Recommendation up front:** do not cron this yet. Run `/implement-issue` by hand
a few times first (the current bg dry-run on #223 is the first such exercise).
Wire the cadence only after the guards below exist and the manual runs feel clean.

## The failure modes (why guards are mandatory)

1. **Double-pickup / no lease.** Two runs (tick + tick, or tick + human) read the
   queue, both see the same issue, both branch it. The PR/branch check narrows the
   window but does not close it — there's no atomic claim between "read queue" and
   "push branch".
2. **Poison ticket.** An issue whose gates can't pass (flaky test, underspecified)
   is re-attempted every tick forever — branch/PR spam, wasted spend, no progress.
3. **Draft-PR pileup.** Feature-level PRs correctly wait for the human; a slow
   reviewer plus a daily robot produces a rotting stack.
4. **Mislabel blast radius.** A wrongly-applied `ready-for-agent` on something
   destructive is acted on with no human in the loop.
5. **Cost.** Unattended PM-tier runs fanning to dev subagents, on a clock, with no
   ceiling.
6. **Dead-claim leak.** A run claims an issue then dies mid-build; the issue is
   now stuck out-of-queue and nobody picks it up. (Created by the claim fix below
   — the reaper exists to undo it.)

## Guard stack

Four layers, each closing what the one above leaves open:

```
single-flight   — no two runs at once (kills most of the race)
  → label claim  — visible, drops the issue out of the ready-for-agent queue
    → branch-push-wins — the actual atomic backstop if two ever race
      → stale reaper   — returns dead claims to the queue
```

### 1. Single-flight (Routine level)

A tick does not fire if a run is already in progress. This alone removes ~90% of
the double-pickup risk at near-zero cost, because concurrency is the root of the
race. Cheapest, strongest single guard — do this first.

### 2. Label claim (skill level, at pickup)

The moment an issue is chosen, stamp it so it leaves the queue immediately:

```bash
gh issue edit <n> --add-label in-progress --remove-label ready-for-agent
gh issue comment <n> --body "🤖 claimed by run <run-id> at <iso-ts>"
```

- The next tick's `gh issue list --label ready-for-agent` won't even see it.
- Visible in the GitHub UI; a human sees it's taken.
- The `🤖 claimed by run` marker is what the reaper keys on (never touch a bare
  `in-progress` a human set — see reaper edge 4).

The label edit is **not** atomic against the queue read, so it's a strong signal,
not a true lock. That's what layer 3 is for.

### 3. Branch-push-wins (atomic backstop)

`git push` of `fix/issue-<n>-*` fails if the ref already exists / isn't a
fast-forward. First push wins; the loser sees the reject and bails to the next
issue. The git ref is the atomic primitive we don't otherwise have.

**Claim-then-verify:** before opening the PR, the run re-reads the issue and
confirms *its own* `run-id` still holds the claim. If another marker appeared
(reaper returned it and someone else grabbed it), bail loudly rather than open a
PR on an issue that's moved on.

### 4. Stale reaper (its own small cadence, ~every 30 min, single-flight)

Returns dead claims to the queue. The hard question is "dead or just slow?" —
answered by signals, not a bare timeout:

```
for each issue labelled in-progress AND carrying a 🤖 claim marker:
    pr        = open PR referencing issue <n>?
    branch    = remote branch */issue-<n>-* exists?
    commit_age= age of newest commit on that branch (if any)
    beat_age  = age of the newest 🤖 heartbeat/claim comment

    alive = pr_exists OR (branch AND commit_age < STALE_WINDOW)
    if (not alive) AND (beat_age > TIMEOUT):
        gh issue edit <n> --remove-label in-progress --add-label ready-for-agent
        gh issue comment <n> --body "🧹 claim expired (no PR/active branch in <TIMEOUT>), returned to queue"
```

Knobs: `TIMEOUT` ≈ 2h (grace so a slow-but-live build isn't yanked);
`STALE_WINDOW` ≈ 45m of no new commits on an existing branch = probably abandoned.

**Heartbeat is the unlock.** While building, the run drops a `🤖` heartbeat
comment every ~10 min. The reaper reads the *freshest* beat, not the original
claim — so "did it die?" becomes "when did it last breathe," and you can reap fast
without ever yanking a live build. Without a heartbeat there's no timeout value
that's both safe and useful.

Reaper edges it must not create:
1. **Yank mid-build** → two runs on one issue. Prevented by `alive` leaning on
   PR-exists + recent-commit + heartbeat, not raw time.
2. **Flip-flop** → run finishes late, opens a PR on an issue already re-queued and
   re-grabbed. Prevented by the claim-then-verify in layer 3.
3. **Reaper racing itself** → same single-flight rule, one reaper at a time.
4. **Eats a human's WIP** → only reap issues carrying the `🤖 claimed by run`
   marker; never a bare `in-progress` a human applied.

## Other guards (independent of the lock stack)

- **Per-run cap of 1** issue (already the skill's behaviour) + a **per-day cap** on
  total runs.
- **Skip-on-repeated-failure:** if the same issue failed its gates on the last N
  ticks, stop retrying and relabel `needs-human` (kills the poison ticket).
- **Outstanding-draft cap:** stop picking up new work once M feature-level draft
  PRs are awaiting the human (kills the pileup).
- **Token budget ceiling** per run.
- **Autonomy gate stays as-is (WORKFLOW.md §6):** sub-PRs auto-advance on green;
  feature-level always waits.

## Cadence sketch

- Off-peak minute, not on the hour (e.g. `17 9 * * 1-5` — weekday-morning tick).
- Builder Routine: single-flight, one issue per tick.
- Reaper Routine: separate, ~every 30 min, single-flight.
- Prefer a **manual/opt-in trigger first**; enable the cadence only once the guard
  stack above is in place and manual runs are clean.

## #223 dry-run result (2026-08-30)

First manual exercise of `/implement-issue`, run as a background agent against #223
("size adjectives stored as units"). **Passed end-to-end**, unattended:

- Picked #223, branched `fix/issue-223-size-adjective-units`, delegated to `backend`,
  stayed one level deep.
- TDD: 8 tests written red, then the fix (match-time repair + write-time validator),
  then green. Root-cause fix (the dict ingredient path bypassed the adjective regex),
  not a symptom patch.
- Gates: `pytest` 489 passed, `ruff` clean, `tsc` correctly skipped (no `nextjs/`
  changes). Opened **draft PR #295** with `Fixes #223` on its own line, siblings
  (#222/#6) listed under Out of scope. Left as draft for the human — correct.

**Gap it surfaced:** the skill says nothing about keeping the working branch current,
and the agent chose to *merge* `main` into the branch rather than rebase — leaving a
merge commit on a feature branch before it even lands. Harmless here, but the skill
should state the branch-currency policy (rebase on `main`, don't merge into the
feature branch) so the history stays linear.

## Open questions (some resolved by the #223 dry-run above)

- ~~Does the skill execute cleanly end-to-end by hand?~~ **Yes** — #223 confirmed it.
- Where does single-flight live — a Routine-level construct, or a lockfile/label
  the skill checks on entry?
- Is a GitHub label the right claim medium, or should the claim live somewhere the
  skill controls more tightly (a lock issue, a branch ref)?
- Heartbeat cadence vs. comment-spam on the issue — 10 min may be noisy; consider
  editing a single pinned comment instead of appending.
