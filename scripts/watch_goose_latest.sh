#!/bin/bash

# 🔍 Скрипт для моніторингу останньої сесії Goose

SESSIONS_DIR="$HOME/.local/share/goose/sessions"

echo "🔍 Пошук найсвіжішої сесії Goose..."

# Знаходимо найновіший файл сесії
LATEST_SESSION=$(ls -t "$SESSIONS_DIR"/*.jsonl 2>/dev/null | head -1)

if [ -z "$LATEST_SESSION" ]; then
    echo "❌ Не знайдено файлів сесій в $SESSIONS_DIR"
    exit 1
fi

SESSION_NAME=$(basename "$LATEST_SESSION")
echo "📂 Найсвіжіша сесія: $SESSION_NAME"
echo "⏰ Час модифікації: $(stat -f "%Sm" "$LATEST_SESSION")"
echo "📊 Розмір: $(du -h "$LATEST_SESSION" | cut -f1)"
echo ""
echo "📖 Останні 50 записів:"
echo "─────────────────────────────────────────────────────"

# Показуємо останні записи
tail -50 "$LATEST_SESSION"
