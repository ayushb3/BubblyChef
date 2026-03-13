# Claude Code Setup - Migration Guide

Complete configuration for porting Claude Code setup to a new machine.

**Current Setup Date:** 2026-03-13
**Claude Code Version:** 2.1.75
**Machine:** macOS (Darwin 25.3.0)

---

## 📋 Quick Setup Checklist

- [ ] Install Claude Code CLI
- [ ] Configure settings.json
- [ ] Set up hooks (notification system)
- [ ] Set up status line script
- [ ] Configure shell aliases
- [ ] Set up Docker sandbox (optional)
- [ ] Configure git
- [ ] Test the setup

---

## 1. Claude Code CLI Installation

```bash
# Install Claude Code (check latest installation method)
# Version: 2.1.75 or later
# Should be installed to: ~/.local/bin/claude

# Verify installation
claude --version
# Expected: "2.1.75 (Claude Code)" or later
```

---

## 2. Settings Configuration

**Location:** `~/.claude/settings.json`

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "YOUR_TOKEN_HERE",
    "ANTHROPIC_BASE_URL": "http://localhost:6655/anthropic/",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "anthropic--claude-4.5-haiku",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "anthropic--claude-4.5-opus",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "anthropic--claude-4.5-sonnet",
    "ANTHROPIC_MODEL": "anthropic--claude-4.5-sonnet",
    "DISABLE_ERROR_REPORTING": "1",
    "DISABLE_TELEMETRY": "1",
    "ENABLE_TOOL_SEARCH": "false"
  },
  "includeCoAuthoredBy": false,
  "permissions": {
    "allow": [
      "WebSearch"
    ]
  },
  "model": "opus",
  "hooks": {
    "Notification": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/YOUR_USERNAME/.claude/hooks/enhanced-notifications.sh",
            "async": true
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/YOUR_USERNAME/.claude/hooks/enhanced-notifications.sh",
            "async": true
          }
        ]
      }
    ],
    "TaskCompleted": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/YOUR_USERNAME/.claude/hooks/enhanced-notifications.sh",
            "async": true
          }
        ]
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "/bin/bash /Users/YOUR_USERNAME/.claude/statusline-command.sh"
  },
  "alwaysThinkingEnabled": false,
  "skipDangerousModePermissionPrompt": true,
  "gitAttribution": false
}
```

**⚠️ Important Notes:**
- Replace `YOUR_TOKEN_HERE` with your actual Anthropic auth token
- Replace `YOUR_USERNAME` with your actual username in all paths
- The `ANTHROPIC_BASE_URL` points to a local proxy (port 6655) - adjust if needed
- Privacy settings: telemetry and error reporting are disabled

---

## 3. Hook Scripts Setup

### 3.1 Enhanced Notifications Hook

**Location:** `~/.claude/hooks/enhanced-notifications.sh`

```bash
#!/bin/bash

# Enhanced notification script for Claude Code hooks
# Extracts rich context from hook events for informative macOS notifications

INPUT=$(cat)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // "unknown"')
PROJECT=$(echo "$INPUT" | jq -r '.cwd // empty' | xargs -I {} basename {} 2>/dev/null || echo "Project")

case "$EVENT" in
  TaskCompleted)
    TASK=$(echo "$INPUT" | jq -r '.task_subject // "Task completed"')
    TEAMMATE=$(echo "$INPUT" | jq -r '.teammate_name // empty')
    ICON="✅"
    TITLE="Task Complete"
    MSG="$TASK"
    [[ -n "$TEAMMATE" ]] && MSG="$MSG (by $TEAMMATE)"
    [[ -n "$PROJECT" ]] && MSG="$MSG in $PROJECT"
    SOUND="Glass"
    ;;

  Stop)
    # Extract first 80 chars of Claude's last message for context
    LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // "Response complete"' | head -c 80)
    ICON="🏁"
    TITLE="Claude Done"
    MSG="$LAST_MSG"
    [[ -n "$PROJECT" ]] && MSG="$MSG ($PROJECT)"
    SOUND="Pop"
    ;;

  Notification)
    TYPE=$(echo "$INPUT" | jq -r '.notification_type // "unknown"')
    MSG=$(echo "$INPUT" | jq -r '.message // "Update"')
    TITLE=$(echo "$INPUT" | jq -r '.title // "Claude Code"')

    case "$TYPE" in
      permission_prompt)
        ICON="⚠️"
        SOUND="Submarine"
        ;;
      idle_prompt)
        ICON="⏰"
        SOUND="Bell"
        ;;
      auth_success)
        ICON="✅"
        SOUND="Glass"
        ;;
      *)
        ICON="ℹ️"
        SOUND=""
        ;;
    esac

    [[ -n "$PROJECT" ]] && TITLE="$TITLE ($PROJECT)"
    ;;

  *)
    ICON="💬"
    TITLE="Claude Code"
    MSG="$EVENT event triggered"
    [[ -n "$PROJECT" ]] && MSG="$MSG in $PROJECT"
    SOUND=""
    ;;
