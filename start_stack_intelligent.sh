#!/bin/bash

# ATLAS Intelligent Startup Script
# Повністю інтелігентний запуск з адаптивними конфігураціями
# Замінює start_stack_macos.sh з інтелігентними системами

set -e

echo "🧠 ATLAS Intelligent Multi-Agent System"
echo "🚀 Starting Intelligent Stack..."

# Змінні середовища для intelligent режиму
export ATLAS_INTELLIGENT_MODE=true
export ATLAS_AUTO_ADAPT=true
export ATLAS_LEARNING_ENABLED=true

# За замовчуванням: реальний TTS і MPS на macOS (Apple Silicon)
: "${REAL_TTS_MODE:=true}"
: "${TTS_DEVICE:=mps}"

# Whisper STT GPU/Metal (Apple Silicon) — безпечні значення за замовчуванням
export WHISPER_DEVICE=${WHISPER_DEVICE:-auto}
export WHISPER_COMPUTE_TYPE=${WHISPER_COMPUTE_TYPE:-int8}

echo "🎤 TTS Mode: ${REAL_TTS_MODE} (Device: ${TTS_DEVICE})"
echo "🧠 Intelligent Mode: ${ATLAS_INTELLIGENT_MODE}"

# Функція для запуску intelligent configuration migrator
run_intelligent_migration() {
    echo "🔧 Running intelligent configuration migration..."
    cd frontend_new
    
    if [ -f "venv/bin/activate" ]; then
        source venv/bin/activate
    fi
    
    # Запускаємо міграцію конфігурацій
    python config/configuration_migrator.py --target all
    
    if [ $? -eq 0 ]; then
        echo "✅ Intelligent configuration migration completed"
    else
        echo "⚠️  Migration failed, continuing with standard configuration"
    fi
    
    cd ..
}

# Функція для intelligent health check
intelligent_health_check() {
    local service_name=$1
    local url=$2
    local pidfile=$3
    
    if [ -f "$pidfile" ] && ps -p $(cat $pidfile) > /dev/null 2>&1; then
        if curl -s --max-time 3 "$url" > /dev/null 2>&1; then
            echo "✅ $service_name is running and responsive (intelligent mode)"
            
            # Додаткова перевірка intelligent features
            if [ "$service_name" = "Node.js Orchestrator" ]; then
                local intelligence_check=$(curl -s --max-time 2 "$url/health" 2>/dev/null | grep -i "intelligent" || echo "")
                if [ -n "$intelligence_check" ]; then
                    echo "🧠 $service_name: Intelligent features active"
                else
                    echo "⚠️  $service_name: Standard mode (consider enabling intelligent features)"
                fi
            fi
        else
            echo "⚠️  $service_name is running but not responding"
        fi
    else
        echo "❌ $service_name is not running"
    fi
}

# Створення директорії для логів
mkdir -p logs

# 1. Налаштування Python Environment з intelligent системами
echo "🐍 Setting up Python environment with intelligent systems..."
cd frontend_new
if [ -f "venv/bin/activate" ]; then
    echo "🐍 Activating virtual environment..."
    source venv/bin/activate
    echo "✅ Virtual environment activated"
    
    # Перевірка залежностей для intelligent систем
    if ! python -c "import sys; sys.path.append('config'); import intelligent_config" 2>/dev/null; then
        echo "📦 Installing intelligent system dependencies..."
        pip install -r requirements.txt
        echo "✅ Intelligent dependencies installed"
    else
        echo "✅ Intelligent systems already available"
    fi
else
    echo "⚠️  Virtual environment not found, creating one..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    echo "✅ Virtual environment created with intelligent systems"
fi
cd ..

# 2. Запуск intelligent configuration migration
run_intelligent_migration

# 3. Intelligent port management
echo "🔍 Intelligent port management..."

