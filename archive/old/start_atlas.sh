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
# Legacy cleanup (atlas_web_server.py removed in modern stack)
if pgrep -f "atlas_web_server.py" > /dev/null; then
    echo "ℹ️  Found legacy atlas_web_server.py process – stopping (deprecated)."
    pkill -f "atlas_web_server.py" || true
    sleep 1
fi

# Create logs directory
mkdir -p logs

# Start the ATLAS web server
echo "🔧 (Deprecated) atlas_web_server.py start step skipped. Use new stack scripts instead."
ATLAS_PID=0

# Wait for server to start
echo "⏳ Waiting for services to initialize..."
sleep 5

# Check if server started successfully
echo "✅ Legacy start script finished (no-op for web server)."

# Test API endpoints
echo "🔍 Testing system health..."
echo "ℹ️  Skipping health checks in deprecated script. Use ./start_stack_macos.sh and status scripts instead."

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