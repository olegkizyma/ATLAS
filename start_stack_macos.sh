#!/bin/bash

# ATLAS macOS-Compatible Startup Script
# Система запускається на МАК ОС - точка входу start_stack.sh
# Запуск повного стеку ATLAS без залежності від Goose

set -e

echo "🍎 ATLAS macOS-Compatible Multi-Agent System"
echo "🚀 Starting ATLAS Stack..."

# 1. Налаштування Python Environment
echo "🐍 Setting up Python environment..."
cd frontend_new
if [ -f "venv/bin/activate" ]; then
    echo "🐍 Activating virtual environment..."
    source venv/bin/activate
    echo "✅ Virtual environment activated"
    
    # Quick dependency check
    if ! python -c "import flask" 2>/dev/null; then
        echo "📦 Installing Python dependencies..."
        pip install -r requirements.txt
        echo "✅ Dependencies installed"
    else
        echo "✅ Dependencies already available"
    fi
else
    echo "⚠️  Virtual environment not found, creating one..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    echo "✅ Virtual environment created and configured"
fi
cd ..

# Створення директорії для логів
mkdir -p logs

# Функція для перевірки доступності порту (macOS compatible)
check_port() {
    local port=$1
    if command -v lsof >/dev/null 2>&1; then
        if lsof -ti:$port > /dev/null 2>&1; then
            echo "⚠️  Port $port is already in use"
            return 1
        fi
    elif command -v netstat >/dev/null 2>&1; then
        if netstat -tuln 2>/dev/null | grep -q ":$port "; then
            echo "⚠️  Port $port is already in use"
            return 1
        fi
    else
        echo "⚠️  Cannot check port $port availability"
    fi
    return 0
}

# Перевірка портів
echo "🔍 Checking ports availability..."
if lsof -ti:3000 > /dev/null 2>&1; then
    echo "⚠️  Goose web interface port 3000 busy (Goose will be skipped)"
else
    echo "✅ Port 3000 available for Goose"
fi
check_port 5001 || { echo "❌ Frontend port 5001 busy"; exit 1; }
check_port 5101 || { echo "❌ Orchestrator port 5101 busy"; exit 1; }
check_port 5102 || { echo "⚠️  Recovery bridge port 5102 busy (will attempt restart)"; }
echo "✅ Port check completed"

# 1.5. Запуск Ukrainian TTS Mock (Port 3001) — Optional but recommended for Voice API
echo "🎤 Starting Ukrainian TTS Mock (port 3001)..."
if lsof -ti:3001 > /dev/null 2>&1; then
    echo "⚠️  Port 3001 is busy. Skipping TTS mock startup. Set ATLAS_TTS_URL to your TTS endpoint."
else
    cd frontend_new
    if [ -f "venv/bin/activate" ]; then
        source venv/bin/activate
    fi
    TTS_PORT=3001 python ukrainian_tts_server.py > ../logs/tts_mock.log 2>&1 &
    echo $! > ../logs/tts_mock.pid
    echo "✅ TTS mock started (PID: $(cat ../logs/tts_mock.pid)) on http://127.0.0.1:3001"
    cd ..
fi

# 2. Запуск Goose Web Interface (Port 3000) - Optional
echo "🦆 Starting Goose Web Interface..."
if lsof -ti:3000 > /dev/null 2>&1; then
    echo "⚠️  Port 3000 is busy. Skipping Goose startup."
else
    cd goose
    if [ -f "target/release/goose" ]; then
        XDG_CONFIG_HOME=$(pwd) ./target/release/goose web > ../logs/goose.log 2>&1 &
        echo $! > ../logs/goose.pid
        echo "✅ Goose web interface started (PID: $(cat ../logs/goose.pid))"
    elif command -v goose >/dev/null 2>&1; then
        XDG_CONFIG_HOME=$(pwd) goose web > ../logs/goose.log 2>&1 &
        echo $! > ../logs/goose.pid
        echo "✅ Goose web interface started (PID: $(cat ../logs/goose.pid))"
    elif [ -x "./download_cli.sh" ]; then
        echo "📦 Goose binary not found. Downloading pre-built CLI..."
        if CONFIGURE=false ./download_cli.sh; then
            if [ -x "$HOME/.local/bin/goose" ]; then
                XDG_CONFIG_HOME=$(pwd) "$HOME/.local/bin/goose" web > ../logs/goose.log 2>&1 &
                echo $! > ../logs/goose.pid
                echo "✅ Goose web interface started (PID: $(cat ../logs/goose.pid))"
            else
                echo "⚠️  Goose CLI downloaded but not found in PATH. Skipping Goose."
            fi
        else
            echo "⚠️  Goose CLI download failed. Skipping Goose."
        fi
    elif command -v cargo >/dev/null 2>&1; then
        echo "📦 Goose binary not found. Building with Cargo (this may take several minutes)..."
        if cargo build --release --quiet; then
            XDG_CONFIG_HOME=$(pwd) ./target/release/goose web > ../logs/goose.log 2>&1 &
            echo $! > ../logs/goose.pid
            echo "✅ Goose web interface started (PID: $(cat ../logs/goose.pid))"
        else
            echo "⚠️  Goose build failed. Continuing without Goose web interface."
            echo "   Frontend will still work on http://localhost:5001"
        fi
    else
        echo "⚠️  No Goose binary and no Cargo found. Skipping Goose web interface."
        echo "   Frontend will still work on http://localhost:5001"
    fi
    cd ..
