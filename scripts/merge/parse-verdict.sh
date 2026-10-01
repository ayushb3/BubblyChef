#!/usr/bin/env bash
# usage: parse-verdict.sh < review-body.txt
#
# Reads a single review body (e.g. a claude[bot] PR/issue comment, exactly as
# `gh api .../comments --jq '.[].body'` prints it) on stdin, and prints
# exactly one of:
#
#   looks-mergeable | needs-changes | needs-human | unknown
#
# This is a thin wrapper around `scripts/agent-gates/review-verdict.cjs`'s
# `parseVerdict()` -- the unit-tested parser that
# already runs as the required "Claude review verdict" check on every
# agent-loop PR (`.github/workflows/claude-review.yml`). All verdict-parsing
# RULES live there, in exactly one place, so the agent-writable merge queue
# in this directory and the protected merge gate can never disagree about
# what a review body means.
#
# (PR #636 round-3 review: an earlier version of this script had its own,
# independently-evolved parsing logic -- a heading rule, an HTML marker, a
# fence/blockquote skip, and a most-restrictive-wins precedence ladder built
# up over three review rounds. That put a second, differently-behaving
# verdict rule in an agent-writable path alongside the one already tested
# and protected. Issue #624 asked to move scripts, not to introduce a second
# answer, so this wrapper defers entirely to the protected parser instead
# and the old shell-side rules are gone.)
#
# review-verdict.cjs's parseVerdict(), briefly (see that file for the real
# spec; it is the single source of truth). A review comment can state its
# verdict in three places, and EVERY one present must agree, else the comment
# is unreadable:
#
#   1. a literal "Verdict:" label -- any case, bold or backticked or not --
#      taking the value after the LAST such label anywhere in the body
#      (including inside a fenced code block or a blockquote; it skips
#      neither). HTML comments are never labels.
#   2. a `<!-- verdict: looks-mergeable -->` marker on its own line, outside
#      a code fence (tokens: looks-mergeable, needs-changes, needs-human).
#   3. a markdown heading that ENDS in the verdict after a dash or colon
#      ("## Re-review (round 3) -- `looks mergeable`"), outside a code fence.
#
# A label value is only recognised when, after stripping markdown
# emphasis/backticks and trailing punctuation, it is EXACTLY one of "looks
# mergeable", "needs changes", "needs a human". Anything else -- no verdict
# in any of the three places, a label or marker with an unknown value, a
# verdict phrase followed by more prose on the same line, or sources that
# disagree -- comes back as '' ("unreadable").
#
# '' maps to `unknown` below. `guarded-merge.sh` requires the literal string
# `VERDICT: looks-mergeable` to queue a merge, so `unknown` -- like
# `needs-changes` and `needs-human` -- is NOT mergeable: every case the
# protected parser can't read still fails closed.
#
# Compared with the parser this file used to contain: a verdict phrase with
# trailing prose on the same line, and a marker that disagrees with the
# label, used to resolve to a real verdict and now come back `unknown`; a
# heading-only verdict and a marker that agrees with the rest are now read
# (issue #571). See fixtures/ and test-parse-verdict.sh for each case, and
# PR #636's body for the original fixture-by-fixture list. That is a
# deliberate consequence of having one authoritative rule instead of two.

set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
CJS="$DIR/../agent-gates/review-verdict.cjs"

node -e '
const { parseVerdict } = require(process.argv[1])
const fs = require("fs")
const body = fs.readFileSync(0, "utf8")
const verdict = parseVerdict(body)
const TOKENS = {
  "looks mergeable": "looks-mergeable",
  "needs changes": "needs-changes",
  "needs a human": "needs-human",
}
process.stdout.write((TOKENS[verdict] || "unknown") + "\n")
' "$CJS"
