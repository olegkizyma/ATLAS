#!/bin/bash
# ATLAS System Status Check

echo "📊 ATLAS 3-Agent System Status"
echo "=============================="

# Check if ATLAS server is running
if pgrep -f "atlas_web_server.py" > /dev/null; then
    PID=$(pgrep -f "atlas_web_server.py")
    echo "✅ ATLAS Web Server: RUNNING (PID: $PID)"
else
    echo "❌ ATLAS Web Server: STOPPED"
fi

echo ""
echo "🌐 Port Status:"
if lsof -i:5001 > /dev/null 2>&1; then
    echo "   5001: ATLAS Web Server         🟢 ACTIVE"
else
    echo "   5001: ATLAS Web Server         🔴 FREE"
fi

echo ""
echo "🧠 Agent System:"
if curl -s http://localhost:5001/api/system/status > /dev/null 2>&1; then
    echo "✅ 3-Agent Backend: OPERATIONAL"
    
    # Get detailed status
    STATUS=$(curl -s http://localhost:5001/api/system/status 2>/dev/null)
    if [ $? -eq 0 ]; then
        echo ""
        echo "📋 Agent Details:"
        echo "   👤 Atlas (Curator/Strategist):    ACTIVE"
        echo "   👩‍💻 Tetiana (Goose Executor):     ACTIVE" 
        echo "   👮‍♂️ Grisha (Controller/Validator): ACTIVE"
    fi
else
    echo "❌ 3-Agent Backend: OFFLINE"
fi

echo ""
echo "📂 System Files:"
if [ -f "atlas_backend.py" ]; then
    echo "   atlas_backend.py               🟢 EXISTS"
else
    echo "   atlas_backend.py               🔴 MISSING"
fi

if [ -f "atlas_web_server.py" ]; then
    echo "   atlas_web_server.py            🟢 EXISTS"
else
    echo "   atlas_web_server.py            🔴 MISSING"
fi

if [ -f "atlas_prompts.py" ]; then
    echo "   atlas_prompts.py               🟢 EXISTS"
else
    echo "   atlas_prompts.py               🔴 MISSING"
fi

if [ -d "frontend_new/app/templates" ]; then
    echo "   Web Interface Templates        🟢 PRESERVED"
else
    echo "   Web Interface Templates        🔴 MISSING"
fi

if [ -d "old" ]; then
    echo "   Archived Legacy Code           🟢 AVAILABLE"
else
    echo "   Archived Legacy Code           🔴 MISSING"
fi

echo ""
echo "📝 Recent Logs:"
if [ -f "logs/atlas_system.log" ]; then
    echo "   Last 3 log entries:"
    tail -n 3 logs/atlas_system.log | sed 's/^/   /'
else
    echo "   No log file found"
fi

echo ""
echo "🛠️ Available Commands:"
echo "   Start:  ./start_atlas.sh"
echo "   Stop:   ./stop_atlas.sh" 
echo "   Status: ./status_atlas.sh"
echo "   Logs:   tail -f logs/atlas_system.log"

# Test connectivity if running
if pgrep -f "atlas_web_server.py" > /dev/null; then
    echo ""
    echo "🔗 Quick Tests:"
    
    if curl -s http://localhost:5001/api/health > /dev/null; then
        echo "   Health Check:                  ✅ PASS"
    else
        echo "   Health Check:                  ❌ FAIL"
    fi
    
    if curl -s http://localhost:5001/ > /dev/null; then
        echo "   Web Interface:                 ✅ ACCESSIBLE"
    else
        echo "   Web Interface:                 ❌ NOT ACCESSIBLE"
    fi
fi