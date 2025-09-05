#!/bin/bash

# ATLAS Intelligent Status Checker
# Розширений статус чекер з інтелігентними метриками

echo "🧠 ATLAS Intelligent System Status Report"
echo "========================================"
echo "📅 $(date)"
echo ""

# Функція для детальної перевірки сервісу
check_intelligent_service() {
    local name=$1
    local url=$2
    local pidfile=$3
    local service_type=$4
    
    echo "🔍 $name:"
    
    if [ -f "$pidfile" ] && ps -p $(cat $pidfile) > /dev/null 2>&1; then
        local pid=$(cat $pidfile)
        local uptime=$(ps -o etime= -p $pid 2>/dev/null | tr -d ' ')
        local memory=$(ps -o rss= -p $pid 2>/dev/null | awk '{print int($1/1024)"MB"}')
        local cpu=$(ps -o %cpu= -p $pid 2>/dev/null | tr -d ' ')
        
        echo "   ✅ Status: Running (PID: $pid)"
        echo "   ⏱️  Uptime: $uptime"
        echo "   💾 Memory: $memory"
        echo "   🖥️  CPU: ${cpu}%"
        
        # HTTP health check
        if curl -s --max-time 3 "$url" > /dev/null 2>&1; then
            echo "   🌐 HTTP: Responsive"
            
            # Intelligent features check
            case $service_type in
                "orchestrator")
                    local health_response=$(curl -s --max-time 2 "$url/health" 2>/dev/null)
                    if echo "$health_response" | grep -qi "intelligent"; then
                        echo "   🧠 Mode: Intelligent ✅"
                    else
                        echo "   🧠 Mode: Standard ⚠️"
                    fi
                    
                    # Adaptive features
                    if echo "$health_response" | grep -qi "adaptive"; then
                        echo "   🔄 Adaptive: Active ✅"
                    else
                        echo "   🔄 Adaptive: Inactive ⚠️"
                    fi
                    ;;
                "frontend")
                    local frontend_test=$(curl -s --max-time 2 "$url" | grep -i "intelligent" || echo "")
                    if [ -n "$frontend_test" ]; then
                        echo "   🧠 Intelligent Features: Active ✅"
                    else
                        echo "   🧠 Intelligent Features: Standard ⚠️"
                    fi
                    ;;
            esac
        else
            echo "   🌐 HTTP: Not responding ❌"
        fi
    else
        echo "   ❌ Status: Not running"
    fi
    echo ""
}

# Функція для перевірки WebSocket сервісу
check_websocket_service() {
    local name=$1
    local port=$2
    local pidfile=$3
    
    echo "🔍 $name:"
    
    if [ -f "$pidfile" ] && ps -p $(cat $pidfile) > /dev/null 2>&1; then
        local pid=$(cat $pidfile)
        local uptime=$(ps -o etime= -p $pid 2>/dev/null | tr -d ' ')
        local memory=$(ps -o rss= -p $pid 2>/dev/null | awk '{print int($1/1024)"MB"}')
        
        echo "   ✅ Status: Running (PID: $pid)"
        echo "   ⏱️  Uptime: $uptime"
        echo "   💾 Memory: $memory"
        
        # WebSocket port check
        if lsof -ti:$port > /dev/null 2>&1; then
            echo "   🔌 WebSocket: Listening on port $port ✅"
        else
            echo "   🔌 WebSocket: Port $port not accessible ❌"
        fi
    else
        echo "   ❌ Status: Not running"
    fi
    echo ""
}

# Перевірка інтелігентних конфігурацій
echo "📋 Intelligent Configuration Status:"
echo ""

if [ -f "frontend_new/orchestrator/.env.intelligent" ]; then
    echo "   🧠 Orchestrator Intelligent Config: ✅ Present"
    config_date=$(stat -f "%Sm" "frontend_new/orchestrator/.env.intelligent" 2>/dev/null || echo "unknown")
    echo "      Generated: $config_date"
else
    echo "   🧠 Orchestrator Intelligent Config: ❌ Missing"
    echo "      Run: cd frontend_new && python config/configuration_migrator.py --target orchestrator"
fi

if [ -f "frontend_new/orchestrator/.intelligent_metadata.json" ]; then
    echo "   📊 Metadata File: ✅ Present"
    version=$(grep -o '"config_version":[^,]*' "frontend_new/orchestrator/.intelligent_metadata.json" 2>/dev/null | cut -d'"' -f4 || echo "unknown")
    echo "      Config Version: $version"
else
    echo "   📊 Metadata File: ❌ Missing"
fi

if [ -f "frontend_new/orchestrator/intelligent_server_wrapper.js" ]; then
    echo "   🔧 Intelligent Wrapper: ✅ Present"
else
    echo "   🔧 Intelligent Wrapper: ❌ Missing"
fi

echo ""

# Основні сервіси
echo "🚀 Core Services Status:"
echo ""

check_intelligent_service "Python Frontend" "http://localhost:5001" "logs/frontend.pid" "frontend"
check_intelligent_service "Node.js Orchestrator" "http://localhost:5101/health" "logs/orchestrator.pid" "orchestrator"
check_websocket_service "Recovery Bridge" "5102" "logs/recovery_bridge.pid"

# Додаткові сервіси
echo "🎯 Additional Services:"
echo ""

# TTS Service
if [ -f "logs/tts_real.pid" ] && ps -p $(cat logs/tts_real.pid) > /dev/null 2>&1; then
    echo "🎤 Ukrainian TTS: ✅ Real TTS Running"
elif [ -f "logs/tts_mock.pid" ] && ps -p $(cat logs/tts_mock.pid) > /dev/null 2>&1; then
    echo "🎤 Ukrainian TTS: ⚠️  Mock TTS Running"
