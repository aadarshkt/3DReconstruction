#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# start_all.sh — Start the FloorPlan Pipeline Backend Services
# ──────────────────────────────────────────────────────────────────────────────
set -e

echo "🐳  Ensuring Docker services (PostgreSQL + Redis) are running..."
cd "$(dirname "$0")/backend"
docker-compose up -d db redis

echo "⏳  Waiting for PostgreSQL..."
until docker-compose exec -T db pg_isready -U floorplan 2>/dev/null; do
  sleep 1
done

echo "🐍  Activating virtual environment..."
if [ -f "../.venv/bin/activate" ]; then
  source ../.venv/bin/activate
elif [ -f ".venv/bin/activate" ]; then
  source .venv/bin/activate
else
  echo "❌ Error: Could not find .venv/bin/activate!"
  exit 1
fi

# Function to clean up background processes on exit
cleanup() {
    echo ""
    echo "🛑  Stopping backend services..."
    kill $UVICORN_PID $CELERY_PID 2>/dev/null || true
    wait
    echo "✅  Stopped gracefully."
    exit 0
}
trap cleanup SIGINT SIGTERM

echo "🚀  Starting FastAPI Server (port 8000)..."
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
UVICORN_PID=$!

echo "🚀  Starting Celery Worker..."
celery -A app.tasks.celery_tasks worker --loglevel=info &
CELERY_PID=$!

echo ""
echo "========================================================"
echo "✅  All services running!"
echo "    - API Docs: http://localhost:8000/docs"
echo "    - Dashboard: open ../web_dashboard/index.html"
echo "    Press Ctrl+C to stop the servers."
echo "========================================================"

wait
