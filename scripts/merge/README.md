# scripts/merge/

Bash scripts for the agent loop's "wait for review, merge only if it's
actually mergeable" step. Moved here from session scratchpads (issue #624) so
they survive past the session that wrote them — a scratchpad dies with its
session.

A CODEOWNERS path (PR #638): this directory holds the logic that decides
whether a PR merges on a Claude verdict, which is the same "an agent that can
edit its own gates can remove them" rationale that already protects
`scripts/agent-gates/` (a separate, CODEOWNERS-gated directory — the in-repo
merge *gate*, independent of the *queue runner* here).

## Scripts

- **`parse-verdict.sh`** — reads a review body (e.g. a `claude[bot]` PR/issue
  comment) on stdin, prints one of `looks-mergeable`, `needs-changes`,
  `needs-human`, `unknown`.

  This is a thin wrapper: all verdict-parsing RULES live in
  `scripts/agent-gates/review-verdict.cjs`'s `parseVerdict()` — the single
  source of truth. That directory is CODEOWNERS-protected (#638) and its
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

  `review-verdict.cjs`'s rule, briefly (see that file for the exact spec):
  the value after the LAST literal `Verdict:` label anywhere in the body
  (any case, bold/backticked or not — it does not skip fenced code blocks or
  blockquotes), and only when that value is EXACTLY one of `looks mergeable`,
  `needs changes`, `needs a human`. Anything else — no `Verdict:` label at
  all, an HTML marker (not a concept this parser has), or a verdict phrase
  followed by other prose on the same line — comes back unreadable, mapped
  to `unknown` here. `guarded-merge.sh` requires the literal string
  `VERDICT: looks-mergeable` to queue a merge, so `unknown` is NOT mergeable,
  same as `needs-changes` and `needs-human`: every case the protected parser
  can't read still fails closed. This is stricter than the old shell-side
  parser in a few cases (a heading-only verdict, a marker, a verdict phrase
  with trailing prose) — see `test-parse-verdict.sh` and PR #636's body for
  the fixture-by-fixture list of what changed.

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
| `569-round3-looks-mergeable.txt` | issue #569, round-3 re-review — verdict lives only in the heading (`` ## Re-review (round 3) — `looks mergeable` ``), no `Verdict:` label | `unknown` — no literal `Verdict:` label; the protected parser doesn't have a heading rule |
| `552-needs-a-human.txt` | issue #552 comments — plain `**Verdict: needs a human**` | `needs-human` |
| `marker-disagrees-fails-closed.txt` | synthetic — a `<!-- verdict: looks-mergeable -->` marker vs. an explicit `**Verdict: needs changes**` line with trailing parenthetical prose | `unknown` — the protected parser has no marker concept, and the prose value isn't an exact phrase match |
| `no-verdict.txt` | synthetic — no verdict statement at all | `unknown` |
| `tldr-mentions-both-phrases.txt` | synthetic, from the PR #636 round-1 review's own example — a trailing TL;DR line names both `needs changes` and `looks mergeable`, no literal `Verdict:` label anywhere | `unknown` — no `Verdict:` label to read |
| `line-mentions-human-and-mergeable.txt` | synthetic — a single `Verdict:`-labelled line whose value is a full sentence, not one of the three phrases verbatim | `unknown` — not an exact phrase match |
| `marker-in-backticks-ignored.txt` | synthetic — the marker appears only as an inline, backtick-quoted documentation example; the real verdict is a plain `**Verdict: needs changes**` line | `needs-changes` |
| `marker-in-fence-ignored.txt` | synthetic — the marker appears only inside a ` ``` ` fenced code block as an illustration; the real verdict is `**Verdict: needs a human**` | `needs-human` |
| `top-needs-changes-later-quotes-mergeable.txt` | synthetic — a real `**Verdict: needs changes**` line, with a later line paraphrasing a prior round's verdict in prose (no `Verdict:` label on that line) | `needs-changes` |
| `fenced-verdict-example-plus-real-needs-human.txt` | synthetic — a fenced three-phrase template line ahead of a real `**Verdict: needs a human**` line | `needs-human` |
| `blockquoted-prior-verdict-ignored.txt` | synthetic — a blockquoted three-phrase template line ahead of a real `**Verdict: looks mergeable**` line | `looks-mergeable` |

These expectations are what `scripts/agent-gates/review-verdict.cjs`'s
`parseVerdict()` actually returns for each fixture — not what the deleted
shell-side parser used to return. Four fixtures changed (`569-…`,
`marker-disagrees-…`, `tldr-…`, `line-mentions-…`): each used to resolve to a
real verdict under the old parser's heading rule, marker handling, or
multi-phrase-per-line handling, and now comes back `unknown` because
`review-verdict.cjs` has none of those — it only reads a literal `Verdict:`
label, and only accepts an exact phrase match. `unknown` is still
fail-closed (`guarded-merge.sh` only queues on the literal
`VERDICT: looks-mergeable`), so none of these four changes makes a bad PR
mergeable — they're strictly stricter reads. The last three fixtures (which
have real `Verdict:` lines that happen to come after a fenced/blockquoted/
prose mention of the phrases elsewhere in the body) still pass, but by
coincidence of "last matching line wins" rather than because the protected
parser skips fences or blockquotes — it doesn't skip either.

The marker, TL;DR/multi-phrase, and no-verdict fixtures are synthetic
because the `<!-- verdict: ... -->` marker format has never been emitted by
`claude-review.yml` (nothing in this repo produces one) and the
multi-phrase-per-line cases are deliberately constructed edge cases; once
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
- The stricter fail-closed rules built up across PR #636's rounds 1–2 (the
  `<!-- verdict: X -->` marker, the heading rule, fence/blockquote skipping,
  most-restrictive-across-lines precedence) are NOT ported into
  `review-verdict.cjs`. Deferring to that protected parser was the round-3
  decision, but it means those specific improvements exist only in this
  PR's git history now, not in the parser that's actually authoritative. If
  any of them are wanted, they're a follow-up PR against
  `scripts/agent-gates/review-verdict.cjs` itself — a CODEOWNERS path.
- No workflow emits a `<!-- verdict: X -->` marker (`claude-review.yml`
  doesn't produce one, and `review-verdict.cjs` doesn't read one either) —
  tracked separately as PR #637.
- The fixture suite (`test-parse-verdict.sh`) isn't wired into CI; it runs
  only by hand. Wiring it in is a `.github/` change.
