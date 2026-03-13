#!/usr/bin/env bash
# ============================================================
# new-sprint.sh — Archive the current sprint and start fresh
#
# Usage:
#   ./scripts/new-sprint.sh                  # Interactive
#   ./scripts/new-sprint.sh "Sprint 3 goal"  # Set goal immediately
#
# What it does:
#   1. Appends completed tasks from CURRENT_SPRINT.md → docs/TODO.md
#   2. Commits the archive
#   3. Resets CURRENT_SPRINT.md to a clean template
# ============================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SPRINT_FILE="$PROJECT_ROOT/CURRENT_SPRINT.md"
TODO_FILE="$PROJECT_ROOT/docs/TODO.md"
ARCHIVE_DIR="$PROJECT_ROOT/docs/archive/sprints"

cd "$PROJECT_ROOT"

# ── Banner ───────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}📦 New Sprint Setup${RESET}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# ── Get sprint goal ──────────────────────────────────────────
SPRINT_GOAL="${1:-}"
if [[ -z "$SPRINT_GOAL" ]]; then
  echo -e "${BOLD}What is the goal of this new sprint?${RESET}"
  echo -e "  (One sentence — e.g. 'Ship the dashboard home page')"
  echo ""
  read -rp "  Goal: " SPRINT_GOAL
fi

SPRINT_DATE=$(date '+%Y-%m-%d')
SPRINT_NAME="Sprint $(date '+%Y-%m')"

# ── Archive completed tasks from current sprint ───────────────
if [[ -f "$SPRINT_FILE" ]]; then
  COMPLETED=$(grep '^\- \[x\]' "$SPRINT_FILE" || true)

  if [[ -n "$COMPLETED" ]]; then
    echo -e "${BOLD}📝 Archiving completed tasks...${RESET}"

    mkdir -p "$ARCHIVE_DIR"
    ARCHIVE_FILE="$ARCHIVE_DIR/sprint-$SPRINT_DATE.md"

    {
      echo "# Archived Sprint — $SPRINT_DATE"
      echo ""
      echo "**Goal:** $(grep -A1 '## Sprint Goal' "$SPRINT_FILE" | tail -1 || echo 'N/A')"
      echo ""
      echo "## Completed Tasks"
      echo ""
      echo "$COMPLETED"
      echo ""
    } > "$ARCHIVE_FILE"

    echo -e "  ${GREEN}✓ Archived to docs/archive/sprints/sprint-$SPRINT_DATE.md${RESET}"

    # Also append a summary to TODO.md under a "Completed" section
    echo "" >> "$TODO_FILE"
    echo "## ✅ Completed — $SPRINT_DATE ($SPRINT_NAME)" >> "$TODO_FILE"
    echo "" >> "$TODO_FILE"
    echo "$COMPLETED" >> "$TODO_FILE"
    echo "" >> "$TODO_FILE"

    echo -e "  ${GREEN}✓ Appended to docs/TODO.md${RESET}"
  else
    echo -e "  ${YELLOW}No completed tasks found in CURRENT_SPRINT.md — skipping archive.${RESET}"
  fi
fi

# ── Write new CURRENT_SPRINT.md ───────────────────────────────
echo ""
echo -e "${BOLD}✨ Creating new CURRENT_SPRINT.md...${RESET}"

cat > "$SPRINT_FILE" << TEMPLATE
# BubblyChef — Current Sprint

> **PM instructions:** Edit this file to define tasks. The Dev agent reads it and executes one task at a time.
> **Dev agent prompt:** \`Read CURRENT_SPRINT.md. Execute the next PENDING task only. Stop and wait for review when done.\`
> **QA agent prompt:** \`Read CURRENT_SPRINT.md. Verify the most recent [x] task meets all acceptance criteria.\`

---

## Sprint Goal

$SPRINT_GOAL

---

## 📋 Task Queue

> **Status key:** \`[ ]\` PENDING → \`[~]\` IN PROGRESS → \`[x]\` DONE — \`[!]\` BLOCKED
> The Dev agent works strictly top-to-bottom. Only one \`[~]\` at a time.

### Current Tasks

- [ ] **TASK 1 — Title here**
  - **What:** Short description of what needs to be built/changed.
  - **Files:** List the expected files to touch (helps agent stay focused).
  - **Done when:** Concrete, testable acceptance criteria.
  - **Hints:** Any gotchas, patterns to follow, or constraints.

- [ ] **TASK 2 — Title here**
  - **What:** ...
  - **Files:** ...
  - **Done when:** ...
  - **Hints:** ...

---

## 🧪 QA Checklist Template

> Copy this for each task when QA runs. QA agent fills it out.

**Task:** [Task name]
**QA Run Date:** [Date]

- [ ] All tests pass (\`pytest --cov=bubbly_chef -v\`)
- [ ] Acceptance criteria met (from "Done when" section)
- [ ] Manual testing passes (if UI component)
- [ ] Edge cases handled (null, empty, errors)
- [ ] No console errors or warnings
- [ ] Code follows project patterns (CLAUDE.md)

**Status:** ✅ APPROVED / ❌ BLOCKED
**Notes:** [Any issues found or things to watch]

---

## ✅ Completed This Sprint

> Move tasks here (change \`[x]\`) after you review and commit the diff.

---

## 🚫 Out of Scope

List anything the Dev agent should NOT touch this sprint, even if it seems related:

- (Example) Do not modify the receipt scanning flow
- (Example) Do not upgrade any npm dependencies

---

## 🐛 Known Bugs / Blocked Tasks

> QA agent adds bugs here as \`[!] BLOCKED\` tasks. Dev fixes these before moving to next feature.

---

## 🗒️ PM Notes for Dev

Context the Dev agent needs that isn't obvious from the code:

- **Arch pattern:** Services layer handles business logic; routes are thin.
- **AI:** Use \`AIManager\` from \`bubbly_chef/ai/manager.py\` — never call Gemini SDK directly.
- **Frontend:** React Query for server state; avoid \`useState\` for fetched data.
- **Style:** Sanrio/kawaii pastel aesthetic — see \`CLAUDE.md\` Design System section.
- **Tests:** Write tests alongside the code, not after. Run \`pytest\` before marking done.

---

## ⚙️ Project Quick Reference

| Thing | Command |
|---|---|
| Start backend | \`uvicorn bubbly_chef.api.app:app --reload --port 8888\` |
| Start frontend | \`cd web && npm run dev\` |
| Run tests | \`pytest\` |
| Run specific test | \`pytest tests/path/test_file.py -v\` |
| Lint | \`ruff check bubbly_chef/\` |
| API docs | \`http://localhost:8888/docs\` |
| Launch dev agent | \`./scripts/dev-agent.sh\` |
| Launch QA agent | \`./scripts/qa-agent.sh\` |

---

_Last updated by PM: $SPRINT_DATE_
TEMPLATE

echo -e "  ${GREEN}✓ CURRENT_SPRINT.md ready${RESET}"

# ── Commit ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}💾 Committing sprint boundary...${RESET}"
git add -A
git commit -m "chore: new sprint — $SPRINT_GOAL [$SPRINT_DATE]" 2>/dev/null || \
  echo -e "  ${YELLOW}Nothing to commit (no changes detected).${RESET}"

# ── Done ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}✓ Sprint initialized!${RESET}"
echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo "  1. Open CURRENT_SPRINT.md and fill in your tasks"
echo "  2. Commit the task list when ready"
echo "  3. Run ./scripts/dev-agent.sh to launch the Dev agent"
echo ""
