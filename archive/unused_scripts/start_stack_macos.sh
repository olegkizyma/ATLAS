#!/bin/bash

# ATLAS Pure Intelligent System - macOS Stack Startup
# Запуск всієї системи ATLAS на macOS

set -e

echo "🧠 ATLAS Pure Intelligent System - macOS"
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

# --- Added runtime guards (Node version + Local AI API) ---
REQUIRED_NODE_MIN=22
REQUIRED_NODE_MAX=22

check_node_version() {
    if [ "${SKIP_NODE_CHECK}" = "1" ]; then
        log_warn "Skipping Node version check (SKIP_NODE_CHECK=1)"; return 0; fi
    if ! command -v node >/dev/null 2>&1; then
        log_error "Node.js не знайдено. Встанови nvm та виконай: nvm install 22.17.1"; return 1; fi
    local ver major
    ver="$(node -v 2>/dev/null || echo v0.0.0)"; major="${ver#v}"; major="${major%%.*}"
    if [ "$major" -lt "$REQUIRED_NODE_MIN" ] || [ "$major" -gt "$REQUIRED_NODE_MAX" ]; then
        log_warn "Поточна Node версія $ver не у діапазоні ${REQUIRED_NODE_MIN}.x (<23). Спробую nvm .nvmrc...";
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

check_local_ai_api() {
    if curl -s --max-time 3 http://127.0.0.1:3010/v1/models >/dev/null 2>&1; then
        log_info "✔ Local AI API (3010) доступний"; return 0; fi
    log_warn "⚠️ Local AI API (3010) недоступний – Atlas LLM маршрути можуть деградувати";
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

# Перевірка macOS специфічних вимог
check_macos_requirements() {
    log_info "🍎 Checking macOS requirements..."
    
    # Перевірка Homebrew (рекомендовано)
    if command -v brew &> /dev/null; then
        log_info "✅ Homebrew - AVAILABLE"
    else
        log_warn "⚠️  Homebrew not found - install recommended: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    fi
    
    # Перевірка Python 3.11+ (рекомендована версія для ATLAS)
    if command -v python3 &> /dev/null; then
        local python_version=$(python3 --version | cut -d' ' -f2)
        local major_minor=$(echo "$python_version" | cut -d'.' -f1,2)
        if [[ $(echo "$major_minor >= 3.11" | bc -l 2>/dev/null || echo 0) -eq 1 ]] || [[ "$major_minor" == "3.11" ]] || [[ "$major_minor" > "3.11" ]]; then
            log_info "✅ Python ${python_version} - OK (3.11+ compatible)"
        else
            log_warn "⚠️  Python ${python_version} - Рекомендовано 3.11+, але може працювати"
        fi
    else
        log_error "❌ Python 3 required but not found"
        log_error "   Install: brew install python@3.11"
        exit 1
    fi
    
    # Перевірка curl
    if command -v curl &> /dev/null; then
        log_info "✅ curl - OK"
    else
        log_error "❌ curl required but not found"
        exit 1
    fi
    
    log_info "✅ macOS requirements check completed"
}

# Перевірка критичних сервісів
check_critical_services() {
    log_info "🔍 Checking critical services..."
    
    local critical_failed=false
    
    # Local AI API (КРИТИЧНО ВАЖЛИВИЙ)
    if check_service "Local AI API" "http://127.0.0.1:3010/v1/models" 3; then
        log_info "✅ Local AI API (port 3010) - CRITICAL SERVICE AVAILABLE"
    else
        log_error "❌ Local AI API (port 3010) - CRITICAL SERVICE MISSING"
        log_error "   This service is REQUIRED for ATLAS intelligent operation"
        critical_failed=true
    fi
    
    if [ "$critical_failed" = true ]; then
        log_error ""
        log_error "CRITICAL SERVICE MISSING:"
        log_error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        log_error "Local AI API (OpenAI-compatible) must be running on port 3010"
        log_error ""
        log_error "macOS setup examples:"
        log_error "  • Ollama: 'brew install ollama && ollama serve'"
        log_error "  • LM Studio: Download and start local server on port 3010"
        log_error "  • LocalAI: './local-ai --port 3010'"
        log_error ""
        log_error "ATLAS cannot operate without local AI API."
        exit 1
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
#############################################
# LEGACY (frontend_new) MODE SUPPORT
#############################################

prepare_legacy_environment() {
    log_info "🔧 Preparing legacy (frontend_new) environment..."
    if [ ! -d "frontend_new" ]; then
        log_error "❌ frontend_new directory not found"
        exit 1
    fi
    cd frontend_new
    if [ ! -d "venv" ]; then
        log_info "🐍 Creating Python virtual environment (legacy)..."
        python3 -m venv venv
    fi
    source venv/bin/activate
    log_info "📦 Installing/updating Python deps (legacy)..."
    pip install -r requirements.txt --quiet --upgrade
    cd ..
}

start_legacy_system() {
    log_intelligent "🧠 Starting ATLAS Legacy Stack (frontend_new + orchestrator) ..."
    local ROOT_DIR="$(pwd)"
    local LOG_DIR="$ROOT_DIR/logs"
    mkdir -p "$LOG_DIR"

    # Start orchestrator (Node.js)
    if pgrep -f "frontend_new/orchestrator/server.js" > /dev/null; then
        log_warn "⚠️  Orchestrator already running"
    else
        (cd frontend_new/orchestrator && \
            if [ ! -d node_modules ]; then npm install --quiet; fi && \
            LOG_DIR="$LOG_DIR" nohup node server.js > "$LOG_DIR/orchestrator.log" 2>&1 & echo $! > "$LOG_DIR/orchestrator.pid")
        if [ -f "$LOG_DIR/orchestrator.pid" ]; then
            log_info "🚀 Orchestrator started (PID: $(cat "$LOG_DIR/orchestrator.pid"))"
        else
            log_warn "⚠️  Orchestrator PID file not found"
        fi
    fi

    # Start Flask frontend
    if pgrep -f "frontend_new/app/atlas_server.py" > /dev/null; then
        log_warn "⚠️  Legacy Flask already running"
    else
        (cd frontend_new && source venv/bin/activate && \
            LOG_DIR="$LOG_DIR" nohup python app/atlas_server.py > "$LOG_DIR/frontend.log" 2>&1 & echo $! > "$LOG_DIR/frontend.pid")
        if [ -f "$LOG_DIR/frontend.pid" ]; then
            log_info "🚀 Legacy frontend started (PID: $(cat "$LOG_DIR/frontend.pid"))"
        else
            log_warn "⚠️  Legacy frontend PID file not found"
        fi
    fi

    # Wait for health
    log_info "⏳ Waiting for legacy health (10s)..."
    for i in $(seq 1 10); do
        if curl -s http://127.0.0.1:5001/api/health > /dev/null 2>&1; then
            log_intelligent "✅ Legacy Web Interface is responding"
            break
        fi
        sleep 1
    done
}

show_legacy_status() {
    log_intelligent "📊 ATLAS Legacy Stack Status:"
    check_service "Legacy Web" "http://127.0.0.1:5001/api/health" 2 || true
    check_service "Orchestrator" "http://127.0.0.1:5101/health" 2 || true
    check_service "Goose Executor" "http://127.0.0.1:3000/health" 2 || true
}

main() {
    MODE_ARG="${1:-}"
    # Allow MODE env var override; precedence: argument > MODE > default(intelligent)
    if [ -n "$MODE_ARG" ]; then
        MODE="$MODE_ARG"
    else
        MODE="${MODE:-intelligent}"
    fi

    echo ""
    log_intelligent "🧠 ATLAS Pure Intelligent System - macOS Startup (mode=$MODE)"
    log_intelligent "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    case "$MODE" in
        legacy)
            check_node_version || exit 1
            check_local_ai_api || { log_warn "Продовжуємо без Local AI API"; [ "${ALLOW_NO_LOCAL_AI}" = "1" ] || exit 1; }
            check_macos_requirements; echo "";
            # Optional services just for awareness
            check_optional_services; echo "";
            prepare_legacy_environment; echo "";
            start_legacy_system; echo "";
            show_legacy_status; echo "";
            log_intelligent "🎉 ATLAS Legacy Stack is running!"
            log_intelligent "  🌐 Web: http://127.0.0.1:5001"
            log_intelligent "  🤖 Orchestrator: http://127.0.0.1:5101"
            log_intelligent "  🛑 Stop: ./stop_stack.sh"
            ;;
        intelligent|*)
            check_node_version || exit 1
            check_local_ai_api || { log_warn "Продовжуємо без Local AI API"; [ "${ALLOW_NO_LOCAL_AI}" = "1" ] || exit 1; }
            # Перевірки
            check_macos_requirements; echo "";
            check_critical_services; echo "";
            check_optional_services; echo "";
            # Підготовка та запуск
            prepare_environment; echo "";
            start_intelligent_system; echo "";
            cd ..; # повертаємося з intelligent_atlas
            show_system_status; echo "";
            log_intelligent "🎉 ATLAS Pure Intelligent System is running!";
            log_intelligent "  🌐 Web Interface: http://127.0.0.1:5001";
            log_intelligent "  📊 Health Check: http://127.0.0.1:5001/api/health";
            log_intelligent "  📄 Logs: tail -f logs/atlas_intelligent.log";
            log_intelligent "  🛑 Stop: ./stop_stack.sh";
            ;;
    esac

    echo ""
    log_intelligent "Usage examples:"
    log_intelligent "  MODE=legacy ./start_stack_macos.sh  # legacy stack"
    log_intelligent "  ./start_stack_macos.sh intelligent   # intelligent (default)"
}

# Запуск
main "$@"