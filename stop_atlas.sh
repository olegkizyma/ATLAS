#!/bin/bash
# ATLAS System Stop Script

echo "⏹️ Stopping ATLAS 3-Agent System..."
echo "================================"

# Stop ATLAS web server
if pgrep -f "atlas_web_server.py" > /dev/null; then
    echo "🛑 Stopping ATLAS Web Server..."
    pkill -f "atlas_web_server.py"
    echo "✅ ATLAS Web Server stopped"
else
    echo "ℹ️  ATLAS Web Server not running"
fi

# Wait a moment for graceful shutdown
sleep 2

# Check if any processes are still running
if pgrep -f "atlas_web_server.py" > /dev/null; then
    echo "⚠️  Force stopping remaining processes..."
    pkill -9 -f "atlas_web_server.py"
fi

echo ""
echo "✅ ATLAS System Stopped"
echo "Port 5001 is now free"