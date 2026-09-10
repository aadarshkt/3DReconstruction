#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# run.sh — Convenience Wrapper for 3D Reconstruction Pipeline
# ──────────────────────────────────────────────────────────────────────────────

set -e

# Help menu
show_help() {
    echo "=========================================================="
    echo " 🛠️  3D Reconstruction Pipeline Control Panel"
    echo "=========================================================="
    echo "Usage: ./run.sh [command] [options]"
    echo ""
    echo "Commands:"
    echo "  start           Start the backend servers (DB, Redis, FastAPI, Celery)"
    echo "  setup           Run the initial setup (install dependencies, create DB)"
    echo ""
    echo "Testing API (Ensure 'start' is running in another terminal):"
    echo "  test lidar <file.json>          Test LiDAR tier"
    echo "  test video <scale> <file.mp4>   Test Video tier (requires scale in meters)"
    echo "  test photos <scale> <files/dir> Test Photos tier (requires scale; accepts image files or folder)"
    echo "  test hybrid <json> <mp4>        Test Hybrid fusion tier (LiDAR + Video/Photos)"
    echo ""
    echo "Examples:"
    echo "  ./run.sh start"
    echo "  ./run.sh test lidar mock_room.json"
    echo "  ./run.sh test video 1.0 test_video.mp4"
    echo "  ./run.sh test photos 0.297 ./my_photos_dir/"
    echo "  ./run.sh test hybrid mock_room.json test_video.mp4"
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
        echo "🚀 Starting Backend Services..."
        ./start_all.sh
        ;;
    setup)
        echo "📦 Running Setup..."
        ./setup_local.sh
        ;;
    test)
        PYTHON_BIN="python3"
        if [ -f "./.venv/bin/python3" ]; then
            PYTHON_BIN="./.venv/bin/python3"
        fi

        TIER=$1
        shift
        if [ "$TIER" = "lidar" ]; then
            if [ -z "$1" ]; then echo "❌ Error: Missing file argument."; exit 1; fi
            "$PYTHON_BIN" ./test_pipeline.py --tier lidar --files "$@"
        elif [ "$TIER" = "video" ]; then
            if [ -z "$2" ]; then echo "❌ Error: Missing scale or file argument."; exit 1; fi
            SCALE=$1
            shift
            "$PYTHON_BIN" ./test_pipeline.py --tier video --scale "$SCALE" --files "$@"
        elif [ "$TIER" = "photos" ]; then
            if [ -z "$2" ]; then echo "❌ Error: Missing scale or file/folder arguments."; exit 1; fi
            SCALE=$1
            shift
            "$PYTHON_BIN" ./test_pipeline.py --tier photos --scale "$SCALE" --files "$@"
        elif [ "$TIER" = "hybrid" ]; then
            if [ -z "$1" ]; then echo "❌ Error: Missing file arguments (e.g., room.json video.mp4)."; exit 1; fi
            "$PYTHON_BIN" ./test_pipeline.py --tier hybrid --files "$@"
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
