#!/bin/bash
# Start BubblyChef backend server

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo -e "${GREEN}🍳 Starting BubblyChef Backend...${NC}"
echo ""

# Check if .env exists
if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo -e "${YELLOW}⚠️  No .env file found. Copying from .env.example...${NC}"
    cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
    echo -e "${YELLOW}   Please edit .env and add your BUBBLY_GEMINI_API_KEY${NC}"
    echo ""
fi

# Check if virtual environment exists
if [ ! -d "$PROJECT_ROOT/.venv" ]; then
    echo -e "${YELLOW}⚠️  Virtual environment not found. Creating...${NC}"
    python -m venv "$PROJECT_ROOT/.venv"
    echo -e "${GREEN}✓ Virtual environment created${NC}"
fi

# Activate virtual environment
source "$PROJECT_ROOT/.venv/bin/activate"

# Check if dependencies are installed
if ! python -c "import fastapi" 2>/dev/null; then
    echo -e "${YELLOW}⚠️  Dependencies not installed. Installing...${NC}"
    pip install -e "$PROJECT_ROOT[dev]"
    echo -e "${GREEN}✓ Dependencies installed${NC}"
    echo ""
fi

# Start backend
cd "$PROJECT_ROOT"
echo -e "${GREEN}Starting backend server...${NC}"
echo -e "   Backend:  http://localhost:8888"
echo -e "   API Docs: http://localhost:8888/docs"
echo ""
echo -e "Press Ctrl+C to stop."
echo ""

uvicorn bubbly_chef.api.app:app --reload --host 0.0.0.0 --port 8888
