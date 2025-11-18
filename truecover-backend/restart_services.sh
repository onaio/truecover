#!/bin/bash
# ABOUTME: Kills all backend services and restarts them cleanly
# ABOUTME: Prevents duplicate process accumulation

set -e

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

echo "✅ All services stopped"
echo ""
echo "🚀 Starting services..."

# Start Flask backend
cd /Users/mberg/github/truecover/truecover-backend
PYTHONUNBUFFERED=1 PORT=5001 PYTHONPATH=/Users/mberg/github/truecover/truecover-backend uv run python app.py > /tmp/truecover-backend.log 2>&1 &
echo "✅ Flask backend started (PID: $!)"

# Start Temporal worker
PYTHONUNBUFFERED=1 PYTHONPATH=/Users/mberg/github/truecover/truecover-backend uv run python temporal_worker.py > /tmp/truecover-worker.log 2>&1 &
echo "✅ Temporal worker started (PID: $!)"

echo ""
echo "📝 Logs:"
echo "  Backend: tail -f /tmp/truecover-backend.log"
echo "  Worker:  tail -f /tmp/truecover-worker.log"
