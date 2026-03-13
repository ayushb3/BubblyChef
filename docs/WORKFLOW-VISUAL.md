# Three-Agent Workflow Visualization

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                     PM (Product Manager)                      │
│                   You in VSCode + Claude Code                 │
│                                                               │
│  • Defines tasks in CURRENT_SPRINT.md                        │
│  • Reviews diffs before committing                            │
│  • Makes architectural decisions                             │
│  • Adds hints when agents get stuck                          │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            │ writes tasks
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    CURRENT_SPRINT.md                          │
│                   📋 Source of Truth                          │
│                                                               │
│  [ ] Task 1: Build feature X                                 │
│      - What: Description                                      │
│      - Files: Expected files                                  │
│      - Done when: Acceptance criteria                         │
│      - Hints: Gotchas and patterns                            │
│                                                               │
│  [x] Task 2: Completed task                                   │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            │ reads tasks
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    Dev Agent (Executor)                       │
│                 Warp Terminal + Claude CLI                    │
│                                                               │
│  • Reads next PENDING task from CURRENT_SPRINT.md            │
│  • Implements the feature/fix                                 │
│  • Runs basic tests (pytest -x)                               │
│  • Marks task [x] when code works                             │
│  • Gives summary of changes                                   │
│                                                               │
│  Focus: Write working code, don't overthink edge cases        │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            │ task marked [x]
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    QA Agent (Tester)                          │
│               VSCode Terminal + Claude CLI                    │
│                                                               │
│  • Reads most recent [x] task from CURRENT_SPRINT.md         │
│  • Runs full test suite (pytest --cov)                        │
│  • Tests edge cases (null, empty, errors)                     │
│  • Verifies ALL acceptance criteria                           │
│  • Manual UI testing (if applicable)                          │
│  • Reports: APPROVED or adds [!] BLOCKED bugs                 │
│                                                               │
│  Focus: Break things, find edge cases, be thorough            │
└───────────────────────────┬──────────────────────────────────┘
                            │
                    ┌───────┴────────┐
                    │                │
                    ▼                ▼
               ✅ PASS          ❌ FAIL
                    │                │
                    │                │
                    │                └──► QA adds bugs to
                    │                     CURRENT_SPRINT.md
                    │                     as [!] BLOCKED tasks
                    │                            │
                    │                            │
                    │                            ▼
                    │                     Dev fixes bugs
                    │                     (loop back to Dev)
                    │
                    ▼
┌──────────────────────────────────────────────────────────────┐
│                    PM Reviews (Final Gate)                    │
│                   VSCode Source Control                       │
│                                                               │
│  • Open Source Control (Cmd+Shift+G)                          │
│  • Review each changed file's diff                            │
│  • Check architectural fit                                    │
│  • Verify it matches task intent                              │
│                                                               │
│  Decision:                                                    │
│    ✅ Approve → git commit -m "feat: ..."                     │
│    ❌ Reject  → git checkout . + update hints + re-run Dev    │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            │ committed!
                            ▼
                      Next task →

```

## Context Window Separation

```
┌─────────────────────────────────────────────────────────┐
│                  PM's Context Window                     │
│                                                          │
│  • High-level architecture                              │
│  • Sprint goals and vision                              │
│  • Task breakdown and priorities                        │
│  • Cross-feature dependencies                           │
│  • User requirements                                    │
│                                                          │
│  No clutter from: implementation details, test logs     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                 Dev's Context Window                     │
│                                                          │
│  • Current task details                                 │
│  • Code patterns from CLAUDE.md                         │
│  • Implementation approach                              │
│  • Quick test feedback                                  │
│                                                          │
│  No clutter from: test strategy, edge cases, QA work    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                 QA's Context Window                      │
│                                                          │
│  • Acceptance criteria                                  │
│  • Test results and coverage                            │
│  • Edge cases and error paths                           │
│  • Manual testing observations                          │
│                                                          │
│  No clutter from: implementation decisions, how code    │
│                   was written, architectural debates     │
└─────────────────────────────────────────────────────────┘
```

## The Feedback Loop

```
Good Flow (Happy Path):
─────────────────────────
PM writes task (5 min)
       ↓
Dev implements (10-30 min)
       ↓
QA verifies (2-5 min) ✅ PASS
       ↓
PM reviews diff (2 min)
       ↓
Commit! 🎉
Total: ~20-40 min for one task


Blocked Flow (Bug Found):
─────────────────────────
PM writes task (5 min)
       ↓
Dev implements (15 min)
       ↓
QA verifies (3 min) ❌ FAIL
       ↓
QA adds bug to CURRENT_SPRINT.md
       ↓
Dev fixes bug (5 min)
       ↓
QA re-verifies (2 min) ✅ PASS
       ↓
PM reviews diff (2 min)
       ↓
Commit! 🎉
Total: ~30 min (bug caught BEFORE PM review!)


Without QA (Old Way):
────────────────────
PM writes task (5 min)
       ↓
Dev implements (20 min)
       ↓
PM reviews diff (5 min) — finds bug! 😱
       ↓
PM discards changes (git checkout .)
       ↓
PM adds hints to task
       ↓
Dev re-implements (15 min)
       ↓
PM reviews again (5 min)
       ↓
Commit!
Total: ~50 min (PM becomes bottleneck)
```

## File Responsibilities

```
CURRENT_SPRINT.md
─────────────────
Written by: PM
Read by: Dev, QA
Purpose: Single source of truth for what to build

[ ] → Dev starts (changes to [~])
[~] → Dev working
[x] → Dev done, QA's turn
[!] → QA found bugs, blocked

CLAUDE.md
─────────
Written by: PM (maintained over time)
Read by: Dev, QA, PM
Purpose: Architectural patterns, conventions, context

docs/WORKFLOW.md
────────────────
Written by: You (one-time setup)
Read by: You (when you forget the process)
Purpose: How to use the three-agent system

scripts/dev-agent.sh
────────────────────
Runs: Dev agent with CURRENT_SPRINT.md context
Launches: Warp Terminal + Claude CLI
Git safety: Prompts for commit or uses --yolo

scripts/qa-agent.sh
───────────────────
Runs: QA agent with test verification focus
Launches: VSCode Terminal + Claude CLI
Shows: Recent [x] tasks, current git diff

scripts/new-sprint.sh
─────────────────────
Archives: Completed tasks from CURRENT_SPRINT.md
Creates: Fresh CURRENT_SPRINT.md template
Commits: Sprint boundary
```

## Why This Works

| Problem | Solution |
|---------|----------|
| Context window amnesia | Each agent has focused role, doesn't juggle everything |
| Dev stuck in test loop | Dev does basic tests, QA does thorough testing |
| PM becomes bottleneck | QA catches bugs before PM review |
| Bugs found after commit | QA catches before commit (easier to fix) |
| Unclear what to build | PM writes clear acceptance criteria upfront |
| Agents go off track | Tasks include expected files + hints |
| Lost architectural vision | PM reviews diffs, makes final decisions |

---

See [WORKFLOW.md](WORKFLOW.md) for detailed instructions.
