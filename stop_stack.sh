#!/bin/bash

# ATLAS Pure Intelligent System - Stack Stop
# Зупинка всієї системи ATLAS

set -e

echo "🧠 ATLAS Pure Intelligent System"
echo "🛑 Stopping intelligent stack..."

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

# Функція graceful stop процесу
graceful_stop() {
    local pid=$1
    local name="$2"
    local timeout="${3:-10}"
    
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        return 0
    fi
    
    log_info "🔄 Gracefully stopping $name (PID: $pid)..."
    
    # Спробуємо graceful shutdown
    kill -TERM "$pid" 2>/dev/null || true
    
    # Чекаємо graceful shutdown
    local count=0
    while [ $count -lt $timeout ] && kill -0 "$pid" 2>/dev/null; do
        sleep 1
        count=$((count + 1))
    done
    
    # Якщо процес ще живий, force kill
    if kill -0 "$pid" 2>/dev/null; then
        log_warn "⚠️  Force stopping $name..."
        kill -KILL "$pid" 2>/dev/null || true
        sleep 2
    fi
    
    if kill -0 "$pid" 2>/dev/null; then
        log_error "❌ Failed to stop $name"
        return 1
    else
        log_info "✅ $name stopped"
        return 0
    fi
}

# Зупинка ATLAS системи
stop_atlas_system() {
    log_intelligent "🛑 Stopping ATLAS Pure Intelligent System..."
    
    local atlas_stopped=true
    
    # Спробуємо знайти PID з файлу
    if [ -f "logs/atlas.pid" ]; then
        local atlas_pid=$(cat logs/atlas.pid 2>/dev/null || echo "")
        
        if [ -n "$atlas_pid" ] && kill -0 "$atlas_pid" 2>/dev/null; then
            log_info "📄 Found ATLAS PID from file: $atlas_pid"
            
            if graceful_stop "$atlas_pid" "ATLAS System" 15; then
                rm -f logs/atlas.pid
            else
                atlas_stopped=false
            fi
        else
            log_debug "PID file exists but process not running"
            rm -f logs/atlas.pid
        fi
    fi
    
    # Шукаємо процеси ATLAS
    local atlas_pids=$(pgrep -f "intelligent_atlas.*python" 2>/dev/null || echo "")
    
    if [ -n "$atlas_pids" ]; then
        log_info "🔍 Found ATLAS processes: $atlas_pids"
        
        for pid in $atlas_pids; do
            if graceful_stop "$pid" "ATLAS Process" 10; then
                continue
            else
                atlas_stopped=false
            fi
        done
    fi
    
    # Додаткова перевірка на Python процеси з intelligent_engine
    local engine_pids=$(pgrep -f "intelligent_engine" 2>/dev/null || echo "")
    
    if [ -n "$engine_pids" ]; then
        log_info "🔍 Found Intelligent Engine processes: $engine_pids"
        
        for pid in $engine_pids; do
            graceful_stop "$pid" "Intelligent Engine" 10
        done
    fi
    
    # Зупинка Flask процесів на порті 5001
    local flask_pids=$(lsof -ti:5001 2>/dev/null || echo "")
    
    if [ -n "$flask_pids" ]; then
        log_info "🔍 Found processes on port 5001: $flask_pids"
        
        for pid in $flask_pids; do
            graceful_stop "$pid" "Flask Process (port 5001)" 5
        done
    fi
    
    if [ "$atlas_stopped" = true ]; then
        log_intelligent "✅ ATLAS System stopped successfully"
    else
        log_error "❌ Some ATLAS processes may still be running"
    fi

    # Зупиняємо legacy orchestrator (Node.js)
    if pgrep -f "frontend_new/orchestrator/server.js" > /dev/null; then
        local orch_pids=$(pgrep -f "frontend_new/orchestrator/server.js" || true)
        for pid in $orch_pids; do
            graceful_stop "$pid" "Legacy Orchestrator (Node.js)" 10 || true
        done
    fi

    # Зупиняємо legacy Flask frontend
    if pgrep -f "frontend_new/app/atlas_server.py" > /dev/null; then
        local flask_pids=$(pgrep -f "frontend_new/app/atlas_server.py" || true)
        for pid in $flask_pids; do
            graceful_stop "$pid" "Legacy Frontend (Flask)" 10 || true
        done
    fi

    # Порти 5001 / 5101 додатково
    local port_5101=$(lsof -ti:5101 2>/dev/null || true)
    if [ -n "$port_5101" ]; then
        for pid in $port_5101; do
            graceful_stop "$pid" "Process on port 5101" 5 || true
        done
    fi
}

# Очищення ресурсів
cleanup_resources() {
    log_info "🧹 Cleaning up resources..."
    
    # Очищення тимчасових файлів
    if [ -d "intelligent_atlas" ]; then
        cd intelligent_atlas
        
        # Очищення Python cache
        find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
        find . -type f -name "*.pyc" -delete 2>/dev/null || true
        
        cd ..
    fi
    
    # Очищення застарілих логів (старше 7 днів)
    if [ -d "logs" ]; then
        find logs/ -name "*.log" -type f -mtime +7 -delete 2>/dev/null || true
    fi
    
    log_info "✅ Cleanup completed"
}

