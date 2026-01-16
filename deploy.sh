#!/bin/bash
# deploy.sh
set -e

echo "==================================="
echo "  Polygon Dashboard - Deploy"
echo "==================================="

if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo ""
    echo "Please edit .env with your configuration:"
    echo "  - POLYGON_RPC_URLS (required)"
    echo "  - APP_PORT (default: 3000)"
    echo "  - DB_PASSWORD (recommended to change)"
    echo "  - BACKFILL_TO_BLOCK (how far back to sync)"
    echo ""
    read -p "Press enter after editing .env to continue..."
fi

set -a
source .env
set +a

if [ -z "$POLYGON_RPC_URLS" ]; then
    echo "Error: POLYGON_RPC_URLS is required in .env"
    exit 1
fi

echo ""
echo "Starting Polygon Dashboard..."
docker compose up -d --build

echo ""
echo "==================================="
echo "  Deployment Complete!"
echo "==================================="
echo ""
echo "  Dashboard: http://localhost:${APP_PORT:-3000}"
echo "  Database:  localhost:${DB_PORT:-5432}"
echo ""
echo "  View logs: docker compose logs -f"
echo "  Stop:      docker compose down"
