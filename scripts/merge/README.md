# scripts/merge/

Bash scripts for the agent loop's "wait for review, merge only if it's
actually mergeable" step. Moved here from session scratchpads (issue #624) so
they survive past the session that wrote them — a scratchpad dies with its
session.

This directory holds the logic that decides whether a PR merges on a Claude
verdict, separate from the in-repo merge *gate* in `scripts/agent-gates/`. Both
were CODEOWNERS paths until issue #640 removed that file; a PR that changes
either is now named in the sprint doc instead (`WORKFLOW.md` §6).

## Scripts

- **`parse-verdict.sh`** — reads a review body (e.g. a `claude[bot]` PR/issue
  comment) on stdin, prints one of `looks-mergeable`, `needs-changes`,
  `needs-human`, `unknown`.

  This is a thin wrapper: all verdict-parsing RULES live in
  `scripts/agent-gates/review-verdict.cjs`'s `parseVerdict()` — the single
  source of truth. Its
  parser is unit-tested and already runs as the required "Claude review
  verdict" check on every agent-loop PR
  (`.github/workflows/claude-review.yml`). This script exists so the
  agent-writable merge queue in this directory reads a review body the exact
  same way the protected merge gate does, instead of maintaining a second,
  independently-evolved rule here (PR #636 round-3 review: an earlier
  version of this script had its own heading rule, `<!-- verdict: X -->`
  marker handling, fence/blockquote skipping, and a
  most-restrictive-across-lines precedence ladder built up over three review
  rounds — all deleted in favour of deferring to `review-verdict.cjs`).

  `review-verdict.cjs`'s rule, briefly (see that file for the exact spec). A
  review comment can state its verdict in three places, and every one that is
  present must agree or the comment is unreadable: the value after the LAST
  literal `Verdict:` label (any case, bold/backticked or not), a
  `<!-- verdict: looks-mergeable -->` marker line outside a code fence, and a
  heading that ends in the verdict (`## Re-review (round 3) - looks mergeable`).
  A value only counts when it is EXACTLY `looks mergeable`, `needs changes` or
  `needs a human` (marker tokens: `looks-mergeable`, `needs-changes`,
  `needs-human`). Anything else comes back unreadable, mapped to `unknown`
  here. `guarded-merge.sh` requires the literal string
  `VERDICT: looks-mergeable` to queue a merge, so `unknown` is NOT mergeable,
  same as `needs-changes` and `needs-human`: every case the parser can't read
  still fails closed. The agent loop's Respond stage (`.claude/workflows/
  agent-loop.js`) reads the GitHub review through this same script, so the
  loop, this merge queue and the required check never disagree about a verdict.

  ```bash
  scripts/merge/parse-verdict.sh < review-body.txt
  gh api repos/ayushb3/BubblyChef/issues/619/comments \
    --jq '.[]|select(.user.login=="claude[bot]")|.body' \
    | scripts/merge/parse-verdict.sh
  ```

- **`wait-review.sh <pr>`** — polls (up to ~40 minutes) until every non-Vercel
  check on the PR's head commit has finished AND a `claude[bot]` comment
  newer than the head commit exists. Prints a one-line check summary plus
  `VERDICT: <token>` from `parse-verdict.sh`.

  ```bash
  scripts/merge/wait-review.sh 624
  ```

- **`guarded-merge.sh <pr>...`** — for each PR, runs `wait-review.sh` and only
  hands it to `merge-queue-novercel.sh` when checks finished with nothing
  pending (`pending=0`), nothing failed (`failed=[]`), AND the verdict is
  exactly `looks-mergeable`. Anything else (`needs-changes`, `needs-human`,
  `unknown`, a still-failing check, or a `wait-review.sh` timeout with checks
  still in flight) is reported as `NOT QUEUED #<pr>` and left alone.

  ```bash
  scripts/merge/guarded-merge.sh 624 625
  ```

- **`merge-queue-novercel.sh <pr>...`** — the actual merge runner. Updates a
  behind branch, waits for every non-Vercel check to go green, and merges via
  `gh pr merge --merge`, as `bubblychef-bot` (`GH_CONFIG_DIR` is set inside
  the script). Stops at the first PR that isn't green. This is the one script
  in the set that performs the merge — `guarded-merge.sh` is what gates the
  call into it.

- **`test-parse-verdict.sh`** — fixture test runner for `parse-verdict.sh`
  (see below).

All scripts resolve their own directory with `dirname "$0"` and call each
other by that path, so they work from any working directory and don't
hardcode a scratchpad or checkout location.

## Fixture tests

```bash
scripts/merge/test-parse-verdict.sh
```

Plain bash, no test framework or new dependency — it feeds each file under
`fixtures/` to `parse-verdict.sh` and diffs stdout against the expected
token. Fixtures 1–3 are real `claude[bot]` review bodies pulled with:

