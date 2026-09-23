#!/usr/bin/env bash
# Gate: a docs/refactor exemption from the F2P requirement must be TRUE, not claimed.
#
# WORKFLOW.md §7. The `no-f2p` label removes the fail-to-pass requirement. Left
# unchecked, every PR would wear it — self-declared exemptions are how a test
# requirement quietly becomes optional. So the label is only valid when the diff
# genuinely cannot change behaviour: docs and markdown only.
#
# Exit 0 = exemption absent or legitimate. Exit 1 = claimed but the diff touches code.
set -euo pipefail

BASE_SHA="${1:?usage: exemption-check.sh <base-sha> <head-sha> <labels-json>}"
HEAD_SHA="${2:?}"
LABELS="${3:-[]}"

# Judge the PR against its merge base, not the base branch's current tip. CI passes
# pull_request.base.sha (main *now*); a two-dot diff from there attributes files that
# landed on main after the branch point to this PR. See test-count-guard.sh (#609).
if MB=$(git merge-base "$BASE_SHA" "$HEAD_SHA" 2>/dev/null) && [ -n "$MB" ]; then
  if [ "$MB" != "$(git rev-parse "$BASE_SHA")" ]; then
    echo "Base $BASE_SHA is ahead of the branch point; comparing against merge base $MB."
  fi
  BASE_SHA="$MB"
fi

if ! printf '%s' "$LABELS" | grep -q '"no-f2p"'; then
  echo "no-f2p label absent — nothing to check."
  exit 0
fi

changed=$(git diff --name-only "$BASE_SHA" "$HEAD_SHA")
[ -n "$changed" ] || { echo "Empty diff."; exit 0; }

# Anything outside docs/markdown/media makes the exemption a false claim.
offenders=$(printf '%s\n' "$changed" | grep -vE '(^|/)docs/|\.md$|^docs/media/|^\.github/ISSUE_TEMPLATE/' || true)

if [ -n "$offenders" ]; then
  echo "::error::PR is labelled 'no-f2p' but changes code. The exemption covers docs-only diffs."
  echo "Offending paths:"
  printf '  %s\n' $offenders
  echo
  echo "Either remove the label and add a failing-first test, or drop the code changes."
  exit 1
fi

echo "no-f2p exemption is legitimate: diff is docs-only."
