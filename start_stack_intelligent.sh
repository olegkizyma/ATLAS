#!/bin/bash

# ATLAS Intelligent System - Main Entry Point
# start_stack_intelligent.sh - Точка входу для повністю інтелігентної системи ATLAS

set -e

echo "🧠 ATLAS - Pure Intelligent Multi-Agent System"
echo "🚀 Starting Intelligent Stack (Zero Hardcodes, Super Reliability)..."

# Кольори
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

# Налаштування конфігурації Goose: симлінк ~/.config/goose -> <repo>/goose/goose
ensure_goose_config_link() {
    local repo_conf_dir="$(pwd)/goose/goose"
    local user_config_base="$HOME/.config"
    local user_conf_link="$user_config_base/goose"
    
    log_debug "Setting up Goose configuration link..."
    
    # Створення базової директорії, якщо відсутня
    mkdir -p "$user_config_base"
    
    # Перевірка існування директорії конфігурації в репозиторії
    if [ ! -d "$repo_conf_dir" ]; then
        log_error "Goose config directory not found at $repo_conf_dir"
        return 1
    fi
    
    # Створення або оновлення симлінку
    if [ -L "$user_conf_link" ]; then
        # Симлінк існує, перевіряємо, чи він правильний
        local current_target=$(readlink "$user_conf_link")
        if [ "$current_target" != "$repo_conf_dir" ]; then
            log_warn "Updating existing Goose config link"
            rm -f "$user_conf_link"
            ln -s "$repo_conf_dir" "$user_conf_link"
        fi
    elif [ -d "$user_conf_link" ]; then
        # Директорія існує, але не симлінк - робимо резервну копію
        log_warn "Found existing Goose config directory, backing up"
        mv "$user_conf_link" "${user_conf_link}_backup_$(date +%s)"
        ln -s "$repo_conf_dir" "$user_conf_link"
    else
        # Створюємо новий симлінк
        ln -s "$repo_conf_dir" "$user_conf_link"
    fi
    
    log_debug "Goose configuration link set to: $repo_conf_dir"
}

# Пошук виконуваного файлу Goose
resolve_goose_bin() {
    local goose_bin=""
    
    # 1. Перевірка у локальній директорії користувача
    if [ -x "$HOME/.local/bin/goose" ]; then
        goose_bin="$HOME/.local/bin/goose"
    # 2. Перевірка у системних шляхах
    elif command -v goose &> /dev/null; then
        goose_bin=$(command -v goose)
    # 3. Перевірка у директорії репозиторію
    elif [ -x "$(pwd)/goose/target/release/goose" ]; then
        goose_bin="$(pwd)/goose/target/release/goose"
    fi
    
    echo "$goose_bin"
}