else
    echo "🎤 Ukrainian TTS: ❌ Not Running"
fi

# Goose Service (optional)
if [ -f "logs/goose.pid" ] && ps -p $(cat logs/goose.pid) > /dev/null 2>&1; then
    echo "🦆 Goose Web: ✅ Running"
else
    echo "🦆 Goose Web: ⚠️  Not Running (optional)"
fi

# Fallback LLM
if [ -f "logs/fallback_llm.pid" ] && ps -p $(cat logs/fallback_llm.pid) > /dev/null 2>&1; then
    echo "🧰 Fallback LLM: ✅ Running"
else
    echo "🧰 Fallback LLM: ⚠️  Not Running (optional)"
fi

echo ""

# Порти та з'єднання
echo "🔌 Port Status:"
echo ""

ports=(5001 5101 5102 3001 3000 3010)
service_names=("Frontend" "Orchestrator" "Recovery Bridge" "TTS" "Goose Web" "Fallback LLM")

for i in ${!ports[@]}; do
    port=${ports[$i]}
    service=${service_names[$i]}
    
    if lsof -ti:$port > /dev/null 2>&1; then
        pid=$(lsof -ti:$port)
        process=$(ps -p $pid -o comm= 2>/dev/null || echo "unknown")
        echo "   Port $port ($service): ✅ Active ($process, PID: $pid)"
    else
        echo "   Port $port ($service): ⚪ Free"
    fi
done

echo ""

# Intelligent system metrics
echo "📊 Intelligent System Metrics:"
echo ""

# Recovery Bridge connectivity
if command -v nc >/dev/null 2>&1 && nc -z localhost 5102 2>/dev/null; then
    echo "   🔗 Recovery Bridge Connection: ✅ Available"
else
    echo "   🔗 Recovery Bridge Connection: ❌ Unavailable"
fi

# Log file sizes
echo "   📝 Log File Status:"
if [ -f "logs/orchestrator.log" ]; then
    size=$(du -h "logs/orchestrator.log" | cut -f1)
    echo "      Orchestrator Log: $size"
fi
if [ -f "logs/frontend.log" ]; then
    size=$(du -h "logs/frontend.log" | cut -f1)
    echo "      Frontend Log: $size"
fi
if [ -f "logs/recovery_bridge.log" ]; then
    size=$(du -h "logs/recovery_bridge.log" | cut -f1)
    echo "      Recovery Bridge Log: $size"
fi

# Environment variables check
echo ""
echo "🌍 Environment Status:"
echo ""

if [ "$ATLAS_INTELLIGENT_MODE" = "true" ]; then
    echo "   🧠 ATLAS_INTELLIGENT_MODE: ✅ Enabled"
else
    echo "   🧠 ATLAS_INTELLIGENT_MODE: ⚠️  Not set (export ATLAS_INTELLIGENT_MODE=true)"
fi

if [ "$ATLAS_AUTO_ADAPT" = "true" ]; then
    echo "   🔄 ATLAS_AUTO_ADAPT: ✅ Enabled"
else
    echo "   🔄 ATLAS_AUTO_ADAPT: ⚠️  Not set"
fi

# System resources
echo ""
echo "💻 System Resources:"
echo ""

if command -v free >/dev/null 2>&1; then
    memory_info=$(free -h | grep "Mem:" | awk '{print "Used: "$3" / Total: "$2}')
    echo "   💾 Memory: $memory_info"
elif command -v vm_stat >/dev/null 2>&1; then
    # macOS alternative
    pages_free=$(vm_stat | grep "Pages free" | awk '{print $3}' | sed 's/\.//')
    pages_total=$(( $(sysctl -n hw.memsize) / 4096 ))
    memory_free_mb=$(( pages_free * 4 / 1024 ))
    memory_total_mb=$(( pages_total * 4 / 1024 ))
    echo "   💾 Memory: $memory_free_mb MB free / $memory_total_mb MB total"
fi

if command -v uptime >/dev/null 2>&1; then
    load_avg=$(uptime | awk -F'load average:' '{print $2}' | sed 's/^[ \t]*//')
    echo "   🖥️  Load Average: $load_avg"
fi

echo ""
echo "🎯 Quick Actions:"
echo "   Start Intelligent Stack:  ./start_stack_intelligent.sh"
echo "   Stop All Services:        ./stop_stack.sh"
echo "   View Live Logs:           tail -f logs/*.log"
echo "   Run Migration:            cd frontend_new && python config/configuration_migrator.py"
echo ""

# Overall health assessment
echo "🏥 Overall Health Assessment:"
echo ""

services_running=0
total_services=3

if [ -f "logs/frontend.pid" ] && ps -p $(cat logs/frontend.pid) > /dev/null 2>&1; then
    services_running=$((services_running + 1))
fi

if [ -f "logs/orchestrator.pid" ] && ps -p $(cat logs/orchestrator.pid) > /dev/null 2>&1; then
    services_running=$((services_running + 1))
fi

if [ -f "logs/recovery_bridge.pid" ] && ps -p $(cat logs/recovery_bridge.pid) > /dev/null 2>&1; then
    services_running=$((services_running + 1))
fi

health_percentage=$((services_running * 100 / total_services))

if [ $health_percentage -eq 100 ]; then
    echo "   🟢 EXCELLENT ($health_percentage%): All core intelligent services running"
elif [ $health_percentage -ge 67 ]; then
    echo "   🟡 GOOD ($health_percentage%): Most services running"
elif [ $health_percentage -ge 33 ]; then
    echo "   🟠 DEGRADED ($health_percentage%): Some services down"
else
    echo "   🔴 CRITICAL ($health_percentage%): Major services down"
fi

echo ""
echo "🧠 ATLAS Intelligent System Status Complete"
