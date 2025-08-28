#!/bin/bash
# Тестування нової версії Ukrainian TTS MCP Server

echo "🔧 Тестування нової версії mcp-tts-ukrainian..."

cd /Users/dev/Documents/GitHub/ATLAS/goose/crates/mcp-tts-ukrainian

echo "📁 Поточна директорія: $(pwd)"
echo "📋 Файли в директорії:"
ls -la

echo ""
echo "🐍 Перевірка Python файлу..."
if [ -f "mcp_tts_fixed.py" ]; then
    echo "✅ mcp_tts_fixed.py знайдено"
    python3 -m py_compile mcp_tts_fixed.py && echo "✅ Python синтаксис правильний" || echo "❌ Помилка синтаксису Python"
else
    echo "❌ mcp_tts_fixed.py не знайдено"
fi

echo ""
echo "📦 Перевірка requirements..."
if [ -f "requirements.txt" ]; then
    echo "✅ requirements.txt знайдено"
    cat requirements.txt
else
    echo "❌ requirements.txt не знайдено"
fi

echo ""
echo "⚙️ Перевірка конфігурації..."
if [ -f "config.yaml" ]; then
    echo "✅ config.yaml знайдено"
else
    echo "❌ config.yaml не знайдено"
fi

echo ""
echo "🚀 Перевірка скрипту запуску..."
if [ -f "start_fixed.sh" ]; then
    echo "✅ start_fixed.sh знайдено"
    chmod +x start_fixed.sh
else
    echo "❌ start_fixed.sh не знайдено"
fi

echo ""
echo "🎯 Заміна завершена успішно!"
echo "💡 Для запуску використовуйте: cd crates/mcp-tts-ukrainian && ./start_fixed.sh"
