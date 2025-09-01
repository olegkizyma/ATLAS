#!/bin/bash

# ATLAS Frontend-Only Startup Script
# Запуск тільки frontend_new без Goose для тестування

set -e

echo "🚀 Starting ATLAS Frontend-Only Stack..."

# 1. Налаштування Python Environment
echo "🐍 Setting up Python environment..."
cd frontend_new
if [ -f "venv/bin/activate" ]; then
    echo "🐍 Activating virtual environment..."
    source venv/bin/activate
    echo "✅ Virtual environment activated"
else
    echo "⚠️  Virtual environment not found, using system Python"
fi
cd ..

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

# Перевірка портів
echo "🔍 Checking ports availability..."
check_port 5001 || { echo "❌ Frontend port 5001 busy"; exit 1; }
check_port 5101 || { echo "❌ Orchestrator port 5101 busy"; exit 1; }

echo "✅ Port check completed"

# 2. Запуск Node.js Orchestrator (Port 5101)
echo "🎭 Starting Node.js Orchestrator..."
cd frontend_new/orchestrator
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

# Очікування запуску всіх сервісів
echo "⏳ Waiting for services to initialize..."
sleep 3

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

echo ""
echo "🎉 ATLAS Frontend Stack Started!"
echo ""
echo "📊 Service Dashboard:"
echo "   🧠 Python Frontend:  http://localhost:5001"
echo "   🎭 Orchestrator API: http://localhost:5101"
echo ""
echo "📝 Logs:"
echo "   Frontend:     logs/frontend.log"
echo "   Orchestrator: logs/orchestrator.log"
echo ""
echo "🛠️  Management:"
echo "   Stop frontend: pkill -f atlas_server.py"
echo "   Stop orchestrator: pkill -f 'node server.js'"
echo "   View logs: tail -f logs/*.log"
echo ""
echo "🚀 ATLAS Frontend is now ready!"