#!/bin/bash

# ATLAS Process Killer with Auto-Detection
# Автоматичне вбивання всіх процесів Atlas

echo "🔍 Atlas Process Killer - Автовизначення та зупинка"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Функція для пошуку процесів
find_processes() {
    local pattern="$1"
    local name="$2"
    
    local pids=$(pgrep -f "$pattern" 2>/dev/null)
    if [ -n "$pids" ]; then
        echo "🔍 Знайдено $name процеси: $pids"
        return 0
    else
        echo "ℹ️  $name процеси не знайдено"
        return 1
    fi
}

# Функція для зупинки процесів
kill_processes() {
    local pattern="$1"
    local name="$2"
    
    local pids=$(pgrep -f "$pattern" 2>/dev/null)
    if [ -n "$pids" ]; then
        echo "🛑 Зупиняю $name процеси: $pids"
        
        # Спочатку м'яко (TERM)
        echo "$pids" | xargs kill -TERM 2>/dev/null
        sleep 2
        
        # Перевіряємо чи зупинилися
        local remaining=$(pgrep -f "$pattern" 2>/dev/null)
        if [ -n "$remaining" ]; then
            echo "⚡ Примусове зупинення $name: $remaining"
            echo "$remaining" | xargs kill -KILL 2>/dev/null
        fi
        
        return 0
    else
        return 1
    fi
}

echo "📋 Пошук процесів Atlas..."

# Пошук всіх типів процесів
find_processes "goosed" "Goose AI Agent"
find_processes "atlas_minimal" "Atlas Frontend"
find_processes "python.*atlas" "Python Atlas"
find_processes "temporal.*server" "Temporal Server"

echo ""
echo "🛑 Зупинка процесів..."

# Зупинка всіх процесів
STOPPED=0

if kill_processes "goosed" "Goose AI Agent"; then
    STOPPED=$((STOPPED + 1))
fi

if kill_processes "atlas_minimal" "Atlas Frontend"; then
    STOPPED=$((STOPPED + 1))
fi

if kill_processes "python.*atlas" "Python Atlas"; then
    STOPPED=$((STOPPED + 1))
fi

if kill_processes "temporal.*server" "Temporal Server"; then
    STOPPED=$((STOPPED + 1))
fi

# Додаткова очистка портів (якщо потрібно)
echo ""
echo "🔍 Перевірка портів..."
PORTS="3000 8080 8233 7233 58080"
for port in $PORTS; do
    port_pid=$(lsof -ti:$port 2>/dev/null)
    if [ -n "$port_pid" ]; then
        echo "🔌 Порт $port зайнятий процесом $port_pid"
        kill -TERM $port_pid 2>/dev/null || true
    fi
done

sleep 1

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Фінальна перевірка..."

# Перевірка залишкових процесів
REMAINING_PROCESSES=""
for pattern in "goosed" "atlas_minimal" "python.*atlas" "temporal.*server"; do
    remaining=$(pgrep -f "$pattern" 2>/dev/null)
    if [ -n "$remaining" ]; then
        REMAINING_PROCESSES="$REMAINING_PROCESSES $remaining"
    fi
done

if [ -z "$REMAINING_PROCESSES" ]; then
    echo "🎉 Всі процеси Atlas успішно зупинено!"
    echo "🔌 Порти 3000, 8080 звільнено"
else
    echo "⚠️  Деякі процеси ще працюють: $REMAINING_PROCESSES"
    echo "💡 Можливо потрібно sudo kill -9 для примусового зупинення"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
