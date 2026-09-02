#!/usr/bin/env python3
"""Exercise .claude/hooks/pr-review-gate.sh against synthesized PreToolUse payloads.

Payload text lives here rather than in a shell command line, because the gate
matches on command text and a shell invocation carrying these cases would arm it.
"""
import json
import pathlib
import subprocess
import sys

HOOK = str(pathlib.Path(__file__).with_name("pr-review-gate.sh"))
G = "g" + "h"  # keep the literal invocation out of any command line

CASES = [
    # (expected, tool_name, command, label)
    ("DENY", "Bash", f"{G} pr create --draft", "bare create"),
    ("DENY", "Bash", f"git push -u origin x && {G} pr create --draft", "compound &&"),
    ("DENY", "Bash", f"cd /repo; {G} pr merge 295 --merge", "after semicolon"),
    ("DENY", "Bash", f"( {G} pr create )", "subshell"),
    ("DENY", "Bash", f"git push\n{G} pr create", "second line"),
    ("DENY", "mcp__github__create_pull_request", None, "MCP create"),
    ("DENY", "mcp__github__merge_pull_request", None, "MCP merge"),
    ("ALLOW", "Bash", "ls -la", "unrelated"),
    ("ALLOW", "Bash", f"git commit -F - <<EOF\nfix: fires at {G} pr create time\nalso {G} pr merge\nEOF", "REGRESSION: heredoc commit msg"),
    ("ALLOW", "Bash", f"echo see the docs about {G} pr create", "phrase mid-command"),
    ("ALLOW", "Bash", f'grep -rn "{G} pr create" WORKFLOW.md', "grepping for the phrase"),
    ("ALLOW", "Bash", f"{G} pr checks 295 --watch", "checks, not create/merge"),
    ("ALLOW", "Bash", f"{G} pr list", "list"),
    ("ALLOW", "Bash", f"{G} pr view 295", "view"),
    ("ALLOW", "mcp__github__list_issues", None, "unrelated MCP"),
]

failures = 0
for expected, tool, cmd, label in CASES:
    payload = {"tool_name": tool, "tool_input": {"command": cmd} if cmd is not None else {}}
    out = subprocess.run([HOOK], input=json.dumps(payload), capture_output=True, text=True)
    got = "DENY" if out.stdout.strip() else "ALLOW"
    if got == expected:
        print(f"  ok    {got:5}  {label}")
    else:
        failures += 1
        print(f"  FAIL  expected {expected}, got {got}  <- {label}")

print(f"\n{len(CASES) - failures}/{len(CASES)} passed")
sys.exit(1 if failures else 0)
