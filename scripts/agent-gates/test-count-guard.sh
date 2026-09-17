#!/usr/bin/env bash
# Gate: the test suite may not shrink, and tests may not be silently skipped.
#
# WORKFLOW.md §7. An agent that cannot make a test pass can always make it
# disappear, and deleting or skipping a test looks identical to "all green" in
# every other check. Documented in the research as one of the most common ways
# agent verification gets gamed. This is the mechanical counter to it.
#
# Compares collected test counts at base vs head, and rejects newly added skip
# markers. Exit 1 on a shrink or a new skip.
set -euo pipefail

BASE_SHA="${1:?usage: test-count-guard.sh <base-sha> <head-sha>}"
HEAD_SHA="${2:?}"

count_python() {
  # Prints the number of collected pytest tests for the current working tree.
  ( cd ai-service && python -m pytest tests/ --collect-only -q 2>/dev/null \
      | tail -n 2 | grep -oE '[0-9]+ test' | grep -oE '[0-9]+' | head -n1 ) || echo 0
}
count_jest() {
  ( cd nextjs && npx jest --listTests 2>/dev/null | grep -c . ) || echo 0
}

echo "== head ($HEAD_SHA)"
git checkout -q "$HEAD_SHA"
head_py=$(count_python); head_js=$(count_jest)
echo "  pytest tests: $head_py | jest test files: $head_js"

echo "== base ($BASE_SHA)"
git checkout -q "$BASE_SHA"
base_py=$(count_python); base_js=$(count_jest)
echo "  pytest tests: $base_py | jest test files: $base_js"

git checkout -q "$HEAD_SHA"

fail=0
if [ "$head_py" -lt "$base_py" ]; then
  echo "::error::pytest test count dropped: $base_py -> $head_py"
  fail=1
fi
if [ "$head_js" -lt "$base_js" ]; then
  echo "::error::jest test file count dropped: $base_js -> $head_js"
  fail=1
fi

# Newly added skip markers in the diff. Removing a skip is fine; adding one is not.
added_skips=$(git diff "$BASE_SHA" "$HEAD_SHA" -- 'ai-service/tests/**' 'nextjs/**' \
  | grep -E '^\+' | grep -vE '^\+\+\+' \
  | grep -E '@pytest\.mark\.(skip|xfail)|pytest\.skip\(|(it|test|describe)\.skip\(|\.todo\(' || true)

if [ -n "$added_skips" ]; then
  echo "::error::New skip/xfail markers added:"
  printf '  %s\n' "$added_skips"
  echo "If a test must be skipped, say why in the PR body and label the PR 'skip-approved'."
  fail=1
fi

[ "$fail" -eq 0 ] && echo "Test-count guard passed."
exit "$fail"
