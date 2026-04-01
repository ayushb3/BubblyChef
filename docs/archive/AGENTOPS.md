# AgentOps — BubblyChef Command Reference

> The authoritative guide for using AgentOps on this project.
> Full skill docs: `~/.claude/plugins/cache/agentops-marketplace/agentops/2.26.0/docs/`

---

## Pick Your Command

```
Not sure where to start           → /brainstorm
Understand a piece of the code    → /research "topic"
Plan a new feature                → /plan "what to build"
Validate a plan before coding     → /pre-mortem
Build one small thing             → /implement
Build a full feature end-to-end   → /rpi "goal"
Code review before shipping       → /vibe
Full retrospective after a task   → /post-mortem
Quick learning capture            → /retro --quick "insight"
Where am I?                       → /status
Save state for next session       → /handoff
Restore context after compaction  → /recover
Overnight improvement loop        → /evolve
```

---

## The Judgment Tier (Use Every Session)

| Command | When | Time |
|---------|------|------|
| `/pre-mortem` | Before writing code on any non-trivial task | ~5 min |
| `/vibe` | After writing code, before committing | ~3 min |
| `/post-mortem` | After completing a feature | ~10 min |

**Pre-mortem before every feature. Vibe before every commit. Post-mortem after every feature.** That's the habit loop that keeps the flywheel turning.

---

## Session Patterns

### Quick task (bug fix, small change)
```
1. /implement "description"
2. /vibe recent
3. git commit
4. /retro --quick "what I learned"
```

### Full feature
```
1. /research "topic"        ← understand before planning
2. /plan "feature goal"     ← creates trackable issues
3. /pre-mortem              ← what will break?
4. /crank                   ← parallel waves to completion
5. /vibe                    ← ship/no-ship verdict
6. /post-mortem             ← lock in learnings
```

### One command (fully autonomous)
```
/rpi "goal"                 ← does steps 1–6 above automatically
```

### Overnight improvement
```
ao goals measure            ← check which gates are failing
/evolve                     ← runs until GOALS.md gates pass
```

---

## GOALS.md Gates

Current fitness gates (`ao goals measure` to check):

| Gate | Check | Weight |
|------|-------|--------|
| `python-tests` | `pytest` | 5 |
| `type-check` | `mypy bubbly_chef/ --strict` | 3 |
| `lint` | `ruff check bubbly_chef/` | 3 |
| `frontend-types` | `cd web && npx tsc --noEmit` | 2 |

Add a new gate: edit `GOALS.md` with a new fitness directive, then `/evolve` picks it up.

---

## Issue Tracking (bd CLI)

`/plan` creates structured issues. If `bd` is installed:

```bash
bd ready                    # show what's unblocked and ready to implement
bd list --status in_progress
bd list --type epic --status open
```

Without `bd`, issues are tracked in `.agents/plans/` markdown files and the in-session TaskList.

---

## ao CLI Cheatsheet

```bash
ao lookup --query "receipt scanning"   # search past learnings
ao metrics health                      # flywheel above escape velocity?
ao goals measure                       # which gates pass/fail
ao ratchet status                      # current RPI phase
```

---

## Knowledge Flywheel

**What fills it:**
- `/retro --quick "insight"` during session
- `/post-mortem` after completing a feature (mandatory)

**What retrieves from it:**
- SessionStart hook (automatic — no ritual needed)
- `ao lookup --query "topic"` (on demand)
- Every `/crank` worker runs `ao lookup` before implementing

**Current state:** Check with `ao metrics health`. Needs 2-3 consistent sessions with `/retro` + `/post-mortem` to cross escape velocity.

---

## 12 Failure Patterns

| Pattern | Stop sign |
|---------|-----------|
| Fix Spiral | >3 fix attempts → stop, revert, start fresh |
| Context Amnesia | Re-introducing old bugs → use `/handoff` between sessions |
| Tests Passing Lie | Green suite, broken feature → run manual smoke test |
| Silent Deletion | "Cleanup" removes edge-case handling → check git history before deleting |
| Confident Hallucination | API calls that look right but fail at runtime → verify against actual docs |

---

*Last updated: 2026-03-16*
