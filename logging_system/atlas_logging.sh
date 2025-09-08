#!/bin/bash

# ATLAS Master Logging Script
# Головний інтерфейс для всієї системи логування

SCRIPT_DIR="$(dirname "$0")"
LOG_MONITOR="$SCRIPT_DIR/log_monitor.sh"
CENTRALIZED_LOG="$SCRIPT_DIR/centralized_logging.sh"

# Кольори
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

# Функція показу головного меню
show_main_menu() {
    clear
    echo -e "${BOLD}${CYAN}🧠 ATLAS Complete Logging System${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo -e "${GREEN}📡 Real-time Log Monitoring:${NC}"
    echo -e "  ${GREEN}1.${NC} Interactive log viewer (full featured)"
    echo -e "  ${GREEN}2.${NC} Watch all logs (stream)"
    echo -e "  ${GREEN}3.${NC} Watch errors only"
    echo -e "  ${GREEN}4.${NC} Watch specific service"
    echo ""
    echo -e "${BLUE}🔄 Centralized Logging System:${NC}"
    echo -e "  ${BLUE}5.${NC} Start centralized logging"
    echo -e "  ${BLUE}6.${NC} Stop centralized logging"
    echo -e "  ${BLUE}7.${NC} Show logging system status"
    echo -e "  ${BLUE}8.${NC} Watch unified log"
    echo ""
    echo -e "${YELLOW}⚙️ System Management:${NC}"
    echo -e "  ${YELLOW}9.${NC} Restart ATLAS with logging"
    echo -e "  ${YELLOW}10.${NC} Check ATLAS services status"
    echo -e "  ${YELLOW}11.${NC} Archive and clean logs"
    echo ""
    echo -e "${RED}0.${NC} Exit"
    echo ""
    
    # Показуємо поточний статус системи
    show_quick_status
    echo ""
    echo -n "Choose option [0-11]: "
}