fi

# 3. Запуск Node.js Orchestrator (Port 5101)
echo "🎭 Starting Node.js Orchestrator..."
cd frontend_new/orchestrator
# Check if Node.js dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing Node.js dependencies..."
    npm install
fi
node server.js > ../../logs/orchestrator.log 2>&1 &
echo $! > ../../logs/orchestrator.pid
echo "✅ Node.js orchestrator started (PID: $(cat ../../logs/orchestrator.pid))"
cd ../..

# 4. Запуск Python Frontend (Port 5001)
echo "🧠 Starting Python Frontend..."
cd frontend_new
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
fi
export ATLAS_TTS_URL=${ATLAS_TTS_URL:-http://127.0.0.1:3001/tts}
python app/atlas_server.py > ../logs/frontend.log 2>&1 &
echo $! > ../logs/frontend.pid
echo "✅ Python frontend started (PID: $(cat ../logs/frontend.pid))"
cd ..

# 5. Запуск Recovery Bridge (Port 5102)
echo "🔧 Starting Recovery Bridge..."
cd frontend_new
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
fi
python config/recovery_bridge.py > ../logs/recovery_bridge.log 2>&1 &
echo $! > ../logs/recovery_bridge.pid
echo "✅ Recovery Bridge started (PID: $(cat ../logs/recovery_bridge.pid))"
cd ..

# Очікування запуску всіх сервісів
echo "⏳ Waiting for services to initialize..."
sleep 5

# Перевірка статусу сервісів
echo "🔍 Checking service health..."

check_service() {
    local name=$1
    local url=$2
    local pidfile=$3
    
    if [ -f "$pidfile" ] && ps -p $(cat $pidfile) > /dev/null 2>&1; then
        if curl -s --max-time 3 "$url" > /dev/null 2>&1; then
            echo "✅ $name is running and responsive"
        else
            echo "⚠️  $name is running but not responding"
        fi
    else
        echo "❌ $name is not running"
    fi
}

check_service "Python Frontend" "http://localhost:5001" "logs/frontend.pid"
check_service "Node.js Orchestrator" "http://localhost:5101/health" "logs/orchestrator.pid"

# Check Goose only if it was started
if [ -f "logs/goose.pid" ] && ps -p $(cat logs/goose.pid) > /dev/null 2>&1; then
    check_service "Goose Web" "http://localhost:3000" "logs/goose.pid"
else
    echo "⚠️  Goose Web Interface not running (optional)"
fi

# Перевірка Recovery Bridge
echo "🔧 Checking Recovery Bridge..."
if [ -f "logs/recovery_bridge.pid" ] && ps -p $(cat logs/recovery_bridge.pid) > /dev/null 2>&1; then
    echo "✅ Recovery Bridge is running"
else
    echo "❌ Recovery Bridge is not running"
fi

echo ""
echo "🎉 ATLAS macOS System Startup Complete!"
echo ""
echo "📊 Service Dashboard:"
if [ -f "logs/goose.pid" ] && ps -p $(cat logs/goose.pid) > /dev/null 2>&1; then
    echo "   🌐 Web Interface:    http://localhost:3000"
else
    echo "   🌐 Web Interface:    (not available - Goose not running)"
fi
echo "   🧠 Python Frontend:  http://localhost:5001"
echo "   🎭 Orchestrator API: http://localhost:5101" 
echo "   🔧 Recovery Bridge:  ws://localhost:5102"
echo ""
echo "📝 Logs:"
if [ -f "logs/goose.log" ]; then
    echo "   Goose:         logs/goose.log"
fi
echo "   Frontend:        logs/frontend.log"
echo "   Orchestrator:    logs/orchestrator.log"
echo "   Recovery Bridge: logs/recovery_bridge.log"
echo ""
echo "🛠️  Management:"
echo "   Stop system:  ./stop_stack.sh"
echo "   View logs:    tail -f logs/*.log"
echo "   Check status: ./status_stack.sh"
echo ""
echo "🍎 ATLAS is now ready for intelligent multi-agent operations on macOS!"
echo ""
echo "💡 Access the web interface at: http://localhost:5001"
echo "   The interface features a hacker-style terminal with green logs"
echo "   and a fully functional chat system."