#!/usr/bin/env bash
# PreToolUse gate: require thermo-nuclear-review before a PR becomes real.
#
# WORKFLOW.md §7 layer 3. Earlier this gate existed only in prose, and the one
# implementation described (a matcher on `gh pr create`) would not have fired in
# a session that opens PRs through the GitHub MCP tools instead of the gh CLI.
# This script keys on the *action*, not the transport, so both paths are covered.
#
# The Bash branch matches only where `gh` sits in *command position* — the start of
# the line or straight after a separator. A substring match is not good enough: the
# first version of this hook used one and blocked an ordinary `git commit` whose
# message quoted the phrase. Prose, heredoc bodies and quoted strings mentioning
# `gh pr create` must not arm the gate; a real invocation must.
#
# Contract: allow silently unless this is a PR create/merge and no review marker
# exists for the current HEAD. The marker lives in .git/ (never committed) and is
# per-commit, so a new push re-arms the gate.
set -uo pipefail

payload=$(cat)
tool=$(printf '%s' "$payload" | jq -r '.tool_name // ""')

case "$tool" in
  Bash)
    cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
    # Split on command separators and newlines, then require the segment to *begin*
    # with the gh invocation. Leading `(` and `{` are stripped so subshells match.
    printf '%s' "$cmd" \
      | tr ';\n' '\n\n' \
      | sed -E 's/(\|\||&&|\||&)/\n/g' \
      | sed -E 's/^[[:space:]]*[({][[:space:]]*//' \
      | grep -Eq '^[[:space:]]*gh[[:space:]]+pr[[:space:]]+(create|merge)([[:space:]]|$)' || exit 0
    ;;
  mcp__github__create_pull_request|mcp__github__merge_pull_request) ;;
  *) exit 0 ;;
esac

git_dir=$(git rev-parse --git-dir 2>/dev/null) || exit 0
sha=$(git rev-parse HEAD 2>/dev/null) || exit 0
marker="$git_dir/thermo-nuclear-review-$sha"

[ -f "$marker" ] && exit 0

jq -n --arg sha "$sha" --arg marker "$marker" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: ("Review gate (WORKFLOW.md §7, layer 3): no thermo-nuclear-review recorded for HEAD (" + $sha[0:8] + ").\n\nRun the thermo-nuclear-review skill against this branch, act on any findings, then record it and retry:\n  touch \"" + $marker + "\"\n\nThe marker is per-commit — a further push re-arms the gate. It lives in .git/ and is never committed.")
  }
}'
