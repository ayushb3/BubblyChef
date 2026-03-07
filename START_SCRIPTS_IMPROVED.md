# Start Scripts Improved ✅

**Date:** 2026-03-06

## Summary

Updated the start scripts to provide better developer experience with separate terminal support and clear options.

---

## 🎯 What Changed

### Before
- ❌ `start.sh` ran both services in same terminal (messy output)
- ❌ `scripts/dev.sh` killed services on exit with traps
- ❌ No way to run just backend or frontend easily
- ❌ Mixed logs made debugging hard

### After
- ✅ `start.sh` - Interactive menu with 3 options
- ✅ `scripts/start-backend.sh` - Backend only, clean
- ✅ `scripts/start-frontend.sh` - Frontend only, clean
- ✅ `scripts/dev.sh` - Still available for legacy/CI use
- ✅ Automatic terminal window creation (macOS/Linux)

---

## 📋 New Scripts

### 1. `./start.sh` - Interactive Menu

```bash
./start.sh

# Prompts:
# 1) Both backend and frontend (opens 2 terminals)
# 2) Backend only
# 3) Frontend only
```

**Features:**
- Interactive choice menu
- Auto-detects terminal emulator (iTerm2, Terminal.app, gnome-terminal, xterm)
- Opens new terminal windows automatically on macOS/Linux
- Falls back to manual instructions if terminal not detected
- Color-coded output

**Supported Terminals:**
- macOS: iTerm2 (preferred) or Terminal.app
- Linux: gnome-terminal, xterm
- Windows: Manual instructions

### 2. `./scripts/start-backend.sh` - Backend Only

```bash
./scripts/start-backend.sh
```

**Features:**
- Checks and creates .venv if missing
- Checks and installs dependencies if missing
- Activates virtual environment automatically
- Starts backend on port 9000
- Clean, focused output
- Shows URLs (backend + API docs)

**Output:**
```
🍳 Starting BubblyChef Backend...

Starting backend server...
   Backend:  http://localhost:9000
   API Docs: http://localhost:9000/docs

Press Ctrl+C to stop.

[Clean uvicorn logs]
```

### 3. `./scripts/start-frontend.sh` - Frontend Only

```bash
./scripts/start-frontend.sh
```

**Features:**
- Checks and installs node_modules if missing
- Starts frontend on port 5173
- Clean, focused output
- Shows URL

**Output:**
```
🍳 Starting BubblyChef Frontend...

Starting frontend server...
   Frontend: http://localhost:5173

Press Ctrl+C to stop.

[Clean Vite logs]
```

### 4. `./scripts/dev.sh` - Legacy/CI Support

Still available for:
- CI/CD pipelines
- Users who prefer single terminal
- Automated testing

**Note:** Runs both in same terminal with combined output.

---

## 🎨 User Experience

### Workflow 1: Interactive (Recommended)

```bash
# Start the app
./start.sh

# Choose option 1: Both
# → Two new terminal windows open
# → Backend in window 1
# → Frontend in window 2
# → Clean, separate logs
```

### Workflow 2: Backend Development

```bash
# Working on backend only
./scripts/start-backend.sh

# Clean backend logs only
# No frontend noise
# Easy debugging
```

### Workflow 3: Frontend Development

```bash
# Working on frontend only
./scripts/start-frontend.sh

# Clean frontend logs only
# No backend noise
# Fast iteration
```

### Workflow 4: Full Stack

```bash
# Terminal 1
./scripts/start-backend.sh

# Terminal 2
./scripts/start-frontend.sh

# Full control
# Restart independently
```

---

## 🔧 Technical Details

### Auto Terminal Detection (macOS)

```bash
# Tries iTerm2 first
if [ -d "/Applications/iTerm.app" ]; then
    osascript <<EOF
tell application "iTerm"
    create window with default profile
    tell current session of current window
        write text "cd \"$(pwd)\" && ./scripts/start-backend.sh"
    end tell
end tell
EOF
fi
```

