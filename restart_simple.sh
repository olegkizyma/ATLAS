#!/bin/bash
# Complete ATLAS stack restart script with production options

echo "🔄 Restarting complete ATLAS stack..."

# Stop all ATLAS services
echo "🛑 Stopping ATLAS stack..."
./stop_stack.sh

# Stop any remaining processes manually
echo "🧹 Cleaning up remaining processes..."
pkill -f "python.*atlas_server" 2>/dev/null || true
pkill -f "python.*tts_server" 2>/dev/null || true
pkill -f "node.*server" 2>/dev/null || true
pkill -f "recovery_bridge" 2>/dev/null || true

# Force kill processes on key ports if needed
lsof -ti:5001 | xargs kill -9 2>/dev/null || true
lsof -ti:5101 | xargs kill -9 2>/dev/null || true
lsof -ti:5102 | xargs kill -9 2>/dev/null || true
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

echo "⏳ Waiting for services to stop completely..."
sleep 5

# Check if production mode requested
if [ "$1" = "production" ] || [ "$ATLAS_PRODUCTION" = "true" ]; then
    echo "🚀 Starting ATLAS in production mode (clean logs)..."
    ./start_stack_production.sh
else
    echo "🚀 Starting ATLAS in development mode..."
    
    # Create logs directory
    mkdir -p logs
    
    # Start TTS server first
    echo "🎵 Starting TTS server on port 3001..."
    cd ukrainian-tts
    if [ -d ".venv" ]; then
        source .venv/bin/activate && python tts_server.py > ../logs/tts_server.log 2>&1 &
    else
        python3 tts_server.py > ../logs/tts_server.log 2>&1 &
    fi
    echo $! > ../logs/tts.pid
    cd ..
    
    # Start frontend server
    echo "🌐 Starting Frontend server on port 5001..."
    cd frontend_new
    if [ -d "venv" ]; then
        source venv/bin/activate && python app/atlas_server.py > ../logs/frontend.log 2>&1 &
    else
        python3 app/atlas_server.py > ../logs/frontend.log 2>&1 &
    fi
    echo $! > ../logs/frontend.pid
    cd ..
    
    # Start orchestrator
    echo "🧠 Starting Orchestrator on port 5101..."
    cd frontend_new/orchestrator
    npm start > ../../logs/orchestrator.log 2>&1 &
    echo $! > ../../logs/orchestrator.pid
    cd ../..
    
    # Start recovery bridge if available
    if [ -f "frontend_new/config/recovery_bridge.py" ]; then
        echo "🔄 Starting Recovery Bridge on port 5102..."
        cd frontend_new/config
        if [ -d "../venv" ]; then
            source ../venv/bin/activate && python recovery_bridge.py > ../../logs/recovery_bridge.log 2>&1 &
        else
            python3 recovery_bridge.py > ../../logs/recovery_bridge.log 2>&1 &
        fi
        echo $! > ../../logs/recovery_bridge.pid
        cd ../..
    fi
    
    # Start Goose web interface if goose binary is available
    if command -v goose >/dev/null 2>&1; then
        echo "🦆 Starting Goose web interface on port 3000..."
        cd goose
        goose web --port 3000 > ../logs/goose.log 2>&1 &
        echo $! > ../logs/goose.pid
        cd ..
    else
        echo "⚠️  Goose binary not found. Skipping Goose startup."
        echo "   Install with: cd goose && ./download_cli.sh"
    fi
    
    echo "⏳ Waiting for services to start..."
    sleep 5
fi

echo "✅ Complete ATLAS stack restart completed."
echo ""
echo "🔍 Checking service status..."
sleep 3

# Check if services are running
echo "📊 Port Status:"
echo "   Port 5001 (Frontend): $(curl -s http://localhost:5001/api/health >/dev/null 2>&1 && echo "✅ Active" || echo "❌ Down")"
echo "   Port 5101 (Orchestrator): $(curl -s http://localhost:5101/health >/dev/null 2>&1 && echo "✅ Active" || echo "❌ Down")"
echo "   Port 5102 (Recovery): $(lsof -ti:5102 >/dev/null 2>&1 && echo "✅ Active" || echo "❌ Down")"
echo "   Port 3001 (TTS): $(curl -s http://localhost:3001/health >/dev/null 2>&1 && echo "✅ Active" || echo "❌ Down")"
echo "   Port 3000 (Goose): $(curl -s http://localhost:3000/ >/dev/null 2>&1 && echo "✅ Active" || echo "❌ Down")"

echo ""
echo "🌐 Services should be available on:"
echo "   - Frontend: http://localhost:5001"
echo "   - Orchestrator: http://localhost:5101" 
echo "   - TTS Server: http://localhost:3001"
echo "   - Goose Web: http://localhost:3000"
echo "   - Recovery Bridge: ws://localhost:5102"
echo ""
echo "📄 View logs: tail -f logs/*.log"
echo "Usage: ./restart_simple.sh [production]"
