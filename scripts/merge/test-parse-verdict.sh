#!/usr/bin/env bash
# usage: test-parse-verdict.sh
#
# Fixture test runner for parse-verdict.sh. Plain bash, no test framework —
# each case feeds a fixture file's contents to parse-verdict.sh on stdin and
# compares stdout to the expected token. Exits non-zero if any case fails.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
FIXTURES="$DIR/fixtures"
PARSE="$DIR/parse-verdict.sh"

pass=0
fail=0

check() {
  local name=$1 fixture=$2 expected=$3 actual
  actual=$("$PARSE" < "$FIXTURES/$fixture")
  if [ "$actual" = "$expected" ]; then
    echo "ok   - $name ($fixture -> $actual)"
    pass=$((pass + 1))
  else
    echo "FAIL - $name ($fixture): expected '$expected', got '$actual'"
    fail=$((fail + 1))
  fi
}

# (1) The PR #619 incident: a preamble saying "auto-mergeable once checks
#     pass" sits above the real "**Verdict: needs changes**" line. The
#     preamble must not be mistaken for the verdict.
check "619 incident: preamble mergeable, real verdict needs-changes" \
  "619-preamble-then-needs-changes.txt" "needs-changes"

# (2) A heading-only verdict ("## Re-review (round 3) — `looks mergeable`",
#     no "Verdict:" label at all) still parses correctly.
check "round-3 heading says looks mergeable" \
  "569-round3-looks-mergeable.txt" "looks-mergeable"

# (3) A plain "**Verdict: needs a human**" line.
check "explicit needs-a-human verdict" \
  "552-needs-a-human.txt" "needs-human"

# (4) The <!-- verdict: X --> marker overrides contradicting prose.
check "structured marker wins over contradicting prose" \
  "marker-wins-over-prose.txt" "looks-mergeable"

# (5) No verdict anywhere -> unknown, fails closed.
check "no verdict present" \
  "no-verdict.txt" "unknown"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
