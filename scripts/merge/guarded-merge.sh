#!/usr/bin/env bash
# usage: guarded-merge.sh <pr>... — for each PR in turn: wait for CI + a fresh claude[bot] review, and
# merge through the queue ONLY if nothing failed and the parsed verdict is looks-mergeable (not
# needs-changes/needs-human/unknown).
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
for n in "$@"; do
  out=$(bash "$DIR/wait-review.sh" "$n"); echo "$out"
  # Require pending=0 as well as failed=[]: wait-review.sh gives up after
  # ~40 minutes and prints its summary regardless of whether CI actually
  # finished, so failed=[] alone (nothing has failed *yet*) is not enough --
  # a timeout with checks still running must not queue (PR #636 round-1
  # review, finding 3).
  if echo "$out" | grep -q 'pending=0' && echo "$out" | grep -q 'failed=\[\]' && echo "$out" | grep -q 'VERDICT: looks-mergeable'; then
    bash "$DIR/merge-queue-novercel.sh" "$n" 2>&1 | tail -3
  else
    echo "NOT QUEUED #$n"
  fi
done