Falls back to Terminal.app if iTerm2 not found.

### Auto Terminal Detection (Linux)

```bash
# Try gnome-terminal
if command -v gnome-terminal &> /dev/null; then
    gnome-terminal -- bash -c "./scripts/start-backend.sh; exec bash" &
fi

# Try xterm
elif command -v xterm &> /dev/null; then
    xterm -e "./scripts/start-backend.sh" &
fi
```

### Dependency Checking

Both scripts check and auto-install:
- Backend: Python venv + dependencies
- Frontend: node_modules

**First run:**
```bash
./scripts/start-backend.sh
# → Detects missing venv
# → Creates venv
# → Installs dependencies
# → Starts server
```

**Subsequent runs:**
```bash
./scripts/start-backend.sh
# → Everything ready
# → Starts immediately
```

---

## 📚 Documentation Updates

### README.md

Updated with:
```markdown
### Quick Start Scripts

```bash
# Interactive menu (recommended)
./start.sh

# Or run directly:
./scripts/start-backend.sh   # Backend only
./scripts/start-frontend.sh  # Frontend only
```

### CLAUDE.md

Updated with all script options and usage.

---

## ✅ Benefits

1. **Cleaner Logs**
   - Separate terminals = separate logs
   - Easy to debug specific service
   - No mixed output

2. **Better DX**
   - One command to start everything
   - Choose what you need
   - Automatic setup checks

3. **Flexibility**
   - Backend only for API work
   - Frontend only for UI work
   - Both for full stack
   - Manual control when needed

4. **Onboarding**
   - New devs just run `./start.sh`
   - Auto-installs dependencies
   - Clear instructions

5. **Platform Support**
   - Works on macOS (iTerm2/Terminal)
   - Works on Linux (gnome-terminal/xterm)
   - Graceful fallback for other systems

---

## 🎯 Script Summary

| Script | Purpose | Terminals | Best For |
|--------|---------|-----------|----------|
| `./start.sh` | Interactive menu | 0-2 | Getting started |
| `./scripts/start-backend.sh` | Backend only | 1 | Backend dev |
| `./scripts/start-frontend.sh` | Frontend only | 1 | Frontend dev |
| `./scripts/dev.sh` | Both (legacy) | 1 | CI/CD, automated |

---

## 🚀 Usage Examples

### New Developer

```bash
git clone <repo>
cd BubblyChef
./start.sh
# Choose option 1
# → Both services start in separate terminals
# → Ready to code!
```

### Backend Work

```bash
./scripts/start-backend.sh
# → Clean backend logs
# → Make API changes
# → See immediate feedback
```

### Frontend Work

```bash
./scripts/start-frontend.sh
# → Clean frontend logs
# → Make UI changes
# → Hot reload works perfectly
```

### Full Control

```bash
# Terminal 1
./scripts/start-backend.sh

# Terminal 2
./scripts/start-frontend.sh

# Restart either independently
# Debug with clean logs
```

---

## 📝 Files Modified

| File | Changes |
|------|---------|
| `start.sh` | Complete rewrite - interactive menu |
| `scripts/start-backend.sh` | New - backend only script |
| `scripts/start-frontend.sh` | New - frontend only script |
| `scripts/dev.sh` | Kept for legacy/CI support |
| `README.md` | Updated quick start section |
| `CLAUDE.md` | Updated with all script options |

---

## 🎉 Result

**Before:**
- One script, both services, messy logs
- Hard to debug
- Had to manually run in separate terminals

**After:**
- Interactive menu with options
- Separate scripts for each service
- Auto-opens terminals on macOS/Linux
- Clean, focused logs
- Better developer experience

**Developers can now:**
1. Start everything with one command
2. Choose what to run
3. Get clean, separate logs
4. Debug more easily
5. Work on specific services

**The startup experience is now professional and user-friendly!** 🚀
