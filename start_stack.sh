#!/bin/bash

# ATLAS Intelligent Stack Startup Script
# Запуск повного стеку ATLAS

# macOS users: Use ./start_stack_macos.sh for better compatibility
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "🍎 macOS detected. For optimal experience, use:"
    echo "   ./start_stack_macos.sh"
    echo ""
    echo "Continuing with full stack (may require Rust/Cargo)..."
    sleep 2
fi

# 1. Запуск Python Environment Setup
echo "🐍 Setting up Python environment..."
cd frontend_new
if [ -f "setup_env.sh" ]; then
    source setup_env.sh
    echo "✅ Python environment configured"
elif [ -f "venv/bin/activate" ]; then
    echo "🐍 Activating virtual environment..."
    source venv/bin/activate
    echo "✅ Virtual environment activated"
else
    echo "⚠️  setup_env.sh not found, using system Python"
fi
cd ..

# Активація віртуального середовища
echo "🐍 Activating Python virtual environment..."
if [ -f "frontend_new/venv/bin/activate" ]; then
    source frontend_new/venv/bin/activate
    echo "✅ Virtual environment activated"
else
    echo "⚠️  Virtual environment not found, using system Python"
fi

set -e

echo "🚀 Starting ATLAS Intelligent Multi-Agent System..."

# Створення директорії для логів
mkdir -p logs

# Функція для перевірки доступності порту (macOS compatible)
check_port() {
    local port=$1
    if command -v lsof >/dev/null 2>&1; then
        # Use lsof if available (macOS and Linux)
        if lsof -ti:$port > /dev/null 2>&1; then
            echo "⚠️  Port $port is already in use"
            return 1
        fi
    elif command -v netstat >/dev/null 2>&1; then
        # Fallback to netstat (Linux)
        if netstat -tuln 2>/dev/null | grep -q ":$port "; then
            echo "⚠️  Port $port is already in use"
            return 1
        fi
    else
        echo "⚠️  Cannot check port $port availability (no lsof or netstat)"
    fi
    return 0
}

# Функція для запуску сервісу з логуванням
start_service() {
    local name=$1
    local command=$2
    local logfile=$3
    local pidfile=$4
    
    echo "Starting $name..."
    nohup $command > $logfile 2>&1 &
    local pid=$!
    echo $pid > $pidfile
    echo "✅ $name started (PID: $pid)"
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

# 2. Запуск Goose Web Interface (Port 3000) - Optional
echo "🦆 Starting Goose Web Interface..."
cd goose
if [ -f "target/release/goose" ]; then
    XDG_CONFIG_HOME=$(pwd) ./target/release/goose web > ../logs/goose.log 2>&1 &
    echo $! > ../logs/goose.pid
    echo "✅ Goose web interface started (PID: $(cat ../logs/goose.pid))"
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
    echo "⚠️  Cargo not found. Skipping Goose web interface."
    echo "   Frontend will still work on http://localhost:5001"
fi
cd ..

# 3. Запуск Node.js Orchestrator (Port 5101)
echo "🎭 Starting Node.js Orchestrator..."
cd frontend_new/orchestrator
node server.js > ../../logs/orchestrator.log 2>&1 &
echo $! > ../../logs/orchestrator.pid
echo "✅ Node.js orchestrator started (PID: $(cat ../../logs/orchestrator.pid))"
cd ../..

# 4. Запуск Python Frontend (Port 5001)
echo "🧠 Starting Python Frontend..."
# Python frontend вже запущений через start_server.sh в frontend_new
if ps aux | grep -q "atlas_server.py" && ! ps aux | grep -q "grep atlas_server.py"; then
    echo "✅ Python frontend already running on port 5001"
    # Знаходимо PID запущеного процесу
    python_pid=$(ps aux | grep "atlas_server.py" | grep -v grep | awk '{print $2}')
    echo $python_pid > logs/frontend.pid
else
    echo "🧠 Starting new Python frontend instance..."
    cd frontend_new
    if [ -f "venv/bin/activate" ]; then
        source venv/bin/activate
    fi
    python app/atlas_server.py > ../logs/frontend.log 2>&1 &
    echo $! > ../logs/frontend.pid
    echo "✅ Python frontend started (PID: $(cat ../logs/frontend.pid))"
    cd ..
fi

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

# Перевірка Recovery Bridge (WebSocket не можна перевірити через curl)
echo "🔧 Checking Recovery Bridge..."
if [ -f "logs/recovery_bridge.pid" ] && ps -p $(cat logs/recovery_bridge.pid) > /dev/null 2>&1; then
    echo "✅ Recovery Bridge is running"
else
    echo "❌ Recovery Bridge is not running"
fi

echo ""
echo "🎉 ATLAS System Startup Complete!"
echo ""
echo "📊 Service Dashboard:"
if [ -f "logs/goose.pid" ] && ps -p $(cat logs/goose.pid) > /dev/null 2>&1; then
    echo "   🌐 Web Interface:    http://localhost:3000"
else
    echo "   🌐 Web Interface:    (not available - Goose not running)"
fi
echo "   🐍 Python Frontend:  http://localhost:5001"
echo "   🎭 Orchestrator API: http://localhost:5101"
echo "   🔧 Recovery Bridge:  ws://localhost:5102"
echo ""
echo "📝 Logs:"
if [ -f "logs/goose.log" ]; then
    echo "   Goose:        logs/goose.log"
fi
echo "   Frontend:     logs/frontend.log"
echo "   Orchestrator: logs/orchestrator.log"
echo ""
echo "🛠️  Management:"
echo "   Stop system:  ./stop_stack.sh"
echo "   View logs:    tail -f logs/*.log"
echo "   Check status: ./status_stack.sh"
echo ""
echo "🚀 ATLAS is now ready for intelligent multi-agent operations!"
