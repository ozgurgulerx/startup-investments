#!/bin/bash
# =============================================================================
# Seed the local database with sample data
# =============================================================================

set -e

echo "🌱 Seeding database..."

# Run seed script
docker exec -i startup-investments-db psql -U postgres -d startupinvestments < database/seeds/sample_data.sql

echo "✓ Database seeded successfully"
