#!/usr/bin/env bash
# usage: test-parse-verdict.sh
#
# Fixture test runner for parse-verdict.sh. Plain bash, no test framework —
# each case feeds a fixture file's contents to parse-verdict.sh on stdin and
# compares stdout to the expected token. Exits non-zero if any case fails.
#
# parse-verdict.sh is now a thin wrapper around
# scripts/agent-gates/review-verdict.cjs's parseVerdict() (PR #636 round-3
# review — see that script's header for its exact rule). These expectations
# are what that parser ACTUALLY returns for each fixture, not what the old,
# now-deleted shell-side parser used to return. Several fixtures were
# written against the old parser's richer rules (a heading-only verdict, an
# HTML marker, fence/blockquote skipping, most-restrictive-across-lines) and
# now come back `unknown` instead of a real verdict, because
# review-verdict.cjs has no equivalent for any of those — it only recognises
# a literal "Verdict:" label, taking the value after the LAST one in the
# raw body, and only when that value is EXACTLY one of the three known
# phrases. `unknown` is still fail-closed: guarded-merge.sh only queues a
# merge on the literal string `VERDICT: looks-mergeable`, so every one of
# these stricter reads still blocks a merge rather than permitting one.
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
#     pass" sits above the real "**Verdict: needs changes**" line. This is
#     the one case that must never regress: review-verdict.cjs reads the
#     literal "Verdict:" label ("needs changes"), and the preamble has no
#     such label, so it's simply not a candidate line for it.
check "619 incident: preamble mergeable, real verdict needs-changes" \
  "619-preamble-then-needs-changes.txt" "needs-changes"

# (2) CHANGED from the old shell parser. A heading-only verdict
#     ("## Re-review (round 3) — `looks mergeable`", no "Verdict:" label at
#     all) used to be recognised via a dedicated heading rule. The
#     protected parser has no such rule — it requires the literal "Verdict:"
#     label — so a heading-only verdict is unreadable to it: `unknown`.
#     Still fail-closed (a hold, not a merge); just a stricter read than the
#     old script gave.
check "round-3 heading (no 'Verdict:' label) is unreadable to the protected parser" \
  "569-round3-looks-mergeable.txt" "unknown"

# (3) A plain "**Verdict: needs a human**" line.
check "explicit needs-a-human verdict" \
  "552-needs-a-human.txt" "needs-human"

# (4) CHANGED from the old shell parser. review-verdict.cjs has no concept
#     of a `<!-- verdict: X -->` marker at all, so it never enters this
#     picture. What's left is the prose: "**Verdict: needs changes** (stale
#     draft, not yet updated to match the marker)" carries trailing prose
#     after the phrase on the same line, and the protected parser only
#     recognises a value that is EXACTLY "needs changes" (after stripping
#     markdown emphasis and trailing punctuation) — the parenthetical
#     remainder means this line's value doesn't match any of the three
#     known phrases, so it's unreadable: `unknown`. Still fail-closed.
check "marker (unsupported by the protected parser) plus prose with trailing text: unreadable" \
  "marker-disagrees-fails-closed.txt" "unknown"

# (5) No verdict anywhere -> unknown, fails closed.
check "no verdict present" \
  "no-verdict.txt" "unknown"

# (6) CHANGED from the old shell parser. This fixture has no literal
#     "Verdict:" label at all — just a heading ("## Re-review — needs
#     changes") and a TL;DR sentence that mentions "verdict" without a
#     colon immediately after it ("the verdict is needs changes"). The old
#     shell parser's heading/prose rules read this as needs-changes; the
#     protected parser requires the literal "Verdict:" label and finds none,
#     so it's unreadable: `unknown`. Still fail-closed.
check "heading + prose with no literal 'Verdict:' label: unreadable" \
  "tldr-mentions-both-phrases.txt" "unknown"

# (7) CHANGED from the old shell parser. "**Verdict:** this needs a human to
#     weigh in on the redirect target, though mechanically the diff
#     otherwise looks mergeable..." names a "Verdict:" label, but the text
#     after it is a full sentence, not one of the three known phrases
#     verbatim. The protected parser requires an exact match, so this is
#     unreadable: `unknown`. Still fail-closed.
check "single 'Verdict:' line whose value is prose, not one of the three phrases: unreadable" \
  "line-mentions-human-and-mergeable.txt" "unknown"

# (8) The marker text itself contains the substring "verdict:", so the
#     protected parser's label regex does match it in passing — but the
#     real, later "**Verdict: needs changes**" line is the LAST "Verdict:"
#     line in the body, and last-one-wins, so it's what's returned. Same
#     outcome as the old parser, for an unrelated reason.
check "marker mentioned in backticked prose; last real 'Verdict:' line wins" \
  "marker-in-backticks-ignored.txt" "needs-changes"

# (9) Same shape as (8): the fenced marker example contains "verdict:", but
#     the real "**Verdict: needs a human**" line comes after it in the raw
#     text and wins as the last match. The protected parser doesn't treat
#     fenced text specially either way.
check "marker mentioned inside a fenced block; last real 'Verdict:' line wins" \
  "marker-in-fence-ignored.txt" "needs-human"

# (10) Only one line in this fixture carries the literal "Verdict:" label
#      ("**Verdict: needs changes**" at the top); the line below it quotes
#      an earlier round's verdict as prose ("gave a verdict of `looks
#      mergeable`"), which has no colon right after "verdict" and so isn't
#      a candidate line at all. Same result as the old parser's
#      most-restrictive-across-lines rule, reached because there's simply
#      only one labelled line to read.
check "top verdict needs-changes, later line only paraphrases a prior verdict" \
  "top-needs-changes-later-quotes-mergeable.txt" "needs-changes"

# (11) The fenced three-phrase template line contains "Verdict:", so it's a
#      candidate and briefly sets a value — but the real
#      "**Verdict: needs a human**" line comes after it in the raw text and
#      is the last match, so it wins. The protected parser doesn't skip
#      fenced text; this only comes out right because the real verdict
#      happens to be later in the body.
check "fenced verdict-format example plus real needs-a-human verdict; last line wins" \
  "fenced-verdict-example-plus-real-needs-human.txt" "needs-human"

# (12) Same shape again: the blockquoted three-phrase template line
#      contains "Verdict:" and is read as a candidate (backtick-extracted
#      to "looks mergeable"), but the real "**Verdict: looks mergeable**"
#      line after it is the last match and — here — happens to agree with
#      it anyway. The protected parser doesn't skip blockquoted text; this
#      passing is coincidental, not because blockquotes are recognised.
check "blockquoted prior/template verdict; last line wins (and happens to agree)" \
  "blockquoted-prior-verdict-ignored.txt" "looks-mergeable"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
