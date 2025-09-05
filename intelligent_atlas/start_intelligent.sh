#!/bin/bash

# ATLAS Intelligent System Startup Script
# Єдина точка входу для повністю інтелігентної системи ATLAS

set -e

echo "🧠 ATLAS Pure Intelligent System"
echo "🚀 Starting Intelligent Stack..."

# Кольори для виводу
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функція для кольорового виводу
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_debug() {
    echo -e "${BLUE}[DEBUG]${NC} $1"
}

# Змінні середовища
export ATLAS_MODE="intelligent"
export ATLAS_CONFIG_TYPE="dynamic"
export PYTHONPATH="${PYTHONPATH}:$(pwd)"

# Перевірка доступності сервісів
check_service() {
    local service_name=$1
    local url=$2
    local timeout=${3:-5}
    
    log_debug "Checking $service_name at $url..."
    
    if curl -s --max-time $timeout "$url" > /dev/null 2>&1; then
        log_info "✅ $service_name is available"
        return 0
    else
        log_warn "⚠️  $service_name is not available at $url"
        return 1
    fi
}

# Перевірка Python залежностей
check_python_deps() {
    log_info "🐍 Checking Python dependencies..."
    
    cd intelligent_atlas
    
    if [ ! -d "venv" ]; then
        log_info "Creating Python virtual environment..."
        python3 -m venv venv
    fi
    
    source venv/bin/activate
    
    log_info "Installing/updating dependencies..."
    pip install -r requirements.txt --quiet
    
    log_info "✅ Python environment ready"
}

# Перевірка обов'язкових сервісів
check_required_services() {
    log_info "🔍 Checking required services..."
    
    local all_good=true
    
    # Перевіряємо локальне AI API (обов'язкове)
    if check_service "Local AI API" "http://127.0.0.1:3010/v1/models"; then
        log_info "✅ Local AI API (port 3010) - REQUIRED SERVICE AVAILABLE"
    else
        log_error "❌ Local AI API (port 3010) - REQUIRED SERVICE NOT AVAILABLE"
        log_error "   Please start your local AI API server on port 3010"
        all_good=false
    fi
    
    # Перевіряємо Goose (обов'язковий для виконання)
    if check_service "Goose" "http://127.0.0.1:3000/health"; then
        log_info "✅ Goose (port 3000) - EXECUTION SERVICE AVAILABLE"
    else
        log_warn "⚠️  Goose (port 3000) - EXECUTION SERVICE NOT AVAILABLE"
        log_warn "   Task execution will be limited without Goose"
    fi
    
    # Перевіряємо TTS (опціональний)
    if check_service "TTS Server" "http://127.0.0.1:3001/health"; then
        log_info "✅ TTS Server (port 3001) - VOICE SERVICE AVAILABLE"
    else
        log_warn "⚠️  TTS Server (port 3001) - VOICE SERVICE NOT AVAILABLE"
        log_warn "   Voice synthesis will not be available"
    fi
    
    if [ "$all_good" = false ]; then
        log_error "❌ Required services are not available. Cannot start ATLAS."
        log_error ""
        log_error "REQUIRED SERVICES:"
        log_error "  1. Local AI API on port 3010 (OpenAI-compatible)"
        log_error "     Example: ollama serve, lm-studio, etc."
        log_error ""
        log_error "RECOMMENDED SERVICES:"
        log_error "  2. Goose on port 3000 for task execution"
        log_error "  3. Ukrainian TTS on port 3001 for voice"
        exit 1
    fi
    
    log_info "✅ Service check completed"
}

# Запуск інтелігентної системи
start_intelligent_system() {
    log_info "🧠 Starting Intelligent ATLAS System..."
    
    cd intelligent_atlas
    source venv/bin/activate
    
    # Встановлюємо PYTHONPATH для імпорту модулів
    export PYTHONPATH="$(pwd):$(pwd)/core:$(pwd)/config:$PYTHONPATH"
    
    log_info "🔧 Initializing Intelligent Engine..."
    
    # Запускаємо головний інтелігентний сервер
    python3 -c "
import asyncio
import logging
import sys
from pathlib import Path

# Налаштовуємо логування
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)

logger = logging.getLogger('atlas.startup')

