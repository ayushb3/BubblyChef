# Three-Agent Workflow — Quick Start Guide

This is a TL;DR for the full workflow documented in [WORKFLOW.md](WORKFLOW.md).

## The Setup

```
PM (You in VSCode)
     ↓ writes tasks in CURRENT_SPRINT.md
Dev (Warp Terminal)
     ↓ implements code
QA (VSCode Terminal)
     ↓ verifies & tests
PM (You review diff)
     ↓ commits
```

## The Commands

```bash
# 1. PM: Define tasks in CURRENT_SPRINT.md

# 2. Dev: Implement
./scripts/dev-agent.sh --yolo

# 3. QA: Verify
./scripts/qa-agent.sh

# 4. PM: Review & commit
git add . && git commit -m "feat: whatever"
```

## When to Use Each Agent

| Agent | When | Where |
|-------|------|-------|
| **Dev** | You've written a task in CURRENT_SPRINT.md | Warp Terminal |
| **QA** | Dev marked task [x], before you commit | VSCode Terminal |
| **Planner** | You need help breaking down work | VSCode + Claude Code/Copilot |

## The Key Files

- `CURRENT_SPRINT.md` — Source of truth (tasks, acceptance criteria)
- `scripts/dev-agent.sh` — Launch Dev agent
- `scripts/qa-agent.sh` — Launch QA agent
- `scripts/new-sprint.sh` — Start new sprint, archive old one
- `docs/WORKFLOW.md` — Full documentation (read this!)

## QA vs No QA

**Use QA when:**
- Feature adds new functionality
- Changes affect user-facing behavior
- Task has acceptance criteria to verify
- Not 100% confident it works

**Skip QA when:**
- Typo fixes
- Doc updates
- Trivial changes you're confident about

## The Magic

Dev doesn't worry about edge cases → QA catches them before PM review → Bugs found early → Less rework → Faster shipping.

---

**Read the full docs:** [WORKFLOW.md](WORKFLOW.md)
