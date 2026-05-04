# BubblyChef — Workflow Reference

> How to get the most out of Claude Code for feature work, bug fixes, and larger initiatives.

---

## Orientation

Read `ROADMAP.md` for current phase + open issues. `MEMORY.md` is auto-loaded each session.

---

## The Pipeline

All work flows through GitHub Issues. The depth of the pipeline depends on scope:

```
Small fix:
  describe bug → Claude implements → quality gates → commit → push

Feature (multi-file):
  explore → plan mode (docs/plans/) → approve → agent team implements → commit → push

Large initiative:
  explore → plan mode → /to-prd (creates parent GH issue)
    → /to-issues (breaks PRD into vertical-slice child issues)
    → implement each issue → commit → push
```

### Plan Mode

For non-trivial work, Claude enters plan mode to explore the codebase and propose an approach before writing code. The plan is saved to `docs/plans/` with a date prefix.

### `/to-prd` — Synthesize a PRD

When a design conversation reaches clarity, `/to-prd` synthesizes a PRD from conversation context:
- Problem statement, solution, user stories
- Implementation decisions (modules, interfaces, schemas)
- Testing decisions
- Publishes as a GitHub Issue with `needs-triage` label

### `/to-issues` — Break into vertical slices

Takes a PRD (or any large issue) and breaks it into independently-implementable vertical slices:
- Each slice cuts through ALL layers end-to-end (schema → API → UI → tests)
- Each slice is demoable/verifiable on its own
- Slices are marked HITL (needs human decision) or AFK (fully autonomous)
- Published as child GitHub Issues with dependency links

### Implementing Issues

Once issues exist:
- Small issues → describe goal, Claude implements directly
- Larger issues → plan mode → agent team (dev1 backend, dev2 frontend)
- Each completed issue → quality gates → commit → push → close issue

---

## Workflows

### Quick fix / small change
```
describe the bug or change → Claude implements → quality gates → commit
```

### Feature (multi-file)
```
describe the feature
  → Claude enters plan mode → you review + approve
  → agent team implements in parallel
  → quality gates → commit
```

Agent roles:
- **dev1** — backend/Python (FastAPI, LangGraph, repository)
- **dev2** — frontend/TypeScript (React, Tailwind, hooks)

### Spec-driven autonomous implementation
When you have a thorough design doc (e.g. `docs/plans/my-feature.md`):

1. Write the spec with clear acceptance criteria per task
2. Tell Claude: *"Implement the spec at docs/plans/my-feature.md autonomously"*
3. Claude creates a task tree with dependencies, assigns agents, they execute
4. No back-and-forth — agents read the spec, implement, run tests, mark done
5. You review the diff and commit

### Autonomous improvement loop
```
"Run pytest + mypy + ruff + tsc. For each failure, create a task and fix it.
 Keep going until all gates are green."
```

---

## Quality Gates

Run these before any commit:

```bash
# AI microservice
cd ai-service && pytest --tb=no -q && mypy bubbly_chef/ --strict && ruff check bubbly_chef/

# Frontend
cd nextjs && npx tsc --noEmit
```

---

## Validation

```
/vibe recent     # multi-perspective code review on recent changes
```

---

## Knowledge / Memory

Decisions and project state persist in auto-memory (auto-loaded via `MEMORY.md`).

```bash
# Tell Claude to remember something
"remember that [X] — save it to memory"

# Persist context for next session
"save a handoff note capturing what we decided and why"
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

## Common Failure Patterns

| Pattern | Stop sign |
|---|---|
| Fix spiral | >3 fix attempts on same thing → stop, revert, ask |
| Context amnesia | Re-introducing old bugs → check MEMORY.md first |
| Tests passing lie | Green suite, broken feature → add a smoke test |
| Silent deletion | "Cleanup" removes edge-case handling → check git diff |

---

_Last updated: 2026-05-03_