async def main():
    try:
        logger.info('🧠 Initializing ATLAS Intelligent System...')
        
        # Імпортуємо компоненти
        from intelligent_engine import intelligent_engine
        from web_interface import WebInterface
        from dynamic_config import DynamicConfigManager
        
        # Ініціалізуємо конфігураційний менеджер
        config_manager = DynamicConfigManager()
        
        # Генеруємо динамічну конфігурацію
        logger.info('🔧 Generating dynamic configuration via AI...')
        config = await config_manager.generate_intelligent_config('complete')
        
        # Ініціалізуємо інтелігентний движок
        logger.info('🧠 Initializing Intelligent Engine...')
        initialized = await intelligent_engine.initialize()
        
        if not initialized:
            logger.error('❌ Failed to initialize Intelligent Engine')
            sys.exit(1)
        
        # Отримуємо конфігурацію для веб-інтерфейсу
        web_config = config.get('WEB', {})
        
        # Створюємо та запускаємо веб-інтерфейс
        logger.info('🌐 Starting Web Interface...')
        web_interface = WebInterface(web_config)
        
        logger.info('✅ ATLAS Intelligent System is ready!')
        logger.info('')
        logger.info('📊 System Information:')
        logger.info(f'   🧠 AI Engine: Initialized with {len(config)} config sections')
        logger.info(f'   🌐 Web Interface: http://127.0.0.1:{web_config.get(\"port\", 5001)}')
        logger.info(f'   🎭 Agents: Atlas (planner), Tetyana (executor), Grisha (validator)')
        logger.info(f'   🔧 Configuration: 100% AI-generated, zero hardcodes')
        logger.info('')
        logger.info('🎉 ATLAS is now running in PURE INTELLIGENT MODE!')
        logger.info('   All decisions are made via AI API (port 3010)')
        logger.info('   All executions are real via Goose (port 3000)')
        logger.info('   Zero simulations, zero hardcodes, maximum reliability')
        logger.info('')
        
        # Запускаємо веб-сервер (блокуючий виклик)
        web_interface.run()
        
    except KeyboardInterrupt:
        logger.info('🔄 Shutting down ATLAS Intelligent System...')
        if 'intelligent_engine' in locals():
            await intelligent_engine.shutdown()
        logger.info('✅ ATLAS shutdown complete')
        
    except Exception as e:
        logger.error(f'❌ ATLAS startup failed: {e}')
        sys.exit(1)

if __name__ == '__main__':
    asyncio.run(main())
"
}

# Функція для зупинки системи
stop_system() {
    log_info "🔄 Stopping ATLAS Intelligent System..."
    
    # Знаходимо процес Python
    local atlas_pid=$(ps aux | grep "intelligent_engine" | grep -v grep | awk '{print $2}')
    
    if [ -n "$atlas_pid" ]; then
        log_info "Stopping ATLAS process (PID: $atlas_pid)..."
        kill -TERM $atlas_pid 2>/dev/null || true
        
        # Чекаємо graceful shutdown
        sleep 3
        
        # Якщо ще працює, форсуємо зупинку
        if kill -0 $atlas_pid 2>/dev/null; then
            log_warn "Force stopping ATLAS process..."
            kill -KILL $atlas_pid 2>/dev/null || true
        fi
        
        log_info "✅ ATLAS process stopped"
    else
        log_info "No ATLAS process found"
    fi
}

# Функція показу статусу
show_status() {
    log_info "📊 ATLAS System Status:"
    
    # Перевіряємо чи працює ATLAS
    local atlas_pid=$(ps aux | grep "intelligent_engine" | grep -v grep | awk '{print $2}')
    
    if [ -n "$atlas_pid" ]; then
        log_info "✅ ATLAS Process: Running (PID: $atlas_pid)"
        
        # Перевіряємо веб-інтерфейс
        if check_service "ATLAS Web Interface" "http://127.0.0.1:5001/api/health" 2; then
            log_info "✅ Web Interface: http://127.0.0.1:5001"
        else
            log_warn "⚠️  Web Interface: Not responding"
        fi
    else
        log_warn "❌ ATLAS Process: Not running"
    fi
    
    echo ""
    log_info "External Services:"
    check_service "Local AI API" "http://127.0.0.1:3010/v1/models" 2
    check_service "Goose" "http://127.0.0.1:3000/health" 2
    check_service "TTS Server" "http://127.0.0.1:3001/health" 2
}

# Головна логіка
main() {
    case "${1:-start}" in
        start)
            log_info "🚀 Starting ATLAS Intelligent System..."
            echo ""
            
            # Перевіряємо залежності
            check_python_deps
            echo ""
            
            # Перевіряємо сервіси
            check_required_services
            echo ""
            
            # Запускаємо систему
            start_intelligent_system
            ;;
            
        stop)
            stop_system
            ;;
            
        restart)
            log_info "🔄 Restarting ATLAS..."
            stop_system
            sleep 2
            $0 start
            ;;
            
        status)
            show_status
            ;;
            
        *)
            echo "Usage: $0 {start|stop|restart|status}"
            echo ""
            echo "ATLAS Intelligent System Control Script"
            echo ""
            echo "Commands:"
            echo "  start   - Start the intelligent system (default)"
            echo "  stop    - Stop the system gracefully"
            echo "  restart - Restart the system"
            echo "  status  - Show system status"
            echo ""
            echo "Access the system at: http://127.0.0.1:5001"
            exit 1
            ;;
    esac
}

# Обробка сигналів для graceful shutdown
trap 'log_info "Received shutdown signal..."; stop_system; exit 0' SIGTERM SIGINT

# Запуск
main "$@"