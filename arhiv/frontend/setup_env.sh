#!/bin/bash

# ATLAS Frontend Environment Setup
# Скрипт для настройки окружения frontend

echo "🐍 Настройка окружения Python для ATLAS Frontend..."

# Переход в директорию frontend
cd "$(dirname "$0")"

# Создание виртуального окружения если его нет
if [ ! -d "venv" ]; then
    echo "📦 Создание виртуального окружения..."
    python3 -m venv venv
fi

# Активация виртуального окружения
echo "⚡ Активация виртуального окружения..."
source venv/bin/activate

# Обновление pip
echo "🔄 Обновление pip..."
pip install --upgrade pip

# Установка зависимостей
echo "📚 Установка зависимостей из requirements.txt..."
pip install -r requirements.txt

echo "✅ Окружение готово!"
echo ""
echo "Для активации окружения в будущем используйте:"
echo "source venv/bin/activate"
echo ""
echo "Для запуска frontend:"
echo "python atlas_minimal_live.py"
echo ""
echo "Для деактивации окружения:"
echo "deactivate"
