#!/bin/bash

# ATLAS System Status Check
echo "🔍 Проверка статуса системы ATLAS..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Проверка Goosed (порт 3000)
echo -n "🔧 Goosed Server (port 3000): "
if curl -s -f http://localhost:3000 > /dev/null 2>&1; then
    echo "✅ РАБОТАЕТ"
else
    echo "❌ НЕ ДОСТУПЕН"
fi

# Проверка Frontend (порт 8080)
echo -n "🌐 Frontend (port 8080): "
if curl -s -f http://localhost:8080 > /dev/null 2>&1; then
    echo "✅ РАБОТАЕТ"
else
    echo "❌ НЕ ДОСТУПЕН"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Показать активные процессы
echo "📋 Активные процессы ATLAS:"
ps aux | grep -E "(goosed|atlas_minimal_live)" | grep -v grep || echo "Нет активных процессов"

echo ""
echo "🌐 Frontend интерфейс: http://localhost:8080"
echo "🔧 Goosed API: http://localhost:3000"
