#!/bin/bash

# ATLAS Pure Intelligent System - Status Check
# Перевірка статусу всієї системи ATLAS

set -e

echo "🧠 ATLAS Pure Intelligent System"
echo "📊 Checking system status..."

# Кольори для виводу
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_debug() { echo -e "${BLUE}[DEBUG]${NC} $1"; }
log_intelligent() { echo -e "${CYAN}[INTELLIGENT]${NC} $1"; }

# Функція перевірки сервісу з детальною інформацією
check_service_detailed() {
    local name="$1"
    local url="$2"
    local timeout="${3:-5}"
    local required="${4:-false}"
    
    log_debug "Checking $name at $url..."
    
    local start_time=$(date +%s%3N)
    local http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$timeout" "$url" 2>/dev/null || echo "000")
    local end_time=$(date +%s%3N)
    local response_time=$((end_time - start_time))
    
    if [ "$http_code" = "200" ]; then
        log_info "✅ $name - HEALTHY (${response_time}ms, HTTP $http_code)"
        return 0
    elif [ "$http_code" != "000" ]; then
        log_warn "⚠️  $name - RESPONDING but HTTP $http_code (${response_time}ms)"
        return 1
    else
        if [ "$required" = "true" ]; then
            log_error "❌ $name - NOT RESPONDING (required service)"
        else
            log_warn "❌ $name - NOT RESPONDING (optional service)"
        fi
        return 1
    fi
}

# Перевірка процесів ATLAS
check_atlas_processes() {
    log_intelligent "🔍 Checking ATLAS processes..."
    
    local atlas_healthy=true
    
    # Перевірка основного процесу
    local atlas_pids=$(pgrep -f "intelligent_atlas.*python" 2>/dev/null || echo "")
    
    if [ -n "$atlas_pids" ]; then
        log_info "✅ ATLAS processes found: $atlas_pids"
        
        # Перевірка кожного процесу
        for pid in $atlas_pids; do
            if kill -0 "$pid" 2>/dev/null; then
                local mem_usage=$(ps -o pid,ppid,rss,vsz,comm -p "$pid" | tail -n +2)
                log_debug "   Process $pid: $mem_usage"
            fi
        done
    else
        log_error "❌ No ATLAS processes found"
        atlas_healthy=false
    fi
    
    # Перевірка PID файлу
    if [ -f "logs/atlas.pid" ]; then
        local saved_pid=$(cat logs/atlas.pid 2>/dev/null || echo "")
        
        if [ -n "$saved_pid" ]; then
            if kill -0 "$saved_pid" 2>/dev/null; then
                log_info "✅ Saved PID $saved_pid is active"
            else
                log_warn "⚠️  Saved PID $saved_pid is not active (stale PID file)"
            fi
        fi
    else
        log_debug "No PID file found (logs/atlas.pid)"
    fi
    
    return $([ "$atlas_healthy" = true ] && echo 0 || echo 1)
}

# Перевірка портів
check_ports() {
    log_info "🔌 Checking port usage..."
    
    # Порт 5001 - ATLAS Web Interface
    local port_5001=$(lsof -ti:5001 2>/dev/null || echo "")
    if [ -n "$port_5001" ]; then
        log_info "✅ Port 5001 (ATLAS Web) - In use by PID $port_5001"
    else
        log_error "❌ Port 5001 (ATLAS Web) - Not in use"
    fi
    
    # Порт 3010 - Local AI API
    local port_3010=$(lsof -ti:3010 2>/dev/null || echo "")
    if [ -n "$port_3010" ]; then
        log_info "✅ Port 3010 (AI API) - In use by PID $port_3010"
    else
        log_warn "⚠️  Port 3010 (AI API) - Not in use"
    fi
    
    # Порт 3000 - Goose
    local port_3000=$(lsof -ti:3000 2>/dev/null || echo "")
    if [ -n "$port_3000" ]; then
        log_info "✅ Port 3000 (Goose) - In use by PID $port_3000"
    else
        log_warn "⚠️  Port 3000 (Goose) - Not in use"
    fi
    
    # Порт 3001 - TTS
    local port_3001=$(lsof -ti:3001 2>/dev/null || echo "")
    if [ -n "$port_3001" ]; then
        log_info "✅ Port 3001 (TTS) - In use by PID $port_3001"
    else
        log_warn "⚠️  Port 3001 (TTS) - Not in use"
    fi
}