# Функція для intelligent port checking
intelligent_port_check() {
    local port=$1
    local service_name=$2
    
    if lsof -ti:$port > /dev/null 2>&1; then
        local pid=$(lsof -ti:$port)
        local process_name=$(ps -p $pid -o comm= 2>/dev/null || echo "unknown")
        
        echo "ℹ️  Port $port busy by $process_name (PID: $pid)"
        
        # Intelligent decision making
        if echo "$process_name" | grep -qi "$service_name"; then
            echo "✅ $service_name already running on port $port"
            return 0
        elif [ "${ATLAS_AUTO_RESTART:-false}" = "true" ]; then
            echo "🔄 Auto-restarting service on port $port..."
            kill $pid 2>/dev/null || true
            sleep 2
            return 1
        else
            echo "⚠️  Port $port busy by different service"
            return 1
        fi
    else
        echo "✅ Port $port available for $service_name"
        return 0
    fi
}

# Перевірка портів з intelligent logic
intelligent_port_check 3000 "goose"
intelligent_port_check 3001 "tts"
intelligent_port_check 5001 "frontend"
intelligent_port_check 5101 "orchestrator"
intelligent_port_check 5102 "recovery"

# 4. Запуск TTS з intelligent налаштуваннями
if [ "${REAL_TTS_MODE:-true}" = "true" ]; then
    echo "🎤 Starting REAL Ukrainian TTS with intelligent device selection..."
    if ! lsof -ti:3001 > /dev/null 2>&1; then
        (
            cd ukrainian-tts
            # Intelligent TTS device selection
            if [ "$(uname -m)" = "arm64" ]; then
                TTS_DEVICE=${TTS_DEVICE:-mps}  # Apple Silicon
            else
                TTS_DEVICE=${TTS_DEVICE:-cpu}  # Intel
            fi
            
            if [ -f ".venv/bin/activate" ]; then
                source .venv/bin/activate
            elif [ -f "venv/bin/activate" ]; then
                source venv/bin/activate
            fi
            
            python tts_server.py --host 127.0.0.1 --port 3001 --device "$TTS_DEVICE" > ../logs/tts_real.log 2>&1 &
            echo $! > ../logs/tts_real.pid
            echo "✅ REAL TTS started with intelligent device: $TTS_DEVICE (PID: $(cat ../logs/tts_real.pid))"
        )
    fi
else
    echo "🎤 Starting Ukrainian TTS Mock with intelligent fallback..."
    if ! lsof -ti:3001 > /dev/null 2>&1; then
        cd frontend_new
        source venv/bin/activate
        TTS_PORT=3001 python ukrainian_tts_server.py > ../logs/tts_mock.log 2>&1 &
        echo $! > ../logs/tts_mock.pid
        echo "✅ TTS mock started (PID: $(cat ../logs/tts_mock.pid))"
        cd ..
    fi
fi

# 5. Запуск Recovery Bridge (обов'язково для intelligent mode)
echo "🔧 Starting Intelligent Recovery Bridge..."
cd frontend_new
source venv/bin/activate
if ! lsof -ti:5102 > /dev/null 2>&1; then
    python config/recovery_bridge.py > ../logs/recovery_bridge.log 2>&1 &
    echo $! > ../logs/recovery_bridge.pid
    echo "✅ Intelligent Recovery Bridge started (PID: $(cat ../logs/recovery_bridge.pid))"
else
    echo "ℹ️  Recovery Bridge already running"
fi
cd ..

# Очікування ініціалізації Recovery Bridge
sleep 3

# 6. Запуск Intelligent Node.js Orchestrator
echo "🎭 Starting Intelligent Node.js Orchestrator..."
cd frontend_new/orchestrator

# Перевірка Node.js залежностей
if [ ! -d "node_modules" ]; then
    echo "📦 Installing Node.js dependencies..."
    npm install
fi

# Перевірка наявності intelligent wrapper
if [ ! -f "intelligent_server_wrapper.js" ]; then
    echo "⚠️  Intelligent wrapper not found, using standard server"
    node_command="node server.js"
else
    echo "🧠 Using intelligent server wrapper"
    node_command="node intelligent_server_wrapper.js"
fi

# Налаштування intelligent environment
export ORCH_INTELLIGENT_MODE=true
export ORCH_AUTO_ADAPT=true
export ORCH_LEARNING_ENABLED=true
export ORCH_PORT=5101

# Спроба завантажити intelligent конфігурацію
if [ -f ".env.intelligent" ]; then
    echo "🧠 Loading intelligent configuration..."
    # Node.js wrapper автоматично завантажить .env.intelligent
