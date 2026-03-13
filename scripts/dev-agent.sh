#!/usr/bin/env bash
# ============================================================
# dev-agent.sh — Launch the BubblyChef Dev Agent (Claude CLI)
#
# Usage:
#   ./scripts/dev-agent.sh              # Standard launch
#   ./scripts/dev-agent.sh --yolo       # Auto-commit then launch (YOLO mode)
#   ./scripts/dev-agent.sh --task "..." # Override the initial prompt
#
# Prerequisites:
#   - claude CLI installed (npm install -g @anthropic-ai/claude-code or equivalent)
#   - CURRENT_SPRINT.md exists in project root
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
YOLO_MODE=false
CUSTOM_TASK=""

# ── Parse args ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yolo)   YOLO_MODE=true; shift ;;
    --task)   CUSTOM_TASK="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--yolo] [--task \"custom prompt\"]"
      echo ""
      echo "  --yolo          Auto-commit current state before launching agent"
      echo "  --task \"...\"    Override the default task prompt"
      exit 0
      ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

cd "$PROJECT_ROOT"

# ── Banner ──────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}🍳 BubblyChef Dev Agent Launcher${RESET}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# ── Check CURRENT_SPRINT.md exists ──────────────────────────
if [[ ! -f "$SPRINT_FILE" ]]; then
  echo -e "${RED}✗ CURRENT_SPRINT.md not found.${RESET}"
  echo "  Run: cp CURRENT_SPRINT.md.example CURRENT_SPRINT.md"
  echo "  Or run: ./scripts/new-sprint.sh"
  exit 1
fi

# ── Show pending tasks ───────────────────────────────────────
echo -e "${BOLD}📋 Pending tasks in CURRENT_SPRINT.md:${RESET}"
echo ""
PENDING=$(grep -n '^\- \[ \]' "$SPRINT_FILE" || true)
IN_PROGRESS=$(grep -n '^\- \[~\]' "$SPRINT_FILE" || true)

if [[ -n "$IN_PROGRESS" ]]; then
  echo -e "${YELLOW}  ⟳ IN PROGRESS:${RESET}"
  while IFS= read -r line; do
    echo -e "    ${YELLOW}${line}${RESET}"
  done <<< "$IN_PROGRESS"
  echo ""
fi

if [[ -n "$PENDING" ]]; then
  echo -e "${GREEN}  ▷ PENDING:${RESET}"
  while IFS= read -r line; do
    echo -e "    ${GREEN}${line}${RESET}"
  done <<< "$PENDING"
else
  echo -e "  ${GREEN}✓ No pending tasks — update CURRENT_SPRINT.md before launching!${RESET}"
  exit 0
fi
echo ""

# ── Git safety check ─────────────────────────────────────────
echo -e "${BOLD}🔒 Git safety check:${RESET}"
GIT_STATUS=$(git status --porcelain 2>/dev/null || echo "")
COMMIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

if [[ -n "$GIT_STATUS" ]]; then
  CHANGED_COUNT=$(echo "$GIT_STATUS" | wc -l | tr -d ' ')
  echo -e "  ${YELLOW}⚠  Uncommitted changes detected ($CHANGED_COUNT files)${RESET}"
  echo -e "  Current HEAD: ${BOLD}$COMMIT_HASH${RESET}"
  echo ""

  if [[ "$YOLO_MODE" == true ]]; then
    echo -e "  ${YELLOW}🚀 YOLO mode — auto-committing current state as safety snapshot...${RESET}"
    git add -A
    git commit -m "chore: safety snapshot before dev agent run [$(date '+%Y-%m-%d %H:%M')]"
    COMMIT_HASH=$(git rev-parse --short HEAD)
    echo -e "  ${GREEN}✓ Committed at $COMMIT_HASH${RESET}"
    echo -e "  ${GREEN}  Revert anytime: git reset --hard $COMMIT_HASH${RESET}"
  else
    echo -e "  ${BOLD}Options:${RESET}"
    echo "    [c] Commit now (recommended)"
    echo "    [s] Skip (launch anyway — live dangerously)"
    echo "    [q] Quit and handle manually"
    echo ""
    read -rp "  Choice [c/s/q]: " choice
    case "$choice" in
      c|C)
        read -rp "  Commit message (or press Enter for auto): " msg
        msg="${msg:-"chore: safety snapshot before dev agent run [$(date '+%Y-%m-%d %H:%M')]"}"
        git add -A
        git commit -m "$msg"
        COMMIT_HASH=$(git rev-parse --short HEAD)
        echo -e "  ${GREEN}✓ Committed at $COMMIT_HASH${RESET}"
        ;;
      s|S)
        echo -e "  ${YELLOW}Skipping commit. You're on your own! 🫡${RESET}"
        ;;
      *)
        echo "Aborted."
        exit 0
        ;;
    esac
  fi
else
  echo -e "  ${GREEN}✓ Working tree clean at ${BOLD}$COMMIT_HASH${RESET}"
fi

echo ""
echo -e "  ${CYAN}Revert tip: ${BOLD}git reset --hard $COMMIT_HASH${RESET}"
echo ""

# ── Build the initial prompt ─────────────────────────────────
if [[ -n "$CUSTOM_TASK" ]]; then
  INITIAL_PROMPT="$CUSTOM_TASK"
else
  INITIAL_PROMPT='Read CURRENT_SPRINT.md carefully. Find the next PENDING task (marked "[ ]"). Execute that single task completely — write the code, run the tests, fix any errors. When done, update the task status in CURRENT_SPRINT.md to "[x]" and give me a concise summary of exactly what you changed. Do NOT move on to the next task — stop and wait for my review.'
fi

# ── Check claude CLI is available ───────────────────────────
if ! command -v claude &>/dev/null; then
  echo -e "${RED}✗ 'claude' CLI not found in PATH.${RESET}"
  echo ""
  echo "  Install it from: https://github.com/anthropics/claude-code"
  echo "  Or via npm: npm install -g @anthropic-ai/claude-code"
  exit 1
fi

# ── Launch ───────────────────────────────────────────────────
echo -e "${BOLD}🚀 Launching Dev Agent...${RESET}"
echo ""
echo -e "  ${CYAN}Your initial prompt (auto-copied to clipboard):${RESET}"
echo ""
echo -e "  ${BOLD}${INITIAL_PROMPT}${RESET}"
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  ${YELLOW}Tip: The prompt is in your clipboard — just paste it when Claude opens.${RESET}"
echo ""

# Copy prompt to clipboard (macOS)
echo -n "$INITIAL_PROMPT" | pbcopy 2>/dev/null || true

# Small pause so user can read the above
sleep 1

# Launch Claude interactively with all file permissions pre-granted
# --dangerously-skip-permissions: don't prompt for each file read/write
exec claude --dangerously-skip-permissions
