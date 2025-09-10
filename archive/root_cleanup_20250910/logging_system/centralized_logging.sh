#!/bin/bash

# ATLAS Centralized Logging System
# Система централізованого збору логів з усіх сервісів

# Конфігурація
BASE_DIR="$(dirname "$0")/.."
LOG_DIR="$BASE_DIR/logs"
UNIFIED_LOG="$LOG_DIR/atlas_unified.log"
SERVICES_LOG="$LOG_DIR/services_status.log"

# Кольори
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Функція логування з міткою часу
log_unified() {
    local level="$1"
    local service="$2"
    local message="$3"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    echo "[$timestamp] [$level] [$service] $message" >> "$UNIFIED_LOG"
}

# Функція моніторингу окремого сервісу
monitor_service() {
    local service_name="$1"
    local log_file="$2"
    local port="$3"
    
    if [ ! -f "$log_file" ]; then
        touch "$log_file"
    fi
    
    # Моніторимо файл логів та дублюємо в unified log
    tail -F "$log_file" 2>/dev/null | while IFS= read -r line; do
        # Визначаємо рівень логування
        if [[ $line =~ ERROR|CRITICAL|Exception ]]; then
            level="ERROR"
        elif [[ $line =~ WARNING|WARN ]]; then
            level="WARN"
        elif [[ $line =~ INFO|Starting|Started ]]; then
            level="INFO"
        elif [[ $line =~ DEBUG ]]; then
            level="DEBUG"
        else
            level="INFO"
        fi
        
        log_unified "$level" "$service_name" "$line"
    done &
    
    echo $! > "$LOG_DIR/${service_name}_monitor.pid"
}