# Перевірка статусу після зупинки
verify_shutdown() {
    log_info "🔍 Verifying shutdown..."
    
    local still_running=false
    
    # Перевірка веб-інтерфейсу
    if curl -s --max-time 2 "http://127.0.0.1:5001/api/health" > /dev/null 2>&1; then
        log_warn "⚠️  ATLAS Web Interface still responding on port 5001"
        still_running=true
    fi
    
    # Перевірка процесів
    if pgrep -f "intelligent_atlas.*python" > /dev/null 2>&1; then
        log_warn "⚠️  ATLAS processes still running"
        still_running=true
    fi
    
    if [ "$still_running" = true ]; then
        log_warn "⚠️  Some components may still be running"
        log_warn "   Manual cleanup may be required"
        
        echo ""
        log_info "Manual cleanup commands:"
        log_info "  pkill -f 'intelligent_atlas.*python'"
        log_info "  lsof -ti:5001 | xargs kill -9"
    else
        log_intelligent "✅ All ATLAS components stopped successfully"
    fi
}

# Показ інформації про ресурси після зупинки
show_post_shutdown_info() {
    log_intelligent "📊 Post-shutdown Information:"
    echo ""
    
    # Статистика логів
    if [ -d "logs" ]; then
        local log_count=$(ls -1 logs/*.log 2>/dev/null | wc -l || echo "0")
        local log_size=$(du -sh logs/ 2>/dev/null | cut -f1 || echo "0B")
        
        log_info "📄 Logs: $log_count files, $log_size total"
        
        if [ -f "logs/atlas_intelligent.log" ]; then
            local log_lines=$(wc -l < logs/atlas_intelligent.log 2>/dev/null || echo "0")
            log_info "📄 Main log: $log_lines lines"
        fi
    fi
    
    # Інформація про зовнішні сервіси (які можуть все ще працювати)
    echo ""
    log_info "External services status (not managed by ATLAS):"
    
    if curl -s --max-time 2 "http://127.0.0.1:3010/v1/models" > /dev/null 2>&1; then
        log_info "✅ Local AI API (port 3010) - Still running"
    else
        log_info "❌ Local AI API (port 3010) - Not running"
    fi
    
    if curl -s --max-time 2 "http://127.0.0.1:3000/health" > /dev/null 2>&1; then
        log_info "✅ Goose (port 3000) - Still running"
    else
        log_info "❌ Goose (port 3000) - Not running"
    fi
    
    if curl -s --max-time 2 "http://127.0.0.1:3001/health" > /dev/null 2>&1; then
        log_info "✅ Ukrainian TTS (port 3001) - Still running"
    else
        log_info "❌ Ukrainian TTS (port 3001) - Not running"
    fi

    # Also attempt to stop Goose and Ukrainian TTS via helper script if present
    if [ -x "scripts/stop_tts_and_goose.sh" ]; then
        log_info "🔧 Running scripts/stop_tts_and_goose.sh to stop Goose/TTS"
        scripts/stop_tts_and_goose.sh || log_warn "scripts/stop_tts_and_goose.sh returned non-zero"
    fi

    # Stop Recovery Bridge if canonical file exists
    if [ -f "frontend_new/config/recovery_bridge.py" ]; then
        if [ -f "logs/recovery_bridge.pid" ]; then
            rbpid=$(cat logs/recovery_bridge.pid 2>/dev/null || true)
            if [ -n "$rbpid" ] && kill -0 "$rbpid" 2>/dev/null; then
                graceful_stop "$rbpid" "Recovery Bridge" 5 || true
                rm -f logs/recovery_bridge.pid
            else
                log_debug "Recovery bridge pid file exists but process not running"
                rm -f logs/recovery_bridge.pid
            fi
        else
            # Try to stop by name as fallback
            pkill -f "recovery_bridge.py" || true
        fi
    else
        log_debug "frontend_new/config/recovery_bridge.py not found — skipping recovery bridge stop"
    fi
}

# Головна функція
main() {
    echo ""
    log_intelligent "🧠 ATLAS Pure Intelligent System - Shutdown"
    log_intelligent "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    # Зупинка системи
    stop_atlas_system
    echo ""
    
    # Очищення ресурсів
    cleanup_resources
    echo ""
    
    # Перевірка зупинки
    verify_shutdown
    echo ""
    
    # Інформація після зупинки
    show_post_shutdown_info
    echo ""
    
    log_intelligent "🎯 ATLAS Shutdown Complete"
    log_intelligent ""
    log_intelligent "System stopped:"
    log_intelligent "  🛑 ATLAS Web Interface (port 5001)"
    log_intelligent "  🧠 Intelligent Engine"
    log_intelligent "  🎭 All agents (Atlas, Tetyana, Grisha)"
    log_intelligent ""
    log_intelligent "To restart:"
    log_intelligent "  � Simple: ./restart_simple.sh"
    log_intelligent ""
    log_intelligent "📄 Logs preserved in logs/ directory"
}

# Обробка сигналів
trap 'log_info "Shutdown interrupted"; exit 1' SIGINT SIGTERM

# Запуск
main "$@"