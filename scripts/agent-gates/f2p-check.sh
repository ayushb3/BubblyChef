#!/usr/bin/env bash
# Gate: a bug fix must ship a test that FAILED before the fix (fail-to-pass).
#
# WORKFLOW.md §7. CI already proves the PR's tests pass at head. That says nothing
# about whether they would also have passed on main — a test written after the fix,
# asserting what the new code happens to do, is green either way and proves nothing.
#
# So this runs the PR's own test files against the BASE commit and demands at least
# one failure there. Published research on agent benchmarks found models scoring
# near-perfect without solving anything, because the check was self-reported. This
# check is not: CI re-runs the tests on base itself.
#
# A collection/import error on base counts as a failure — a test for code that does
# not exist yet cannot run, which is exactly the evidence we want.
#
# Usage: f2p-check.sh <base-sha> <head-sha> <required: true|false>
set -uo pipefail

BASE_SHA="${1:?usage: f2p-check.sh <base-sha> <head-sha> <required>}"
HEAD_SHA="${2:?}"
REQUIRED="${3:-false}"

mapfile -t changed_tests < <(git diff --name-only "$BASE_SHA" "$HEAD_SHA" \
  | grep -E '^(ai-service/tests/.*\.py|nextjs/.*\.(test|spec)\.(ts|tsx|js|jsx))$' \
  | grep -v '^nextjs/e2e/' || true)

if [ "${#changed_tests[@]}" -eq 0 ]; then
  if [ "$REQUIRED" = "true" ]; then
    echo "::error::This PR closes a 'bug' issue but adds or changes no unit test."
    echo "A bug fix needs a test that fails on $BASE_SHA and passes here."
    echo "If the bug genuinely cannot be unit tested, say so in the PR body and label it 'no-f2p'."
    exit 1
  fi
  echo "No test files changed and F2P not required — skipping."
  exit 0
fi

echo "Test files in this PR:"
printf '  %s\n' "${changed_tests[@]}"

WORK=$(mktemp -d)
cleanup() { git worktree remove --force "$WORK" >/dev/null 2>&1 || true; }
trap cleanup EXIT
git worktree add -q --detach "$WORK" "$BASE_SHA"

# Copy the PR's test files onto the base tree. Everything else stays at base, so a
# test that depends on the fix must fail here.
for f in "${changed_tests[@]}"; do
  if git cat-file -e "$HEAD_SHA:$f" 2>/dev/null; then
    mkdir -p "$WORK/$(dirname "$f")"
    git show "$HEAD_SHA:$f" > "$WORK/$f"
  fi
done

py_tests=(); js_tests=()
for f in "${changed_tests[@]}"; do
  case "$f" in
    ai-service/*) py_tests+=("${f#ai-service/}") ;;
    nextjs/*)     js_tests+=("${f#nextjs/}") ;;
  esac
done

saw_failure=0

if [ "${#py_tests[@]}" -gt 0 ]; then
  echo "== running ${#py_tests[@]} python test file(s) against base"
  # Run once: capture output for the log, keep pytest's own exit code.
  ( cd "$WORK/ai-service" && python -m pytest "${py_tests[@]}" -q --no-header >"$WORK/py.log" 2>&1 )
  status=$?
  tail -n 15 "$WORK/py.log"
  # pytest: 0 = all passed, 1 = failures, 2..5 = collection/usage errors (also evidence).
  if [ "$status" -ne 0 ]; then saw_failure=1; echo "  → failed on base (exit $status) ✓"; else echo "  → PASSED on base ✗"; fi
fi

if [ "${#js_tests[@]}" -gt 0 ]; then
  echo "== running ${#js_tests[@]} jest test file(s) against base"
  ( cd "$WORK/nextjs" && npm ci --prefer-offline --no-audit >/dev/null 2>&1 || true )
  ( cd "$WORK/nextjs" && npx jest --ci "${js_tests[@]}" >"$WORK/js.log" 2>&1 )
  status=$?
  tail -n 15 "$WORK/js.log"
  if [ "$status" -ne 0 ]; then saw_failure=1; echo "  → failed on base (exit $status) ✓"; else echo "  → PASSED on base ✗"; fi
fi

if [ "$saw_failure" -eq 1 ]; then
  echo "Fail-to-pass confirmed: the PR's tests fail on $BASE_SHA."
  exit 0
fi

if [ "$REQUIRED" = "true" ]; then
  echo "::error::Every test in this PR already passes on $BASE_SHA, so none of them demonstrates the bug."
  echo "Write a test that reproduces the bug first, watch it fail, then fix it."
  exit 1
fi

echo "::warning::No test in this PR fails on base. Not required for this PR, but the tests prove nothing about the change."
exit 0
