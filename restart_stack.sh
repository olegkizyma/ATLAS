#!/bin/bash

# ATLAS System Restart Script
# Універсальний скрипт для перезапуску всієї системи ATLAS

set -e

echo "🔄 ATLAS System Restart"
echo "🛑 Stopping all services..."

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
log_restart() { echo -e "${CYAN}[RESTART]${NC} $1"; }

# Repository root and unified logs directory (repo-local)
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${LOG_DIR:-$REPO_ROOT/logs}"

# Required Node.js major version range (aligned with orchestrator /.nvmrc)
REQUIRED_NODE_MIN=22
REQUIRED_NODE_MAX=22 # inclusive for major; reject >=23

check_node_version() {
    if [ "${SKIP_NODE_CHECK}" = "1" ]; then
        log_warn "Node version check skipped via SKIP_NODE_CHECK=1"
        return 0
    fi
    if ! command -v node >/dev/null 2>&1; then
        log_error "Node.js не знайдено. Встанови nvm та виконай: nvm install 22.17.1"
        return 1
    fi
    local ver full major
    ver="$(node -v 2>/dev/null || echo v0.0.0)"
    full="${ver#v}"
    major="${full%%.*}"
    if [ "$major" -lt "$REQUIRED_NODE_MIN" ] || [ "$major" -gt "$REQUIRED_NODE_MAX" ]; then
        log_warn "Поточна Node версія $ver (major=$major) не у підтримуваному діапазоні ${REQUIRED_NODE_MIN}.x (очікується <23).";
        # Спроба автоматично активувати nvm та прочитати .nvmrc
        if command -v nvm >/dev/null 2>&1; then
            if [ -f "$REPO_ROOT/frontend_new/orchestrator/.nvmrc" ]; then
                local target
                target="$(cat "$REPO_ROOT/frontend_new/orchestrator/.nvmrc" | tr -d '\r' | head -n1)"
                log_info "Спроба перемкнутися на Node $target через nvm..."
                nvm install "$target" >/dev/null 2>&1 || true
                nvm use "$target" >/dev/null 2>&1 || true
                ver="$(node -v 2>/dev/null || echo v0.0.0)"; full="${ver#v}"; major="${full%%.*}";
            fi
        else
            # Спроба завантаження nvm якщо директорія існує
            if [ -s "$HOME/.nvm/nvm.sh" ]; then
                # shellcheck disable=SC1090
                . "$HOME/.nvm/nvm.sh"
                if [ -f "$REPO_ROOT/frontend_new/orchestrator/.nvmrc" ]; then
                    local target
                    target="$(cat "$REPO_ROOT/frontend_new/orchestrator/.nvmrc" | tr -d '\r' | head -n1)"
                    log_info "Спроба перемкнутися на Node $target через nvm (autoload)..."
                    nvm install "$target" >/dev/null 2>&1 || true
                    nvm use "$target" >/dev/null 2>&1 || true
                    ver="$(node -v 2>/dev/null || echo v0.0.0)"; full="${ver#v}"; major="${full%%.*}";
                fi
            fi
        fi
    fi
    if [ "$major" -lt "$REQUIRED_NODE_MIN" ] || [ "$major" -gt 22 ]; then
        log_error "Несумісна Node версія після спроби виправлення: $ver. Використай nvm install 22.17.1 && nvm use 22.17.1"
        return 1
    fi
    log_info "✔ Node.js версія $ver відповідає вимогам"
}

check_local_ai_api() {
    if curl -s --max-time 3 "http://127.0.0.1:3010/v1/models" >/dev/null 2>&1; then
        log_info "✔ Local AI API (3010) доступний"
        return 0
    fi
    log_error "❌ Local AI API (порт 3010) недоступний — orchestrator працюватиме некоректно (LLM маршрути)."
    log_warn  "Запусти локальний OpenAI-сумісний сервіс (наприклад, lm studio / localai / ollama proxy на 3010)."
    if [ "${ALLOW_NO_LOCAL_AI}" = "1" ]; then
        log_warn "ALLOW_NO_LOCAL_AI=1 -> продовжуємо попри відсутність сервісу."
        return 0
    fi
    return 1
}

