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

# (4) The <!-- verdict: X --> marker, when it disagrees with the prose
#     verdict, resolves to whichever is more restrictive (fails closed) —
#     it does NOT win outright regardless of the prose. PR #636 round-1
#     review: an earlier version of this fixture pinned the opposite
#     ("marker always wins"), which is exactly the hole that review found.
check "marker disagrees with prose: more restrictive wins" \
  "marker-disagrees-fails-closed.txt" "needs-changes"

# (5) No verdict anywhere -> unknown, fails closed.
check "no verdict present" \
  "no-verdict.txt" "unknown"

# (6) PR #636 round-1 review, finding 1: within-line precedence must fail
#     closed. A trailing TL;DR line names both "needs changes" and "looks
#     mergeable" -- the negative must win, not whichever phrase the naive
#     ladder happened to test first.
check "TL;DR line mentions both phrases: needs-changes wins" \
  "tldr-mentions-both-phrases.txt" "needs-changes"

# (7) Same finding, the needs-human / looks-mergeable pairing: needs-human
#     is still more restrictive than looks-mergeable.
check "line mentions both needs-a-human and looks-mergeable: needs-human wins" \
  "line-mentions-human-and-mergeable.txt" "needs-human"

# (8) PR #636 round-1 review, finding 2: a marker shown inline in backticks,
#     as a documentation example, must not be honoured -- only the real
#     "Verdict: needs changes" prose line counts.
check "marker quoted in backticks is ignored" \
  "marker-in-backticks-ignored.txt" "needs-changes"

# (9) Same finding: a marker shown inside a fenced code block is an
#     illustration, not an emitted verdict -- ignored in favour of prose.
check "marker inside a fenced code block is ignored" \
  "marker-in-fence-ignored.txt" "needs-human"

# (10) PR #636 round-2 review, finding A: across-line precedence must also
#      fail closed. A real "**Verdict: needs changes**" sits at the top;
#      a numbered finding below it quotes an earlier round's permissive
#      verdict ("Round 1 gave a verdict of `looks mergeable`..."). The
#      quoted phrase must not overwrite the real one just for being later.
check "top verdict needs-changes, later line quotes looks-mergeable" \
  "top-needs-changes-later-quotes-mergeable.txt" "needs-changes"

# (11) Same finding, the fenced-example angle: a ``` fenced block quotes
#      CLAUDE.md's own review template, which names all three phrases on
#      one line -- including "needs changes" -- ahead of the real
#      "**Verdict: needs a human**" below it. The fenced line must be
#      skipped by the prose pass exactly like the marker pass already
#      skips fences, or the quoted "needs changes" wins by rank and masks
#      the real, less restrictive "needs a human".
check "fenced verdict-format example plus real needs-a-human verdict" \
  "fenced-verdict-example-plus-real-needs-human.txt" "needs-human"

# (12) Same finding, the blockquote angle: a `>` blockquote re-quotes the
#      same three-phrase template line, ahead of the real
#      "**Verdict: looks mergeable**". Blockquoted lines must be skipped
#      by the prose pass the same way fenced lines are, or the quoted
#      "needs changes" wins by rank and masks the real, less restrictive
#      "looks mergeable".
check "blockquoted prior/template verdict is ignored" \
  "blockquoted-prior-verdict-ignored.txt" "looks-mergeable"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