```bash
gh api repos/ayushb3/BubblyChef/issues/<n>/comments \
  --jq '.[]|select(.user.login|startswith("claude"))|.body'
```

| Fixture | Source | Expected (from `review-verdict.cjs`) |
|---|---|---|
| `619-preamble-then-needs-changes.txt` | issue #619 comments — the PR #619 incident: "auto-mergeable once checks pass" in the preamble, real verdict is `needs changes` | `needs-changes` |
| `569-round3-looks-mergeable.txt` | issue #569, round-3 re-review — verdict lives only in the heading (`` ## Re-review (round 3) — `looks mergeable` ``), no `Verdict:` label | `looks-mergeable` — read from the heading (issue #571) |
| `552-needs-a-human.txt` | issue #552 comments — plain `**Verdict: needs a human**` | `needs-human` |
| `marker-disagrees-fails-closed.txt` | synthetic — a `<!-- verdict: looks-mergeable -->` marker vs. an explicit `**Verdict: needs changes**` line with trailing parenthetical prose | `unknown` — the label's value carries trailing prose, so it isn't an exact phrase match, and the marker disagrees with it |
| `no-verdict.txt` | synthetic — no verdict statement at all | `unknown` |
| `tldr-mentions-both-phrases.txt` | synthetic, from the PR #636 round-1 review's own example — a trailing TL;DR line names both `needs changes` and `looks mergeable`, no literal `Verdict:` label anywhere | `needs-changes` — read from the `## Re-review — needs changes` heading; the TL;DR prose is not a source |
| `line-mentions-human-and-mergeable.txt` | synthetic — a single `Verdict:`-labelled line whose value is a full sentence, not one of the three phrases verbatim | `unknown` — not an exact phrase match |
| `marker-in-backticks-ignored.txt` | synthetic — the marker appears only as an inline, backtick-quoted documentation example; the real verdict is a plain `**Verdict: needs changes**` line | `needs-changes` |
| `marker-in-fence-ignored.txt` | synthetic — the marker appears only inside a ` ``` ` fenced code block as an illustration; the real verdict is `**Verdict: needs a human**` | `needs-human` |
| `top-needs-changes-later-quotes-mergeable.txt` | synthetic — a real `**Verdict: needs changes**` line, with a later line paraphrasing a prior round's verdict in prose (no `Verdict:` label on that line) | `needs-changes` |
| `fenced-verdict-example-plus-real-needs-human.txt` | synthetic — a fenced three-phrase template line ahead of a real `**Verdict: needs a human**` line | `needs-human` |
| `blockquoted-prior-verdict-ignored.txt` | synthetic — a blockquoted three-phrase template line ahead of a real `**Verdict: looks mergeable**` line | `looks-mergeable` |

These expectations are what `scripts/agent-gates/review-verdict.cjs`'s
`parseVerdict()` actually returns for each fixture, and `test-parse-verdict.sh`
(which also covers the marker and heading cases added for issue #571) checks
them. Where the parser cannot read a comment it answers `unknown`, which is
still fail-closed (`guarded-merge.sh` only queues on the literal
`VERDICT: looks-mergeable`). The last three table rows have a real `Verdict:`
line that happens to come after a fenced/blockquoted/prose mention of the
phrases elsewhere in the body; they pass because the last label wins, not
because the parser skips fences or blockquotes for the label.

The marker, TL;DR/multi-phrase and no-verdict fixtures are synthetic because
the multi-phrase-per-line cases are deliberately constructed edge cases; once
real examples exist, prefer swapping in a real one.

## Re-review workaround

`claude-review.yml`'s concurrency group only re-runs a fresh review on a new
commit — closing and reopening a PR is the workaround to force one without
pushing an empty commit:

```bash
gh pr close <n>; sleep 25; gh pr reopen <n>
```

The 25-second pause gives GitHub's webhook delivery time to settle before the
reopen event fires; reopening immediately after close has occasionally raced
and dropped the reopen event.

## Not covered

- `merge-queue-novercel.sh`'s own logic (branch-update loop, lock file,
  retry-on-`UNKNOWN`) is unchanged from the scratchpad version and untested
  here — only `parse-verdict.sh` has fixture coverage. It didn't have any
  hardcoded scratchpad paths to begin with (its lock file was already
  `dirname "$0"`-relative), so nothing needed moving inside it beyond the
  `REPO`/`GH_CONFIG_DIR` override.
- None of the four scripts were run end-to-end against a live PR in this
  change — only `parse-verdict.sh` was exercised, via the fixture suite.
- The fixture suite (`test-parse-verdict.sh`) isn't wired into CI; it runs
  only by hand. Wiring it in is a `.github/` change.
