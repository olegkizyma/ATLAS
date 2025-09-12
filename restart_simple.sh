#!/bin/bash
# Complete ATLAS stack restart script with production options

echo "🔄 Restarting complete ATLAS stack..."

# Load environment variables from .env if present (exports like PYTHONPATH)
if [ -f .env ]; then
  echo "📦 Loading environment from .env"
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Stop all ATLAS services
echo "🛑 Stopping ATLAS stack..."
./stop_stack.sh

# Stop any remaining processes manually
echo "🧹 Cleaning up remaining processes..."
pkill -f "python.*atlas_server" 2>/dev/null || true
pkill -f "python.*tts_server" 2>/dev/null || true
pkill -f "node.*server" 2>/dev/null || true
pkill -f "recovery_bridge" 2>/dev/null || true

# Inline graceful stop for Goose and TTS by PID files
if [ -d logs ]; then
  if [ -f "logs/goose.pid" ]; then
    GOOSE_PID=$(cat logs/goose.pid 2>/dev/null || true)
    if [ -n "$GOOSE_PID" ] && kill -0 "$GOOSE_PID" 2>/dev/null; then
      echo "[stop] Stopping Goose (PID $GOOSE_PID)"
      kill -TERM "$GOOSE_PID" 2>/dev/null || true
      sleep 2
      kill -0 "$GOOSE_PID" 2>/dev/null && kill -KILL "$GOOSE_PID" 2>/dev/null || true
      echo "[stop] Goose stopped"
    fi
    rm -f logs/goose.pid
  fi
  if [ -f "logs/tts.pid" ]; then
    TTS_PID=$(cat logs/tts.pid 2>/dev/null || true)
    if [ -n "$TTS_PID" ] && kill -0 "$TTS_PID" 2>/dev/null; then
      echo "[stop] Stopping Ukrainian TTS (PID $TTS_PID)"
      kill -TERM "$TTS_PID" 2>/dev/null || true
      sleep 2
      kill -0 "$TTS_PID" 2>/dev/null && kill -KILL "$TTS_PID" 2>/dev/null || true
      echo "[stop] Ukrainian TTS stopped"
    fi
    rm -f logs/tts.pid
  fi
fi

# Force kill processes on key ports if needed
lsof -ti:5001 | xargs kill -9 2>/dev/null || true
lsof -ti:5101 | xargs kill -9 2>/dev/null || true
lsof -ti:5102 | xargs kill -9 2>/dev/null || true
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:3010 | xargs kill -9 2>/dev/null || true

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
    
    # Start TTS server first (if dependencies present)
    echo "🎵 Starting TTS server on port 3001..."
    cd ukrainian-tts
    started_tts=false
    if [ -d "../.venv" ]; then
        source ../.venv/bin/activate
    elif [ -d ".venv" ]; then
        source .venv/bin/activate
    fi
    if python -c "import ukrainian_tts.tts" >/dev/null 2>&1; then
        python tts_server.py > ../logs/tts_server.log 2>&1 &
        echo $! > ../logs/tts.pid
        started_tts=true
    else
        echo "⚠️  Skipping TTS: module 'ukrainian_tts' not found. Install it into the root venv, e.g.:" | tee -a ../logs/tts_server.log
        echo "   source .venv/bin/activate && pip install git+https://github.com/robinhad/ukrainian-tts.git" | tee -a ../logs/tts_server.log
    fi
    cd ..
    
    # Start frontend server (if dependencies present)
    echo "🌐 Starting Frontend server on port 5001..."
    cd frontend_new
    if [ -d "../.venv" ]; then
        source ../.venv/bin/activate
    elif [ -d "venv" ]; then
        source venv/bin/activate
    fi
    if python -c "import aiohttp" >/dev/null 2>&1; then
        python app/atlas_server.py > ../logs/frontend.log 2>&1 &
        echo $! > ../logs/frontend.pid
    else
        echo "⚠️  Skipping Frontend: 'aiohttp' not installed. Run: source .venv/bin/activate && pip install -r requirements.txt" | tee -a ../logs/frontend.log
    fi
    cd ..
    
    # Start orchestrator
    echo "🧠 Starting Orchestrator on port 5101..."
    cd frontend_new/orchestrator
    npm start > ../../logs/orchestrator.log 2>&1 &
    echo $! > ../../logs/orchestrator.pid
    cd ../..

    # Start OpenAI-compatible proxy (port 3010) -> upstream API at port 4000
    echo "🔀 Starting OpenAI-compatible Proxy on port 3010 (-> 4000)..."
    cd client-module/proxy_server
    npm start > ../../logs/proxy.log 2>&1 &
    echo $! > ../../logs/proxy.pid
    cd ../..
    
    # Start recovery bridge if available and deps present
    if [ -f "frontend_new/config/recovery_bridge.py" ]; then
        echo "🔄 Starting Recovery Bridge on port 5102..."
        cd frontend_new/config
        if [ -d "../../.venv" ]; then
            source ../../.venv/bin/activate
        elif [ -d "../venv" ]; then
            source ../venv/bin/activate
        fi
        if python -c "import websockets" >/dev/null 2>&1; then
            python recovery_bridge.py > ../../logs/recovery_bridge.log 2>&1 &
            echo $! > ../../logs/recovery_bridge.pid
        else
            echo "⚠️  Skipping Recovery Bridge: 'websockets' not installed. Run: source .venv/bin/activate && pip install -r requirements.txt" | tee -a ../../logs/recovery_bridge.log
        fi
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
echo "   Port 3010 (OpenAI Proxy): $(curl -s http://localhost:3010/health >/dev/null 2>&1 && echo "✅ Active" || echo "❌ Down")"
echo "   Port 4000 (Upstream API): $(curl -s http://localhost:4000/v1/models >/dev/null 2>&1 && echo "✅ Active" || echo "❌ Down")"
echo "   (Note: Upstream API on 4000 is external and not managed by this script)"

# Optional component status (via Frontend if available)
if curl -s http://localhost:5001/api/health >/dev/null 2>&1; then
  echo ""
  echo "🧩 Component Status (via Frontend):"
  echo -n "   STT: "
  curl -s http://localhost:5001/api/stt/status | jq -r '.whisper_available as $w | "Whisper="+($w|tostring)+", device="+(.device // "n/a")' 2>/dev/null || echo "Unavailable"
  echo -n "   Vision: "
  if command -v jq >/dev/null 2>&1; then
    curl -s http://localhost:5001/api/vision/status | jq -r '"opencv="+(.modules.opencv|tostring)+", mediapipe="+(.modules.mediapipe|tostring)+", yolo="+(.modules.yolo|tostring)'
  else
    curl -s http://localhost:5001/api/vision/status || echo "Unavailable"
  fi
fi
echo ""
echo "🌐 Services should be available on:"
echo "   - Frontend: http://localhost:5001"
echo "   - Orchestrator: http://localhost:5101" 
echo "   - TTS Server: http://localhost:3001"
echo "   - Goose Web: http://localhost:3000"
echo "   - OpenAI-compatible Proxy: http://localhost:3010 (-> ${TARGET_API_BASE:-http://localhost:4000/v1})"
echo "   - Recovery Bridge: ws://localhost:5102"
echo ""
echo "📄 View logs: tail -f logs/*.log"
echo "Usage: ./restart_simple.sh [production]"

