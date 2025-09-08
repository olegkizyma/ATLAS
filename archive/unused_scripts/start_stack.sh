#!/bin/bash

# ATLAS Pure Intelligent System - Linux Stack Startup
# Запуск всієї системи ATLAS на Linux

set -e

echo "🧠 ATLAS Pure Intelligent System - Linux"
echo "🚀 Starting intelligent stack..."

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

# --- Runtime Guards (Node.js version + Local AI API graceful degrade) ---
REQUIRED_NODE_MIN=22
REQUIRED_NODE_MAX=22

check_node_version() {
    if [ "${SKIP_NODE_CHECK}" = "1" ]; then
        log_warn "Skipping Node version check (SKIP_NODE_CHECK=1)"; return 0; fi
    if ! command -v node >/dev/null 2>&1; then
        log_error "Node.js не знайдено. Встанови nvm і виконай: nvm install 22.17.1"; return 1; fi
    local ver major
    ver="$(node -v 2>/dev/null || echo v0.0.0)"; major="${ver#v}"; major="${major%%.*}"
    if [ "$major" -lt "$REQUIRED_NODE_MIN" ] || [ "$major" -gt "$REQUIRED_NODE_MAX" ]; then
        log_warn "Поточна Node версія $ver не у діапазоні ${REQUIRED_NODE_MIN}.x (<23). Пробую nvm .nvmrc...";
        if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
        if command -v nvm >/dev/null 2>&1 && [ -f "frontend_new/orchestrator/.nvmrc" ]; then
            local target; target="$(head -n1 frontend_new/orchestrator/.nvmrc | tr -d '\r')"
            nvm install "$target" >/dev/null 2>&1 || true
            nvm use "$target" >/dev/null 2>&1 || true
            ver="$(node -v 2>/dev/null || echo v0.0.0)"; major="${ver#v}"; major="${major%%.*}"
        fi
    fi
    if [ "$major" -lt "$REQUIRED_NODE_MIN" ] || [ "$major" -gt "$REQUIRED_NODE_MAX" ]; then
        log_error "Несумісна Node версія: $ver. Потрібно 22.x (наприклад 22.17.1)."; return 1; fi
    log_info "✔ Node.js $ver OK"
}

check_local_ai_api_guard() {
    if curl -s --max-time 3 http://127.0.0.1:3010/v1/models >/dev/null 2>&1; then
        log_info "✔ Local AI API (3010) доступний"; return 0; fi
    log_warn "⚠️ Local AI API (3010) недоступний – LLM маршрути можуть деградувати";
    [ "${ALLOW_NO_LOCAL_AI}" = "1" ] && return 0 || return 1
}

# Функція перевірки сервісу
check_service() {
    local name="$1"
    local url="$2"
    local timeout="${3:-5}"
    
    log_debug "Checking $name at $url..."
    
    if curl -s --max-time "$timeout" "$url" > /dev/null 2>&1; then
        log_info "✅ $name - AVAILABLE"
        return 0
    else
        log_warn "⚠️  $name - NOT AVAILABLE"
        return 1
    fi
}

# Перевірка Linux специфічних вимог
check_linux_requirements() {
    log_info "🐧 Checking Linux requirements..."
    
    # Перевірка package manager
    if command -v apt &> /dev/null; then
        log_info "✅ APT package manager - AVAILABLE"
    elif command -v yum &> /dev/null; then
        log_info "✅ YUM package manager - AVAILABLE"
    elif command -v pacman &> /dev/null; then
        log_info "✅ Pacman package manager - AVAILABLE"
    else
        log_warn "⚠️  No recognized package manager found"
    fi
    
    # Перевірка Python 3.11+ (рекомендована версія для ATLAS)
    if command -v python3 &> /dev/null; then
        local python_version=$(python3 --version | cut -d' ' -f2)
        if python3 -c "import sys; exit(0 if sys.version_info >= (3,11) else 1)" 2>/dev/null; then
            log_info "✅ Python ${python_version} - OK (3.11+ compatible)"
        else
            log_warn "⚠️  Python ${python_version} - Рекомендовано 3.11+, але може працювати"
            log_warn "   Розглядьте оновлення: sudo apt install python3.11 python3.11-venv (Ubuntu/Debian)"
            log_warn "   Або: sudo yum install python311 python311-venv (CentOS/RHEL)"
        fi
    else
        log_error "❌ Python 3 required but not found"
        log_error "   Install: sudo apt install python3.11 python3.11-venv python3.11-pip"
        exit 1
    fi
    
    # Перевірка curl
    if command -v curl &> /dev/null; then
        log_info "✅ curl - OK"
    else
        log_error "❌ curl required but not found"
        log_error "   Install: sudo apt install curl"
        exit 1
    fi
    
    # Перевірка pip
    if command -v pip3 &> /dev/null || python3 -m pip --version &> /dev/null; then
        log_info "✅ pip - OK"
    else
        log_warn "⚠️  pip not found"
        log_warn "   Install: sudo apt install python3-pip"
    fi
    
    log_info "✅ Linux requirements check completed"
}

