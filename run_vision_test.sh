#!/bin/bash

# Wrapper скрипт для запуску тесту візуальної системи
# З Python 3.11 як системною версією wrapper більше не потрібен

set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "🧪 ATLAS Vision System Test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Перевірка чи ATLAS запущено
if ! curl -s --max-time 3 "http://localhost:5001/api/health" > /dev/null 2>&1; then
    echo "❌ ATLAS сервер не запущено на порті 5001"
    echo "🔧 Запустіть командою: ./restart_stack.sh або ./start_stack_macos.sh"
    exit 1
fi

echo "✅ ATLAS сервер доступний"

# Тепер можемо запускати тест прямо з системного Python 3.11
echo "🚀 Запуск тесту візуальної системи (Python 3.11)..."
cd "$REPO_ROOT"
python3 test_grisha_vision.py

echo "✅ Тест завершено"
