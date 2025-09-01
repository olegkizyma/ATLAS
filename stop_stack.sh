#!/bin/bash

# ATLAS Intelligent Stack Shutdown Script
# Зупинка повного стеку ATLAS з інтелектуальною системою відновлення

set -e

echo "🛑 Stopping ATLAS Intelligent Multi-Agent System..."

# Функція для зупинки сервісу за PID файлом
stop_service() {
    local name=$1
    local pidfile=$2
    local signal=${3:-TERM}
    
    if [ -f "$pidfile" ]; then
        local pid=$(cat "$pidfile")
        if ps -p $pid > /dev/null 2>&1; then
            echo "Stopping $name (PID: $pid)..."
            kill -$signal $pid
            
            # Очікування завершення процесу
            local count=0
            while ps -p $pid > /dev/null 2>&1 && [ $count -lt 10 ]; do
                sleep 1
                count=$((count + 1))
            done
            
            if ps -p $pid > /dev/null 2>&1; then
                echo "⚠️  Force killing $name..."
                kill -KILL $pid
                sleep 1
            fi
            
            echo "✅ $name stopped"
        else
            echo "⚠️  $name was not running (stale PID file)"
        fi
        rm -f "$pidfile"
    else
        echo "⚠️  $name PID file not found"
    fi
}

# Функция для зупинки процесів за назвою
stop_by_name() {
    local name=$1
    local pattern=$2
    
    local pids=$(pgrep -f "$pattern" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "Stopping $name processes..."
        echo "$pids" | xargs kill 2>/dev/null || true
        sleep 2
        
        # Перевірка чи залишились процеси
        local remaining=$(pgrep -f "$pattern" 2>/dev/null || true)
        if [ -n "$remaining" ]; then
            echo "Force killing remaining $name processes..."
            echo "$remaining" | xargs kill -KILL 2>/dev/null || true
        fi
        echo "✅ $name processes stopped"
    fi
}

# 1. Зупинка Recovery Bridge (Port 5102)
echo "🔧 Stopping Recovery Bridge..."
stop_service "Recovery Bridge" "logs/recovery_bridge.pid"

# 2. Зупинка Node.js Orchestrator (Port 5101)
echo "🎭 Stopping Node.js Orchestrator..."
stop_service "Node.js Orchestrator" "logs/orchestrator.pid"

# 3. Зупинка Python Frontend (Port 5001)
echo "🧠 Stopping Python Frontend..."
stop_service "Python Frontend" "logs/frontend.pid"

# 4. Зупинка Goose Web Interface (Port 3000)
echo "🦆 Stopping Goose Web Interface..."
stop_service "Goose Web Interface" "logs/goose.pid"

# 4.5. Зупинка Ukrainian TTS Mock (Port 3001)
echo "🎤 Stopping Ukrainian TTS Mock..."
stop_service "Ukrainian TTS Mock" "logs/tts_mock.pid"

# 5. Додаткова очистка процесів за іменем
echo "🧹 Cleaning up remaining processes..."
stop_by_name "Goose daemon" "goosed"
stop_by_name "Python frontend" "atlas_minimal_live.py"
stop_by_name "Recovery bridge" "recovery_bridge.py"
stop_by_name "Node orchestrator" "start_server.sh"

# 5. Очистка портів (якщо щось залишилось)
echo "🔍 Checking for remaining port usage..."
check_and_kill_port() {
    local port=$1
    local service_name=$2
    
    local pid=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo "⚠️  Port $port still in use by $service_name (PID: $pid)"
        kill $pid 2>/dev/null || true
        sleep 1
        
        # Перевірка чи процес все ще живий
        if ps -p $pid > /dev/null 2>&1; then
            echo "Force killing process on port $port..."
            kill -KILL $pid 2>/dev/null || true
        fi
        echo "✅ Port $port freed"
    fi
}

check_and_kill_port 3000 "Goose Web"
check_and_kill_port 3001 "Ukrainian TTS Mock"
check_and_kill_port 5001 "Python Frontend"  
check_and_kill_port 5101 "Node.js Orchestrator"
check_and_kill_port 5102 "Recovery Bridge"

# 6. Очистка файлів блокування
echo "🗑️  Cleaning up lock files..."
find logs/ -name "*.pid" -delete 2>/dev/null || true

# 7. Архівація логів (опційно)
if [ "$1" = "--archive-logs" ]; then
    echo "📦 Archiving logs..."
    timestamp=$(date +%Y%m%d_%H%M%S)
    mkdir -p logs/archive
    tar -czf logs/archive/atlas_logs_$timestamp.tar.gz logs/*.log 2>/dev/null || true
    echo "✅ Logs archived to logs/archive/atlas_logs_$timestamp.tar.gz"
fi

# 8. Фінальна перевірка
echo "🔍 Final health check..."
sleep 2

# Перевірка що всі порти вільні
ports_free=true
for port in 3000 5001 5101 5102; do
    if lsof -ti:$port > /dev/null 2>&1; then
        echo "⚠️  Port $port is still in use"
        ports_free=false
    fi
done

if [ "$ports_free" = true ]; then
    echo "✅ All ports are free"
else
    echo "⚠️  Some ports are still in use - manual cleanup may be required"
fi

# Статистика логів
if [ -d "logs" ]; then
    log_count=$(find logs/ -name "*.log" | wc -l)
    if [ $log_count -gt 0 ]; then
        echo "📊 $log_count log files remain in logs/ directory"
    fi
fi

echo ""
echo "🎉 ATLAS System Shutdown Complete!"
echo ""
echo "🛠️  Available commands:"
echo "   Start system:    ./start_stack.sh"
echo "   Archive logs:    ./stop_stack.sh --archive-logs"
echo "   View log files:  ls -la logs/"
echo ""
echo "✨ System is now safely stopped and ready for restart"
