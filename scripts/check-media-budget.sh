#!/usr/bin/env bash
# Report the demo-media footprint, flag directories whose issue is already
# closed, and fail only on a single oversized file.
#
# Why this shape: PR evidence under docs/media/ is added by whichever session
# opens the PR and deleted by nobody. Images are permanent in git history, so
# by the time the directory is visibly large the cost is already sunk — the
# only cheap moment is before a merge.
#
# It reports rather than blocks. A PR failing because its own screenshots
# crossed a threshold teaches agents to attach less evidence, and WORKFLOW.md
# §4 is explicit that screenshots *are* the review for a visual change. The one
# hard failure is a single file over MAX_FILE_KB, which is never a judgment
# call — it means an unresized capture or a video got committed by accident.
#
# Run locally with: bash scripts/check-media-budget.sh
set -uo pipefail

MEDIA_DIR="docs/media"
BUDGET_KB=$(( 20 * 1024 ))   # 20 MB total — advisory
MAX_FILE_KB=$(( 2 * 1024 ))  # 2 MB per file — enforced

if [ ! -d "$MEDIA_DIR" ]; then
  echo "No $MEDIA_DIR directory. Nothing to check."
  exit 0
fi

total_kb=$(du -sk "$MEDIA_DIR" | cut -f1)
file_count=$(find "$MEDIA_DIR" -type f | wc -l | tr -d ' ')
dir_count=$(find "$MEDIA_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')

echo "=== Demo media budget ==="
echo "Total:       $(du -sh "$MEDIA_DIR" | cut -f1)  (advisory budget: $(( BUDGET_KB / 1024 )) MB)"
echo "Files:       $file_count across $dir_count directories"
echo

# --- Oversized individual files: the one hard failure ----------------------
oversized=$(find "$MEDIA_DIR" -type f -size +${MAX_FILE_KB}k 2>/dev/null)
if [ -n "$oversized" ]; then
  echo "FAIL: files over $(( MAX_FILE_KB / 1024 )) MB — resize before committing:"
  while IFS= read -r f; do
    [ -n "$f" ] && echo "  $(( $(du -k "$f" | cut -f1) / 1024 )) MB  $f"
  done <<< "$oversized"
  echo
  echo "UI screenshots should be PNG at no more than 1280px wide. A file this"
  echo "large is usually an unresized retina capture or a video."
  exit 1
fi

# --- Staleness: directories whose issue has already closed -----------------
# This is the "when was it last cleaned" signal, derived rather than tracked:
# a docs/media/issue-N/ whose issue N is closed is, by definition, prunable.
stale=""
checked=0
skipped=0
for d in "$MEDIA_DIR"/issue-*; do
  [ -d "$d" ] || continue
  n="${d##*/issue-}"
  case "$n" in ''|*[!0-9]*) continue ;; esac
  state=$(gh issue view "$n" --json state -q .state 2>/dev/null || echo "")
  if [ -z "$state" ]; then
    skipped=$(( skipped + 1 ))
    continue
  fi
  checked=$(( checked + 1 ))
  if [ "$state" = "CLOSED" ]; then
    stale="$stale  $d  ($(du -sh "$d" | cut -f1), issue #$n is closed)\n"
  fi
done

if [ -n "$stale" ]; then
  echo "Prunable — these issues are closed, so their evidence has served its purpose:"
  printf "%b" "$stale"
  echo "Run the /prune-media skill, or: git rm -r ${MEDIA_DIR}/issue-<n>"
  echo
elif [ "$checked" -gt 0 ]; then
  echo "No prunable directories: all $checked issue-* directories map to open issues."
  echo
fi

# Say so out loud when the staleness check could not run. A check that silently
# passes when it cannot query anything reads identically to a clean result, and
# that is how a stale signal becomes a trusted one.
if [ "$skipped" -gt 0 ]; then
  echo "NOTE: could not resolve $skipped issue-* directories (no gh auth or no such issue)."
  echo "Staleness was NOT checked for those — treat this run as incomplete."
  echo
fi

# --- Advisory total --------------------------------------------------------
if [ "$total_kb" -gt "$BUDGET_KB" ]; then
  echo "NOTE: over the $(( BUDGET_KB / 1024 )) MB advisory budget."
  echo "Not a failure — evidence is worth more than the bytes. But this is the"
  echo "signal to prune closed-issue directories, and a reminder that history"
  echo "already carries every image ever committed here."
fi

exit 0
