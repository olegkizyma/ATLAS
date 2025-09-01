#!/bin/bash

# ATLAS System Status Checker
# Перевірка статусу всіх компонентів системи ATLAS

echo "🔍 ATLAS System Health Check"
echo "================================"

# Функція для перевірки процесу за PID файлом
check_service_status() {
    local name=$1
    local pidfile=$2
    local port=$3
    local url=$4
    
    printf "%-25s" "$name:"
    
    if [ -f "$pidfile" ]; then
        local pid=$(cat "$pidfile")
        if ps -p $pid > /dev/null 2>&1; then
            # Процес запущений, перевіряємо відповідь
            if [ -n "$url" ] && curl -s --max-time 3 "$url" > /dev/null 2>&1; then
                echo "🟢 ONLINE  (PID: $pid, Port: $port)"
            elif [ -n "$port" ] && lsof -ti:$port > /dev/null 2>&1; then
                echo "🟡 RUNNING (PID: $pid, Port: $port) - Not responding"
            else
                echo "🔴 FAILED  (PID: $pid) - Port not bound"
            fi
        else
            echo "🔴 STOPPED (Stale PID file)"
        fi
    else
        # Перевіряємо чи є процес на порту без PID файлу
        if [ -n "$port" ] && lsof -ti:$port > /dev/null 2>&1; then
            local port_pid=$(lsof -ti:$port)
            echo "🟡 UNKNOWN (Port $port in use by PID: $port_pid)"
        else
            echo "🔴 STOPPED (No PID file)"
        fi
    fi
}

# Перевірка основних сервісів
echo "📊 Core Services:"
check_service_status "Goose Web Interface" "logs/goose.pid" "3000" "http://localhost:3000"
check_service_status "Python Frontend" "logs/frontend.pid" "5001" "http://localhost:5001"
check_service_status "Node.js Orchestrator" "logs/orchestrator.pid" "5101" "http://localhost:5101/health"

echo ""
echo "🌐 Port Status:"
check_port_status() {
    local port=$1
    local service=$2
    
    printf "%-6s %-25s" "$port:" "$service"
    
    if lsof -ti:$port > /dev/null 2>&1; then
        local pid=$(lsof -ti:$port)
        local cmd=$(ps -p $pid -o comm= 2>/dev/null || echo "unknown")
        echo "🟢 OCCUPIED (PID: $pid, Process: $cmd)"
    else
        echo "🔴 FREE"
    fi
}

check_port_status "3000" "Goose Web Interface"
check_port_status "5001" "Python Frontend"
check_port_status "5101" "Node.js Orchestrator"
check_port_status "5102" "Recovery Bridge"

echo ""
echo "📁 System Files:"
printf "%-25s" "Logs directory:"
if [ -d "logs" ]; then
    local log_count=$(find logs/ -name "*.log" | wc -l | tr -d ' ')
    local pid_count=$(find logs/ -name "*.pid" | wc -l | tr -d ' ')
    echo "🟢 EXISTS ($log_count logs, $pid_count PIDs)"
else
    echo "🔴 MISSING"
fi

printf "%-25s" "Archive directory:"
if [ -d "arhiv" ]; then
    echo "🟢 EXISTS"
else
    echo "🔴 MISSING"
fi

echo ""
echo "🧠 Intelligent Components:"
printf "%-25s" "Recovery System:"
if [ -f "frontend/intelligent_recovery.py" ]; then
    echo "🟢 AVAILABLE"
else
    echo "🔴 MISSING"
fi

printf "%-25s" "Environment Manager:"
if [ -f "frontend/env_manager.py" ]; then
    echo "🟢 AVAILABLE"
else
    echo "🔴 MISSING"
fi

printf "%-25s" "Recovery Bridge:"
if [ -f "frontend/recovery_bridge.py" ]; then
    echo "🟢 AVAILABLE"
else
    echo "🔴 MISSING"
fi

echo ""
echo "🔧 Recent Activity:"
if [ -f "logs/goose.log" ]; then
    echo "📝 Latest Goose log entry:"
    tail -n 1 logs/goose.log | sed 's/^/   /'
fi

if [ -f "logs/frontend.log" ]; then
    echo "📝 Latest Frontend log entry:"
    tail -n 1 logs/frontend.log | sed 's/^/   /'
fi

if [ -f "logs/orchestrator.log" ]; then
    echo "📝 Latest Orchestrator log entry:"
    tail -n 1 logs/orchestrator.log | sed 's/^/   /'
fi

echo ""
echo "🎯 System Summary:"
# Підрахунок активних сервісів
active_count=0
total_services=3

for pidfile in logs/goose.pid logs/frontend.pid logs/orchestrator.pid; do
    if [ -f "$pidfile" ]; then
        local pid=$(cat "$pidfile")
        if ps -p $pid > /dev/null 2>&1; then
            active_count=$((active_count + 1))
        fi
    fi
done

if [ $active_count -eq $total_services ]; then
    echo "🟢 System Status: FULLY OPERATIONAL ($active_count/$total_services services)"
elif [ $active_count -gt 0 ]; then
    echo "🟡 System Status: PARTIAL OPERATION ($active_count/$total_services services)"
else
    echo "🔴 System Status: OFFLINE (0/$total_services services)"
fi

echo ""
echo "🛠️ Available Commands:"
echo "   Start:  ./start_stack.sh"
echo "   Stop:   ./stop_stack.sh"
echo "   Status: ./status_stack.sh"
echo "   Logs:   tail -f logs/*.log"
