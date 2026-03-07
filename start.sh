#!/bin/bash
# BubblyChef Quick Start - Choose how to run the app

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${GREEN}${BOLD}🍳 BubblyChef Quick Start${NC}"
echo ""
echo -e "Choose how to start the application:"
echo ""
echo -e "${CYAN}1)${NC} Both backend and frontend ${YELLOW}(requires 2 terminals)${NC}"
echo -e "${CYAN}2)${NC} Backend only"
echo -e "${CYAN}3)${NC} Frontend only"
echo ""
read -p "Enter choice [1-3]: " choice

case $choice in
    1)
        echo ""
        echo -e "${GREEN}Starting both services...${NC}"
        echo ""
        echo -e "${YELLOW}${BOLD}IMPORTANT:${NC}${YELLOW} This will run both in separate terminals.${NC}"
        echo ""
        echo -e "Opening two new terminal windows:"
        echo -e "  ${CYAN}→${NC} Terminal 1: Backend  (http://localhost:9000)"
        echo -e "  ${CYAN}→${NC} Terminal 2: Frontend (http://localhost:5173)"
        echo ""
        echo -e "Press any key to continue..."
        read -n 1

        # macOS - use Terminal or iTerm2
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # Try iTerm2 first, fall back to Terminal
            if [ -d "/Applications/iTerm.app" ]; then
                # iTerm2
                osascript <<EOF
tell application "iTerm"
    activate
    create window with default profile
    tell current session of current window
        write text "cd \"$(pwd)\" && ./scripts/start-backend.sh"
    end tell
    create window with default profile
    tell current session of current window
        write text "cd \"$(pwd)\" && ./scripts/start-frontend.sh"
    end tell
end tell
EOF
            else
                # Terminal.app
                osascript <<EOF
tell application "Terminal"
    activate
    do script "cd \"$(pwd)\" && ./scripts/start-backend.sh"
    do script "cd \"$(pwd)\" && ./scripts/start-frontend.sh"
end tell
EOF
            fi
            echo -e "${GREEN}✓ Opened new terminals${NC}"
        # Linux with gnome-terminal
        elif command -v gnome-terminal &> /dev/null; then
            gnome-terminal -- bash -c "./scripts/start-backend.sh; exec bash" &
            gnome-terminal -- bash -c "./scripts/start-frontend.sh; exec bash" &
            echo -e "${GREEN}✓ Opened new terminals${NC}"
        # Linux with xterm
        elif command -v xterm &> /dev/null; then
            xterm -e "./scripts/start-backend.sh" &
            xterm -e "./scripts/start-frontend.sh" &
            echo -e "${GREEN}✓ Opened new terminals${NC}"
        else
            echo -e "${YELLOW}⚠️  Could not detect terminal emulator.${NC}"
            echo ""
            echo "Please run these commands in separate terminals:"
            echo -e "  ${CYAN}Terminal 1:${NC} ./scripts/start-backend.sh"
            echo -e "  ${CYAN}Terminal 2:${NC} ./scripts/start-frontend.sh"
        fi
        ;;
    2)
        echo ""
        echo -e "${GREEN}Starting backend only...${NC}"
        echo ""
        exec ./scripts/start-backend.sh
        ;;
    3)
        echo ""
        echo -e "${GREEN}Starting frontend only...${NC}"
        echo ""
        exec ./scripts/start-frontend.sh
        ;;
    *)
        echo ""
        echo -e "${YELLOW}Invalid choice. Please run ./start.sh again.${NC}"
        exit 1
        ;;
esac
