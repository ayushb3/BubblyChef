# scripts/merge/

Bash scripts for the agent loop's "wait for review, merge only if it's
actually mergeable" step. Moved here from session scratchpads (issue #624) so
they survive past the session that wrote them — a scratchpad dies with its
session.

Not a CODEOWNERS path. `scripts/agent-gates/` is a separate, CODEOWNERS-gated
directory (the in-repo merge *gate*); these scripts are the *queue runner*
that agents invoke by hand or from the loop, and they are independent of it.

## Scripts

- **`parse-verdict.sh`** — reads a review body (e.g. a `claude[bot]` PR/issue
  comment) on stdin, prints one of `looks-mergeable`, `needs-changes`,
  `needs-human`, `unknown`. An explicit `<!-- verdict: X -->` HTML marker, if
  present, wins over any prose. Otherwise it looks for an actual verdict
  statement — a line naming "Verdict", or a heading that itself carries one
  of the three phrases — and never treats an incidental use of a word like
  "mergeable" in ordinary prose as the verdict. See the script's header
  comment for the full precedence rules and the PR #619 incident that
  motivated the narrow matching.

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
  hands it to `merge-queue-novercel.sh` when nothing failed AND the verdict
  is exactly `looks-mergeable`. Anything else (`needs-changes`,
  `needs-human`, `unknown`, or a still-failing check) is reported as
  `NOT QUEUED #<pr>` and left alone.

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

| Fixture | Source | Expected |
|---|---|---|
| `619-preamble-then-needs-changes.txt` | issue #619 comments — the PR #619 incident: "auto-mergeable once checks pass" in the preamble, real verdict is `needs changes` | `needs-changes` |
| `569-round3-looks-mergeable.txt` | issue #569, round-3 re-review — verdict lives only in the heading (`` ## Re-review (round 3) — `looks mergeable` ``), no `Verdict:` label | `looks-mergeable` |
| `552-needs-a-human.txt` | issue #552 comments — plain `**Verdict: needs a human**` | `needs-human` |
| `marker-wins-over-prose.txt` | synthetic — `<!-- verdict: looks-mergeable -->` marker contradicts the surrounding prose | `looks-mergeable` |
| `no-verdict.txt` | synthetic — no verdict statement at all | `unknown` |

The marker and no-verdict fixtures are synthetic because the `<!-- verdict:
... -->` marker format doesn't exist in any past review yet (it's the
structured-output change tracked against `.github/workflows/claude-review.yml`
mentioned in issue #624); once real marker comments exist, prefer swapping in
a real one.

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
- The structured `<!-- verdict: X -->` marker format is new; no review has
  ever emitted one, so `claude-review.yml` doesn't produce it yet (tracked
  separately per issue #624's own text). `parse-verdict.sh` supports it so
  the review workflow can adopt it later without another change here.