# Функція моніторингу статусу сервісів
monitor_services_status() {
    while true; do
        timestamp=$(date '+%Y-%m-%d %H:%M:%S')
        
        # Перевіряємо статус кожного сервісу
        frontend_status=$(curl -s http://localhost:5001/api/health >/dev/null 2>&1 && echo "UP" || echo "DOWN")
        orchestrator_status=$(curl -s http://localhost:5101/health >/dev/null 2>&1 && echo "UP" || echo "DOWN")
        tts_status=$(curl -s http://localhost:3001/health >/dev/null 2>&1 && echo "UP" || echo "DOWN")
        goose_status=$(curl -s http://localhost:3000/ >/dev/null 2>&1 && echo "UP" || echo "DOWN")
        recovery_status=$(lsof -ti:5102 >/dev/null 2>&1 && echo "UP" || echo "DOWN")
        
        # Записуємо статус
        cat > "$SERVICES_LOG.tmp" << EOF
[$timestamp] SERVICE_STATUS frontend=$frontend_status orchestrator=$orchestrator_status tts=$tts_status goose=$goose_status recovery=$recovery_status
EOF
        mv "$SERVICES_LOG.tmp" "$SERVICES_LOG"
        
        # Логуємо зміни статусу
        if [ -f "$SERVICES_LOG.prev" ]; then
            diff "$SERVICES_LOG.prev" "$SERVICES_LOG" >/dev/null || {
                log_unified "INFO" "MONITOR" "Service status changed: frontend=$frontend_status orchestrator=$orchestrator_status tts=$tts_status goose=$goose_status recovery=$recovery_status"
            }
        fi
        
        cp "$SERVICES_LOG" "$SERVICES_LOG.prev"
        sleep 30
    done &
    
    echo $! > "$LOG_DIR/status_monitor.pid"
}

# Функція запуску централізованого логування
start_logging() {
    echo -e "${GREEN}🚀 Starting ATLAS Centralized Logging System...${NC}"
    
    # Створюємо директорію логів
    mkdir -p "$LOG_DIR"
    
    # Ініціалізуємо unified log
    echo "# ATLAS Unified Log - Started at $(date)" > "$UNIFIED_LOG"
    log_unified "INFO" "SYSTEM" "Centralized logging system started"
    
    # Запускаємо моніторинг кожного сервісу
    echo -e "${BLUE}📡 Starting service monitors...${NC}"
    
    monitor_service "frontend" "$LOG_DIR/frontend.log" "5001"
    echo -e "  ✅ Frontend monitor started"
    
    monitor_service "orchestrator" "$LOG_DIR/orchestrator.log" "5101"
    echo -e "  ✅ Orchestrator monitor started"
    
    monitor_service "tts" "$LOG_DIR/tts_server.log" "3001"
    echo -e "  ✅ TTS monitor started"
    
    monitor_service "goose" "$LOG_DIR/goose.log" "3000"
    echo -e "  ✅ Goose monitor started"
    
    monitor_service "recovery" "$LOG_DIR/recovery_bridge.log" "5102"
    echo -e "  ✅ Recovery monitor started"
    
    # Запускаємо моніторинг статусу сервісів
    echo -e "${CYAN}📊 Starting status monitor...${NC}"
    monitor_services_status
    echo -e "  ✅ Status monitor started"
    
    echo -e "${GREEN}✅ Centralized logging system is running${NC}"
    echo -e "${YELLOW}📄 Unified log: $UNIFIED_LOG${NC}"
    echo -e "${YELLOW}📊 Services status: $SERVICES_LOG${NC}"
}

# Функція зупинки логування
stop_logging() {
    echo -e "${RED}🛑 Stopping ATLAS Centralized Logging System...${NC}"
    
    # Зупиняємо всі процеси моніторингу
    for pid_file in "$LOG_DIR"/*_monitor.pid "$LOG_DIR"/status_monitor.pid; do
        if [ -f "$pid_file" ]; then
            pid=$(cat "$pid_file")
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid"
                echo -e "  ✅ Stopped monitor (PID: $pid)"
            fi
            rm -f "$pid_file"
        fi
    done
    
    log_unified "INFO" "SYSTEM" "Centralized logging system stopped"
    echo -e "${GREEN}✅ Centralized logging system stopped${NC}"
}

# Функція показу статусу
show_status() {
    echo -e "${CYAN}📊 ATLAS Logging System Status${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Перевіряємо активні монітори
    active_monitors=0
    for pid_file in "$LOG_DIR"/*_monitor.pid "$LOG_DIR"/status_monitor.pid; do
        if [ -f "$pid_file" ]; then
            pid=$(cat "$pid_file")
            if kill -0 "$pid" 2>/dev/null; then
                active_monitors=$((active_monitors + 1))
            fi
        fi
    done
    
    echo -e "Active monitors: ${GREEN}$active_monitors${NC}"
    
    # Показуємо розміри логів
    if [ -f "$UNIFIED_LOG" ]; then
        unified_size=$(du -h "$UNIFIED_LOG" | cut -f1)
        unified_lines=$(wc -l < "$UNIFIED_LOG")
        echo -e "Unified log: ${unified_size} (${unified_lines} lines)"
    fi
    
    # Показуємо останній статус сервісів
    if [ -f "$SERVICES_LOG" ]; then
        echo -e "\nLast services status:"
        cat "$SERVICES_LOG"
    fi
    
    # Показуємо останні помилки
    if [ -f "$UNIFIED_LOG" ]; then
        echo -e "\nRecent errors:"
        tail -n 20 "$UNIFIED_LOG" | grep -E "ERROR|CRITICAL" | tail -n 5 || echo "No recent errors"
    fi
}

# Функція відображення хвоста unified log
tail_unified() {
    if [ -f "$UNIFIED_LOG" ]; then
        echo -e "${CYAN}📡 Watching unified log (Ctrl+C to stop)...${NC}"
        tail -f "$UNIFIED_LOG" | while IFS= read -r line; do
            if [[ $line =~ ERROR|CRITICAL ]]; then
                echo -e "${RED}$line${NC}"
            elif [[ $line =~ WARNING|WARN ]]; then
                echo -e "${YELLOW}$line${NC}"
            elif [[ $line =~ INFO ]]; then
                echo -e "${GREEN}$line${NC}"
            else
                echo "$line"
            fi
        done
    else
        echo -e "${RED}❌ Unified log not found${NC}"
    fi
}

# Головна функція
main() {
    case "${1:-}" in
        "start")
            start_logging
            ;;
        "stop")
            stop_logging
            ;;
        "status")
            show_status
            ;;
        "tail")
            tail_unified
            ;;
        "restart")
            stop_logging
            sleep 2
            start_logging
            ;;
        *)
            echo "ATLAS Centralized Logging System"
            echo "Usage: $0 {start|stop|status|tail|restart}"
            echo ""
            echo "Commands:"
            echo "  start   - Start centralized logging"
            echo "  stop    - Stop centralized logging"
            echo "  status  - Show logging system status"
            echo "  tail    - Watch unified log in real-time"
            echo "  restart - Restart logging system"
            ;;
    esac
}

main "$@"
