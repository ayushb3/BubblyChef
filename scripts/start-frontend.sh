#!/bin/bash
# Start BubblyChef frontend development server

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo -e "${GREEN}🍳 Starting BubblyChef Frontend...${NC}"
echo ""

# Check if node_modules exists
if [ ! -d "$PROJECT_ROOT/web/node_modules" ]; then
    echo -e "${YELLOW}⚠️  Dependencies not installed. Installing...${NC}"
    cd "$PROJECT_ROOT/web"
    npm install
    echo -e "${GREEN}✓ Dependencies installed${NC}"
    echo ""
fi

# Start frontend
cd "$PROJECT_ROOT/web"
echo -e "${GREEN}Starting frontend server...${NC}"
echo -e "   Frontend: http://localhost:5173"
echo ""
echo -e "Press Ctrl+C to stop."
echo ""

npm run dev
