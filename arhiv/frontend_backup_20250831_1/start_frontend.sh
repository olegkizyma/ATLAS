#!/bin/bash

# ATLAS Frontend Launcher with Virtual Environment
# Скрипт запуска frontend с виртуальным окружением

echo "🚀 Запуск ATLAS Frontend..."

# Переход в директорию frontend  
cd "$(dirname "$0")"

# Проверка виртуального окружения
if [ ! -d "venv" ]; then
    echo "❌ Виртуальное окружение не найдено!"
    echo "Запустите сначала: ./setup_env.sh"
    exit 1
fi

# Активация виртуального окружения
echo "⚡ Активация виртуального окружения..."
source venv/bin/activate

# Проверка зависимостей
echo "📦 Проверка зависимостей..."
python -c "import requests; print('✅ Модуль requests доступен')" || {
    echo "❌ Модуль requests не установлен!"
    echo "Запустите: ./setup_env.sh"
    exit 1
}

# Запуск frontend
echo "🌐 Запуск Atlas Minimal Live Frontend..."
echo "📱 Интерфейс будет доступен на: http://localhost:8080"
echo ""

# Запуск в фоне если передан параметр --background
if [ "$1" = "--background" ] || [ "$1" = "-bg" ]; then
    echo "🔧 Запуск в фоновом режиме..."
    python atlas_minimal_live.py &
    FRONTEND_PID=$!
    echo "Frontend PID: $FRONTEND_PID"
    echo "Для остановки: kill $FRONTEND_PID"
else
    echo "🔧 Запуск в интерактивном режиме (Ctrl+C для остановки)..."
    python atlas_minimal_live.py
fi
