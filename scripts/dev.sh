#!/bin/bash
# Development server script - runs backend and frontend concurrently

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🍳 Starting BubblyChef development servers...${NC}"

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  No .env file found. Copying from .env.example...${NC}"
    cp .env.example .env
    echo -e "${YELLOW}   Please edit .env and add your BUBBLY_GEMINI_API_KEY${NC}"
fi

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Shutting down servers...${NC}"
    kill $(jobs -p) 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start backend
echo -e "${GREEN}Starting backend on http://localhost:9000${NC}"
cd "$(dirname "$0")/.."
uvicorn bubbly_chef.api.app:app --reload --host 0.0.0.0 --port 9000 &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 2

# Start frontend (if web/ directory exists)
if [ -d "web" ] && [ -f "web/package.json" ]; then
    echo -e "${GREEN}Starting frontend on http://localhost:5173${NC}"
    cd web
    npm run dev &
    FRONTEND_PID=$!
    cd ..
else
    echo -e "${YELLOW}Frontend not yet initialized. Run 'npm create vite@latest web' to set up.${NC}"
fi

echo -e "\n${GREEN}✅ Development servers running!${NC}"
echo -e "   Backend:  http://localhost:9000"
echo -e "   API Docs: http://localhost:9000/docs"
if [ -d "web" ]; then
    echo -e "   Frontend: http://localhost:5173"
fi
echo -e "\nPress Ctrl+C to stop all servers.\n"

# Wait for all background jobs
wait
