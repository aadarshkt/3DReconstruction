#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# run.sh — Convenience Wrapper for 3D Reconstruction Pipeline
# ──────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Help menu
show_help() {
    echo "=========================================================="
    echo " 🛠️  3D Reconstruction Pipeline Control Panel"
    echo "=========================================================="
    echo "Usage: ./run.sh [command] [options]"
    echo ""
    echo "Backend Commands (Docker):"
    echo "  start [-d]      Start the backend in Docker (DB, Redis, FastAPI, Celery+COLMAP)"
    echo "                  Use -d to run in background. Default runs in foreground."
    echo "  stop            Stop all Docker backend services"
    echo "  restart         Restart backend services in Docker"
    echo "  logs [service]  Follow container logs (e.g. ./run.sh logs or ./run.sh logs worker)"
    echo "  status          Show status & health of Docker containers"
    echo "  setup           Bootstrap local development environment"
    echo ""
    echo "Testing API (Ensure backend is running):"
    echo "  test lidar <file.json>               Test LiDAR tier"
    echo "  test video [scale] <file.mp4>        Test Video tier (scale in meters, default: 1.0)"
    echo "  test photos [scale] <files/dir>      Test Photos tier (scale in meters, default: 1.0)"
    echo "  test hybrid <json> <mp4>             Test Hybrid fusion tier (LiDAR + Video/Photos)"
    echo ""
    echo "Examples:"
    echo "  ./run.sh start -d"
    echo "  ./run.sh logs worker"
    echo "  ./run.sh test video ./my_video.mp4                       # uses default scale 1.0m"
    echo "  ./run.sh test photos ./my_room_photos/                   # uses default scale 1.0m"
    echo "  ./run.sh test photos 0.82 ./my_room_photos/              # indoor door width reference"
    echo "  ./run.sh test video 3.2 ./building.mp4                   # outdoor building floor height"
    echo "  ./run.sh test photos 0.297 ./images --stride 8           # sample every 8th image"
    echo "  ./run.sh stop"
    echo "=========================================================="
}

if [ -z "$1" ]; then
    show_help
    exit 0
fi

COMMAND=$1
shift

case "$COMMAND" in
    start)
        "$SCRIPT_DIR/start_all.sh" "$@"
        ;;
    stop)
        echo "🛑 Stopping Backend Services in Docker..."
        cd "$SCRIPT_DIR/backend"
        docker compose down
        echo "✅ Stopped."
        ;;
    restart)
        echo "🔄 Restarting Backend Services in Docker..."
        cd "$SCRIPT_DIR/backend"
        docker compose restart "$@"
        ;;
    logs)
        cd "$SCRIPT_DIR/backend"
        docker compose logs -f "$@"
        ;;
    status)
        cd "$SCRIPT_DIR/backend"
        docker compose ps
        ;;
    setup)
        echo "📦 Running Setup..."
        "$SCRIPT_DIR/setup_local.sh"
        ;;
    test)
        PYTHON_BIN="python3"
        if [ -f "$SCRIPT_DIR/.venv/bin/python3" ]; then
            PYTHON_BIN="$SCRIPT_DIR/.venv/bin/python3"
        fi

        TIER=$1
        shift
        if [ "$TIER" = "lidar" ]; then
            if [ -z "$1" ]; then echo "❌ Error: Missing file argument."; exit 1; fi
            "$PYTHON_BIN" "$SCRIPT_DIR/test_pipeline.py" --tier lidar --files "$@"
        elif [ "$TIER" = "video" ]; then
            # Check if first argument is a numeric scale value
            if [[ "$1" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
                SCALE=$1
                shift
            else
                SCALE="1.0"
                echo "ℹ️  No scale reference provided, using default scale: ${SCALE}m"
            fi
            if [ -z "$1" ]; then echo "❌ Error: Missing file argument."; exit 1; fi
            "$PYTHON_BIN" "$SCRIPT_DIR/test_pipeline.py" --tier video --scale "$SCALE" --files "$@"
        elif [ "$TIER" = "photos" ]; then
            # Check if first argument is a numeric scale value
            if [[ "$1" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
                SCALE=$1
                shift
            else
                SCALE="1.0"
                echo "ℹ️  No scale reference provided, using default scale: ${SCALE}m"
            fi
            if [ -z "$1" ]; then echo "❌ Error: Missing file/folder argument."; exit 1; fi
            "$PYTHON_BIN" "$SCRIPT_DIR/test_pipeline.py" --tier photos --scale "$SCALE" --files "$@"
        elif [ "$TIER" = "hybrid" ]; then
            if [ -z "$1" ]; then echo "❌ Error: Missing file arguments (e.g., room.json video.mp4)."; exit 1; fi
            "$PYTHON_BIN" "$SCRIPT_DIR/test_pipeline.py" --tier hybrid --files "$@"
        else
            echo "❌ Error: Unknown tier '$TIER'. Valid options: lidar, video, photos, hybrid."
            exit 1
        fi
        ;;
    *)
        echo "❌ Error: Unknown command '$COMMAND'"
        show_help
        exit 1
        ;;
esac
