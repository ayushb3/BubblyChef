#!/usr/bin/env bash
# Merge PRs one at a time as bubblychef-bot, respecting the "branch must be up to date"
# ruleset: for each PR, update the branch if it's behind, wait for every check to finish,
# and merge only if nothing failed. Stops at the first PR that isn't green.
# usage: merge-queue-novercel.sh <pr> [<pr> ...]
set -u
# Serialize concurrent queue runs (pgrep isn't available in this Git Bash). mkdir is atomic.
LOCK="$(dirname "$0")/.merge-queue.lock"
for _ in $(seq 1 360); do mkdir "$LOCK" 2>/dev/null && break; sleep 10; done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
export GH_CONFIG_DIR="${GH_CONFIG_DIR:-$HOME/.config/gh-bubblychef-bot}"
REPO="${REPO:-ayushb3/BubblyChef}"

wait_checks() {  # $1 = pr; echo "ok" when all checks are done and none failed
  local n="$1" i pending failed
  for i in $(seq 1 60); do
    sleep 20
    pending=$(gh pr checks "$n" --repo "$REPO" --json state --jq '[.[]|select(.state=="PENDING" or .state=="QUEUED" or .state=="IN_PROGRESS")]|length' 2>/dev/null || echo 1)
    [ "$pending" = "0" ] && break
  done
  # Any non-passing state counts as failed, not just FAILURE/ERROR/CANCELLED
  # -- TIMED_OUT, ACTION_REQUIRED and STALE are also not a pass. Sibling fix
  # alongside wait-review.sh's equivalent check, both from the PR #636
  # round-1 review (finding 4: the two scripts must agree on "failed").
  failed=$(gh pr checks "$n" --repo "$REPO" --json name,state --jq '[.[]|select((.state=="FAILURE" or .state=="ERROR" or .state=="CANCELLED" or .state=="TIMED_OUT" or .state=="ACTION_REQUIRED" or .state=="STALE") and (.name|startswith("Vercel")|not))|.name]|join(", ")')
  if [ -n "$failed" ]; then echo "failed: $failed"; else echo ok; fi
}

merge_state() { gh pr view "$1" --repo "$REPO" --json mergeStateStatus --jq .mergeStateStatus; }

for n in "$@"; do
  echo "== PR #$n"
  if [ "$(gh pr view "$n" --repo "$REPO" --json state --jq .state)" = "MERGED" ]; then echo "  already merged"; continue; fi
  merged=0
  for attempt in 1 2 3 4; do
    # GitHub reports UNKNOWN for a while after another PR merges; wait it out.
    ms=$(merge_state "$n"); for _ in 1 2 3 4 5 6; do [ "$ms" != "UNKNOWN" ] && break; sleep 10; ms=$(merge_state "$n"); done
    echo "  attempt $attempt: $ms"
    if [ "$ms" = "BEHIND" ]; then
      # Let a running Claude review finish first: an update push cancels it (concurrency),
      # and a base-only merge doesn't re-trigger a full review.
      wait_checks "$n" >/dev/null
      gh api -X PUT "repos/$REPO/pulls/$n/update-branch" --jq .message >/dev/null && echo "  branch updated"; sleep 15
    fi
    r=$(wait_checks "$n"); echo "  checks: $r"
    if [ "$r" != "ok" ]; then echo "  STOP: not merging #$n"; exit 1; fi
    if gh pr merge "$n" --repo "$REPO" --merge >/dev/null 2>&1; then echo "  MERGED #$n"; merged=1; break; fi
    echo "  merge refused ($(merge_state "$n")), retrying"
  done
  [ $merged = 1 ] || { echo "  gave up on #$n"; exit 1; }
done
echo "queue done"