# Перевірка критичних сервісів
check_critical_services() {
    log_info "🔍 Checking critical services..."
    if check_local_ai_api_guard; then
        log_info "✅ Local AI API (port 3010) - CRITICAL SERVICE AVAILABLE"
    else
        log_error "❌ Local AI API (port 3010) - CRITICAL SERVICE MISSING"
        if [ "${ALLOW_NO_LOCAL_AI}" = "1" ]; then
            log_warn "ALLOW_NO_LOCAL_AI=1 -> Продовжуємо в деградованому режимі (обмежені можливості)"
        else
            log_error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            log_error "Local AI API (OpenAI-compatible) повинен працювати на порті 3010"
            log_error "Linux setup examples:"
            log_error "  • Ollama: curl -fsSL https://ollama.ai/install.sh | sh && ollama serve"
            log_error "  • LocalAI: ./local-ai --port 3010"
            log_error "  • Goose (як джерело моделей): побудувати в goose/ (необов'язково)"
            log_error "Встанови ALLOW_NO_LOCAL_AI=1 щоб примусово продовжити без нього."
            exit 1
        fi
    fi
}

# Перевірка опціональних сервісів
check_optional_services() {
    log_info "🔍 Checking optional services..."
    
    # Goose (для реального виконання завдань)
    if check_service "Goose Executor" "http://127.0.0.1:3000/health" 3; then
        log_info "✅ Goose (port 3000) - Real task execution AVAILABLE"
        export ATLAS_GOOSE_AVAILABLE=true
    else
        log_warn "⚠️  Goose (port 3000) - Real task execution LIMITED"
        log_warn "   Tetyana agent will have limited execution capabilities"
        log_warn "   Try building Goose from goose/ directory if available"
        export ATLAS_GOOSE_AVAILABLE=false
    fi
    
    # Ukrainian TTS Server
    if check_service "Ukrainian TTS" "http://127.0.0.1:3001/health" 3; then
        log_info "✅ Ukrainian TTS (port 3001) - Voice synthesis AVAILABLE"
        export ATLAS_TTS_AVAILABLE=true
    else
        log_warn "⚠️  Ukrainian TTS (port 3001) - Voice features DISABLED"
        export ATLAS_TTS_AVAILABLE=false
    fi
    
    log_info "✅ Optional services check completed"
}

# Підготовка середовища
prepare_environment() {
    log_info "🔧 Preparing Python environment..."
    
    # Перехід до intelligent_atlas
    if [ ! -d "intelligent_atlas" ]; then
        log_error "❌ intelligent_atlas directory not found"
        log_error "   Please run this script from the ATLAS root directory"
        exit 1
    fi
    
    cd intelligent_atlas
    
    # Створення venv якщо не існує
    if [ ! -d "venv" ]; then
        log_info "🐍 Creating Python virtual environment..."
        python3 -m venv venv
    fi
    
    # Активація venv
    source venv/bin/activate
    
    # Оновлення pip
    log_info "📦 Updating pip..."
    python -m pip install --upgrade pip --quiet
    
    # Встановлення залежностей
    log_info "📦 Installing/updating dependencies..."
    pip install -r requirements.txt --quiet --upgrade
    
    # Налаштування PYTHONPATH
    export PYTHONPATH="$(pwd):$(pwd)/core:$(pwd)/config:$PYTHONPATH"
    export ATLAS_MODE="intelligent"
    export ATLAS_CONFIG_TYPE="dynamic"
    
    log_info "✅ Environment prepared"
}

