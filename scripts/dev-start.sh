#!/bin/bash
# =============================================================================
# Start all development services
# =============================================================================

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Starting development services...${NC}"

# Ensure PostgreSQL is running
if ! docker ps | grep -q startup-investments-db; then
    echo -e "${YELLOW}Starting PostgreSQL...${NC}"
    docker-compose up -d postgres
    sleep 3
fi

echo -e "${GREEN}✓ Database running on localhost:5432${NC}"

# Start API in background
echo -e "${YELLOW}Starting API server...${NC}"
cd apps/api
pnpm dev &
API_PID=$!
cd ../..

# Wait a moment for API to start
sleep 2
echo -e "${GREEN}✓ API running on http://localhost:3001${NC}"

# Start frontend
echo -e "${YELLOW}Starting frontend...${NC}"
pnpm dev

# Cleanup on exit
trap "kill $API_PID 2>/dev/null" EXIT
