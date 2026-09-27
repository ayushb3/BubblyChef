#!/usr/bin/env bash
# usage: parse-verdict.sh < review-body.txt
#
# Reads a single review body (e.g. a claude[bot] PR/issue comment, exactly as
# `gh api .../comments --jq '.[].body'` prints it) on stdin, and prints
# exactly one of:
#
#   looks-mergeable | needs-changes | needs-human | unknown
#
# Precedence, all fail-closed (see PR #636 round-1 review for why each of
# these matters -- an earlier version of this script had all three holes):
#
#   1. A `<!-- verdict: X -->` HTML marker is honoured ONLY when a line,
#      after trimming whitespace, is EXACTLY the marker: not quoted in
#      backticks, not part of a longer line, and not inside a ``` fenced
#      code block. This stops a review that merely shows or discusses the
#      marker format (e.g. documenting this very script) from being read as
#      emitting one. The LAST such line wins.
#   2. Prose: the LAST line that reads as an actual verdict statement
#      decides it -- either a line containing the word "Verdict" (bolded,
#      backticked, or plain), or a markdown heading that itself names one
#      of the three known phrases (the "## Re-review (round 3) —
#      `looks mergeable`" style used once the review dropped the literal
#      "Verdict:" label).
#      Within a single line, phrases are resolved most-restrictive-first:
#      needs-changes beats needs-human beats looks-mergeable. A line is
#      only read as looks-mergeable when it mentions NEITHER negative
#      phrase -- otherwise a trailing "**TL;DR** -- the verdict is needs
#      changes; everything else looks mergeable." would resolve to the
#      permissive answer just because "looks mergeable" also appears on it.
#   3. If both a valid marker (rule 1) and a determinable prose verdict
#      (rule 2) are present and they disagree, the MORE RESTRICTIVE of the
#      two wins (needs-changes > needs-human > looks-mergeable). A valid
#      marker with no determinable prose verdict is used as-is; a
#      determinable prose verdict with no valid marker is used as-is.
#   4. Anything else -> unknown (fail closed).
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

# Most-restrictive-first ranking, used both within a line (rule 2) and to
# resolve a marker/prose disagreement (rule 3). Higher = blocks merging.
verdict_rank() {
  case "$1" in
    needs-changes) echo 3 ;;
    needs-human) echo 2 ;;
    looks-mergeable) echo 1 ;;
    *) echo 0 ;;
  esac
}

# --- 1. Structured marker, but only when unambiguous ------------------------
# Honoured only when the ENTIRE line, after trimming whitespace, is exactly
# the marker -- never inside a fenced code block, never wrapped in backticks
# or other prose on the same line. That way a review merely quoting or
# demonstrating the marker format cannot be read as emitting one.
marker_value=""
in_fence=0
while IFS= read -r raw_line; do
  trimmed=$(printf '%s' "$raw_line" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')
  if printf '%s' "$trimmed" | grep -qE '^(```|~~~)'; then
    in_fence=$((1 - in_fence))
    continue
  fi
  [ "$in_fence" -eq 1 ] && continue
  if printf '%s' "$trimmed" | grep -qiE '^<!--[[:space:]]*verdict:[[:space:]]*[a-z-]+[[:space:]]*-->$'; then
    candidate=$(printf '%s' "$trimmed" | sed -E 's/.*verdict:[[:space:]]*([a-z-]+).*/\1/I' | tr '[:upper:]' '[:lower:]')
    case "$candidate" in
      looks-mergeable|needs-changes|needs-human) marker_value="$candidate" ;;
    esac
  fi
done <<EOF
$body
EOF
# Falls through to prose parsing when no valid marker line was found; an
# unrecognised marker value is treated the same as no marker.

# --- 2. Prose parsing: only lines that actually state a verdict ------------
phrase_for_line() {
  # $1 = one line of text; echoes the normalised verdict token, or nothing.
  # Fail-closed within the line: check the negatives before the permissive
  # phrase, so a line naming more than one phrase never resolves to
  # looks-mergeable.
  local line=$1
  if printf '%s' "$line" | grep -qiE 'needs changes'; then
    echo needs-changes
  elif printf '%s' "$line" | grep -qiE 'needs a human'; then
    echo needs-human
  elif printf '%s' "$line" | grep -qiE 'looks mergeable'; then
    echo looks-mergeable
  fi
}

# A "verdict line" is either:
#   - a line containing the standalone word "verdict" (e.g. "**Verdict:
#     needs changes**", "**Verdict: `needs changes`**"), or
#   - a markdown heading (starts with #) that carries one of the three
#     phrases directly, with no "Verdict" label at all.
verdict_lines=$(printf '%s\n' "$body" | grep -iE \
  '(^|[^a-z])verdict([^a-z]|$)|^#+.*(looks mergeable|needs changes|needs a human)')

prose_value="unknown"
if [ -n "$verdict_lines" ]; then
  while IFS= read -r line; do
    p=$(phrase_for_line "$line")
    [ -n "$p" ] && prose_value="$p"
  done <<EOF
$verdict_lines
EOF
fi

# --- 3. Reconcile marker and prose, most restrictive wins on disagreement --
if [ -n "$marker_value" ] && [ "$prose_value" != "unknown" ]; then
  if [ "$marker_value" = "$prose_value" ]; then
    result="$marker_value"
  else
    mr=$(verdict_rank "$marker_value")
    pr=$(verdict_rank "$prose_value")
    if [ "$mr" -ge "$pr" ]; then result="$marker_value"; else result="$prose_value"; fi
  fi
elif [ -n "$marker_value" ]; then
  result="$marker_value"
else
  result="$prose_value"
fi

echo "$result"
