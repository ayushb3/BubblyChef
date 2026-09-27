#!/usr/bin/env bash
# usage: parse-verdict.sh < review-body.txt
#
# Reads a single review body (e.g. a claude[bot] PR/issue comment, exactly as
# `gh api .../comments --jq '.[].body'` prints it) on stdin, and prints
# exactly one of:
#
#   looks-mergeable | needs-changes | needs-human | unknown
#
# Precedence:
#   1. An explicit `<!-- verdict: X -->` HTML marker anywhere in the body
#      wins outright, no matter what the surrounding prose says.
#   2. Otherwise, the LAST line that reads as an actual verdict statement
#      decides it: either a line containing the word "Verdict" (bolded,
#      backticked, or plain), or a markdown heading that itself names one
#      of the three known phrases (the "## Re-review (round 3) —
#      `looks mergeable`" style used once the review dropped the literal
#      "Verdict:" label). Last one wins so a later round in the same body
#      supersedes an earlier one.
#   3. Anything else -> unknown (fail closed).
#
# Deliberately narrow: prose that merely uses a word like "mergeable" in
# passing must NOT be mistaken for the verdict. PR #619's review opened
# with "No CODEOWNERS path is touched, so this is auto-mergeable once
# checks pass" and then, further down, gave the real verdict:
# "**Verdict: needs changes**". A parser that just greps the whole body for
# "mergeable" would call that PR mergeable and merge over real findings —
# that's the incident this script exists to not repeat. See
# fixtures/619-preamble-then-needs-changes.txt and
# test-parse-verdict.sh case (1).

set -u

body="$(cat)"

# --- 1. Structured marker wins outright ------------------------------------
marker_value=$(printf '%s\n' "$body" \
  | grep -oiE '<!--[[:space:]]*verdict:[[:space:]]*[a-z-]+[[:space:]]*-->' \
  | tail -1 \
  | sed -E 's/.*verdict:[[:space:]]*([a-z-]+).*/\1/I' \
  | tr '[:upper:]' '[:lower:]')

case "$marker_value" in
  looks-mergeable|needs-changes|needs-human)
    echo "$marker_value"
    exit 0
    ;;
esac
# An absent or unrecognised marker falls through to prose parsing below.

# --- 2. Prose parsing: only lines that actually state a verdict ------------
phrase_for_line() {
  # $1 = one line of text; echoes the normalised verdict token, or nothing.
  local line=$1
  if printf '%s' "$line" | grep -qiE 'looks mergeable'; then
    echo looks-mergeable
  elif printf '%s' "$line" | grep -qiE 'needs a human'; then
    echo needs-human
  elif printf '%s' "$line" | grep -qiE 'needs changes'; then
    echo needs-changes
  fi
}

# A "verdict line" is either:
#   - a line containing the standalone word "verdict" (e.g. "**Verdict:
#     needs changes**", "**Verdict: `needs changes`**"), or
#   - a markdown heading (starts with #) that carries one of the three
#     phrases directly, with no "Verdict" label at all.
verdict_lines=$(printf '%s\n' "$body" | grep -iE \
  '(^|[^a-z])verdict([^a-z]|$)|^#+.*(looks mergeable|needs changes|needs a human)')

result="unknown"
if [ -n "$verdict_lines" ]; then
  while IFS= read -r line; do
    p=$(phrase_for_line "$line")
    [ -n "$p" ] && result="$p"
  done <<EOF
$verdict_lines
EOF
fi

echo "$result"