# Перевірка ATLAS веб-інтерфейсу
check_atlas_web() {
    log_intelligent "🌐 Checking ATLAS Web Interface..."
    
    if check_service_detailed "ATLAS Web Interface" "http://127.0.0.1:5001/api/health" 5 true; then
        
        # Спробуємо отримати детальну інформацію
        local health_response=$(curl -s --max-time 5 "http://127.0.0.1:5001/api/health" 2>/dev/null || echo "{}")
        
        log_info "   Health response: $health_response"
        
        # Перевірка головної сторінки
        if curl -s --max-time 3 "http://127.0.0.1:5001/" > /dev/null 2>&1; then
            log_info "✅ Main page accessible"
        else
            log_warn "⚠️  Main page not accessible"
        fi
        
        return 0
    else
        return 1
    fi
}

# Перевірка зовнішніх сервісів
check_external_services() {
    log_info "🔗 Checking external services..."
    
    # Local AI API
    if check_service_detailed "Local AI API" "http://127.0.0.1:3010/v1/models" 3 true; then
        # Спробуємо отримати список моделей
        local models=$(curl -s --max-time 3 "http://127.0.0.1:3010/v1/models" 2>/dev/null || echo "{}")
        local model_count=$(echo "$models" | grep -o '"id"' | wc -l || echo "0")
        log_info "   Available models: $model_count"
    fi
    
    # Goose Executor
    check_service_detailed "Goose Executor" "http://127.0.0.1:3000/health" 3 false
    
    # Ukrainian TTS
    if check_service_detailed "Ukrainian TTS" "http://127.0.0.1:3001/health" 3 false; then
        # Спробуємо отримати список голосів
        if curl -s --max-time 3 "http://127.0.0.1:3001/voices" > /dev/null 2>&1; then
            log_info "   Voice endpoint accessible"
        fi
    fi
}

