#!/bin/bash

# ATLAS System Status Check
# Перевірка статусу всіх сервісів ATLAS

echo "🧠 ATLAS System Status Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Функція перевірки HTTP health endpoints
check_http_service() {
    local service_name="$1"
    local port="$2"
    local endpoint="$3"
    local url="http://localhost:${port}${endpoint}"
    
    if curl -s --max-time 3 "$url" > /dev/null 2>&1; then
        echo "   ✅ $service_name (port $port): Active"
        return 0
    else
        echo "   ❌ $service_name (port $port): Down"
        return 1
    fi
}

# Функція перевірки WebSocket
check_websocket() {
    local service_name="$1"
    local port="$2"
    
    if lsof -i :$port > /dev/null 2>&1; then
        echo "   ✅ $service_name (port $port): Active"
        return 0
    else
        echo "   ❌ $service_name (port $port): Down"
        return 1
    fi
}

echo "🔍 Service Health Check:"

# Core ATLAS services
check_http_service "Frontend" "5001" "/"
check_http_service "Orchestrator" "5101" "/health"
check_websocket "Recovery Bridge" "5102"
check_http_service "Ukrainian TTS" "3001" "/health"
check_http_service "Goose Web" "3000" "/"

echo ""
echo "📊 Port Usage Summary:"
echo "   Core ATLAS Ports: 5001 (Frontend), 5101 (Orchestrator), 5102 (Recovery)"
echo "   Extended Services: 3001 (TTS), 3000 (Goose)"

echo ""
echo "🔗 Access URLs:"
echo "   🌐 Frontend: http://localhost:5001"
echo "   🔧 Orchestrator API: http://localhost:5101"
echo "   🎵 TTS Server: http://localhost:3001"
echo "   🪿 Goose (if running): http://localhost:3000"
echo "   👁️  Vision API: http://localhost:5001/api/vision/status (integrated)"

echo ""
echo "📄 Log Files:"
ls -la logs/ 2>/dev/null | grep -E "\.(log|out)$" | while read -r line; do
    echo "   📄 $(echo "$line" | awk '{print $9, $5}')"
done

echo ""
echo "📈 Recent Activity (unified log, last 8 entries):"
if [ -f "logs/atlas_unified.log" ]; then
    # Парсимо unified log, прибираємо дублювання дати і скорочуємо
    tail -n 8 logs/atlas_unified.log | while IFS= read -r line; do
        # Витягуємо час і сервіс із рядка
        if [[ $line =~ \[([0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2})\]\ \[([A-Z]+)\]\ \[([a-z_]+)\]\ (.+) ]]; then
            time="${BASH_REMATCH[1]}"
            level="${BASH_REMATCH[2]}"
            service="${BASH_REMATCH[3]}"
            message="${BASH_REMATCH[4]}"
            
            # Форматуємо: залишаємо тільки час (без дати) + сервіс + коротке повідомлення
            short_time=$(echo "$time" | cut -d' ' -f2)  # Тільки час
            short_message=$(echo "$message" | cut -c1-60)  # Перші 60 символів
            
            echo "   [$short_time] [$service] $short_message"
        else
            # Якщо рядок не відповідає формату, показуємо як є (скорочено)
            echo "   $(echo "$line" | cut -c1-80)"
        fi
    done
else
    echo "   Unified log not available. Start with: ./logs.sh -c start"
fi

echo ""
echo "⚡ Quick Actions:"
echo "   � Restart: ./restart_simple.sh"
echo "   � Status:  ./status_stack.sh"
echo "   🛑 Stop:    ./stop_stack.sh"
echo "   📄 Logs:    tail -f logs/*.log"