# Graceful stop процесу
graceful_stop() {
    local pid=$1
    local name="$2"
    local timeout="${3:-10}"
    
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        return 0
    fi
    
    log_info "🔄 Stopping $name (PID: $pid)..."
    
    # Graceful shutdown
    kill -TERM "$pid" 2>/dev/null || true
    
    # Чекаємо graceful shutdown
    local count=0
    while [ $count -lt $timeout ] && kill -0 "$pid" 2>/dev/null; do
        sleep 1
        count=$((count + 1))
    done
    
    # Force kill якщо потрібно
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

# Зупинка всіх ATLAS процесів
stop_all_services() {
    log_restart "🛑 Stopping all ATLAS services..."
    
    # Flask frontend (port 5001)
    local flask_pids=$(lsof -ti:5001 2>/dev/null || echo "")
    if [ -n "$flask_pids" ]; then
        for pid in $flask_pids; do
            graceful_stop "$pid" "Flask Frontend (port 5001)" 5
        done
    fi
    
    # Node.js orchestrator (port 5101)
    local node_pids=$(lsof -ti:5101 2>/dev/null || echo "")
    if [ -n "$node_pids" ]; then
        for pid in $node_pids; do
            graceful_stop "$pid" "Node.js Orchestrator (port 5101)" 5
        done
    fi
    
    # Recovery bridge WS (5102) + HTTP health (5103)
    local bridge_ws_pids=$(lsof -ti:5102 2>/dev/null || echo "")
    if [ -n "$bridge_ws_pids" ]; then
        for pid in $bridge_ws_pids; do
            graceful_stop "$pid" "Recovery Bridge WS (port 5102)" 5
        done
    fi
    local bridge_http_pids=$(lsof -ti:5103 2>/dev/null || echo "")
    if [ -n "$bridge_http_pids" ]; then
        for pid in $bridge_http_pids; do
            graceful_stop "$pid" "Recovery Bridge HTTP (port 5103)" 5
        done
    fi
    
    # ATLAS specific processes
    local atlas_pids=$(pgrep -f "atlas_server.py\|intelligent_atlas" 2>/dev/null || echo "")
    if [ -n "$atlas_pids" ]; then
        for pid in $atlas_pids; do
            graceful_stop "$pid" "ATLAS Process" 10
        done
    fi
    
    # Stop Goose and TTS if they were started by ATLAS
    local goose_pids=$(lsof -ti:3000 2>/dev/null || echo "")
    if [ -n "$goose_pids" ]; then
        for pid in $goose_pids; do
            graceful_stop "$pid" "Goose (port 3000)" 10
        done
    fi
    
    local tts_pids=$(lsof -ti:3001 2>/dev/null || echo "")
    if [ -n "$tts_pids" ]; then
        for pid in $tts_pids; do
            graceful_stop "$pid" "Ukrainian TTS (port 3001)" 5
        done
    fi
    
    # Cleanup PID files
    rm -f "$LOG_DIR/atlas.pid" "$LOG_DIR/frontend.pid" "$LOG_DIR/orchestrator.pid" 2>/dev/null || true
    rm -f "$LOG_DIR/goose.pid" "$LOG_DIR/tts.pid" "$LOG_DIR/recovery_bridge.pid" 2>/dev/null || true
    
    log_restart "✅ All services stopped"
}

# Запуск системи
start_services() {
    log_restart "🚀 Starting ATLAS services..."
    # Перевірки перед стартом
    check_node_version || { log_error "Node version check failed"; return 1; }
    check_local_ai_api || { log_error "Local AI API check failed"; return 1; }
    
    # Створюємо директорію логів (repo-local)
    mkdir -p "$LOG_DIR"
    
    # Перевіряємо наявність Python віртуального середовища
    if [ ! -d "frontend_new/venv" ]; then
        log_info "📦 Creating Python virtual environment..."
        cd frontend_new
        python3 -m venv venv
        source venv/bin/activate
        pip install -r requirements.txt
        cd ..
    fi
    
    # Перевіряємо Node.js залежності
    if [ ! -d "frontend_new/orchestrator/node_modules" ]; then
        log_info "📦 Installing Node.js dependencies..."
        cd frontend_new/orchestrator
        npm install
        cd ../..
    fi
    
    # Запускаємо Flask frontend
    log_info "🐍 Starting Flask frontend (port 5001)..."
    cd frontend_new
    source venv/bin/activate
    nohup python app/atlas_server.py > "$LOG_DIR/frontend.log" 2>&1 &
    echo $! > "$LOG_DIR/frontend.pid"
    cd ..
    
    # Даємо час Flask запуститися
    sleep 3
    
    # Запускаємо Node.js orchestrator
    log_info "🟢 Starting Node.js orchestrator (port 5101)..."
    cd frontend_new/orchestrator
    nohup node server.js > "$LOG_DIR/orchestrator.log" 2>&1 &
    echo $! > "$LOG_DIR/orchestrator.pid"
    cd ../..
    
    # Даємо час orchestrator запуститися
    sleep 2
    
    # Запускаємо recovery bridge (canonical path) через venv python якщо доступний
    log_info "🌉 Starting recovery bridge (port 5102)..."
    if [ -f "$REPO_ROOT/frontend_new/config/recovery_bridge.py" ]; then
        RB_DIR="$REPO_ROOT/frontend_new/config"
        VENV_PY="$REPO_ROOT/frontend_new/venv/bin/python"
        PY_CMD="python"
        if [ -x "$VENV_PY" ]; then PY_CMD="$VENV_PY"; fi
        log_info "Using interpreter: $PY_CMD"
        (cd "$RB_DIR" && nohup "$PY_CMD" recovery_bridge.py > "$LOG_DIR/recovery_bridge.log" 2>&1 & echo $! > "$LOG_DIR/recovery_bridge.pid")
        # Очікуємо прослуховування порта
        for i in 1 2 3 4 5 6 7 8 9 10; do
            if lsof -tiTCP:5102 -sTCP:LISTEN >/dev/null 2>&1; then
                log_info "Recovery bridge listening on 5102"
                break
            fi
            sleep 1
        done
        if ! lsof -tiTCP:5102 -sTCP:LISTEN >/dev/null 2>&1; then
            log_warn "Recovery bridge did not open port 5102 (check recovery_bridge.log)"
            head -n 20 "$LOG_DIR/recovery_bridge.log" 2>/dev/null || true
        fi
    else
        log_warn "recovery_bridge.py not found at frontend_new/config — skipping recovery bridge start"
    fi
    
    # Перевірка та опціональний запуск Goose і TTS (тільки якщо відсутні)
    log_info "🔍 Checking optional services..."
    
    # Перевірка Goose
    if curl -s --max-time 3 "http://127.0.0.1:3000/health" > /dev/null 2>&1; then
        log_info "✅ Goose (port 3000) - Already running"
        export ATLAS_GOOSE_AVAILABLE=true
    else
        log_warn "⚠️  Goose (port 3000) - Not available"
        export ATLAS_GOOSE_AVAILABLE=false
        # Спроба запуску тільки якщо скрипт існує
        if [ -x "$REPO_ROOT/scripts/start_tts_and_goose.sh" ]; then
            log_info "� Attempting to start Goose web..."
            LOG_DIR="$LOG_DIR" "$REPO_ROOT/scripts/start_tts_and_goose.sh" && {
                sleep 3
                if curl -s --max-time 3 "http://127.0.0.1:3000/health" > /dev/null 2>&1; then
                    log_info "✅ Goose started successfully"
                    export ATLAS_GOOSE_AVAILABLE=true
                else
                    log_warn "⚠️  Goose start failed - continuing without it"
                fi
            } || log_warn "Failed to start Goose/TTS helper"
        fi
    fi
    
    # Перевірка Ukrainian TTS
    if curl -s --max-time 3 "http://127.0.0.1:3001/health" > /dev/null 2>&1; then
        log_info "✅ Ukrainian TTS (port 3001) - Available"
        export ATLAS_TTS_AVAILABLE=true
    else
        log_warn "⚠️  Ukrainian TTS (port 3001) - Not available"
        export ATLAS_TTS_AVAILABLE=false
    fi

    log_restart "✅ All services started"
}

# Перевірка статусу сервісів
check_services() {
    log_restart "🔍 Checking service status..."
    
    local all_healthy=true
    
    # Flask frontend
    if curl -s --max-time 5 "http://localhost:5001/api/health" > /dev/null 2>&1; then
        log_info "✅ Flask Frontend (port 5001) - Running"
    else
        log_error "❌ Flask Frontend (port 5001) - Not responding"
        all_healthy=false
    fi

    # Vision (embedded in Flask) — перевіряємо окремим ендпоінтом
    if curl -s --max-time 4 "http://localhost:5001/api/vision/status" > "$LOG_DIR/.vision_status.json" 2>/dev/null; then
        if grep -q '"vision_available": *true' "$LOG_DIR/.vision_status.json"; then
            log_info "✅ Vision (Grisha) - Available"
            export ATLAS_VISION_AVAILABLE=true
        else
            log_warn "🟡 Vision (Grisha) - Endpoint reachable, but reports unavailable"
            export ATLAS_VISION_AVAILABLE=false
        fi
    else
        log_warn "⚠️  Vision (Grisha) - Status endpoint not reachable"
        export ATLAS_VISION_AVAILABLE=false
    fi
    
    # Node.js orchestrator
    if curl -s --max-time 5 "http://localhost:5101/health" > /dev/null 2>&1; then
        log_info "✅ Node.js Orchestrator (port 5101) - Running"
    else
        log_error "❌ Node.js Orchestrator (port 5101) - Not responding"
        all_healthy=false
    fi
    
    # Recovery bridge (HTTP health now on 5103; legacy expectation 5102)
    if curl -s --max-time 3 "http://localhost:5103/health" > /dev/null 2>&1; then
        log_info "✅ Recovery Bridge (HTTP health 5103, WS 5102) - Running"
    else
        # fallback: if websocket port is open treat as partial success
        if lsof -tiTCP:5102 -sTCP:LISTEN >/dev/null 2>&1; then
            log_warn "🟡 Recovery Bridge WS port 5102 open, but HTTP health (5103) not responding"
        else
            log_warn "⚠️  Recovery Bridge (ports 5102/5103) - Not responding"
        fi
    fi
    
    # Optional services status
    log_restart "🔍 Optional Services Status:"
    
    # Goose
    if curl -s --max-time 3 "http://localhost:3000/health" > /dev/null 2>&1; then
        log_info "✅ Goose (port 3000) - Available (/health)"
    elif curl -s --max-time 3 "http://localhost:3000/api/health" > /dev/null 2>&1; then
        log_info "✅ Goose (port 3000) - Available (/api/health)"
    else
        log_warn "⚠️  Goose (port 3000) - Not available (Tetyana execution limited)"
    fi
    
    # Ukrainian TTS
    if curl -s --max-time 3 "http://localhost:3001/health" > /dev/null 2>&1; then
        log_info "✅ Ukrainian TTS (port 3001) - Available"
    else
        log_warn "⚠️  Ukrainian TTS (port 3001) - Not available (Voice features disabled)"
    fi
    
    if [ "$all_healthy" = true ]; then
        log_restart "🎉 All core services are running!"
        echo ""
        log_restart "📊 ATLAS Interface: http://localhost:5001"
        log_restart "🔧 Orchestrator API: http://localhost:5101"
    log_restart "🌉 Recovery Bridge: ws://localhost:5102 (health: http://localhost:5103/health)"
        echo ""
        # Status summary
        if [ "${ATLAS_GOOSE_AVAILABLE:-false}" = "true" ]; then
            log_restart "   ⚡ Real Execution: Enabled via Goose"
        else
            log_warn "   ⚡ Real Execution: Limited (Goose unavailable)"
        fi
        if [ "${ATLAS_TTS_AVAILABLE:-false}" = "true" ]; then
            log_restart "   🗣️  Voice Synthesis: Ukrainian TTS enabled"
        else
            log_warn "   🗣️  Voice Synthesis: Disabled (TTS unavailable)"
        fi
        if [ "${ATLAS_VISION_AVAILABLE:-false}" = "true" ]; then
            log_restart "   👁️  Visual Monitoring: Grisha vision system enabled"
        else
            log_warn "   👁️  Visual Monitoring: Disabled / unavailable"
        fi
        echo ""
    log_restart "📄 Logs available in: $LOG_DIR"
    else
        log_error "❌ Some services failed to start. Check logs for details."
        return 1
    fi
}

# Головна функція
main() {
    echo ""
    log_restart "🔄 ATLAS System Restart Utility"
    log_restart "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    # Попередня перевірка Node (щоб не гаяти час на стоп/старт якщо версія невдала)
    check_node_version || exit 1
    # Попередня перевірка Local AI API (можна пропустити якщо змінна встановлена)
    check_local_ai_api || { log_warn "Пропускаємо через відсутність Local AI API"; [ "${ALLOW_NO_LOCAL_AI}" = "1" ] || exit 1; }
    
    # Зупинка сервісів
    stop_all_services
    echo ""
    
    # Короткий перерва для очищення портів
    log_info "⏳ Waiting for ports to clear..."
    sleep 3
    echo ""
    
    # Запуск сервісів
    start_services
    echo ""
    
    # Очікування ініціалізації
    log_info "⏳ Waiting for services to initialize..."
    sleep 10
    echo ""
    
    # Перевірка статусу
    check_services
    echo ""
    
    log_restart "🎯 Restart completed!"
    echo ""
    # Додатковий блок інформації про Goose / TTS
    # Статус openai_compat
    if [ "${DISABLE_OPENAI_COMPAT:-}" = "1" ] || [ "${NO_OPENAI_COMPAT:-}" = "1" ] || [ "${FAST_NO_OPENAI:-}" = "1" ]; then
        log_info "openai_compat: disabled via env (DISABLE/NO/FAST flag)"
    else
        if curl -s --max-time 1 http://127.0.0.1:5101/diagnostics/openai_compat_status > "$LOG_DIR/.openai_compat_diag" 2>/dev/null; then
            oc_disabled=$(grep -o '"disabled":true' "$LOG_DIR/.openai_compat_diag" >/dev/null && echo true || echo false)
            oc_down=$(grep -o '"down":true' "$LOG_DIR/.openai_compat_diag" >/dev/null && echo true || echo false)
            oc_base=$(sed -n 's/.*"base":"\([^"]*\)".*/\1/p' "$LOG_DIR/.openai_compat_diag" | head -n1)
            if [ "$oc_disabled" = true ]; then
                log_warn "openai_compat: runtime reports disabled (base=$oc_base)"
            elif [ "$oc_down" = true ]; then
                log_warn "openai_compat: DOWN (base=$oc_base, fast-fail mode)"
            else
                log_info "openai_compat: active (base=$oc_base)"
            fi
        else
            log_warn "openai_compat: diagnostics endpoint unavailable"
        fi
    fi
    if [ -f "$LOG_DIR/goose.pid" ]; then
        GOOSE_PID=$(cat "$LOG_DIR/goose.pid" 2>/dev/null || echo '?')
        GOOSE_BIN_PATH=$(cat "$LOG_DIR/goose.binpath" 2>/dev/null || echo 'unknown')
        if [ -n "$GOOSE_PID" ]; then
            if kill -0 "$GOOSE_PID" 2>/dev/null; then
                log_info "Goose running (PID $GOOSE_PID) binary: $GOOSE_BIN_PATH"
            else
                log_warn "Goose pid file present ($GOOSE_PID) but process not alive. Binary hint: $GOOSE_BIN_PATH"
            fi
        fi
        # Показати можливу конфіг директорію (якщо goose web використовує робочу директорію репо)
        log_info "Goose working dir (assumed): $REPO_ROOT"
    else
        log_warn "Goose not started (no pid file)."
    fi
    if [ -f "$LOG_DIR/tts.pid" ]; then
        TTS_PID=$(cat "$LOG_DIR/tts.pid" 2>/dev/null || echo '?')
        if kill -0 "$TTS_PID" 2>/dev/null; then
            log_info "TTS running (PID $TTS_PID)"
        else
            log_warn "TTS pid file present ($TTS_PID) but process not alive"
        fi
    fi
}

# Обробка сигналів
trap 'log_error "Restart interrupted"; exit 1' SIGINT SIGTERM

# Запуск
main "$@"
