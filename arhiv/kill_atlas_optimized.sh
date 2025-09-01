#!/bin/bash

# 🛑 Atlas Kill Script - Optimized Version
# Коректна зупинка всіх компонентів Atlas

echo "🛑 Atlas Kill - Зупинка всіх компонентів"
echo "═══════════════════════════════════════"

log() {
    echo "[$(date '+%H:%M:%S')] $1"
}

# Функція для коректної зупинки процесу
kill_process() {
    local process_name="$1"
    local signal="${2:-TERM}"
    
    log "🔄 Зупинка $process_name..."
    
    # Знаходимо PID процесів
    pids=$(pgrep -f "$process_name" 2>/dev/null || true)
    
    if [ -z "$pids" ]; then
        log "✅ $process_name вже зупинено"
        return 0
    fi
    
    # Спочатку пробуємо м'яку зупинку
    for pid in $pids; do
        log "📤 Відправляю SIG$signal до $process_name (PID: $pid)"
        kill -$signal "$pid" 2>/dev/null || true
    done
    
    # Очікуємо завершення
    sleep 3
    
    # Перевіряємо чи завершились процеси
    remaining_pids=$(pgrep -f "$process_name" 2>/dev/null || true)
    
    if [ -n "$remaining_pids" ]; then
        log "⚠️ $process_name не завершився, використовую SIGKILL"
        for pid in $remaining_pids; do
            kill -KILL "$pid" 2>/dev/null || true
        done
        sleep 2
    fi
    
    # Фінальна перевірка
    final_check=$(pgrep -f "$process_name" 2>/dev/null || true)
    if [ -z "$final_check" ]; then
        log "✅ $process_name успішно зупинено"
    else
        log "❌ $process_name все ще працює"
    fi
}

# Зупинка Atlas Frontend
kill_process "atlas_minimal_live.py"

# Зупинка Goose Agent
kill_process "goosed"

# Зупинка Temporal (якщо запущено)
kill_process "temporal"

# Зупинка інших можливих процесів Atlas
kill_process "atlas_core"
kill_process "atlas_llm"

# Очистка тимчасових файлів
log "🧹 Очистка тимчасових файлів..."
rm -f /tmp/atlas_*.pid 2>/dev/null || true
rm -f /tmp/goose.log 2>/dev/null || true

# Перевірка портів
log "🔍 Перевірка зайнятих портів..."
for port in 8080 3000 8233 7233; do
    if lsof -ti:$port > /dev/null 2>&1; then
        log "⚠️ Порт $port все ще зайнятий"
        pid=$(lsof -ti:$port)
        log "🔧 Зупиняю процес на порту $port (PID: $pid)"
        kill -KILL "$pid" 2>/dev/null || true
    else
        log "✅ Порт $port вільний"
    fi
done

echo ""
echo "🎯 Зупинка завершена!"
echo "══════════════════════"
log "🔍 Перевірка залишкових процесів..."

# Фінальна перевірка
if pgrep -f "atlas|goose|temporal" > /dev/null; then
    log "⚠️ Знайдено залишкові процеси:"
    ps aux | grep -E "(atlas|goose|temporal)" | grep -v grep || true
else
    log "✅ Всі процеси Atlas зупинено"
fi

echo ""
log "🚀 Готово до нового запуску: ./start_atlas_optimized.sh"
