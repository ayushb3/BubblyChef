#!/usr/bin/env bash
# usage: wait-review.sh <pr>  — waits (max ~40 min) until CI (non-Vercel) is done on the PR head AND a claude[bot]
# comment newer than the head commit exists; prints the checks summary + the parsed verdict.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
n="$1"
REPO="${REPO:-ayushb3/BubblyChef}"
sha=$(gh api "repos/$REPO/pulls/$n" --jq .head.sha); t=$(gh api "repos/$REPO/commits/$sha" --jq .commit.committer.date)
for i in $(seq 1 40); do
  pend=$(gh api "repos/$REPO/commits/$sha/check-runs?per_page=100" --jq '[.check_runs[]|select((.name|startswith("Vercel")|not) and .status!="completed")]|length')
  body=$(gh api "repos/$REPO/issues/$n/comments?per_page=100" --jq "[.[]|select(.user.login==\"claude[bot]\" and .created_at > \"$t\")][-1].body // empty")
  [ "$pend" = "0" ] && [ -n "$body" ] && break
  sleep 60
done
fail=$(gh api "repos/$REPO/commits/$sha/check-runs?per_page=100" --jq '[.check_runs[]|select((.name|startswith("Vercel")|not) and (.conclusion=="failure"))|.name]|join(",")')
verdict="<none yet>"
[ -n "${body:-}" ] && verdict=$(printf '%s' "$body" | "$DIR/parse-verdict.sh")
echo "PR #$n head=${sha:0:7} pending=$pend failed=[$fail]"
echo "VERDICT: $verdict"
