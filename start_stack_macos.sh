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
check_port 5001 || { echo "❌ Frontend port 5001 busy"; exit 1; }
check_port 5101 || { echo "❌ Orchestrator port 5101 busy"; exit 1; }
check_port 5102 || { echo "⚠️  Recovery bridge port 5102 busy (will attempt restart)"; }
echo "✅ Port check completed"

# 2. Запуск Node.js Orchestrator (Port 5101)
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

# 3. Запуск Python Frontend (Port 5001)
echo "🧠 Starting Python Frontend..."
cd frontend_new
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
fi
python app/atlas_server.py > ../logs/frontend.log 2>&1 &
echo $! > ../logs/frontend.pid
echo "✅ Python frontend started (PID: $(cat ../logs/frontend.pid))"
cd ..

# 4. Запуск Recovery Bridge (Port 5102)
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
echo "   🧠 Python Frontend:  http://localhost:5001"
echo "   🎭 Orchestrator API: http://localhost:5101" 
echo "   🔧 Recovery Bridge:  ws://localhost:5102"
echo ""
echo "📝 Logs:"
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