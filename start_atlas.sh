#!/bin/bash

# ATLAS System Startup Script
# Скрипт запуска системы ATLAS

echo "🚀 Запуск системы ATLAS..."

# Переход в директорию goose
cd /Users/dev/Documents/GitHub/ATLAS/goose

# Активация среды Hermit
echo "⚙️  Активация среды разработки..."
source bin/activate-hermit

# Проверка сборки
if [ ! -f "target/release/goosed" ]; then
    echo "🔨 Сборка серверной части goose..."
    cargo build --release -p goose-server
    if [ $? -ne 0 ]; then
        echo "❌ Ошибка сборки серверной части"
        exit 1
    fi
fi

echo "✅ Серверная часть готова"

# Запуск goosed в фоне
echo "🔧 Запуск goosed agent server..."
./target/release/goosed agent &
GOOSE_PID=$!
echo "Goose server PID: $GOOSE_PID"

# Переход в frontend
cd /Users/dev/Documents/GitHub/ATLAS/frontend

# Запуск frontend с виртуальным окружением
echo "🌐 Запуск frontend интерфейса..."
./start_frontend.sh --background &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

echo ""
echo "🎉 ATLAS система запущена!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 Goosed Server PID: $GOOSE_PID"
echo "🌐 Frontend PID: $FRONTEND_PID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Для остановки системы выполните:"
echo "kill $GOOSE_PID $FRONTEND_PID"
echo ""
echo "Логи можно посмотреть в отдельных терминалах:"
echo "tail -f /tmp/goose.log"
echo "tail -f /tmp/frontend.log"

# Ожидание завершения процессов
wait
