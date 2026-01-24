#!/bin/bash
# =============================================================================
# Local Development Setup Script
# =============================================================================

set -e

echo "🚀 Setting up local development environment..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is not installed. Installing..."
    npm install -g pnpm
fi

# Create .env.local if it doesn't exist
if [ ! -f .env.local ]; then
    echo -e "${YELLOW}Creating .env.local from template...${NC}"
    cp .env.local.example .env.local
    echo -e "${GREEN}✓ Created .env.local - please update with your API keys${NC}"
fi

# Start PostgreSQL
echo -e "${YELLOW}Starting PostgreSQL database...${NC}"
docker-compose up -d postgres

# Wait for PostgreSQL to be ready
echo -e "${YELLOW}Waiting for PostgreSQL to be ready...${NC}"
sleep 5

# Check if database is ready
until docker exec startup-investments-db pg_isready -U postgres > /dev/null 2>&1; do
    echo "Waiting for database..."
    sleep 2
done

echo -e "${GREEN}✓ PostgreSQL is ready${NC}"

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
pnpm install

# Install API dependencies
echo -e "${YELLOW}Installing API dependencies...${NC}"
cd apps/api && pnpm install && cd ../..

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✓ Local development environment ready!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Available commands:"
echo "  pnpm dev           - Start frontend (http://localhost:3000)"
echo "  pnpm dev:api       - Start backend API (http://localhost:3001)"
echo "  pnpm dev:all       - Start both frontend and API"
echo "  pnpm db:studio     - Open database GUI"
echo "  pnpm db:seed       - Seed database with sample data"
echo ""
echo "Database connection:"
echo "  Host: localhost"
echo "  Port: 5432"
echo "  User: postgres"
echo "  Password: postgres"
echo "  Database: startupinvestments"
echo ""
echo "To stop the database: docker-compose down"
echo "To view logs: docker-compose logs -f postgres"
