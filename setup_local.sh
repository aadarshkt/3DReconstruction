#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# setup_local.sh — Bootstrap the FloorPlan Pipeline backend locally (macOS)
# ──────────────────────────────────────────────────────────────────────────────
set -e

echo "📦  Installing Homebrew dependencies…"
brew install colmap ffmpeg postgresql@16 redis || true

echo "🐳  Starting Docker services (PostgreSQL + Redis via docker-compose)…"
cd "$(dirname "$0")/backend"

# Copy env if not present
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✅  Created backend/.env from .env.example — edit secrets if needed."
fi

# Start only the DB and Redis (not the API — we run that locally below)
docker-compose up -d db redis

echo "⏳  Waiting for PostgreSQL to be ready…"
sleep 5
until docker-compose exec -T db pg_isready -U floorplan 2>/dev/null; do
  sleep 1
done

echo "🐍  Setting up Python virtual environment…"
python3.11 -m venv .venv
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

echo "🗃️   Running database migrations…"
alembic upgrade head

echo ""
echo "✅  Setup complete!  Start the backend with:"
echo ""
echo "     # Terminal 1 — FastAPI"
echo "     cd backend && source .venv/bin/activate"
echo "     uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
echo ""
echo "     # Terminal 2 — Celery worker"
echo "     cd backend && source .venv/bin/activate"
echo "     celery -A app.tasks.celery_tasks worker --loglevel=info"
echo ""
echo "     # Web dashboard (no server needed)"
echo "     open web_dashboard/index.html"
echo ""
echo "     # API docs"
echo "     open http://localhost:8000/docs"