esac

# Build osascript command
CMD="display notification \"$MSG\" with title \"$ICON $TITLE\""
[[ -n "$SOUND" ]] && CMD="$CMD sound name \"$SOUND\""

osascript -e "$CMD"
```

```bash
chmod +x ~/.claude/hooks/enhanced-notifications.sh
```

**Features:**
- macOS native notifications with sound
- Shows project name in notifications
- Different icons/sounds for different events:
  - ✅ Glass sound for task completion
  - 🏁 Pop sound when Claude finishes
  - ⚠️ Submarine sound for permission prompts
  - ⏰ Bell sound for idle prompts

**Requirements:**
- `jq` must be installed: `brew install jq`
- macOS only (uses `osascript`)

---

### 3.2 Status Line Script

**Location:** `~/.claude/statusline-command.sh`

```bash
#!/bin/bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name')
DIR=$(echo "$input" | jq -r '.workspace.current_dir')
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
DURATION_MS=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')

CYAN='\033[36m'; GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; RESET='\033[0m'
BOLD='\033[1m'; DIM='\033[2m'

# Pick bar color based on context usage
if [ "$PCT" -ge 90 ]; then BAR_COLOR="$RED"
elif [ "$PCT" -ge 70 ]; then BAR_COLOR="$YELLOW"
else BAR_COLOR="$GREEN"; fi

FILLED=$((PCT / 10)); EMPTY=$((10 - FILLED))
BAR=$(printf "%${FILLED}s" | tr ' ' '█')$(printf "%${EMPTY}s" | tr ' ' '░')

MINS=$((DURATION_MS / 60000)); SECS=$(((DURATION_MS % 60000) / 1000))

# Multi-repo status
WORKSPACE_ROOT="$DIR"
# Walk up to find workspace root (parent of all repos)
while [[ "$WORKSPACE_ROOT" != "/" ]]; do
    if [[ -d "$WORKSPACE_ROOT/experience-generation-app" ]] && \
       [[ -d "$WORKSPACE_ROOT/experience-generation-server" ]] && \
       [[ -d "$WORKSPACE_ROOT/experience-generation-docs" ]]; then
        break
    fi
    WORKSPACE_ROOT=$(dirname "$WORKSPACE_ROOT")
done

get_repo_status() {
    local repo_path="$1"
    local icon="$2"
    local name="$3"

    if [[ ! -d "$repo_path/.git" ]]; then
        echo ""
        return
    fi

    cd "$repo_path" 2>/dev/null || return
    local branch=$(git branch --show-current 2>/dev/null)
    local is_dirty=$(git status --porcelain 2>/dev/null)
    local is_current=""

    # Check if this is the current directory
    [[ "$DIR" == "$repo_path"* ]] && is_current="${BOLD}"

    if [[ -n "$is_dirty" ]]; then
        echo "${is_current}${icon} ${branch}*${RESET}"
    else
        echo "${is_current}${icon} ${branch}${RESET}"
    fi
}

APP_STATUS=$(get_repo_status "$WORKSPACE_ROOT/experience-generation-app" "📱" "app")
SERVER_STATUS=$(get_repo_status "$WORKSPACE_ROOT/experience-generation-server" "⚙️" "server")
DOCS_STATUS=$(get_repo_status "$WORKSPACE_ROOT/experience-generation-docs" "📚" "docs")

# Check if any repo is dirty (has uncommitted changes)
HAS_CHANGES=$(echo "$APP_STATUS$SERVER_STATUS$DOCS_STATUS" | grep -c '\*')

if [[ $HAS_CHANGES -gt 0 ]]; then
    # Expanded view with details
    REPO_LINE="${APP_STATUS} ${SERVER_STATUS} ${DOCS_STATUS}"
else
    # Compact view
    REPO_LINE="${DIM}${APP_STATUS} ${SERVER_STATUS} ${DOCS_STATUS}${RESET}"
fi

