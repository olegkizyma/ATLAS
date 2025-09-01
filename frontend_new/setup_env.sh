#!/bin/bash
# ATLAS Environment Setup Script
# Скрипт для автоматичного налаштування Python середовища

set -e  # Зупинятися при помилках

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
REQUIREMENTS_FILE="$SCRIPT_DIR/requirements.txt"

echo "🔧 ATLAS Environment Setup"
echo "=========================="

# Перевіряємо чи існує Python 3
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 не знайдено. Будь ласка встановіть Python 3."
    exit 1
fi

echo "✅ Python 3 знайдено: $(python3 --version)"

# Створюємо віртуальне середовище якщо не існує
if [ ! -d "$VENV_DIR" ]; then
    echo "📦 Створюємо віртуальне середовище..."
    python3 -m venv "$VENV_DIR"
    echo "✅ Віртуальне середовище створено: $VENV_DIR"
else
    echo "✅ Віртуальне середовище вже існує: $VENV_DIR"
fi

# Активуємо віртуальне середовище
echo "🔄 Активуємо віртуальне середовище..."
source "$VENV_DIR/bin/activate"

# Перевіряємо що ми в правильному середовищі
if [[ "$VIRTUAL_ENV" == "$VENV_DIR" ]]; then
    echo "✅ Віртуальне середовище активовано: $VIRTUAL_ENV"
else
    echo "❌ Помилка активації віртуального середовища"
    exit 1
fi

# Перевіряємо чи треба встановлювати залежності
if python -c "import flask" 2>/dev/null; then
    echo "✅ Залежності вже встановлено"
else
    # Оновлюємо pip
    echo "⬆️  Оновлюємо pip..."
    pip install --upgrade pip

    # Встановлюємо залежності
    if [ -f "$REQUIREMENTS_FILE" ]; then
        echo "📦 Встановлюємо залежності з requirements.txt..."
        pip install -r "$REQUIREMENTS_FILE"
        echo "✅ Всі залежності встановлено"
    else
        echo "⚠️  Файл requirements.txt не знайдено: $REQUIREMENTS_FILE"
    fi
fi

# Показуємо встановлені пакети
echo ""
echo "📋 Встановлені пакети:"
pip list --format=columns 2>/dev/null || pip list

echo ""
echo "🎉 Налаштування завершено!"
echo ""
echo "Для активації середовища в майбутньому використовуйте:"
echo "source $VENV_DIR/bin/activate"
echo ""
echo "Для деактивації:"
echo "deactivate"
