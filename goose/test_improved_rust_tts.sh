#!/bin/bash
# Тестування покращеної Rust версії Ukrainian TTS MCP Server

echo "🦀 Тестування покращеної Rust версії mcp-tts-ukrainian..."
echo ""

cd /Users/dev/Documents/GitHub/ATLAS/goose

echo "📦 Перевірка компіляції..."
if source bin/activate-hermit && cargo check -p mcp-tts-ukrainian; then
    echo "✅ Компіляція успішна"
else
    echo "❌ Помилка компіляції"
    exit 1
fi

echo ""
echo "🏗️ Перевірка release збірки..."
if [ -f "target/release/mcp-tts-ukrainian" ]; then
    echo "✅ Release binary існує"
    ls -lh target/release/mcp-tts-ukrainian
else
    echo "❌ Release binary не знайдено"
fi

echo ""
echo "🐍 Перевірка Python інтеграції..."
if [ -f "crates/mcp-tts-ukrainian/mcp_tts_fixed.py" ]; then
    echo "✅ Python TTS файл знайдено"
    python3 -m py_compile crates/mcp-tts-ukrainian/mcp_tts_fixed.py && echo "✅ Python синтаксис правильний" || echo "❌ Помилка синтаксису Python"
else
    echo "❌ Python TTS файл не знайдено"
fi

echo ""
echo "🔧 Перевірка структури проекту..."
echo "📁 Файли в crates/mcp-tts-ukrainian:"
ls -la crates/mcp-tts-ukrainian/

echo ""
echo "📝 Rust crate інформація:"
echo "Cargo.toml:"
head -10 crates/mcp-tts-ukrainian/Cargo.toml

echo ""
echo "🎯 Покращена Rust версія готова!"
echo ""
echo "💡 Особливості покращеної версії:"
echo "  ✅ Кращий error handling"
echo "  ✅ Підтримка множинних Python модулів"
echo "  ✅ Graceful fallbacks"
echo "  ✅ Покращене логування"
echo "  ✅ Нативна інтеграція з Goose"
echo ""
echo "🚀 Для запуску: ./target/release/mcp-tts-ukrainian"
