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

action=""
case "$tool" in
  Bash)
    cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
    # Split on command separators and newlines, then require the segment to *begin*
    # with the gh invocation. Leading `(` and `{` are stripped so subshells match.
    action=$(printf '%s' "$cmd" \
      | tr ';\n' '\n\n' \
      | sed -E 's/(\|\||&&|\||&)/\n/g' \
      | sed -E 's/^[[:space:]]*[({][[:space:]]*//' \
      | sed -nE 's/^[[:space:]]*gh[[:space:]]+pr[[:space:]]+(create|merge)([[:space:]].*)?$/\1/p' \
      | head -n1)
    [ -n "$action" ] || exit 0
    ;;
  mcp__github__create_pull_request) action="create" ;;
  mcp__github__merge_pull_request)  action="merge"  ;;
  *) exit 0 ;;
esac

git_dir=$(git rev-parse --git-dir 2>/dev/null) || exit 0
sha=$(git rev-parse HEAD 2>/dev/null) || exit 0
thermo="$git_dir/thermo-nuclear-review-$sha"
light="$git_dir/code-review-$sha"

# The strong marker satisfies both tiers.
[ -f "$thermo" ] && exit 0
# The lighter, agent-invocable one satisfies creation only.
[ "$action" = "create" ] && [ -f "$light" ] && exit 0

if [ "$action" = "create" ]; then
  jq -n --arg sha "$sha" --arg light "$light" --arg thermo "$thermo" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: ("Review gate (WORKFLOW.md §7, layer 3): no review recorded for HEAD (" + $sha[0:8] + ").\n\nRun the code-review skill against this branch, act on any findings, then record it and retry:\n  touch \"" + $light + "\"\n\nA thermo-nuclear-review marker also satisfies this tier:\n  touch \"" + $thermo + "\"\n\nMarkers are per-commit — a further push re-arms the gate. They live in .git/ and are never committed.")
    }
  }'
else
  jq -n --arg sha "$sha" --arg thermo "$thermo" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: ("Merge gate (WORKFLOW.md §7, layer 3): no thermo-nuclear-review recorded for HEAD (" + $sha[0:8] + ").\n\nMerging to main auto-deploys, so a code-review marker is not sufficient here. Run the thermo-nuclear-review skill, act on any findings, then record it and retry:\n  touch \"" + $thermo + "\"\n\nThe marker is per-commit — a further push re-arms the gate. It lives in .git/ and is never committed.")
    }
  }'
fi
