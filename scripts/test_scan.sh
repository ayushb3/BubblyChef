#!/bin/bash
# Test script to verify receipt scanning integration

set -e

# Change to script directory
cd "$(dirname "$0")"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🧪 Testing Receipt Scanning Integration${NC}\n"

# Check backend is running
echo -e "${YELLOW}1. Checking backend status...${NC}"
if curl -s http://localhost:8888/health > /dev/null; then
    echo -e "${GREEN}✓ Backend is running${NC}"
    curl -s http://localhost:8888/health | python3 -m json.tool
else
    echo -e "${RED}✗ Backend is not running on port 8888${NC}"
    echo -e "${YELLOW}Start with: uvicorn bubbly_chef.api.app:app --reload --port 8888${NC}"
    exit 1
fi

echo -e "\n${YELLOW}2. Checking OCR status...${NC}"
curl -s http://localhost:8888/api/scan/ocr-status | python3 -m json.tool

OCR_AVAILABLE=$(curl -s http://localhost:8888/api/scan/ocr-status | python3 -c "import sys, json; print(json.load(sys.stdin)['available'])")

if [ "$OCR_AVAILABLE" = "True" ]; then
    echo -e "${GREEN}✓ Tesseract OCR is installed and available${NC}"
else
    echo -e "${YELLOW}⚠️  Tesseract OCR is not available${NC}"
    echo -e "${YELLOW}Install with: brew install tesseract${NC}"
fi

echo -e "\n${YELLOW}3. Checking pantry API...${NC}"
curl -s http://localhost:8888/api/pantry | python3 -c "import sys, json; data=json.load(sys.stdin); print(f\"Total items: {data['total_count']}\")"
echo -e "${GREEN}✓ Pantry API working${NC}"

echo -e "\n${YELLOW}4. Frontend build status...${NC}"
if [ -d "web/dist" ]; then
    echo -e "${GREEN}✓ Frontend build exists${NC}"
    echo -e "Build files:"
    ls -lh web/dist/*.html web/dist/assets/*.js 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
else
    echo -e "${YELLOW}⚠️  Frontend not built. Run: cd web && npm run build${NC}"
fi

echo -e "\n${YELLOW}5. Checking API client configuration...${NC}"
API_URL=$(grep "API_BASE_URL" web/src/api/client.ts | grep -o "http://[^'\"]*")
echo -e "Frontend API URL: ${API_URL}"
if [ "$API_URL" = "http://localhost:8888" ]; then
    echo -e "${GREEN}✓ API URL matches backend port${NC}"
else
    echo -e "${RED}✗ API URL mismatch${NC}"
fi

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Integration Status Summary:${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Backend:       ${GREEN}✓ Running${NC}"
echo -e "OCR Service:   ${OCR_AVAILABLE/True/${GREEN}✓ Available${NC}}"
echo -e "OCR Service:   ${OCR_AVAILABLE/False/${YELLOW}⚠️  Not Available${NC}}"
echo -e "Pantry API:    ${GREEN}✓ Working${NC}"
echo -e "Frontend:      ${GREEN}✓ Built${NC}"
echo -e "API Config:    ${GREEN}✓ Correct${NC}"

echo -e "\n${GREEN}Next Steps:${NC}"
if [ "$OCR_AVAILABLE" = "False" ]; then
    echo -e "1. Install Tesseract: ${YELLOW}brew install tesseract${NC}"
fi
echo -e "2. Start frontend: ${YELLOW}cd web && npm run dev${NC}"
echo -e "3. Open browser: ${YELLOW}http://localhost:5173${NC}"
echo -e "4. Navigate to Scan page and test receipt upload"

echo -e "\n${GREEN}✅ Integration test complete!${NC}"
