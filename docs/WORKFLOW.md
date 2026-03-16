# BubblyChef Workflow — AgentOps

> AgentOps is the primary workflow. Use `/rpi` for features, `/vibe` before commits, `/status` to orient.

---

## The One Command That Does Everything

```bash
/rpi "describe your goal"
```

This runs the full cycle: research → plan → implement → validate → learnings captured. You review the diff and commit.

---

## When to Use What

| Situation | Command |
|-----------|---------|
| Start a new feature or fix | `/rpi "goal"` |
| Understand the codebase first | `/research "topic"` |
| Break work into trackable issues | `/plan "goal"` then `/crank` |
| Review code before committing | `/vibe recent` |
| Validate a plan before coding | `/pre-mortem` |
| Where am I / what's ready? | `/status` |
| Multi-model code review | `/council` |
| Run overnight against goals | `/evolve` |
| Save state before ending session | `/handoff` |
| Where was I after context loss? | `/recover` |

---

## Session Patterns

### Quick task (bug fix, small change)
```
/implement "description"
/vibe recent
git commit
```

### Full feature
```
/rpi "feature goal"
→ reviews research → plan → approves → crank runs → vibe → commit
```

### Autonomous overnight
```
ao goals measure        ← check which gates fail
/evolve                 ← runs RPI cycles against GOALS.md until gates pass
```

---

## The AgentOps Loop

```
You describe a goal
      │
      ▼
/rpi runs automatically:
  1. Research  — explores codebase, injects past learnings from .agents/
  2. Plan      — decomposes into issues with waves [approval gate]
  3. Crank     — parallel agents implement each issue
  4. Validate  — /vibe quality check + /post-mortem extracts learnings
      │
      ▼
You review the diff → git commit
```

Knowledge from every session flows into `.agents/` and is automatically injected at the start of the next one.

---

## Knowledge Flywheel

```bash
ao lookup --query "topic"     # search past decisions
ao metrics health             # is flywheel above escape velocity?
ao goals measure              # which GOALS.md gates pass/fail
```

**What fills it:** `/retro --quick "insight"` during session, `/post-mortem` after features.

**What uses it:** Every session start (automatic hook), every `/crank` worker before implementing.

---

## File Reference

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Architecture, stack, patterns — loaded every session |
| `GOALS.md` | Fitness gates — `/evolve` runs until these pass |
| `docs/AGENTOPS.md` | Full AgentOps command reference |
| `docs/ROADMAP.md` | Product vision and phase plan |
| `.agents/` | Knowledge store — learnings, research, council verdicts |

---

## Recovery

```bash
git diff                  # see what changed
git checkout .            # discard agent changes
git reset --hard <hash>   # revert to a commit
/recover                  # restore AgentOps context after compaction
/handoff                  # save session state before ending
```

---

## Legacy Scripts (Manual Fallback)

The original three-agent scripts still work if you need manual control:

```bash
scripts/dev-agent.sh    # launch Dev agent against a task
scripts/qa-agent.sh     # launch QA agent for verification
scripts/new-sprint.sh   # archive old sprint, start fresh
```

For all normal work, use `/rpi` instead.

---

## Common Failure Patterns

| Pattern | Stop sign |
|---------|-----------|
| Fix spiral | >3 fix attempts → stop, revert, restart |
| Context amnesia | Re-introducing old bugs → use `/handoff` between sessions |
| Tests passing lie | Green suite, broken feature → run manual smoke test |
| Silent deletion | "Cleanup" removes edge-case handling → check git history |

---

_Last updated: 2026-03-16_