echo -e "${CYAN}[$MODEL]${RESET} ${REPO_LINE}"
COST_FMT=$(printf '$%.2f' "$COST")
echo -e "${BAR_COLOR}${BAR}${RESET} ${PCT}% | ${YELLOW}${COST_FMT}${RESET} | ⏱️ ${MINS}m ${SECS}s"
```

```bash
chmod +x ~/.claude/statusline-command.sh
```

**Features:**
- Shows current model in use
- Multi-repository status tracking (for monorepo workspaces)
- Color-coded context window usage bar:
  - 🟢 Green: < 70%
  - 🟡 Yellow: 70-90%
  - 🔴 Red: > 90%
- Cost tracking (total USD spent)
- Session duration timer
- Git branch status with dirty indicator (*)

**Customization:**
- Edit the multi-repo detection section to match your project structure
- Current setup checks for: `experience-generation-app`, `experience-generation-server`, `experience-generation-docs`
- Modify icons and colors as desired

**Requirements:**
- `jq` must be installed: `brew install jq`

---

## 4. Shell Configuration

Add to your `~/.zshrc` (or `~/.bashrc` for bash):

```bash
# Claude YOLO alias - skip permission prompts
alias claude-yolo="claude --dangerously-skip-permissions"

# Ensure Claude is in PATH
export PATH="$HOME/.local/bin:$PATH"
```

Then reload:
```bash
source ~/.zshrc
```

**Usage:**
```bash
# Normal mode (asks for permissions)
claude

# YOLO mode (auto-approves everything - use with caution!)
claude-yolo
```

---

## 5. Docker Sandbox Setup

**Docker Image:** `bubblychef-claude-sandbox`

You have Claude Docker sandbox containers running. To set up on a new machine:

### 5.1 Create Dockerfile

Create a Docker image for sandboxed execution:

```dockerfile
# Example Dockerfile for Claude sandbox
FROM ubuntu:22.04

# Install basic tools
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    nodejs \
    npm \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /workspace

CMD ["/bin/bash"]
```

### 5.2 Build Image

```bash
# Build the Docker image
docker build -t bubblychef-claude-sandbox .

# Or for your specific project:
docker build -t YOUR_PROJECT-claude-sandbox .
```

### 5.3 Configure Project-Specific Permissions

In your project's `.claude/settings.json` (project-level):

```json
{
  "permissions": {
    "allow": [
      "Bash(chmod +x /path/to/project/sandbox-run.sh)"
    ]
  }
}
```

### 5.4 Test Docker Setup

```bash
# List running containers
docker ps

# Should show containers like:
# YOUR_PROJECT-claude-sandbox-run-XXXXX
```

---

## 6. Git Configuration

**Location:** `~/.gitconfig`

```ini
[user]
    name = Ayush Basu
    email = ayush.basu@sap.com

[credential]
    helper = store

[pull]
    ff = false
    rebase = true

[push]
    autoSetupRemote = true

[filter "lfs"]
    clean = git-lfs clean -- %f
    smudge = git-lfs smudge -- %f
    process = git-lfs filter-process
    required = true

[diff]
    tool = semanticdiff

[difftool "vscode"]
    cmd = code --wait --diff $LOCAL $REMOTE

[core]
    editor = code --wait
    pager = delta

[interactive]
    diffFilter = delta --color-only

[delta]
    navigate = true
    side-by-side = true
    line-numbers = true
```

**Required Tools:**
- `git-lfs`: `brew install git-lfs`
- `delta` (better git diffs): `brew install git-delta`
- `code` (VS Code CLI): Install from VS Code command palette

---

## 7. Claude Directory Structure

After setup, your `~/.claude/` should look like:

```
~/.claude/
├── settings.json              # Main configuration
├── hooks/
│   ├── enhanced-notifications.sh
│   ├── test-notifications.sh
│   └── README.md
├── statusline-command.sh      # Status bar script
├── backups/                   # Automatic backups
├── cache/                     # Claude cache
├── projects/                  # Project-specific memory
│   └── -Users-YOUR_USERNAME-Personal-PROJECT/
│       └── memory/
│           └── MEMORY.md
├── sessions/                  # Session history
├── skills/                    # Custom skills
└── tasks/                     # Task tracking
```

---

## 8. Worktrees Configuration

Worktrees allow you to work in isolated git branches. Claude Code has built-in support:

### Enable Worktree Hooks (Optional)

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/custom-worktree-create.sh",
            "async": false
          }
        ]
      }
    ],
    "WorktreeRemove": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/custom-worktree-remove.sh",
            "async": false
          }
        ]
      }
    ]
  }
}
```

### Usage

```bash
# In Claude Code CLI:
# User: "start a worktree"
# Claude will create an isolated worktree in .claude/worktrees/

# To exit:
# User: "exit the worktree and keep changes"
# or: "exit the worktree and remove it"
```

