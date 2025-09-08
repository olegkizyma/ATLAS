#!/bin/bash

# ATLAS Real-time Log Monitoring System
# Інтерактивний моніторинг логів з підсвіткою помилок

# Кольори для підсвітки
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
GRAY='\033[0;37m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Конфігурація
LOG_DIR="../logs"
CONFIG_FILE="$(dirname "$0")/log_monitor.conf"

# Функції підсвітки
highlight_logs() {
    while IFS= read -r line; do
        # Визначаємо сервіс з лінії
        service=""
        if [[ $line == *"frontend.log"* ]]; then
            service="[FRONTEND]"
            service_color="$GREEN"
        elif [[ $line == *"orchestrator.log"* ]]; then
            service="[ORCHESTRATOR]"
            service_color="$BLUE"
        elif [[ $line == *"tts_server.log"* ]]; then
            service="[TTS]"
            service_color="$MAGENTA"
        elif [[ $line == *"goose.log"* ]]; then
            service="[GOOSE]"
            service_color="$CYAN"
        elif [[ $line == *"recovery_bridge.log"* ]]; then
            service="[RECOVERY]"
            service_color="$YELLOW"
        else
            service="[SYSTEM]"
            service_color="$GRAY"
        fi
        
        # Підсвічуємо рівні логування
        if [[ $line =~ \[ERROR\]|\[CRITICAL\]|ERROR|CRITICAL|Exception|Traceback ]]; then
            echo -e "${RED}${BOLD}${service}${NC} ${RED}$line${NC}"
        elif [[ $line =~ \[WARNING\]|\[WARN\]|WARNING|WARN ]]; then
            echo -e "${YELLOW}${service}${NC} ${YELLOW}$line${NC}"
        elif [[ $line =~ \[INFO\]|INFO|Starting|Started|Active|Success ]]; then
            echo -e "${service_color}${service}${NC} ${WHITE}$line${NC}"
        elif [[ $line =~ \[DEBUG\]|DEBUG ]]; then
            echo -e "${GRAY}${service}${NC} ${GRAY}$line${NC}"
        else
            echo -e "${service_color}${service}${NC} $line"
        fi
    done
}

# Функція показу статистики
show_stats() {
    echo -e "\n${BOLD}📊 Log Statistics:${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    for log_file in "$LOG_DIR"/*.log; do
        if [ -f "$log_file" ]; then
            filename=$(basename "$log_file")
            size=$(du -h "$log_file" | cut -f1)
            lines=$(wc -l < "$log_file")
            errors=$(grep -c -E "ERROR|CRITICAL|Exception" "$log_file" 2>/dev/null || echo "0")
            warnings=$(grep -c -E "WARNING|WARN" "$log_file" 2>/dev/null || echo "0")
            
            echo -e "${GREEN}📄 $filename${NC}: ${size} | ${lines} lines | ${RED}${errors} errors${NC} | ${YELLOW}${warnings} warnings${NC}"
        fi
    done
}

