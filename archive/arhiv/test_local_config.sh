#!/bin/bash
# Скрипт для тестування локального конфігу Goose

cd /Users/dev/Documents/GitHub/ATLAS

echo "🔍 Тестування локального конфігу Goose..."
echo "══════════════════════════════════════════"

# Перевірити чи існує локальний config.yaml
if [ -f "goose/config.yaml" ]; then
    echo "✅ Локальний config.yaml знайдено в goose/"
else
    echo "❌ Локальний config.yaml не знайдено в goose/"
    exit 1
fi

# Перевірити чи глобальний конфіг деактивований  
if [ -f "$HOME/.config/goose/config.yaml" ]; then
    echo "⚠️ Глобальний config.yaml все ще активний!"
    echo "   Рекомендую перейменувати: mv ~/.config/goose/config.yaml ~/.config/goose/config.yaml.disabled"
else
    echo "✅ Глобальний config.yaml деактивовано"
fi

# Показати який конфіг використовується
echo ""
echo "🧪 Тестовий запуск з локальним конфігом..."
cd goose
source bin/activate-hermit
export XDG_CONFIG_HOME="/Users/dev/Documents/GitHub/ATLAS/goose"
echo "🔧 XDG_CONFIG_HOME встановлено в: $XDG_CONFIG_HOME"
timeout 5s ./target/release/goose --help | head -3

echo ""
echo "💡 Для запуску з локальним конфігом використовуйте:"
echo "   export XDG_CONFIG_HOME='/Users/dev/Documents/GitHub/ATLAS/goose'"
echo "   ./target/release/goosed agent"