# Запуск системи в фоновому режимі
start_intelligent_system() {
    log_intelligent "🧠 Starting ATLAS Pure Intelligent System..."
    
    # Перевірка чи не запущена вже система
    if pgrep -f "intelligent_atlas.*python" > /dev/null; then
        log_warn "⚠️  ATLAS system appears to be already running"
        log_warn "   Use './stop_stack.sh' to stop it first"
        exit 1
    fi
    
    # Створення директорії для логів
    mkdir -p ../logs
    
    # Запуск системи в фоновому режимі
    nohup ./start_intelligent.sh start > ../logs/atlas_intelligent.log 2>&1 &
    local atlas_pid=$!
    
    # Зберігаємо PID для майбутнього використання
    echo $atlas_pid > ../logs/atlas.pid
    
    log_intelligent "🔄 ATLAS system starting (PID: $atlas_pid)..."
    log_intelligent "📄 Logs: logs/atlas_intelligent.log"
    
    # Даємо час системі запуститись
    log_info "⏳ Waiting for system initialization (30 seconds)..."
    sleep 30
    
    # Перевірка чи система запустилась успішно
    if check_service "ATLAS Web Interface" "http://127.0.0.1:5001/api/health" 5; then
        log_intelligent "✅ ATLAS Web Interface is responding"
    else
        log_error "❌ ATLAS Web Interface is not responding"
        log_error "   Check logs/atlas_intelligent.log for details"
        
        # Показуємо останні рядки логу для діагностики
        if [ -f "../logs/atlas_intelligent.log" ]; then
            log_error "Last log entries:"
            tail -10 ../logs/atlas_intelligent.log
        fi
        exit 1
    fi
}

# Показ статусу системи
show_system_status() {
    log_intelligent "📊 ATLAS System Status:"
    echo ""
    
    # ATLAS система
    if check_service "ATLAS Web Interface" "http://127.0.0.1:5001/api/health" 3; then
        log_intelligent "✅ ATLAS Web Interface: http://127.0.0.1:5001"
    else
        log_error "❌ ATLAS Web Interface: Not responding"
    fi
    
    # Зовнішні сервіси
    log_info "External Services:"
    check_service "Local AI API" "http://127.0.0.1:3010/v1/models" 2
    check_service "Goose Executor" "http://127.0.0.1:3000/health" 2
    check_service "Ukrainian TTS" "http://127.0.0.1:3001/health" 2
    
    echo ""
    log_intelligent "🎯 System Information:"
    log_intelligent "   🧠 Pure Intelligence: All decisions via AI API (port 3010)"
    log_intelligent "   🎭 Multi-Agent: Atlas (planner), Tetyana (executor), Grisha (validator)"
    log_intelligent "   🔧 Zero Hardcode: 100% dynamic configuration"
    log_intelligent "   🚀 Super Reliable: Minimal failure points"
    
    if [ "$ATLAS_GOOSE_AVAILABLE" = true ]; then
        log_intelligent "   ⚡ Real Execution: Enabled via Goose"
    else
        log_warn "   ⚡ Real Execution: Limited (Goose unavailable)"
    fi
    
    if [ "$ATLAS_TTS_AVAILABLE" = true ]; then
        log_intelligent "   🗣️  Voice Synthesis: Ukrainian TTS enabled"
    else
        log_warn "   🗣️  Voice Synthesis: Disabled (TTS unavailable)"
    fi
}

# Головна функція
main() {
    echo ""
    log_intelligent "🧠 ATLAS Pure Intelligent System - Linux Startup"
    log_intelligent "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    # Node версія перед усіма діями
    check_node_version || exit 1
    # Швидкий guard (мʼякий) до формальної критичної перевірки
    check_local_ai_api_guard || log_warn "Local AI API недоступний на ранньому етапі (буде повторна критична перевірка)"

    # Перевірки
    check_linux_requirements
    echo ""
    check_critical_services
    echo ""
    check_optional_services
    echo ""
    
    # Підготовка та запуск
    prepare_environment
    echo ""
    start_intelligent_system
    echo ""
    
    # Повернення до кореневої директорії
    cd ..
    
    # Показ статусу
    show_system_status
    echo ""
    
    log_intelligent "🎉 ATLAS Pure Intelligent System is running!"
    log_intelligent ""
    log_intelligent "Access the system:"
    log_intelligent "  🌐 Web Interface: http://127.0.0.1:5001"
    log_intelligent "  📊 Health Check: http://127.0.0.1:5001/api/health"
    log_intelligent "  📄 Logs: tail -f logs/atlas_intelligent.log"
    log_intelligent ""
    log_intelligent "Management:"
    log_intelligent "  🛑 Stop: ./stop_stack.sh"
    log_intelligent "  📈 Status: ./status_stack.sh"
    log_intelligent ""
    log_intelligent "🔥 Ready for intelligent multi-agent operations!"
}

# Запуск
main "$@"