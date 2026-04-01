# BubblyChef — Working with Claude Code

> How to get the most out of Claude Code for feature work, bug fixes, and autonomous improvement loops.

---

## Orientation

```bash
/status          # where am I, what's changed, what's next
```

Read `ROADMAP.md` for current phase + open issues. `MEMORY.md` is auto-loaded each session.

---

## Workflows

### Quick fix / small change
```
describe the bug or change → Claude implements → /vibe recent → commit
```

### Feature (multi-file)
```
describe the feature
  → Claude enters plan mode → you review + approve
  → agent team implements in parallel
  → run quality gates → commit
```
Claude's built-in agent roles handle the split:
- **pm** — reads codebase, decomposes into tasks, coordinates
- **dev1** — backend/Python (FastAPI, LangGraph, repository)
- **dev2** — frontend/TypeScript (React, Tailwind, hooks)
- **designer** — UX review, visual consistency

### Spec-driven autonomous implementation
When you have a thorough design doc (e.g. `docs/plans/my-feature.md`):

1. Write the spec with clear acceptance criteria per task
2. Tell Claude: *"Implement the spec at docs/plans/my-feature.md autonomously"*
3. Claude creates a task tree with dependencies, assigns agents, they execute
4. No back-and-forth — agents read the spec, implement, run tests, mark done
5. You review the diff and commit

The spec is the decision layer. The more complete it is, the less Claude needs to ask.

### Autonomous improvement loop (replaces `/evolve`)
To run until all quality gates pass:

```
"Run pytest + mypy + ruff + tsc. For each failure, create a task and fix it.
 Keep going until all gates are green."
```

Claude will:
1. Run the quality gates
2. Create tasks for each failure
3. Assign dev1/dev2 as appropriate
4. Fix → re-run → repeat until clean

You can also kick this off on a schedule:
```
"Every morning at 9am, run quality gates and create tasks for any failures"
→ Claude sets up a durable cron job
```

---

## Quality Gates

Run these before any commit:

```bash
pytest --tb=no -q                  # all tests pass
mypy bubbly_chef/ --strict         # no type errors
ruff check bubbly_chef/            # no lint errors
cd web && npx tsc --noEmit         # TypeScript clean
```

One command:
```bash
pytest --tb=no -q && mypy bubbly_chef/ --strict && ruff check bubbly_chef/ && cd web && npx tsc --noEmit
```

---

## Validation

```
/vibe recent     # review changed code before committing
```

This runs a multi-perspective code review on your recent changes: correctness, security, maintainability.

---

## Knowledge / Memory

Decisions, lessons, and project state persist in `.claude/agent-memory/` (auto-loaded via `MEMORY.md`).

Key commands:
```bash
# Tell Claude to remember something
"remember that [X] — save it to memory"

# Ask Claude to recall context
"check memory for anything relevant to [topic]"
```

After finishing a session with significant decisions:
```
"save a handoff note to memory capturing what we decided and why"
```

---

## Recovery

```bash
git diff                    # see what changed
git checkout .              # discard agent changes
git reset --hard <hash>     # revert to a commit
```

If context is lost mid-session:
```
"recover context — check MEMORY.md, git log, and ROADMAP.md"
```

---

## What Was Removed

AgentOps (`/rpi`, `/crank`, `/evolve`, `ao` CLI) was the previous workflow layer.

**What replaced what:**
| Old | New |
|---|---|
| `/rpi "goal"` | Describe goal → plan mode → agent team |
| `/crank` | Claude task tree + parallel agents (automatic) |
| `/evolve` | "Run gates autonomously until green" prompt |
| `/vibe` | `/vibe recent` (still works — it's a native skill) |
| `/handoff` | "Save handoff note to memory" |
| `ao lookup` | "Check memory for [topic]" |
| `.agents/` knowledge | `.claude/agent-memory/` + `MEMORY.md` |

---

## Common Failure Patterns

| Pattern | Stop sign |
|---|---|
| Fix spiral | >3 fix attempts on same thing → stop, revert, ask |
| Context amnesia | Re-introducing old bugs → check MEMORY.md first |
| Tests passing lie | Green suite, broken feature → add a smoke test |
| Silent deletion | "Cleanup" removes edge-case handling → check git diff |

---

_Last updated: 2026-03-31_