else
    echo "📋 Using standard configuration (intelligent features may be limited)"
fi

# Запуск з intelligent wrapper або стандартного сервера
if ! lsof -ti:5101 > /dev/null 2>&1; then
    $node_command >> ../../logs/orchestrator.log 2>&1 &
    echo $! > ../../logs/orchestrator.pid
    echo "✅ Intelligent orchestrator started (PID: $(cat ../../logs/orchestrator.pid))"
else
    echo "ℹ️  Orchestrator already running"
fi
cd ../..

# 7. Запуск Intelligent Python Frontend
echo "🧠 Starting Intelligent Python Frontend..."
cd frontend_new
source venv/bin/activate

# Налаштування intelligent frontend environment
export ATLAS_INTELLIGENT_MODE=true
export ATLAS_FRONTEND_ADAPTIVE=true
export ATLAS_TTS_URL=${ATLAS_TTS_URL:-http://127.0.0.1:3001/tts}

if ! lsof -ti:5001 > /dev/null 2>&1; then
    python app/atlas_server.py > ../logs/frontend.log 2>&1 &
    echo $! > ../logs/frontend.pid
    echo "✅ Intelligent frontend started (PID: $(cat ../logs/frontend.pid))"
else
    echo "ℹ️  Frontend already running"
fi
cd ..

# 8. Intelligent service health monitoring
echo "⏳ Waiting for intelligent systems to initialize..."
sleep 7

echo "🔍 Running intelligent health checks..."

intelligent_health_check "Python Frontend" "http://localhost:5001" "logs/frontend.pid"
intelligent_health_check "Node.js Orchestrator" "http://localhost:5101/health" "logs/orchestrator.pid"
intelligent_health_check "Recovery Bridge" "ws://localhost:5102" "logs/recovery_bridge.pid"

# Перевірка intelligent features
echo ""
echo "🧠 Intelligent Features Status:"

# Перевірка intelligent config files
if [ -f "frontend_new/orchestrator/.env.intelligent" ]; then
    echo "✅ Intelligent orchestrator configuration: Active"
else
    echo "⚠️  Intelligent orchestrator configuration: Not found (run migration)"
fi

# Перевірка Recovery Bridge connection
if [ -f "logs/recovery_bridge.pid" ] && ps -p $(cat logs/recovery_bridge.pid) > /dev/null 2>&1; then
    echo "✅ Intelligent Recovery System: Active"
else
    echo "❌ Intelligent Recovery System: Failed"
fi

# Перевірка adaptive behavior
if curl -s --max-time 2 "http://localhost:5101/health" 2>/dev/null | grep -qi "intelligent"; then
    echo "✅ Adaptive Orchestrator Behavior: Active"
else
    echo "⚠️  Adaptive Orchestrator Behavior: Standard mode"
fi

echo ""
echo "🎉 ATLAS Intelligent System Startup Complete!"
echo ""
echo "📊 Intelligent Service Dashboard:"
echo "   🧠 Python Frontend:     http://localhost:5001 (with intelligent chat)"
echo "   🎭 Orchestrator API:    http://localhost:5101 (intelligent mode)"
echo "   🔧 Recovery Bridge:     ws://localhost:5102 (adaptive recovery)"
echo "   🎤 TTS API:             http://localhost:3001 (intelligent device selection)"
echo ""
echo "📝 Intelligent Logs:"
echo "   Frontend:        logs/frontend.log"
echo "   Orchestrator:    logs/orchestrator.log"
echo "   Recovery Bridge: logs/recovery_bridge.log"
echo ""
echo "🛠️  Intelligent Management:"
echo "   Stop system:     ./stop_stack.sh"
echo "   View logs:       tail -f logs/*.log"
echo "   Check status:    ./status_stack.sh"
echo "   Run migration:   cd frontend_new && python config/configuration_migrator.py"
echo ""
echo "🧠 ATLAS Intelligent Mode is now active!"
echo "   The system will adaptively optimize performance,"
echo "   learn from failures, and automatically adjust"
echo "   configuration based on usage patterns."
echo ""
echo "💡 Access the intelligent interface at: http://localhost:5001"
