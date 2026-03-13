#!/usr/bin/env bash
# ============================================================
# qa-agent.sh — Launch the BubblyChef QA/Tester Agent
#
# Usage:
#   ./scripts/qa-agent.sh              # Standard QA run
#   ./scripts/qa-agent.sh --fast       # Quick smoke test only
#   ./scripts/qa-agent.sh --task "..." # Custom QA focus
#
# Purpose:
#   Run after Dev marks a task done, BEFORE you (PM) commit.
#   Verifies acceptance criteria, runs tests, checks edge cases.
# ============================================================

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Config ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SPRINT_FILE="$PROJECT_ROOT/CURRENT_SPRINT.md"
FAST_MODE=false
CUSTOM_TASK=""

# ── Parse args ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --fast)   FAST_MODE=true; shift ;;
    --task)   CUSTOM_TASK="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--fast] [--task \"custom focus\"]"
      echo ""
      echo "  --fast          Quick smoke test only (skip full test suite)"
      echo "  --task \"...\"    Override the default QA prompt"
      exit 0
      ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

cd "$PROJECT_ROOT"

# ── Banner ──────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}🧪 BubblyChef QA/Tester Agent Launcher${RESET}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# ── Check CURRENT_SPRINT.md exists ──────────────────────────
if [[ ! -f "$SPRINT_FILE" ]]; then
  echo -e "${RED}✗ CURRENT_SPRINT.md not found.${RESET}"
  exit 1
fi

# ── Show recently completed tasks ───────────────────────────
echo -e "${BOLD}📋 Recently completed tasks:${RESET}"
echo ""
COMPLETED=$(grep -n '^\- \[x\]' "$SPRINT_FILE" | tail -3 || true)

if [[ -n "$COMPLETED" ]]; then
  echo -e "${GREEN}  ✓ DONE:${RESET}"
  while IFS= read -r line; do
    echo -e "    ${GREEN}${line}${RESET}"
  done <<< "$COMPLETED"
else
  echo -e "  ${YELLOW}No completed tasks found — nothing to QA yet!${RESET}"
  echo ""
  echo "  Run ./scripts/dev-agent.sh first to have the Dev complete a task."
  exit 0
fi
echo ""

# ── Show current git diff ─────────────────────────────────────
echo -e "${BOLD}📝 Current changes since last commit:${RESET}"
echo ""
GIT_DIFF=$(git diff --stat 2>/dev/null || echo "")

if [[ -n "$GIT_DIFF" ]]; then
  echo "$GIT_DIFF"
else
  echo -e "  ${YELLOW}No uncommitted changes — everything is already committed.${RESET}"
  echo ""
  echo "  QA should run BEFORE committing. Did the Dev already commit?"
  exit 0
fi
echo ""

# ── Build the QA prompt ─────────────────────────────────────
if [[ -n "$CUSTOM_TASK" ]]; then
  INITIAL_PROMPT="$CUSTOM_TASK"
elif [[ "$FAST_MODE" == true ]]; then
  INITIAL_PROMPT='You are the QA/Tester for BubblyChef — running in FAST MODE (smoke test only).

**Your job:**
1. Read CURRENT_SPRINT.md and find the most recently completed task (marked [x])
2. Read the task'\''s acceptance criteria ("Done when" section)
3. Do a quick smoke test:
   - Does the code look reasonable?
   - Are there any obvious bugs or syntax errors?
   - Run: pytest -x (stop on first failure)
4. Report findings:
   - ✅ If smoke test passes: "QA APPROVED (FAST) - Ready for PM review"
   - ❌ If issues found: List them clearly

Skip: Deep testing, edge cases, manual UI testing (fast mode).
Be quick but catch show-stoppers.'
else
  INITIAL_PROMPT='You are the QA/Tester for BubblyChef.

**Your job:**
1. Read CURRENT_SPRINT.md and find the most recently completed task (marked [x])
2. Read the task'\''s acceptance criteria ("Done when" section)
3. Run the full test suite:
   - pytest --cov=bubbly_chef -v
   - Check for any failing tests or reduced coverage
4. Verify the feature manually (if it has a UI component):
   - Start backend: uvicorn bubbly_chef.api.app:app --reload --port 8888
   - Start frontend: cd web && npm run dev
   - Test the feature in the browser at http://localhost:5173
5. Check for edge cases:
   - Empty states, null values, missing data
   - Long inputs, special characters
   - Error handling (network failures, invalid inputs)
6. Verify ALL acceptance criteria are met from the "Done when" section
7. Report findings:
   - ✅ If all checks pass: "QA APPROVED - All acceptance criteria met. Ready to commit."
   - ❌ If issues found: Add bugs to CURRENT_SPRINT.md as new tasks with [!] BLOCKED status

**Focus areas:**
- Does the code match the task description?
- Do all existing tests still pass?
- Are there any obvious edge cases not handled?
- Does the UI work as expected (if applicable)?
- Any console errors, warnings, or TypeScript errors?
- Is error handling appropriate?

**Important:**
- Be thorough but practical (we'\''re shipping fast, not building space shuttles)
- Don'\''t block on minor style issues or micro-optimizations
- Focus on correctness, not perfection
- If tests fail, that'\''s a BLOCK — report it clearly
- If acceptance criteria aren'\''t fully met, that'\''s a BLOCK

When you find bugs, add them to CURRENT_SPRINT.md like this:

```markdown
- [!] **BUG: Fix [issue description]**
  - **What:** The [feature] fails when [condition].
  - **Files:** [file that needs fixing]
  - **Done when:** [condition] no longer causes failure.
  - **Hints:** Likely caused by [root cause guess].
```'
fi

# ── Check claude CLI is available ───────────────────────────
if ! command -v claude &>/dev/null; then
  echo -e "${RED}✗ 'claude' CLI not found in PATH.${RESET}"
  echo ""
  echo "  Install it from: https://github.com/anthropics/claude-code"
  exit 1
fi

# ── Launch ───────────────────────────────────────────────────
echo -e "${BOLD}🚀 Launching QA Agent...${RESET}"
echo ""
echo -e "  ${CYAN}Your QA prompt (auto-copied to clipboard):${RESET}"
echo ""
echo -e "  ${BOLD}[Truncated for display — full prompt in clipboard]${RESET}"
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

if [[ "$FAST_MODE" == true ]]; then
  echo -e "  ${YELLOW}⚡ FAST MODE: Running smoke test only (no deep checks)${RESET}"
else
  echo -e "  ${GREEN}🔬 FULL MODE: Running comprehensive QA checks${RESET}"
fi

echo ""
echo -e "  ${YELLOW}Tip: The prompt is in your clipboard — just paste it when Claude opens.${RESET}"
echo ""

# Copy prompt to clipboard (macOS)
echo -n "$INITIAL_PROMPT" | pbcopy 2>/dev/null || true

# Small pause so user can read the above
sleep 1

# Launch Claude interactively with all file permissions pre-granted
exec claude --dangerously-skip-permissions
