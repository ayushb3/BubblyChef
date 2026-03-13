# Command & Conquer — AI Dev Workflow

> **The pattern:** You are the PM in VSCode. Claude agents are your team: Dev, QA, and Planner.
> Git is the safety net. `CURRENT_SPRINT.md` is the source of truth.

---

## The Three Agents

| Role | Tool | Persona | When to Use |
|---|---|---|---|
| **PM / Planner** | VSCode + Claude Code (or Copilot) | Breaks down work, reviews diffs, approves output, makes architectural decisions | Always (that's you!) |
| **Dev / Executor** | Warp Terminal + Claude CLI | Implements tasks, writes code, runs basic tests, fixes errors | After PM defines task in CURRENT_SPRINT.md |
| **QA / Tester** | VSCode Terminal + Claude CLI | Runs full tests, verifies acceptance criteria, catches edge cases, reports bugs | After Dev marks task [x], BEFORE PM commits |

**Why three agents?** Context window management — each agent has a focused job:
- **PM** holds the architectural vision and makes decisions
- **Dev** focuses purely on implementation without worrying about testing strategy
- **QA** catches what Dev missed without the implementation context cluttering their focus

Splitting the roles prevents any single agent from juggling too much and forgetting critical details.

---

## Session Setup (Do Once)

```bash
# 1. Make scripts executable (first time only)
chmod +x scripts/dev-agent.sh scripts/qa-agent.sh scripts/new-sprint.sh

# 2. Confirm claude CLI is installed
claude --version
# If missing: https://github.com/anthropics/claude-code

# 3. Start Proxy (if using)
hai start proxy
```

---

## Starting a New Sprint

```bash
# Archive previous sprint and generate a clean CURRENT_SPRINT.md
./scripts/new-sprint.sh "What you're shipping this sprint"
```

Then open `CURRENT_SPRINT.md` and fill in the tasks. Each task should have:
- **What** — one paragraph of what to build
- **Files** — expected files to touch (keeps the agent focused)
- **Done when** — concrete, testable acceptance criteria
- **Hints** — patterns, gotchas, constraints

Commit the task list when it's ready:
```bash
git add CURRENT_SPRINT.md && git commit -m "plan: sprint tasks defined"
```

---

## The Three-Agent Loop

```
┌─────────────────────────────────────────────────┐
│ 1. PM defines task in CURRENT_SPRINT.md        │
│    - Clear "Done when" criteria                 │
│    - Expected files to touch                    │
│    - Any gotchas or hints                       │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ 2. Dev executes task (Warp Terminal)           │
│    ./scripts/dev-agent.sh                       │
│    - Reads next PENDING [ ] task               │
│    - Writes code                                │
│    - Runs basic tests                           │
│    - Marks task [x] when "done"                 │
│    - Gives summary of changes                   │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ 3. QA verifies (VSCode Terminal)                │
│    ./scripts/qa-agent.sh                        │
│    - Runs full test suite (pytest)              │
│    - Verifies acceptance criteria               │
│    - Tests edge cases                           │
│    - Manual UI testing (if applicable)          │
└────────────────┬────────────────────────────────┘
                 │
         ┌───────┴───────┐
         ▼               ▼
    QA PASS         QA FAIL
         │               │
         ▼               ▼
┌─────────────┐   ┌─────────────────────────────┐
│ 4. PM       │   │ QA adds bugs to             │
│ Reviews     │   │ CURRENT_SPRINT.md           │
│ diff in     │   │ as [!] BLOCKED tasks        │
│ VSCode      │   │                             │
└──────┬──────┘   └────────┬────────────────────┘
       │                   │
       ▼                   ▼
   Good? ─────────► Dev fixes bugs (goto step 2)
       │
       ▼
   git commit -m "feat: ..."
   Tell Dev "approved, next task"
```

---

## Running the Dev Agent

```bash
# Standard launch (prompts you to commit first)
./scripts/dev-agent.sh

# YOLO mode (auto-commits a snapshot then launches immediately)
./scripts/dev-agent.sh --yolo

# Custom one-off task (skips CURRENT_SPRINT.md)
./scripts/dev-agent.sh --task "Add dark mode toggle to the navbar"
```

When Claude opens, **paste the prompt from your clipboard** (it was auto-copied).

Default prompt the agent receives:
> *Read CURRENT_SPRINT.md carefully. Find the next PENDING task (marked "[ ]"). Execute that single task completely — write the code, run the tests, fix any errors. When done, update the task status in CURRENT_SPRINT.md to "[x]" and give me a concise summary of exactly what you changed. Do NOT move on to the next task — stop and wait for my review.*

---

## Running the QA Agent

**When to run:** After Dev marks a task [x], BEFORE you (PM) commit.

```bash
# Full QA check (runs all tests, verifies acceptance criteria)
./scripts/qa-agent.sh

# Fast mode (smoke test only — quick sanity check)
./scripts/qa-agent.sh --fast

# Custom QA focus
./scripts/qa-agent.sh --task "Focus on testing the receipt upload edge cases"
```

**QA Agent Checklist:**
1. ✅ All tests pass (`pytest --cov=bubbly_chef -v`)
2. ✅ Acceptance criteria from "Done when" are met
3. ✅ Manual testing passes (if UI component)
4. ✅ Edge cases handled (null values, empty states, errors)
5. ✅ No console errors or TypeScript warnings

**QA Output:**
- **Pass:** "QA APPROVED - All acceptance criteria met. Ready to commit."
- **Fail:** QA adds bugs to CURRENT_SPRINT.md as `[!] BLOCKED` tasks

---

## The Review Loop (PM's Role)

After QA approves:

```bash
# 1. Review the diff in VSCode Source Control tab (Cmd+Shift+G)
#    Click any changed file to see the diff inline

# 2. If good:
git add .
git commit -m "feat: add recipe search by ingredient"
# Tell Dev: "approved, next task"

# 3. If bad (even after QA):
git checkout .  # Discard changes
# Update hints in CURRENT_SPRINT.md
# Re-run Dev agent
```

**VSCode diff review shortcut:** Open Source Control panel (`Cmd+Shift+G`), click any changed file to see the diff inline.

---

## Handling a Stuck Agent

### If Dev Gets Stuck in Error Loop:

1. `Ctrl+C` to stop it
2. Look at the code in VSCode — figure out the actual issue
3. Add a **Hint** to the failing task in `CURRENT_SPRINT.md`:
   ```markdown
   - **Hints:** The SQLite repo uses `aiosqlite` — all queries must be `await`ed.
     Don't use `session.execute()` directly, use `repo.get_all()` instead.
   ```
4. Re-run: `./scripts/dev-agent.sh`

### If QA Keeps Failing:

1. QA should have added bugs to CURRENT_SPRINT.md as `[!] BLOCKED` tasks
2. Change the blocked task status back to `[ ]` PENDING
3. Update the hints with what QA found
4. Re-run Dev agent to fix the bugs

---

## Recovery Commands

```bash
# See what changed since last commit
git diff

# Discard all agent changes and return to last commit
git checkout .

# Revert to a specific commit (the hash is shown at launch)
git reset --hard <hash>

# See recent commits
git log --oneline -10
```

---

## Planner Prompt (For Use in VSCode / Copilot Chat)

Use this when you need help breaking work into tasks for `CURRENT_SPRINT.md`:

```
You are a senior PM helping me plan a sprint for BubblyChef, a FastAPI + React
pantry app. Architecture context: bubbly_chef/ is the backend, web/src/ is the
frontend, services layer holds business logic, routes are thin, AI calls go
through AIManager.

My goal this sprint: [DESCRIBE GOAL]

Break this into 3-5 concrete, sequential dev tasks. For each task give me:
- What to build (1 paragraph)
- Which files to touch
- Acceptance criteria (testable)
- Any gotchas or constraints

Format as markdown task items I can paste directly into CURRENT_SPRINT.md.
```

---

## Dev Agent Prompt Variants

You can override the default prompt with `--task "..."` for these patterns:

**Bug fix:**
```
Read CURRENT_SPRINT.md for context, then fix this specific bug: [describe bug].
Write a regression test that proves it's fixed. Don't change anything else.
```

**Refactor:**
```
Refactor [file/module] to follow the patterns in CLAUDE.md.
Don't change any public API signatures. Run pytest before and after to confirm nothing breaks.
```

**Test coverage:**
```
Look at bubbly_chef/[module].py and write comprehensive pytest tests for it.
Use the existing fixtures in tests/conftest.py. Aim for >80% branch coverage.
```

---

## QA Agent Prompt Variants

Override with `--task "..."` for focused testing:

**Security audit:**
```
Review the recent changes for security issues:
- SQL injection risks
- XSS vulnerabilities
- Unsafe file uploads
- API authentication gaps
Report findings and suggest fixes.
```

**Performance check:**
```
Check the recent changes for performance issues:
- N+1 queries
- Missing database indexes
- Inefficient algorithms
- Memory leaks
Run load tests if applicable. Report findings.
```

**UI/UX verification:**
```
Focus on UI/UX testing for the recent changes:
- Does it match the design system (Sanrio/kawaii aesthetic)?
- Mobile responsive?
- Loading states present?
- Error messages helpful?
- Accessibility (keyboard nav, screen readers)?
```

---

## File Reference

| File | Purpose |
|---|---|
| `CURRENT_SPRINT.md` | **The source of truth** — PM writes tasks, Dev reads, QA verifies |
| `CLAUDE.md` | Full project context for AI assistants |
| `docs/TODO.md` | Backlog and completed history |
| `docs/archive/sprints/` | Per-sprint completion archives |
| `scripts/dev-agent.sh` | Launches Claude CLI for Dev persona |
| `scripts/qa-agent.sh` | Launches Claude CLI for QA persona |
| `scripts/new-sprint.sh` | Archives current sprint, creates fresh control file |

---

## Tips for Effective Three-Agent Workflow

### PM (You)
- ✅ Write clear "Done when" criteria (makes QA's job easier)
- ✅ Include expected files in task description (keeps Dev focused)
- ✅ Add hints proactively (saves Dev from getting stuck)
- ✅ Review diffs carefully even after QA pass (you're the final check)
- ❌ Don't commit without QA approval (defeats the purpose)

### Dev Agent
- ✅ Runs basic tests (`pytest -x` for quick feedback)
- ✅ Focuses on implementation, not comprehensive testing
- ✅ Marks task [x] only when code works at basic level
- ❌ Doesn't need to think about edge cases (that's QA's job)

### QA Agent
- ✅ Runs full test suite (`pytest --cov=bubbly_chef -v`)
- ✅ Tests edge cases Dev didn't think of
- ✅ Verifies every "Done when" criterion
- ✅ Adds bugs to CURRENT_SPRINT.md (not just reports to you)
- ❌ Doesn't fix bugs (sends back to Dev for fixes)

---

## When to Skip QA

You can skip QA and go straight to PM review for:
- Trivial changes (typo fixes, comment updates)
- Documentation-only changes
- Changes that have no tests and no user-facing impact

For everything else, run QA. It takes 2 minutes and catches bugs early.

---

## Workflow Comparison

| Without QA | With QA |
|-----------|---------|
| Dev → PM review → commit → find bug → revert → fix → commit | Dev → QA → PM review → commit |
| PM has to think about edge cases during review | QA catches edge cases before PM sees code |
| Bugs found after commit (more work to revert) | Bugs found before commit (easy to fix) |
| Dev tries to be thorough, gets stuck in testing loops | Dev focuses on implementation, QA handles testing |

**Bottom line:** QA saves time by catching bugs before PM review and keeps Dev focused.

---

_Last updated: 2026-03-09_