# Запуск Ukrainian TTS сервера
start_ukrainian_tts() {
    log_info "🎤 Starting Ukrainian TTS Server..."
    
    # Перевірка чи TTS вже запущений
    if curl -s --max-time 3 "http://127.0.0.1:3001/health" > /dev/null 2>&1 ||
       curl -s --max-time 3 "http://127.0.0.1:3001/voices" > /dev/null 2>&1; then
        log_info "✅ Ukrainian TTS already running on port 3001"
        export ATLAS_TTS_AVAILABLE=true
        return 0
    fi
    
    # Перевірка наявності директорії TTS
    if [ ! -d "ukrainian-tts" ]; then
        log_warn "⚠️  Ukrainian TTS directory not found, continuing without voice features"
        export ATLAS_TTS_AVAILABLE=false
        return 1
    fi
    
    # Перевірка наявності TTS сервера
    if [ ! -f "ukrainian-tts/tts_server.py" ]; then
        log_warn "⚠️  TTS server script not found, continuing without voice features"
        export ATLAS_TTS_AVAILABLE=false
        return 1
    fi
    
    log_info "🚀 Starting Ukrainian TTS Server on port 3001..."
    
    # Створюємо директорію для логів, якщо потрібно
    mkdir -p "logs"
    
    # Перехід в директорію TTS
    cd ukrainian-tts
    
    # Перевірка та активація TTS віртуального середовища
    if [ -d ".venv" ] && [ -f ".venv/bin/activate" ]; then
        log_debug "Activating TTS virtual environment..."
        source .venv/bin/activate
        
        # Перевірка наявності TTS залежностей у venv
        if ! python3 -c "import ukrainian_tts" 2>/dev/null; then
            log_warn "⚠️  Ukrainian TTS dependencies not found in venv, continuing without voice features"
            cd ..
            export ATLAS_TTS_AVAILABLE=false
            return 1
        fi
    else
        # Перевірка наявності TTS залежностей в системі
        if ! python3 -c "import ukrainian_tts" 2>/dev/null; then
            log_warn "⚠️  Ukrainian TTS dependencies not installed, attempting to install..."
            if [ -f "requirements.txt" ]; then
                pip3 install -r requirements.txt --quiet || {
                    log_warn "⚠️  Failed to install TTS dependencies, continuing without voice features"
                    cd ..
                    export ATLAS_TTS_AVAILABLE=false
                    return 1
                }
            else
                log_warn "⚠️  No requirements.txt found for TTS, continuing without voice features"
                cd ..
                export ATLAS_TTS_AVAILABLE=false
                return 1
            fi
        fi
    fi
    
    # Запуск TTS сервера з оптимальними налаштуваннями для macOS
    # Використовуємо MPS (Metal Performance Shaders) для Apple Silicon
    export TTS_DEVICE=${TTS_DEVICE:-mps}
    export TTS_PORT=3001
    
    # Запускаємо TTS сервер у фоні
    python3 tts_server.py --host 127.0.0.1 --port 3001 --device ${TTS_DEVICE} > ../logs/tts.log 2>&1 &
    
    # Зберігаємо PID для керування процесом
    echo $! > ../logs/tts.pid
    log_info "✅ Ukrainian TTS Server started (PID: $(cat ../logs/tts.pid))"
    
    # Повертаємось у початкову директорію
    cd ..
    
    # Даємо час на ініціалізацію TTS
    log_debug "Waiting for TTS to initialize..."
    sleep 8
    
    # Перевіряємо, чи запустився TTS
    if curl -s --max-time 5 "http://127.0.0.1:3001/health" > /dev/null 2>&1 ||
       curl -s --max-time 5 "http://127.0.0.1:3001/voices" > /dev/null 2>&1; then
        log_info "✅ Ukrainian TTS Server is now running"
        export ATLAS_TTS_AVAILABLE=true
        return 0
    else
        log_warn "⚠️  Ukrainian TTS Server failed to start, continuing without voice features"
        export ATLAS_TTS_AVAILABLE=false
        return 1
    fi
}

# Запуск Goose, якщо необхідно
start_goose_if_needed() {
    log_info "🦢 Checking Goose executor service..."
    
    # Перевірка, чи Goose вже запущений
    if curl -s --max-time 3 "http://127.0.0.1:3000/health" > /dev/null 2>&1; then
        log_info "✅ Goose already running on port 3000"
        export ATLAS_GOOSE_AVAILABLE=true
        return 0
    fi
    
    log_info "🦢 Starting Goose Web Interface..."
    
    # Налаштовуємо конфігурацію
    ensure_goose_config_link || {
        log_warn "⚠️  Could not setup Goose configuration, continuing with limited execution capabilities"
        export ATLAS_GOOSE_AVAILABLE=false
        return 1
    }
    
    # Перехід в директорію Goose
    if [ ! -d "goose" ]; then
        log_warn "⚠️  Goose directory not found, continuing with limited execution capabilities"
        export ATLAS_GOOSE_AVAILABLE=false
        return 1
    fi
    
    cd goose
    
    # Знаходимо бінарний файл Goose
    local goose_bin=$(resolve_goose_bin)
    
    # Якщо бінарник не знайдено - намагаємось завантажити або зібрати
    if [ -z "$goose_bin" ]; then
        log_info "🔧 Goose binary not found, attempting to download or build..."
        
        # Спроба 1: Завантажити готовий CLI
        if [ -f "./download_cli.sh" ]; then
            log_debug "Running download_cli.sh to get Goose binary..."
            ./download_cli.sh
            goose_bin=$(resolve_goose_bin)
        fi
        
        # Спроба 2: Зібрати через Cargo, якщо завантаження не вдалося
        if [ -z "$goose_bin" ] && command -v cargo &> /dev/null; then
            log_debug "Building Goose from source with Cargo..."
            cargo build --release --quiet
            goose_bin=$(resolve_goose_bin)
        fi
    fi
    
    # Запуск Goose Web, якщо бінарник знайдено
    if [ -n "$goose_bin" ]; then
        log_info "🚀 Starting Goose Web Interface on port 3000..."
        
        # Створюємо директорію для сесій
        mkdir -p "$HOME/.local/share/goose/sessions"
        
        # Створюємо директорію для логів, якщо потрібно
        mkdir -p "../logs"
        
        # Запускаємо з оптимальними налаштуваннями для ATLAS
        export GOOSE_DISABLE_KEYRING=1
        TMPDIR="$HOME/.local/share/goose/sessions" \
        XDG_CONFIG_HOME=$(pwd) \
        "$goose_bin" web > ../logs/goose.log 2>&1 &
        
        # Зберігаємо PID для керування процесом
        echo $! > ../logs/goose.pid
        log_info "✅ Goose Web Interface started (PID: $(cat ../logs/goose.pid))"
        
        # Повертаємось у початкову директорію
        cd ..
        
        # Даємо час на запуск
        log_debug "Waiting for Goose to initialize..."
        sleep 3
        
        # Перевіряємо, чи запустився Goose
        if curl -s --max-time 3 "http://127.0.0.1:3000/health" > /dev/null 2>&1; then
            log_info "✅ Goose Web Interface is now running"
            export ATLAS_GOOSE_AVAILABLE=true
            return 0
        else
            log_warn "⚠️  Goose Web Interface failed to start, continuing with limited execution capabilities"
            export ATLAS_GOOSE_AVAILABLE=false
            return 1
        fi
    else
        log_warn "⚠️  Could not find or build Goose binary, continuing with limited execution capabilities"
        # Повертаємось у початкову директорію
        cd ..
        export ATLAS_GOOSE_AVAILABLE=false
        return 1
    fi
}