---

## 9. Testing the Setup

### 9.1 Test Basic CLI
```bash
claude --version
# Should show: 2.1.75 (Claude Code) or later

claude-yolo --version
# Should work without permission prompts
```

### 9.2 Test Hooks
```bash
# Start Claude in any project
claude

# You should see:
# - Status line at bottom showing model, cost, context usage
# - macOS notifications when Claude finishes tasks
```

### 9.3 Test Notifications Manually
```bash
~/.claude/hooks/test-notifications.sh
# Should trigger test notifications
```

### 9.4 Test Docker Sandbox
```bash
docker ps | grep claude
# Should show running containers if sandbox is active
```

---

## 10. Optional: Advanced Configuration

### 10.1 Custom Skills

Place custom skill scripts in `~/.claude/skills/`

### 10.2 Project-Specific Settings

Create `.claude/settings.json` in any project for project-specific config.

Example:
```json
{
  "permissions": {
    "allow": [
      "Bash(npm run test)",
      "Bash(docker-compose up)"
    ]
  }
}
```

### 10.3 Memory System

Claude automatically creates memory files in:
```
~/.claude/projects/-PATH-TO-PROJECT/memory/
```

These persist across sessions.

---

## 11. Troubleshooting

### Notifications Not Working
```bash
# Ensure jq is installed
brew install jq

# Test the hook manually
echo '{"hook_event_name":"Stop","cwd":"/test","last_assistant_message":"Test"}' | \
  ~/.claude/hooks/enhanced-notifications.sh
```

### Status Line Not Showing
```bash
# Test the script manually
echo '{"model":{"display_name":"Sonnet"},"workspace":{"current_dir":"'"$PWD"'"},"cost":{"total_cost_usd":0.5},"context_window":{"used_percentage":45}}' | \
  bash ~/.claude/statusline-command.sh
```

### Permission Issues
```bash
# Ensure scripts are executable
chmod +x ~/.claude/hooks/*.sh
chmod +x ~/.claude/statusline-command.sh
```

### Docker Not Working
```bash
# Check Docker is running
docker ps

# Rebuild image if needed
docker build -t PROJECT-claude-sandbox .
```

---

## 12. Migration Checklist

When moving to a new machine:

- [ ] **Install Prerequisites:**
  - [ ] Claude Code CLI (2.1.75+)
  - [ ] jq (`brew install jq`)
  - [ ] git-delta (`brew install git-delta`)
  - [ ] git-lfs (`brew install git-lfs`)
  - [ ] Docker (optional, for sandboxing)

- [ ] **Copy Configuration:**
  - [ ] `~/.claude/settings.json` (update paths!)
  - [ ] `~/.claude/hooks/enhanced-notifications.sh`
  - [ ] `~/.claude/statusline-command.sh`

- [ ] **Update Paths:**
  - [ ] Replace username in settings.json
  - [ ] Update ANTHROPIC_AUTH_TOKEN
  - [ ] Update statusline multi-repo paths (if applicable)

- [ ] **Shell Configuration:**
  - [ ] Add claude-yolo alias to `.zshrc`/`.bashrc`
  - [ ] Add `~/.local/bin` to PATH
  - [ ] Run `source ~/.zshrc`

- [ ] **Git Configuration:**
  - [ ] Copy `~/.gitconfig` or run git config commands
  - [ ] Set up git-lfs: `git lfs install`

- [ ] **Test Everything:**
  - [ ] Run `claude --version`
  - [ ] Run `claude-yolo --version`
  - [ ] Test notifications
  - [ ] Test status line
  - [ ] Test Docker (if using)

---

## 13. Key Features Summary

**What You Get:**

✅ **Rich Notifications** - macOS notifications with context and sounds
✅ **Smart Status Line** - Model, cost, context usage, git status
✅ **YOLO Mode** - Skip all permission prompts (`claude-yolo`)
✅ **Docker Sandboxing** - Isolated execution environment
✅ **Privacy-First** - Telemetry disabled, no error reporting
✅ **Multi-Model Support** - Easy switching between Opus, Sonnet, Haiku
✅ **Worktree Support** - Isolated git branch workflows
✅ **Git Integration** - Delta diffs, auto-rebase, VS Code integration

---

## 14. Resources

- **Claude Code Docs:** [Check official documentation]
- **Hook System:** See `~/.claude/hooks/README.md` (if exists)
- **Status Line Guide:** Run `claude` and use `/help` for built-in docs

---

**Created:** 2026-03-13
**Version:** 1.0
**Last Updated:** 2026-03-13
