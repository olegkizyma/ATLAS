#!/bin/bash

# 🚀 Atlas Optimized Startup Script (portable)
# Повний перезапуск системи Atlas з правильною послідовністю

set -euo pipefail  # Зупинятись при помилці/неоголошеній змінній/pipe-ошибке

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
GOOSE_DIR="$REPO_ROOT/goose"

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
cd "$REPO_ROOT"

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

# Крок 2: Запуск Goose Web (UI) на 3000
log "🤖 Запускаю Goose Web..."
cd "$GOOSE_DIR"

# Перевірка наявності hermit
if [ ! -f "bin/activate-hermit" ]; then
    log "❌ Hermit не знайдено в $(pwd)/bin/activate-hermit"
    exit 1
fi

# Активація Hermit та запуск Goose
source bin/activate-hermit
log "✅ Hermit environment активовано"

log "🌐 Відкриваю Goose Web на порту 3000 (з браузером)"
# Узгодити секрет для фронтенду (Atlas читає GOOSE_SECRET_KEY)
export GOOSE_SECRET_KEY="${GOOSE_SECRET_KEY:-test}"

# Запуск Goose Web рівно як запитано (абсолютний шлях до бинаря)
"$GOOSE_DIR/target/release/goose" web --port 3000 --open &
GOOSE_PID=$!
log "✅ Goose Web запущено (PID: $GOOSE_PID)"

# Очікування запуску Goose
log "⏳ Очікування запуску Goose..."
sleep 5

# Крок 3: Запуск Atlas Frontend
log "🌐 Запускаю Atlas Frontend..."
cd "$FRONTEND_DIR"

# Перевірка наявності venv
# Переконаємось, що venv існує; якщо ні — створимо
if [ ! -d "venv" ]; then
    log "🐍 Створюю локальне Python venv..."
    if command -v python3 >/dev/null 2>&1; then PYBIN=python3; else PYBIN=python; fi
    "$PYBIN" -m venv venv
    # Оновлюємо pip і ставимо залежності
    "venv/bin/pip" install --upgrade pip >/dev/null
    if [ -f "requirements.txt" ]; then
        log "� Встановлюю залежності з requirements.txt"
        "venv/bin/pip" install -r requirements.txt
    fi
else
    # Обновление зависимостей опционально — можно включить по флагу
    :
fi

# Активація Python venv (тільки для дочірніх процесів цього скрипта)
source "venv/bin/activate"
log "✅ Python venv активовано"

# Перевірка наявності atlas_minimal_live.py
if [ ! -f "atlas_minimal_live.py" ]; then
    log "❌ atlas_minimal_live.py не знайдено в $(pwd)"
    exit 1
fi

log "🚀 Запускаю Atlas Frontend..."
# Запуск через bash з активованим venv для правильного використання віртуального середовища
cd "$FRONTEND_DIR" && bash -c "source venv/bin/activate && export PYTHONPATH='$FRONTEND_DIR:\${PYTHONPATH:-}' && python atlas_minimal_live.py" &
FRONTEND_PID=$!
log "✅ Atlas Frontend запущено (PID: $FRONTEND_PID)"

# Крок 4: Перевірка статусу
log "⏳ Очікування стабілізації системи..."
sleep 10

echo ""
echo "🔍 Перевірка статусу системи:"
echo "────────────────────────────────"

check_process "goose web" "3000"
check_process "atlas_minimal_live.py" "8080"

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
