#!/usr/bin/env bash
# Gate: tests may not be removed, skipped, or netted away.
#
# WORKFLOW.md §7. An agent that cannot make a test pass can always make it disappear,
# and a deleted or skipped test looks identical to "all green" in every other check.
# This is the mechanical counter to the most commonly reported way agent
# verification gets gamed.
#
# Three checks, because each one alone has a hole:
#   1. Collected test counts at head must not drop below base.
#   2. No test file deleted and no test function removed — counts alone miss a PR
#      that deletes old tests and adds the same number of trivial ones. (Found by
#      running this script against itself: deleting a test file on a branch that had
#      added four passed check 1 cleanly.)
#   3. No newly added skip/xfail markers.
#
# Deliberate removals carry the `test-removal-approved` label, and deliberate skips
# `skip-approved`, with the reason in the PR body. Exit 1 on any violation.
#
# Usage: test-count-guard.sh <base-sha> <head-sha> [labels-json]
set -uo pipefail

BASE_SHA="${1:?usage: test-count-guard.sh <base-sha> <head-sha> [labels-json]}"
HEAD_SHA="${2:?}"
LABELS="${3:-[]}"

# Compare against the merge base, not the base branch's tip. CI passes
# pull_request.base.sha, which is main *now*; a branch cut before main gained new
# tests would otherwise "remove" them in a two-dot diff and "drop" the count, so the
# gate went red on any PR that was merely behind main. The question is what this
# PR removed, which is exactly the merge base -> head diff.
if MB=$(git merge-base "$BASE_SHA" "$HEAD_SHA" 2>/dev/null) && [ -n "$MB" ]; then
  [ "$MB" != "$(git rev-parse "$BASE_SHA")" ] &&     echo "Base $BASE_SHA is ahead of the branch point; comparing against merge base $MB."
  BASE_SHA="$MB"
fi

has_label() { printf '%s' "$LABELS" | grep -q "\"$1\""; }

# Each counter prints exactly one integer. `|| echo 0` after a pipeline that has
# already printed is how you get "0\n0" and an "integer expression expected" error —
# normalise instead.
as_int() { case "$1" in ''|*[!0-9]*) printf '0' ;; *) printf '%s' "$1" ;; esac; }

count_python() {
  local n
  n=$( cd "$1/ai-service" 2>/dev/null && python -m pytest tests/ --collect-only -q 2>/dev/null \
         | tail -n 2 | grep -oE '[0-9]+ test' | grep -oE '[0-9]+' | head -n1 )
  as_int "${n:-0}"
}
count_jest() {
  local n
  n=$( cd "$1/nextjs" 2>/dev/null && npx jest --listTests 2>/dev/null | grep -c . )
  as_int "${n:-0}"
}

# Never `git checkout` in place. This script also runs on a developer's machine, and
# an earlier version that did detached the HEAD of the worktree it was tested in.
# Each side gets a throwaway worktree instead.
ROOT=$(git rev-parse --show-toplevel)
BASE_WT=$(mktemp -d); HEAD_WT=$(mktemp -d)
rmdir "$BASE_WT" "$HEAD_WT" 2>/dev/null || true
cleanup() {
  git -C "$ROOT" worktree remove --force "$BASE_WT" >/dev/null 2>&1 || true
  git -C "$ROOT" worktree remove --force "$HEAD_WT" >/dev/null 2>&1 || true
}
trap cleanup EXIT
git -C "$ROOT" worktree add -q --detach "$BASE_WT" "$BASE_SHA"
git -C "$ROOT" worktree add -q --detach "$HEAD_WT" "$HEAD_SHA"

# Dependencies are installed in the checkout, not in a fresh worktree — reuse them.
for wt in "$BASE_WT" "$HEAD_WT"; do
  if [ -d "$ROOT/nextjs/node_modules" ] && [ ! -e "$wt/nextjs/node_modules" ]; then
    ln -sfn "$ROOT/nextjs/node_modules" "$wt/nextjs/node_modules" 2>/dev/null || true
  fi
done

fail=0

# ── 1. Counts ────────────────────────────────────────────────────────────────
echo "== head ($HEAD_SHA)"
head_py=$(count_python "$HEAD_WT"); head_js=$(count_jest "$HEAD_WT")
echo "  pytest tests: $head_py | jest test files: $head_js"
echo "== base ($BASE_SHA)"
base_py=$(count_python "$BASE_WT"); base_js=$(count_jest "$BASE_WT")
echo "  pytest tests: $base_py | jest test files: $base_js"

# A drop is the expected consequence of an approved removal, so the same label covers
# it — otherwise the label would allow a removal that the count check then rejects.
count_dropped() {
  if has_label test-removal-approved; then
    echo "::notice::$1 test count dropped: $2 -> $3 (allowed by 'test-removal-approved')"
  else
    echo "::error::$1 test count dropped: $2 -> $3"; fail=1
  fi
}
[ "$head_py" -lt "$base_py" ] && count_dropped pytest "$base_py" "$head_py"
[ "$head_js" -lt "$base_js" ] && count_dropped "jest file" "$base_js" "$head_js"

# ── 2. Removed tests, independent of totals ──────────────────────────────────
removed_files=$(git diff --diff-filter=D --name-only "$BASE_SHA" "$HEAD_SHA" -- \
  ai-service/tests nextjs | grep -E '(test_[^/]*\.py|\.(test|spec)\.(ts|tsx|js|jsx))$' || true)

removed_defs=$(git diff "$BASE_SHA" "$HEAD_SHA" -- ai-service/tests nextjs \
  | grep -E '^-' | grep -vE '^---' \
  | grep -E '^-[[:space:]]*(async[[:space:]]+)?def test_|^-[[:space:]]*(it|test)\(' || true)

if [ -n "$removed_files$removed_defs" ]; then
  if has_label test-removal-approved; then
    echo "Tests removed; allowed by the 'test-removal-approved' label."
  else
    echo "::error::Tests were deleted or removed:"
    [ -n "$removed_files" ] && printf '%s\n' "$removed_files" | sed 's/^/  deleted file: /'
    [ -n "$removed_defs" ] && printf '%s\n' "$removed_defs" | sed 's/^/  removed: /'
    echo "A test that no longer exists cannot fail. If this is deliberate (the behaviour"
    echo "is gone, or the test moved), explain it in the PR body and label the PR"
    echo "'test-removal-approved'."
    fail=1
  fi
fi

# ── 3. New skip markers ──────────────────────────────────────────────────────
added_skips=$(git diff "$BASE_SHA" "$HEAD_SHA" -- ai-service/tests nextjs \
  | grep -E '^\+' | grep -vE '^\+\+\+' \
  | grep -E '@pytest\.mark\.(skip|xfail)|pytest\.skip\(|(it|test|describe)\.skip\(|\.todo\(' || true)

if [ -n "$added_skips" ]; then
  if has_label skip-approved; then
    echo "New skip markers; allowed by the 'skip-approved' label."
  else
    echo "::error::New skip/xfail markers added:"
    printf '%s\n' "$added_skips" | sed 's/^/  /'
    echo "If a test must be skipped, say why in the PR body and label the PR 'skip-approved'."
    fail=1
  fi
fi

[ "$fail" -eq 0 ] && echo "Test-count guard passed."
exit "$fail"