# Функція швидкого статусу
show_quick_status() {
    echo -e "${BOLD}📊 Quick Status:${NC}"
    
    # Перевіряємо сервіси ATLAS
    frontend_status=$(curl -s http://localhost:5001/api/health >/dev/null 2>&1 && echo "✅" || echo "❌")
    orchestrator_status=$(curl -s http://localhost:5101/health >/dev/null 2>&1 && echo "✅" || echo "❌")
    tts_status=$(curl -s http://localhost:3001/health >/dev/null 2>&1 && echo "✅" || echo "❌")
    goose_status=$(curl -s http://localhost:3000/ >/dev/null 2>&1 && echo "✅" || echo "❌")
    
    echo -e "Services: Frontend$frontend_status Orchestrator$orchestrator_status TTS$tts_status Goose$goose_status"
    
    # Перевіряємо систему логування
    log_monitors=0
    for pid_file in ../logs/*_monitor.pid ../logs/status_monitor.pid; do
        if [ -f "$pid_file" ]; then
            pid=$(cat "$pid_file" 2>/dev/null)
            if kill -0 "$pid" 2>/dev/null; then
                log_monitors=$((log_monitors + 1))
            fi
        fi
    done
    
    if [ $log_monitors -gt 0 ]; then
        echo -e "Logging: ${GREEN}Active ($log_monitors monitors)${NC}"
    else
        echo -e "Logging: ${YELLOW}Inactive${NC}"
    fi
}

# Функція запуску ATLAS з логуванням
restart_atlas_with_logging() {
    echo -e "${YELLOW}🔄 Restarting ATLAS with full logging...${NC}"
    
    # Зупиняємо логування
    "$CENTRALIZED_LOG" stop
    
    # Перезапускаємо ATLAS
    cd "$SCRIPT_DIR/.." && ./restart_simple.sh
    
    sleep 3
    
    # Запускаємо централізоване логування
    "$CENTRALIZED_LOG" start
    
    echo -e "${GREEN}✅ ATLAS restarted with logging system${NC}"
    echo -e "\nPress Enter to continue..."
    read -r
}

# Функція архівування логів
archive_and_clean() {
    echo -e "${BLUE}📦 Archive and Clean Logs${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    cd "$SCRIPT_DIR/.."
    
    # Показуємо поточні розміри
    echo "Current log sizes:"
    for log_file in logs/*.log; do
        if [ -f "$log_file" ]; then
            size=$(du -h "$log_file" | cut -f1)
            echo "  $(basename "$log_file"): $size"
        fi
    done
    
    echo ""
    echo "1. Archive all logs"
    echo "2. Archive and clear logs"
    echo "3. Clear logs only (no archive)"
    echo "4. Back to main menu"
    echo ""
    echo -n "Choose action [1-4]: "
    read -r choice
    
    case $choice in
        1)
            "$LOG_MONITOR" --archive
            ;;
        2)
            "$LOG_MONITOR" --archive
            sleep 1
            "$LOG_MONITOR" --clear
            ;;
        3)
            "$LOG_MONITOR" --clear
            ;;
        4)
            return
            ;;
    esac
    
    echo -e "\nPress Enter to continue..."
    read -r
}

# Головний цикл
main_loop() {
    while true; do
        show_main_menu
        read -r choice
        
        case $choice in
            1)
                clear
                echo -e "${CYAN}Starting interactive log viewer...${NC}"
                "$LOG_MONITOR"
                ;;
            2)
                clear
                echo -e "${CYAN}Watching all logs (Ctrl+C to stop)...${NC}"
                sleep 2
                "$LOG_MONITOR" --all
                ;;
            3)
                clear
                echo -e "${RED}Watching errors only (Ctrl+C to stop)...${NC}"
                sleep 2
                "$LOG_MONITOR" --errors
                ;;
            4)
                clear
                echo -e "Available services:"
                echo -e "• ${GREEN}frontend${NC} (f) - Main web interface + Vision API"
                echo -e "• ${BLUE}orchestrator${NC} (o) - Agent coordination"  
                echo -e "• ${YELLOW}tts${NC} (t) - Text-to-speech server"
                echo -e "• ${CYAN}goose${NC} (g) - AI assistant"
                echo -e "• ${MAGENTA}recovery${NC} (r) - Recovery bridge WebSocket"
                echo -e "• ${CYAN}vision${NC} (v) - Vision API only (filtered from frontend)"
                echo -n "Enter service name: "
                read -r service
                echo -e "${CYAN}Watching $service logs (Ctrl+C to stop)...${NC}"
                sleep 2
                "$LOG_MONITOR" --service "$service"
                ;;
            5)
                clear
                "$CENTRALIZED_LOG" start
                echo -e "\nPress Enter to continue..."
                read -r
                ;;
            6)
                clear
                "$CENTRALIZED_LOG" stop
                echo -e "\nPress Enter to continue..."
                read -r
                ;;
            7)
                clear
                "$CENTRALIZED_LOG" status
                echo -e "\nPress Enter to continue..."
                read -r
                ;;
            8)
                clear
                "$CENTRALIZED_LOG" tail
                ;;
            9)
                restart_atlas_with_logging
                ;;
            10)
                clear
                cd "$SCRIPT_DIR/.." && ./status_stack.sh
                echo -e "\nPress Enter to continue..."
                read -r
                ;;
            11)
                archive_and_clean
                ;;
            0)
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
        "--monitor"|"-m")
            exec "$LOG_MONITOR"
            ;;
        "--centralized"|"-c")
            shift
            exec "$CENTRALIZED_LOG" "$@"
            ;;
        "--all"|"-a")
            exec "$LOG_MONITOR" --all
            ;;
        "--errors"|"-e")
            exec "$LOG_MONITOR" --errors
            ;;
        "--service"|"-s")
            if [ -n "$2" ]; then
                exec "$LOG_MONITOR" --service "$2"
            else
                echo "Usage: $0 --service <service_name>"
                echo "Services: frontend, orchestrator, tts, goose, recovery, vision"
                exit 1
            fi
            ;;
        "--help"|"-h")
            echo "ATLAS Complete Logging System"
            echo "Usage: $0 [option]"
            echo ""
            echo "Options:"
            echo "  --monitor, -m          Start interactive log monitor"
            echo "  --centralized, -c      Control centralized logging"
            echo "  --all, -a              Watch all logs"
            echo "  --errors, -e           Watch errors only"
            echo "  --service, -s <name>   Watch specific service"
            echo "  --help, -h             Show this help"
            echo ""
            echo "Services: frontend, orchestrator, tts, goose, recovery, vision"
            echo ""
            echo "Examples:"
            echo "  $0                     Start interactive menu"
            echo "  $0 -m                  Start log monitor"
            echo "  $0 -c start            Start centralized logging"
            echo "  $0 -a                  Watch all logs"
            echo "  $0 -s vision           Watch Vision API logs"
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
else
    main_loop
fi
