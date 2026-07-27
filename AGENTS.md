# Agent Instructions

This file exists for tooling that specifically looks for `AGENTS.md` (as opposed to
`CLAUDE.md`). **`CLAUDE.md` is the canonical source of truth** for workflow, stack,
architecture, and conventions — read that first. This file only holds the handful
of things that don't belong there.

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

## Everything else

See `CLAUDE.md` — issue tracker, triage labels, domain docs, agent roles, workflow,
and session-completion rules (file issues, run quality gates, commit + push) all
live there. This project uses GitHub Issues as its only tracker; no other tracker
is in play here.
