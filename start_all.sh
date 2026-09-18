#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# start_all.sh — Start the FloorPlan Pipeline Backend Services in Docker
# ──────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/backend"

DETACHED=false
if [ "$1" = "-d" ] || [ "$1" = "--detached" ]; then
    DETACHED=true
fi

echo "🐳  Starting Docker backend stack (PostgreSQL, Redis, FastAPI, Celery + COLMAP)..."

if [ "$DETACHED" = true ]; then
    docker compose up -d --build
    echo ""
    echo "========================================================"
    echo "✅  All microservices running in background (Docker)!"
    echo "    - Main Backend: http://localhost:8000 (Docs: /docs)"
    echo "    - Tour Service: http://localhost:8001"
    echo "    - Auth Service: http://localhost:8002"
    echo "    - View logs:    ./run.sh logs"
    echo "    - Stop stack:   ./run.sh stop"
    echo "========================================================"
else
    cleanup() {
        echo ""
        echo "🛑  Stopping backend containers..."
        docker compose stop
        echo "✅  Stopped gracefully."
        exit 0
    }
    trap cleanup SIGINT SIGTERM

    echo "    (Press Ctrl+C to stop the containers)"
    echo ""
    docker compose up --build
fi
