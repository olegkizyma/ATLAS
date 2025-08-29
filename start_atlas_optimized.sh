#!/bin/bash

# 🚀 Atlas Optimized Startup Script
# Повний перезапуск системи Atlas з правильною послідовністю

set -e  # Зупинити при помилці

echo "🚀 Atlas Optimized Startup - Повний перезапуск системи"
echo "════════════════════════════════════════════════════════"

# Функція для логування
log() {
    echo "[$(date '+%H:%M:%S')] $1"
}

# Функція для перевірки статусу процесу
check_process() {
    local process_name="$1"
    local port="$2"
    
    if pgrep -f "$process_name" > /dev/null; then
        log "✅ $process_name запущено"
        if [ -n "$port" ]; then
            if nc -z localhost "$port" 2>/dev/null; then
                log "✅ Порт $port доступний"
            else
                log "⚠️ Порт $port не відповідає"
            fi
        fi
        return 0
    else
        log "❌ $process_name не запущено"
        return 1
    fi
}

# Крок 1: Зупинка всіх процесів
log "🛑 Зупиняю всі процеси Atlas..."
cd /Users/dev/Documents/GitHub/ATLAS

if [ -f "./kill_atlas.sh" ]; then
    chmod +x ./kill_atlas.sh
    ./kill_atlas.sh
else
    log "⚠️ kill_atlas.sh не знайдено, використовую ручну зупинку"
    pkill -f "goosed" || true
    pkill -f "atlas_minimal_live.py" || true
    pkill -f "temporal" || true
    sleep 2
fi

log "⏳ Очікування завершення процесів..."
sleep 3

# Крок 2: Запуск Goose AI Agent
log "🤖 Запускаю Goose AI Agent..."
cd /Users/dev/Documents/GitHub/ATLAS/goose

# Перевірка наявності hermit
if [ ! -f "bin/activate-hermit" ]; then
    log "❌ Hermit не знайдено в $(pwd)/bin/activate-hermit"
    exit 1
fi

# Активація Hermit та запуск Goose
source bin/activate-hermit
log "✅ Hermit environment активовано"

# Перевірка наявності goosed
if [ ! -f "./target/release/goosed" ]; then
    log "❌ goosed не знайдено в $(pwd)/target/release/goosed"
    log "💡 Спробуйте зібрати: cargo build --release"
    exit 1
fi

log "🚀 Запускаю Goose daemon..."
./target/release/goosed agent &
GOOSE_PID=$!
log "✅ Goose запущено (PID: $GOOSE_PID)"

# Очікування запуску Goose
log "⏳ Очікування запуску Goose..."
sleep 5

# Крок 3: Запуск Atlas Frontend
log "🌐 Запускаю Atlas Frontend..."
cd /Users/dev/Documents/GitHub/ATLAS/frontend

# Перевірка наявності venv
if [ ! -d "venv" ]; then
    log "❌ Python venv не знайдено в $(pwd)/venv"
    log "💡 Створіть віртуальне середовище: python -m venv venv"
    exit 1
fi

# Активація Python venv
source venv/bin/activate
log "✅ Python venv активовано"

# Перевірка наявності atlas_minimal_live.py
if [ ! -f "atlas_minimal_live.py" ]; then
    log "❌ atlas_minimal_live.py не знайдено в $(pwd)"
    exit 1
fi

log "🚀 Запускаю Atlas Frontend..."
python atlas_minimal_live.py &
FRONTEND_PID=$!
log "✅ Atlas Frontend запущено (PID: $FRONTEND_PID)"

# Крок 4: Перевірка статусу
log "⏳ Очікування стабілізації системи..."
sleep 10

echo ""
echo "🔍 Перевірка статусу системи:"
echo "────────────────────────────────"

check_process "goosed" "3000"
check_process "atlas_minimal_live.py" "8080"

# Перевірка доступності веб-інтерфейсу
log "🌐 Перевірка веб-інтерфейсу..."
if curl -s http://localhost:8080 > /dev/null; then
    log "✅ Веб-інтерфейс доступний на http://localhost:8080"
else
    log "❌ Веб-інтерфейс недоступний"
fi

# Перевірка API
log "🔧 Перевірка API..."
if curl -s http://localhost:8080/api/status > /dev/null; then
    log "✅ API доступний"
else
    log "❌ API недоступний"
fi

echo ""
echo "🎯 Atlas Optimized Startup завершено!"
echo "════════════════════════════════════════"
echo "📊 Корисні посилання:"
echo "   🌐 Atlas Frontend: http://localhost:8080"
echo "   ⚡ Temporal UI: http://localhost:8233"
echo "   🤖 Goose Agent: порт 3000"
echo ""
echo "📋 Корисні команди:"
echo "   📊 Статус: curl http://localhost:8080/api/status"
echo "   🔍 Логи Goose: ./scripts/goose-monitor"
echo "   🛑 Зупинити: ./kill_atlas.sh"
echo ""
echo "🔄 Система готова до роботи!"

# Збереження PID для майбутнього використання
echo "$GOOSE_PID" > /tmp/atlas_goose.pid
echo "$FRONTEND_PID" > /tmp/atlas_frontend.pid

log "✅ PID збережено в /tmp/atlas_*.pid"