# Перевірка файлової системи та логів
check_filesystem() {
    log_info "📁 Checking filesystem and logs..."
    
    # Перевірка структури проекту
    if [ -d "intelligent_atlas" ]; then
        log_info "✅ intelligent_atlas directory exists"
        
        if [ -f "intelligent_atlas/requirements.txt" ]; then
            log_info "✅ Requirements file exists"
        else
            log_warn "⚠️  Requirements file missing"
        fi
        
        if [ -d "intelligent_atlas/venv" ]; then
            log_info "✅ Python virtual environment exists"
        else
            log_warn "⚠️  Python virtual environment missing"
        fi
    else
        log_error "❌ intelligent_atlas directory missing"
    fi
    
    # Перевірка логів
    if [ -d "logs" ]; then
        local log_count=$(ls -1 logs/*.log 2>/dev/null | wc -l || echo "0")
        local log_size=$(du -sh logs/ 2>/dev/null | cut -f1 || echo "0B")
        
        log_info "✅ Logs directory: $log_count files, $log_size total"
        
        if [ -f "logs/atlas_intelligent.log" ]; then
            local log_lines=$(wc -l < logs/atlas_intelligent.log 2>/dev/null || echo "0")
            local log_size_main=$(du -sh logs/atlas_intelligent.log 2>/dev/null | cut -f1 || echo "0B")
            log_info "   Main log: $log_lines lines, $log_size_main"
            
            # Показуємо останні записи якщо є помилки
            local error_count=$(grep -c "ERROR" logs/atlas_intelligent.log 2>/dev/null || echo "0")
            if [ "$error_count" -gt "0" ]; then
                log_warn "   Found $error_count ERROR entries in main log"
            fi
        else
            log_warn "⚠️  Main log file missing"
        fi
    else
        log_warn "⚠️  Logs directory missing"
    fi
}

# Системна інформація
show_system_info() {
    log_info "💻 System Information:"
    
    # Platform info
    local os_info=$(uname -s 2>/dev/null || echo "Unknown")
    local arch_info=$(uname -m 2>/dev/null || echo "Unknown")
    log_info "   Platform: $os_info $arch_info"
    
    # Python info
    if command -v python3 &> /dev/null; then
        local python_version=$(python3 --version 2>/dev/null | cut -d' ' -f2 || echo "Unknown")
        log_info "   Python: $python_version"
    else
        log_warn "   Python: Not found"
    fi
    
    # Memory info (if available)
    if command -v free &> /dev/null; then
        local mem_info=$(free -h | grep "Mem:" | awk '{print $3 "/" $2}' || echo "Unknown")
        log_info "   Memory: $mem_info used"
    elif [ "$os_info" = "Darwin" ]; then
        # macOS memory info
        local mem_total=$(system_profiler SPHardwareDataType | grep "Memory:" | awk '{print $2 " " $3}' || echo "Unknown")
        log_info "   Memory: $mem_total total"
    fi
    
    # Disk space
    local disk_info=$(df -h . | tail -1 | awk '{print $3 "/" $2 " (" $5 " used)"}' || echo "Unknown")
    log_info "   Disk: $disk_info"
    
    # Load average (if available)
    if [ -f "/proc/loadavg" ]; then
        local load_avg=$(cat /proc/loadavg | awk '{print $1 ", " $2 ", " $3}' || echo "Unknown")
        log_info "   Load: $load_avg"
    fi
}

# Створення звіту про статус
generate_status_report() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local report_file="logs/status_report_$(date +%Y%m%d_%H%M%S).txt"
    
    # Створюємо директорію логів якщо не існує
    mkdir -p logs
    
    echo "ATLAS Pure Intelligent System - Status Report" > "$report_file"
    echo "Generated: $timestamp" >> "$report_file"
    echo "=========================================" >> "$report_file"
    echo "" >> "$report_file"
    
    # Записуємо в файл звіт (без кольорів)
    {
        echo "ATLAS Processes:"
        pgrep -f "intelligent_atlas.*python" 2>/dev/null || echo "None"
        echo ""
        
        echo "Port Usage:"
        lsof -i:5001,3010,3000,3001 2>/dev/null || echo "No services on target ports"
        echo ""
        
        echo "Service Health:"
        curl -s --max-time 2 "http://127.0.0.1:5001/api/health" 2>/dev/null || echo "ATLAS Web: Not responding"
        curl -s --max-time 2 "http://127.0.0.1:3010/v1/models" 2>/dev/null || echo "AI API: Not responding"
        curl -s --max-time 2 "http://127.0.0.1:3000/health" 2>/dev/null || echo "Goose: Not responding"
        curl -s --max-time 2 "http://127.0.0.1:3001/health" 2>/dev/null || echo "TTS: Not responding"
        echo ""
        
        echo "System Resources:"
        ps aux | grep -E "(intelligent|atlas|goose)" | grep -v grep || echo "No relevant processes"
        
    } >> "$report_file"
    
    log_info "📋 Status report saved: $report_file"
}

# Головна функція
main() {
    echo ""
    log_intelligent "🧠 ATLAS Pure Intelligent System - Status Check"
    log_intelligent "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    # Перевірки системи
    check_atlas_processes
    echo ""
    
    check_ports
    echo ""
    
    check_atlas_web
    echo ""
    
    check_external_services
    echo ""
    
    check_filesystem
    echo ""
    
    show_system_info
    echo ""
    
    # Створення звіту
    generate_status_report
    echo ""
    
    # Підсумок
    log_intelligent "📊 Status Summary:"
    
    local overall_status="healthy"
    
    # Перевіряємо критичні компоненти
    if ! pgrep -f "intelligent_atlas.*python" > /dev/null 2>&1; then
        log_error "❌ ATLAS System: Not running"
        overall_status="unhealthy"
    else
        log_intelligent "✅ ATLAS System: Running"
    fi
    
    if ! curl -s --max-time 2 "http://127.0.0.1:5001/api/health" > /dev/null 2>&1; then
        log_error "❌ Web Interface: Not responding"
        overall_status="unhealthy"
    else
        log_intelligent "✅ Web Interface: Responding"
    fi
    
    if ! curl -s --max-time 2 "http://127.0.0.1:3010/v1/models" > /dev/null 2>&1; then
        log_error "❌ AI API: Not available (CRITICAL)"
        overall_status="critical"
    else
        log_intelligent "✅ AI API: Available"
    fi
    
    echo ""
    
    if [ "$overall_status" = "healthy" ]; then
        log_intelligent "🎉 Overall Status: HEALTHY"
        log_intelligent "   All critical services are operational"
    elif [ "$overall_status" = "unhealthy" ]; then
        log_warn "⚠️  Overall Status: UNHEALTHY"
        log_warn "   Some services need attention"
    else
        log_error "🚨 Overall Status: CRITICAL"
        log_error "   Critical services unavailable"
    fi
    
    echo ""
    log_intelligent "Access points:"
    log_intelligent "  🌐 Web Interface: http://127.0.0.1:5001"
    log_intelligent "  📊 Health Check: http://127.0.0.1:5001/api/health"
    log_intelligent "  📄 Logs: tail -f logs/atlas_intelligent.log"
    
    # Exit code based on status
    if [ "$overall_status" = "critical" ]; then
        exit 2
    elif [ "$overall_status" = "unhealthy" ]; then
        exit 1
    else
        exit 0
    fi
}

# Запуск
main "$@"