# Перевірка системних вимог
check_requirements() {
    log_info "🍎 Checking macOS requirements..."
    
    # Перевірка наявності основних утиліт
    if command -v brew &> /dev/null; then
        log_info "✅ Homebrew - AVAILABLE"
    else
        log_warn "⚠️  Homebrew not found, some features may be limited"
    fi
    
    # Перевірка Python
    if command -v python3 &> /dev/null; then
        local python_version=$(python3 --version | cut -d' ' -f2)
        log_info "✅ Python $python_version - OK"
    else
        log_error "❌ Python 3 not found"
        exit 1
    fi
    
    # Перевірка curl
    if command -v curl &> /dev/null; then
        log_info "✅ curl - OK"
    else
        log_error "❌ curl not found"
        exit 1
    fi
    
    log_info "✅ macOS requirements check completed"
}

# Перевірка обов'язкових сервісів
check_critical_services() {
    log_info "🔍 Checking critical services..."
    
    # Перевірка локального AI API (критично важливий)
    log_debug "Checking Local AI API at http://127.0.0.1:3010/v1/models..."
    if curl -s --max-time 5 "http://127.0.0.1:3010/v1/models" > /dev/null 2>&1; then
        log_info "✅ Local AI API - AVAILABLE"
        log_info "✅ Local AI API (port 3010) - CRITICAL SERVICE AVAILABLE"
        export ATLAS_AI_AVAILABLE=true
    else
        log_error "❌ Local AI API - NOT AVAILABLE"
        log_error "❌ Local AI API (port 3010) - CRITICAL SERVICE UNAVAILABLE"
        log_error "   Please start your local AI API server (Ollama, LM Studio, etc.)"
        log_error "   Example: ollama serve"
        exit 1
    fi
}

# Перевірка додаткових сервісів  
check_optional_services() {
    log_info "🔍 Checking optional services..."
    
    # TTS сервер (для голосу)
    log_debug "Checking Ukrainian TTS Server (port 3001)..."
    if curl -s --max-time 3 "http://127.0.0.1:3001/health" > /dev/null 2>&1 || 
       curl -s --max-time 3 "http://127.0.0.1:3001/voices" > /dev/null 2>&1; then
        log_info "✅ Ukrainian TTS Server (port 3001) - Voice synthesis available"
        export ATLAS_TTS_AVAILABLE=true
    else
        log_warn "⚠️  Ukrainian TTS Server (port 3001) - Voice features disabled"
        log_warn "   Voice synthesis will be limited"
        export ATLAS_TTS_AVAILABLE=false
    fi
}

