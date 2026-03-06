#!/bin/bash
# Quick start script - runs both backend and frontend

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🍳 Starting BubblyChef...${NC}"
echo ""

# Run the dev script
exec ./scripts/dev.sh
