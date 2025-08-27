#!/bin/bash

# ATLAS System Monitor Script
# Скрипт моніторингу системи ATLAS
# Відстежує стан всіх компонентів і перевіряє їх працездатність

# Встановлення кольорів для виведення
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Функція для відображення заголовку
print_header() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}🔍 ATLAS СИСТЕМА МОНІТОРИНГУ - Оновлення кожні 5 секунд${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Функція для перевірки процесу
check_process() {
    local process_name=$1
    local process_pattern=$2
    local port=$3
    local pid=$(pgrep -f "$process_pattern" | head -1)
    
    echo -n -e "${CYAN}$process_name:${NC} "
    
    if [ -z "$pid" ]; then
        echo -e "${RED}Не запущено${NC}"
        return 1
    else
        # Перевірка завантаження CPU і пам'яті
        local cpu=$(ps -p $pid -o %cpu | tail -1 | tr -d ' ')
        local mem=$(ps -p $pid -o %mem | tail -1 | tr -d ' ')
        local runtime=$(ps -p $pid -o etime | tail -1 | tr -d ' ')
        
        echo -n -e "${GREEN}Працює (PID: $pid)${NC}"
        echo -n -e " | CPU: $cpu% | MEM: $mem% | Час роботи: $runtime"
        
        # Перевірка порту, якщо вказано
        if [ ! -z "$port" ]; then
            if lsof -i:$port -P -n | grep LISTEN > /dev/null; then
                echo -n -e " | ${GREEN}Порт $port: відкрито${NC}"
            else
                echo -n -e " | ${RED}Порт $port: закрито${NC}"
            fi
        fi
        
        echo ""
        return 0
    fi
}

# Функція для перевірки здоров'я API
check_health() {
    local url=$1
    local name=$2
    
    echo -n -e "${CYAN}$name API:${NC} "
    
    local response=$(curl -s -o /dev/null -w "%{http_code}" $url 2>/dev/null)
    
    if [ "$response" = "200" ]; then
        echo -e "${GREEN}OK (HTTP 200)${NC}"
    else
        echo -e "${RED}Помилка (HTTP $response)${NC}"
    fi
}

# Функція для відображення останніх логів
show_last_logs() {
    local log_file=$1
    local component=$2
    local lines=${3:-5}
    
    echo -e "${CYAN}Останні логи $component:${NC}"
    echo -e "${BLUE}─────────────────────────────────────────────────────────────${NC}"
    
    if [ -f "$log_file" ]; then
        tail -$lines "$log_file" | while read -r line; do
            if [[ $line == *"error"* ]] || [[ $line == *"Error"* ]] || [[ $line == *"ERROR"* ]] || [[ $line == *"❌"* ]]; then
                echo -e "${RED}$line${NC}"
            elif [[ $line == *"warning"* ]] || [[ $line == *"Warning"* ]] || [[ $line == *"WARNING"* ]] || [[ $line == *"⚠️"* ]]; then
                echo -e "${YELLOW}$line${NC}"
            else
                echo "$line"
            fi
        done
    else
        echo -e "${RED}Файл логу не знайдено: $log_file${NC}"
    fi
    
    echo -e "${BLUE}─────────────────────────────────────────────────────────────${NC}"
}

# Основний цикл моніторингу
while true; do
    clear
    print_header
    
    # Перевірка процесів
    echo -e "${CYAN}Статус компонентів:${NC}"
    echo -e "${BLUE}─────────────────────────────────────────────────────────────${NC}"
    check_process "🤖 AI Agent" "goosed" "3000"
    check_process "🌐 Frontend" "atlas_minimal" "8080"
    check_process "🗣️ TTS Server" "mcp_tts" ""
    echo -e "${BLUE}─────────────────────────────────────────────────────────────${NC}"
    
    # Перевірка API
    echo -e "${CYAN}Статус API:${NC}"
    echo -e "${BLUE}─────────────────────────────────────────────────────────────${NC}"
    check_health "http://localhost:3000/health" "AI Agent"
    check_health "http://localhost:8080" "Frontend"
    echo -e "${BLUE}─────────────────────────────────────────────────────────────${NC}"
    
    # Останні логи AI Agent
    show_last_logs "/tmp/goose.log" "AI Agent"
    
    # Останні логи TTS
    show_last_logs "/tmp/tts.log" "TTS Server"
    
    # Останні логи Frontend
    show_last_logs "/tmp/frontend.log" "Frontend"
    
    echo -e "${YELLOW}Натисніть Ctrl+C для виходу. Оновлення через 5 сек...${NC}"
    sleep 5
done
