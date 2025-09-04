#!/bin/bash
# ATLAS 3-Agent System Startup Script
# Starts the new implementation with Atlas/Tetiana/Grisha agents

set -e

echo "🚀 Starting ATLAS 3-Agent System..."
echo "=================================="

# Check Python dependencies
echo "📋 Checking dependencies..."
if ! python3 -c "import flask" 2>/dev/null; then
    echo "⚠️  Installing Flask..."
    pip3 install flask requests
fi

# Check if old processes are running
if pgrep -f "atlas_web_server.py" > /dev/null; then
    echo "⚠️  Stopping existing ATLAS server..."
    pkill -f "atlas_web_server.py"
    sleep 2
fi

# Create logs directory
mkdir -p logs

# Start the ATLAS web server
echo "🔧 Starting ATLAS Web Server (Port 5001)..."
python3 atlas_web_server.py > logs/atlas_system.log 2>&1 &
ATLAS_PID=$!

# Wait for server to start
echo "⏳ Waiting for services to initialize..."
sleep 5

# Check if server started successfully
if ps -p $ATLAS_PID > /dev/null; then
    echo "✅ ATLAS Web Server started (PID: $ATLAS_PID)"
else
    echo "❌ Failed to start ATLAS Web Server"
    exit 1
fi

# Test API endpoints
echo "🔍 Testing system health..."
if curl -s http://localhost:5001/api/health > /dev/null; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed"
    exit 1
fi

if curl -s http://localhost:5001/api/system/status > /dev/null; then
    echo "✅ System status check passed"
else
    echo "❌ System status check failed"
    exit 1
fi

echo ""
echo "🎉 ATLAS System Successfully Started!"
echo "=================================="
echo "🌐 Web Interface:    http://localhost:5001"
echo "🔗 Health Endpoint:  http://localhost:5001/api/health"
echo "📊 System Status:    http://localhost:5001/api/system/status"
echo ""
echo "📋 Agent Architecture:"
echo "   👤 Atlas    - Curator/Strategist (Planning & Coordination)"
echo "   👩‍💻 Tetiana  - Goose Executor (Task Execution)"  
echo "   👮‍♂️ Grisha   - Controller/Validator (Quality & Safety)"
echo ""
echo "🔧 Management Commands:"
echo "   Start:  ./start_atlas.sh"
echo "   Stop:   ./stop_atlas.sh"
echo "   Status: ./status_atlas.sh"
echo "   Logs:   tail -f logs/atlas_system.log"
echo ""
echo "System ready for tasks! 🚀"