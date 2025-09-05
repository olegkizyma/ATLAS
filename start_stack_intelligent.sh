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

# Перевірка системних вимог
check_requirements() {
    log_info "🔍 Checking system requirements..."
    
    # Python 3.8+
    if ! command -v python3 &> /dev/null; then
        log_error "Python 3 is required but not installed"
        exit 1
    fi
    
    local python_version=$(python3 --version | cut -d' ' -f2 | cut -d'.' -f1-2)
    
    if ! python3 -c "import sys; exit(0 if sys.version_info >= (3,8) else 1)" 2>/dev/null; then
        log_error "Python 3.8+ required, found: $python_version"
        exit 1
    fi
    
    log_info "✅ Python $(python3 --version | cut -d' ' -f2) - OK"
    
    # Curl для перевірки сервісів
    if ! command -v curl &> /dev/null; then
        log_error "curl is required but not installed"
        exit 1
    fi
    
    log_info "✅ System requirements met"
}

# Перевірка обов'язкових сервісів
check_critical_services() {
    log_info "🔍 Checking critical services..."
    
    local critical_failed=false
    
    # 1. Локальне AI API (ОБОВ'ЯЗКОВЕ)
    log_debug "Checking Local AI API (port 3010)..."
    if curl -s --max-time 5 "http://127.0.0.1:3010/v1/models" > /dev/null 2>&1; then
        log_info "✅ Local AI API (port 3010) - AVAILABLE"
    else
        log_error "❌ Local AI API (port 3010) - NOT AVAILABLE"
        log_error "   This is a CRITICAL SERVICE required for intelligent operation"
        critical_failed=true
    fi
    
    if [ "$critical_failed" = true ]; then
        log_error ""
        log_error "CRITICAL SERVICE MISSING:"
        log_error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        log_error "Local AI API (OpenAI-compatible) must be running on port 3010"
        log_error ""
        log_error "Examples:"
        log_error "  • Ollama: ollama serve"
        log_error "  • LM Studio: Start local server on port 3010"
        log_error "  • LocalAI: ./local-ai --port 3010"
        log_error "  • vLLM: vllm serve --port 3010"
        log_error ""
        log_error "ATLAS cannot operate without local AI API."
        exit 1
    fi
}

# Перевірка додаткових сервісів  
check_optional_services() {
    log_info "🔍 Checking optional services..."
    
    # Goose (для реального виконання)
    log_debug "Checking Goose (port 3000)..."
    if curl -s --max-time 3 "http://127.0.0.1:3000/health" > /dev/null 2>&1; then
        log_info "✅ Goose (port 3000) - Task execution available"
        export ATLAS_GOOSE_AVAILABLE=true
    else
        log_warn "⚠️  Goose (port 3000) - Task execution limited"
        log_warn "   Real task execution via Tetyana will be unavailable"
        export ATLAS_GOOSE_AVAILABLE=false
    fi
    
    # TTS сервер (для голосу)
    log_debug "Checking TTS Server (port 3001)..."
    if curl -s --max-time 3 "http://127.0.0.1:3001/health" > /dev/null 2>&1 || 
       curl -s --max-time 3 "http://127.0.0.1:3001/voices" > /dev/null 2>&1; then
        log_info "✅ TTS Server (port 3001) - Voice synthesis available"
        export ATLAS_TTS_AVAILABLE=true
    else
        log_warn "⚠️  TTS Server (port 3001) - Voice features disabled"
        export ATLAS_TTS_AVAILABLE=false
    fi
}

# Запуск інтелігентної системи
start_intelligent_atlas() {
    log_intelligent "🚀 Starting ATLAS Pure Intelligent System..."
    
    # Перехід до intelligent_atlas
    if [ ! -d "intelligent_atlas" ]; then
        log_error "❌ intelligent_atlas directory not found"
        log_error "   Please run this script from the ATLAS root directory"
        exit 1
    fi
    
    cd intelligent_atlas
    
    # Створення та активація venv
    if [ ! -d "venv" ]; then
        log_info "🐍 Creating Python virtual environment..."
        python3 -m venv venv
    fi
    
    source venv/bin/activate
    
    # Встановлення залежностей
    log_info "📦 Installing dependencies..."
    pip install -r requirements.txt --quiet --upgrade
    
    # Налаштування середовища
    export PYTHONPATH="$(pwd):$(pwd)/core:$(pwd)/config:$PYTHONPATH"
    export ATLAS_MODE="intelligent"
    
    # Запуск системи
    log_intelligent "🧠 Launching intelligent system..."
    ./start_intelligent.sh start
}

# Головна функція
main() {
    echo ""
    log_intelligent "🧠 ATLAS Pure Intelligent System Startup"
    log_intelligent "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    # Перевірки
    check_requirements
    echo ""
    check_critical_services
    echo ""  
    check_optional_services
    echo ""
    
    # Запуск
    start_intelligent_atlas
}

# Запуск
main "$@"