# Функція фільтрації по сервісу
filter_by_service() {
    local service="$1"
    case "$service" in
        "frontend"|"f")
            echo -e "\n${GREEN}📄 Frontend includes Vision API${NC}"
            tail -f "$LOG_DIR/frontend.log" 2>/dev/null | highlight_logs
            ;;
        "orchestrator"|"o")
            tail -f "$LOG_DIR/orchestrator.log" 2>/dev/null | highlight_logs
            ;;
        "tts"|"t")
            tail -f "$LOG_DIR/tts_server.log" 2>/dev/null | highlight_logs
            ;;
        "goose"|"g")
            tail -f "$LOG_DIR/goose.log" 2>/dev/null | highlight_logs
            ;;
        "recovery"|"r")
            echo -e "\n${MAGENTA}📄 Recovery Bridge WebSocket Service${NC}"
            tail -f "$LOG_DIR/recovery_bridge.log" 2>/dev/null | highlight_logs
            ;;
        "vision"|"v")
            echo -e "\n${CYAN}📄 Vision API (integrated in Frontend)${NC}"
            tail -f "$LOG_DIR/frontend.log" 2>/dev/null | grep -i --line-buffered vision | highlight_logs
            ;;
        "errors"|"e")
            tail -f "$LOG_DIR"/*.log 2>/dev/null | grep -E "ERROR|CRITICAL|Exception|Traceback" | highlight_logs
            ;;
        *)
            echo "Unknown service: $service"
            echo "Available: frontend(f), orchestrator(o), tts(t), goose(g), recovery(r), vision(v), errors(e)"
            ;;
    esac
}

# Інтерактивне меню
show_menu() {
    clear
    echo -e "${BOLD}${CYAN}🧠 ATLAS Log Monitoring System${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo -e "${GREEN}1.${NC} Watch all logs (real-time)"
    echo -e "${GREEN}2.${NC} Watch specific service"
    echo -e "${GREEN}3.${NC} Show error logs only"
    echo -e "${GREEN}4.${NC} Show log statistics"
    echo -e "${GREEN}5.${NC} Search in logs"
    echo -e "${GREEN}6.${NC} Clear all logs"
    echo -e "${GREEN}7.${NC} Archive old logs"
    echo -e "${GREEN}8.${NC} Configure monitoring"
    echo -e "${RED}9.${NC} Exit"
    echo ""
    show_stats
    echo ""
    echo -n "Choose option [1-9]: "
}

# Функція пошуку
search_logs() {
    echo -n "Enter search term: "
    read -r search_term
    echo -e "\n${BOLD}🔍 Searching for: '$search_term'${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    for log_file in "$LOG_DIR"/*.log; do
        if [ -f "$log_file" ]; then
            filename=$(basename "$log_file")
            matches=$(grep -n -i "$search_term" "$log_file" 2>/dev/null)
            if [ -n "$matches" ]; then
                echo -e "\n${GREEN}📄 $filename:${NC}"
                echo "$matches" | while IFS= read -r line; do
                    echo -e "  ${YELLOW}$line${NC}"
                done
            fi
        fi
    done
    
    echo -e "\nPress Enter to continue..."
    read -r
}

# Функція очищення логів
clear_logs() {
    echo -e "${YELLOW}⚠️  This will clear all log files. Continue? (y/N):${NC} "
    read -r confirm
    if [[ $confirm =~ ^[Yy]$ ]]; then
        for log_file in "$LOG_DIR"/*.log; do
            if [ -f "$log_file" ]; then
                > "$log_file"
                echo -e "${GREEN}✅ Cleared $(basename "$log_file")${NC}"
            fi
        done
        echo -e "${GREEN}✅ All logs cleared${NC}"
    else
        echo "Cancelled"
    fi
    echo -e "\nPress Enter to continue..."
    read -r
}

# Функція архівування логів
archive_logs() {
    local archive_dir="$LOG_DIR/archive"
    local timestamp=$(date +"%Y%m%d_%H%M%S")
    
    mkdir -p "$archive_dir"
    
    echo -e "${BLUE}📦 Archiving logs...${NC}"
    tar -czf "$archive_dir/logs_$timestamp.tar.gz" -C "$LOG_DIR" --exclude="archive" *.log 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Logs archived to: logs_$timestamp.tar.gz${NC}"
        echo -n "Clear current logs after archiving? (y/N): "
        read -r clear_confirm
        if [[ $clear_confirm =~ ^[Yy]$ ]]; then
            clear_logs
        fi
    else
        echo -e "${RED}❌ Archive failed${NC}"
    fi
    
    echo -e "\nPress Enter to continue..."
    read -r
}

# Основний цикл
main() {
    # Перевіряємо директорію логів
    if [ ! -d "$LOG_DIR" ]; then
        echo -e "${RED}❌ Logs directory not found: $LOG_DIR${NC}"
        exit 1
    fi
    
    while true; do
        show_menu
        read -r choice
        
        case $choice in
            1)
                echo -e "\n${BOLD}📡 Watching all logs (Ctrl+C to stop)...${NC}"
                sleep 2
                tail -f "$LOG_DIR"/*.log 2>/dev/null | highlight_logs
                ;;
            2)
                echo -e "\n${BOLD}Available services:${NC}"
                echo "• frontend (f) - Main web interface"
                echo "• orchestrator (o) - Agent coordination"  
                echo "• tts (t) - Text-to-speech server"
                echo "• goose (g) - AI assistant"
                echo "• recovery (r) - Recovery bridge"
                echo -n "Enter service name: "
                read -r service
                echo -e "\n${BOLD}📡 Watching $service logs (Ctrl+C to stop)...${NC}"
                sleep 2
                filter_by_service "$service"
                ;;
            3)
                echo -e "\n${BOLD}🚨 Watching ERROR logs only (Ctrl+C to stop)...${NC}"
                sleep 2
                tail -f "$LOG_DIR"/*.log 2>/dev/null | grep --line-buffered -E "ERROR|CRITICAL|Exception|Traceback" | highlight_logs
                ;;
            4)
                clear
                show_stats
                echo -e "\nPress Enter to continue..."
                read -r
                ;;
            5)
                search_logs
                ;;
            6)
                clear_logs
                ;;
            7)
                archive_logs
                ;;
            8)
                echo -e "${BLUE}Configuration options will be added in future version${NC}"
                echo -e "\nPress Enter to continue..."
                read -r
                ;;
            9)
                echo -e "${GREEN}👋 Goodbye!${NC}"
                exit 0
                ;;
            *)
                echo -e "${RED}Invalid option${NC}"
                sleep 1
                ;;
        esac
    done
}

# Перевірка аргументів командного рядка
if [ $# -gt 0 ]; then
    case "$1" in
        "--all"|"-a")
            tail -f "$LOG_DIR"/*.log 2>/dev/null | highlight_logs
            ;;
        "--errors"|"-e")
            tail -f "$LOG_DIR"/*.log 2>/dev/null | grep --line-buffered -E "ERROR|CRITICAL|Exception|Traceback" | highlight_logs
            ;;
        "--service"|"-s")
            if [ -n "$2" ]; then
                filter_by_service "$2"
            else
                echo "Usage: $0 --service <service_name>"
                exit 1
            fi
            ;;
        "--stats")
            show_stats
            ;;
        "--help"|"-h")
            echo "ATLAS Log Monitor"
            echo "Usage: $0 [option]"
            echo ""
            echo "Options:"
            echo "  --all, -a              Watch all logs"
            echo "  --errors, -e           Watch errors only"
            echo "  --service, -s <name>   Watch specific service"
            echo "  --stats                Show log statistics"
            echo "  --help, -h             Show this help"
            echo ""
            echo "Services: frontend, orchestrator, tts, goose, recovery, vision"
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
else
    main
fi