# Запуск інтелігентної системи
start_intelligent_atlas() {
    log_info "🧠 Preparing Python environment..."
    
    # Перевіряємо, чи ми в правильній директорії
    if [ ! -d "intelligent_atlas" ]; then
        log_error "❌ intelligent_atlas directory not found!"
        exit 1
    fi
    
    cd intelligent_atlas
    
    # Створюємо віртуальне середовище, якщо його немає
    if [ ! -d "venv" ]; then
        log_info "Creating Python virtual environment..."
        python3 -m venv venv
    fi
    
    # Активуємо віртуальне середовище
    source venv/bin/activate
    
    log_info "📦 Installing/updating dependencies..."
    pip install -r requirements.txt --quiet
    
    log_info "✅ Environment prepared"
    
    log_intelligent "🧠 Starting ATLAS Pure Intelligent System..."
    
    # Запускаємо головний скрипт у фоні
    python core/intelligent_engine.py > ../logs/atlas_intelligent.log 2>&1 &
    local atlas_pid=$!
    echo $atlas_pid > ../logs/atlas_intelligent.pid
    
    log_intelligent "🔄 ATLAS system starting (PID: $atlas_pid)..."
    log_intelligent "📄 Logs: logs/atlas_intelligent.log"
    
    # Повертаємось у початкову директорію
    cd ..
    
    # Даємо час на ініціалізацію
    log_info "⏳ Waiting for system initialization (30 seconds)..."
    sleep 30
    
    # Перевіряємо чи запустилась система
    log_debug "Checking ATLAS Web Interface at http://127.0.0.1:5001/api/health..."
    if curl -s --max-time 5 "http://127.0.0.1:5001/api/health" > /dev/null 2>&1 || 
       curl -s --max-time 5 "http://127.0.0.1:5001/" > /dev/null 2>&1; then
        log_info "✅ ATLAS Web Interface - AVAILABLE"
        log_intelligent "✅ ATLAS Web Interface is responding"
        export ATLAS_WEB_AVAILABLE=true
    else
        log_warn "⚠️  ATLAS Web Interface not responding yet, check logs"
        export ATLAS_WEB_AVAILABLE=false
    fi
}

# Головна функція
main() {
    echo ""
    log_intelligent "🧠 ATLAS Pure Intelligent System Startup"
    log_intelligent "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    # Створюємо директорію для логів
    mkdir -p logs
    
    # Перевірки
    check_requirements
    echo ""
    check_critical_services
    echo ""  
    check_optional_services
    echo ""
    
    # Запуск Goose, якщо він не доступний
    start_goose_if_needed
    echo ""
    
    # Запуск Ukrainian TTS, якщо він не доступний
    start_ukrainian_tts
    echo ""
    
    # Запуск основної системи
    start_intelligent_atlas
    
    # Показуємо фінальний статус
    echo ""
    log_intelligent "📊 ATLAS System Status:"
    echo ""
    
    # Перевіряємо веб-інтерфейс
    log_debug "Checking ATLAS Web Interface at http://127.0.0.1:5001/api/health..."
    if curl -s --max-time 3 "http://127.0.0.1:5001/api/health" > /dev/null 2>&1 || 
       curl -s --max-time 3 "http://127.0.0.1:5001/" > /dev/null 2>&1; then
        log_info "✅ ATLAS Web Interface - AVAILABLE"
        log_intelligent "✅ ATLAS Web Interface: http://127.0.0.1:5001"
    else
        log_warn "⚠️  ATLAS Web Interface - NOT RESPONDING"
    fi
    
    echo "Info: External Services:"
    
    # Перевіряємо AI API
    log_debug "Checking Local AI API at http://127.0.0.1:3010/v1/models..."
    if curl -s --max-time 3 "http://127.0.0.1:3010/v1/models" > /dev/null 2>&1; then
        log_info "✅ Local AI API - AVAILABLE"
    else
        log_warn "⚠️  Local AI API - NOT AVAILABLE"
    fi
    
    # Перевіряємо Goose
    log_debug "Checking Goose Executor at http://127.0.0.1:3000/health..."
    if curl -s --max-time 3 "http://127.0.0.1:3000/health" > /dev/null 2>&1; then
        log_info "✅ Goose Executor - AVAILABLE"
    else
        log_warn "⚠️  Goose Executor - NOT AVAILABLE"
    fi
    
    # Перевіряємо TTS
    log_debug "Checking Ukrainian TTS at http://127.0.0.1:3001/health..."
    if curl -s --max-time 3 "http://127.0.0.1:3001/health" > /dev/null 2>&1; then
        log_info "✅ Ukrainian TTS - AVAILABLE"
    else
        log_warn "⚠️  Ukrainian TTS - NOT AVAILABLE"
    fi
    
    echo ""
    log_intelligent "🚀 ATLAS Pure Intelligent System is ready!"
    log_intelligent "🌐 Access: http://127.0.0.1:5001"
    log_intelligent "📄 Logs: logs/atlas_intelligent.log"
}

# Запуск
main "$@"