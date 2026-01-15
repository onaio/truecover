#!/bin/bash
# ABOUTME: Kills all backend services and restarts them cleanly
# ABOUTME: Prevents duplicate process accumulation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")/truecover-app"

echo "🛑 Stopping all backend services..."

# Kill all running app.py processes
pkill -f "python.*app.py" || true

# Kill all running temporal_worker.py processes
pkill -f "python.*temporal_worker.py" || true

# Wait for processes to fully terminate
sleep 2

# Verify nothing is running
if pgrep -f "python.*app.py" > /dev/null; then
    echo "❌ Warning: app.py processes still running"
    pgrep -af "python.*app.py"
fi

if pgrep -f "python.*temporal_worker.py" > /dev/null; then
    echo "❌ Warning: temporal_worker.py processes still running"
    pgrep -af "python.*temporal_worker.py"
fi

echo "✅ All Python services stopped"
echo ""

echo "🐳 Starting Docker services..."

# Start backend infrastructure (postgres, martin, temporal)
cd "$SCRIPT_DIR"
docker compose up -d
echo "✅ Backend infrastructure started (postgres, martin, temporal)"

# Start ML services (adaptive-sampling, prevalence-predictor, covariate-extractor)
if [ -d "$APP_DIR" ]; then
    cd "$APP_DIR"
    docker compose up -d adaptive-sampling prevalence-predictor covariate-extractor
    echo "✅ ML services started (adaptive-sampling:8083, prevalence-predictor:8084, covariate-extractor:8082)"
else
    echo "⚠️  App directory not found at $APP_DIR - ML services not started"
fi

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 5

echo ""
echo "🚀 Starting Python services..."

# Start Flask backend
cd "$SCRIPT_DIR"
PYTHONUNBUFFERED=1 PORT=5001 PYTHONPATH="$SCRIPT_DIR" uv run python app.py > /tmp/truecover-backend.log 2>&1 &
echo "✅ Flask backend started (PID: $!, port 5001)"

# Start Temporal worker
PYTHONUNBUFFERED=1 PYTHONPATH="$SCRIPT_DIR" uv run python temporal_worker.py > /tmp/truecover-worker.log 2>&1 &
echo "✅ Temporal worker started (PID: $!)"

echo ""
echo "📝 Logs:"
echo "  Backend: tail -f /tmp/truecover-backend.log"
echo "  Worker:  tail -f /tmp/truecover-worker.log"
echo ""
echo "🌐 URLs:"
echo "  Frontend:     http://localhost:3050"
echo "  Backend API:  http://localhost:5001"
echo "  Martin Tiles: http://localhost:3052"
echo "  Temporal UI:  http://localhost:8080"
